import {
  ELECTION_THRESHOLD,
  MANDATE_HAPPINESS,
  MANDATE_PER_CITIZEN,
  REBUKE_HAPPINESS,
  TERM_YEARS,
  VERDICT_MEMORY_S,
} from '../data/balance';
import { SECONDS_PER_YEAR } from '../data/timeline';
import { electorateApproval } from './groups';
import { electionsRun, restoreMandate } from './unrest';
import type { GameState } from './state';

/**
 * The vote (§30).
 *
 * Every other system in this game answers to the player continuously — a number
 * moves, they see it, they act. An election is the one that answers back at a
 * fixed moment, on the city's own calendar, whether or not they were looking.
 * That is the whole point of having it: it takes the running tally of how the
 * city is doing and turns it into a date.
 *
 * **It is not a lose condition.** A player who is beaten keeps their city, their
 * money and their map; what they lose is the grant, and the mood carries a
 * rebuke for a couple of minutes. A city builder that takes the city away has
 * misunderstood what the player was building, and this game has refused that
 * everywhere else — away time earns rather than destroys, hazards wait for
 * somebody to be watching, and a purchase is never a trap.
 *
 * What a win pays is capital rather than a raise: a grant to spend on the next
 * term is a decision, where a permanent uplift is only a number going up faster.
 *
 * Approval is a weighted read of things the player can already see and already
 * has levers for — the mood, the tax rate, the bins, the crime, the backlog at
 * the cemetery. Nothing in it is hidden, so a defeat is never a surprise, only a
 * warning that was ignored.
 *
 * Derived from played time rather than counted, so a reload cannot skip a term
 * or hold two. Pure and deterministic: no dice. An election is not a lottery.
 */

/** Which term the city is in, counting from its founding. */
export function termOf(playedMs: number): number {
  return Math.floor(playedMs / 1000 / SECONDS_PER_YEAR / TERM_YEARS);
}

/** Seconds until the next vote. For the panel to count down. */
export function secondsToElection(playedMs: number): number {
  const termLength = SECONDS_PER_YEAR * TERM_YEARS;
  const into = (playedMs / 1000) % termLength;
  return termLength - into;
}

/**
 * How the city would vote today, 0..1.
 *
 * Since §23 this is the weighted sum of the factions (sim/groups.ts) rather
 * than one civic checklist: the retired, the shopkeepers and the greens each
 * cast their own reading of systems the player can already see, weighted by
 * how many of them there are. The old checklist did not disappear — its terms
 * became the civic base every faction shares and the pet issues they don't.
 * Still no dice anywhere: a defeat is a warning that was ignored, and now the
 * panel says which faction gave it.
 */
export function approval(state: GameState): number {
  return electorateApproval(state);
}

export type Verdict = 'won' | 'lost';

export interface ElectionEvent {
  kind: 'election';
  verdict: Verdict;
  /** The share that voted for the mayor, for the announcement to quote. */
  approval: number;
  /** Money granted, on a win — across every term settled at once. */
  grant: number;
  /** How many terms this settles. More than one only after an absence. */
  terms: number;
}

const NO_EVENTS: readonly ElectionEvent[] = [];

/**
 * Holds an election when the calendar reaches one.
 *
 * The term is derived from played time and compared against the last one settled,
 * so a reload in the middle of a term cannot skip a vote or hold two — and a
 * player who leaves for an hour comes back to the elections that happened, in
 * order, rather than to one enormous one.
 */
export function stepElections(state: GameState, dt: number): readonly ElectionEvent[] {
  if (state.verdictMemory > 0) state.verdictMemory = Math.max(0, state.verdictMemory - dt);

  // A government that ended the voting does not hold elections (§29). The term
  // clock is still advanced below so that restoring the vote — which nothing
  // currently does — would not fire a decade of back-dated ballots at once.
  if (!electionsRun(state)) {
    state.lastTermSettled = termOf(state.playedMs);
    return NO_EVENTS;
  }

  const term = termOf(state.playedMs);
  // Term zero is the founding: nobody elected anybody to build a village.
  if (term <= state.lastTermSettled) return NO_EVENTS;
  const missed = term - state.lastTermSettled;
  state.lastTermSettled = term;
  // A settlement with nobody in it has nobody to vote. Skipped rather than lost,
  // because losing an election a city was too small to hold is not a lesson.
  if (state.population < 1) return NO_EVENTS;

  const share = approval(state);
  const won = share >= ELECTION_THRESHOLD;
  state.verdictMemory = VERDICT_MEMORY_S;
  state.lastVerdict = won ? 'won' : 'lost';

  /**
   * Every term that went past is settled, not only the latest.
   *
   * The offline path advances `playedMs` by the whole absence *before* it starts
   * stepping, so an hour away arrives here as one jump across several terms. The
   * first version settled only the term it landed in and silently swallowed the
   * grants for the rest — a player docked several mandates for having been away,
   * which is precisely the punishment-for-not-playing sim/offline.ts refuses.
   *
   * They are settled at today's approval because there is no record of what it
   * was at the time, and reported as one line rather than several: five toasts
   * at once is not five pieces of news.
   */
  const grant = won ? Math.round(state.population * MANDATE_PER_CITIZEN) * missed : 0;
  if (grant > 0) state.money += grant;
  // Winning is the honest way back to legitimacy: a mayor who refused a result
  // and then won the next vote is elected again, and the streets settle at the
  // ordinary rate from wherever the refusal left them (§29).
  if (won) restoreMandate(state);
  return [{ kind: 'election', verdict: state.lastVerdict, approval: share, grant, terms: missed }];
}

/**
 * What the last verdict is still doing to the mood.
 *
 * Fades rather than sticking, so a bad term is recoverable inside the next one —
 * a permanent mark would make one bad vote compound into every one after it,
 * which is a spiral rather than a game.
 */
export function verdictHappiness(state: GameState): number {
  if (state.verdictMemory <= 0) return 0;
  const fade = state.verdictMemory / VERDICT_MEMORY_S;
  return state.lastVerdict === 'won' ? MANDATE_HAPPINESS * fade : -REBUKE_HAPPINESS * fade;
}
