import { describe, expect, it } from 'vitest';
import { STARTING_MONEY } from '../src/data/balance';
import { ROAD_SPECS } from '../src/data/roads';
import { computeLedger, roadUpkeep } from '../src/sim/economy';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeRoadDistance, createFields } from '../src/sim/fields';
import {
  highwayInterchanges,
  isNationalHighway,
  layNationalHighway,
  ownedHighwayTiles,
  transitFlow,
  transitIncome,
} from '../src/sim/highway';
import { HIGHWAY_MIN_RUN } from '../src/data/balance';
import { hashSeed } from '../src/sim/rng';
import { buildRoad, removeRoad, tileCost } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { decodeRoad, NONE } from '../src/sim/tiles';
import { createWorld, index, startingCentre, type World } from '../src/sim/world';
import { generateTerrain } from '../src/sim/worldgen';

/**
 * The national highway is the one road the player does not draw, and every
 * rule that treats the player's own pavement one way has to treat the state's
 * motorway the other. These pin the whole contract: it exists, it is the same
 * on every load, it crosses the player's area, and the usual verbs bounce off
 * it.
 */
function worldOf(seed: string): World {
  const world = createWorld(hashSeed(seed));
  generateTerrain(world);
  layNationalHighway(world);
  return world;
}

/** Draws a player street that touches the motorway. */
function connectCity(game: GameState): void {
  const route = game.world.highwayRoute;
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
      const result = buildRoad(game.world, [b, a], 'path', STARTING_MONEY);
      if (result.changes.length > 0) return;
    }
  }
  throw new Error('could not connect the city to the motorway');
}

/** A clear horizontal run of non-motorway tiles near the starting centre. */
function clearRow(game: GameState, length: number): { x: number; y: number }[] {
  const centre = startingCentre(game.world);
  const cy = Math.floor(centre.y);
  const cx = Math.floor(centre.x);
  for (let y = cy - 20; y <= cy + 20; y++) {
    const run: { x: number; y: number }[] = [];
    for (let x = cx - 20; x <= cx + 20; x++) {
      if (isNationalHighway(game.world, x, y)) {
        run.length = 0;
        continue;
      }
      run.push({ x, y });
      if (run.length === length) return run;
    }
  }
  throw new Error('no clear row near the starting centre');
}

describe('the route itself', () => {
  it('crosses the map from edge to edge', () => {
    for (const seed of ['alpha', 'beta', 'gamma', 'delta']) {
      const world = worldOf(seed);
      const route = world.highwayRoute;
      expect(route.length).toBeGreaterThan(world.size * 0.8);
      const first = route[0] as { x: number; y: number };
      const last = route[route.length - 1] as { x: number; y: number };
      const span = Math.max(Math.abs(last.x - first.x), Math.abs(last.y - first.y));
      expect(span).toBeGreaterThan(world.size * 0.85);
    }
  });

  it('is deterministic in the seed', () => {
    const a = worldOf('same-seed');
    const b = worldOf('same-seed');
    expect(a.highwayRoute).toEqual(b.highwayRoute);
    expect(a.highway).toEqual(b.highway);
    expect(a.road).toEqual(b.road);
  });

  it('differs between seeds', () => {
    const a = worldOf('one-seed');
    const b = worldOf('another-seed');
    expect(a.highwayRoute).not.toEqual(b.highwayRoute);
  });

  it('passes through the starting parcel — the player’s area', () => {
    for (const seed of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      const world = worldOf(seed);
      const centre = startingCentre(world);
      let near = 0;
      for (const point of world.highwayRoute) {
        if (Math.abs(point.x - centre.x) <= 24 && Math.abs(point.y - centre.y) <= 24) near++;
      }
      expect(near).toBeGreaterThan(10);
    }
  });

  it('is 4-connected, so the traffic spread can walk it', () => {
    const world = worldOf('connected');
    const route = world.highwayRoute;
    for (let i = 1; i < route.length; i++) {
      const prev = route[i - 1] as { x: number; y: number };
      const here = route[i] as { x: number; y: number };
      const manhattan = Math.abs(here.x - prev.x) + Math.abs(here.y - prev.y);
      expect(manhattan).toBe(1);
    }
  });

  it('stamps highway tiles into the road column and the mask together', () => {
    const world = worldOf('stamped');
    let stamped = 0;
    for (let i = 0; i < world.road.length; i++) {
      if ((world.highway[i] ?? 0) !== 1) continue;
      stamped++;
      expect(decodeRoad(world.road[i] ?? NONE)).toBe('highway');
    }
    expect(stamped).toBe(world.highwayRoute.length);
  });
});

