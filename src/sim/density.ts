import { DENSE_LEVEL_CAP, ZONE_LEVEL_CAP } from '../data/balance';
import { isBuiltZone, type Level } from '../data/buildings';
import { decodeZone, NONE } from './tiles';
import { index, inBounds, type World } from './world';

/**
 * Zoning density (§19): the difference between a suburb and a downtown.
 *
 * The city already knew how to build a tower. Every archetype table runs to
 * five levels and the fifth is three units tall — a proper high-rise — and any
 * plot with good enough services would eventually climb to it. Which meant the
 * skyline happened *to* the player rather than being something they decided,
 * and a city had no districts: given time, everywhere became everywhere else.
 *
 * So density is a switch on the zoning tool, not a new kind of zone. That
 * matters more than it sounds. A `ZoneKind` of `resHigh` would have meant
 * touching every `zone === 'res'` in the codebase and a save format that has to
 * understand five more codes; a column beside the zone column means the zone
 * stays `res` and only the handful of places that care about height read this.
 * It is the same shape as the one-way arrows, for the same reason.
 *
 * **The rule, in one line:** ordinary ground builds to level three, dense
 * ground builds to five — and dense ground the city has not serviced stops at
 * three like everything else.
 *
 * That second half is what stops this being a free upgrade. Painting dense
 * costs several times as much, and the fourth and fifth floors are gated on the
 * plot's own suitability (DENSE_GROWTH_SCORE): the player buys the *right* to a
 * downtown, and then the city has to be worth building one in. An unserviced
 * dense block still builds — it just stops at three storeys, like its
 * neighbours, which is a great deal more legible than an empty lot.
 */

/** Whether the player asked for height here. */
export function isDense(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  return (world.density[index(world, x, y)] ?? 0) === 1;
}

/**
 * The tallest a building on this tile may grow.
 *
 * Read by the growth pass on the way up and by the decay pass on the way down,
 * so re-zoning a downtown back to ordinary ground is not a no-op: the towers
 * come down a floor at a time, the same way a neglected block does. A cap that
 * only applied to growth would leave a skyline standing over zoning that no
 * longer permits it.
 */
export function levelCapAt(world: World, x: number, y: number): Level {
  return isDense(world, x, y) ? DENSE_LEVEL_CAP : ZONE_LEVEL_CAP;
}

/**
 * Clears density from anything that is not buildable zoning.
 *
 * Run after a load and after the zone column changes. A dense marker on a park
 * or on bare ground is a rule with nothing to apply to, and — worse — it would
 * come back the moment the player painted houses there, granting a downtown
 * they never paid for.
 */
export function pruneDensity(world: World): void {
  for (let i = 0; i < world.density.length; i++) {
    if ((world.density[i] ?? 0) === 0) continue;
    if (!isBuiltZone(decodeZone(world.zone[i] ?? NONE))) world.density[i] = 0;
  }
}

/** How much ground the player has zoned for height. Read by the tests. */
export function denseTiles(world: World): number {
  let count = 0;
  for (let i = 0; i < world.density.length; i++) if ((world.density[i] ?? 0) === 1) count++;
  return count;
}
