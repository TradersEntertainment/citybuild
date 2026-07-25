import { beforeEach, describe, expect, it } from 'vitest';
import { BRIDGE_COST_MULTIPLIER, SEA_LEVEL } from '../src/data/balance';
import { ROAD_SPECS, isRoadUnlocked, tierOf } from '../src/data/roads';
import type { TilePoint } from '../src/input/pathGeometry';
import { buildRoad, estimateRoad, removeRoad, roadAt, tileCost } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { UndoStack } from '../src/sim/undo';
import { hashSeed } from '../src/sim/rng';
import { index, startingCentre } from '../src/sim/world';

let game: GameState;
let origin: { x: number; y: number };

beforeEach(() => {
  game = createGameState(hashSeed('test'), 0);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x), y: Math.floor(centre.y) };
  // Flatten a working strip so cost tests are not at the mercy of the seed.
  for (let x = origin.x - 30; x < origin.x + 30; x++) {
    for (let y = origin.y - 5; y < origin.y + 5; y++) {
      game.world.height[index(game.world, x, y)] = 0.5;
    }
  }
});

function strip(length: number, y = 0): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + y }));
}

describe('road costing', () => {
  it('charges the table price on flat ground', () => {
    const cost = tileCost(game.world, origin.x, origin.y, 'path');
    expect(cost.cost).toBe(ROAD_SPECS.path.cost);
    expect(cost.blocked).toBe(false);
    expect(cost.bridge).toBe(false);
  });

  it('charges six times as much to bridge water', () => {
    const at = index(game.world, origin.x + 1, origin.y);
    game.world.height[at] = SEA_LEVEL - 0.1;
    const cost = tileCost(game.world, origin.x + 1, origin.y, 'path');
    expect(cost.bridge).toBe(true);
    expect(cost.cost).toBeGreaterThanOrEqual(ROAD_SPECS.path.cost * BRIDGE_COST_MULTIPLIER);
  });

  it('charges more on a slope than on the flat', () => {
    game.world.height[index(game.world, origin.x + 2, origin.y)] = 0.5;
    game.world.height[index(game.world, origin.x + 3, origin.y)] = 0.9;
    game.world.height[index(game.world, origin.x + 1, origin.y)] = 0.1;
    const steep = tileCost(game.world, origin.x + 2, origin.y, 'path');
    expect(steep.cost).toBeGreaterThan(ROAD_SPECS.path.cost);
  });

  it('blocks tiles outside the owned parcel', () => {
    expect(tileCost(game.world, 2, 2, 'path').blocked).toBe(true);
  });

  it('treats an equal or better tier as redundant and free', () => {
    buildRoad(game.world, strip(3), 'path', game.money);
    const again = tileCost(game.world, origin.x, origin.y, 'path');
    expect(again.redundant).toBe(true);
    expect(again.cost).toBe(0);
  });

  it('charges only the difference when upgrading a tier', () => {
    buildRoad(game.world, strip(3), 'path', game.money);
    const upgrade = tileCost(game.world, origin.x, origin.y, 'asphalt');
    expect(upgrade.redundant).toBe(false);
    expect(upgrade.cost).toBe(ROAD_SPECS.asphalt.cost - ROAD_SPECS.path.cost);
  });

  it('prices the metro without terrain multipliers, being underground', () => {
    const at = index(game.world, origin.x + 4, origin.y);
    game.world.height[at] = SEA_LEVEL - 0.2;
    expect(tileCost(game.world, origin.x + 4, origin.y, 'metro').cost).toBe(
      ROAD_SPECS.metro.cost,
    );
  });
});

describe('estimateRoad', () => {
  it('adds up the whole stroke when it is affordable', () => {
    const estimate = estimateRoad(game.world, strip(10), 'path', game.money);
    expect(estimate.total).toBe(ROAD_SPECS.path.cost * 10);
    expect(estimate.affordable).toBe(10);
    expect(estimate.truncatedAt).toBe(-1);
  });

  it('marks where the money runs out instead of rejecting the stroke', () => {
    const budget = ROAD_SPECS.path.cost * 4;
    const estimate = estimateRoad(game.world, strip(20), 'path', budget);
    expect(estimate.affordable).toBe(4);
    expect(estimate.truncatedAt).toBe(4);
    expect(estimate.affordableCost).toBe(budget);
  });
});

