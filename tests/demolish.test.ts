import { beforeEach, describe, expect, it } from 'vitest';
import { DEMOLITION_REFUND } from '../src/data/balance';
import { SERVICE_SPECS } from '../src/data/services';
import { UTILITY_SPECS } from '../src/data/utilities';
import type { TilePoint } from '../src/input/pathGeometry';
import { demolishArea } from '../src/sim/demolish';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeRoadDistance, createFields } from '../src/sim/fields';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { placeService } from '../src/sim/services';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE } from '../src/sim/tiles';
import { UndoStack } from '../src/sim/undo';
import { placePlant } from '../src/sim/utilities';
import { index, startingCentre, type World } from '../src/sim/world';
import { brushArea, paintZone } from '../src/sim/zoning';

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
 * The eraser is the only apology the game can make for a mis-touch, so what it
 * covers is a correctness question rather than a convenience one: a tool called
 * "sil" that leaves zoning behind makes a wrong drag permanent past the
 * twentieth undo.
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

function at(x: number, y: number): number {
  return index(game.world, x, y);
}

beforeEach(() => {
  game = createGameState(hashSeed('demolish'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 8, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 20);
  game.money = 10_000_000;
  // Stations unlock from the village on; the founding era has nothing to erase.
  game.era = 'village';
  fields = createFields(game.world.size);
});

describe('what the eraser takes', () => {
  it('lifts the pavement', () => {
    buildRoad(game.world, row(6, 0), 'path', 1_000_000);
    demolishArea(game, row(6, 0));
    expect(game.world.road[at(origin.x + 3, origin.y)]).toBe(NONE);
  });

  it('scrubs zoning, which used to survive every erase there was', () => {
    paintZone(game.world, row(6, 1), 'res', 1_000_000);
    expect(game.world.zone[at(origin.x + 3, origin.y + 1)]).not.toBe(NONE);

    demolishArea(game, row(6, 1));
    expect(game.world.zone[at(origin.x + 3, origin.y + 1)]).toBe(NONE);
  });

  it('pulls down what grew there, rather than leaving it a second', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(10, 0), 'path', 1_000_000);
    paintZone(game.world, row(10, 1), 'res', 1_000_000);
    systems.invalidateFields();
    for (let s = 0; s < 40; s++) systems.step(game, 1);
    expect(game.buildings.size).toBeGreaterThan(0);

    const result = demolishArea(game, row(10, 1));
    expect(result.removed.buildings.length).toBeGreaterThan(0);
    expect(game.buildings.size).toBe(0);
    for (const point of row(10, 1)) {
      expect(game.world.building[at(point.x, point.y)]).toBe(0);
    }
  });

  it('removes a station, which had no way out of the world at all', () => {
    buildRoad(game.world, row(10, 0), 'path', 1_000_000);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    expect(placeService(game, fields, 'fire', spot.x, spot.y).ok).toBe(true);
    expect(game.services.size).toBe(1);

    const result = demolishArea(game, [spot]);
    expect(game.services.size).toBe(0);
    expect(result.removed.services).toHaveLength(1);
  });

  it('removes a plant', () => {
    buildRoad(game.world, row(10, 0), 'asphalt', 1_000_000);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    game.era = 'town';
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    expect(placePlant(game, fields, 'well', spot.x, spot.y).ok).toBe(true);

    demolishArea(game, [spot]);
    expect(game.utilities.size).toBe(0);
  });

  it('takes a bridge, which stands on ground that may never be zoned', () => {
    // A tile of water with a road over it: the zone brush refuses it, so an
    // eraser built on the zone brush would refuse it too.
    const water = { x: origin.x + 2, y: origin.y + 4 };
    game.world.terrain[at(water.x, water.y)] = 0;
    buildRoad(game.world, [water], 'path', 1_000_000);
    expect(game.world.road[at(water.x, water.y)]).not.toBe(NONE);

    const swept = brushArea(game.world, [water], 1);
    demolishArea(game, swept);
    expect(game.world.road[at(water.x, water.y)]).toBe(NONE);
  });

  it('charges nothing for ground', () => {
    buildRoad(game.world, row(6, 0), 'path', 1_000_000);
    paintZone(game.world, row(6, 1), 'res', 1_000_000);
    const result = demolishArea(game, [...row(6, 0), ...row(6, 1)]);
    expect(result.spent).toBe(0);
  });

  it('hands back half of a facility, as money the caller subtracts', () => {
    buildRoad(game.world, row(10, 0), 'path', 1_000_000);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    placeService(game, fields, 'fire', spot.x, spot.y);

    const before = game.money;
    const result = demolishArea(game, [spot]);
    // Negative spending, so `money -= spent` pays the player and undo reverses
    // it by sign like every other edit.
    expect(result.spent).toBe(-Math.round(SERVICE_SPECS.fire.cost * DEMOLITION_REFUND));
    game.money -= result.spent;
    expect(game.money).toBeGreaterThan(before);
  });

  it('erases an overlapping sweep once', () => {
    buildRoad(game.world, row(6, 0), 'path', 1_000_000);
    // The same tiles twice over, as a brush dragged back over itself delivers.
    const result = demolishArea(game, [...row(6, 0), ...row(6, 0)]);
    expect(result.changes).toHaveLength(6);
  });

  it('leaves untouched ground alone', () => {
    buildRoad(game.world, row(6, 0), 'path', 1_000_000);
    paintZone(game.world, row(6, 1), 'res', 1_000_000);
    demolishArea(game, row(6, 0));
    expect(game.world.zone[at(origin.x + 3, origin.y + 1)]).not.toBe(NONE);
  });
});

