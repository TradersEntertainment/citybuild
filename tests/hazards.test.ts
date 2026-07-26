import { describe, expect, it } from 'vitest';
import {
  EPIDEMIC_DURATION_S,
  EPIDEMIC_MIN_POP,
  FIRE_BURNOUT_S,
  FIRE_RESPONSE_S,
  FIRE_SPREAD_S,
} from '../src/data/balance';
import type { Building } from '../src/sim/buildings';
import { stepHazards, type HazardEvent } from '../src/sim/hazards';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { SERVICE } from '../src/sim/tiles';
import { index } from '../src/sim/world';

/**
 * The chaos systems (§13): fires that a brigade answers and fires that take the
 * street, outbreaks that a hospital blunts and outbreaks that empty homes.
 * Randomness is scripted, so every roll lands exactly where the test needs it.
 */

/** An rng that plays a script, then settles to a harmless high value. */
function scripted(values: number[], fallback = 0.99): () => number {
  let cursor = 0;
  return () => (cursor < values.length ? (values[cursor++] as number) : fallback);
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

function freshGame(era: GameState['era']): GameState {
  const game = createGameState(hashSeed('hazards'), 0);
  game.era = era;
  return game;
}

function kinds(events: readonly HazardEvent[]): string[] {
  return events.map((event) => event.kind);
}

describe('fire', () => {
  it('an unfought fire takes the building it started in', () => {
    const game = freshGame('village');
    const home = addBuilding(game, 40, 40, 'res', 6);
    const events: HazardEvent[] = [];

    // First roll ignites; everything after refuses spread and new fires.
    const rand = scripted([0]);
    events.push(...stepHazards(game, 1, rand));
    expect(game.fires.size).toBe(1);
    expect(home.population).toBe(0); // everyone out at the first alarm
    expect(kinds(events)).toContain('fireStart');

    for (let s = 0; s < FIRE_BURNOUT_S; s++) events.push(...stepHazards(game, 1, rand));
    expect(game.buildings.size).toBe(0);
    expect(game.fires.size).toBe(0);
    expect(kinds(events)).toContain('fireLost');
  });

  it('a covered fire is fought and out long before the house is lost', () => {
    const game = freshGame('village');
    const home = addBuilding(game, 40, 40, 'res', 6);
    game.world.serviceMask[index(game.world, 40, 40)] = SERVICE.fire;
    const events: HazardEvent[] = [];

    const rand = scripted([0]);
    events.push(...stepHazards(game, 1, rand));
    for (let s = 0; s < FIRE_RESPONSE_S + 2; s++) events.push(...stepHazards(game, 1, rand));

    expect(game.fires.size).toBe(0);
    expect(game.buildings.get(home.id)).toBe(home);
    expect(kinds(events)).toContain('fireOut');
    expect(kinds(events)).not.toContain('fireLost');
  });

  it('coverage also makes ignition far less likely in the first place', () => {
    const game = freshGame('village');
    addBuilding(game, 40, 40, 'res', 6);
    game.world.serviceMask[index(game.world, 40, 40)] = SERVICE.fire;

    // A roll that ignites an uncovered street (0.000015 < 0.00002) but not a
    // covered one (0.000015 > 0.00002 × 0.2).
    const rand = scripted([0.000015], 0.5);
    stepHazards(game, 1, rand);
    expect(game.fires.size).toBe(0);
  });

  it('an unfought fire spreads to the neighbours', () => {
    const game = freshGame('village');
    addBuilding(game, 40, 40, 'res', 6);
    addBuilding(game, 41, 40, 'res', 6);
    // Start the blaze directly, so the script only has to steer the spread
    // roll: below the spread chance, and pointing at the one neighbour.
    const fireId = game.nextFireId++;
    game.fires.set(fireId, {
      id: fireId,
      x: 40,
      y: 40,
      buildingId: 1,
      age: 0,
      covered: false,
      lastSpread: 0,
    });
    const events: HazardEvent[] = [];
    for (let s = 0; s < FIRE_SPREAD_S; s++) events.push(...stepHazards(game, 1, scripted([], 0.1)));

    expect(game.fires.size).toBe(2);
    expect(kinds(events).filter((kind) => kind === 'fireStart')).toHaveLength(1);
  });

  it('a city with three fires at once is reported as burning', () => {
    const game = freshGame('village');
    addBuilding(game, 40, 40, 'res', 6);
    addBuilding(game, 50, 40, 'res', 6);
    addBuilding(game, 60, 40, 'res', 6);
    // Ignition roll of 0 hits all three in one pass.
    const events = stepHazards(game, 1, scripted([0, 0, 0]));
    expect(game.fires.size).toBe(3);
    expect(kinds(events)).toContain('fireRaging');
  });
});

describe('epidemic', () => {
  /** A town big enough to fall ill, homes full. */
  function plagueTown(covered: boolean): GameState {
    const game = freshGame('founding');
    let residents = 0;
    for (let i = 0; i < 10 && residents < EPIDEMIC_MIN_POP + 20; i++) {
      const home = addBuilding(game, 30 + i * 2, 40, 'res', 14);
      residents += home.population;
      if (covered) game.world.serviceMask[index(game.world, 30 + i * 2, 40)] = SERVICE.health;
    }
    game.population = residents;
    return game;
  }

  it('an uncovered outbreak empties homes and is reported as a catastrophe', () => {
    const game = plagueTown(false);
    const events: HazardEvent[] = [];
    const rand = scripted([0]); // outbreak starts at once

    events.push(...stepHazards(game, 1, rand));
    expect(game.epidemic).not.toBeNull();
    expect(kinds(events)).toContain('epidemicStart');

    const before = game.population;
    for (let s = 0; s < EPIDEMIC_DURATION_S + 5; s++) events.push(...stepHazards(game, 1, rand));

    expect(game.epidemic).toBeNull();
    expect(game.population).toBeLessThan(before * 0.9);
    expect(kinds(events)).toContain('epidemicEndSevere');
  });

  it('a hospital-covered town barely notices the same outbreak', () => {
    const game = plagueTown(true);
    const rand = scripted([0]);
    stepHazards(game, 1, rand);
    expect(game.epidemic?.severity).toBeLessThan(0.3);

    const before = game.population;
    for (let s = 0; s < EPIDEMIC_DURATION_S + 5; s++) stepHazards(game, 1, rand);

    expect(game.population).toBeGreaterThan(before * 0.97);
  });

  it('spares a settlement too small to spread anything', () => {
    const game = freshGame('founding');
    addBuilding(game, 40, 40, 'res', 10);
    game.population = 10;
    stepHazards(game, 1, scripted([0]));
    expect(game.epidemic).toBeNull();
  });

  it('drags the city’s mood down while it runs', () => {
    const game = plagueTown(false);
    game.happiness = 70;
    stepHazards(game, 1, scripted([0]));

    const systems = new Systems(game.world.size);
    for (let s = 0; s < 60; s++) systems.step(game, 1);
    expect(game.happiness).toBeLessThan(62);
  });
});

describe('away time', () => {
  it('stays calm: hazards never strike while nobody is watching', () => {
    const game = freshGame('city');
    for (let i = 0; i < 60; i++) addBuilding(game, 20 + i, 40, 'res', 8);
    game.population = 480;

    const systems = new Systems(game.world.size);
    // Hours of city time in one step: with hazards live a blaze is a near
    // certainty somewhere in sixty buildings; with them off, impossible.
    systems.step(game, 3600, false);
    expect(game.fires.size).toBe(0);
    expect(game.epidemic).toBeNull();
    expect(systems.drainHazardEvents()).toHaveLength(0);
  });
});
