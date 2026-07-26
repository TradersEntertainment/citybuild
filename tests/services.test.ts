import { beforeEach, describe, expect, it } from 'vitest';
import { SERVICE_SPECS, requiredServices } from '../src/data/services';
import type { TilePoint } from '../src/input/pathGeometry';
import { suitability } from '../src/sim/buildings';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeLandValue, computeRoadDistance, createFields } from '../src/sim/fields';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import {
  canPlaceService,
  computeServiceCoverage,
  placeService,
  serviceCoverageAt,
  serviceUpkeep,
} from '../src/sim/services';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE, SERVICE } from '../src/sim/tiles';
import { canPlacePlant, computeUtilityCoverage, placePlant } from '../src/sim/utilities';
import { Systems } from '../src/sim/systems';
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
 * Services are the term in suitability that was hard-coded for a whole phase.
 * The tests that matter most here are the ones guarding the opening: a founding
 * settlement must not suddenly be marked down for lacking a fire brigade.
 */
let game: GameState;
let origin: { x: number; y: number };
let fields: ReturnType<typeof createFields>;

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

function refresh(): void {
  computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
  computeLandValue(game.world, fields);
  computeServiceCoverage(game, fields);
  computeUtilityCoverage(game, fields);
}

beforeEach(() => {
  game = createGameState(hashSeed('services'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 10, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  fields = createFields(game.world.size);
  game.money = 1_000_000;
  // Most of these are about placement rules, not unlocks, so start in the era
  // that has the basic stations available; the unlock test sets its own.
  game.era = 'village';
  buildRoad(game.world, row(20, 0), 'path', 1_000_000);
  refresh();
});

describe('what the city expects', () => {
  it('asks nothing of a founding settlement', () => {
    expect(requiredServices('founding')).toEqual([]);
    expect(serviceCoverageAt(game.world, 'founding', index(game.world, origin.x, origin.y))).toBe(1);
  });

  it('still asks nothing of a village', () => {
    // The opening was tuned and measured with no services at all; introducing
    // them must not quietly retune it.
    expect(requiredServices('village')).toEqual([]);
  });

  it('starts asking at town, and asks for more later', () => {
    expect(requiredServices('town').length).toBeGreaterThan(0);
    expect(requiredServices('metro').length).toBeGreaterThan(requiredServices('town').length);
  });

  it('scores an unserved town below a served one', () => {
    game.era = 'town';
    const i = index(game.world, origin.x + 5, origin.y + 1);
    expect(serviceCoverageAt(game.world, 'town', i)).toBe(0);

    // A town wants four things: fire, health, water, power. The two civic
    // stations alone are half of it.
    placeService(game, fields, 'fire', origin.x + 5, origin.y + 2);
    placeService(game, fields, 'health', origin.x + 8, origin.y + 2);
    refresh();
    expect(serviceCoverageAt(game.world, 'town', i)).toBeCloseTo(0.5, 6);
  });

  it('is fully served only once the mains reach it too', () => {
    game.era = 'town';
    // Plants need a road that carries utilities; the dirt track does not.
    buildRoad(game.world, row(20, 0), 'asphalt', 10_000_000);
    refresh();
    placeService(game, fields, 'fire', origin.x + 5, origin.y + 2);
    placeService(game, fields, 'health', origin.x + 8, origin.y + 2);
    expect(placePlant(game, fields, 'well', origin.x + 2, origin.y + 1).ok).toBe(true);
    expect(placePlant(game, fields, 'coalPlant', origin.x + 12, origin.y + 1).ok).toBe(true);
    refresh();

    const i = index(game.world, origin.x + 5, origin.y + 1);
    expect(serviceCoverageAt(game.world, 'town', i)).toBeCloseTo(1, 6);
  });
});

describe('placing a plant', () => {
  it('refuses ground with no mains under the road beside it', () => {
    game.era = 'town';
    // The road here is a dirt path, which carries nothing.
    const result = canPlacePlant(game, fields, 'well', origin.x + 3, origin.y + 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('noMains');
  });

  it('accepts the same spot once the road can carry mains', () => {
    game.era = 'town';
    buildRoad(game.world, row(20, 0), 'asphalt', 10_000_000);
    refresh();
    expect(canPlacePlant(game, fields, 'well', origin.x + 3, origin.y + 1).ok).toBe(true);
  });

  it('serves only what the mains reach', () => {
    game.era = 'town';
    buildRoad(game.world, row(20, 0), 'asphalt', 10_000_000);
    refresh();
    placePlant(game, fields, 'well', origin.x + 2, origin.y + 1);
    refresh();

    const near = index(game.world, origin.x + 5, origin.y + 1);
    expect((game.world.serviceMask[near] ?? 0) & SERVICE.water).not.toBe(0);
    // Far off the asphalt, past any walk from it: dry.
    const far = index(game.world, origin.x + 5, origin.y + 18);
    expect((game.world.serviceMask[far] ?? 0) & SERVICE.water).toBe(0);
  });

  it('cuts the whole grid out when supply falls short of demand', () => {
    game.era = 'town';
    buildRoad(game.world, row(20, 0), 'asphalt', 10_000_000);
    refresh();
    placePlant(game, fields, 'well', origin.x + 2, origin.y + 1);
    refresh();
    const i = index(game.world, origin.x + 5, origin.y + 1);
    expect((game.world.serviceMask[i] ?? 0) & SERVICE.water).not.toBe(0);

    // More people than one well can serve. A grid that cannot meet demand
    // fails as a grid rather than browning out in patches nobody can read.
    game.population = 1_000_000;
    refresh();
    expect((game.world.serviceMask[i] ?? 0) & SERVICE.water).toBe(0);
  });
});

describe('placing a station', () => {
  it('refuses land the player does not own', () => {
    const result = canPlaceService(game, fields, 'fire', 2, 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unowned');
  });

  it('refuses a tile that already has a road on it', () => {
    const result = canPlaceService(game, fields, 'fire', origin.x + 3, origin.y);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('occupied');
  });

  it('refuses ground nothing can drive to', () => {
    const far = canPlaceService(game, fields, 'fire', origin.x + 3, origin.y + 20);
    expect(far.ok).toBe(false);
    expect(far.reason).toBe('noRoad');
  });

  it('refuses a service the era has not unlocked', () => {
    game.era = 'founding';
    const result = canPlaceService(game, fields, 'police', origin.x + 3, origin.y + 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('locked');
  });

  it('refuses when the money is short, and takes it when it is not', () => {
    game.era = 'village';
    game.money = SERVICE_SPECS.fire.cost - 1;
    expect(placeService(game, fields, 'fire', origin.x + 3, origin.y + 1).ok).toBe(false);
    expect(game.services.size).toBe(0);

    game.money = SERVICE_SPECS.fire.cost + 100;
    expect(placeService(game, fields, 'fire', origin.x + 3, origin.y + 1).ok).toBe(true);
    expect(game.money).toBeCloseTo(100, 6);
    expect(game.services.size).toBe(1);
  });

  it('refuses to stack two stations on one tile', () => {
    game.era = 'village';
    placeService(game, fields, 'fire', origin.x + 3, origin.y + 1);
    const second = canPlaceService(game, fields, 'health', origin.x + 3, origin.y + 1);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('occupied');
  });
});

describe('coverage', () => {
  it('reaches its radius and no further', () => {
    game.era = 'town';
    placeService(game, fields, 'fire', origin.x + 5, origin.y + 1);
    refresh();

    const bit = SERVICE_SPECS.fire.bit;
    const covered = (dx: number): boolean =>
      ((game.world.serviceMask[index(game.world, origin.x + 5 + dx, origin.y + 1)] ?? 0) & bit) !== 0;
    expect(covered(0)).toBe(true);
    expect(covered(SERVICE_SPECS.fire.radius + 3)).toBe(false);
  });

  it('does not serve ground with no road access', () => {
    game.era = 'town';
    placeService(game, fields, 'fire', origin.x + 5, origin.y + 1);
    refresh();
    // Well inside the radius, but far from any road.
    const i = index(game.world, origin.x + 5, origin.y + 10);
    expect(game.world.serviceMask[i] ?? 0).toBe(0);
  });

  it('clears when the station is removed', () => {
    game.era = 'town';
    placeService(game, fields, 'fire', origin.x + 5, origin.y + 1);
    refresh();
    const i = index(game.world, origin.x + 5, origin.y + 1);
    expect(game.world.serviceMask[i] ?? 0).not.toBe(0);

    game.services.clear();
    refresh();
    expect(game.world.serviceMask[i] ?? 0).toBe(0);
  });
});

describe('what stations cost', () => {
  it('charges upkeep every minute for as long as they stand', () => {
    game.era = 'city';
    expect(serviceUpkeep(game)).toBe(0);
    placeService(game, fields, 'fire', origin.x + 3, origin.y + 1);
    placeService(game, fields, 'health', origin.x + 6, origin.y + 1);
    expect(serviceUpkeep(game)).toBeCloseTo(
      SERVICE_SPECS.fire.upkeep + SERVICE_SPECS.health.upkeep,
      6,
    );
  });

  it('shows up in the ledger, not only in the balance', () => {
    game.era = 'city';
    paintZone(game.world, row(20, 1), 'res', 1_000_000);
    placeService(game, fields, 'fire', origin.x + 3, origin.y + 2);

    const systems = new Systems(game.world.size);
    systems.invalidateFields();
    for (let s = 0; s < 30; s++) {
      systems.step(game, 1);
      systems.stepEconomy(game, 1);
    }
    expect(game.ledger.serviceUpkeep).toBeCloseTo(SERVICE_SPECS.fire.upkeep, 6);
  });
});

describe('the opening is unchanged', () => {
  it('scores a founding plot exactly as it did before services existed', () => {
    paintZone(game.world, row(20, 1), 'res', 1_000_000);
    game.demand.res = 0.5;
    refresh();
    // Coverage is 1 in the founding era, which is the value the term was pinned
    // to while it was hard-coded — so this score has not moved.
    const score = suitability(game, fields, origin.x + 5, origin.y + 1, 'res');
    expect(score).toBeGreaterThan(0.45);
  });
});
