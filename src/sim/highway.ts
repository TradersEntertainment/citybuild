import {
  TRANSIT_BASE_FLOW,
  TRANSIT_FLOW_MAX,
  TRANSIT_INTERCHANGE_PULL,
  TRANSIT_POPULATION_PULL,
  TRANSIT_TOLL,
  TRANSIT_TRADE_BONUS,
  TRANSIT_TRADE_RADIUS,
} from '../data/balance';
import { createFbm } from './noise';
import { createRng } from './rng';
import type { GameState } from './state';
import { encodeRoad, NONE } from './tiles';
import { index, isTileOwned, startingCentre, type World } from './world';

/**
 * The national highway (ulusal otoyol).
 *
 * One state-owned motorway crosses every map from edge to edge, and it is there
 * before the player draws a thing. It exists to give the road verb a *thesis*:
 * a city is not a tangle of streets for their own sake, it is a place that
 * sits on the country's one road and decides what to make of that. Where the
 * route crosses owned land the city can earn from the traffic it carries;
 * where the player's streets meet it, the city's goods and commuters get out
 * to the rest of the country.
 *
 * The route is deterministic in the world seed — same seed, same road — so it
 * is regenerated on load alongside the terrain and never written to the save.
 * It is stamped into the ordinary road column (so every renderer and every
 * adjacency query sees it) and marked in a separate mask (so every rule that
 * treats the player's own pavement differently can tell it apart):
 *
 * - the player cannot draw over it, upgrade it, or demolish it;
 * - the player pays no upkeep on it — the state maintains its own motorway;
 * - buildings may not front onto it directly (it is access-controlled, like
 *   the buildable highway tier), so the only way onto it is an interchange:
 *   a player road that touches it.
 */
export interface HighwayPoint {
  x: number;
  y: number;
}

/**
 * Lays the route into the world's road column and mask, and records it in
 * order on the world so traffic can inject flow along it and vehicles can
 * drive it end to end. Runs once, right after terrain generation.
 */
export function layNationalHighway(world: World): void {
  const route = plotRoute(world);
  world.highwayRoute = route;
  for (const point of route) {
    const i = index(world, point.x, point.y);
    world.highway[i] = 1;
    // The highway is laid before the player has drawn anything, so this never
    // overwrites a player road — but a regenerated world beside a save decodes
    // its own column afterwards, which is why the mask is the authority.
    if ((world.road[i] ?? NONE) === NONE) world.road[i] = encodeRoad('highway');
  }
}

/** True where the state's own motorway runs — never the player's pavement. */
export function isNationalHighway(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  return (world.highway[index(world, x, y)] ?? 0) === 1;
}

/**
 * How many interchanges the city has: national-highway tiles touching a player
 * road in one of the four directions. This is the whole interface between the
 * city and the country — no interchange, and the traffic streams past without
 * ever becoming the city's business.
 */
export function highwayInterchanges(world: World): number {
  let count = 0;
  for (const point of world.highwayRoute) {
    // A junction onto a barricaded stretch is a junction onto nothing: no
    // through-traffic to sell to, no way out for the city's own lorries.
    if ((world.highwayBlocked[index(world, point.x, point.y)] ?? 0) === 1) continue;
    if (touchesPlayerRoad(world, point.x, point.y)) count++;
  }
  return count;
}

/** National-highway tiles standing on land the player owns. */
export function ownedHighwayTiles(world: World): number {
  let count = 0;
  for (const point of world.highwayRoute) {
    if (isTileOwned(world, point.x, point.y)) count++;
  }
  return count;
}

/**
 * Through-traffic on the national road, in vehicles per minute.
 *
 * A motorway never stands empty, so there is a floor; on top of that, a city
 * on the route is both a destination and a reason for the route to exist, so
 * traffic grows with population — by square root, so a village already matters
 * and a metropolis does not swamp the road's capacity figure. Each interchange
 * pulls a little more of the country's traffic past the city's door, up to a
 * cap, because a junction people can use is a reason to take this road rather
 * than the other one.
 */
export function transitFlow(state: GameState): number {
  const pull = TRANSIT_POPULATION_PULL * Math.sqrt(Math.max(0, state.population));
  const interchanges = Math.min(4, highwayInterchanges(state.world));
  const flow =
    (TRANSIT_BASE_FLOW + pull) * (1 + TRANSIT_INTERCHANGE_PULL * interchanges);
  return Math.min(TRANSIT_FLOW_MAX, flow);
}

/**
 * What the through-traffic pays the city, ₺ per minute.
 *
 * The catch is two-sided: how much of the route crosses *owned* land (the part
 * of the corridor the city can actually monetise — fuel, food, beds, toll
 * concessions), and whether there is an interchange at all. With no junction
 * the money is a rumour; with one, the city starts collecting on the stretch
 * it owns; with several, it captures the corridor properly.
 */
