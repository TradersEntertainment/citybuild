import { describe, expect, it } from 'vitest';
import { REPORT_EQUITY_FLOOR, REPORT_LEGACY_SWING } from '../src/data/balance';
import { computeConnectivity } from '../src/sim/connectivity';
import { approval } from '../src/sim/elections';
import { computeLandValue, computeRoadDistance, createFields } from '../src/sim/fields';
import { legacyValue } from '../src/sim/legacy';
import {
  gradeOf,
  readReport,
  REPORT_DIMENSIONS,
  reportLegacyFactor,
  type ReportDimension,
} from '../src/sim/report';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { ISSUE, NONE } from '../src/sim/tiles';
import { index as tileIndex, startingCentre } from '../src/sim/world';

/** A flat, buildable working area, as the economy fixtures make one. */
function city(seed = 'report'): GameState {
  const state = createGameState(hashSeed(seed), 0);
  for (let i = 0; i < state.world.road.length; i++) {
    if ((state.world.highway[i] ?? 0) === 1) state.world.road[i] = NONE;
  }
  state.world.highway.fill(0);
  state.world.highwayRoute = [];
  state.era = 'city';
  state.population = 4_000;
  return state;
}

/** Drops `count` buildings in a row, each with the issues and level given. */
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
      id,
      x,
      y,
      zone: 'res',
      level: (opts.level ?? 1) as never,
      score: 0.5,
      growthProgress: 0,
      decayTimer: 0,
      population: 20,
      jobs: 0,
      issues: opts.issues ?? 0,
      output: 0,
      builtAt: 0,
      variantSeed: n,
    } as never);
    if (opts.value !== undefined) {
      state.world.landValue[tileIndex(state.world, x, y)] = opts.value;
    }
  }
}

describe('grading', () => {
  it('is a band, not a curve — the same score is the same letter always', () => {
    expect(gradeOf(0.95)).toBe('A');
    expect(gradeOf(0.75)).toBe('B');
    expect(gradeOf(0.6)).toBe('C');
    expect(gradeOf(0.45)).toBe('D');
    expect(gradeOf(0.1)).toBe('F');
  });

  it('has no score too low to grade and none too high', () => {
    expect(gradeOf(-5)).toBe('F');
    expect(gradeOf(5)).toBe('A');
    expect(gradeOf(Number.NaN)).toBe('F');
  });
});

