import {
  ELECTION_THRESHOLD,
  MANDATE_HAPPINESS,
  MANDATE_CARD_FLOOR,
  MANDATE_CARD_SPAN,
  MANDATE_PER_CITIZEN,
  OPENING_BASE_STEP,
  OPENING_FLOOR,
  OPENING_PROMISE_STEP,
  REBUKE_HAPPINESS,
  TERM_YEARS,
  VERDICT_MEMORY_S,
} from '../data/balance';
import { SECONDS_PER_YEAR } from '../data/timeline';
import { electorateApproval } from './groups';
import { settlePromises, type PromiseVerdict } from './promises';
import { contestedVote, opponentFor, type Opponent } from './opponents';
import { readReport } from './report';
import { electionsRun, restoreMandate } from './unrest';
import { leaderGrantBonus } from './leaders';
import { PROMISE_SPECS } from '../data/promises';
import { LEADER_SPECS, type LeaderId } from '../data/leaders';
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

/**
 * The share the mayor would take if the vote were held right now, and who they
 * would be taking it from.
 *
 * The panel reads *this*, not `approval` — and that is not a nicety. The
 * election counts a contested vote (§31), so a panel showing the uncontested
 * figure would promise 55% and then deliver 48% and a defeat, with the
 * difference invisible and unexplained. That is the same class of failure as the
 * blank land-value overlay: a number that is wrong in a direction the player
 * cannot see. The two must come from one function.
 */
export function standingNow(state: GameState): {
  share: number;
  lost: number;
  opponent: Opponent | null;
} {
  // The *next* vote is the one the player can still do something about, so the
  // panel looks forward a term rather than back at the one already settled.
  const rival = opponentFor(state, termOf(state.playedMs) + 1);
  const contested = contestedVote(state, rival);
  return { share: contested.share, lost: contested.lost, opponent: rival };
}

/**
 * What the vote would be for a leader with a set of promises, at the opening
 * (§33) — before there is any city to judge.
 *
 * The onboarding needs a live number as the player picks promises, and it must
 * be the *same* number the real machinery produces or the opening would lie.
 * So this stamps the hypothetical onto a throwaway copy of the relevant state
 * and reads the electorate through the ordinary path: the leader's base and the
 * promises both flow through sim/groups.ts exactly as they will once the game
 * begins.
 *
 * A founding city has no measurable factions yet, so the civic base carries the
 * vote — which is why the promises (which lift named factions) and the leader's
 * base are what move it. That is the lesson the opening is teaching: this is how
 * you win, and this is what you will owe.
 */
export function scoreOpening(
  _state: GameState,
  leader: LeaderId,
  promises: readonly string[],
): number {
  // A dedicated tally, not the running electorate — there is no city yet to
  // judge, so a founding vote can only be about who you are and what you
  // promised. Reusing electorateApproval here gave every candidate ~83% before
  // they had said a word, which made "win by promising" a lie: you already had.
  //
  // Floor, plus your base, plus your promises. Tuned so no leader clears the
  // threshold on their base alone — even the two-constituency ones sit right at
  // the line — so the first thing the game teaches is that you have to promise
  // somebody something to take office.
  const base = LEADER_SPECS[leader]?.base.length ?? 0;
  const made = promises.filter((id) => id in PROMISE_SPECS).length;
  const share =
    OPENING_FLOOR + base * OPENING_BASE_STEP + made * OPENING_PROMISE_STEP;
  return Math.max(0, Math.min(0.95, share));
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
  /** Every promise that came due at this vote, kept or broken (§30). */
  promises: readonly PromiseVerdict[];
  /** Who stood against the mayor, or null after a coup (§31). */
  opponent: Opponent | null;
  /** What the opposition took off the mayor's share, 0..1. */
  lostToOpponent: number;
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

  // Promises are settled *before* the vote is counted (§30), which is the whole
  // shape of the mechanic: the warmth an outstanding promise bought is spent on
  // the election it was made for, and the reckoning lands on the next one. A
  // mayor who promised and delivered goes into this vote with the trust; one
  // who promised and did not goes into the *following* one with the grudge.
  const promises = settlePromises(state);
  // Who is standing, and what having them there costs (§31). The candidate is
  // derived from the seed and the term, so this is the same contest whether the
  // player reloads or not — and it is the term being *settled* rather than the
  // current one, which matters after an absence: each term had its own
  // candidate, and the one that decided the vote is the one that stood in it.
  const rival = opponentFor(state, term);
  const contested = contestedVote(state, rival);
  const share = contested.share;
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
  // What the term is worth, and what the city did with the last one. The card
  // is read once and applied to every term being settled at the same time,
  // which is the honest reading: there is no record of what the card was during
  // an absence, and the alternative is paying the full rate for years nobody
  // watched.
  const standard = MANDATE_CARD_FLOOR + MANDATE_CARD_SPAN * readReport(state).overall;
  const grant = won
    ? Math.round(state.population * MANDATE_PER_CITIZEN * standard * leaderGrantBonus(state)) * missed
    : 0;
  if (grant > 0) state.money += grant;
  // Winning is the honest way back to legitimacy: a mayor who refused a result
  // and then won the next vote is elected again, and the streets settle at the
  // ordinary rate from wherever the refusal left them (§29).
  if (won) restoreMandate(state);
  return [
    {
      kind: 'election',
      verdict: state.lastVerdict,
      approval: share,
      grant,
      terms: missed,
      promises,
      opponent: rival,
      lostToOpponent: contested.lost,
    },
  ];
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