export function transitIncome(state: GameState): number {
  const interchanges = highwayInterchanges(state.world);
  if (interchanges === 0) return 0;
  const total = state.world.highwayRoute.length;
  if (total === 0) return 0;
  const ownedShare = ownedHighwayTiles(state.world) / total;
  const capture = Math.min(1, 0.4 + 0.3 * (interchanges - 1));
  return transitFlow(state) * TRANSIT_TOLL * ownedShare * capture;
}

/**
 * Trade bonus for a workplace: shops and workshops near an interchange sell to
 * the through-traffic as well as to the city. Returns the output multiplier —
 * 1 when the building is nowhere near a junction.
 */
export function highwayTradeFactor(state: GameState, x: number, y: number): number {
  const radius = TRANSIT_TRADE_RADIUS;
  for (const point of state.world.highwayRoute) {
    if (Math.abs(point.x - x) > radius || Math.abs(point.y - y) > radius) continue;
    if (!touchesPlayerRoad(state.world, point.x, point.y)) continue;
    if (Math.hypot(point.x - x, point.y - y) <= radius) return TRANSIT_TRADE_BONUS;
  }
  return 1;
}

// --- Route plotting ------------------------------------------------------------

/**
 * Plots the edge-to-edge path. One axis is chosen by the seed; the crossing
 * coordinate wanders with low-frequency noise; and the whole line is nudged so
 * it crosses the starting parcel — that is the player's "area", and a national
 * road that never comes near the first city would be scenery rather than a
 * game. The offset lands off-centre on purpose, so the road is in the player's
 * face without bisecting the exact spot the camera opens on.
 *
 * The stamped path is always 4-connected: where the line steps diagonally the
 * walker fills the elbows one unit at a time, because the traffic spread,
 * junction accounting and trip injection all read the grid four ways.
 */
function plotRoute(world: World): HighwayPoint[] {
  const rng = createRng(world.seed ^ 0x51ab7e);
  const horizontal = rng.next() < 0.5;
  const meander = createFbm(world.seed ^ 0x77c1d3, { octaves: 3, scale: 90 });

  const centre = startingCentre(world);
  const size = world.size;
  const margin = 6;
  const span = size - 1 - margin;

  // Where the line crosses the middle of the map: inside the starting parcel,
  // but pushed a seeded distance off its centre.
  const throughParcel = (rng.next() < 0.5 ? -1 : 1) * (8 + rng.next() * 10);
  const targetMain = (horizontal ? centre.y : centre.x) + throughParcel;
  // The far-field baseline: which band of the map the road favours away from
  // the city. Rolled once — a baseline re-rolled per tile is a sawtooth, not
  // a motorway.
  const baseline = size * (0.28 + rng.next() * 0.44);

  const route: HighwayPoint[] = [];
  let previous: HighwayPoint | null = null;

  for (let step = 0; step <= span; step++) {
    const along = margin + step;
    const t = along / (size - 1);
    // Low-frequency wander around the baseline, then a smooth pull toward the
    // starting-parcel crossing that peaks at the middle of the map.
    const wander = (meander(along, 0) - 0.5) * 2 * 34;
    const pull = Math.exp(-Math.pow((t - 0.5) / 0.22, 2));
    let across = baseline + wander;
    across = across * (1 - pull) + (targetMain + wander * 0.35) * pull;
    const cross = Math.round(Math.min(size - 1 - margin, Math.max(margin, across)));

    const point = horizontal ? { x: along, y: cross } : { x: cross, y: along };
    if (previous === null) {
      route.push(point);
    } else {
      // Walk from the last tile to this one in unit steps — along first, then
      // across — so a steep meander still stamps a 4-connected path rather
      // than jumping diagonals the traffic spread could never follow.
      let cx = previous.x;
      let cy = previous.y;
      while (cx !== point.x || cy !== point.y) {
        if (cx !== point.x) cx += Math.sign(point.x - cx);
        else if (cy !== point.y) cy += Math.sign(point.y - cy);
        const last = route[route.length - 1] as HighwayPoint;
        if (last.x !== cx || last.y !== cy) route.push({ x: cx, y: cy });
      }
    }
    previous = point;
  }

  return route;
}

/** True when any of the four orthogonal neighbours is the player's pavement. */
function touchesPlayerRoad(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
    const i = index(world, nx, ny);
    if ((world.road[i] ?? NONE) === NONE) continue;
    if ((world.highway[i] ?? 0) === 1) continue; // the motorway itself does not count
    return true;
  }
  return false;
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
