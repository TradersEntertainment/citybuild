import { ONE_WAY_CAPACITY_BONUS } from '../data/balance';
import { isNationalHighway } from './highway';
import { NONE } from './tiles';
import { inBounds, index, type World } from './world';

/**
 * One-way streets.
 *
 * The player's idea, and the right one: the road verb had exactly one parameter —
 * how wide — and a city planner's second lever has always been which way round.
 * A one-way street carries more in the direction it points, because there is no
 * oncoming traffic and no turn across it, and it makes everything going the other
 * way go round, which is where the interesting decisions live.
 *
 * Stored as its own column rather than packed into the road byte. The road code
 * is read by fifteen call sites and compared for equality by several of them;
 * stealing its high bits would have been a byte saved and a fortnight of
 * whack-a-mole. A separate column is 64 KB and cannot break anything that does
 * not ask for it.
 *
 * ## The rule
 *
 * The arrow on a tile forbids *travelling against it*. It does not forbid
 * crossing it or turning off it, which is the mistake to avoid and the reason
 * this is a module rather than a comparison written out at each call site:
 *
 * - driving along the arrow: allowed;
 * - driving against it: refused;
 * - turning onto it from a side street: allowed, because the move is
 *   perpendicular to the arrow and is therefore neither with it nor against it;
 * - turning off it onto a side street: allowed, for the same reason.
 *
 * Both ends of a step are checked, so a two-way tile cannot be used to sneak
 * onto a one-way street facing the wrong way.
 *
 * ## What it is deliberately not applied to
 *
 * Connectivity. A single mis-drawn arrow would silently strand a district, and
 * the player would see the buildings empty with nothing on screen saying why —
 * exactly the unexplained failure the rest of this codebase works to avoid. The
 * cost of a bad one-way scheme is congestion and lost visitors, both of which
 * the player can see on the map.
 */

/** No arrow, or the one direction traffic on this tile must travel. */
export const WAY = {
  both: 0,
  east: 1,
  west: 2,
  south: 3,
  north: 4,
} as const;

export type Way = (typeof WAY)[keyof typeof WAY];

/** Step deltas indexed by `Way`; `both` is a zero step and never used. */
const WAY_DX = [0, 1, -1, 0, 0] as const;
const WAY_DY = [0, 0, 0, 1, -1] as const;

/** The direction of a single orthogonal step, or `both` when it is not one. */
export function wayOfStep(dx: number, dy: number): Way {
  if (dy === 0 && dx > 0) return WAY.east;
  if (dy === 0 && dx < 0) return WAY.west;
  if (dx === 0 && dy > 0) return WAY.south;
  if (dx === 0 && dy < 0) return WAY.north;
  return WAY.both;
}

export function wayAt(world: World, x: number, y: number): Way {
  if (!inBounds(world, x, y)) return WAY.both;
  return (world.oneWay[index(world, x, y)] ?? WAY.both) as Way;
}

/**
 * Whether traffic may make this step. The single place the rule lives.
 *
 * Every layer that moves anything along roads asks this — the load spread, the
 * visitor wavefront, the vehicle pathfinder — so a car cannot drive somewhere the
 * economy says it cannot, and a shop cannot be paid for traffic that could not
 * legally have reached it.
 *
 * Diagonal steps are decomposed rather than waved through. The pathfinder moves
 * eight ways, so a car offered a free diagonal would simply drive round the end
 * of every one-way street — the arrows would be decoration. A diagonal is
 * therefore refused if *either* of its components runs against an arrow.
 *
 * Takes the column and the size rather than a `World` so the renderer's road
 * graph, which holds a snapshot and not the world, can ask the same question of
 * the same code.
 */
export function canTravelOn(
  oneWay: Uint8Array,
  size: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return true;
  const here = (oneWay[fromY * size + fromX] ?? WAY.both) as Way;
  const there = (oneWay[toY * size + toX] ?? WAY.both) as Way;
  if (here === WAY.both && there === WAY.both) return true;

  // Each axis of the move, checked on its own.
  if (dx !== 0) {
    const against = dx > 0 ? WAY.west : WAY.east;
    if (here === against || there === against) return false;
  }
  if (dy !== 0) {
    const against = dy > 0 ? WAY.north : WAY.south;
    if (here === against || there === against) return false;
  }
  return true;
}

