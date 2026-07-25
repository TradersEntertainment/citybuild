import { BRIDGE_COST_MULTIPLIER, SLOPE_COST_FACTOR } from '../data/balance';
import { ROAD_SPECS, tierOf } from '../data/roads';
import type { TilePoint } from '../input/pathGeometry';
import type { TileEdit } from './undo';
import { decodeRoad, encodeRoad, NONE, type RoadKind } from './tiles';
import { index, inBounds, isTileOwned, type World } from './world';
import { isWater, slopeAt } from './worldgen';

/**
 * Road placement and costing (§5.2). Writes only the road column; the graph
 * and traffic arrive in Phase 3.
 *
 * Running out of money truncates the line where the money ran out rather than
 * cancelling the whole stroke (§5.1) — on a phone a long drag is expensive to
 * repeat, and voiding it is a punishment for a mis-estimate.
 */
export interface TileCost {
  x: number;
  y: number;
  cost: number;
  /** Already carries this tier or better: nothing to build, nothing to charge. */
  redundant: boolean;
  /** Outside owned parcels, or off-grid. */
  blocked: boolean;
  /** Crossing water, so it is a bridge at 6× (§4). */
  bridge: boolean;
}

export interface RoadEstimate {
  tiles: TileCost[];
  /** Cost of every buildable tile in the stroke. */
  total: number;
  /** Tiles the current balance actually covers. */
  affordable: number;
  affordableCost: number;
  /** Index where money ran out, or -1 when the whole line is affordable. */
  truncatedAt: number;
}

/** Cost of laying `kind` on one tile, including slope, bridge and upgrades. */
export function tileCost(world: World, x: number, y: number, kind: RoadKind): TileCost {
  const spec = ROAD_SPECS[kind];
  const result: TileCost = { x, y, cost: 0, redundant: false, blocked: false, bridge: false };

  if (!inBounds(world, x, y) || !isTileOwned(world, x, y)) {
    result.blocked = true;
    return result;
  }

  const existing = decodeRoad(world.road[index(world, x, y)] ?? NONE);
  if (existing !== null && tierOf(existing) >= tierOf(kind)) {
    result.redundant = true;
    return result;
  }

  // An upgrade pays only the difference to the tier already in the ground.
  const base = existing === null ? spec.cost : spec.cost - ROAD_SPECS[existing].cost;

  if (spec.underground) {
    // Metro runs below the surface: terrain does not price it (§5.2).
    result.cost = Math.round(base);
    return result;
  }

  const bridge = isWater(world, x, y);
  const slopeMultiplier = 1 + slopeAt(world, x, y) * SLOPE_COST_FACTOR;
  result.bridge = bridge;
  result.cost = Math.round(base * slopeMultiplier * (bridge ? BRIDGE_COST_MULTIPLIER : 1));
  return result;
}

/** Prices a whole stroke and works out how much of it the balance covers. */
export function estimateRoad(
  world: World,
  path: readonly TilePoint[],
  kind: RoadKind,
  budget: number,
): RoadEstimate {
  const tiles: TileCost[] = [];
  let total = 0;
  let affordable = 0;
  let affordableCost = 0;
  let truncatedAt = -1;

  for (let i = 0; i < path.length; i++) {
    const point = path[i] as TilePoint;
    const cost = tileCost(world, point.x, point.y, kind);
    tiles.push(cost);
    if (cost.blocked || cost.redundant) {
      // Redundant tiles still count as "reached" so a stroke crossing an
      // existing road does not read as truncated there.
      if (truncatedAt === -1) affordable = i + 1;
      continue;
    }

    total += cost.cost;
    if (truncatedAt === -1 && affordableCost + cost.cost <= budget) {
      affordableCost += cost.cost;
      affordable = i + 1;
    } else if (truncatedAt === -1) {
      truncatedAt = i;
    }
  }

  return { tiles, total, affordable, affordableCost, truncatedAt };
}

export interface BuildResult {
  changes: TileEdit[];
  spent: number;
  /** True when the balance cut the line short. */
  truncated: boolean;
}

/**
 * Lays as much of the path as the budget allows. Returns the changes so the
 * undo stack can reverse them exactly, including tiers overwritten by an
 * upgrade.
 */
export function buildRoad(
  world: World,
  path: readonly TilePoint[],
  kind: RoadKind,
  budget: number,
): BuildResult {
  const estimate = estimateRoad(world, path, kind, budget);
  const changes: TileEdit[] = [];
  let spent = 0;

  for (let i = 0; i < estimate.affordable; i++) {
    const tile = estimate.tiles[i] as TileCost;
    if (tile.blocked || tile.redundant) continue;
    const at = index(world, tile.x, tile.y);
    changes.push({ x: tile.x, y: tile.y, layer: 'road', previous: world.road[at] ?? NONE });
    world.road[at] = encodeRoad(kind);
    spent += tile.cost;
  }

  return { changes, spent, truncated: estimate.truncatedAt !== -1 };
}

/** Demolition (§5.1). Free, and undoable like everything else. */
export function removeRoad(world: World, path: readonly TilePoint[]): BuildResult {
  const changes: TileEdit[] = [];

  for (const point of path) {
    if (!inBounds(world, point.x, point.y)) continue;
    const at = index(world, point.x, point.y);
    const previous = world.road[at] ?? NONE;
    if (previous === NONE) continue;
    changes.push({ x: point.x, y: point.y, layer: 'road', previous });
    world.road[at] = NONE;
  }

  return { changes, spent: 0, truncated: false };
}

export function roadAt(world: World, x: number, y: number): RoadKind | null {
  if (!inBounds(world, x, y)) return null;
  return decodeRoad(world.road[index(world, x, y)] ?? NONE);
}