describe('the rules it lives under', () => {
  it('cannot be drawn over, upgraded or paid for', () => {
    const game = createGameState(hashSeed('rules'), 0);
    const point = game.world.highwayRoute[Math.floor(game.world.highwayRoute.length / 2)];
    expect(point).toBeDefined();
    if (!point) return;
    const cost = tileCost(game.world, point.x, point.y, 'path');
    expect(cost.blocked).toBe(true);
  });

  it('cannot be demolished', () => {
    const game = createGameState(hashSeed('rules-2'), 0);
    const point = game.world.highwayRoute[10];
    if (!point) throw new Error('no route');
    const before = game.world.road[index(game.world, point.x, point.y)];
    removeRoad(game.world, [{ x: point.x, y: point.y }]);
    expect(game.world.road[index(game.world, point.x, point.y)]).toBe(before);
  });

  it('costs the city no upkeep — the state maintains its own motorway', () => {
    const game = createGameState(hashSeed('rules-3'), 0);
    expect(roadUpkeep(game)).toBe(0);
    const row = clearRow(game, 6);
    expect(row).toHaveLength(6);
    buildRoad(game.world, row, 'path', STARTING_MONEY);
    expect(roadUpkeep(game)).toBeCloseTo(ROAD_SPECS.path.upkeep * 6, 6);
  });

  it('does not grant road access on its own', () => {
    const game = createGameState(hashSeed('rules-4'), 0);
    const fields = createFields(game.world.size);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    const point = game.world.highwayRoute[30];
    if (!point) throw new Error('no route');
    // The motorway tile itself is never an access source: standing beside it
    // is standing beside a fence, not beside a street.
    expect(fields.roadDistance[index(game.world, point.x, point.y)]).not.toBe(0);
  });
});

describe('the corridor economy', () => {
  it('sees an interchange only where a player road touches the motorway', () => {
    const game = createGameState(hashSeed('junction'), 0);
    expect(highwayInterchanges(game.world)).toBe(0);
    connectCity(game);
    expect(highwayInterchanges(game.world)).toBeGreaterThan(0);
  });

  it('pays nothing with no interchange, however much land the road crosses', () => {
    const game = createGameState(hashSeed('no-junction'), 0);
    game.population = 5_000;
    expect(ownedHighwayTiles(game.world)).toBeGreaterThan(0);
    expect(transitIncome(game)).toBe(0);
  });

  it('pays once connected, and more with more through-traffic', () => {
    const game = createGameState(hashSeed('connected-city'), 0);
    connectCity(game);

    game.population = 0;
    const quiet = transitIncome(game);
    game.population = 40_000;
    const busy = transitIncome(game);
    expect(quiet).toBeGreaterThan(0);
    expect(busy).toBeGreaterThan(quiet);
  });

  it('feeds transit income into the ledger', () => {
    const game = createGameState(hashSeed('ledger'), 0);
    connectCity(game);
    const fields = createFields(game.world.size);
    const ledger = computeLedger(game, fields);
    expect(ledger.transitIncome).toBeGreaterThan(0);
    expect(ledger.net).toBeCloseTo(
      ledger.taxIncome +
        ledger.farmIncome +
        ledger.transitIncome -
        ledger.roadUpkeep -
        ledger.serviceUpkeep -
        ledger.utilityUpkeep -
        ledger.debtService,
      6,
    );
  });

  it('grows flow with population but never past the cap', () => {
    const game = createGameState(hashSeed('flow'), 0);
    game.population = 0;
    const floor = transitFlow(game);
    expect(floor).toBeGreaterThan(0);
    game.population = 10_000_000;
    expect(transitFlow(game)).toBeLessThanOrEqual(320);
  });

  it('spots the motorway wherever it runs', () => {
    const game = createGameState(hashSeed('spotting'), 0);
    const point = game.world.highwayRoute[5];
    if (!point) throw new Error('no route');
    expect(isNationalHighway(game.world, point.x, point.y)).toBe(true);
    expect(isNationalHighway(game.world, 1, 1)).toBe(false);
  });
});

