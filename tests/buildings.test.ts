import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILDING_SPAWN_THRESHOLD,
  DECAY_DURATION_S,
  ROAD_ACCESS_MAX_WALK,
} from '../src/data/balance';
import { capacityOf } from '../src/data/buildings';
import type { TilePoint } from '../src/input/pathGeometry';
import { evaluateBuildings, neighbourFit, suitability, totalBuildings } from '../src/sim/buildings';
import { computeLandValue, computeRoadDistance, createFields, UNREACHABLE } from '../src/sim/fields';
import { hashSeed } from '../src/sim/rng';
import { buildRoad, removeRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { index, startingCentre } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

let game: GameState;
let fields: ReturnType<typeof createFields>;
let origin: { x: number; y: number };

/** A flat, dry working area, so terrain never decides the outcome of a test. */
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

function refresh(): void {
  computeRoadDistance(game.world, fields.roadDistance);
  computeLandValue(game.world, fields);
}

function row(length: number, dy = 0): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

beforeEach(() => {
  game = createGameState(hashSeed('phase2'), 0);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 10, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  fields = createFields(game.world.size);
  refresh();
});

describe('road distance field', () => {
  it('is unreachable everywhere before any road exists', () => {
    expect(fields.roadDistance[index(game.world, origin.x, origin.y)]).toBe(UNREACHABLE);
  });

  it('measures walking steps out from a road, and stops at the walk limit', () => {
    buildRoad(game.world, row(12), 'path', 10_000);
    refresh();

    expect(fields.roadDistance[index(game.world, origin.x, origin.y)]).toBe(0);
    expect(fields.roadDistance[index(game.world, origin.x, origin.y + 1)]).toBe(1);
    expect(fields.roadDistance[index(game.world, origin.x, origin.y + 3)]).toBe(3);
    expect(
      fields.roadDistance[index(game.world, origin.x, origin.y + ROAD_ACCESS_MAX_WALK + 3)],
    ).toBe(UNREACHABLE);
  });

  it('raises land value beside a road', () => {
    const before = fields.landValue[index(game.world, origin.x, origin.y + 1)] ?? 0;
    buildRoad(game.world, row(12), 'path', 10_000);
    refresh();
    const after = fields.landValue[index(game.world, origin.x, origin.y + 1)] ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});

describe('suitability', () => {
  it('is zero without a road, so nothing is ever built off the network', () => {
    game.demand.res = 1;
    expect(suitability(game, fields, origin.x, origin.y + 1, 'res')).toBe(0);
  });

  it('clears the spawn threshold beside a road when demand is there', () => {
    buildRoad(game.world, row(12), 'path', 10_000);
    refresh();
    game.demand.res = 1;
    expect(suitability(game, fields, origin.x, origin.y + 1, 'res')).toBeGreaterThan(
      BUILDING_SPAWN_THRESHOLD,
    );
  });

  it('falls as demand dries up', () => {
    buildRoad(game.world, row(12), 'path', 10_000);
    refresh();
    game.demand.res = 1;
    const high = suitability(game, fields, origin.x, origin.y + 1, 'res');
    game.demand.res = 0;
    expect(suitability(game, fields, origin.x, origin.y + 1, 'res')).toBeLessThan(high);
  });

  it('falls with distance from the road', () => {
    buildRoad(game.world, row(12), 'path', 10_000);
    refresh();
    game.demand.res = 1;
    const near = suitability(game, fields, origin.x, origin.y + 1, 'res');
    const far = suitability(game, fields, origin.x, origin.y + 4, 'res');
    expect(far).toBeLessThan(near);
  });
});

describe('neighbourFit', () => {
  it('has no opinion about empty surroundings', () => {
    expect(neighbourFit(game.world, origin.x, origin.y, 'res')).toBe(0.5);
  });

  it('likes parks next to homes and dislikes industry', () => {
    const parkland = paintZone(game.world, row(6, 1), 'park', 1e6);
    expect(parkland.changes.length).toBeGreaterThan(0);
    const withPark = neighbourFit(game.world, origin.x + 2, origin.y, 'res');

    paintZone(game.world, row(6, 1), 'ind', 1e6);
    const withIndustry = neighbourFit(game.world, origin.x + 2, origin.y, 'res');

    expect(withPark).toBeGreaterThan(0.5);
    expect(withIndustry).toBeLessThan(withPark);
  });
});

describe('building lifecycle', () => {
  function seedNeighbourhood(): void {
    buildRoad(game.world, row(12), 'path', 100_000);
    paintZone(game.world, row(12, 1), 'res', 100_000);
    refresh();
    game.demand.res = 1;
  }

  it('grows homes beside a road once zoned', () => {
    seedNeighbourhood();
    evaluateBuildings(game, fields, 3);
    expect(game.buildings.size).toBeGreaterThan(0);

    for (const building of game.buildings.values()) {
      expect(building.zone).toBe('res');
      expect(building.level).toBe(1);
      expect(building.population).toBeGreaterThan(0);
    }
  });

  it('never grows anything on an unzoned tile', () => {
    buildRoad(game.world, row(12), 'path', 100_000);
    refresh();
    game.demand.res = 1;
    evaluateBuildings(game, fields, 3);
    expect(game.buildings.size).toBe(0);
  });

  it('levels up while the plot stays good, and stops at five', () => {
    seedNeighbourhood();
    evaluateBuildings(game, fields, 3);
    for (let i = 0; i < 400; i++) evaluateBuildings(game, fields, 3);

    const levels = [...game.buildings.values()].map((b) => b.level);
    expect(Math.max(...levels)).toBe(5);
  });

  it('gains housing capacity as it levels', () => {
    expect(capacityOf('res', 5)).toBeGreaterThan(capacityOf('res', 1));
    expect(capacityOf('com', 4)).toBeGreaterThan(capacityOf('com', 2));
  });

  it('declines and finally disappears when its road is taken away', () => {
    seedNeighbourhood();
    evaluateBuildings(game, fields, 3);
    const grown = game.buildings.size;
    expect(grown).toBeGreaterThan(0);

    removeRoad(game.world, row(12));
    refresh();
    // A level-1 building has nothing to shed, so it goes after one full timer.
    for (let i = 0; i < 12; i++) evaluateBuildings(game, fields, DECAY_DURATION_S / 2);
    expect(game.buildings.size).toBe(0);
  });

  it('demolishes a building whose zone was painted over', () => {
    seedNeighbourhood();
    evaluateBuildings(game, fields, 3);
    expect(game.buildings.size).toBeGreaterThan(0);

    paintZone(game.world, row(12, 1), 'ind', 100_000);
    evaluateBuildings(game, fields, 3);
    for (const building of game.buildings.values()) expect(building.zone).toBe('ind');
  });

  it('totals what the city has built', () => {
    seedNeighbourhood();
    evaluateBuildings(game, fields, 3);
    const totals = totalBuildings(game);
    expect(totals.housing).toBeGreaterThan(0);
    expect(totals.commercialJobs).toBe(0);
  });
});

describe('the whole loop', () => {
  it('grows a city from a road and a strip of housing, unattended', () => {
    // The Phase 2 acceptance test: draw a road, paint homes, watch it happen.
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(20), 'path', 100_000);
    paintZone(game.world, row(20, 1), 'res', 100_000);
    paintZone(game.world, row(20, 2), 'com', 100_000);
    systems.invalidateFields();

    for (let second = 0; second < 30; second++) {
      systems.step(game, 1);
      systems.stepEconomy(game, 1);
    }

    expect(game.buildings.size).toBeGreaterThan(0);
    expect(game.population).toBeGreaterThan(0);
    expect(game.ledger.taxIncome).toBeGreaterThan(0);
  });

  it('stops building once nobody wants what is on offer', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(20), 'path', 100_000);
    paintZone(game.world, row(20, 1), 'res', 100_000);
    systems.invalidateFields();

    for (let second = 0; second < 600; second++) systems.step(game, 1);
    // With no jobs anywhere, residential demand collapses and the strip stops
    // filling — the feedback loop, not a cap, is what limits growth.
    expect(game.demand.res).toBeLessThan(0.5);
  });
});
