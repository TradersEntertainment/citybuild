import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_CHILD_SHARE,
  COHORT_BAND_S,
  LABOUR_PARTICIPATION,
  SCHOOLED_OUTPUT,
} from '../src/data/balance';
import type { Level } from '../src/data/buildings';
import type { Building } from '../src/sim/buildings';
import {
  BANDS,
  bandCount,
  burialHappiness,
  cohortTotal,
  schooledShare,
  schoolingCrimeFactor,
  skillFactor,
  stepCohorts,
  workingShare,
  type Band,
} from '../src/sim/cohorts';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { SERVICE } from '../src/sim/tiles';
import { index } from '../src/sim/world';

/**
 * Who lives there, in four bands (§8b).
 *
 * The load-bearing property is the first block: the bands are a decomposition of
 * `state.population`, never a rival to it. Every other system in the game writes
 * to that number without knowing this file exists, so if reconciliation ever
 * drifts, the workforce silently stops matching the city and nothing says why.
 */

function addHome(game: GameState, x: number, y: number, people: number): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone: 'res',
    // Level five, so the fixture's homes have real headroom. A level-three house
    // holds about twenty-two people; packing fifty into one leaves the birth rate
    // reading a full city and switching itself off, which silently removed births
    // from every assertion in the file.
    level: 5 as Level,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: people,
    jobs: 0,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  return building;
}

/** A city with `people` residents, its homes about three-quarters full. */
function city(people: number, homes = 50): GameState {
  const game = createGameState(hashSeed('cohorts'), 0);
  game.era = 'town';
  for (let i = 0; i < homes; i++) addHome(game, 140 + i, 150, people / homes);
  game.population = people;
  return game;
}

/**
 * Changes how many people live there, the way the rest of the sim does.
 *
 * Setting `state.population` alone does not hold: the cohort pass calls
 * refreshPopulation, which recomputes the headline figure from the buildings, so a
 * fixture that only rewrites the scalar is undone on the next step.
 */
function resettle(game: GameState, people: number): void {
  const homes = [...game.buildings.values()].filter((b) => b.zone === 'res');
  for (const home of homes) home.population = people / homes.length;
  game.population = people;
}

/** Steps `seconds` of city time one second at a time. */
function run(game: GameState, seconds: number): void {
  for (let s = 0; s < seconds; s++) stepCohorts(game, 1);
}

function bands(game: GameState): Record<Band, number> {
  const out = {} as Record<Band, number>;
  for (const band of BANDS) out[band] = Math.round(bandCount(game, band));
  return out;
}

describe('the bands decompose the population', () => {
  it('starts empty and fills from the population on the first step', () => {
    const game = city(1_000);
    expect(cohortTotal(game.cohorts)).toBe(0);
    stepCohorts(game, 1);
    expect(cohortTotal(game.cohorts)).toBeCloseTo(game.population, 3);
  });

  it('stays in step with the population through arrivals and losses', () => {
    const game = city(1_000);
    stepCohorts(game, 1);
    // Arrivals: something else in the sim moved people in.
    resettle(game, 4_000);
    stepCohorts(game, 1);
    // Against the population as it stands *after* the step, not the figure written
    // before it: the same step also buries whoever aged out of the last band.
    expect(cohortTotal(game.cohorts)).toBeCloseTo(game.population, 3);
    expect(game.population).toBeGreaterThan(3_990);
    // A loss the bands did not cause — an epidemic, a demolished block.
    resettle(game, 2_500);
    stepCohorts(game, 1);
    expect(cohortTotal(game.cohorts)).toBeCloseTo(game.population, 3);
  });

  it('never holds a negative band', () => {
    const game = city(500);
    stepCohorts(game, 1);
    resettle(game, 0);
    stepCohorts(game, 1);
    for (const band of BANDS) expect(bandCount(game, band)).toBeGreaterThanOrEqual(0);
  });

  it('brings families rather than a crowd of workers', () => {
    const game = city(1_000);
    stepCohorts(game, 1);
    const share = bandCount(game, 'child') / game.population;
    expect(share).toBeCloseTo(ARRIVAL_CHILD_SHARE, 2);
    expect(bandCount(game, 'elder')).toBeGreaterThan(0);
  });
});

