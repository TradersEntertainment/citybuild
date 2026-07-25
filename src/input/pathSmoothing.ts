import {
  PATH_CORNER_ANGLE,
  PATH_CORNER_SUPPRESSION,
  PATH_CORNER_WINDOW_TILES,
  PATH_CURVE_SAGITTA_RATIO,
  PATH_CURVE_SAGITTA_TILES,
  PATH_CURVE_SIMPLIFY_TILES,
  PATH_JOINT_MIN_ANGLE,
  PATH_JOINT_RADIUS_TILES,
  PATH_JOINT_SAMPLES,
  PATH_SMOOTH_PASSES,
  PATH_TREMOR_WINDOW_TILES,
  SNAP_AXIS_TILES,
  SNAP_DIAGONAL_TILES,
} from '../data/balance';
import {
  angleBetween,
  arcLengths,
  centroid,
  chaikin,
  perpendicularDistance,
  prefixSums,
  rasterize,
  roundPoint,
  seekBack,
  seekForward,
  simplify,
  type TilePoint,
} from './pathGeometry';

/**
 * Raw finger path → the line the player meant (§5.1).
 *
 * A finger is noisy: a "straight" drag wanders three or four tiles, and a
 * deliberate curve looks much the same at the sample level. The pipeline is
 *
 *   dedupe → split at corners → per run: snap or soften → rasterise
 *
 * and the split is the whole trick. Corners are found first, so an L becomes
 * two runs that each straighten independently. Each run is then judged on how
 * far it bows from its own chord: within a few tiles it was meant to be
 * straight and snaps to an axis or 45°; beyond that the player curved it on
 * purpose and it is only softened. Classifying the stroke as a whole cannot
 * tell an L from an arc, which is why it is done per run.
 *
 * Pure geometry in tile space — no DOM, no canvas.
 */
export interface RoadPath {
  /** Polyline vertices, in tile coordinates; what the renderer strokes. */
  polyline: TilePoint[];
  /** Connected tiles the road occupies; what the sim writes. */
  tiles: TilePoint[];
  /** True when the stroke was read as a deliberate curve. */
  curved: boolean;
}

export function buildRoadPath(raw: readonly TilePoint[]): RoadPath {
  const deduped = dedupe(raw);
  if (deduped.length === 0) return { polyline: [], tiles: [], curved: false };
  if (deduped.length === 1) {
    const only = deduped[0] as TilePoint;
    return { polyline: [only], tiles: [roundPoint(only)], curved: false };
  }

  // Corners first, bows second. Splitting at the sharp turns means each run
  // between them can be judged on its own: an L is two straight legs that each
  // snap, while an arc is one run that bows and is kept.
  const corners = findCorners(deduped);
  let polyline: TilePoint[] = [];
  let curved = false;
  let cursor: TilePoint | null = null;

  for (let c = 0; c < corners.length - 1; c++) {
    const run = deduped.slice(corners[c] as number, (corners[c + 1] as number) + 1);
    const start: TilePoint = cursor ?? (run[0] as TilePoint);
    const piece = shapeRun(run, start);
    if (piece.curved) curved = true;

    // The runs share endpoints; drop the duplicate when joining.
    polyline = polyline.length === 0 ? piece.points : [...polyline, ...piece.points.slice(1)];
    cursor = polyline[polyline.length - 1] ?? start;
  }

  const rounded = roundJoints(polyline);
  return { polyline: rounded, tiles: rasterize(rounded), curved };
}

/**
 * Rounds the joint where two snapped runs meet (§5.1, "kavisleri yumuşat").
 *
 * Snapping produces exact axes and 45° legs, which is what the player wants,
 * but it leaves mitred corners that no road has. Rounding them also settles the
 * hardest case in the whole pipeline: a bow tight enough that a tile grid
 * cannot express it as a curve still reads as one, because its apex is a fillet
 * rather than a point. Trying to fix that by classification instead is chasing
 * a distinction the grid cannot represent.
 */
export function roundJoints(polyline: readonly TilePoint[]): TilePoint[] {
  if (polyline.length < 3) return polyline.map((p) => ({ x: p.x, y: p.y }));

  const out: TilePoint[] = [polyline[0] as TilePoint];

  for (let i = 1; i < polyline.length - 1; i++) {
    const previous = polyline[i - 1] as TilePoint;
    const vertex = polyline[i] as TilePoint;
    const next = polyline[i + 1] as TilePoint;

    const inLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
    const outLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    if (inLength < 0.01 || outLength < 0.01) continue;

    // A gentle joint is already smooth; rounding it would only add points.
    const turn = Math.abs(angleBetween(vertex, previous, next));
    if (turn < PATH_JOINT_MIN_ANGLE) {
      out.push(vertex);
      continue;
    }

    const radius = Math.min(PATH_JOINT_RADIUS_TILES, inLength / 2, outLength / 2);
    const start = {
      x: vertex.x - ((vertex.x - previous.x) / inLength) * radius,
      y: vertex.y - ((vertex.y - previous.y) / inLength) * radius,
    };
    const end = {
      x: vertex.x + ((next.x - vertex.x) / outLength) * radius,
      y: vertex.y + ((next.y - vertex.y) / outLength) * radius,
    };

    // Quadratic through the fillet, with the sharp vertex as control point.
    for (let s = 0; s <= PATH_JOINT_SAMPLES; s++) {
      const t = s / PATH_JOINT_SAMPLES;
      const inverse = 1 - t;
      out.push({
        x: inverse * inverse * start.x + 2 * inverse * t * vertex.x + t * t * end.x,
        y: inverse * inverse * start.y + 2 * inverse * t * vertex.y + t * t * end.y,
      });
    }
  }

  out.push(polyline[polyline.length - 1] as TilePoint);
  return out;
}

