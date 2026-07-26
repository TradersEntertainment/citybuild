import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../src/data/balance';
import type { TilePoint } from '../src/input/pathGeometry';
import { buildRoad } from '../src/sim/roads';
import { decodeRuns, deserialize, encodeRuns, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { hashSeed } from '../src/sim/rng';
import { NONE } from '../src/sim/tiles';
import { index, startingCentre, type World } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * These fixtures predate the national highway; a motorway through the working
 * area would move every figure they measure. With the highway stripped there
 * is no "abroad" to be cut off from, so every street connects (§6.1).
 */
function stripHighway(world: World): void {
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

/**
 * A save that loses a city is worse than no save at all, and a save that loads
 * *half* a city is worse still. These check the round trip on a real, played
 * city rather than on a synthetic fixture.
 */
function playedCity(seconds = 90): GameState {
  const game = createGameState(hashSeed('save'), 1_700_000_000_000);
  stripHighway(game.world);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  const cx = Math.floor(centre.x);
  const cy = Math.floor(centre.y);
  for (let y = cy - 20; y <= cy + 20; y++) {
    for (let x = cx - 20; x <= cx + 20; x++) {
      const i = index(game.world, x, y);
      game.world.height[i] = 0.5;
      game.world.fertility[i] = 0.3;
      game.world.terrain[i] = 2;
    }
  }
  const origin = { x: cx - 10, y: cy };
  const row = (n: number, dy: number): TilePoint[] =>
    Array.from({ length: n }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));

  const systems = new Systems(game.world.size);
  buildRoad(game.world, row(20, 0), 'path', 100_000);
  paintZone(game.world, row(20, 1), 'res', 100_000);
  paintZone(game.world, row(20, 2), 'com', 100_000);
  systems.invalidateFields();
  for (let s = 0; s < seconds; s++) {
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
  return game;
}

describe('run-length coding', () => {
  it('round-trips a column of mostly one value', () => {
    const column = new Uint8Array(1000);
    column.fill(0);
    column[400] = 3;
    column[401] = 3;
    column[999] = 7;

    const restored = new Uint8Array(1000);
    expect(decodeRuns(encodeRuns(column), restored)).toBe(true);
    expect([...restored]).toEqual([...column]);
  });

  it('compresses an almost-empty column to a handful of numbers', () => {
    const column = new Uint8Array(65_536);
    for (let i = 0; i < 200; i++) column[1000 + i] = 1;
    expect(encodeRuns(column).length).toBeLessThan(10);
  });

  it('refuses runs that do not fill the column exactly', () => {
    const into = new Uint8Array(10);
    expect(decodeRuns([1, 4], into)).toBe(false); // too short
    expect(decodeRuns([1, 40], into)).toBe(false); // too long
    expect(decodeRuns([1, 3, 2], into)).toBe(false); // odd length
  });
});

describe('save round trip', () => {
  it('brings back a played city intact', () => {
    const before = playedCity();
    expect(before.buildings.size).toBeGreaterThan(0);

    const after = deserialize(JSON.parse(JSON.stringify(serialize(before))));
    expect(after).not.toBeNull();
    const city = after as GameState;

    expect(city.seed).toBe(before.seed);
    expect(city.money).toBeCloseTo(before.money, 6);
    expect(city.era).toBe(before.era);
    expect(city.buildings.size).toBe(before.buildings.size);
    // Per-building occupancy is stored to two decimals to keep the save small,
    // so a large city can drift by a fraction of a person. Anything approaching
    // a whole resident would mean the codec is losing people.
    expect(city.population).toBeCloseTo(before.population, 1);
    expect(city.happiness).toBeCloseTo(before.happiness, 6);
    expect(city.farmTiles).toBe(before.farmTiles);
    expect(city.nextBuildingId).toBe(before.nextBuildingId);
  });

  it('regenerates the same terrain from the seed rather than storing it', () => {
    const before = playedCity(20);
    const saved = serialize(before);
    // The map is the biggest thing in the world and none of it is in the save.
    expect(saved).not.toHaveProperty('height');
    expect(saved).not.toHaveProperty('terrain');

    const city = deserialize(JSON.parse(JSON.stringify(saved))) as GameState;
    // Terrain was flattened by the harness, which the save does not record, so
    // compare the generated columns instead: same seed, same land.
    const fresh = createGameState(before.seed, 0);
    expect([...city.world.terrain]).toEqual([...fresh.world.terrain]);
    expect([...city.world.height]).toEqual([...fresh.world.height]);
  });

  it('restores roads, zoning and the tile-to-building index', () => {
    const before = playedCity();
    const city = deserialize(JSON.parse(JSON.stringify(serialize(before)))) as GameState;

    expect([...city.world.road]).toEqual([...before.world.road]);
    expect([...city.world.zone]).toEqual([...before.world.zone]);
    for (const building of city.buildings.values()) {
      expect(city.world.building[index(city.world, building.x, building.y)]).toBe(building.id);
    }
  });

  it('keeps a city small enough for localStorage', () => {
    const bytes = JSON.stringify(serialize(playedCity())).length;
    expect(bytes).toBeLessThan(200_000);
  });

  it('refuses a save from another version rather than half-loading it', () => {
    const saved = serialize(playedCity(20));
    expect(deserialize({ ...saved, version: SAVE_VERSION + 1 })).toBeNull();
  });

  it('refuses corrupt input instead of throwing', () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize({})).toBeNull();
    expect(deserialize('not a save')).toBeNull();
    const saved = serialize(playedCity(20));
    expect(deserialize({ ...saved, road: [1, 2, 3] })).toBeNull();
    expect(deserialize({ ...saved, buildings: [1, 2, 3] })).toBeNull();
  });
});
