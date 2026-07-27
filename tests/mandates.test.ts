import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/data/missions';
import { legacyValue, mandateLegacy } from '../src/sim/legacy';
import { activeMissions, measureGoal, settleMissions } from '../src/sim/missions';
import { totalBuildings } from '../src/sim/buildings';
import { readReport, REPORT_DIMENSIONS } from '../src/sim/report';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { deserialize, serialize } from '../src/sim/save';
import { ISSUE, NONE } from '../src/sim/tiles';
import { index as tileIndex, startingCentre } from '../src/sim/world';
import { describeGoal } from '../src/ui/missionText';

const MANDATES = MISSIONS.filter((m) => (m.legacy ?? 0) > 0);

function city(): GameState {
  const state = createGameState(hashSeed('mandate'), 0);
  for (let i = 0; i < state.world.road.length; i++) {
    if ((state.world.highway[i] ?? 0) === 1) state.world.road[i] = NONE;
  }
  state.world.highway.fill(0);
  state.world.highwayRoute = [];
  state.era = 'metropolis';
  state.population = 40_000;
  return state;
}

function place(
  state: GameState,
  count: number,
  opts: { issues?: number; level?: number; value?: number } = {},
): void {
  const centre = startingCentre(state.world);
  const x0 = Math.floor(centre.x) - Math.floor(count / 2);
  const y = Math.floor(centre.y);
  for (let n = 0; n < count; n++) {
    const x = x0 + n;
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x, y, zone: 'res', level: (opts.level ?? 1) as never, score: 0.5,
      growthProgress: 0, decayTimer: 0, population: 20, jobs: 0,
      issues: opts.issues ?? 0, output: 0, builtAt: 0, variantSeed: n,
    } as never);
    if (opts.value !== undefined) {
      state.world.landValue[tileIndex(state.world, x, y)] = opts.value;
    }
  }
}

describe('the mandate chain', () => {
  it('exists, and covers every dimension of the card', () => {
    // The point of the chain: a player learns the card a column at a time.
    const named = new Set(
      MANDATES.flatMap((m) => (m.goal.measure === 'cardDimension' ? [m.goal.dimension] : [])),
    );
    for (const dimension of REPORT_DIMENSIONS) expect(named).toContain(dimension);
    expect(MANDATES.some((m) => m.goal.measure === 'cardOverall')).toBe(true);
  });

  it('pays in legacy and never in money', () => {
    // The whole reason mandates are a separate kind of goal: by the era they
    // can be met, money is not a reward.
    for (const mission of MANDATES) expect(mission.reward).toBe(0);
    for (const mission of MISSIONS) {
      if ((mission.legacy ?? 0) > 0) continue;
      expect(mission.reward).toBeGreaterThan(0);
    }
  });

  it('asks harder for the dimension nothing else in the game asks for', () => {
    const equity = MANDATES.find(
      (m) => m.goal.measure === 'cardDimension' && m.goal.dimension === 'equity',
    );
    const others = MANDATES.filter((m) => m !== equity && m.goal.measure === 'cardDimension');
    expect(equity).toBeDefined();
    for (const other of others) {
      expect(equity!.legacy!).toBeGreaterThanOrEqual(other.legacy!);
    }
  });

  it('is worth more to govern well overall than to win any single column', () => {
    const whole = MANDATES.find((m) => m.goal.measure === 'cardOverall')!;
    for (const one of MANDATES) {
      if (one === whole) continue;
      expect(whole.legacy!).toBeGreaterThan(one.legacy!);
    }
  });

  it('says every goal in words', () => {
    for (const mission of MANDATES) {
      const text = describeGoal(mission.goal);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
    }
  });
});

describe('measuring a mandate', () => {
  it('reads the card on the same 0..100 scale the panel already draws', () => {
    const state = city();
    place(state, 40, { level: 4, value: 50 });
    const totals = totalBuildings(state);
    const card = readReport(state);
    expect(measureGoal(state, totals, { measure: 'cardOverall', target: 70 })).toBeCloseTo(
      card.overall * 100,
      6,
    );
    expect(
      measureGoal(state, totals, { measure: 'cardDimension', dimension: 'equity', target: 70 }),
    ).toBeCloseTo(card.scores.equity * 100, 6);
  });

  it('is not met by a city that built a lot and ran it badly', () => {
    // The gap the mandates exist to close: every other goal in the chain would
    // congratulate this city.
    const state = city();
    place(state, 60, { issues: ISSUE.traffic | ISSUE.pollution | ISSUE.noService, value: 3 });
    state.ledger.taxIncome = 1;
    state.ledger.net = -9_000;
    state.debt = 900_000;
    settleMissions(state);
    for (const mission of MANDATES) expect(state.missionsDone).not.toContain(mission.id);
  });
});

describe('what a mandate is worth', () => {
  it('adds nothing before one is earned', () => {
    const state = city();
    expect(mandateLegacy(state)).toBe(0);
  });

  it('adds its points to what retiring the city is worth', () => {
    const state = city();
    place(state, 40, { level: 4, value: 50 });
    const before = legacyValue(state);
    state.missionsDone.push('oneCity');
    expect(mandateLegacy(state)).toBe(
      MISSIONS.find((m) => m.id === 'oneCity')!.legacy,
    );
    expect(legacyValue(state)).toBeGreaterThan(before);
  });

  it('survives a later slide — an earned mandate is never taken back', () => {
    const state = city();
    place(state, 40, { level: 4, value: 50 });
    state.missionsDone.push('oneCity');
    const earned = mandateLegacy(state);

    // The city goes to ruin afterwards: the grade collapses, the mandate does not.
    for (const b of state.buildings.values()) {
      b.issues |= ISSUE.traffic | ISSUE.pollution | ISSUE.noService;
      b.level = 1 as never;
    }
    state.debt = 9_000_000;
    expect(readReport(state).overall).toBeLessThan(0.7);
    expect(mandateLegacy(state)).toBe(earned);
    expect(legacyValue(state)).toBeGreaterThanOrEqual(0);
  });

  it('is carried by the save, because missionsDone already is', () => {
    const state = city();
    state.missionsDone.push('oneCity');
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded).not.toBeNull();
    expect(mandateLegacy(loaded)).toBeGreaterThan(0);
  });

  it('ignores a completed goal this build no longer knows', () => {
    const state = city();
    state.missionsDone.push('somethingRemovedInAPatch');
    expect(mandateLegacy(state)).toBe(0);
    expect(Number.isFinite(legacyValue(state))).toBe(true);
  });
});

describe('when a mandate is offered', () => {
  it('is never shown to a village that cannot be graded on it', () => {
    const state = city();
    state.era = 'village';
    const shown = activeMissions(state, 99).map((p) => p.mission.id);
    for (const mission of MANDATES) expect(shown).not.toContain(mission.id);
  });

  it('is offered once the era arrives', () => {
    const state = city();
    const shown = activeMissions(state, 99).map((p) => p.mission.id);
    expect(MANDATES.some((m) => shown.includes(m.id))).toBe(true);
  });
});
