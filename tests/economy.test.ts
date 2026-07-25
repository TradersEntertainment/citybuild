import { beforeEach, describe, expect, it } from 'vitest';
import { ROAD_SPECS } from '../src/data/roads';
import { ZONE_COST } from '../src/data/balance';
import type { TilePoint } from '../src/input/pathGeometry';
import { evaluateBuildings } from '../src/sim/buildings';
import { computeLandValue, computeRoadDistance, createFields } from '../src/sim/fields';
import { computeLedger, roadUpkeep, stepEconomy } from '../src/sim/economy';
import { migrationPerMinute } from '../src/sim/population';
import { eraForPopulation, nextEraGap, stepProgression } from '../src/sim/progression';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { index, startingCentre } from '../src/sim/world';
import { brushTiles, canZone, estimateZone, paintZone, zoneAt } from '../src/sim/zoning';

let game: GameState;
let fields: ReturnType<typeof createFields>;
let origin: { x: number; y: number };

function row(length: number, dy = 0): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

beforeEach(() => {
  game = createGameState(hashSeed('economy'), 0);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 10, y: Math.floor(centre.y) };
  for (let y = origin.y - 8; y <= origin.y + 8; y++) {
    for (let x = origin.x - 8; x <= origin.x + 24; x++) {
      const i = index(game.world, x, y);
      game.world.height[i] = 0.5;
      game.world.terrain[i] = 2;
    }
  }
  fields = createFields(game.world.size);
  computeRoadDistance(game.world, fields.roadDistance);
  computeLandValue(game.world, fields);
});

describe('zoning', () => {
  it('charges the table price per tile', () => {
    const estimate = estimateZone(game.world, row(10), 'res', 1e6);
    expect(estimate.total).toBe(ZONE_COST.res * 10);
  });

  it('stops at the balance instead of rejecting the stroke', () => {
    const budget = ZONE_COST.res * 3;
    const result = paintZone(game.world, row(10), 'res', budget);
    expect(result.spent).toBe(budget);
    expect(result.truncated).toBe(true);
    expect(zoneAt(game.world, origin.x + 2, origin.y)).toBe('res');
    expect(zoneAt(game.world, origin.x + 3, origin.y)).toBeNull();
  });

  it('charges nothing to repaint a tile with the zone it already has', () => {
    paintZone(game.world, row(6), 'res', 1e6);
    expect(estimateZone(game.world, row(6), 'res', 1e6).total).toBe(0);
  });

  it('clears a zone for free', () => {
    paintZone(game.world, row(6), 'res', 1e6);
    const cleared = paintZone(game.world, row(6), null, 0);
    expect(cleared.spent).toBe(0);
    expect(zoneAt(game.world, origin.x, origin.y)).toBeNull();
  });

  it('refuses water and land the player does not own', () => {
    game.world.terrain[index(game.world, origin.x, origin.y)] = 0; // water
    expect(canZone(game.world, origin.x, origin.y)).toBe(false);
    expect(canZone(game.world, 3, 3)).toBe(false);
  });

  it('stamps a square brush and never repeats a tile', () => {
    const tiles = brushTiles(game.world, row(4), 3);
    const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(tiles.length);
    // A 4-long stroke with a 3-wide brush covers 6 columns by 3 rows.
    expect(tiles.length).toBe(18);
  });
});

describe('ledger', () => {
  it('charges upkeep for every road tile', () => {
    buildRoad(game.world, row(10), 'path', 1e6);
    expect(roadUpkeep(game)).toBeCloseTo(ROAD_SPECS.path.upkeep * 10, 6);
  });

  it('taxes residents, and taxes them more on better land', () => {
    buildRoad(game.world, row(12), 'path', 1e6);
    paintZone(game.world, row(12, 1), 'res', 1e6);
    computeRoadDistance(game.world, fields.roadDistance);
    computeLandValue(game.world, fields);
    game.demand.res = 1;
    evaluateBuildings(game, fields, 3);

    const base = computeLedger(game, fields).taxIncome;
    expect(base).toBeGreaterThan(0);

    for (let i = 0; i < fields.landValue.length; i++) fields.landValue[i] = 100;
    expect(computeLedger(game, fields).taxIncome).toBeGreaterThan(base);
  });

  it('earns nothing at a zero tax rate', () => {
    buildRoad(game.world, row(12), 'path', 1e6);
    paintZone(game.world, row(12, 1), 'res', 1e6);
    computeRoadDistance(game.world, fields.roadDistance);
    game.demand.res = 1;
    evaluateBuildings(game, fields, 3);

    game.taxRate = 0;
    expect(computeLedger(game, fields).taxIncome).toBe(0);
  });

  it('never lets the balance go negative', () => {
    buildRoad(game.world, row(40), 'path', 1e6);
    game.money = 1;
    for (let i = 0; i < 200; i++) stepEconomy(game, fields, 60);
    expect(game.money).toBe(0);
  });

  it('counts farm yield from painted farmland', () => {
    paintZone(game.world, row(5), 'farm', 1e6);
    expect(computeLedger(game, fields).farmYield).toBeGreaterThan(0);
  });
});

describe('migration', () => {
  it('is zero without vacant homes', () => {
    expect(migrationPerMinute(80, 0)).toBe(0);
  });

  it('is positive for a content city and negative for a miserable one', () => {
    expect(migrationPerMinute(80, 100)).toBeGreaterThan(0);
    expect(migrationPerMinute(20, 100)).toBeLessThan(0);
  });

  it('sits at zero exactly at the pivot', () => {
    expect(migrationPerMinute(40, 100)).toBe(0);
  });
});

describe('eras', () => {
  it('follows the population thresholds', () => {
    expect(eraForPopulation(0)).toBe('founding');
    expect(eraForPopulation(149)).toBe('founding');
    expect(eraForPopulation(150)).toBe('village');
    expect(eraForPopulation(1_500)).toBe('town');
    expect(eraForPopulation(2_000_000)).toBe('megacity');
  });

  it('reports what the next era needs', () => {
    const gap = nextEraGap(100);
    expect(gap?.era).toBe('village');
    expect(gap?.remaining).toBe(50);
    expect(nextEraGap(2_000_000)).toBeNull();
  });

  it('advances once and only forward', () => {
    game.population = 200;
    expect(stepProgression(game)).toBe('village');
    expect(stepProgression(game)).toBeNull();

    // A city that shrinks does not lose the tools it earned.
    game.population = 0;
    expect(stepProgression(game)).toBeNull();
    expect(game.era).toBe('village');
  });
});