describe('buildRoad', () => {
  it('lays the road and reports what it spent', () => {
    const result = buildRoad(game.world, strip(6), 'path', game.money);
    expect(result.spent).toBe(ROAD_SPECS.path.cost * 6);
    expect(result.changes.length).toBe(6);
    expect(roadAt(game.world, origin.x, origin.y)).toBe('path');
    expect(result.truncated).toBe(false);
  });

  it('truncates at the money instead of cancelling the whole line', () => {
    const result = buildRoad(game.world, strip(20), 'path', ROAD_SPECS.path.cost * 3);
    expect(result.changes.length).toBe(3);
    expect(result.truncated).toBe(true);
    expect(roadAt(game.world, origin.x + 2, origin.y)).toBe('path');
    expect(roadAt(game.world, origin.x + 3, origin.y)).toBeNull();
  });

  it('never spends more than the budget', () => {
    const budget = 130;
    const result = buildRoad(game.world, strip(40), 'path', budget);
    expect(result.spent).toBeLessThanOrEqual(budget);
  });

  it('upgrades in place rather than stacking roads', () => {
    buildRoad(game.world, strip(5), 'path', 10_000);
    const upgrade = buildRoad(game.world, strip(5), 'asphalt', 10_000);
    expect(roadAt(game.world, origin.x, origin.y)).toBe('asphalt');
    expect(upgrade.spent).toBe((ROAD_SPECS.asphalt.cost - ROAD_SPECS.path.cost) * 5);
  });

  it('does not downgrade when a lower tier is drawn over a higher one', () => {
    buildRoad(game.world, strip(5), 'asphalt', 10_000);
    const result = buildRoad(game.world, strip(5), 'path', 10_000);
    expect(result.spent).toBe(0);
    expect(roadAt(game.world, origin.x, origin.y)).toBe('asphalt');
  });
});

describe('removeRoad', () => {
  it('clears roads and costs nothing', () => {
    buildRoad(game.world, strip(5), 'path', 10_000);
    const result = removeRoad(game.world, strip(5));
    expect(result.spent).toBe(0);
    expect(result.changes.length).toBe(5);
    expect(roadAt(game.world, origin.x, origin.y)).toBeNull();
  });

  it('ignores tiles with nothing on them', () => {
    expect(removeRoad(game.world, strip(5)).changes.length).toBe(0);
  });
});

describe('undo', () => {
  it('restores the map and refunds the money', () => {
    const undo = new UndoStack();
    const before = game.money;
    const result = buildRoad(game.world, strip(8), 'path', game.money);
    game.money -= result.spent;
    undo.push({ changes: result.changes, spent: result.spent });

    expect(game.money).toBeLessThan(before);
    undo.undo(game);
    expect(game.money).toBe(before);
    expect(roadAt(game.world, origin.x, origin.y)).toBeNull();
  });

  it('restores the previous tier after an upgrade is undone', () => {
    const undo = new UndoStack();
    buildRoad(game.world, strip(4), 'path', 10_000);
    const upgrade = buildRoad(game.world, strip(4), 'asphalt', 10_000);
    undo.push({ changes: upgrade.changes, spent: upgrade.spent });

    undo.undo(game);
    expect(roadAt(game.world, origin.x, origin.y)).toBe('path');
  });

  it('brings back roads that were demolished', () => {
    const undo = new UndoStack();
    buildRoad(game.world, strip(4), 'path', 10_000);
    const removal = removeRoad(game.world, strip(4));
    undo.push({ changes: removal.changes, spent: 0 });

    undo.undo(game);
    expect(roadAt(game.world, origin.x, origin.y)).toBe('path');
  });

  it('remembers at most twenty actions', () => {
    const undo = new UndoStack();
    for (let i = 0; i < 30; i++) {
      undo.push({ changes: [{ x: i, y: 0, layer: 'road' as const, previous: 0 }], spent: 1 });
    }
    expect(undo.depth).toBe(20);
  });

  it('ignores actions that changed nothing', () => {
    const undo = new UndoStack();
    undo.push({ changes: [], spent: 0 });
    expect(undo.canUndo).toBe(false);
  });
});

describe('road table', () => {
  it('orders tiers by capacity and cost', () => {
    expect(tierOf('path')).toBeLessThan(tierOf('metro'));
    expect(ROAD_SPECS.boulevard.capacity).toBeGreaterThan(ROAD_SPECS.asphalt.capacity);
    expect(ROAD_SPECS.highway.cost).toBeGreaterThan(ROAD_SPECS.boulevard.cost);
  });

  it('gates tiers by era', () => {
    expect(isRoadUnlocked('path', 'founding')).toBe(true);
    expect(isRoadUnlocked('stone', 'founding')).toBe(false);
    expect(isRoadUnlocked('stone', 'village')).toBe(true);
    expect(isRoadUnlocked('metro', 'megacity')).toBe(true);
  });
});
