import { beforeEach, describe, expect, it } from 'vitest';
import { lensField, LENS_ORDER, NO_READING } from '../src/sim/lens';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE, SERVICE } from '../src/sim/tiles';
import { index, startingCentre } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * Data lenses (§14): the map, coloured by one thing the city knows.
 *
 * The property that matters most is the silence convention. A lens paints
 * readings, and NO_READING where there is nothing to say — get that wrong in
 * either direction and the feature lies: a zero painted over wilderness says
 * "this mountain is unserved", and a skipped zero on a zoned street hides the
 * exact gap the coverage lens exists to show.
 */
let game: GameState;
let origin: { x: number; y: number };

beforeEach(() => {
  game = createGameState(hashSeed('lens'), 0);
  const world = game.world;
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  const centre = startingCentre(world);
  origin = { x: Math.floor(centre.x) - 8, y: Math.floor(centre.y) };
  for (let y = origin.y - 6; y <= origin.y + 6; y++) {
    for (let x = origin.x - 2; x <= origin.x + 20; x++) {
      const i = index(world, x, y);
      world.height[i] = 0.5;
      world.terrain[i] = 2;
    }
  }
  game.money = 1_000_000;
});

function at(field: Float32Array, dx: number, dy: number): number {
  return field[index(game.world, origin.x + dx, origin.y + dy)] ?? NaN;
}

describe('every lens stays inside its contract', () => {
  it('returns only NO_READING or 0..1, for every kind', () => {
    buildRoad(game.world, [{ x: origin.x, y: origin.y }], 'asphalt', 1e9);
    paintZone(game.world, [{ x: origin.x, y: origin.y + 1 }], 'res', 1e9);
    for (const kind of LENS_ORDER) {
      const field = lensField(game, kind, new Float32Array(game.world.size ** 2));
      for (let i = 0; i < field.length; i++) {
        const v = field[i] as number;
        expect(v === NO_READING || (v >= 0 && v <= 1)).toBe(true);
      }
    }
  });
});

describe('what each lens shows and stays silent about', () => {
  it('value: reads the land value column', () => {
    game.world.landValue[index(game.world, origin.x, origin.y)] = 80;
    const field = lensField(game, 'value');
    expect(at(field, 0, 0)).toBeCloseTo(0.8, 5);
  });

  it('pollution and noise: silent where the air is clean', () => {
    game.world.pollution[index(game.world, origin.x, origin.y)] = 60;
    const pollution = lensField(game, 'pollution');
    expect(at(pollution, 0, 0)).toBeCloseTo(0.6, 5);
    expect(at(pollution, 5, 0)).toBe(NO_READING);

    game.world.noise[index(game.world, origin.x + 1, origin.y)] = 120;
    const noise = lensField(game, 'noise');
    // Clamped: a motorway junction can exceed the scale, the colour cannot.
    expect(at(noise, 1, 0)).toBe(1);
  });

  it('traffic: only ever on a road', () => {
    buildRoad(game.world, [{ x: origin.x, y: origin.y }], 'asphalt', 1e9);
    const load = new Float32Array(game.world.size ** 2);
    load[index(game.world, origin.x, origin.y)] = 0.7;
    load[index(game.world, origin.x + 3, origin.y)] = 0.9; // no road here
    const field = lensField(game, 'traffic', load);
    expect(at(field, 0, 0)).toBeCloseTo(0.7, 5);
    expect(at(field, 3, 0)).toBe(NO_READING);
  });

  it('coverage: zero is a loud reading on zoned ground and silence off it', () => {
    game.era = 'city';
    paintZone(game.world, [{ x: origin.x, y: origin.y + 1 }], 'res', 1e9);
    const field = lensField(game, 'coverage');
    // The zoned street with no station: the gap the lens exists to show.
    expect(at(field, 0, 1)).toBe(0);
    // The wilderness next door: not "unserved", just wild.
    expect(at(field, 6, 1)).toBe(NO_READING);
  });

  it('crime: shops read hotter than homes, and a watched street cools', () => {
    const home = { id: 1, x: origin.x, y: origin.y + 1, w: 1, h: 1, zone: 'res', level: 1, score: 0.8, growthProgress: 0, decayTimer: 0, population: 6, jobs: 0, output: 0, issues: 0, builtAt: 0, variantSeed: 1 } as const;
    const shop = { ...home, id: 2, x: origin.x + 1, zone: 'com', population: 0, jobs: 4 } as const;
    const watched = { ...home, id: 3, x: origin.x + 2 } as const;
    game.buildings.set(1, { ...home });
    game.buildings.set(2, { ...shop });
    game.buildings.set(3, { ...watched });
    game.world.serviceMask[index(game.world, origin.x + 2, origin.y + 1)] = SERVICE.police;

    const field = lensField(game, 'crime');
    expect(at(field, 1, 1)).toBeGreaterThan(at(field, 0, 1));
    expect(at(field, 2, 1)).toBeLessThan(at(field, 0, 1));
    expect(at(field, 4, 1)).toBe(NO_READING);
  });

  it('density: bright where height was paid for, dim where it was not', () => {
    paintZone(game.world, [{ x: origin.x, y: origin.y + 1 }], 'res', 1e9, true);
    paintZone(game.world, [{ x: origin.x + 1, y: origin.y + 1 }], 'res', 1e9);
    paintZone(game.world, [{ x: origin.x + 2, y: origin.y + 1 }], 'park', 1e9);
    const field = lensField(game, 'density');
    expect(at(field, 0, 1)).toBe(1);
    expect(at(field, 1, 1)).toBeGreaterThan(0);
    expect(at(field, 1, 1)).toBeLessThan(1);
    // A park cannot be dense, so it has nothing to say here.
    expect(at(field, 2, 1)).toBe(NO_READING);
  });
});
