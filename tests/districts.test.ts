import { beforeEach, describe, expect, it } from 'vitest';
import { districtName, NAME_COMBINATIONS } from '../src/data/districtNames';
import type { TilePoint } from '../src/input/pathGeometry';
import {
  DISTRICT_BLOCK,
  DISTRICT_MIN_BUILDINGS,
  findDistricts,
} from '../src/sim/districts';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { index, startingCentre } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * A city the player has spent an hour on used to be "the city", with no part of
 * it they could point at and name. Nothing here is stored — a district exists
 * because the buildings do, and is called the same thing every session because
 * the name is a hash of where it stands.
 */
let game: GameState;
let systems: Systems;
let origin: { x: number; y: number };

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.fertility[i] = 0.3;
      state.world.terrain[i] = 2;
    }
  }
}

function row(length: number, dy: number): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

function grow(seconds: number): void {
  for (let s = 0; s < seconds; s++) {
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
}

function seedCity(): void {
  buildRoad(game.world, row(40, 0), 'path', 1_000_000);
  paintZone(game.world, row(40, 1), 'res', 1_000_000);
  paintZone(game.world, row(40, 2), 'res', 1_000_000);
  paintZone(game.world, row(40, -1), 'com', 1_000_000);
  systems.invalidateFields();
  grow(120);
}

beforeEach(() => {
  game = createGameState(hashSeed('districts'), 0);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 20, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 30);
  game.money = 1_000_000;
  systems = new Systems(game.world.size);
});

describe('composing a name', () => {
  it('always produces something', () => {
    for (let i = 0; i < 500; i++) {
      const name = districtName(i * 2654435761);
      expect(name.length).toBeGreaterThan(3);
      expect(name).not.toContain('undefined');
    }
  });

  it('is stable for the same number', () => {
    expect(districtName(12345)).toBe(districtName(12345));
  });

  it('reaches a good spread of the combinations it has', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) seen.add(districtName(i * 2654435761));
    // A generator that leans on a handful of names gives itself away.
    expect(seen.size).toBeGreaterThan(NAME_COMBINATIONS * 0.6);
  });
});

describe('finding the neighbourhoods', () => {
  it('names nothing on an empty map', () => {
    expect(findDistricts(game)).toHaveLength(0);
  });

  it('names a district once there are enough buildings in one block', () => {
    seedCity();
    const districts = findDistricts(game);
    expect(districts.length).toBeGreaterThan(0);
    for (const district of districts) {
      expect(district.buildings).toBeGreaterThanOrEqual(DISTRICT_MIN_BUILDINGS);
    }
  });

  it('puts each name in its own part of the map', () => {
    seedCity();
    const districts = findDistricts(game);
    for (const district of districts) {
      expect(district.x).toBeGreaterThanOrEqual(0);
      expect(district.x).toBeLessThan(game.world.size);
      expect(district.y).toBeGreaterThanOrEqual(0);
      expect(district.y).toBeLessThan(game.world.size);
    }
    // A forty-tile strip crosses more than one block, so it is more than one
    // neighbourhood — a whole city called one name is not a neighbourhood.
    expect(districts.length).toBeGreaterThan(1);
    const spread = Math.max(...districts.map((d) => d.x)) - Math.min(...districts.map((d) => d.x));
    expect(spread).toBeGreaterThanOrEqual(DISTRICT_BLOCK);
  });

  it('never gives two neighbourhoods the same name', () => {
    seedCity();
    const names = findDistricts(game).map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('calls the same block the same thing every time it is asked', () => {
    seedCity();
    const first = findDistricts(game).map((d) => d.name);
    const again = findDistricts(game).map((d) => d.name);
    expect(again).toEqual(first);
  });

  it('gives two cities on different seeds different names', () => {
    seedCity();
    const first = findDistricts(game).map((d) => d.name);

    game = createGameState(hashSeed('elsewhere'), 0);
    const centre = startingCentre(game.world);
    origin = { x: Math.floor(centre.x) - 20, y: Math.floor(centre.y) };
    flatten(game, Math.floor(centre.x), Math.floor(centre.y), 30);
    game.money = 1_000_000;
    systems = new Systems(game.world.size);
    seedCity();
    const second = findDistricts(game).map((d) => d.name);

    // Not a hard guarantee for any one district, but two whole cities sharing
    // every name would mean the seed is not reaching the hash at all.
    expect(second).not.toEqual(first);
  });

  it('lists the biggest neighbourhood first', () => {
    seedCity();
    const districts = findDistricts(game);
    for (let i = 1; i < districts.length; i++) {
      expect(districts[i - 1]!.buildings).toBeGreaterThanOrEqual(districts[i]!.buildings);
    }
  });

  it('calls a strip of shops a commercial district', () => {
    buildRoad(game.world, row(20, 0), 'path', 1_000_000);
    paintZone(game.world, row(20, 1), 'com', 1_000_000);
    paintZone(game.world, row(20, 2), 'com', 1_000_000);
    systems.invalidateFields();
    grow(120);

    const districts = findDistricts(game);
    expect(districts.length).toBeGreaterThan(0);
    expect(districts.every((d) => d.character === 'com')).toBe(true);
  });

  it('forgets a neighbourhood the player erased', () => {
    seedCity();
    expect(findDistricts(game).length).toBeGreaterThan(0);
    game.buildings.clear();
    expect(findDistricts(game)).toHaveLength(0);
  });
});
