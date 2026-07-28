import { OPPONENT_NAMES, OPPONENTS, type OpponentArchetype } from '../data/opponents';
import { OPPONENT_PULL } from '../data/balance';
import { electorateApproval, readGroups, type GroupId } from './groups';
import { createRng, hashSeed } from './rng';
import type { GameState } from './state';
import { electionsRun } from './unrest';

/**
 * The candidate standing against you this term (§31).
 *
 * data/opponents.ts explains what this is for. The machinery is two functions:
 * who it is, and what having them there does to the count.
 *
 * ## Derived, never rolled
 *
 * Seed plus term number, exactly like the lobbies' offers and the site goals'
 * squares. A reload must not change who is running — otherwise a player facing
 * a candidate who happens to court their weakest constituency would simply
 * reload until they got an easier one, and the whole system would become a
 * lottery played against the save button.
 *
 * The term is part of the hash rather than the whole of it, so the same city
 * faces a *sequence* of different candidates across a game while another city on
 * another seed faces a different sequence. Two cities with the same seed see the
 * same politics, which is the property the rest of this codebase keeps.
 *
 * ## No opponent after a coup
 *
 * A government that ended the voting has nobody standing against it, and saying
 * otherwise in the panel would be the game describing an election it is not
 * going to hold.
 */
export interface Opponent {
  archetype: OpponentArchetype;
  name: string;
  /** Which term this candidate is standing in. */
  term: number;
}

/** Who is standing in a given term, or null if nobody is. */
export function opponentFor(state: GameState, term: number): Opponent | null {
  // Term zero is the founding; nobody stands against a village that has not
  // held a vote yet.
  if (term <= 0) return null;
  if (!electionsRun(state)) return null;

  const rng = createRng((state.seed ^ hashSeed(`opponent:${term}`)) >>> 0);
  const archetype = OPPONENTS[rng.int(0, OPPONENTS.length - 1)];
  if (!archetype) return null;
  const name = OPPONENT_NAMES[rng.int(0, OPPONENT_NAMES.length - 1)] ?? '';
  return { archetype, name, term };
}

/**
 * How much of one faction the opposition takes, 0..1 of that faction's weight.
 *
 * Proportional to how badly the mayor is already doing with them, which is the
 * whole design: **the opposition wins where you have failed.** A faction at 0.9
 * approval loses almost nothing; one at 0.3 loses most of what is available.
 *
 * That makes the opponent a magnifying glass rather than a tax. It never takes
 * anything from a constituency the player has looked after, so it can never feel
 * arbitrary — and it gives one clear instruction before every vote: shore up
 * your weakest room, or somebody else will speak for it.
 */
export function poachedShare(approval: number): number {
  const dissatisfaction = 1 - clamp01(approval);
  return OPPONENT_PULL * dissatisfaction;
}

/** Whether this candidate is working a given faction. */
export function courts(opponent: Opponent | null, id: GroupId): boolean {
  if (!opponent) return false;
  return opponent.archetype.courts.includes(id);
}

export interface ContestedVote {
  /** The mayor's share after the opposition has taken what it can, 0..1. */
  share: number;
  /** What the opposition took, 0..1 — for the panel and the announcement. */
  lost: number;
}

/**
 * Counts the vote with somebody standing against you.
 *
 * Reads the same faction weights and approvals the uncontested count does, so
 * this cannot disagree with the panel's own rows: what changes is only that the
 * two constituencies the candidate is working give up a slice proportional to
 * their dissatisfaction.
 *
 * With no opponent — the founding, or after a coup — this is exactly the
 * ordinary weighted sum, which is the contract that lets the caller use it
 * unconditionally.
 */
export function contestedVote(state: GameState, opponent: Opponent | null): ContestedVote {
  const groups = readGroups(state);
  let weight = 0;
  for (const group of groups) weight += group.weight;
  // A settlement with no measurable constituencies defers to the reading
  // sim/groups.ts already owns, rather than reporting nothing.
  //
  // This is load-bearing, not defensive. The faction weights come from the
  // cohort bands, which are derived and re-filled within a tick of loading — so
  // there is a window right after a reload where every weight is zero. Returning
  // 0 here would hand the election settlement a share of zero and lose the vote
  // outright, in a city whose actual support was never in question. Same
  // fallback, one source of truth.
  if (weight <= 0) return { share: electorateApproval(state), lost: 0 };

  let mine = 0;
  let lost = 0;
  for (const group of groups) {
    const held = group.weight * group.approval;
    if (!courts(opponent, group.id as GroupId)) {
      mine += held;
      continue;
    }
    // The slice the candidate takes comes out of what this faction was giving
    // the mayor, so a faction that was giving nothing cannot be poached of
    // anything — there is nothing there to take.
    const taken = held * poachedShare(group.approval);
    mine += held - taken;
    lost += taken;
  }

  return { share: clamp01(mine), lost: clamp01(lost) };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
