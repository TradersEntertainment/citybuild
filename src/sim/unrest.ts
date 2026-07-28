import {
  UNREST_CRIME_MULT,
  UNREST_DECAY_PER_S,
  UNREST_GRIP_PER_S,
  UNREST_HAPPINESS_HIT,
  UNREST_MIGRATION_PUSH,
  UNREST_ON_REFUSAL,
  UNREST_ON_SEIZURE,
  UNREST_QUIET_CARD,
} from '../data/balance';
import { readReport } from './report';
import type { GameState } from './state';

/**
 * Legitimacy, and what a city does without it (§29).
 *
 * Losing an election used to be the quietest moment in the game. The city
 * stayed, the money stayed, the map stayed; all that went was the term's grant,
 * and the player carried on placing stations as though nothing had happened.
 * That is a strange thing for a game about *governing* to say — it means the
 * vote was a bonus round, and the constitution's whole thesis is that the vote
 * is the point.
 *
 * So a lost election now asks a question, and the three answers are three
 * different games:
 *
 * - **Hand over.** The ordinary path, and deliberately not the punishing one:
 *   the grant is lost, and the incoming administration gets the goodwill a new
 *   face gets — factions soften, unrest falls away. Accepting a defeat is the
 *   only answer that makes the city *easier* to run, which is what stops the
 *   other two from being free.
 * - **Refuse the result.** You stay in office without a mandate. Nothing is
 *   taken away and nothing is blocked; the streets simply stop being calm, and
 *   they get less calm the longer it goes on. Elections keep coming, so this is
 *   recoverable by winning the next one.
 * - **Seize power.** You keep everything and the voting stops. No more terms,
 *   no more grants, no more risk of losing — and a city that knows exactly what
 *   you did.
 *
 * ## Why unrest is not a punishment meter
 *
 * The obvious version of this makes the coup a trap: pick it, watch the numbers
 * fall, reload. That would be a moral lecture with a progress bar, and it would
 * be the one unrecoverable thing in a game whose whole doctrine is that nothing
 * is.
 *
 * Instead unrest **answers to how well the city is actually run** (sim/report.ts).
 * Rule without a mandate and it climbs; run a genuinely good city and it falls,
 * whatever you did to get there. A usurper with an A on the card can quiet the
 * streets in a few terms. That is a real tension rather than a scolding — it
 * says a city might forgive a great deal of a government that works, which is
 * an uncomfortable thing for a game to say and a true one, and it is the exact
 * point where §25's report card and §23's electorate finally argue with each
 * other.
 *
 * Nothing here is random. Unrest is a number moved by two rates, and every
 * effect it has is a multiplier read off it.
 */

/** How the mayor came to be governing today. */
export type Mandate = 'elected' | 'refused' | 'seized';

/** Whether the city is being governed by someone who won a vote. */
export function hasMandate(state: GameState): boolean {
  return state.mandate === 'elected';
}

/** Whether elections still happen at all. A coup ends them. */
export function electionsRun(state: GameState): boolean {
  return state.mandate !== 'seized';
}

/**
 * Takes the lost election in each of the three ways.
 *
 * The jumps are immediate and the drift afterwards is gradual, which is the
 * shape of the thing being modelled: the announcement is the shock, the years
 * that follow are the argument.
 */
export function refuseResult(state: GameState): void {
  state.mandate = 'refused';
  state.unrest = clamp01(state.unrest + UNREST_ON_REFUSAL);
}

export function seizePower(state: GameState): void {
  state.mandate = 'seized';
  state.unrest = clamp01(state.unrest + UNREST_ON_SEIZURE);
}

/**
 * Hands the city to whoever won.
 *
 * The goodwill is the whole reason this is a real choice. A new administration
 * inherits a city that wants it to succeed, so unrest clears rather than
 * decaying — and that is a mechanical reward for accepting a defeat, not a
 * consolation. Without it, refusing would cost nothing a player could see in
 * the first minute, and a fork whose branches are not visibly different is not
 * a fork.
 */
export function handOver(state: GameState): void {
  state.mandate = 'elected';
  // Cleared outright rather than left to decay, so this is the one path that
  // never produces a "settling" crossing. Nothing is lost by that: handing over
  // announces itself with its own line, its own chronicle entry and its own
  // pair of headlines, and a second message saying the streets had calmed would
  // be reporting the same event twice.
  state.unrest = 0;
}