describe('ageing', () => {
  it('moves people up the bands over time', () => {
    const game = city(2_000);
    stepCohorts(game, 1);
    const before = bands(game);
    run(game, COHORT_BAND_S);
    const after = bands(game);
    expect(after.elder).toBeGreaterThan(before.elder);
    // The child band is not smaller — births keep refilling it — so what has to
    // be true is that the people who were children have moved on. Measured as the
    // share of the city rather than the count: a city that keeps having children
    // still ages, and asserting the count would only be testing the birth rate.
    expect(after.child / game.population).toBeLessThan(before.child / 2_000);
  });

  it('nobody crosses two bands in one step', () => {
    // The flow is walked from the top down for exactly this reason: a bottom-up
    // walk would carry a child to a pension inside one tick.
    const game = createGameState(hashSeed('cohorts'), 0);
    game.era = 'town';
    addHome(game, 150, 150, 1_000);
    game.population = 1_000;
    stepCohorts(game, 1);
    const children = bandCount(game, 'child');
    expect(children).toBeGreaterThan(0);
    const elders = bandCount(game, 'elder');
    stepCohorts(game, 1);
    // One step moves a slice of `adult` into `elder`; none of it can be this
    // step's children.
    expect(bandCount(game, 'elder') - elders).toBeLessThan(children);
  });

  it('takes people out of the city when the last band runs out', () => {
    const game = city(3_000);
    stepCohorts(game, 1);
    // Push everyone into the last band, then let a band's time pass.
    game.cohorts.people = [0, 0, 0, 3_000];
    game.cohorts.schooled = [0, 0, 0, 0];
    const before = game.population;
    run(game, 200);
    expect(game.population).toBeLessThan(before);
    expect(game.cohorts.awaitingBurial).toBeGreaterThan(0);
  });

  it('produces a wave rather than a steady trickle', () => {
    // The whole reason the bands are worth having. One cohort, arriving together:
    // it must reach the cemetery together rather than as an even trickle.
    //
    // Set as a single band rather than by letting the city fill, because a city
    // that fills through migration is spread across all four bands from its first
    // step and is *supposed* to bury people steadily. The wave is what a founding
    // rush does, and a founding rush is one cohort.
    const game = city(5_000);
    stepCohorts(game, 1);
    game.cohorts.people = [5_000, 0, 0, 0];
    game.cohorts.schooled = [0, 0, 0, 0];

    // Measured as the population lost per slice rather than as the backlog, which
    // is capped where its mood hit saturates and so cannot show a wave at all.
    // The fixture's homes are over capacity, so there are no births to muddy it:
    // every person who leaves, leaves feet first.
    const lost: number[] = [];
    let last = game.population;
    const slice = COHORT_BAND_S / 2;
    for (let n = 0; n < 10; n++) {
      run(game, slice);
      lost.push(last - game.population);
      last = game.population;
    }
    // Nearly nothing for the first band and a half, then the wave lands.
    expect(Math.max(...lost)).toBeGreaterThan((lost[0] ?? 0) * 20);
  });
});

describe('the workforce is discovered, not assumed', () => {
  it('falls back to the flat share before the bands are filled', () => {
    // A freshly loaded save has a population and no breakdown. Reading zero
    // workers on that frame would look like a city that cannot staff anything.
    const game = city(1_000);
    expect(workingShare(game)).toBe(LABOUR_PARTICIPATION);
  });

  it('reports who is actually of working age once they are', () => {
    const game = city(1_000);
    stepCohorts(game, 1);
    const share = workingShare(game);
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(1);
  });

  it('says a city of children cannot staff anything', () => {
    const game = city(1_000);
    stepCohorts(game, 1);
    game.cohorts.people = [1_000, 0, 0, 0];
    expect(workingShare(game)).toBe(0);
  });

  it('says the same of a city of pensioners', () => {
    const game = city(1_000);
    stepCohorts(game, 1);
    game.cohorts.people = [0, 0, 0, 1_000];
    expect(workingShare(game)).toBe(0);
  });
});

describe('schooling compounds', () => {
  /** Puts a school over every home, so coverage is 1. */
  const openSchools = (game: GameState): void => {
    for (const building of game.buildings.values()) {
      game.world.serviceMask[index(game.world, building.x, building.y)] = SERVICE.education;
    }
  };

  it('teaches nobody without a school', () => {
    const game = city(2_000);
    run(game, COHORT_BAND_S * 2);
    expect(schooledShare(game)).toBe(0);
    expect(skillFactor(game)).toBe(1);
  });

  it('does not pay until the schooled children are the workforce', () => {
    const game = city(2_000);
    openSchools(game);
    stepCohorts(game, 1);
    // Immediately after opening, the children are schooled and the workers are not.
    run(game, 30);
    expect(schooledShare(game)).toBeLessThan(0.1);
    // A band later, that cohort is working.
    run(game, COHORT_BAND_S);
    expect(schooledShare(game)).toBeGreaterThan(0.1);
  });

  it('reaches most of the workforce given two generations', () => {
    const game = city(2_000);
    openSchools(game);
    run(game, COHORT_BAND_S * 3);
    expect(schooledShare(game)).toBeGreaterThan(0.6);
  });

  it('is not diluted away by the people arriving off the motorway', () => {
    // The finding that shaped the rule. With arrivals landing unschooled, a
    // growing city produced graduates and washed them out at the same rate, and
    // the share pinned near a half whatever the player built.
    const game = city(2_000);
    openSchools(game);
    run(game, COHORT_BAND_S * 2);
    const settled = schooledShare(game);
    // A wave of newcomers half the size of the city again.
    resettle(game, game.population * 1.5);
    stepCohorts(game, 1);
    // Not exactly equal — the two working bands hold different shares and the
    // intake splits between them — but a rounding rather than the halving the
    // unschooled-arrivals version produced.
    expect(schooledShare(game)).toBeGreaterThan(settled - 0.05);
  });

  it('pays a wage, and never docks one', () => {
    const game = city(2_000);
    openSchools(game);
    // A pure bonus: an unschooled city earns what it always earned.
    expect(skillFactor(game)).toBe(1);
    run(game, COHORT_BAND_S * 3);
    const factor = skillFactor(game);
    expect(factor).toBeGreaterThan(1);
    expect(factor).toBeLessThanOrEqual(SCHOOLED_OUTPUT);
  });

  it('takes something off the crime rate too', () => {
    const game = city(2_000);
    openSchools(game);
    expect(schoolingCrimeFactor(game)).toBe(1);
    run(game, COHORT_BAND_S * 3);
    expect(schoolingCrimeFactor(game)).toBeLessThan(1);
    expect(schoolingCrimeFactor(game)).toBeGreaterThan(0);
  });

  it('loses the certificates with the people who held them', () => {
    // A loss takes schooled and unschooled in the proportion they stand in, so
    // the share cannot be raised by bulldozing a district.
    const game = city(2_000);
    openSchools(game);
    run(game, COHORT_BAND_S * 3);
    const before = schooledShare(game);
    resettle(game, 500);
    stepCohorts(game, 1);
    expect(schooledShare(game)).toBeCloseTo(before, 2);
  });
});

