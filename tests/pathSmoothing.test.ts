import { describe, expect, it } from 'vitest';
import { SNAP_AXIS_TILES } from '../src/data/balance';
import {
  chaikin,
  rasterize,
  simplify,
  type TilePoint,
} from '../src/input/pathGeometry';
import { buildRoadPath, findCorners, snapDelta } from '../src/input/pathSmoothing';

/**
 * A wobbly drag, the way a thumb actually produces one: a slow drift of a few
 * tiles across the whole stroke, plus a small fast jitter between samples.
 * Deterministic, so the test cannot flake.
 */
function shakyLine(from: TilePoint, to: TilePoint, samples: number, wobble: number): TilePoint[] {
  const points: TilePoint[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const normalX = -dy / (Math.hypot(dx, dy) || 1);
  const normalY = dx / (Math.hypot(dx, dy) || 1);

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const drift = Math.sin(t * Math.PI * 1.5) * wobble;
    const jitter = Math.sin(i * 1.9) * 0.22;
    const offset = drift + jitter;
    points.push({
      x: from.x + dx * t + normalX * offset,
      y: from.y + dy * t + normalY * offset,
    });
  }
  return points;
}

/** Joints that turn hard enough to read as a mitre rather than a bend. */
function sharpTurnCount(polyline: readonly TilePoint[]): number {
  let count = 0;
  for (let i = 2; i < polyline.length; i++) {
    const a = polyline[i - 2] as TilePoint;
    const b = polyline[i - 1] as TilePoint;
    const c = polyline[i] as TilePoint;
    const first = Math.atan2(b.y - a.y, b.x - a.x);
    const second = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = Math.abs(second - first);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta > 1.0) count++;
  }
  return count;
}

describe('snapDelta', () => {
  it('flattens a small vertical drift onto the horizontal axis', () => {
    expect(snapDelta(30, 4)).toEqual({ x: 30, y: 0 });
  });

  it('flattens a small horizontal drift onto the vertical axis', () => {
    expect(snapDelta(-3, 26)).toEqual({ x: 0, y: 26 });
  });

  it('locks a near-square delta to exactly 45°', () => {
    const snapped = snapDelta(20, 18);
    expect(Math.abs(snapped.x)).toBe(Math.abs(snapped.y));
    expect(Math.sign(snapped.x)).toBe(1);
    expect(Math.sign(snapped.y)).toBe(1);
  });

  it('prefers the diagonal over an axis when the drag is stubby but square', () => {
    // 8x7 is within the axis tolerance, but calling it horizontal would throw
    // away seven tiles of intent.
    const snapped = snapDelta(8, 7);
    expect(Math.abs(snapped.x)).toBe(Math.abs(snapped.y));
  });

  it('keeps a genuine oblique line untouched', () => {
    const delta = { x: 40, y: 17 };
    expect(delta.y).toBeGreaterThan(SNAP_AXIS_TILES);
    expect(snapDelta(delta.x, delta.y)).toEqual(delta);
  });

  it('preserves direction signs', () => {
    expect(snapDelta(-30, 2)).toEqual({ x: -30, y: 0 });
    const diagonal = snapDelta(-14, 15);
    expect(Math.sign(diagonal.x)).toBe(-1);
    expect(Math.sign(diagonal.y)).toBe(1);
  });
});

