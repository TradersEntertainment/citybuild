import {
  ELECTION_THRESHOLD,
  MANDATE_HAPPINESS,
  MANDATE_PER_CITIZEN,
  REBUKE_HAPPINESS,
  TAX_RATE_MAX,
  TERM_YEARS,
  VERDICT_MEMORY_S,
} from '../data/balance';
import { SECONDS_PER_YEAR } from '../data/timeline';
import { burialHappiness } from './cohorts';
import { crimeHappiness } from './crime';
import { rubbishStrain } from './rubbish';
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
 * Every term in it is something the player can see on a panel and change with a
 * tool. A defeat has to be a warning that was ignored, never a die that came up
 * badly — which is also why there are no dice in this file.
 */
export function approval(state: GameState): number {
  // The mood is most of it. It is the number the whole game already funnels into.
  let score = (state.happiness / 100) * 0.62;

  // Tax: the one thing a mayor is unambiguously judged on. Full marks at nothing,
  // nothing at the ceiling.
  score += (1 - state.taxRate / TAX_RATE_MAX) * 0.14;

  // A city that is going backwards is a city that is about to stop. Read as a
  // sign rather than a size, because the size is already in the mood.
  score += state.ledger.net >= 0 ? 0.08 : 0;

  // And the three visible failures, each with its own tool and its own row in the
  // panel. Counted here as well as in the mood because a voter minds them twice.
  score += 0.08 * (1 - rubbishStrain(state));
  score += 0.04 * (1 + crimeHappiness(state) / 20);
  score += 0.04 * (1 + burialHappiness(state) / 14);

  return clamp01(score);
}

export type Verdict = 'won' | 'lost';

export interface ElectionEvent {
  kind: 'election';
  verdict: Verdict;
  /** The share that voted for the mayor, for the announcement to quote. */
  approval: number;
  /** Money granted, on a win. */
  grant: number;
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

  const term = termOf(state.playedMs);
  // Term zero is the founding: nobody elected anybody to build a village.
  if (term <= state.lastTermSettled) return NO_EVENTS;
  state.lastTermSettled = term;
  // A settlement with nobody in it has nobody to vote. Skipped rather than lost,
  // because losing an election a city was too small to hold is not a lesson.
  if (state.population < 1) return NO_EVENTS;

  const share = approval(state);
  const won = share >= ELECTION_THRESHOLD;
  state.verdictMemory = VERDICT_MEMORY_S;
  state.lastVerdict = won ? 'won' : 'lost';

  const grant = won ? Math.round(state.population * MANDATE_PER_CITIZEN) : 0;
  if (grant > 0) state.money += grant;
  return [{ kind: 'election', verdict: state.lastVerdict, approval: share, grant }];
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

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