describe('undoing an erase', () => {
  it('puts the road and the zoning back', () => {
    buildRoad(game.world, row(6, 0), 'path', 1_000_000);
    paintZone(game.world, row(6, 1), 'res', 1_000_000);
    const road = game.world.road[at(origin.x + 3, origin.y)];
    const zone = game.world.zone[at(origin.x + 3, origin.y + 1)];

    const undo = new UndoStack();
    const result = demolishArea(game, [...row(6, 0), ...row(6, 1)]);
    undo.push({ changes: result.changes, spent: result.spent, removed: result.removed });
    undo.undo(game);

    expect(game.world.road[at(origin.x + 3, origin.y)]).toBe(road);
    expect(game.world.zone[at(origin.x + 3, origin.y + 1)]).toBe(zone);
  });

  it('gives a grown block back at the level it had reached', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(10, 0), 'path', 1_000_000);
    paintZone(game.world, row(10, 1), 'res', 1_000_000);
    systems.invalidateFields();
    for (let s = 0; s < 120; s++) systems.step(game, 1);

    const grown = [...game.buildings.values()].sort((a, b) => b.level - a.level)[0];
    expect(grown).toBeDefined();
    const level = grown!.level;
    expect(level).toBeGreaterThan(1);

    const undo = new UndoStack();
    const result = demolishArea(game, row(10, 1));
    undo.push({ changes: result.changes, spent: result.spent, removed: result.removed });
    undo.undo(game);

    const restored = game.buildings.get(grown!.id);
    expect(restored?.level).toBe(level);
    expect(game.world.building[at(grown!.x, grown!.y)]).toBe(grown!.id);
  });

  it('rebuilds a station and takes the refund back', () => {
    buildRoad(game.world, row(10, 0), 'path', 1_000_000);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    placeService(game, fields, 'fire', spot.x, spot.y);
    const before = game.money;

    const undo = new UndoStack();
    const result = demolishArea(game, [spot]);
    game.money -= result.spent;
    undo.push({ changes: result.changes, spent: result.spent, removed: result.removed });
    undo.undo(game);

    expect(game.services.size).toBe(1);
    expect(game.money).toBe(before);
  });

  it('is recorded even when the erase changed no tile at all', () => {
    buildRoad(game.world, row(10, 0), 'path', 1_000_000);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    placeService(game, fields, 'fire', spot.x, spot.y);

    const undo = new UndoStack();
    const result = demolishArea(game, [spot]);
    // A station occupies no column, so its removal produces no TileEdit — the
    // stack has to notice the entity list or the undo silently vanishes.
    expect(result.changes).toHaveLength(0);
    undo.push({ changes: result.changes, spent: result.spent, removed: result.removed });
    expect(undo.canUndo).toBe(true);
  });

  it('still ignores an erase that hit nothing', () => {
    const undo = new UndoStack();
    const result = demolishArea(game, row(6, 6));
    undo.push({ changes: result.changes, spent: result.spent, removed: result.removed });
    expect(undo.canUndo).toBe(false);
  });
});

describe('erasing a plant stops it supplying', () => {
  it('takes its upkeep off the books', () => {
    buildRoad(game.world, row(10, 0), 'asphalt', 1_000_000);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    game.era = 'town';
    const spot = { x: origin.x + 4, y: origin.y + 1 };
    placePlant(game, fields, 'well', spot.x, spot.y);
    expect(UTILITY_SPECS.well.upkeep).toBeGreaterThan(0);

    demolishArea(game, [spot]);
    expect(game.utilities.size).toBe(0);
  });
});
