import { describe, expect, it } from 'vitest';
import { STARTING_MONEY, VISITOR_REACH, VISITOR_SPEND } from '../src/data/balance';
import type { Building } from '../src/sim/buildings';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeLedger } from '../src/sim/economy';
import { computeRoadDistance, createFields, type Fields } from '../src/sim/fields';
import { isNationalHighway } from '../src/sim/highway';
import { ensureSections, refreshHighwayDamage } from '../src/sim/highwayWear';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { computeTraffic, createTrafficField, type TrafficField } from '../src/sim/traffic';
import { encodeRoad } from '../src/sim/tiles';
import {
  computeVisitors,
  createVisitorField,
  visitorFactor,
  visitorsArriving,
  visitorsWanting,
  type VisitorField,
} from '../src/sim/visitors';
import { index, type World } from '../src/sim/world';

/**
 * The country's traffic, coming into the city.
 *
 * The corridor used to pay an abstract toll over how much of the route the city
 * owned. That could not be played: the money did not come from anywhere a player
 * could see, route, or lose. Now it comes off at a junction and flows in along
 * their own streets. These pin the four levers that gives them — where the
 * junction is, what the road out of it is, how far the shops are, and whether
 * there are shops at all — and the one thing that takes it away, which is a jam.
 */

interface Scene {
  game: GameState;
  fields: Fields;
  traffic: TrafficField;
  visitors: VisitorField;
  /** The player road touching the motorway. */
  gate: { x: number; y: number };
}

/** A flat map, a straight motorway across it, and a street joined to it. */
function scene(streetLength = 24, tier: 'path' | 'asphalt' | 'boulevard' = 'asphalt'): Scene {
  const game = createGameState(hashSeed('visitors'), 0);
  const world = game.world;
  for (let i = 0; i < world.height.length; i++) {
    world.height[i] = 0.6;
    world.terrain[i] = 2;
    world.road[i] = 0;
  }
  world.highway.fill(0);
  world.highwayRoute = [];

  // A motorway straight down x = 150, and the city's street running east off it.
  const gy = 168;
  for (let y = 100; y < 240; y++) {
    const i = index(world, 150, y);
    world.highway[i] = 1;
    world.road[i] = encodeRoad('highway');
    world.highwayRoute.push({ x: 150, y });
  }
  for (let n = 1; n <= streetLength; n++) {
    world.road[index(world, 150 + n, gy)] = encodeRoad(tier);
  }
  ensureSections(game);
  refreshHighwayDamage(game);

  const fields = createFields(world.size);
  const traffic = createTrafficField(world.size);
  const visitors = createVisitorField(world.size);
  return { game, fields, traffic, visitors, gate: { x: 151, y: gy } };
}

/** Adds a shop, wired into the tile index the way the growth loop would. */
function addShop(game: GameState, x: number, y: number, jobs: number): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone: 'com',
    level: 2,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: 0,
    jobs,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  game.world.zone[index(game.world, x, y)] = 2;
  return building;
}

/** Runs the derived passes in the order the systems do. */
function settle(s: Scene, shopJobs: number): void {
  computeConnectivity(s.game.world);
  computeRoadDistance(s.game.world, s.fields.roadDistance);
  computeTraffic(s.game, s.fields, s.traffic);
  computeVisitors(s.game, s.visitors, s.traffic.load, shopJobs);
}

describe('how many come off the motorway', () => {
  it('nobody, with no junction', () => {
    const s = scene();
    // Wipe the street, so the motorway runs past a city it does not touch.
    for (let n = 1; n <= 24; n++) s.game.world.road[index(s.game.world, 150 + n, 168)] = 0;
    s.game.population = 5_000;
    settle(s, 400);
    expect(visitorsWanting(s.game, 400)).toBe(0);
    expect(visitorsArriving(s.visitors, s.game.world)).toBe(0);
  });

  it('nobody, with a junction and nothing to buy', () => {
    const s = scene();
    s.game.population = 5_000;
    settle(s, 0);
    // The traffic is there and the junction is there; there is simply no reason
    // to pull off, which is the whole point of the shops term.
    expect(visitorsWanting(s.game, 0)).toBe(0);
  });

  it('more as the city gets bigger, and less than proportionally more', () => {
    const s = scene();
    s.game.population = 400;
    const town = visitorsWanting(s.game, 200);
    s.game.population = 40_000;
    const city = visitorsWanting(s.game, 200);
    expect(town).toBeGreaterThan(0);
    expect(city).toBeGreaterThan(town);
    expect(city).toBeLessThan(town * 10);
  });

  it('saturates in shops, so the hundredth parade adds little', () => {
    const s = scene();
    s.game.population = 20_000;
    const few = visitorsWanting(s.game, 100);
    const many = visitorsWanting(s.game, 1_000);
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThan(few * 3);
  });
});

