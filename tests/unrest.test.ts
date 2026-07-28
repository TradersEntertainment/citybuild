import { describe, expect, it } from 'vitest';
import {
  UNREST_ON_REFUSAL,
  UNREST_ON_SEIZURE,
} from '../src/data/balance';
import { readGroups } from '../src/sim/groups';
import { stepElections, termOf } from '../src/sim/elections';
import { deserialize, serialize } from '../src/sim/save';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { ISSUE, NONE } from '../src/sim/tiles';
import {
  electionsRun,
  handOver,
  hasMandate,
  refuseResult,
  seizePower,
  stepUnrest,
  unrestCrimeFactor,
  unrestGroupSway,
  unrestHappiness,
  unrestMigrationPush,
} from '../src/sim/unrest';
import { index as tileIndex, startingCentre } from '../src/sim/world';

function city(): GameState {
  const state = createGameState(hashSeed('unrest'), 0);
  for (let i = 0; i < state.world.road.length; i++) {
    if ((state.world.highway[i] ?? 0) === 1) state.world.road[i] = NONE;
  }
  state.world.highway.fill(0);
  state.world.highwayRoute = [];
  state.era = 'city';
  state.population = 8_000;
  return state;
}

/** A city that is genuinely well run, so the report card scores high. */
function wellRun(state: GameState): void {
  const centre = startingCentre(state.world);
  const x0 = Math.floor(centre.x) - 20;
  const y = Math.floor(centre.y);
  for (let n = 0; n < 40; n++) {
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x: x0 + n, y, zone: 'res', level: 5, score: 0.9, growthProgress: 0,
      decayTimer: 0, population: 40, jobs: 0, issues: 0, output: 0,
      builtAt: 0, variantSeed: n,
    } as never);
    state.world.landValue[tileIndex(state.world, x0 + n, y)] = 55;
  }
  state.ledger.taxIncome = 9_000;
  state.ledger.net = 4_000;
}

/** …and one that is not. */
function badlyRun(state: GameState): void {
  const centre = startingCentre(state.world);
  const x0 = Math.floor(centre.x) - 20;
  const y = Math.floor(centre.y);
  for (let n = 0; n < 40; n++) {
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x: x0 + n, y, zone: 'res', level: 1, score: 0.2, growthProgress: 0,
      decayTimer: 0, population: 40, jobs: 0,
      issues: ISSUE.traffic | ISSUE.pollution | ISSUE.noService,
      output: 0, builtAt: 0, variantSeed: n,
    } as never);
    state.world.landValue[tileIndex(state.world, x0 + n, y)] = n < 8 ? 90 : 4;
  }
  state.ledger.taxIncome = 100;
  state.ledger.net = -4_000;
  state.debt = 900_000;
}

describe('a city that has never been asked', () => {
  it('is elected, calm, and pays nothing at all for this system', () => {
    const state = city();
    expect(hasMandate(state)).toBe(true);
    expect(state.unrest).toBe(0);
    expect(unrestHappiness(state)).toBe(0);
    expect(unrestMigrationPush(state)).toBe(0);
    expect(unrestCrimeFactor(state)).toBe(1);
    expect(unrestGroupSway(state)).toBe(0);
    expect(electionsRun(state)).toBe(true);
  });

  it('stays exactly at nothing however long it runs', () => {
    const state = city();
    for (let i = 0; i < 500; i++) stepUnrest(state, 1);
    expect(state.unrest).toBe(0);
  });
});

describe('the three answers', () => {
  it('hands over cleanly, and the goodwill is real', () => {
    const state = city();
    refuseResult(state);
    expect(state.unrest).toBeGreaterThan(0);
    handOver(state);
    expect(hasMandate(state)).toBe(true);
    // Accepting a defeat is the only answer that makes the city easier to run.
    expect(state.unrest).toBe(0);
    expect(electionsRun(state)).toBe(true);
  });

  it('refuses at a cost, and keeps the ballot box', () => {
    const state = city();
    refuseResult(state);
    expect(state.mandate).toBe('refused');
    expect(state.unrest).toBeCloseTo(UNREST_ON_REFUSAL, 6);
    // The way back is still open, which is what separates this from a coup.
    expect(electionsRun(state)).toBe(true);
  });

  it('seizes power at a much higher cost, and ends the voting', () => {
    const state = city();
    seizePower(state);
    expect(state.mandate).toBe('seized');
    expect(state.unrest).toBeCloseTo(UNREST_ON_SEIZURE, 6);
    expect(electionsRun(state)).toBe(false);
    expect(UNREST_ON_SEIZURE).toBeGreaterThan(UNREST_ON_REFUSAL);
  });

  it('never lets unrest leave 0..1, however many times it is answered', () => {
    const state = city();
    for (let i = 0; i < 20; i++) {
      refuseResult(state);
      seizePower(state);
    }
    expect(state.unrest).toBeLessThanOrEqual(1);
    expect(state.unrest).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.unrest)).toBe(true);
  });
});

