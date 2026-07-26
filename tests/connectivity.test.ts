import { describe, expect, it } from 'vitest';
import { BUILDING_SPAWN_THRESHOLD } from '../src/data/balance';
import type { TilePoint } from '../src/input/pathGeometry';
import { suitability } from '../src/sim/buildings';
import {
  computeConnectivity,
  connectedRoadTiles,
  hasConnection,
} from '../src/sim/connectivity';
import { computeLandValue, computeRoadDistance, createFields, UNREACHABLE } from '../src/sim/fields';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE } from '../src/sim/tiles';
import { index, isTileOwned, startingCentre, type World } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * The rule the whole game now answers to (§6.1): the national highway is the
 * only way in from the rest of the country, so a street that cannot reach it
 * grows nothing, houses nobody and is worth exactly the ink it is drawn with.
 */

function stripHighway(world: World): void {
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.fertility[i] = 0.3;
      state.world.terrain[i] = 2; // plain
    }
  }
}

/** A highway tile inside the starting parcel — the route always crosses it. */
function highwayTileNearHome(world: World): { x: number; y: number } {
  for (const point of world.highwayRoute) {
    if (point.x < 6 || point.x >= world.size - 6) continue;
    if (point.y < 6 || point.y >= world.size - 6) continue;
    // Roads can only be drawn on land the player owns, so the junction has to
    // be the stretch through the starting parcel, not the map's edge.
    if (!isTileOwned(world, point.x, point.y)) continue;
    return point;
  }
  throw new Error('no highway tile found');
}

/** A stretch of the starting parcel the motorway does not come near. */
function quietCorner(world: World): { x: number; y: number } {
  const centre = startingCentre(world);
  const cx = Math.floor(centre.x);
  const cy = Math.floor(centre.y);
  outer: for (let y = cy - 20; y <= cy + 20; y++) {
    for (let x = cx - 20; x <= cx + 20 - 8; x++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 10; dx++) {
          if ((world.highway[index(world, x + dx, y + dy)] ?? 0) === 1) continue outer;
        }
      }
      return { x, y };
    }
  }
  throw new Error('no quiet corner found');
}

function freshGame(): GameState {
  const game = createGameState(hashSeed('connectivity'), 0);
  const centre = startingCentre(game.world);
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 30);
  return game;
}

describe('streets that lead nowhere', () => {
  it('marks a road away from the highway as disconnected, and access starts only once joined', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    const highway = highwayTileNearHome(game.world);

    // A stub ending one tile short of the motorway: drawn, but leading nowhere.
    const stub: TilePoint[] = [3, 4, 5].map((d) => ({ x: highway.x - d, y: highway.y }));
    buildRoad(game.world, stub, 'path', 100_000);
    computeConnectivity(game.world);
    computeRoadDistance(game.world, fields.roadDistance);

    expect(hasConnection(game.world)).toBe(false);
    expect(connectedRoadTiles(game.world)).toBe(0);
    expect(fields.roadDistance[index(game.world, highway.x - 3, highway.y)]).toBe(UNREACHABLE);

    // Extend the same street the last tiles into the motorway's shoulder.
    buildRoad(game.world, [{ x: highway.x - 2, y: highway.y }, { x: highway.x - 1, y: highway.y }], 'path', 100_000);
    computeConnectivity(game.world);
    computeRoadDistance(game.world, fields.roadDistance);

    expect(hasConnection(game.world)).toBe(true);
    expect(connectedRoadTiles(game.world)).toBe(5);
    expect(fields.roadDistance[index(game.world, highway.x - 3, highway.y)]).toBe(0);
  });

  it('cuts the whole street off again when the link to the highway is demolished', () => {
    const game = freshGame();
    const highway = highwayTileNearHome(game.world);
    const row: TilePoint[] = [1, 2, 3, 4, 5].map((d) => ({ x: highway.x - d, y: highway.y }));
    buildRoad(game.world, row, 'path', 100_000);
    computeConnectivity(game.world);
    expect(connectedRoadTiles(game.world)).toBe(5);

    game.world.road[index(game.world, highway.x - 1, highway.y)] = NONE;
    computeConnectivity(game.world);
    expect(connectedRoadTiles(game.world)).toBe(0);
  });

  it('grows nothing beside a disconnected street, and builds beside the same street once it is wired in', () => {
    const game = freshGame();
    const systems = new Systems(game.world.size);
    const corner = quietCorner(game.world);
    const highway = highwayTileNearHome(game.world);

    // Housing along a lane that never meets the motorway.
    const lane: TilePoint[] = Array.from({ length: 8 }, (_, i) => ({ x: corner.x + i, y: corner.y }));
    buildRoad(game.world, lane, 'path', 100_000);
    paintZone(game.world, lane.map((p) => ({ x: p.x, y: p.y + 1 })), 'res', 100_000);
    game.demand.res = 1;

    for (let s = 0; s < 60; s++) systems.step(game, 1);
    expect(game.buildings.size).toBe(0);

    // The same evaluation beside a street that does reach the country.
    const joined: TilePoint[] = [1, 2, 3, 4, 5, 6].map((d) => ({ x: highway.x - d, y: highway.y }));
    buildRoad(game.world, joined, 'path', 100_000);
    paintZone(game.world, joined.map((p) => ({ x: p.x, y: p.y + 1 })), 'res', 100_000);
    systems.invalidateFields();

    let built = false;
    for (let s = 0; s < 90 && !built; s++) {
      systems.step(game, 1);
      built = game.buildings.size > 0;
    }
    expect(built).toBe(true);
  });

  it('scores a plot beside a disconnected street at zero, whatever the demand', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    const corner = quietCorner(game.world);
    const lane: TilePoint[] = Array.from({ length: 8 }, (_, i) => ({ x: corner.x + i, y: corner.y }));
    buildRoad(game.world, lane, 'path', 100_000);
    game.demand.res = 1;

    computeConnectivity(game.world);
    computeRoadDistance(game.world, fields.roadDistance);
    computeLandValue(game.world, fields);

    expect(suitability(game, fields, corner.x + 3, corner.y + 1, 'res')).toBe(0);
  });

  it('treats every street as connected in a world with no motorway at all', () => {
    const game = freshGame();
    stripHighway(game.world);
    const corner = quietCorner(game.world);
    const lane: TilePoint[] = Array.from({ length: 4 }, (_, i) => ({ x: corner.x + i, y: corner.y }));
    buildRoad(game.world, lane, 'path', 100_000);
    computeConnectivity(game.world);
    expect(connectedRoadTiles(game.world)).toBe(4);
  });

  it('keeps the spawn threshold honest: connected streets still grow as they always did', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    const highway = highwayTileNearHome(game.world);
    const joined: TilePoint[] = [1, 2, 3, 4, 5, 6].map((d) => ({ x: highway.x - d, y: highway.y }));
    buildRoad(game.world, joined, 'path', 100_000);
    game.demand.res = 1;

    computeConnectivity(game.world);
    computeRoadDistance(game.world, fields.roadDistance);
    computeLandValue(game.world, fields);

    expect(
      suitability(game, fields, highway.x - 3, highway.y + 1, 'res'),
    ).toBeGreaterThan(BUILDING_SPAWN_THRESHOLD);
  });
});
