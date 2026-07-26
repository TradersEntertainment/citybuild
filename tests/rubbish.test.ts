import { describe, expect, it } from 'vitest';
import {
  EPIDEMIC_MIN_POP,
  RUBBISH_DEPOT_RATE,
  RUBBISH_EPIDEMIC_MULT,
  RUBBISH_PER_JOB_MIN,
  RUBBISH_PER_RESIDENT_MIN,
} from '../src/data/balance';
import type { Level } from '../src/data/buildings';
import type { Building } from '../src/sim/buildings';
import { stepHazards } from '../src/sim/hazards';
import {
  collectionPerMinute,
  markUncollected,
  rubbishEpidemicFactor,
  rubbishHappiness,
  rubbishPerMinute,
  rubbishStrain,
  rubbishTolerance,
  stepRubbish,
  type RubbishEvent,
} from '../src/sim/rubbish';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { ISSUE, SERVICE } from '../src/sim/tiles';
import { index } from '../src/sim/world';

/**
 * The bins (§15).
 *
 * The reason this exists is not that a city builder needs a rubbish system. It is
 * that the epidemic system had no cause: an outbreak arrived on a timer and the
 * only lever was a hospital to soften it after the fact. Rubbish is a cause the
 * player can act on before it happens, and that is the difference between a
 * hazard and a weather report — so the test that matters most is the one tying
 * the two together.
 */

function add(
  game: GameState,
  x: number,
  y: number,
  zone: 'res' | 'com' | 'ind',
  people: number,
  jobs: number,
): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone,
    level: 3 as Level,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: people,
    jobs,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  return building;
}

/** A town of `homes` houses, each holding twenty people. */
function town(homes = 20): GameState {
  const game = createGameState(hashSeed('rubbish'), 0);
  game.era = 'town';
  for (let i = 0; i < homes; i++) add(game, 140 + i, 150, 'res', 20, 0);
  game.population = homes * 20;
  return game;
}

function depot(game: GameState, id: number): void {
  game.services.set(id, { id, kind: 'depot', x: 150 + id, y: 160 });
}

describe('what the city puts out', () => {
  it('is nothing when nobody lives there', () => {
    const game = createGameState(hashSeed('rubbish'), 0);
    expect(rubbishPerMinute(game)).toBe(0);
  });

  it('counts residents and jobs, at their own rates', () => {
    const game = createGameState(hashSeed('rubbish'), 0);
    add(game, 150, 150, 'res', 100, 0);
    add(game, 151, 150, 'com', 0, 40);
    expect(rubbishPerMinute(game)).toBeCloseTo(
      100 * RUBBISH_PER_RESIDENT_MIN + 40 * RUBBISH_PER_JOB_MIN,
      6,
    );
  });

  it('is cleared by the depots standing, and by nothing else', () => {
    const game = town();
    expect(collectionPerMinute(game)).toBe(0);
    game.services.set(1, { id: 1, kind: 'fire', x: 150, y: 160 });
    expect(collectionPerMinute(game)).toBe(0);
    depot(game, 2);
    expect(collectionPerMinute(game)).toBe(RUBBISH_DEPOT_RATE);
    depot(game, 3);
    expect(collectionPerMinute(game)).toBe(RUBBISH_DEPOT_RATE * 2);
  });

  it('tolerates proportionally more in a bigger city', () => {
    // A metropolis is not punished for being a metropolis. It is punished for
    // being a metropolis with a town's worth of depots.
    const small = town(5);
    const large = town(80);
    expect(rubbishTolerance(large)).toBeGreaterThan(rubbishTolerance(small));
  });
});

describe('the bins filling', () => {
  it('piles up with no depot at all', () => {
    const game = town();
    stepRubbish(game, 60);
    expect(game.rubbish).toBeCloseTo(rubbishPerMinute(game), 4);
  });

  it('stays empty when the depots keep up', () => {
    const game = town(4);
    depot(game, 1);
    expect(collectionPerMinute(game)).toBeGreaterThan(rubbishPerMinute(game));
    for (let m = 0; m < 20; m++) stepRubbish(game, 60);
    expect(game.rubbish).toBe(0);
  });

  it('never goes negative when the depots are idle', () => {
    const game = createGameState(hashSeed('rubbish'), 0);
    depot(game, 1);
    for (let m = 0; m < 20; m++) stepRubbish(game, 60);
    expect(game.rubbish).toBe(0);
  });

  it('is worked down again once a depot arrives', () => {
    const game = town();
    for (let m = 0; m < 10; m++) stepRubbish(game, 60);
    const piled = game.rubbish;
    expect(piled).toBeGreaterThan(0);
    for (let n = 1; n <= 4; n++) depot(game, n);
    for (let m = 0; m < 10; m++) stepRubbish(game, 60);
    expect(game.rubbish).toBeLessThan(piled);
  });

  it('only piles up while somebody is watching', () => {
    // The rule sim/offline.ts already states for fires: away time earns, it does
    // not destroy. Coming back to a city buried in its own rubbish is exactly the
    // punishment-for-being-away it refuses.
    const game = town();
    for (let m = 0; m < 30; m++) stepRubbish(game, 60, false);
    expect(game.rubbish).toBe(0);
  });

  it('still empties the bins while away, so a good city is not held back', () => {
    const game = town();
    for (let m = 0; m < 5; m++) stepRubbish(game, 60);
    expect(game.rubbish).toBeGreaterThan(0);
    for (let n = 1; n <= 6; n++) depot(game, n);
    for (let m = 0; m < 20; m++) stepRubbish(game, 60, false);
    expect(game.rubbish).toBe(0);
  });
});