describe('what the streets answer to', () => {
  it('turns against a usurper who lets the city rot', () => {
    const state = city();
    badlyRun(state);
    seizePower(state);
    const before = state.unrest;
    for (let i = 0; i < 200; i++) stepUnrest(state, 1);
    expect(state.unrest).toBeGreaterThan(before);
  });

  it('settles for a usurper who genuinely runs a good city', () => {
    // The redemption path, and the whole reason this is a tension rather than a
    // scolding: a city may forgive a great deal of a government that works.
    const state = city();
    wellRun(state);
    seizePower(state);
    const before = state.unrest;
    for (let i = 0; i < 400; i++) stepUnrest(state, 1);
    expect(state.unrest).toBeLessThan(before);
  });

  it('is never a dead end — a good enough government always walks it back', () => {
    const state = city();
    wellRun(state);
    seizePower(state);
    for (let i = 0; i < 4_000; i++) stepUnrest(state, 1);
    expect(state.unrest).toBeLessThan(0.5);
  });

  it('sheds whatever is left once a mayor is elected again', () => {
    const state = city();
    badlyRun(state);
    refuseResult(state);
    handOver(state);
    for (let i = 0; i < 200; i++) stepUnrest(state, 1);
    expect(state.unrest).toBe(0);
  });

  it('reports the streets settling exactly once, as they cross back', () => {
    // Along the redemption path rather than the handover: handing over clears
    // the meter outright, so it jumps the line instead of walking down through
    // it — and announces itself separately. A usurper governing well is the
    // only way the crossing actually happens.
    const state = city();
    wellRun(state);
    seizePower(state);
    expect(state.unrest).toBeGreaterThan(0.5);

    let settling = 0;
    for (let i = 0; i < 2_000; i++) {
      for (const change of stepUnrest(state, 1)) if (change.kind === 'settling') settling++;
    }
    expect(settling).toBe(1);
    expect(state.unrest).toBeLessThan(0.5);
  });

  it('reports the streets turning exactly once, as they cross up', () => {
    const state = city();
    badlyRun(state);
    refuseResult(state);
    expect(state.unrest).toBeLessThan(0.5);

    let rising = 0;
    for (let i = 0; i < 2_000; i++) {
      for (const change of stepUnrest(state, 1)) if (change.kind === 'rising') rising++;
    }
    expect(rising).toBe(1);
  });
});

describe('what it costs the city', () => {
  it('costs mood, people and calm streets, in proportion', () => {
    const state = city();
    seizePower(state);
    expect(unrestHappiness(state)).toBeLessThan(0);
    expect(unrestMigrationPush(state)).toBeGreaterThan(0);
    expect(unrestCrimeFactor(state)).toBeGreaterThan(1);
  });

  it('scales with the meter rather than being a step', () => {
    const light = city();
    refuseResult(light);
    const heavy = city();
    seizePower(heavy);
    expect(unrestHappiness(heavy)).toBeLessThan(unrestHappiness(light));
    expect(unrestCrimeFactor(heavy)).toBeGreaterThan(unrestCrimeFactor(light));
  });

  it('turns every faction against the government, not merely some', () => {
    const state = city();
    wellRun(state);
    const before = readGroups(state).map((g) => g.approval);
    seizePower(state);
    const after = readGroups(state).map((g) => g.approval);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!).toBeLessThanOrEqual(before[i]!);
    }
    expect(after.some((v, i) => v < before[i]!)).toBe(true);
  });

  it('keeps every approval inside 0..1 at full unrest', () => {
    const state = city();
    badlyRun(state);
    state.mandate = 'seized';
    state.unrest = 1;
    for (const group of readGroups(state)) {
      expect(group.approval).toBeGreaterThanOrEqual(0);
      expect(group.approval).toBeLessThanOrEqual(1);
    }
  });
});

describe('elections after a coup', () => {
  it('stop happening entirely', () => {
    const state = city();
    seizePower(state);
    state.playedMs = 10 * 200 * 1000;
    expect(stepElections(state, 1)).toHaveLength(0);
    expect(state.money).toBe(createGameState(hashSeed('unrest'), 0).money);
  });

  it('do not fire a decade of back-dated ballots if they ever return', () => {
    const state = city();
    seizePower(state);
    state.playedMs = 10 * 200 * 1000;
    stepElections(state, 1);
    // The term clock keeps up even though no vote is held.
    expect(state.lastTermSettled).toBe(termOf(state.playedMs));
  });

  it('still run for a mayor who merely refused a result', () => {
    const state = city();
    refuseResult(state);
    expect(electionsRun(state)).toBe(true);
  });
});

describe('the save', () => {
  it('carries the mandate and the meter', () => {
    const state = city();
    seizePower(state);
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.mandate).toBe('seized');
    expect(loaded.unrest).toBeCloseTo(UNREST_ON_SEIZURE, 3);
    expect(electionsRun(loaded)).toBe(false);
  });

  it('loads a file from before this existed as an ordinary elected city', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    delete data['mandate'];
    delete data['unrest'];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.mandate).toBe('elected');
    expect(loaded.unrest).toBe(0);
  });

  it('reads an unknown mandate as elected rather than stranding the city', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['mandate'] = 'emperor';
    data['unrest'] = Number.NaN;
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.mandate).toBe('elected');
    expect(loaded.unrest).toBe(0);
  });

  it('clamps a corrupt meter rather than propagating it', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['unrest'] = 99;
    const loaded = deserialize(data as never) as GameState;
    expect(loaded!.unrest).toBe(1);
  });
});
