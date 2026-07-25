import { CONGESTION_LAND_VALUE, ROAD_ACCESS_MAX_WALK, SEA_LEVEL } from '../data/balance';
import { ROAD_SPECS } from '../data/roads';
import { decodeRoad, decodeTerrain, NONE } from './tiles';
import { index, type World } from './world';

/**
 * Derived per-tile fields (§10): how far a tile is from a road, and what the
 * land is worth.
 *
 * Recomputed wholesale rather than incrementally, because incremental updates
 * are a source of stale-state bugs that only show up hours into a save. What is
 * split out instead is the part of the answer that does not move: land value
 * asks its neighbourhood two questions, one about roads and traffic — which
 * changes constantly — and one about terrain, which changes never. Asking both
 * on the same clock cost a grown city fifty milliseconds every five seconds.
 */
export interface Fields {
  /** Walking distance to the nearest road, in tiles; 255 means unreachable. */
  roadDistance: Uint8Array;
  /** 0..100 (§10). */
  landValue: Float32Array;
  /** What the ground alone is worth; −1 marks water. Cached, see below. */
  terrainValue: Float32Array;
  /** False until terrainValue has been filled for the ground as it now stands. */
  terrainValid: boolean;
}

export const UNREACHABLE = 255;

export function createFields(size: number): Fields {
  const cells = size * size;
  return {
    roadDistance: new Uint8Array(cells).fill(UNREACHABLE),
    landValue: new Float32Array(cells),
    terrainValue: new Float32Array(cells),
    terrainValid: false,
  };
}

/** Call when the ground itself changed; the cached terrain term is then redone. */
export function invalidateTerrainValue(fields: Fields): void {
  fields.terrainValid = false;
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
 * What the ground is worth before anyone builds anything: fertility and a view
 * of water make it pleasant, upland and rock make it less so.
 *
 * The five-by-five water search is why this is cached rather than redone with
 * the rest — it is a million and a half lookups over the map, and its answer
 * cannot change while the coastline does not.
 */
export function computeTerrainValue(world: World, fields: Fields): void {
  const { terrainValue } = fields;

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);
      const terrain = decodeTerrain(world.terrain[i] ?? 0);
      if (terrain === 'water') {
        terrainValue[i] = WATER;
        continue;
      }

      let value = 30;
      value += (world.fertility[i] ?? 0) * 18;
      if (terrain === 'hill') value -= 6;
      if (terrain === 'rock') value -= 14;
      if (terrain === 'marsh') value -= 10;
      if (nearWater(world, x, y)) value += 8;
      terrainValue[i] = value;
    }
  }

  fields.terrainValid = true;
}

/** Sentinel in terrainValue: nothing may be built or valued on open water. */
const WATER = -1;

/**
 * Land value (§10): the ground's own worth, plus what the road in front of it
 * is worth, less what the queue on that road takes back.
 *
 * Only the road terms are computed here; the terrain term is cached and
 * recomputed only when the ground changes. Both neighbourhood searches are
 * gated on road access, which costs nothing in accuracy: a road tile is at
 * distance zero and its neighbours at one, so a tile out of walking range
 * provably has no road and no traffic touching it.
 */
export function computeLandValue(
  world: World,
  fields: Fields,
  traffic?: { load: Float32Array },
): void {
  if (!fields.terrainValid) computeTerrainValue(world, fields);
  const { roadDistance, landValue, terrainValue } = fields;

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);
      const base = terrainValue[i] ?? WATER;
      if (base === WATER) {
        landValue[i] = 0;
        continue;
      }

      let value = base;
      const distance = roadDistance[i] ?? UNREACHABLE;
      if (distance <= ROAD_ACCESS_MAX_WALK) {
        // Being on the road is worth more than being four tiles behind it.
        value += (1 - distance / (ROAD_ACCESS_MAX_WALK + 1)) * 22;
        value += bestAdjacentRoadBonus(world, x, y);

        // A jam outside the door is worth less than a quiet street, which is the
        // one consequence of congestion the player feels in the ledger.
        //
        // Read from the roads this tile fronts onto, not from the tile itself:
        // load only exists on paved ground, so a plot's own figure is always
        // zero and the penalty would never once have applied.
        if (traffic) {
          const jam = Math.max(0, worstAdjacentLoad(world, traffic.load, x, y) - 1);
          value -= Math.min(1, jam) * CONGESTION_LAND_VALUE;
        }
      }

      landValue[i] = value < 0 ? 0 : value > 100 ? 100 : value;
    }
  }
}

/** Worst congestion on the roads touching a tile; 0 when none of them are. */
function worstAdjacentLoad(world: World, load: Float32Array, x: number, y: number): number {
  let worst = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const value = load[index(world, nx, ny)] ?? 0;
      if (value > worst) worst = value;
    }
  }
  return worst;
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
