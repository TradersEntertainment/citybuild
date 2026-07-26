import { describe, expect, it } from 'vitest';
import { SECONDS_PER_YEAR, START_YEAR, TIMELINE } from '../src/data/timeline';
import type { Building } from '../src/sim/buildings';
import { refreshPopulation } from '../src/sim/hazards';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import {
  computeTimelineEffects,
  stepTimeline,
  yearOf,
} from '../src/sim/timeline';
import { index } from '../src/sim/world';

/**
 * The stepped history (§14): dated events every city meets, effects that run
 * for their span and stop, and two disasters that reuse the chaos machinery.
 * In these tests the test itself advances the clock — `playedMs` is the
 * calendar, `stepTimeline` only reads it.
 */

/** Milliseconds of played time at the turn of `year`. */
function ms(year: number): number {
  return (year - START_YEAR) * SECONDS_PER_YEAR * 1000;
}

function freshGame(): GameState {
  return createGameState(hashSeed('timeline'), 0);
}

function addBuilding(
  game: GameState,
  x: number,
  y: number,
  zone: 'res' | 'com' | 'ind',
  population = 0,
): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone,
    level: 1,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population,
    jobs: zone === 'res' ? 0 : 4,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  return building;
}

describe('the calendar', () => {
  it('counts years from the founding in 1900', () => {
    expect(yearOf(0)).toBe(1900);
    expect(yearOf(ms(1901) - 1)).toBe(1900);
    expect(yearOf(ms(1901))).toBe(1901);
    expect(yearOf(ms(2050))).toBe(2050);
  });

  it('the history book is dated in order and spans do not lie', () => {
    for (let i = 1; i < TIMELINE.length; i++) {
      expect(TIMELINE[i]!.year).toBeGreaterThanOrEqual(TIMELINE[i - 1]!.year);
    }
    for (const event of TIMELINE) {
      if (event.durationYears !== undefined) {
        expect(event.durationYears).toBeGreaterThan(0);
        expect(event.effects).toBeDefined();
      }
    }
    expect(TIMELINE.some((e) => e.id === 'great-war' && e.year === 1914)).toBe(true);
    expect(TIMELINE.some((e) => e.id === 'flying-cars' && e.year === 2050)).toBe(true);
    expect(TIMELINE.some((e) => e.id === 'orbital-shuttle' && e.year === 2065)).toBe(true);
  });

  it('a city that appears mid-century joins history quietly', () => {
    const game = freshGame();
    game.playedMs = ms(1967);
    const fired = stepTimeline(game, 1);
    expect(fired).toEqual([]);
    expect(game.lastYear).toBe(1967);
  });

  it('crossing into 1914 fires the mobilisation', () => {
    const game = freshGame();
    game.playedMs = ms(1914) - 1000;
    game.lastYear = yearOf(game.playedMs);
    expect(game.lastYear).toBe(1913);

    game.playedMs = ms(1914) + 1000;
    const fired = stepTimeline(game, 2);
    expect(fired.map((f) => f.event.id)).toContain('great-war');
    expect(game.timelineEffects.draftDrainPerSec).toBeGreaterThan(0);
    expect(game.timelineEffects.migrationMult).toBeLessThan(1);
  });
});

describe('the war years', () => {
  it('the draft takes its share while the war runs, then lets go', () => {
    const game = freshGame();
    for (let i = 0; i < 10; i++) addBuilding(game, 30 + i, 30, 'res', 10);
    refreshPopulation(game);
    expect(game.population).toBe(100);

    game.lastYear = 1914;
    game.playedMs = ms(1915);
    for (let s = 0; s < 100; s++) {
      game.playedMs += 1000;
      stepTimeline(game, 1);
    }
    // ~6 of every 100 conscripted per year; a hundred steps must bite.
    expect(game.population).toBeLessThan(100);
    expect(game.population).toBeLessThan(95);

    // Jump past the armistice: the drain stops and the homecoming lifts the road.
    game.playedMs = ms(1919);
    stepTimeline(game, 1);
    expect(game.timelineEffects.draftDrainPerSec).toBe(0);
    expect(game.timelineEffects.migrationMult).toBeGreaterThan(1);
  });
});

describe('the economy of the century', () => {
  it('the depression squeezes income and the postwar boom lifts it', () => {
    expect(computeTimelineEffects(1900).incomeMult).toBe(1);
    expect(computeTimelineEffects(1931).incomeMult).toBeLessThan(0.7);
    expect(computeTimelineEffects(1949).incomeMult).toBeGreaterThan(1.2);
  });
});

describe('the dated disasters', () => {
  it('1918 brings the flu whether the town is ready or not', () => {
    const game = freshGame();
    for (let i = 0; i < 6; i++) addBuilding(game, 30 + i, 30, 'res', 10);
    refreshPopulation(game);

    game.lastYear = 1917;
    game.playedMs = ms(1918) + 1000;
    const fired = stepTimeline(game, 2);
    expect(fired.map((f) => f.event.id)).toContain('spanish-flu');
    expect(game.epidemic).not.toBeNull();
  });

  it('the 1999 earthquake takes the same buildings on every device', () => {
    const build = (): GameState => {
      const game = freshGame();
      for (let i = 0; i < 40; i++) {
        addBuilding(game, 20 + (i % 10), 20 + Math.floor(i / 10), 'res', 2);
      }
      refreshPopulation(game);
      game.lastYear = 1998;
      game.playedMs = ms(1999) + 1000;
      stepTimeline(game, 2);
      return game;
    };

    const a = build();
    const b = build();
    const idsA = [...a.buildings.keys()].sort((x, y) => x - y);
    const idsB = [...b.buildings.keys()].sort((x, y) => x - y);
    expect(idsA).toEqual(idsB);
    // The fault took its deterministic quota: min(12, ceil(40 * 0.08)) = 4.
    expect(a.buildings.size).toBe(36);
  });
});