/**
 * The shape of the line.
 *
 * The route is a 4-connected staircase by necessity — the connectivity BFS, the
 * load spread and the trip injection all read the grid four ways — so every
 * change of direction is a one-tile jog, and how often those come is exactly how
 * much the traffic weaves. It used to jog every 2.3 tiles with half its runs a
 * single tile long, which no amount of spline smoothing on the vehicles could
 * hide: the control points were the zigzag.
 *
 * These are the guardrails on the fix. They are deliberately statistical rather
 * than exact, because the generator is allowed to change its mind about *where*
 * the road goes; what it is not allowed to do is go back to stairs.
 */
describe('how straight the motorway runs', () => {
  /** Direction changes per hundred tiles of route, averaged over many maps. */
  function turnRate(seeds: number): number {
    let turns = 0;
    let tiles = 0;
    for (let s = 0; s < seeds; s++) {
      const world = worldOf(`shape-${s}`);
      const route = world.highwayRoute;
      let lastDx = 0;
      let lastDy = 0;
      for (let i = 1; i < route.length; i++) {
        const dx = (route[i] as HighwayLike).x - (route[i - 1] as HighwayLike).x;
        const dy = (route[i] as HighwayLike).y - (route[i - 1] as HighwayLike).y;
        if (i > 1 && (dx !== lastDx || dy !== lastDy)) turns++;
        lastDx = dx;
        lastDy = dy;
      }
      turns += 0;
      tiles += route.length;
    }
    return (turns / tiles) * 100;
  }

  it('bends far less often than one jog every few tiles', () => {
    // The old generator sat at 39–71 turns per hundred tiles. A jog roughly
    // every HIGHWAY_MIN_RUN tiles is two turns (out and back), so the ceiling is
    // about 200/MIN_RUN with a margin for the elbows.
    const rate = turnRate(30);
    expect(rate).toBeLessThan((200 / HIGHWAY_MIN_RUN) * 1.1);
    expect(rate).toBeLessThan(25);
  });

  it('still crosses the player’s own parcel on every map', () => {
    // The whole reason the line is steered at all. A straighter road must not
    // have bought its straightness by wandering off.
    for (let s = 0; s < 40; s++) {
      const world = worldOf(`parcel-${s}`);
      const crosses = world.highwayRoute.some(
        (p) => p.x >= 144 && p.x <= 191 && p.y >= 144 && p.y <= 191,
      );
      expect(crosses).toBe(true);
    }
  });

  it('stays 4-connected, which every grid rule depends on', () => {
    for (let s = 0; s < 20; s++) {
      const route = worldOf(`connected-${s}`).highwayRoute;
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1] as HighwayLike;
        const b = route[i] as HighwayLike;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
      }
    }
  });

  it('reaches both edges of the map', () => {
    for (let s = 0; s < 20; s++) {
      const route = worldOf(`edges-${s}`).highwayRoute;
      const first = route[0] as HighwayLike;
      const last = route[route.length - 1] as HighwayLike;
      const nearEdge = (p: HighwayLike): boolean =>
        p.x <= 7 || p.y <= 7 || p.x >= 248 || p.y >= 248;
      expect(nearEdge(first)).toBe(true);
      expect(nearEdge(last)).toBe(true);
    }
  });
});

interface HighwayLike {
  x: number;
  y: number;
}
