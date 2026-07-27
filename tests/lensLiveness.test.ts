import { describe, expect, it } from 'vitest';
import { LENS_ORDER, lensField, NO_READING } from '../src/sim/lens';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE } from '../src/sim/tiles';
import { index, startingCentre, type World } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';
import type { TilePoint } from '../src/input/pathGeometry';

/**
 * Every lens has to actually show something (§14 liveness).
 *
 * tests/lens.test.ts pins the *silence convention*: readings are 0..1, and
 * NO_READING everywhere there is nothing to say. An all-silent field satisfies
 * that perfectly — which is exactly how the land value lens shipped broken.
 * `world.landValue` was never written by anything, so the overlay drew an empty
 * map on every city ever built, and no test could tell "nothing to say" apart
 * from "nobody filled the array".
 *
 * This is the other half of the contract. Build a real city, run the real
 * systems over it, and require each lens to have at least one thing to say. It
 * cannot catch a lens that is merely *inaccurate* — but it catches a lens
 * reading a buffer nobody populates, which is the failure that actually
 * happened, and it will catch the next one for free when a field is renamed or
 * a publish step is dropped.
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
      state.world.terrain[i] = 2;
    }
  }
}

/**
 * A city with something to say on every axis: houses, workshops for the
 * pollution and the noise, shops, a park, and traffic on the one street.
 */
function livedInCity(): { game: GameState; systems: Systems } {
  const game = createGameState(hashSeed('liveness'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  const ox = Math.floor(centre.x) - 10;
  const oy = Math.floor(centre.y);
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  game.money = 5_000_000;
  game.era = 'city';

  const row = (length: number, dy: number): TilePoint[] =>
    Array.from({ length }, (_, i) => ({ x: ox + i, y: oy + dy }));

  const systems = new Systems(game.world.size);
  buildRoad(game.world, row(20, 0), 'path', 1e9);
  paintZone(game.world, row(20, -1), 'res', 1e9);
  paintZone(game.world, row(20, 1), 'res', 1e9);
  paintZone(game.world, row(20, 2), 'com', 1e9);
  paintZone(game.world, row(20, -2), 'ind', 1e9);
  paintZone(game.world, row(3, -3), 'park', 1e9);
  systems.invalidateFields();

  for (let second = 0; second < 600; second++) {
    game.playedMs += 1000;
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
  return { game, systems };
}

const { game, systems } = livedInCity();

describe('lens liveness', () => {
  it('grew a real city to look at', () => {
    expect(game.buildings.size).toBeGreaterThan(10);
    expect(game.population).toBeGreaterThan(0);
  });

  for (const kind of LENS_ORDER) {
    it(`${kind} has something to say about a lived-in city`, () => {
      const field = lensField(game, kind, systems.traffic.load);
      let readings = 0;
      for (let i = 0; i < field.length; i++) {
        if ((field[i] ?? NO_READING) !== NO_READING) readings++;
      }
      expect(readings).toBeGreaterThan(0);
    });
  }
});