/**
 * Shapes one run between corners. A run that stays close to its own chord was
 * meant to be straight, so it snaps; a run that bows away from it by more than
 * a few tiles was drawn curved on purpose, so it is only softened (§5.1).
 */
function shapeRun(
  run: readonly TilePoint[],
  start: TilePoint,
): { points: TilePoint[]; curved: boolean } {
  const first = run[0] as TilePoint;
  const last = run[run.length - 1] as TilePoint;

  let sagitta = 0;
  for (const point of run) {
    sagitta = Math.max(sagitta, perpendicularDistance(point, first, last));
  }

  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  const threshold = Math.max(PATH_CURVE_SAGITTA_TILES, chord * PATH_CURVE_SAGITTA_RATIO);

  if (sagitta <= threshold) {
    const delta = snapDelta(last.x - start.x, last.y - start.y);
    return {
      points: [start, { x: start.x + delta.x, y: start.y + delta.y }],
      curved: false,
    };
  }

  // Keep the bow, lose the tremor: simplify finely, then round the joints.
  const simplified = simplify(run, PATH_CURVE_SIMPLIFY_TILES);
  const offsetX = start.x - first.x;
  const offsetY = start.y - first.y;
  const shifted = simplified.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
  return { points: chaikin(shifted, PATH_SMOOTH_PASSES), curved: true };
}

/**
 * Indices of the deliberate corners, always including the first and last point.
 *
 * What separates a corner from a curve is not how far the path turns but how
 * *fast*: a corner turns ninety degrees within a tile or two, an arc spends
 * twenty tiles doing the same. So the turn is measured over a deliberately
 * short span — and, because a short span is exactly where a thumb's wobble
 * lives, over a tremor-averaged copy of the path rather than the raw samples.
 * Measuring raw over a short span finds a corner every few samples; measuring
 * over a long span mistakes the apex of an arc for a corner.
 */
export function findCorners(points: readonly TilePoint[]): number[] {
  const corners = [0];
  if (points.length < 3) {
    corners.push(points.length - 1);
    return corners;
  }

  const cumulative = arcLengths(points);
  const sums = prefixSums(points);
  const turns = new Float64Array(points.length);

  const smoothed: TilePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    smoothed.push(
      centroid(
        sums,
        seekBack(cumulative, i, PATH_TREMOR_WINDOW_TILES),
        seekForward(cumulative, i, PATH_TREMOR_WINDOW_TILES),
      ),
    );
  }

  for (let i = 1; i < points.length - 1; i++) {
    const before = seekBack(cumulative, i, PATH_CORNER_WINDOW_TILES);
    const after = seekForward(cumulative, i, PATH_CORNER_WINDOW_TILES);
    if (before === i || after === i) continue;
    turns[i] = Math.abs(
      angleBetween(
        smoothed[i] as TilePoint,
        smoothed[before] as TilePoint,
        smoothed[after] as TilePoint,
      ),
    );
  }

  for (let i = 1; i < points.length - 1; i++) {
    if ((turns[i] ?? 0) < PATH_CORNER_ANGLE) continue;
    // Only the sharpest sample in a window becomes the corner; a single bend
    // spans many samples and would otherwise register as a cluster of corners.
    let isPeak = true;
    for (let j = 1; j <= PATH_CORNER_SUPPRESSION; j++) {
      if ((turns[i - j] ?? 0) > (turns[i] ?? 0) || (turns[i + j] ?? 0) > (turns[i] ?? 0)) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) corners.push(i);
  }

  corners.push(points.length - 1);
  return corners;
}

// --- Stage 1: dedupe ---------------------------------------------------------

function dedupe(points: readonly TilePoint[]): TilePoint[] {
  const out: TilePoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) {
      continue;
    }
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

// --- Stage 3a: snap straight strokes ----------------------------------------

/**
 * Picks between horizontal, vertical, 45° and "leave it alone" by whichever
 * eligible candidate sits closest to what the finger actually did. Testing the
 * axes before the diagonal would flatten a stubby 8×7 drag into a straight
 * line and throw away seven tiles of intent.
 */
export function snapDelta(dx: number, dy: number): TilePoint {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  let best: TilePoint | null = null;
  let bestError = Infinity;

  if (ady <= SNAP_AXIS_TILES && ady < bestError) {
    best = { x: dx, y: 0 };
    bestError = ady;
  }
  if (adx <= SNAP_AXIS_TILES && adx < bestError) {
    best = { x: 0, y: dy };
    bestError = adx;
  }
  const diagonalError = Math.abs(adx - ady) / 2;
  if (Math.abs(adx - ady) <= SNAP_DIAGONAL_TILES && diagonalError < bestError) {
    const length = (adx + ady) / 2;
    best = { x: Math.sign(dx) * length, y: Math.sign(dy) * length };
    bestError = diagonalError;
  }

  // Nothing within tolerance: the player drew a genuine oblique line, keep it.
  return best ?? { x: dx, y: dy };
}

