import { beforeEach, describe, expect, it } from 'vitest';
import { STR } from '../src/data/strings.tr';
import { UTILITY_ORDER, UTILITY_SPECS, type UtilityKind } from '../src/data/utilities';
import { createFields, computeRoadDistance, type Fields } from '../src/sim/fields';
import { computeConnectivity } from '../src/sim/connectivity';
import { buildRoad } from '../src/sim/roads';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { research } from '../src/sim/tech';
import { NONE } from '../src/sim/tiles';
import { canPlacePlant, placePlant, utilityBalance } from '../src/sim/utilities';
import { index, startingCentre } from '../src/sim/world';
import { isWater } from '../src/sim/worldgen';

/**
 * Six ways to make power, and the point is that none of them wins.
 *
 * The load-bearing property is the water rule: a dam and a reactor are cheaper
 * to run and cleaner than anything that burns, so the only thing stopping them
 * from being strictly better is that most of the map cannot hold them. If that
 * check ever silently passes everywhere, coal and gas become dead entries in a
 * table and the whole choice collapses.
 */

let game: GameState;
let fields: Fields;
let origin: { x: number; y: number };

/**
 * Takes the motorway out of the fixture entirely.
 *
 * Not just the tarmac: the route and the connectivity column go too. Connectivity
 * is measured *from* the highway, so a half-stripped map leaves every test road
 * unconnected and every placement refused with noRoad — which reads as a broken
 * placement rule rather than a broken fixture (AGENTS.md trap 14).
 */
function stripHighway(state: GameState): void {
  const world = state.world;
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

/** Dry, buildable, owned ground. Heights are 0..1 with SEA_LEVEL at 0.42. */
function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  const world = state.world;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= world.size || y >= world.size) continue;
      const i = index(world, x, y);
      world.height[i] = 0.5;
      world.fertility[i] = 0.3;
      world.terrain[i] = 2;
    }
  }
}

/** Sinks a rectangle below sea level, in tile coordinates. */
function dig(state: GameState, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      state.world.height[index(state.world, x, y)] = 0.1;
    }
  }
}

function refresh(): void {
  computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
}

/** A row of tiles along y = origin.y + dy. */
function row(length: number, dy: number): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let i = 0; i < length; i++) tiles.push({ x: origin.x + i, y: origin.y + dy });
  return tiles;
}

beforeEach(() => {
  game = createGameState(hashSeed('plants'), 0);
  stripHighway(game);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  game.money = 5_000_000;
  game.era = 'metropolis';
  fields = createFields(game.world.size);
  // Asphalt, because only asphalt and above carry mains.
  buildRoad(game.world, row(24, 0), 'asphalt', 10_000_000);
  refresh();
});

describe('the plant table', () => {
  it('names every kind and lists it exactly once', () => {
    expect(new Set(UTILITY_ORDER).size).toBe(UTILITY_ORDER.length);
    expect(UTILITY_ORDER.length).toBe(Object.keys(UTILITY_SPECS).length);
    for (const kind of UTILITY_ORDER) {
      expect(STR.utility[kind].length).toBeGreaterThan(0);
      const spec = UTILITY_SPECS[kind];
      expect(spec.kind).toBe(kind);
      expect(spec.cost).toBeGreaterThan(0);
      expect(spec.upkeep).toBeGreaterThan(0);
      expect(spec.capacity).toBeGreaterThan(0);
      expect(spec.mains).toBeGreaterThan(0);
    }
  });

  it('charges for the clean ones in money or in geography, never neither', () => {
    // The rule the whole table rests on. A power plant that emits nothing, needs
    // no particular ground, and costs no more per MW than coal would end the
    // choice — so every zero-pollution station must pay somewhere else.
    for (const kind of UTILITY_ORDER) {
      const spec = UTILITY_SPECS[kind];
      if (spec.provides !== 'power' || spec.pollution > 0) continue;
      const perMw = spec.cost / spec.capacity;
      const coal = UTILITY_SPECS.coalPlant.cost / UTILITY_SPECS.coalPlant.capacity;
      const dearer = perMw > coal;
      const bound = spec.waterNeeded > 0;
      const late = spec.unlockedAt !== 'town';
      expect(dearer || bound || late).toBe(true);
    }
  });

  it('asks for water only where the water rule is meant to bite', () => {
    for (const kind of UTILITY_ORDER) {
      const spec = UTILITY_SPECS[kind];
      // A reach without a requirement, or the other way round, is a half-written
      // rule that would read as working and do nothing.
      expect(spec.waterNeeded > 0).toBe(spec.waterReach > 0);
    }
  });
});

