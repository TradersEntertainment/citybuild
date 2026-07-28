import { describe, expect, it } from 'vitest';
import { PROMISE_BETRAYAL_SWAY, PROMISE_MADE_SWAY } from '../src/data/balance';
import { PROMISE_LIMIT, PROMISE_ORDER, PROMISE_SPECS, type PromiseId } from '../src/data/promises';
import { GROUP_ORDER, readGroups } from '../src/sim/groups';
import { deserialize, serialize } from '../src/sim/save';
import {
  betrayalTotal,
  hasPromised,
  isPromiseKept,
  makePromise,
  promiseProgress,
  promiseSway,
  settlePromises,
  stepPromises,
} from '../src/sim/promises';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { ISSUE, NONE } from '../src/sim/tiles';
import { index, startingCentre } from '../src/sim/world';

function city(): GameState {
  const state = createGameState(hashSeed('promises'), 0);
  for (let i = 0; i < state.world.road.length; i++) {
    if ((state.world.highway[i] ?? 0) === 1) state.world.road[i] = NONE;
  }
  state.world.highway.fill(0);
  state.world.highwayRoute = [];
  state.era = 'metropolis';
  state.population = 6_000;
  return state;
}

function fill(state: GameState, issues = 0): void {
  const centre = startingCentre(state.world);
  const x0 = Math.floor(centre.x) - 15;
  const y = Math.floor(centre.y);
  for (let n = 0; n < 30; n++) {
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x: x0 + n, y, zone: 'res', level: 3, score: 0.6, growthProgress: 0,
      decayTimer: 0, population: 20, jobs: 0, issues, output: 0, builtAt: 0,
      variantSeed: n,
    } as never);
    state.world.landValue[index(state.world, x0 + n, y)] = 50;
  }
}

describe('the promise table', () => {
  it('lists every promise in the save order, exactly once', () => {
    const ids = Object.keys(PROMISE_SPECS) as PromiseId[];
    expect([...PROMISE_ORDER].sort()).toEqual([...ids].sort());
    expect(new Set(PROMISE_ORDER).size).toBe(PROMISE_ORDER.length);
  });

  it('courts a real faction, and no two court the same one', () => {
    const courted = PROMISE_ORDER.map((id) => PROMISE_SPECS[id].courts);
    for (const group of courted) expect(GROUP_ORDER).toContain(group);
    // One promise per constituency, so the room is worked a piece at a time.
    expect(new Set(courted).size).toBe(courted.length);
  });

  it('costs more to break than making it ever bought', () => {
    // The asymmetry is the whole mechanic: if these balanced, promising
    // everything would be strictly correct and there would be nothing to weigh.
    expect(PROMISE_BETRAYAL_SWAY).toBeGreaterThan(PROMISE_MADE_SWAY);
  });
});

describe('making one', () => {
  it('is free, and moves the room immediately', () => {
    const state = city();
    fill(state);
    const courted = PROMISE_SPECS.noJams.courts;
    const before = promiseSway(state, courted);
    const money = state.money;

    expect(makePromise(state, 'noJams')).toBe('made');
    // Populism works, right now, before anything has been built.
    expect(promiseSway(state, courted)).toBeGreaterThan(before);
    expect(state.money).toBe(money);
  });

  it('refuses the same promise twice', () => {
    const state = city();
    expect(makePromise(state, 'noJams')).toBe('made');
    expect(makePromise(state, 'noJams')).toBe('already');
    expect(state.promises).toHaveLength(1);
  });

  it('refuses one the era has not opened', () => {
    const state = city();
    state.era = 'village';
    expect(makePromise(state, 'noJams')).toBe('locked');
  });

  it('caps how much of the city can be promised at once', () => {
    const state = city();
    for (let i = 0; i < PROMISE_LIMIT; i++) {
      expect(makePromise(state, PROMISE_ORDER[i]!)).toBe('made');
    }
    expect(makePromise(state, PROMISE_ORDER[PROMISE_LIMIT]!)).toBe('full');
    expect(state.promises).toHaveLength(PROMISE_LIMIT);
  });

  it('only ever warms the faction it names', () => {
    const state = city();
    fill(state);
    makePromise(state, 'cleanAir');
    const courted = PROMISE_SPECS.cleanAir.courts;
    for (const group of GROUP_ORDER) {
      if (group === courted) continue;
      expect(promiseSway(state, group)).toBe(0);
    }
  });
});

