/**
 * Geometric primitives the road smoother is built from (§5.1). Kept apart from
 * the smoothing policy so the policy file stays readable: nothing here knows
 * what a road is, it only knows polylines, and every function is pure.
 */
import { PATH_MAX_TILES } from '../data/balance';

export interface TilePoint {
  x: number;
  y: number;
}

interface PrefixSums {
  x: Float64Array;
  y: Float64Array;
}

export function prefixSums(points: readonly TilePoint[]): PrefixSums {
  const x = new Float64Array(points.length + 1);
  const y = new Float64Array(points.length + 1);
  for (let i = 0; i < points.length; i++) {
    const point = points[i] as TilePoint;
    x[i + 1] = (x[i] ?? 0) + point.x;
    y[i + 1] = (y[i] ?? 0) + point.y;
  }
  return { x, y };
}

/** Mean of points[from..to] inclusive, in O(1). */
export function centroid(sums: PrefixSums, from: number, to: number): TilePoint {
  const count = to - from + 1;
  return {
    x: ((sums.x[to + 1] ?? 0) - (sums.x[from] ?? 0)) / count,
    y: ((sums.y[to + 1] ?? 0) - (sums.y[from] ?? 0)) / count,
  };
}

export function arcLengths(points: readonly TilePoint[]): Float64Array {
  const lengths = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as TilePoint;
    const b = points[i] as TilePoint;
    lengths[i] = (lengths[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y);
  }
  return lengths;
}

export function seekBack(cumulative: Float64Array, from: number, distance: number): number {
  const target = (cumulative[from] ?? 0) - distance;
  let i = from;
  while (i > 0 && (cumulative[i] ?? 0) > target) i--;
  return i;
}

export function seekForward(cumulative: Float64Array, from: number, distance: number): number {
  const target = (cumulative[from] ?? 0) + distance;
  let i = from;
  while (i < cumulative.length - 1 && (cumulative[i] ?? 0) < target) i++;
  return i;
}

/** Signed turn at `vertex` going from `before` to `after`. */
export function angleBetween(vertex: TilePoint, before: TilePoint, after: TilePoint): number {
  const inbound = Math.atan2(vertex.y - before.y, vertex.x - before.x);
  const outbound = Math.atan2(after.y - vertex.y, after.x - vertex.x);
  let delta = outbound - inbound;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

// --- Stage 2: simplify -------------------------------------------------------

/**
 * Ramer–Douglas–Peucker. The tolerance is deliberately coarse (3 tiles): it has
 * to swallow hand tremor, and anything it keeps is a corner the player meant.
 */
export function simplify(points: readonly TilePoint[], tolerance: number): TilePoint[] {
  if (points.length <= 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const first = points[0] as TilePoint;
  const last = points[points.length - 1] as TilePoint;

  let farthest = 0;
  let farthestIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i] as TilePoint, first, last);
    if (d > farthest) {
      farthest = d;
      farthestIndex = i;
    }
  }

  if (farthest <= tolerance) return [{ ...first }, { ...last }];

  const left = simplify(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplify(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function perpendicularDistance(point: TilePoint, a: TilePoint, b: TilePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(point.x - (a.x + clamped * dx), point.y - (a.y + clamped * dy));
}

// --- Stage 3b: soften deliberate curves --------------------------------------

/** Chaikin corner cutting; endpoints stay put so the road starts where asked. */
export function chaikin(points: readonly TilePoint[], passes: number): TilePoint[] {
  let current = points.map((p) => ({ x: p.x, y: p.y }));

  for (let pass = 0; pass < passes; pass++) {
    if (current.length < 3) break;
    const next: TilePoint[] = [current[0] as TilePoint];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i] as TilePoint;
      const b = current[i + 1] as TilePoint;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(current[current.length - 1] as TilePoint);
    current = next;
  }
  return current;
}

// --- Stage 4: rasterise ------------------------------------------------------

/** Polyline → connected tiles, 8-connected so 45° roads stay unbroken. */
export function rasterize(polyline: readonly TilePoint[]): TilePoint[] {
  const tiles: TilePoint[] = [];
  const seen = new Set<number>();

  const push = (x: number, y: number): boolean => {
    const key = y * 100_000 + x;
    if (seen.has(key)) return true;
    seen.add(key);
    tiles.push({ x, y });
    return tiles.length < PATH_MAX_TILES;
  };

  const first = polyline[0];
  if (!first) return tiles;
  if (!push(Math.round(first.x), Math.round(first.y))) return tiles;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = roundPoint(polyline[i] as TilePoint);
    const b = roundPoint(polyline[i + 1] as TilePoint);
    if (!line(a, b, push)) return thin(tiles);
  }
  return thin(tiles);
}

/**
 * Drops tiles the chain does not need. Rounding a shallow curve to whole tiles
 * leaves the occasional one-tile detour, which the renderer then draws as a
 * spur hanging off an otherwise clean road. A tile whose neighbours in the
 * chain already touch each other contributes nothing but that wart.
 */
function thin(tiles: readonly TilePoint[]): TilePoint[] {
  if (tiles.length < 3) return [...tiles];

  const kept: TilePoint[] = [tiles[0] as TilePoint];
  for (let i = 1; i < tiles.length - 1; i++) {
    const previous = kept[kept.length - 1] as TilePoint;
    const next = tiles[i + 1] as TilePoint;
    if (Math.max(Math.abs(next.x - previous.x), Math.abs(next.y - previous.y)) <= 1) continue;
    kept.push(tiles[i] as TilePoint);
  }
  kept.push(tiles[tiles.length - 1] as TilePoint);
  return kept;
}

function line(a: TilePoint, b: TilePoint, push: (x: number, y: number) => boolean): boolean {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    if (x === b.x && y === b.y) return true;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
    if (!push(x, y)) return false;
  }
}

export function roundPoint(point: TilePoint): TilePoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
