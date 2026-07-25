import { POWER_PER_CAPITA, ROAD_ACCESS_MAX_WALK, WATER_PER_CAPITA } from '../data/balance';
import { ROAD_SPECS } from '../data/roads';
import { UTILITY_SPECS, type UtilityKind, type UtilitySpec } from '../data/utilities';
import type { Fields } from './fields';
import type { GameState } from './state';
import { decodeRoad, NONE, SERVICE } from './tiles';
import { index, type World } from './world';

/**
 * Water and power (§9).
 *
 * Unlike a fire station, a waterworks does not serve a circle around itself —
 * it serves whatever its mains reach, and the mains run under roads. That is
 * what `carriesUtilities` on the road specs has been waiting for: a dirt track
 * carries nothing, so a village lives on wells, and the first asphalt a player
 * lays is also the moment plumbing becomes possible.
 *
 * Reach is a flood fill along utility-carrying road tiles, then a short walk
 * off the road — the same walk that decides whether a building has road access
 * at all, because a house connects to the main in the street it fronts onto.
 */
export interface UtilityPlant {
  id: number;
  kind: UtilityKind;
  x: number;
  y: number;
}

/** What the city is drawing, and what it has. Both in the spec's own units. */
export interface UtilityBalance {
  waterDemand: number;
  waterSupply: number;
  powerDemand: number;
  powerSupply: number;
}

export function utilityBalance(state: GameState): UtilityBalance {
  let waterSupply = 0;
  let powerSupply = 0;
  for (const plant of state.utilities.values()) {
    const spec: UtilitySpec = UTILITY_SPECS[plant.kind];
    if (spec.provides === 'water') waterSupply += spec.capacity;
    else powerSupply += spec.capacity;
  }
  return {
    waterDemand: state.population * WATER_PER_CAPITA,
    waterSupply,
    powerDemand: state.population * POWER_PER_CAPITA,
    powerSupply,
  };
}

/** Total upkeep of every plant standing, ₺ per minute. */
export function utilityUpkeep(state: GameState): number {
  let total = 0;
  for (const plant of state.utilities.values()) {
    total += (UTILITY_SPECS[plant.kind] as UtilitySpec).upkeep;
  }
  return total;
}

/**
 * Marks every tile the mains reach with the water and power bits.
 *
 * A plant that is not on — or beside — a utility-carrying road reaches nothing,
 * which is the rule that makes where a plant goes a real decision rather than a
 * formality.
 */
export function computeUtilityCoverage(state: GameState, fields: Fields): void {
  const world = state.world;
  // Only the two utility bits are ours to clear; the civic services own theirs.
  const keep = ~(SERVICE.water | SERVICE.power);
  for (let i = 0; i < world.serviceMask.length; i++) {
    world.serviceMask[i] = (world.serviceMask[i] ?? 0) & keep;
  }

  const balance = utilityBalance(state);
  // A grid that cannot meet demand does not brown out selectively — it fails as
  // a grid, which is legible in a way that a partial blackout would not be.
  const waterOk = balance.waterSupply >= balance.waterDemand;
  const powerOk = balance.powerSupply >= balance.powerDemand;

  for (const plant of state.utilities.values()) {
    const spec: UtilitySpec = UTILITY_SPECS[plant.kind];
    if (spec.provides === 'water' && !waterOk) continue;
    if (spec.provides === 'power' && !powerOk) continue;
    spread(world, fields, plant, spec.provides === 'water' ? SERVICE.water : SERVICE.power);
  }
}

/** Flood fill along utility-carrying roads, out to the plant's mains length. */
function spread(world: World, fields: Fields, plant: UtilityPlant, bit: number): void {
  const spec: UtilitySpec = UTILITY_SPECS[plant.kind];
  const size = world.size;
  const seen = new Set<number>();
  const queue: number[] = [];
  const depth: number[] = [];

  // The plant reaches the carrying roads it touches; if it touches none, its
  // mains go nowhere.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = plant.x + dx;
      const y = plant.y + dy;
      if (!carries(world, x, y)) continue;
      const i = index(world, x, y);
      if (seen.has(i)) continue;
      seen.add(i);
      queue.push(i);
      depth.push(0);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const d = depth[head] as number;
    world.serviceMask[i] = (world.serviceMask[i] ?? 0) | bit;
    if (d >= spec.mains) continue;

    const x = i % size;
    const y = (i - x) / size;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!carries(world, nx, ny)) continue;
      const ni = index(world, nx, ny);
      if (seen.has(ni)) continue;
      seen.add(ni);
      queue.push(ni);
      depth.push(d + 1);
    }
  }

  // Off the main and up the drive: every tile within walking distance of a
  // road the mains reached is connected too.
  for (const i of seen) {
    const x = i % size;
    const y = (i - x) / size;
    for (let dy = -ROAD_ACCESS_MAX_WALK; dy <= ROAD_ACCESS_MAX_WALK; dy++) {
      for (let dx = -ROAD_ACCESS_MAX_WALK; dx <= ROAD_ACCESS_MAX_WALK; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = index(world, nx, ny);
        if ((fields.roadDistance[ni] ?? 255) > ROAD_ACCESS_MAX_WALK) continue;
        world.serviceMask[ni] = (world.serviceMask[ni] ?? 0) | bit;
      }
    }
  }
}

const NEIGHBOURS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function carries(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  const kind = decodeRoad(world.road[index(world, x, y)] ?? NONE);
  return kind !== null && ROAD_SPECS[kind].carriesUtilities;
}
