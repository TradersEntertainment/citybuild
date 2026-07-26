import {
  CONGESTION_SLOWDOWN,
  JUNCTION_PENALTY_3WAY,
  JUNCTION_PENALTY_4WAY,
  ROAD_ACCESS_MAX_WALK,
  TRAFFIC_SPREAD_PASSES,
  TRIPS_PER_JOB,
  TRIPS_PER_RESIDENT,
} from '../data/balance';
import { ROAD_SPECS } from '../data/roads';
import type { Fields } from './fields';
import type { GameState } from './state';
import { techFactor } from './tech';
import { decodeRoad, NONE } from './tiles';
import { index, type World } from './world';

/**
 * Traffic (§5.2).
 *
 * The honest way to compute road load is to route every trip and count what
 * crosses each tile. That is betweenness centrality, it is far too expensive to
 * run on a phone every five seconds, and nothing it would buy is visible at the
 * scale a player reads the map.
 *
 * So load is *spread* rather than routed. Homes and workplaces inject trips
 * into the road they front onto, and each pass pushes some of every tile's load
 * into its road neighbours. Where many streams overlap — the one street the
 * whole district must use — load piles up, which is exactly the shape real
 * congestion has and the only part of it the player can act on.
 *
 * Capacity comes from the road tier, so the fix is the one the game is about:
 * draw a better road, or draw another way round.
 */
export interface TrafficField {
  /** Trips per minute wanting to cross each tile. */
  flow: Float32Array;
  /** flow / capacity, 0 when clear and above 1 when over capacity. */
  load: Float32Array;
  scratch: Float32Array;
}

export function createTrafficField(size: number): TrafficField {
  const cells = size * size;
  return {
    flow: new Float32Array(cells),
    load: new Float32Array(cells),
    scratch: new Float32Array(cells),
  };
}

/**
 * Recomputes flow and load. Cheap enough to run on the traffic cadence, and
 * deterministic, so a reloaded city has the same jams as the saved one.
 */
export function computeTraffic(state: GameState, fields: Fields, traffic: TrafficField): void {
  const world = state.world;
  const { flow, load, scratch } = traffic;
  flow.fill(0);
  load.fill(0);

  // Every building pushes its trips onto the nearest road tile it can reach.
  for (const building of state.buildings.values()) {
    const trips =
      building.zone === 'res'
        ? building.population * TRIPS_PER_RESIDENT
        : building.jobs * TRIPS_PER_JOB;
    if (trips <= 0) continue;
    const road = nearestRoad(world, fields, building.x, building.y);
    if (road < 0) continue;
    flow[road] = (flow[road] ?? 0) + trips;
  }

  spreadAlongRoads(world, flow, scratch);

  // Load is what the player can act on: a tier with more lanes carries more,
  // and transit research is the other way to widen a street the player has
  // already drawn and does not want to redraw.
  const transit = techFactor(state, 'transit');
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);
      const kind = decodeRoad(world.road[i] ?? NONE);
      if (!kind) continue;
      const capacity = ROAD_SPECS[kind].capacity * junctionFactor(world, x, y) * transit;
      load[i] = capacity > 0 ? (flow[i] ?? 0) / capacity : 0;
    }
  }
}

/**
 * Pushes load outward along the road network. Each pass moves a share of every
 * tile's flow to its road neighbours, which lets a district's trips reach the
 * arterial that actually carries them.
 */
function spreadAlongRoads(world: World, flow: Float32Array, scratch: Float32Array): void {
  const size = world.size;
  for (let pass = 0; pass < TRAFFIC_SPREAD_PASSES; pass++) {
    scratch.set(flow);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const here = scratch[i] ?? 0;
        if (here <= 0) continue;
        if (!isRoad(world, x, y)) continue;

        let neighbours = 0;
        for (const [dx, dy] of STEPS) {
          if (isRoad(world, x + dx, y + dy)) neighbours++;
        }
        if (neighbours === 0) continue;

        // Half stays put — a street keeps the traffic that belongs to it — and
        // the rest is shared out to whatever it connects to.
        const shared = (here * 0.5) / neighbours;
        flow[i] = (flow[i] ?? 0) - here * 0.5;
        for (const [dx, dy] of STEPS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!isRoad(world, nx, ny)) continue;
          const ni = ny * size + nx;
          flow[ni] = (flow[ni] ?? 0) + shared;
        }
      }
    }
  }
}

/**
 * How much a junction costs. A crossroads is where a queue forms, and the brief
 * puts a number on it (§5.2) that had never been used.
 */
function junctionFactor(world: World, x: number, y: number): number {
  let arms = 0;
  for (const [dx, dy] of STEPS) {
    if (isRoad(world, x + dx, y + dy)) arms++;
  }
  if (arms >= 4) return 1 - JUNCTION_PENALTY_4WAY;
  if (arms === 3) return 1 - JUNCTION_PENALTY_3WAY;
  return 1;
}

/** Nearest road tile within walking distance, or -1. */
function nearestRoad(world: World, fields: Fields, x: number, y: number): number {
  let best = -1;
  let bestDistance = ROAD_ACCESS_MAX_WALK + 1;
  const reach = ROAD_ACCESS_MAX_WALK;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isRoad(world, nx, ny)) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = index(world, nx, ny);
    }
  }
  void fields;
  return best;
}

/**
 * How much slower a congested tile is, 0..1 where 1 is free-flowing. The brief's
 * shape: speed / (1 + (load − 1) × slowdown) once over capacity.
 */
export function speedFactor(load: number): number {
  if (load <= 1) return 1;
  return 1 / (1 + (load - 1) * CONGESTION_SLOWDOWN);
}

/** Worst congestion on the roads a building can reach; 0 when clear. */
export function congestionNear(
  world: World,
  traffic: TrafficField,
  x: number,
  y: number,
): number {
  let worst = 0;
  const reach = ROAD_ACCESS_MAX_WALK;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isRoad(world, nx, ny)) continue;
      const value = traffic.load[index(world, nx, ny)] ?? 0;
      if (value > worst) worst = value;
    }
  }
  return worst;
}

const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function isRoad(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  return (world.road[index(world, x, y)] ?? NONE) !== NONE;
}
