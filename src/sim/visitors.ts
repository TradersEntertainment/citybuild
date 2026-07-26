import {
  VISITOR_CONGESTION_BITE,
  VISITOR_DECAY_PER_TILE,
  VISITOR_PER_SHOP_JOB,
  VISITOR_REACH,
  VISITOR_SATURATION,
  VISITOR_SHARE,
  VISITOR_SPEND,
} from '../data/balance';
import { highwayInterchanges, transitFlow } from './highway';
import { canTravel } from './oneWay';
import { nearestRoad } from './traffic';
import type { Fields } from './fields';
import type { GameState } from './state';
import { NONE } from './tiles';
import { index, type World } from './world';

/**
 * The country's traffic, coming into the city.
 *
 * Until now the corridor paid an abstract toll: a formula over how much of the
 * route the city owned and how many junctions it had. That was a placeholder for
 * the thing the whole game is supposed to be about — a city sits on the one road
 * and decides what to make of that — and the placeholder could not be *played*.
 * A player could not see where the money came from, could not route it, and
 * could not lose it by building badly.
 *
 * So the traffic now actually comes in. A share of the through-traffic has a
 * reason to stop; it leaves the motorway at an interchange, and from there it
 * flows into the city along the player's own streets, thinning as it goes and
 * thinning faster where the street is jammed. Shops standing where that flow
 * still runs sell to it.
 *
 * That gives the player four levers they never had, all of them things they were
 * already doing for other reasons:
 *
 * - where the interchange is, because that is where the flow starts;
 * - what the road out of it is, because a dirt track passes less than a boulevard
 *   and a jammed street passes less than either;
 * - how far the shops are from it, because the flow decays with every tile;
 * - whether there are any shops at all, because nothing else can take the money.
 *
 * A field rather than agents, like every other flow in this simulation. Routing
 * individual visitors would be betweenness centrality again — far too expensive
 * on a phone, and invisible at the scale the map is read.
 */
export interface VisitorField {
  /** Visitors per minute passing each tile. */
  flow: Float32Array;
}

export function createVisitorField(size: number): VisitorField {
  return { flow: new Float32Array(size * size) };
}

/**
 * How many visitors a minute the city can attract off the motorway.
 *
 * Two things gate it. The traffic has to be there — that is the corridor's own
 * flow, which grows with the city and with its junctions — and there has to be
 * somewhere to spend money, which is shops. A city with a motorway and no shops
 * gets waved at.
 */
export function visitorsWanting(state: GameState, shopJobs: number): number {
  if (highwayInterchanges(state.world) === 0) return 0;
  const passing = transitFlow(state) * VISITOR_SHARE;
  // What the city has to offer, as a fraction that saturates: the first parade of
  // shops is most of the draw, and the hundredth adds very little.
  const draw = 1 - Math.exp(-shopJobs / VISITOR_PER_SHOP_JOB);
  return passing * draw;
}

/**
 * Spreads the visitors in from the interchanges.
 *
 * A wavefront rather than the diffusion the ordinary traffic uses, because the
 * question here is different: not "how much crosses this tile" but "how much is
 * still coming this far". So each ring hands a fixed fraction on to the ring
 * beyond it, less on a jammed tile, and stops at a bounded distance. A visitor
 * who has crawled twenty streets into a strange city has gone home.
 */
