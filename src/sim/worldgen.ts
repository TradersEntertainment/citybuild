import {
  PARCEL_SIZE,
  START_LAND_MARGIN,
  RIVER_COUNT,
  RIVER_MAX_LENGTH,
  RESOURCE_CLUSTERS,
  RESOURCE_CLUSTER_RADIUS,
  SEA_LEVEL,
  TERRAIN_FOREST_FERTILITY,
  TERRAIN_HILL_HEIGHT,
  TERRAIN_MARSH_BAND,
  TERRAIN_ROCK_HEIGHT,
} from '../data/balance';
import { createFbm } from './noise';
import { createRng, type Rng } from './rng';
import { encodeTerrain, type ResourceKind, RESOURCE_ORDER } from './tiles';
import { index, startingCentre, type World } from './world';

/**
 * Terrain generation (§4): height by value noise, water below sea level,
 * a separate fertility field, rivers that run downhill to the sea, and sparse
 * resource clusters. Deterministic from the world seed alone.
 *
 * One deliberate departure from pure noise: the starting parcel is shaped to be
 * buildable land. A player whose first parcel is open sea has no game, and
 * re-rolling seeds until one works is worse than shaping the one we have.
 */
export function generateTerrain(world: World): void {
  const rng = createRng(world.seed ^ 0x9e3779b9);
  buildHeightField(world);
  buildFertilityField(world);
  carveRivers(world, rng);
  classifyTerrain(world);
  placeResources(world, rng);
}

// --- Height ------------------------------------------------------------------

function buildHeightField(world: World): void {
  const base = createFbm(world.seed, { octaves: 5, scale: 70 });
  const detail = createFbm(world.seed + 1013, { octaves: 3, scale: 22 });
  const centre = startingCentre(world);

  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const h = base(x, y) * 0.78 + detail(x, y) * 0.22;
      world.height[index(world, x, y)] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  // Normalise first, so SEA_LEVEL means the same land ratio on every seed and
  // the shaping below is measured in the same units as the sea level. Shaping
  // before normalising makes the correction's effect depend on the seed.
  const span = max - min || 1;
  for (let i = 0; i < world.height.length; i++) {
    world.height[i] = ((world.height[i] ?? 0) - min) / span;
  }

  guaranteeStartingLand(world, centre);
}

/**
 * A seed whose basin sits over the middle floods the starting parcel, and the
 * player has no game then. This measures the parcel and lifts it exactly as
 * much as it needs — one mechanism, not a blanket dome plus a correction.
 *
 * The lift is attenuated by height, so low ground rises to buildable plains
 * while ground that is already high barely moves. Lifting everything by the
 * same amount is what turns a drowned start into a mountain-top start, which
 * is no more playable: the first parcel has to be *flat land*, not just land.
 */
function guaranteeStartingLand(world: World, centre: { x: number; y: number }): void {
  const half = PARCEL_SIZE / 2;
  const x0 = Math.floor(centre.x - half);
  const y0 = Math.floor(centre.y - half);

  const heights: number[] = [];
  for (let y = y0; y < y0 + PARCEL_SIZE; y++) {
    for (let x = x0; x < x0 + PARCEL_SIZE; x++) {
      heights.push(world.height[index(world, x, y)] ?? 0);
    }
  }
  heights.sort((a, b) => a - b);

  // Percentiles rather than the extremes: a lake or a rocky corner in the
  // starting parcel is good, a parcel that is *mostly* one or the other is not.
  const low = heights[Math.floor(heights.length * 0.2)] ?? 0;
  const high = heights[Math.floor(heights.length * 0.8)] ?? 1;
  const lowTarget = SEA_LEVEL + START_LAND_MARGIN;
  const highTarget = TERRAIN_HILL_HEIGHT - START_LAND_MARGIN;
  const band = highTarget - lowTarget;
  const spread = Math.max(1e-6, high - low);

  // Only ever calm the terrain down, never dramatise it: a start that is
  // already gentle is left exactly as the noise made it.
  const scale = Math.min(1, band / spread);
  const scaledHigh = low + spread * scale;
  const offset =
    low < lowTarget ? lowTarget - low : scaledHigh > highTarget ? highTarget - scaledHigh : 0;
  if (offset === 0 && scale === 1) return;

  const inner = PARCEL_SIZE * 0.75;
  const outer = PARCEL_SIZE * 3;
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const distance = Math.hypot(x - centre.x, y - centre.y);
      if (distance >= outer) continue;
      // Full correction across the parcel, then a smooth shoulder outward so
      // the reshaped area blends into the seed's own landscape.
      const t = distance <= inner ? 1 : 1 - (distance - inner) / (outer - inner);
      const falloff = smoothstep(t);
      const i = index(world, x, y);
      const h = world.height[i] ?? 0;
      const corrected = low + (h - low) * scale + offset;
      world.height[i] = clamp01(h + (corrected - h) * falloff);
    }
  }
}

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function buildFertilityField(world: World): void {
  const field = createFbm(world.seed + 7717, { octaves: 4, scale: 40 });
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);
      const height = world.height[i] ?? 0;
      // Lowland is fertile, ridges are not — fertility that ignored height
      // would put orchards on cliff tops.
      const lowlandBonus = Math.max(0, 1 - Math.abs(height - SEA_LEVEL) * 1.6);
      world.fertility[i] = clamp01(field(x, y) * 0.75 + lowlandBonus * 0.25);
    }
  }
}

// --- Rivers ------------------------------------------------------------------

