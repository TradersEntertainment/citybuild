import { DENSE_ZONE_MULTIPLIER, ZONE_COST } from '../data/balance';
import { isBuiltZone } from '../data/buildings';
import type { TilePoint } from '../input/pathGeometry';
import { isNationalHighway } from './highway';
import { decodeTerrain, decodeZone, encodeZone, NONE, type ZoneKind } from './tiles';
import { index, inBounds, isTileOwned, type World } from './world';

/**
 * Zone painting (§6.1). Painting a tile only grants permission — the building
 * arrives on its own, or does not, and that gap is where the whole game lives.
 *
 * Writes only the zone column. Buildings react to it on their own tick.
 */
export interface ZoneChange {
  x: number;
  y: number;
  layer: 'zone' | 'density';
  previous: number;
}

export interface ZoneResult {
  changes: ZoneChange[];
  spent: number;
  truncated: boolean;
}

export interface ZoneEstimate {
  /** Tiles that would actually change, in stroke order. */
  tiles: TilePoint[];
  total: number;
  affordable: number;
  affordableCost: number;
  truncatedAt: number;
}

/** Water cannot be zoned; everything else on owned land can. */
export function canZone(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y) || !isTileOwned(world, x, y)) return false;
  // The motorway reservation is not a plot: no houses on the hard shoulder.
  if (isNationalHighway(world, x, y)) return false;
  return decodeTerrain(world.terrain[index(world, x, y)] ?? 0) !== 'water';
}

/**
 * Expands a brush stroke into the distinct tiles it covers. The brush is a
 * square of `size` tiles centred on the finger — round brushes look better but
 * make it much harder to paint a block flush against a road.
 *
 * Bounds are the only filter, so this is also what the eraser sweeps with: a
 * bridge stands on water, which may never be zoned but must certainly be
 * removable.
 */
export function brushArea(
  world: World,
  path: readonly TilePoint[],
  size: number,
): TilePoint[] {
  const radius = Math.floor(size / 2);
  const tiles: TilePoint[] = [];
  const seen = new Set<number>();

  for (const point of path) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = point.x + dx;
        const y = point.y + dy;
        if (!inBounds(world, x, y)) continue;
        const key = y * 100_000 + x;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

/** The part of a brush stroke that may actually be painted. */
export function brushTiles(
  world: World,
  path: readonly TilePoint[],
  size: number,
): TilePoint[] {
  return brushArea(world, path, size).filter((tile) => canZone(world, tile.x, tile.y));
}

/** Prices a stroke, stopping at the balance rather than rejecting the whole. */
export function estimateZone(
  world: World,
  tiles: readonly TilePoint[],
  kind: ZoneKind | null,
  budget: number,
  /**
   * Whether this stroke is zoning for height (sim/density.ts).
   *
   * Part of the same stroke rather than a second tool: the player is deciding
   * what a block *is*, and "houses" and "tall houses" are one decision. It also
   * means a tile whose zone is unchanged but whose density is not still counts
   * as changed, so painting dense over an existing suburb works.
   */
  dense = false,
): ZoneEstimate {
  const cost = kind === null ? 0 : ZONE_COST[kind] * (dense ? DENSE_ZONE_MULTIPLIER : 1);
  const changed: TilePoint[] = [];
  let total = 0;
  let affordable = 0;
  let affordableCost = 0;
  let truncatedAt = -1;
  const wanted = dense ? 1 : 0;

  for (const tile of tiles) {
    const at = index(world, tile.x, tile.y);
    const current = world.zone[at] ?? NONE;
    // Already exactly this: same zone and same height permission. Upzoning a
    // block that is already the right kind is the common case, so comparing the
    // zone alone would price the whole stroke at nothing and change nothing.
    if (current === encodeZone(kind) && (world.density[at] ?? 0) === wanted) continue;
    changed.push(tile);
    total += cost;

    if (truncatedAt === -1 && affordableCost + cost <= budget) {
      affordableCost += cost;
      affordable = changed.length;
    } else if (truncatedAt === -1) {
      truncatedAt = changed.length - 1;
    }
  }

  return { tiles: changed, total, affordable, affordableCost, truncatedAt };
}

/**
 * Paints as much of the stroke as the balance allows. Clearing a zone (kind
 * null) is free, and leaves any building standing until the building system
 * notices its permission is gone.
 */
export function paintZone(
  world: World,
  tiles: readonly TilePoint[],
  kind: ZoneKind | null,
  budget: number,
  dense = false,
): ZoneResult {
  const estimate = estimateZone(world, tiles, kind, budget, dense);
  const changes: ZoneChange[] = [];
  const code = encodeZone(kind);
  let spent = 0;
  const cost = kind === null ? 0 : ZONE_COST[kind] * (dense ? DENSE_ZONE_MULTIPLIER : 1);
  // Only ground that grows buildings can be tall; clearing a zone clears the
  // permission with it, so no marker is ever left behind on bare ground.
  const wanted = dense && isBuiltZone(kind) ? 1 : 0;

  const limit = kind === null ? estimate.tiles.length : estimate.affordable;
  for (let i = 0; i < limit; i++) {
    const tile = estimate.tiles[i] as TilePoint;
    const at = index(world, tile.x, tile.y);
    changes.push({ x: tile.x, y: tile.y, layer: 'zone', previous: world.zone[at] ?? NONE });
    world.zone[at] = code;
    // Its own undo entry, because it is its own column: undoing a stroke that
    // upzoned a suburb has to put the suburb back, not just the zone kind.
    const before = world.density[at] ?? 0;
    if (before !== wanted) {
      changes.push({ x: tile.x, y: tile.y, layer: 'density', previous: before });
      world.density[at] = wanted;
    }
    spent += cost;
  }

  return { changes, spent, truncated: estimate.truncatedAt !== -1 };
}

export function zoneAt(world: World, x: number, y: number): ZoneKind | null {
  if (!inBounds(world, x, y)) return null;
  return decodeZone(world.zone[index(world, x, y)] ?? NONE);
}
