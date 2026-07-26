import type { HighwayPoint } from '../sim/highway';

/**
 * Through-trips on the motorway.
 *
 * The country's traffic crosses the map. A vehicle that stops in the city has to
 * come in from one edge, turn off, do its business and rejoin — and then carry
 * on to the *other* edge, because that is what through-traffic is.
 *
 * The first version got this wrong in a way that was obvious the moment anybody
 * watched it. Both the lead-in and the lead-out were built by asking for the
 * nearer end of the route, so a visitor arrived from one edge and left back the
 * same one: a U-turn on a motorway, performed by every car, forever. Worse, both
 * legs stopped one tile short of the junction, so the path had a hole in it and
 * the vehicle jumped from the hard shoulder onto a side street.
 *
 * The arithmetic is small and entirely about indices into the route, so it lives
 * here where it can be tested rather than inside the traffic layer's closure.
 */

/** One direction of travel along the route as it is stored. */
export type Along = 'forward' | 'backward';

export interface ThroughLegs {
  /** Route tiles from the entry edge up to and including the entry junction. */
  leadIn: Int32Array;
  /** Route tiles from the exit junction to the far edge, inclusive. */
  leadOut: Int32Array;
}

/** Where a tile sits along the route, or −1 if it is not on it. */
export function routeStepOf(route: readonly HighwayPoint[], size: number, tile: number): number {
  const x = tile % size;
  const y = (tile - x) / size;
  for (let i = 0; i < route.length; i++) {
    const point = route[i] as HighwayPoint;
    if (point.x === x && point.y === y) return i;
  }
  return -1;
}

/**
 * The two motorway legs of a through-trip.
 *
 * Both legs *include* their junction tile, so the path they are spliced into is
 * continuous: the junction and the street beside it are one orthogonal step
 * apart, and the vehicle drives through the junction rather than teleporting
 * across it.
 *
 * Returns null when the pair does not describe a through-trip — when the exit
 * lies behind the entry in the direction of travel, which would be the U-turn
 * this exists to prevent. The caller lets that vehicle drive past instead, which
 * is what a driver with no reason to stop does anyway.
 */
export function throughLegs(
  route: readonly HighwayPoint[],
  size: number,
  entryStep: number,
  exitStep: number,
  along: Along,
): ThroughLegs | null {
  const last = route.length - 1;
  if (entryStep < 0 || exitStep < 0 || entryStep > last || exitStep > last) return null;

  // Travelling forward, the exit has to be at or ahead of the entry; backward,
  // at or behind it. Equal is fine and is the common case — a city with one
  // junction leaves and rejoins at the same place, which is not a U-turn: the
  // car came from one edge and still leaves by the other.
  if (along === 'forward' ? exitStep < entryStep : exitStep > entryStep) return null;

  const leadIn = slice(route, size, along === 'forward' ? 0 : last, entryStep);
  const leadOut = slice(route, size, exitStep, along === 'forward' ? last : 0);
  // A junction sitting on the very edge of the map gives a leg of one tile,
  // which is legitimate; a leg of none means the route was empty.
  if (leadIn.length === 0 || leadOut.length === 0) return null;
  return { leadIn, leadOut };
}

/** Route tiles from one step to another inclusive, in travel order. */
function slice(
  route: readonly HighwayPoint[],
  size: number,
  from: number,
  to: number,
): Int32Array {
  const step = to >= from ? 1 : -1;
  const count = Math.abs(to - from) + 1;
  const out = new Int32Array(count);
  for (let n = 0; n < count; n++) {
    const point = route[from + n * step] as HighwayPoint;
    out[n] = point.y * size + point.x;
  }
  return out;
}

/**
 * Picks the junction to rejoin at: the nearest one ahead of the entry.
 *
 * Nearest rather than random, because a visitor who has finished their errand
 * wants the next slip road, not one four districts further on — and because a
 * long return leg is a long path for the pathfinder to find and hold.
 */
export function exitAhead(
  candidates: readonly number[],
  stepOf: (tile: number) => number,
  entryStep: number,
  along: Along,
): number {
  let best = -1;
  let bestStep = -1;
  for (const tile of candidates) {
    const step = stepOf(tile);
    if (step < 0) continue;
    const ahead = along === 'forward' ? step >= entryStep : step <= entryStep;
    if (!ahead) continue;
    if (best < 0 || Math.abs(step - entryStep) < Math.abs(bestStep - entryStep)) {
      best = tile;
      bestStep = step;
    }
  }
  return best;
}