describe('burials', () => {
  it('costs nothing while the city keeps up', () => {
    const game = city(4_000);
    stepCohorts(game, 1);
    expect(burialHappiness(game)).toBe(0);
  });

  it('tolerates a few and then does not', () => {
    const game = city(4_000);
    stepCohorts(game, 1);
    game.cohorts.awaitingBurial = 4;
    expect(burialHappiness(game)).toBe(0);
    game.cohorts.awaitingBurial = 400;
    expect(burialHappiness(game)).toBeLessThan(0);
  });

  it('saturates rather than running away', () => {
    const game = city(4_000);
    stepCohorts(game, 1);
    game.cohorts.awaitingBurial = 1_000;
    const bad = burialHappiness(game);
    game.cohorts.awaitingBurial = 1_000_000;
    // A backlog a hundred times worse is not a hundred times the mood hit, or one
    // unattended wave would pin the scale at zero forever.
    expect(burialHappiness(game)).toBe(bad);
  });

  it('is cleared by a cemetery', () => {
    const game = city(4_000);
    stepCohorts(game, 1);
    game.cohorts.awaitingBurial = 300;
    game.services.set(1, { id: 1, kind: 'cemetery', x: 150, y: 160 });
    run(game, 60);
    expect(game.cohorts.awaitingBurial).toBeLessThan(300);
  });

  it('is not cleared by a fire station', () => {
    const game = city(4_000);
    stepCohorts(game, 1);
    // Started below the ceiling: the backlog is capped where its mood hit
    // saturates, so a figure above that is pulled down by the cap rather than by
    // anything a fire station did, and the assertion would prove nothing.
    game.cohorts.awaitingBurial = 1;
    game.services.set(1, { id: 1, kind: 'fire', x: 150, y: 160 });
    run(game, 30);
    expect(game.cohorts.awaitingBurial).toBeGreaterThan(1);
  });

  it('announces falling behind, and catching up again', () => {
    const game = city(4_000);
    stepCohorts(game, 1);
    game.cohorts.awaitingBurial = 400;
    const behind = stepCohorts(game, 1);
    expect(behind.map((e) => e.kind)).toEqual(['burialBacklog']);
    // Reported once, not every step.
    expect(stepCohorts(game, 1)).toEqual([]);

    // Four of them. One cannot outpace a city of four thousand — measured at
    // about sixty-seven burials a minute against a cemetery's forty — and that
    // ratio is deliberate: it is what makes the cemetery a recurring cost that
    // scales with the city rather than a box ticked once.
    for (let n = 1; n <= 4; n++) {
      game.services.set(n, { id: n, kind: 'cemetery', x: 150 + n, y: 160 });
    }
    let cleared: string[] = [];
    for (let s = 0; s < 600 && cleared.length === 0; s++) {
      cleared = stepCohorts(game, 1).map((e) => e.kind);
    }
    expect(cleared).toEqual(['burialCleared']);
  });
});

describe('across a save', () => {
  it('rebuilds the bands from the population it loaded', () => {
    // Derived, so not saved. A loaded city costs one generation of schooling
    // history and nothing else, which is cheaper than a schema change.
    const game = city(3_000);
    run(game, COHORT_BAND_S);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(cohortTotal(loaded.cohorts)).toBe(0);
    stepCohorts(loaded, 1);
    expect(cohortTotal(loaded.cohorts)).toBeCloseTo(loaded.population, 3);
  });
});