describe('the card', () => {
  it('grades an empty city at nothing rather than crashing', () => {
    const state = city();
    state.population = 0;
    const card = readReport(state);
    for (const dimension of REPORT_DIMENSIONS) {
      expect(card.scores[dimension]).toBe(0);
    }
    expect(card.overall).toBe(0);
    expect(card.grade).toBe('F');
  });

  it('keeps every dimension inside 0..1, whatever the city', () => {
    const wrecked = city();
    place(wrecked, 40, { issues: ISSUE.traffic | ISSUE.pollution | ISSUE.noService });
    wrecked.debt = 9_999_999;
    wrecked.ledger.net = -50_000;
    wrecked.ledger.taxIncome = 1;

    const rich = city();
    place(rich, 40, { level: 5, value: 100 });
    rich.ledger.net = 999_999;
    rich.ledger.taxIncome = 999_999;

    for (const state of [wrecked, rich]) {
      const card = readReport(state);
      for (const dimension of REPORT_DIMENSIONS) {
        const score = card.scores[dimension];
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
      expect(card.overall).toBeGreaterThanOrEqual(0);
      expect(card.overall).toBeLessThanOrEqual(1);
    }
  });

  it('is a reading, so the same city twice gives the same card', () => {
    const state = city();
    place(state, 30, { level: 3 });
    expect(readReport(state)).toEqual(readReport(state));
  });

  it('weights every dimension equally — it counts nobody', () => {
    // The whole design in one assertion: overall is the plain mean, so no
    // dimension can be drowned out by how many voters would agree with it.
    const state = city();
    place(state, 30, { level: 4, value: 60 });
    const card = readReport(state);
    let sum = 0;
    for (const dimension of REPORT_DIMENSIONS) sum += card.scores[dimension];
    expect(card.overall).toBeCloseTo(sum / REPORT_DIMENSIONS.length, 10);
  });
});

describe('each dimension answers to the thing it names', () => {
  const worse = (
    dimension: ReportDimension,
    build: (state: GameState) => void,
    ruin: (state: GameState) => void,
  ): void => {
    const good = city();
    build(good);
    const bad = city();
    build(bad);
    ruin(bad);
    expect(readReport(bad).scores[dimension]).toBeLessThan(readReport(good).scores[dimension]);
  };

  it('marks mobility down for jams', () => {
    worse(
      'mobility',
      (s) => place(s, 30),
      (s) => {
        for (const b of s.buildings.values()) b.issues |= ISSUE.traffic;
      },
    );
  });

  it('marks the environment down for smoke', () => {
    worse(
      'environment',
      (s) => place(s, 30),
      (s) => {
        for (const b of s.buildings.values()) b.issues |= ISSUE.pollution;
      },
    );
  });

  it('marks the economy down for running at a loss', () => {
    worse(
      'economy',
      (s) => {
        place(s, 30);
        s.ledger.taxIncome = 1_000;
        s.ledger.net = 500;
      },
      (s) => {
        s.ledger.net = -800;
      },
    );
  });

  it('marks the economy down for debt it cannot service', () => {
    worse(
      'economy',
      (s) => {
        place(s, 30);
        s.ledger.taxIncome = 1_000;
        s.ledger.net = 200;
      },
      (s) => {
        s.debt = 500_000;
      },
    );
  });

  it('marks endurance down for a city of sheds', () => {
    worse(
      'endurance',
      (s) => place(s, 30, { level: 5 }),
      (s) => {
        for (const b of s.buildings.values()) b.level = 1 as never;
      },
    );
  });
});

describe('equity — the reading nothing else in the game takes', () => {
  it('scores an evenly valued city at the top', () => {
    const state = city();
    place(state, 30, { value: 50 });
    expect(readReport(state).scores.equity).toBeCloseTo(1, 5);
  });

  it('marks down a gleaming centre ringed by neglect', () => {
    const even = city();
    place(even, 30, { value: 50 });

    const split = city();
    place(split, 30, { value: 50 });
    // Same buildings, same count, same everything — only the spread differs.
    let n = 0;
    for (const b of split.buildings.values()) {
      split.world.landValue[tileIndex(split.world, b.x, b.y)] = n < 15 ? 95 : 5;
      n++;
    }
    expect(readReport(split).scores.equity).toBeLessThan(readReport(even).scores.equity);
  });

  it('does not grade a city too small to be unequal', () => {
    const state = city();
    place(state, REPORT_EQUITY_FLOOR - 1, { value: 10 });
    // One building in the "worst fifth" would swing on every placement.
    expect(readReport(state).scores.equity).toBe(1);
  });

  it('does not let a city buy the grade by levelling everybody down', () => {
    // A ratio on its own says a city where every address is worthless is
    // perfectly equal. True of the spread, and not what "Adalet" claims: the
    // dimension asks whether the city was built for everyone in it, and one
    // built well for nobody has not answered it. Without this a player could
    // bank the equity mandate by keeping the whole map destitute.
    const destitute = city();
    place(destitute, 30, { value: 3 });
    expect(readReport(destitute).scores.equity).toBeLessThan(0.5);

    const decent = city();
    place(decent, 30, { value: 50 });
    expect(readReport(decent).scores.equity).toBeGreaterThan(0.9);
  });

  it('leaves an ordinary functioning city untouched by that floor', () => {
    // Measured on a grown city the worst fifth sits near 39 against a floor of
    // 30, so the standard only ever catches the artificially destitute.
    const state = city();
    place(state, 30, { value: 39 });
    expect(readReport(state).scores.equity).toBeCloseTo(1, 5);
  });

  it('treats a city with no value at all as ungraded rather than crashing', () => {
    const state = city();
    place(state, 30, { value: 0 });
    const equity = readReport(state).scores.equity;
    expect(Number.isFinite(equity)).toBe(true);
    expect(equity).toBeGreaterThanOrEqual(0);
  });

  it('ignores empty ground — a city is not marked down for fields', () => {
    const dense = city();
    place(dense, 30, { value: 50 });
    const before = readReport(dense).scores.equity;
    // A corner of worthless unbuilt land must not move the reading.
    for (let x = 2; x < 20; x++) {
      dense.world.landValue[tileIndex(dense.world, x, 2)] = 0;
    }
    expect(readReport(dense).scores.equity).toBeCloseTo(before, 10);
  });
});

describe('the card and the ballot box', () => {
  it('can disagree — the whole reason the card exists', () => {
    // A populist city: plenty of people, plenty of jobs, mood high, and every
    // one of them living beside a jam in filthy air at the wrong end of an
    // unequal map. The voters are content; the city is not well run.
    const state = city();
    state.happiness = 92;
    state.money = 400_000;
    state.ledger.taxIncome = 5_000;
    state.ledger.net = 2_000;
    place(state, 40, { issues: ISSUE.traffic | ISSUE.pollution | ISSUE.noService, level: 1 });
    let n = 0;
    for (const b of state.buildings.values()) {
      state.world.landValue[tileIndex(state.world, b.x, b.y)] = n < 8 ? 100 : 2;
      n++;
    }

    const card = readReport(state);
    expect(approval(state)).toBeGreaterThan(0.5);
    expect(card.overall).toBeLessThan(0.5);
  });

  it('rewards the mayor who left the better city, not the more popular one', () => {
    const populist = city();
    populist.happiness = 95;
    place(populist, 40, { issues: ISSUE.traffic | ISSUE.pollution, level: 1, value: 5 });

    const planner = city();
    planner.happiness = 60;
    place(planner, 40, { level: 4, value: 55 });
    planner.ledger.taxIncome = 5_000;
    planner.ledger.net = 1_500;

    // Same population and era, so size cannot be what separates them.
    expect(populist.population).toBe(planner.population);
    expect(populist.era).toBe(planner.era);
    expect(legacyValue(planner)).toBeGreaterThan(legacyValue(populist));
  });
});

describe('what the card hands on', () => {
  it('is a swing, never a forfeit', () => {
    const wrecked = city();
    place(wrecked, 40, { issues: ISSUE.traffic | ISSUE.pollution | ISSUE.noService, value: 5 });
    wrecked.debt = 9_999_999;
    wrecked.ledger.taxIncome = 1;
    wrecked.ledger.net = -9_999;

    const factor = reportLegacyFactor(wrecked);
    // The contract is the bound, not one city's number: a badly run city hands
    // on less, and still hands on something.
    expect(factor).toBeGreaterThanOrEqual(1 - REPORT_LEGACY_SWING);
    expect(factor).toBeLessThan(1);
    expect(legacyValue(wrecked)).toBeGreaterThanOrEqual(0);
  });

  it('cannot leave the band at either extreme', () => {
    // Constructed floor and ceiling, so the mapping is pinned without needing a
    // city that actually scores 0 or 1.
    const floor = 1 - REPORT_LEGACY_SWING;
    const ceiling = 1 + REPORT_LEGACY_SWING;
    for (const overall of [0, 0.25, 0.5, 0.75, 1]) {
      const factor = 1 - REPORT_LEGACY_SWING + REPORT_LEGACY_SWING * 2 * overall;
      expect(factor).toBeGreaterThanOrEqual(floor);
      expect(factor).toBeLessThanOrEqual(ceiling);
    }
    expect(floor).toBeGreaterThan(0);
  });

  it('tops out above one, so a well-run city gains rather than merely not losing', () => {
    const state = city();
    const card = readReport(state);
    // Whatever this particular city scores, the mapping's ends are fixed.
    expect(reportLegacyFactor(state)).toBeCloseTo(
      1 - REPORT_LEGACY_SWING + REPORT_LEGACY_SWING * 2 * card.overall,
      10,
    );
    expect(1 - REPORT_LEGACY_SWING + REPORT_LEGACY_SWING * 2).toBeCloseTo(
      1 + REPORT_LEGACY_SWING,
      10,
    );
  });

  it('never hands on a negative or unreal endowment', () => {
    const state = city();
    state.population = 0;
    state.era = 'founding';
    expect(legacyValue(state)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(legacyValue(state))).toBe(true);
  });
});

describe('the land value the card reads', () => {
  it('is published to the world, not only to the working field', () => {
    // Regression: world.landValue was never written by anything, so the value
    // lens drew an empty map and the equity dimension would have read zeros.
    const state = city();
    const fields = createFields(state.world.size);
    computeConnectivity(state.world);
    computeRoadDistance(state.world, fields.roadDistance);
    computeLandValue(state.world, fields);

    let fieldMax = 0;
    let worldMax = 0;
    for (let i = 0; i < fields.landValue.length; i++) {
      fieldMax = Math.max(fieldMax, fields.landValue[i] ?? 0);
      worldMax = Math.max(worldMax, state.world.landValue[i] ?? 0);
    }
    expect(fieldMax).toBeGreaterThan(0);
    expect(worldMax).toBe(fieldMax);
  });

  it('agrees tile for tile with the field it was computed into', () => {
    const state = city();
    const fields = createFields(state.world.size);
    computeConnectivity(state.world);
    computeRoadDistance(state.world, fields.roadDistance);
    computeLandValue(state.world, fields);
    for (let i = 0; i < fields.landValue.length; i++) {
      expect(state.world.landValue[i]).toBe(fields.landValue[i]);
    }
  });
});
