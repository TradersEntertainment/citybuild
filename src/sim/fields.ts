import { ROAD_ACCESS_MAX_WALK, SEA_LEVEL } from '../data/balance';
import { ROAD_SPECS } from '../data/roads';
import { decodeRoad, decodeTerrain, NONE } from './tiles';
import { index, type World } from './world';

/**
 * Derived per-tile fields (§10). Phase 2 needs two of them: how far a tile is
 * from a road, and what the land is worth. Pollution, noise and the diffusion
 * passes arrive in Phase 3 alongside the systems that produce them.
 *
 * Both are recomputed wholesale rather than incrementally. A 256×256 sweep of
 * typed arrays is well under a millisecond, and incremental updates are a
 * source of stale-state bugs that only show up hours into a save.
 */
export interface Fields {
  /** Walking distance to the nearest road, in tiles; 255 means unreachable. */
  roadDistance: Uint8Array;
  /** 0..100 (§10). */
  landValue: Float32Array;
}

export const UNREACHABLE = 255;

export function createFields(size: number): Fields {
  const cells = size * size;
  return {
    roadDistance: new Uint8Array(cells).fill(UNREACHABLE),
    landValue: new Float32Array(cells),
  };
}

/**
 * Multi-source breadth-first search out from every road tile. Distance is in
 * walking steps including diagonals, which is what §6.2 means by "walking
 * distance" — buildings front onto roads they can actually reach.
 */
export function computeRoadDistance(world: World, out: Uint8Array): void {
  out.fill(UNREACHABLE);

  // Ring buffer over tile indices: the frontier never exceeds the grid.
  const queue = new Int32Array(world.size * world.size);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < world.road.length; i++) {
    if ((world.road[i] ?? NONE) === NONE) continue;
    out[i] = 0;
    queue[tail++] = i;
  }

  while (head < tail) {
    const at = queue[head++] as number;
    const distance = out[at] ?? UNREACHABLE;
    if (distance >= ROAD_ACCESS_MAX_WALK) continue;

    const x = at % world.size;
    const y = (at - x) / world.size;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
        const next = index(world, nx, ny);
        if ((out[next] ?? UNREACHABLE) <= distance + 1) continue;
        out[next] = distance + 1;
        queue[tail++] = next;
      }
    }
  }
}

/**
 * Land value (§10), Phase 2 form: fertility and water make land pleasant, a
 * better road in front of it makes it valuable, upland and rock make it less
 * so. Phase 3 replaces this with the diffused version that also answers to
 * parks, services, pollution and neighbouring building levels.
 */
export function computeLandValue(world: World, fields: Fields): void {
  const { roadDistance, landValue } = fields;

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);
      const terrain = decodeTerrain(world.terrain[i] ?? 0);
      if (terrain === 'water') {
        landValue[i] = 0;
        continue;
      }

      let value = 30;
      value += (world.fertility[i] ?? 0) * 18;

      const distance = roadDistance[i] ?? UNREACHABLE;
      if (distance <= ROAD_ACCESS_MAX_WALK) {
        // Being on the road is worth more than being four tiles behind it.
        value += (1 - distance / (ROAD_ACCESS_MAX_WALK + 1)) * 22;
        value += bestAdjacentRoadBonus(world, x, y);
      }

      if (terrain === 'hill') value -= 6;
      if (terrain === 'rock') value -= 14;
      if (terrain === 'marsh') value -= 10;
      if (nearWater(world, x, y)) value += 8;

      landValue[i] = value < 0 ? 0 : value > 100 ? 100 : value;
    }
  }
}

function bestAdjacentRoadBonus(world: World, x: number, y: number): number {
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const kind = decodeRoad(world.road[index(world, nx, ny)] ?? NONE);
      if (!kind) continue;
      best = Math.max(best, ROAD_SPECS[kind].landValueBonus);
    }
  }
  return best;
}

function nearWater(world: World, x: number, y: number): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      if ((world.height[index(world, nx, ny)] ?? 1) < SEA_LEVEL) return true;
    }
  }
  return false;
}