export function computeVisitors(
  state: GameState,
  visitors: VisitorField,
  load: Float32Array,
  shopJobs: number,
): void {
  const world = state.world;
  const { flow } = visitors;
  flow.fill(0);

  const total = visitorsWanting(state, shopJobs);
  if (total <= 0) return;

  // Every junction shares the arrivals. A city with one interchange concentrates
  // them on one street; a city with four spreads them, which is both fairer and
  // what a player who built four junctions was asking for.
  const gates: number[] = [];
  for (const point of world.highwayRoute) {
    const i = index(world, point.x, point.y);
    if ((world.highwayBlocked[i] ?? 0) === 1) continue;
    for (let d = 0; d < 4; d++) {
      const nx = point.x + DX[d]!;
      const ny = point.y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const ni = index(world, nx, ny);
      if ((world.road[ni] ?? NONE) === NONE) continue;
      if ((world.highway[ni] ?? 0) === 1) continue;
      if ((world.connected[ni] ?? 0) !== 1) continue;
      // A junction onto a street signed *toward* the motorway is an exit, not an
      // entrance. Counting it as a gate divided the arrivals between a way in
      // and a way out and then threw half of them away, which made a correctly
      // built one-way pair earn less than the two-way street it replaced — the
      // exact opposite of the point.
      if (!canTravel(world, point.x, point.y, nx, ny)) continue;
      gates.push(ni);
    }
  }
  if (gates.length === 0) return;

  const perGate = total / gates.length;
  let frontier: number[] = [];
  const seen = new Uint8Array(flow.length);
  for (const gate of gates) {
    if (seen[gate] === 1) {
      flow[gate] = (flow[gate] ?? 0) + perGate;
      continue;
    }
    seen[gate] = 1;
    flow[gate] = (flow[gate] ?? 0) + perGate;
    frontier.push(gate);
  }

  for (let ring = 0; ring < VISITOR_REACH && frontier.length > 0; ring++) {
    const next: number[] = [];
    for (const at of frontier) {
      const here = flow[at] ?? 0;
      if (here <= 0) continue;
      const x = at % world.size;
      const y = (at - x) / world.size;

      // A queueing street passes less on: the queue is where visitors give up
      // and turn round, and it is the one part of congestion a player can fix by
      // drawing a wider road. Measured over capacity, like the vehicle speeds —
      // a street that is merely busy is not a queue, and biting on busyness
      // would punish the player for having a city.
      const queue = Math.max(0, (load[at] ?? 0) - 1);
      const passed = here * VISITOR_DECAY_PER_TILE * (1 / (1 + queue * VISITOR_CONGESTION_BITE));

      const onward: number[] = [];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
        const ni = index(world, nx, ny);
        if ((world.road[ni] ?? NONE) === NONE) continue;
        // The motorway is not the city: visitors who rejoin it have left.
        if ((world.highway[ni] ?? 0) === 1) continue;
        // And a one-way street they cannot legally take is not a way in
        // (sim/oneWay.ts) — the sharpest lever a player has over where the
        // country's money goes, and the easiest to point the wrong way.
        if (!canTravel(world, x, y, nx, ny)) continue;
        if (seen[ni] === 1) continue;
        onward.push(ni);
      }
      if (onward.length === 0) continue;

      const share = passed / onward.length;
      for (const ni of onward) {
        seen[ni] = 1;
        flow[ni] = (flow[ni] ?? 0) + share;
        next.push(ni);
      }
    }
    frontier = next;
  }
}

/**
 * The visitor trade a building is standing in, as an output multiplier.
 *
 * Replaces the old flat bonus for being anywhere near a junction. That version
 * could not tell a shop on the road out of the interchange from one three
 * districts away behind a jam, which meant the player had nothing to aim at.
 */
export function visitorFactor(
  world: World,
  fields: Fields,
  visitors: VisitorField,
  x: number,
  y: number,
): number {
  const road = nearestRoad(world, fields, x, y);
  if (road < 0) return 1;
  const passing = visitors.flow[road] ?? 0;
  if (passing <= 0) return 1;
  // Saturating, so the one shop on the busiest corner cannot earn a hundred
  // times what its neighbour does — and so adding shops is always better than
  // stacking one.
  return 1 + VISITOR_SPEND * (1 - Math.exp(-passing / VISITOR_SATURATION));
}

/** Visitors a minute the city is actually taking in, for the panel to read. */
export function visitorsArriving(visitors: VisitorField, world: World): number {
  let total = 0;
  for (const point of world.highwayRoute) {
    for (let d = 0; d < 4; d++) {
      const nx = point.x + DX[d]!;
      const ny = point.y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      if ((world.highway[index(world, nx, ny)] ?? 0) === 1) continue;
      total += visitors.flow[index(world, nx, ny)] ?? 0;
    }
  }
  return total;
}

const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;