/** Winning a vote is the other way back to legitimacy, and the honest one. */
export function restoreMandate(state: GameState): void {
  // A coup is not undone by an election it prevented from happening. Only a
  // government still standing for election can be returned by one.
  if (state.mandate === 'seized') return;
  state.mandate = 'elected';
}

export interface UnrestChange {
  kind: 'rising' | 'settling';
  unrest: number;
}

/**
 * Moves unrest, and reports the crossings.
 *
 * Two rates, and which one applies is the whole state machine. Governing
 * without a mandate tightens the grip and the streets answer; governing well
 * loosens it. A mandated mayor is never marked down here at all — this system
 * is invisible until the player does something that makes it visible.
 *
 * The decay is scaled by the report card rather than being a flat clock, so
 * time alone never buys forgiveness: a usurper who lets the city rot stays at
 * the top of the meter forever, and one who fixes it walks back down.
 */
export function stepUnrest(state: GameState, dt: number): readonly UnrestChange[] {
  const before = state.unrest;

  if (hasMandate(state)) {
    // An elected government sheds whatever is left at the ordinary rate: a
    // player who refused once and then won the next vote is not carrying the
    // first refusal around forever.
    state.unrest = clamp01(state.unrest - UNREST_DECAY_PER_S * dt);
  } else {
    // How well the city is actually run, 0..1 (sim/report.ts). A good card buys
    // quiet; a bad one buys none, and the grip does the rest.
    const governing = readReport(state).overall;
    const quiet = UNREST_DECAY_PER_S * governing * UNREST_QUIET_CARD;
    state.unrest = clamp01(state.unrest + (UNREST_GRIP_PER_S - quiet) * dt);
  }

  if (state.unrest === before) return NO_CHANGES;
  // Reported on the crossing rather than continuously, the same rule the
  // rubbish and the petitions keep: a meter that announced every tick would be
  // noise, and the player needs to know when it turned.
  const crossed = crossing(before, state.unrest);
  if (!crossed) return NO_CHANGES;
  return [{ kind: crossed, unrest: state.unrest }];
}

/** The one line where the meter becomes news, in either direction. */
const LOUD = 0.5;

function crossing(before: number, after: number): 'rising' | 'settling' | null {
  if (before < LOUD && after >= LOUD) return 'rising';
  if (before >= LOUD && after < LOUD) return 'settling';
  return null;
}

const NO_CHANGES: readonly UnrestChange[] = [];

// --- What unrest costs. Every one answers 0 or 1 at rest. ----------------------

/**
 * Mood the streets lose to it.
 *
 * Proportional rather than a step, so the meter is legible without a readout:
 * a city at a quarter unrest feels a quarter of the hit.
 */
export function unrestHappiness(state: GameState): number {
  // Guarded so a calm city answers exactly +0 rather than -0. They add
  // identically, but every other hook in this codebase answers exactly 0 or 1
  // at rest and is tested with Object.is equality — leaving a -0 here would
  // fail the next test somebody writes the obvious way, for no reason at all.
  if (state.unrest === 0) return 0;
  return -UNREST_HAPPINESS_HIT * state.unrest;
}

/**
 * How much harder it is to keep people, on top of what the mood already does.
 *
 * Separate from the happiness term on purpose. Mood is what residents feel
 * about the city; this is what they feel about *living under this government* —
 * and people leave a place they have stopped trusting faster than a merely
 * unpleasant one.
 */
export function unrestMigrationPush(state: GameState): number {
  return UNREST_MIGRATION_PUSH * state.unrest;
}

/** Crime rises with it — the most visible thing on the map that unrest touches. */
export function unrestCrimeFactor(state: GameState): number {
  return 1 + UNREST_CRIME_MULT * state.unrest;
}

/**
 * What the factions make of how the mayor came to power.
 *
 * A flat penalty across every group rather than a per-faction one: this is not
 * a policy some of them like, it is a question of whether the government should
 * be there, and the answer is the same for the greens and the industrialists.
 * Scaled by unrest so a quieted city gradually stops holding it against them.
 */
export function unrestGroupSway(state: GameState): number {
  return hasMandate(state) ? 0 : -state.unrest;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
