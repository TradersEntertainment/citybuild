import {
  LEGACY_ERA_BONUS,
  LEGACY_MONEY_PER_POINT,
  LEGACY_POPULATION_DIVISOR,
  STARTING_MONEY,
} from '../data/balance';
import { reportLegacyFactor } from './report';
import type { GameState } from './state';
import { eraRank, type Era } from './tiles';

/**
 * Retiring a city (§6 of Phase 6).
 *
 * An idle game's long tail is the second run. The first city teaches the loop
 * over an evening and then plateaus — the ground is bought, the goals are done,
 * and what is left is watching a number climb. Retiring turns that ending into
 * a beginning: the city is signed off, its size becomes a permanent endowment,
 * and the next one starts on a new map with more in the bank.
 *
 * The endowment is starting money and nothing else. That is deliberate. Every
 * multiplier on growth, demand or income would compound into the opening, which
 * is the part of this game that was measured, tuned and re-tuned the hardest;
 * money buys a longer first road, which is the same game played from a better
 * position rather than a different game.
 *
 * Nothing here deletes anything. It computes what a city is worth and what an
 * endowment buys; the decision, the confirmation and the wiping are the
 * caller's, because a system that can destroy a player's evening should not
 * also be the thing that decides to.
 */

/**
 * What retiring this city right now would be worth.
 *
 * Size and era, scaled by how well the city was actually run (sim/report.ts).
 *
 * The scaling is §25's whole reason for existing. Without it these two terms
 * measure only *how much* a player built, so a sprawling, choked, unequal city
 * hands on exactly as much as a well-planned one of the same size — and the
 * constitution's central dilemma, that populism can out-earn good planning, had
 * nothing on the other side of it. Elections reward the mayor who pleased the
 * most voters. This rewards the one who left the better city, and the two are
 * allowed to be different people.
 */
export function legacyValue(state: GameState): number {
  // Population, sub-linearly: a city twice the size is worth more but not twice
  // as much, or the only way to play would be to grind one run forever.
  const fromPeople = Math.sqrt(Math.max(0, state.population) / LEGACY_POPULATION_DIVISOR);
  // Reaching an era at all is worth something on its own, so a player who built
  // well on a hard map is not out-earned by one who sprawled on an easy one.
  const fromEra = eraRank(state.era) * LEGACY_ERA_BONUS;
  return Math.floor((fromPeople + fromEra) * reportLegacyFactor(state));
}

/** What an endowment adds to the next city's opening balance. */
export function legacyEndowment(legacy: number): number {
  return Math.max(0, Math.round(legacy)) * LEGACY_MONEY_PER_POINT;
}

/**
 * What the next city would actually open with.
 *
 * The card quotes this rather than the endowment. Promising the bonus and
 * handing over the bonus plus the ordinary starting money is a pleasant
 * surprise exactly once and a number the player cannot trust thereafter.
 */
export function legacyOpeningBalance(legacy: number): number {
  return STARTING_MONEY + legacyEndowment(legacy);
}

/**
 * Whether a city is far enough along to be worth signing off.
 *
 * Gated so a new player cannot stumble into throwing away the city they are
 * still learning on. By the town era they have drawn roads, zoned districts,
 * placed a station and watched two eras pass — they know what they would be
 * giving up.
 */
export const RETIRE_FROM: Era = 'town';

export function canRetire(state: GameState): boolean {
  return eraRank(state.era) >= eraRank(RETIRE_FROM) && legacyValue(state) > 0;
}