describe('measuring one', () => {
  it('reads every promise off state the city was already keeping', () => {
    const state = city();
    fill(state);
    for (const id of PROMISE_ORDER) {
      const have = promiseProgress(state, id);
      expect(Number.isFinite(have)).toBe(true);
      expect(have).toBeGreaterThanOrEqual(0);
      expect(have).toBeLessThanOrEqual(1);
    }
  });

  it('answers to the city rather than to the promise', () => {
    const clean = city();
    fill(clean, 0);
    const smoky = city();
    fill(smoky, ISSUE.pollution);
    expect(promiseProgress(clean, 'cleanAir')).toBeGreaterThan(
      promiseProgress(smoky, 'cleanAir'),
    );
    expect(isPromiseKept(clean, 'cleanAir')).toBe(true);
    expect(isPromiseKept(smoky, 'cleanAir')).toBe(false);
  });

  it('treats the tax pledge as the lever it is', () => {
    const state = city();
    state.taxRate = 0.05;
    expect(isPromiseKept(state, 'lowTax')).toBe(true);
    state.taxRate = 0.2;
    expect(isPromiseKept(state, 'lowTax')).toBe(false);
  });
});

describe('the reckoning', () => {
  it('reports nothing when nothing was promised', () => {
    const state = city();
    expect(settlePromises(state)).toHaveLength(0);
  });

  it('clears the slate either way — a new term is a new set', () => {
    const state = city();
    fill(state);
    makePromise(state, 'cleanAir');
    settlePromises(state);
    expect(state.promises).toHaveLength(0);
  });

  it('costs nothing when the promise was kept', () => {
    const state = city();
    fill(state, 0);
    makePromise(state, 'cleanAir');
    const [verdict] = settlePromises(state);
    expect(verdict?.kept).toBe(true);
    expect(betrayalTotal(state)).toBe(0);
  });

  it('is remembered by the faction that was promised, and only them', () => {
    const state = city();
    fill(state, ISSUE.pollution);
    makePromise(state, 'cleanAir');
    settlePromises(state);

    const courted = PROMISE_SPECS.cleanAir.courts;
    expect(promiseSway(state, courted)).toBeLessThan(0);
    for (const group of GROUP_ORDER) {
      if (group === courted) continue;
      expect(promiseSway(state, group)).toBe(0);
    }
  });

  it('stacks, so breaking faith twice is twice as bad', () => {
    const state = city();
    fill(state, ISSUE.pollution);
    makePromise(state, 'cleanAir');
    settlePromises(state);
    const once = promiseSway(state, PROMISE_SPECS.cleanAir.courts);

    makePromise(state, 'cleanAir');
    settlePromises(state);
    expect(promiseSway(state, PROMISE_SPECS.cleanAir.courts)).toBeLessThan(once);
  });

  it('never lets the grudge array go sparse, whatever the faction order', () => {
    // Regression: betrayed is indexed by GROUP_ORDER and started empty, so
    // writing the greens' slot left holes before it — and summing a sparse
    // array is NaN, which would have reached the panel.
    const state = city();
    fill(state, ISSUE.pollution);
    makePromise(state, 'cleanAir');
    settlePromises(state);
    expect(state.betrayed).toHaveLength(GROUP_ORDER.length);
    for (const memory of state.betrayed) expect(Number.isFinite(memory)).toBe(true);
    expect(Number.isFinite(betrayalTotal(state))).toBe(true);
  });

  it('is clamped, so there is a floor to how badly it can go', () => {
    const state = city();
    fill(state, ISSUE.pollution);
    for (let i = 0; i < 20; i++) {
      makePromise(state, 'cleanAir');
      settlePromises(state);
    }
    const at = GROUP_ORDER.indexOf(PROMISE_SPECS.cleanAir.courts);
    expect(state.betrayed[at]).toBeLessThanOrEqual(1);
  });

  it('costs the mayor more than the promise ever bought', () => {
    const state = city();
    fill(state, ISSUE.pollution);
    const courted = PROMISE_SPECS.cleanAir.courts;
    makePromise(state, 'cleanAir');
    const bought = promiseSway(state, courted);
    settlePromises(state);
    const owed = promiseSway(state, courted);
    expect(Math.abs(owed)).toBeGreaterThan(Math.abs(bought));
  });
});