describe('a plant that needs water', () => {
  it('refuses dry ground, and says why', () => {
    const result = canPlacePlant(game, fields, 'hydroPlant', origin.x + 4, origin.y + 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('noWater');
  });

  it('takes nothing when it refuses', () => {
    const before = game.money;
    expect(placePlant(game, fields, 'hydroPlant', origin.x + 4, origin.y + 1).ok).toBe(false);
    expect(game.money).toBe(before);
    expect(game.utilities.size).toBe(0);
  });

  it('stands once there is a real river beside it', () => {
    // A six-wide river running past, two tiles clear of the dam. Measured: that
    // puts 54 water tiles inside the radius-7 disc against the 26 the spec asks
    // for — comfortably over, which is the point. A dam should want a river and
    // get one, not want a river and need an inland sea.
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    dig(game, spot.x + 2, spot.y - 7, spot.x + 7, spot.y + 7);
    expect(isWater(game.world, spot.x + 4, spot.y)).toBe(true);
    const result = placePlant(game, fields, 'hydroPlant', spot.x, spot.y);
    expect(result.reason ?? 'ok').toBe('ok');
    expect(game.utilities.size).toBe(1);
  });

  it('is still refused by a pond', () => {
    // The other half of the calibration: something too small must not pass, or
    // the rule is a formality and the clean plants go anywhere.
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    dig(game, spot.x + 2, spot.y - 1, spot.x + 4, spot.y + 1);
    expect(canPlacePlant(game, fields, 'hydroPlant', spot.x, spot.y).reason).toBe('noWater');
  });

  it('does not stop a plant that needs none', () => {
    expect(placePlant(game, fields, 'coalPlant', origin.x + 4, origin.y + 1).ok).toBe(true);
  });
});

describe('the era gates', () => {
  it('keeps the reactor for a metropolis and the solar farm for a metro', () => {
    game.era = 'city';
    expect(canPlacePlant(game, fields, 'nuclearPlant', origin.x + 4, origin.y + 1).reason).toBe(
      'locked',
    );
    expect(canPlacePlant(game, fields, 'solarFarm', origin.x + 4, origin.y + 1).reason).toBe(
      'locked',
    );
    // Oil is a city's answer to a browning-out grid, so it opens with gas.
    expect(canPlacePlant(game, fields, 'oilPlant', origin.x + 4, origin.y + 1).ok).toBe(true);
  });
});

describe('research on the grid', () => {
  const plant = (kind: UtilityKind): void => {
    expect(placePlant(game, fields, kind, origin.x + 4, origin.y + 1).ok).toBe(true);
  };

  it('turbines get more out of the stations already standing', () => {
    plant('coalPlant');
    const before = utilityBalance(game).powerSupply;
    game.research = 10_000;
    expect(research(game, 'turbines')).toBe('ok');
    expect(utilityBalance(game).powerSupply).toBeGreaterThan(before);
  });

  it('hydrology does the same for water, and only for water', () => {
    plant('coalPlant');
    expect(placePlant(game, fields, 'well', origin.x + 6, origin.y + 1).ok).toBe(true);
    const before = utilityBalance(game);
    game.research = 10_000;
    expect(research(game, 'hydrology')).toBe('ok');
    const after = utilityBalance(game);
    expect(after.waterSupply).toBeGreaterThan(before.waterSupply);
    expect(after.powerSupply).toBe(before.powerSupply);
  });
});
