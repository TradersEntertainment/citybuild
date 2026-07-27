import {
  TRANSIT_FARE,
  TRANSIT_LINE_CAPACITY,
  TRANSIT_MAX_SHARE,
  TRANSIT_STOP_SPACING,
  TRANSIT_STOP_UPKEEP,
  TRANSIT_STOP_WALK,
  TRANSIT_UNLOCK_POPULATION,
} from '../data/balance';
import type { Fields } from './fields';
import type { GameState } from './state';
import { nearestRoad } from './traffic';
import type { World } from './world';

/**
 * Public transport (§18): the second thing the player draws.
 *
 * Everything else in this game is answered by drawing a road, and past a certain
 * size that stops working — a district that has outgrown its street has exactly
 * one remedy, which is a wider street, and the map runs out of room for wider
 * streets before the city runs out of people. A line is the other answer: it
 * takes trips off the road without taking any ground.
 *
 * Drawn with the same stroke as a road, which is the point. The player drags,
 * stops appear along the drag at a fixed spacing, and the buildings around each
 * stop start sending a share of their journeys by bus instead of by car. There
 * is no timetable, no vehicle to dispatch and no route for anybody to choose:
 * what a line *is*, mechanically, is a shape on the map that lowers the traffic
 * a corridor has to carry.
 *
 * Two rules keep it from replacing the road rather than relieving it:
 *
 * - **A stop never takes every trip** (TRANSIT_MAX_SHARE). The road network is
 *   the game's instrument; a line that emptied it would take the instrument away.
 * - **A line has a capacity.** Past it, the share every stop achieves is scaled
 *   back together — one line through a metropolis is a full one, and the answer
 *   is another line rather than a longer one.
 *
 * Pure, deterministic, no dice, no three.js. Lines are saved, because the player
 * drew them and paid for them.
 */
export interface TransitStop {
  x: number;
  y: number;
}

export interface TransitLine {
  id: number;
  /** The drawn shape, tile by tile — the renderer runs its buses along this. */
  path: TransitStop[];
  /** Where people get on. Placed along the path at a fixed spacing. */
  stops: TransitStop[];
}

/** Whether the city is big enough to run a line at all. */
export function transitUnlocked(state: GameState): boolean {
  return state.population >= TRANSIT_UNLOCK_POPULATION;
}

/**
 * Stops along a drawn path, at a fixed spacing, with both ends always a stop.
 *
 * The ends matter: a line whose last stop is four tiles short of where the
 * player stopped dragging looks like the game ignored the end of their gesture.
 */
export function stopsAlong(path: readonly TransitStop[]): TransitStop[] {
  if (path.length === 0) return [];
  if (path.length === 1) return [{ x: path[0]!.x, y: path[0]!.y }];

  const stops: TransitStop[] = [{ x: path[0]!.x, y: path[0]!.y }];
  let since = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const previous = path[i - 1]!;
    const point = path[i]!;
    since += Math.hypot(point.x - previous.x, point.y - previous.y);
    if (since < TRANSIT_STOP_SPACING) continue;
    stops.push({ x: point.x, y: point.y });
    since = 0;
  }
  const last = path[path.length - 1]!;
  const previous = stops[stops.length - 1]!;
  // Unless the player's last tile is already all but on top of the previous stop,
  // in which case two stops in a doorway is worse than one.
  if (Math.hypot(last.x - previous.x, last.y - previous.y) >= TRANSIT_STOP_SPACING / 2) {
    stops.push({ x: last.x, y: last.y });
  }
  return stops;
}

/**
 * Every stop a bus can actually pull into: on or beside a street.
 *
 * The check is here rather than at the moment the line is drawn, and that
 * matters in both directions. A player can draw a line straight across the bay —
 * the stroke pipeline is the road tool's and it does not care about water — and
 * without this every building within a walk of the open sea would be served for
 * nothing. And a street that is bulldozed later has to take its stop with it,
 * which a validation at drawing time could never do.
 *
 * Gathered once per traffic pass rather than asked per building: the share is
 * read for every building in the city, and walking every line's every stop
 * inside that loop is the same work multiplied by the number of buildings.
 */