describe('being forgiven', () => {
  it('fades, so one broken promise never caps a city for good', () => {
    const state = city();
    fill(state, ISSUE.pollution);
    makePromise(state, 'cleanAir');
    settlePromises(state);
    const before = betrayalTotal(state);
    for (let i = 0; i < 400; i++) stepPromises(state, 1);
    expect(betrayalTotal(state)).toBeLessThan(before);
  });

  it('is gone entirely given long enough', () => {
    const state = city();
    fill(state, ISSUE.pollution);
    makePromise(state, 'cleanAir');
    settlePromises(state);
    for (let i = 0; i < 3_000; i++) stepPromises(state, 1);
    expect(betrayalTotal(state)).toBe(0);
  });

  it('costs a city that has never promised anything exactly nothing', () => {
    const state = city();
    fill(state);
    for (const group of GROUP_ORDER) expect(promiseSway(state, group)).toBe(0);
    for (let i = 0; i < 100; i++) stepPromises(state, 1);
    expect(betrayalTotal(state)).toBe(0);
  });
});

describe('what the room does with it', () => {
  it('lifts the courted faction and keeps every vote inside 0..1', () => {
    const state = city();
    fill(state);
    const before = new Map(readGroups(state).map((g) => [g.id, g.approval]));
    makePromise(state, 'cleanAir');
    const after = new Map(readGroups(state).map((g) => [g.id, g.approval]));
    expect(after.get('greens') ?? 0).toBeGreaterThanOrEqual(before.get('greens') ?? 0);
    for (const group of readGroups(state)) {
      expect(group.approval).toBeGreaterThanOrEqual(0);
      expect(group.approval).toBeLessThanOrEqual(1);
    }
  });

  it('survives every promise made and broken at once', () => {
    const state = city();
    fill(state, ISSUE.traffic | ISSUE.pollution | ISSUE.noService);
    for (const id of PROMISE_ORDER.slice(0, PROMISE_LIMIT)) makePromise(state, id);
    settlePromises(state);
    for (const group of readGroups(state)) {
      expect(Number.isFinite(group.approval)).toBe(true);
      expect(group.approval).toBeGreaterThanOrEqual(0);
      expect(group.approval).toBeLessThanOrEqual(1);
    }
  });
});

describe('the save', () => {
  it('carries an outstanding promise — it is a debt, not a mood', () => {
    const state = city();
    makePromise(state, 'cleanAir');
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded).not.toBeNull();
    expect(hasPromised(loaded, 'cleanAir')).toBe(true);
  });

  it('carries the grudge', () => {
    const state = city();
    fill(state, ISSUE.pollution);
    makePromise(state, 'cleanAir');
    settlePromises(state);
    const loaded = deserialize(serialize(state)) as GameState;
    expect(betrayalTotal(loaded as GameState)).toBeGreaterThan(0);
  });

  it('loads a file from before this existed as a city that promised nothing', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    delete data['promises'];
    delete data['betrayed'];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.promises).toEqual([]);
    expect(betrayalTotal(loaded)).toBe(0);
  });

  it('drops a promise this build no longer knows', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['promises'] = ['cleanAir', 'freeBread'];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded!.promises).toEqual(['cleanAir']);
  });

  it('does not let a corrupt grudge poison the arithmetic', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['betrayed'] = [Number.NaN, 99, -5];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded!.betrayed).toHaveLength(GROUP_ORDER.length);
    for (const memory of loaded!.betrayed) {
      expect(Number.isFinite(memory)).toBe(true);
      expect(memory).toBeGreaterThanOrEqual(0);
      expect(memory).toBeLessThanOrEqual(1);
    }
  });
});