/**
 * Rivers run from a high point downhill to the sea (§4). Greedy steepest
 * descent with a small random tiebreak, so two rivers from nearby peaks do not
 * trace the same line. A run that reaches a pit rather than the sea leaves a
 * lake, which is a fine thing for a map to have.
 */
function carveRivers(world: World, rng: Rng): void {
  for (let r = 0; r < RIVER_COUNT; r++) {
    const source = findHighPoint(world, rng);
    if (!source) continue;

    let { x, y } = source;
    for (let step = 0; step < RIVER_MAX_LENGTH; step++) {
      const i = index(world, x, y);
      const height = world.height[i] ?? 0;
      if (height <= SEA_LEVEL) break; // reached the sea

      world.height[i] = Math.min(height, SEA_LEVEL - 0.01);
      widenRiver(world, x, y);

      const next = steepestNeighbour(world, x, y, rng);
      if (!next) break; // pit: the river ends in a lake
      x = next.x;
      y = next.y;
    }
  }
}

function findHighPoint(world: World, rng: Rng): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestHeight = -Infinity;
  // Sample rather than scan: a full scan always picks the same summit, and
  // every river would then start from it.
  for (let attempt = 0; attempt < 64; attempt++) {
    const x = rng.int(4, world.size - 5);
    const y = rng.int(4, world.size - 5);
    const h = world.height[index(world, x, y)] ?? 0;
    if (h > bestHeight) {
      bestHeight = h;
      best = { x, y };
    }
  }
  return bestHeight > SEA_LEVEL + 0.25 ? best : null;
}

function steepestNeighbour(
  world: World,
  x: number,
  y: number,
  rng: Rng,
): { x: number; y: number } | null {
  const current = world.height[index(world, x, y)] ?? 0;
  let best: { x: number; y: number } | null = null;
  let bestHeight = current;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const h = (world.height[index(world, nx, ny)] ?? 0) + rng.range(-0.004, 0.004);
      if (h < bestHeight) {
        bestHeight = h;
        best = { x: nx, y: ny };
      }
    }
  }
  return best;
}

/** A one-tile river reads as a scratch; widen it where the valley is flat. */
function widenRiver(world: World, x: number, y: number): void {
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= world.size || ny >= world.size) continue;
    const i = index(world, nx, ny);
    const h = world.height[i] ?? 0;
    if (h < SEA_LEVEL + 0.06) world.height[i] = Math.min(h, SEA_LEVEL - 0.005);
  }
}

// --- Classification ----------------------------------------------------------

function classifyTerrain(world: World): void {
  for (let i = 0; i < world.terrain.length; i++) {
    const h = world.height[i] ?? 0;
    const fertility = world.fertility[i] ?? 0;
    world.terrain[i] = encodeTerrain(kindFor(h, fertility));
  }
}

function kindFor(h: number, fertility: number): Parameters<typeof encodeTerrain>[0] {
  if (h < SEA_LEVEL) return 'water';
  if (h < SEA_LEVEL + TERRAIN_MARSH_BAND && fertility > 0.5) return 'marsh';
  if (h > TERRAIN_ROCK_HEIGHT) return 'rock';
  if (h > TERRAIN_HILL_HEIGHT) return 'hill';
  if (fertility > TERRAIN_FOREST_FERTILITY) return 'forest';
  return 'plain';
}

// --- Resources ---------------------------------------------------------------

/** Sparse clusters (§4): a blob of one kind, placed where its terrain fits. */
function placeResources(world: World, rng: Rng): void {
  for (let c = 0; c < RESOURCE_CLUSTERS; c++) {
    const cx = rng.int(2, world.size - 3);
    const cy = rng.int(2, world.size - 3);
    const kind = resourceFor(world, cx, cy);
    if (kind === 'none') continue;

    const radius = rng.range(RESOURCE_CLUSTER_RADIUS * 0.5, RESOURCE_CLUSTER_RADIUS);
    const code = RESOURCE_ORDER.indexOf(kind);
    for (let y = Math.max(0, cy - radius); y <= Math.min(world.size - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(world.size - 1, cx + radius); x++) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance > radius) continue;
        // Ragged edges: a perfect disc of coal looks placed, not found.
        if (rng.next() < distance / radius) continue;
        const i = index(world, Math.floor(x), Math.floor(y));
        if ((world.height[i] ?? 0) < SEA_LEVEL) continue;
        world.resource[i] = code;
      }
    }
  }
}

function resourceFor(world: World, x: number, y: number): ResourceKind {
  const i = index(world, x, y);
  const h = world.height[i] ?? 0;
  const fertility = world.fertility[i] ?? 0;
  if (h < SEA_LEVEL) return 'none';
  if (h > TERRAIN_ROCK_HEIGHT) return 'stone';
  if (h > TERRAIN_HILL_HEIGHT) return fertility > 0.5 ? 'iron' : 'coal';
  if (h < SEA_LEVEL + TERRAIN_MARSH_BAND * 2) return 'clay';
  return 'none';
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// --- Derived queries ---------------------------------------------------------

/** Slope at a tile, used for the build-cost multiplier (§4). */
export function slopeAt(world: World, x: number, y: number): number {
  if (x <= 0 || y <= 0 || x >= world.size - 1 || y >= world.size - 1) return 0;
  const left = world.height[index(world, x - 1, y)] ?? 0;
  const right = world.height[index(world, x + 1, y)] ?? 0;
  const up = world.height[index(world, x, y - 1)] ?? 0;
  const down = world.height[index(world, x, y + 1)] ?? 0;
  return Math.hypot(right - left, down - up);
}

export function isWater(world: World, x: number, y: number): boolean {
  return (world.height[index(world, x, y)] ?? 0) < SEA_LEVEL;
}
