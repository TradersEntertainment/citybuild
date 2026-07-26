import { beforeEach, describe, expect, it } from 'vitest';
import type { TilePoint } from '../src/input/pathGeometry';
import { isPavement } from '../src/render3d/pedestrians';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { index, startingCentre } from '../src/sim/world';

/**
 * The walkers themselves are presentation and the simulation knows nothing
 * about them. The one rule worth pinning down is where pavement is: it decides
 * where people appear, and it has to keep meaning the same thing when the road
 * tiers or the building layer change underneath it.
 */
let game: GameState;
let origin: { x: number; y: number };

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.terrain[i] = 2;
    }
  }
}

function row(length: number, dy: number): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

beforeEach(() => {
  game = createGameState(hashSeed('pavement'), 0);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 8, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 20);
  buildRoad(game.world, row(12, 0), 'asphalt', 1_000_000);
});

describe('where a person may walk', () => {
  it('is the ground beside a road', () => {
    expect(isPavement(game.world, origin.x + 4, origin.y + 1)).toBe(true);
    expect(isPavement(game.world, origin.x + 4, origin.y - 1)).toBe(true);
  });

  it('is not the carriageway itself', () => {
    expect(isPavement(game.world, origin.x + 4, origin.y)).toBe(false);
  });

  it('is not open country two tiles from anything', () => {
    expect(isPavement(game.world, origin.x + 4, origin.y + 3)).toBe(false);
  });

  it('is not a tile with a building on it', () => {
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    expect(isPavement(game.world, spot.x, spot.y)).toBe(true);
    game.world.building[index(game.world, spot.x, spot.y)] = 42;
    expect(isPavement(game.world, spot.x, spot.y)).toBe(false);
  });

  it('is not water, however close to the bridge it lies', () => {
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    game.world.terrain[index(game.world, spot.x, spot.y)] = 0;
    expect(isPavement(game.world, spot.x, spot.y)).toBe(false);
  });

  it('does not run off the edge of the map', () => {
    expect(isPavement(game.world, -1, 5)).toBe(false);
    expect(isPavement(game.world, 5, -1)).toBe(false);
    expect(isPavement(game.world, game.world.size, 5)).toBe(false);
    expect(isPavement(game.world, 5, game.world.size)).toBe(false);
  });

  it('is not the hard shoulder of the motorway the map came with', () => {
    // Every map is crossed by the national highway before the player draws
    // anything, so without this rule a brand-new city already has people
    // strolling beside a motorway.
    const empty = createGameState(hashSeed('empty'), 0);
    let beside = 0;
    for (let y = 0; y < empty.world.size; y++) {
      for (let x = 0; x < empty.world.size; x++) if (isPavement(empty.world, x, y)) beside++;
    }
    expect(beside).toBe(0);
  });

  it('exists once the player has drawn a street', () => {
    let withRoad = 0;
    for (let y = origin.y - 3; y <= origin.y + 3; y++) {
      for (let x = origin.x; x < origin.x + 12; x++) {
        if (isPavement(game.world, x, y)) withRoad++;
      }
    }
    expect(withRoad).toBeGreaterThan(0);

  });
});