export function servingStops(world: World, fields: Fields, state: GameState): TransitStop[] {
  const stops: TransitStop[] = [];
  for (const line of state.transit.values()) {
    for (const stop of line.stops) {
      if (nearestRoad(world, fields, stop.x, stop.y) < 0) continue;
      stops.push(stop);
    }
  }
  return stops;
}

export function stopCount(state: GameState): number {
  let total = 0;
  for (const line of state.transit.values()) total += line.stops.length;
  return total;
}

/** What the network costs to run, ₺ per minute. */
export function transitUpkeep(state: GameState): number {
  return stopCount(state) * TRANSIT_STOP_UPKEEP;
}

/**
 * The share of a building's trips that go by transit rather than by road.
 *
 * Falls off with the walk to the nearest stop, and is scaled by how full the
 * network already is. Zero for a building nobody's line reaches, which is most
 * of a city and should be.
 */
export function transitShare(
  stops: readonly TransitStop[],
  x: number,
  y: number,
  strain = 1,
): number {
  let nearest = Infinity;
  for (const stop of stops) {
    const distance = Math.hypot(stop.x - x, stop.y - y);
    if (distance < nearest) nearest = distance;
  }
  if (nearest > TRANSIT_STOP_WALK) return 0;
  // Linear in the walk: on the doorstep is the full share, at the edge of the
  // catchment is nothing, and the gradient is what makes stop placement matter.
  const reach = 1 - nearest / (TRANSIT_STOP_WALK + 1);
  return TRANSIT_MAX_SHARE * reach * strain;
}

/**
 * What the whole network is carrying, and how far over its capacity that is.
 *
 * Returned together because the second is derived from the first and every
 * caller that wants one wants the other: the ridership sets the fares, and the
 * strain scales the share back so an overloaded network stops taking cars off
 * the road it can no longer carry.
 */
export interface TransitLoad {
  /** Riders a minute the network is carrying. */
  riders: number;
  /** 1 while there is room; below 1 once the lines are full. */
  strain: number;
}

export function transitLoad(
  state: GameState,
  stops: readonly TransitStop[],
  tripsAt: TripsAt,
): TransitLoad {
  const lines = state.transit.size;
  if (lines === 0 || stops.length === 0) return { riders: 0, strain: 1 };

  // First pass at full share, to find out what the network is being asked for.
  let wanted = 0;
  for (const building of state.buildings.values()) {
    const share = transitShare(stops, building.x, building.y);
    if (share <= 0) continue;
    wanted += tripsAt(building.x, building.y) * share;
  }

  const capacity = lines * TRANSIT_LINE_CAPACITY;
  // Over capacity the whole network scales back together rather than the last
  // stop drawn being the one that fails: a full bus is full everywhere on the
  // route, and "which of my stops is the unlucky one" is not a decision the
  // player could act on anyway.
  const strain = wanted > capacity ? capacity / wanted : 1;
  return { riders: Math.min(wanted, capacity), strain };
}

/** How many trips a building at a tile generates. Supplied by the traffic pass. */
export type TripsAt = (x: number, y: number) => number;

/** Fares, ₺ per minute. */
export function fareIncome(riders: number): number {
  return riders * TRANSIT_FARE;
}

/**
 * Lays a line along a drawn path. Returns the line, or null if it is too short
 * to be one — a tap is not a bus route.
 */
export function layTransit(state: GameState, path: readonly TransitStop[]): TransitLine | null {
  const stops = stopsAlong(path);
  if (stops.length < 2) return null;
  const id = state.nextTransitId++;
  const line: TransitLine = {
    id,
    path: path.map((point) => ({ x: point.x, y: point.y })),
    stops,
  };
  state.transit.set(id, line);
  return line;
}
