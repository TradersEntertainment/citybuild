import type { ServiceKind } from '../data/services';
import { decodeRoad, NONE } from './tiles';
import type { GameState } from './state';
import { index, type World } from './world';

/**
 * Sending a vehicle somewhere (§13).
 *
 * The fire brigade wanted this first and the police want exactly the same thing:
 * find the nearest station of a kind, find a road at each end, and walk the road
 * network between them. Two copies of that would be two copies of the bug where
 * one of them forgets that coverage and connectivity are different questions.
 *
 * Pure and deterministic like the rest of sim/: no dice, no clock, no three.js.
 * The breadth-first search is unweighted on purpose — an engine on its way to a
 * fire does not care about congestion, and the shortest route is the one a
 * player watching it would have picked.
 */

/**
 * A vehicle on its way: the road tiles from the station to the destination
 * street, and how far along them it has driven. The renderer reads this
 * verbatim, so what the player watches is the sim's own progress, not an
 * animation pretending to be one.
 */
export interface TruckRun {
  /** Road tiles in driving order, station end first. */
  path: { x: number; y: number }[];
  /** Tiles covered so far, fractional. */
  progress: number;
}

/** True once the vehicle has reached the far end and the crew is at work. */
export function runArrived(run: TruckRun): boolean {
  return run.progress >= run.path.length - 1;
}

/** How long a run is over and done with, including the crew's time on scene. */
export function runFinished(run: TruckRun, dwellSeconds: number): boolean {
  return run.progress >= run.path.length - 1 + dwellSeconds;
}

/**
 * Sends a vehicle from the nearest station of `kind` to the given tile.
 *
 * Null when there is no such station, or when no road joins the two — coverage
 * without a connection is a promise the service cannot keep on camera, and the
 * caller is expected to fall back to an off-screen response timer rather than
 * pretend the drive happened.
 */
export function dispatchFrom(
  state: GameState,
  kind: ServiceKind,
  x: number,
  y: number,
): TruckRun | null {
  const station = nearestStation(state, kind, x, y);
  if (!station) return null;

  const from = nearestRoadTile(state.world, station.x, station.y);
  const to = nearestRoadTile(state.world, x, y);
  if (!from || !to) return null;
  const path = roadPath(state.world, from, to);
  if (!path || path.length < 1) return null;
  return { path, progress: 0 };
}

/**
 * The closest station of a kind by Manhattan distance, or null.
 *
 * Straight-line rather than along the road, because the road distance is what
 * the search below is for: measuring it here would mean running the search once
 * per station, and the nearest as the crow flies is very nearly always the
 * nearest to drive from.
 */
export function nearestStation(
  state: GameState,
  kind: ServiceKind,
  x: number,
  y: number,
): { x: number; y: number } | null {
  let found: { x: number; y: number } | null = null;
  let best = Infinity;
  for (const service of state.services.values()) {
    if (service.kind !== kind) continue;
    const d = Math.abs(service.x - x) + Math.abs(service.y - y);
    if (d < best) {
      best = d;
      found = service;
    }
  }
  return found;
}

/** Nearest road tile within a few tiles' walk, or null. */
export function nearestRoadTile(
  world: World,
  x: number,
  y: number,
): { x: number; y: number } | null {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
        if (decodeRoad(world.road[index(world, nx, ny)] ?? NONE)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/** BFS over road tiles; the path from `from` to `to`, both ends included. */
export function roadPath(
  world: World,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] | null {
  const size = world.size;
  const startIdx = from.y * size + from.x;
  const goalIdx = to.y * size + to.x;
  if (startIdx === goalIdx) return [from];

  const cameFrom = new Int32Array(size * size).fill(-1);
  cameFrom[startIdx] = startIdx;
  const queue: number[] = [startIdx];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++] as number;
    if (current === goalIdx) break;
    const cx = current % size;
    const cy = Math.floor(current / size);
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (cameFrom[ni] !== -1) continue;
      if (!decodeRoad(world.road[ni] ?? NONE)) continue;
      cameFrom[ni] = current;
      queue.push(ni);
    }
  }
  if (cameFrom[goalIdx] === -1) return null;

  const path: { x: number; y: number }[] = [];
  let cursor = goalIdx;
  while (cursor !== startIdx) {
    path.push({ x: cursor % size, y: Math.floor(cursor / size) });
    cursor = cameFrom[cursor] as number;
  }
  path.push(from);
  path.reverse();
  return path;
}

/** Where a run has driven to, in tile space, for whoever has to draw it. */
export function runPosition(run: TruckRun): { x: number; y: number; heading: number } {
  const last = run.path.length - 1;
  const clamped = Math.min(run.progress, last);
  const seg = Math.min(Math.floor(clamped), Math.max(0, last - 1));
  const a = run.path[seg] as { x: number; y: number };
  const b = run.path[Math.min(seg + 1, last)] as { x: number; y: number };
  const t = clamped - seg;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    heading: Math.atan2(b.x - a.x, b.y - a.y),
  };
}

const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