describe('what a backlog costs', () => {
  it('costs nothing inside the tolerance', () => {
    const game = town();
    stepRubbish(game, 30);
    expect(rubbishStrain(game)).toBe(0);
    expect(rubbishHappiness(game)).toBe(0);
  });

  it('costs mood once it is past it', () => {
    const game = town();
    for (let m = 0; m < 30; m++) stepRubbish(game, 60);
    expect(rubbishStrain(game)).toBeGreaterThan(0);
    expect(rubbishHappiness(game)).toBeLessThan(0);
  });

  it('saturates rather than running away', () => {
    const game = town();
    game.rubbish = rubbishTolerance(game) * 10;
    const bad = rubbishHappiness(game);
    game.rubbish = rubbishTolerance(game) * 1_000;
    expect(rubbishHappiness(game)).toBe(bad);
    expect(rubbishStrain(game)).toBe(1);
  });

  it('announces the crossing once, in each direction', () => {
    const game = town();
    let piling: RubbishEvent[] = [];
    for (let m = 0; m < 30 && piling.length === 0; m++) {
      piling = [...stepRubbish(game, 60)];
    }
    expect(piling.map((e) => e.kind)).toEqual(['rubbishPiling']);
    // Reported once, not every step from then on.
    expect(stepRubbish(game, 60)).toEqual([]);

    for (let n = 1; n <= 8; n++) depot(game, n);
    let cleared: RubbishEvent[] = [];
    for (let m = 0; m < 60 && cleared.length === 0; m++) {
      cleared = [...stepRubbish(game, 60)];
    }
    expect(cleared.map((e) => e.kind)).toEqual(['rubbishCleared']);
  });
});

describe('rubbish is the cause the epidemic never had', () => {
  it('leaves the chance alone when the bins are empty', () => {
    expect(rubbishEpidemicFactor(town())).toBe(1);
  });

  it('raises it as the backlog grows, up to the ceiling in the table', () => {
    const game = town();
    game.rubbish = rubbishTolerance(game) * 100;
    expect(rubbishEpidemicFactor(game)).toBeCloseTo(RUBBISH_EPIDEMIC_MULT, 6);
  });

  it('actually reaches the outbreak roll', () => {
    // The whole point. A factor nothing reads is a number in a file.
    const clean = town(20);
    clean.population = EPIDEMIC_MIN_POP * 4;
    const filthy = town(20);
    filthy.population = EPIDEMIC_MIN_POP * 4;
    filthy.rubbish = rubbishTolerance(filthy) * 100;

    // A roll between the two chances: the filthy city catches it, the clean one
    // does not. Swept rather than pinned to a single value so the assertion does
    // not have to reproduce the rest of the multiplier stack.
    const between = 0.0006 * 1.5;
    stepHazards(clean, 1, () => between);
    stepHazards(filthy, 1, () => between);
    expect(clean.epidemic).toBeNull();
    expect(filthy.epidemic).not.toBeNull();
  });
});

describe('where the lorry does not go', () => {
  it('marks nothing when the city has no depot at all', () => {
    // Not this building's fault in particular, and a mark over every roof in the
    // city says nothing the backlog does not say better.
    const game = town(3);
    markUncollected(game);
    for (const building of game.buildings.values()) {
      expect(building.issues & ISSUE.noRubbish).toBe(0);
    }
  });

  it('marks the buildings a depot does not reach', () => {
    const game = town(3);
    depot(game, 1);
    const covered = [...game.buildings.values()][0]!;
    game.world.serviceMask[index(game.world, covered.x, covered.y)] = SERVICE.depot;
    markUncollected(game);

    expect(covered.issues & ISSUE.noRubbish).toBe(0);
    for (const building of game.buildings.values()) {
      if (building.id === covered.id) continue;
      expect(building.issues & ISSUE.noRubbish).not.toBe(0);
    }
  });

  it('clears the mark when a lorry starts coming', () => {
    const game = town(2);
    depot(game, 1);
    markUncollected(game);
    const building = [...game.buildings.values()][0]!;
    expect(building.issues & ISSUE.noRubbish).not.toBe(0);

    game.world.serviceMask[index(game.world, building.x, building.y)] = SERVICE.depot;
    markUncollected(game);
    expect(building.issues & ISSUE.noRubbish).toBe(0);
  });

  it('touches only its own bit', () => {
    // Every coverage pass owns one flag; a wholesale rebuild here would wipe the
    // water, the power and the services along with it.
    const game = town(2);
    depot(game, 1);
    const building = [...game.buildings.values()][0]!;
    building.issues = ISSUE.noWater | ISSUE.traffic;
    markUncollected(game);
    expect(building.issues & ISSUE.noWater).not.toBe(0);
    expect(building.issues & ISSUE.traffic).not.toBe(0);
  });
});