export function canTravel(
  world: World,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  if (!inBounds(world, fromX, fromY) || !inBounds(world, toX, toY)) return true;
  return canTravelOn(world.oneWay, world.size, fromX, fromY, toX, toY);
}

/**
 * How much more a one-way tile carries.
 *
 * A real one-way street gains more than the lane it stops giving to the other
 * direction: there is no turn across the flow and no oncoming queue at the
 * junctions. So the bonus is worth having on its own — which is what makes the
 * decision interesting, because the cost is entirely in what has to go round.
 */
export function oneWayCapacity(world: World, x: number, y: number): number {
  return wayAt(world, x, y) === WAY.both ? 1 : ONE_WAY_CAPACITY_BONUS;
}

/**
 * Points a run of tiles the way the finger drew it.
 *
 * The direction comes from the stroke rather than from a picker, which is the
 * whole reason this is pleasant on a phone: the player already drew the street
 * in the direction they want it to run. Returns the previous values so the undo
 * stack can put them back.
 */
export interface WayEdit {
  x: number;
  y: number;
  previous: Way;
}

export function setOneWayAlong(
  world: World,
  path: readonly { x: number; y: number }[],
  clear = false,
): WayEdit[] {
  const edits: WayEdit[] = [];
  if (path.length === 0) return edits;

  for (let i = 0; i < path.length; i++) {
    const tile = path[i] as { x: number; y: number };
    if (!inBounds(world, tile.x, tile.y)) continue;
    const at = index(world, tile.x, tile.y);
    if ((world.road[at] ?? NONE) === NONE) continue;
    // The state's motorway is not the mayor's to re-sign.
    if (isNationalHighway(world, tile.x, tile.y)) continue;

    // Each tile points at the next one along the stroke; the last points the
    // same way as the one before it, because a run's final tile has nothing
    // ahead of it and an unmarked tile at the end would be a gap in the street.
    let way: Way = WAY.both;
    if (!clear) {
      const ahead = (path[i + 1] ?? path[i - 1]) as { x: number; y: number } | undefined;
      if (!ahead) continue;
      way =
        i + 1 < path.length
          ? wayOfStep(ahead.x - tile.x, ahead.y - tile.y)
          : wayOfStep(tile.x - ahead.x, tile.y - ahead.y);
      // A diagonal stroke gives no orthogonal direction; leaving those two-way
      // is better than guessing, and the run either side of them still carries
      // the arrow.
      if (way === WAY.both) continue;
    }

    const previous = (world.oneWay[at] ?? WAY.both) as Way;
    if (previous === way) continue;
    edits.push({ x: tile.x, y: tile.y, previous });
    world.oneWay[at] = way;
  }

  return edits;
}

/** Puts back what `setOneWayAlong` changed. */
export function restoreOneWay(world: World, edits: readonly WayEdit[]): void {
  for (const edit of edits) {
    if (!inBounds(world, edit.x, edit.y)) continue;
    world.oneWay[index(world, edit.x, edit.y)] = edit.previous;
  }
}

/** Clears the arrow on tiles that stopped being road, so none is left orphaned. */
export function pruneOneWay(world: World): void {
  for (let i = 0; i < world.oneWay.length; i++) {
    if ((world.oneWay[i] ?? WAY.both) === WAY.both) continue;
    if ((world.road[i] ?? NONE) === NONE) world.oneWay[i] = WAY.both;
  }
}

/** How many tiles carry an arrow, for the panel and the tests. */
export function oneWayTiles(world: World): number {
  let count = 0;
  for (let i = 0; i < world.oneWay.length; i++) {
    if ((world.oneWay[i] ?? WAY.both) !== WAY.both) count++;
  }
  return count;
}

/** Unit step for a direction, for the renderer's arrows. */
export function wayStep(way: Way): { dx: number; dy: number } {
  return { dx: WAY_DX[way] as number, dy: WAY_DY[way] as number };
}
