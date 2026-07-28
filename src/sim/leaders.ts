import { LEADER_BASE_SWAY } from '../data/balance';
import { LEADER_SPECS, NEUTRAL_LEADER, type LeaderId } from '../data/leaders';
import type { GroupId } from './groups';
import type { GameState } from './state';

/**
 * The chosen leader's standing effects (§33).
 *
 * Three hooks, each read by the system that already owns the number, each
 * answering the neutral value for a game that never picked a leader (an old
 * save, loaded before this existed). The base is the only one that touches the
 * factions; the other two are single multipliers handed to fury and to the
 * grant.
 */

/** The current leader, defaulting an unset one to neutral rather than crashing. */
export function leaderOf(state: GameState): LeaderId {
  return state.leader in LEADER_SPECS ? (state.leader as LeaderId) : NEUTRAL_LEADER;
}

/**
 * The permanent warmth a leader's base lends one faction — mild, and read by
 * sim/groups.ts alongside the promises and the decrees. Zero for a faction
 * outside the base, which is most of the room.
 */
export function leaderBaseSway(state: GameState, id: GroupId): number {
  return LEADER_SPECS[leaderOf(state)].base.includes(id) ? LEADER_BASE_SWAY : 0;
}

/**
 * The strongman's edge: fury organises more slowly in a city that fears its
 * ruler. A multiplier on every fury accrual (sim/decrees.ts), exactly 1 for a
 * leader without the trait.
 */
export function leaderFuryResist(state: GameState): number {
  return LEADER_SPECS[leaderOf(state)].furyResist ?? 1;
}

/**
 * The patron's edge: every election grant pays heavier. A multiplier on the
 * grant (sim/elections.ts), exactly 1 without the trait.
 */
export function leaderGrantBonus(state: GameState): number {
  return LEADER_SPECS[leaderOf(state)].grantBonus ?? 1;
}

/** The opening balance a leader adds to the founding treasury. */
export function leaderStartMoney(id: LeaderId): number {
  return LEADER_SPECS[id].startMoney ?? 0;
}