describe('simplify', () => {
  it('collapses a noisy straight run to its endpoints', () => {
    const points = shakyLine({ x: 0, y: 0 }, { x: 60, y: 0 }, 60, 1.4);
    expect(simplify(points, 3).length).toBe(2);
  });

  it('keeps a real corner', () => {
    const points = [
      ...shakyLine({ x: 0, y: 0 }, { x: 30, y: 0 }, 30, 0.4),
      ...shakyLine({ x: 30, y: 0 }, { x: 30, y: 30 }, 30, 0.4),
    ];
    expect(simplify(points, 3).length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildRoadPath', () => {
  it('turns a shaky horizontal drag into a perfectly straight road', () => {
    const path = buildRoadPath(shakyLine({ x: 10, y: 40 }, { x: 70, y: 40 }, 90, 2.2));
    expect(path.curved).toBe(false);
    const rows = new Set(path.tiles.map((t) => t.y));
    expect(rows.size).toBe(1);
    expect(path.tiles.length).toBeGreaterThan(50);
  });

  it('locks a roughly diagonal drag to a clean 45°', () => {
    const raw: TilePoint[] = [];
    for (let i = 0; i <= 40; i++) {
      raw.push({ x: 10 + i, y: 10 + i * 0.93 + Math.sin(i) * 0.8 });
    }
    const path = buildRoadPath(raw);
    expect(path.curved).toBe(false);
    // Every step moves one tile in both axes.
    for (let i = 1; i < path.tiles.length; i++) {
      const a = path.tiles[i - 1] as TilePoint;
      const b = path.tiles[i] as TilePoint;
      expect(Math.abs(b.x - a.x)).toBe(1);
      expect(Math.abs(b.y - a.y)).toBe(1);
    }
  });

  it('keeps an L-shaped drag as two clean legs, not a curve', () => {
    const raw = [
      ...shakyLine({ x: 20, y: 20 }, { x: 60, y: 20 }, 40, 1.2),
      ...shakyLine({ x: 60, y: 20 }, { x: 60, y: 60 }, 40, 1.2),
    ];
    const path = buildRoadPath(raw);
    expect(path.curved).toBe(false);
    const rows = new Set(path.tiles.map((t) => t.y));
    const cols = new Set(path.tiles.map((t) => t.x));
    // One horizontal leg plus one vertical leg.
    expect(rows.size).toBeGreaterThan(30);
    expect(cols.size).toBeGreaterThan(30);
  });

  it('preserves a deliberate curve instead of straightening it', () => {
    const raw: TilePoint[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * Math.PI;
      raw.push({ x: 40 + Math.cos(t) * 25, y: 40 + Math.sin(t) * 25 });
    }
    const path = buildRoadPath(raw);
    expect(path.curved).toBe(true);
    // A straightened arc would have collapsed onto its chord.
    const rows = new Set(path.tiles.map((t) => t.y));
    expect(rows.size).toBeGreaterThan(10);
  });

  it('produces a connected tile chain with no gaps', () => {
    const raw: TilePoint[] = [];
    for (let i = 0; i <= 50; i++) {
      raw.push({ x: 10 + i * 0.9, y: 10 + Math.sin(i / 6) * 14 });
    }
    const path = buildRoadPath(raw);
    for (let i = 1; i < path.tiles.length; i++) {
      const a = path.tiles[i - 1] as TilePoint;
      const b = path.tiles[i] as TilePoint;
      expect(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))).toBe(1);
    }
  });

  it('keeps a modest arc curved, not folded into a V', () => {
    // The failure this guards against: a short bow being simplified down to
    // two straight legs meeting at a point.
    const raw: TilePoint[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      raw.push({ x: 30 + t * 22, y: 40 + Math.sin(t * Math.PI) * 14 });
    }
    const path = buildRoadPath(raw);
    expect(path.curved).toBe(true);
    // A V would turn once, sharply.
    expect(sharpTurnCount(path.polyline)).toBe(0);
  });

  it('rounds a bow too tight for the grid to curve, rather than mitring it', () => {
    // 10 tiles wide by 6 deep: too tight for the grid to express as an arc, so
    // it snaps to two legs. What matters is that the apex is a fillet, not a
    // point — the flag may say straight, the road must still read as a bend.
    const raw: TilePoint[] = [];
    for (let i = 1; i <= 30; i++) {
      const t = i / 30;
      raw.push({ x: 7 + t * 10.6, y: 27 + Math.sin(t * Math.PI) * 6.9 });
    }
    const path = buildRoadPath(raw);
    expect(sharpTurnCount(path.polyline)).toBe(0);
  });

  it('rounds the corner of an L instead of mitring it', () => {
    const raw = [
      ...shakyLine({ x: 20, y: 20 }, { x: 60, y: 20 }, 40, 0.8),
      ...shakyLine({ x: 60, y: 20 }, { x: 60, y: 60 }, 40, 0.8),
    ];
    const path = buildRoadPath(raw);
    expect(sharpTurnCount(path.polyline)).toBe(0);
    // Still two recognisable legs, not a wandering curve.
    expect(path.polyline.length).toBeLessThan(14);
  });

  it('does not invent corners in a wobbly line', () => {
    const raw = shakyLine({ x: 10, y: 50 }, { x: 90, y: 50 }, 120, 2.5);
    expect(findCorners(raw)).toEqual([0, raw.length - 1]);
  });

  it('finds exactly one corner in an L', () => {
    const raw = [
      ...shakyLine({ x: 20, y: 20 }, { x: 60, y: 20 }, 40, 0.8),
      ...shakyLine({ x: 60, y: 20 }, { x: 60, y: 60 }, 40, 0.8),
    ];
    expect(findCorners(raw).length).toBe(3); // start, corner, end
  });

  it('leaves no redundant tile that would render as a spur', () => {
    const raw: TilePoint[] = [];
    for (let i = 1; i <= 30; i++) {
      const t = i / 30;
      raw.push({ x: 7 + t * 10.6, y: 27 + Math.sin(t * Math.PI) * 6.9 });
    }
    const { tiles } = buildRoadPath(raw);
    for (let i = 1; i < tiles.length - 1; i++) {
      const previous = tiles[i - 1] as TilePoint;
      const next = tiles[i + 1] as TilePoint;
      const touching =
        Math.max(Math.abs(next.x - previous.x), Math.abs(next.y - previous.y)) <= 1;
      expect(touching).toBe(false);
    }
  });

  it('handles degenerate strokes', () => {
    expect(buildRoadPath([]).tiles).toEqual([]);
    expect(buildRoadPath([{ x: 5, y: 5 }]).tiles).toEqual([{ x: 5, y: 5 }]);
    // A tap that never moved is one tile, not a crash.
    const tap = buildRoadPath([
      { x: 5.1, y: 5.2 },
      { x: 5.1, y: 5.2 },
    ]);
    expect(tap.tiles).toEqual([{ x: 5, y: 5 }]);
  });

  it('starts the road where the finger touched down', () => {
    const path = buildRoadPath(shakyLine({ x: 12, y: 33 }, { x: 50, y: 33 }, 40, 1.5));
    expect(path.tiles[0]).toEqual({ x: 12, y: 33 });
  });
});

describe('chaikin and rasterize', () => {
  it('keeps the endpoints when smoothing', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 12 },
      { x: 22, y: 4 },
    ];
    const smoothed = chaikin(points, 3);
    expect(smoothed[0]).toEqual({ x: 0, y: 0 });
    expect(smoothed[smoothed.length - 1]).toEqual({ x: 22, y: 4 });
  });

  it('never emits the same tile twice', () => {
    const tiles = rasterize([
      { x: 0, y: 0 },
      { x: 12, y: 3 },
      { x: 4, y: 3 },
    ]);
    const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });
});
