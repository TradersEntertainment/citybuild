import { ZONE_COST } from '../data/balance';
import type { TilePoint } from '../input/pathGeometry';
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
  layer: 'zone';
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
  return decodeTerrain(world.terrain[index(world, x, y)] ?? 0) !== 'water';
}

/**
 * Expands a brush stroke into the distinct tiles it covers. The brush is a
 * square of `size` tiles centred on the finger — round brushes look better but
 * make it much harder to paint a block flush against a road.
 */
export function brushTiles(
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
        if (!canZone(world, x, y)) continue;
        const key = y * 100_000 + x;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

/** Prices a stroke, stopping at the balance rather than rejecting the whole. */
export function estimateZone(
  world: World,
  tiles: readonly TilePoint[],
  kind: ZoneKind | null,
  budget: number,
): ZoneEstimate {
  const cost = kind === null ? 0 : ZONE_COST[kind];
  const changed: TilePoint[] = [];
  let total = 0;
  let affordable = 0;
  let affordableCost = 0;
  let truncatedAt = -1;

  for (const tile of tiles) {
    const current = world.zone[index(world, tile.x, tile.y)] ?? NONE;
    if (current === encodeZone(kind)) continue; // already this zone
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
): ZoneResult {
  const estimate = estimateZone(world, tiles, kind, budget);
  const changes: ZoneChange[] = [];
  const code = encodeZone(kind);
  let spent = 0;
  const cost = kind === null ? 0 : ZONE_COST[kind];

  const limit = kind === null ? estimate.tiles.length : estimate.affordable;
  for (let i = 0; i < limit; i++) {
    const tile = estimate.tiles[i] as TilePoint;
    const at = index(world, tile.x, tile.y);
    changes.push({ x: tile.x, y: tile.y, layer: 'zone', previous: world.zone[at] ?? NONE });
    world.zone[at] = code;
    spent += cost;
  }

  return { changes, spent, truncated: estimate.truncatedAt !== -1 };
}

export function zoneAt(world: World, x: number, y: number): ZoneKind | null {
  if (!inBounds(world, x, y)) return null;
  return decodeZone(world.zone[index(world, x, y)] ?? NONE);
}