describe('where they get to', () => {
  it('arrives at the junction and thins going in', () => {
    const s = scene(24);
    s.game.population = 8_000;
    settle(s, 300);

    const at = (n: number) => s.visitors.flow[index(s.game.world, 150 + n, 168)] ?? 0;
    expect(at(1)).toBeGreaterThan(0);
    // Strictly falling along the street: this is the gradient the whole mechanic
    // is made of, and without it the player has nothing to aim at.
    for (let n = 1; n < 12; n++) expect(at(n + 1)).toBeLessThan(at(n));
    expect(at(12)).toBeLessThan(at(1) * 0.5);
  });

  it('stops after its stated reach', () => {
    const s = scene(60);
    s.game.population = 8_000;
    settle(s, 300);
    const far = s.visitors.flow[index(s.game.world, 150 + VISITOR_REACH + 8, 168)] ?? 0;
    expect(far).toBe(0);
  });

  it('never puts visitors on the motorway itself', () => {
    const s = scene();
    s.game.population = 8_000;
    settle(s, 300);
    for (const point of s.game.world.highwayRoute) {
      expect(s.visitors.flow[index(s.game.world, point.x, point.y)] ?? 0).toBe(0);
    }
  });

  it('brings nobody in through a barricaded stretch', () => {
    const s = scene();
    s.game.population = 8_000;
    s.game.highwayWear.fill(1);
    refreshHighwayDamage(s.game);
    settle(s, 300);
    // The road out of the city is shut, so the country cannot get to it — and
    // the toll it used to pay regardless is gone with it.
    expect(visitorsArriving(s.visitors, s.game.world)).toBe(0);
  });
});

describe('what a shop makes of it', () => {
  it('lifts a shop on the street the visitors use', () => {
    const s = scene();
    s.game.population = 8_000;
    addShop(s.game, 152, 169, 30);
    settle(s, 300);
    const near = visitorFactor(s.game.world, s.fields, s.visitors, 152, 169);
    expect(near).toBeGreaterThan(1);
    expect(near).toBeLessThanOrEqual(1 + VISITOR_SPEND);
  });

  it('lifts a shop by the junction more than one at the far end', () => {
    const s = scene(24);
    s.game.population = 8_000;
    addShop(s.game, 152, 169, 30);
    addShop(s.game, 170, 169, 30);
    settle(s, 300);
    const near = visitorFactor(s.game.world, s.fields, s.visitors, 152, 169);
    const far = visitorFactor(s.game.world, s.fields, s.visitors, 170, 169);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(1);
  });

  it('leaves a shop nowhere near the corridor alone', () => {
    const s = scene();
    s.game.population = 8_000;
    addShop(s.game, 60, 60, 30);
    s.game.world.road[index(s.game.world, 60, 61)] = encodeRoad('asphalt');
    settle(s, 300);
    expect(visitorFactor(s.game.world, s.fields, s.visitors, 60, 60)).toBe(1);
  });

  it('reaches the ledger as its own line', () => {
    const s = scene();
    s.game.population = 8_000;
    addShop(s.game, 152, 169, 40);
    settle(s, 300);

    const withVisitors = computeLedger(s.game, s.fields, s.visitors);
    expect(withVisitors.visitorIncome).toBeGreaterThan(0);
    // And the line is a slice of the tax take, not money invented beside it.
    expect(withVisitors.visitorIncome).toBeLessThan(withVisitors.taxIncome);
  });
});

describe('what a jam costs', () => {
  it('turns visitors back where the street is over capacity', () => {
    const clear = scene(24, 'boulevard');
    const narrow = scene(24, 'path');
    for (const s of [clear, narrow]) {
      s.game.population = 30_000;
      // A wall of homes and shops on the one street, so it is genuinely loaded.
      for (let n = 2; n <= 20; n++) {
        addShop(s.game, 150 + n, 169, 40);
        addShop(s.game, 150 + n, 167, 40);
      }
      settle(s, 900);
    }

    const at = (s: Scene, n: number) => s.visitors.flow[index(s.game.world, 150 + n, 168)] ?? 0;
    // Same city, same shops, same junction: the only difference is what the
    // street can carry, which is the fix the game is about.
    expect(at(clear, 10)).toBeGreaterThan(at(narrow, 10));
  });
});

describe('the corridor a player can afford', () => {
  it('works on a real map with a road drawn by the ordinary verb', () => {
    // Not the synthetic fixture: a generated map, and a street built through
    // buildRoad the way a finger would build it.
    const game = createGameState(hashSeed('visitors-real'), 0);
    const route = game.world.highwayRoute;
    let gate: { x: number; y: number } | null = null;
    for (const point of route) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const a = { x: point.x + dx, y: point.y + dy };
        const b = { x: point.x + 2 * dx, y: point.y + 2 * dy };
        if (isNationalHighway(game.world, a.x, a.y)) continue;
        if (isNationalHighway(game.world, b.x, b.y)) continue;
        if (buildRoad(game.world, [b, a], 'path', STARTING_MONEY).changes.length === 0) continue;
        gate = a;
        break;
      }
      if (gate) break;
    }
    expect(gate).not.toBeNull();

    const fields = createFields(game.world.size);
    const traffic = createTrafficField(game.world.size);
    const visitors = createVisitorField(game.world.size);
    game.population = 6_000;
    computeConnectivity(game.world);
    computeRoadDistance(game.world, fields.roadDistance);
    computeTraffic(game, fields, traffic);
    computeVisitors(game, visitors, traffic.load, 300);

    expect(visitorsArriving(visitors, game.world)).toBeGreaterThan(0);
  });
});

/** Kept honest: the fixture's assumptions about the map have not drifted. */
describe('the fixture', () => {
  it('really does put a player road against the motorway', () => {
    const s = scene();
    expect(isNationalHighway(s.game.world, 150, 168)).toBe(true);
    expect(isNationalHighway(s.game.world, s.gate.x, s.gate.y)).toBe(false);
    expect(roadAt(s.game.world, s.gate.x, s.gate.y)).toBe(true);
  });
});

function roadAt(world: World, x: number, y: number): boolean {
  return (world.road[index(world, x, y)] ?? 0) !== 0;
}
