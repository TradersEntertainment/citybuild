import {
  ARRIVAL_CHILD_SHARE,
  ARRIVAL_ELDER_SHARE,
  BURIAL_HAPPINESS_HIT,
  BIRTHS_PER_WORKER_MIN,
  BIRTH_ROOM_RAMP,
  BURIAL_TOLERANCE,
  CEMETERY_RATE,
  COHORT_BAND_S,
  LABOUR_PARTICIPATION,
  SCHOOLED_CRIME,
  SCHOOLED_OUTPUT,
} from '../data/balance';
import { capacityOf } from '../data/buildings';
import { drainPopulation, settlePopulation } from './population';
import { refreshPopulation } from './hazards';
import type { GameState } from './state';
import { educationCoverage } from './tech';

/**
 * Who actually lives there (§8b).
 *
 * The city's population has been one number since the first phase, and every
 * system that wanted to know something about the people in it had to guess:
 * half of them work, schooling is a coverage percentage, and nobody is ever any
 * particular age. That is the difference between a city that grows and a city
 * that has generations in it.
 *
 * Simulating each resident is not on the table — a hundred thousand agents with
 * daily routines is a native engine's problem, not a phone browser's — so this
 * models the population as **four flowing bands** instead:
 *
 *     children → young → adults → elders → the cemetery
 *
 * That costs four numbers rather than a hundred thousand records, and it buys
 * nearly everything the per-agent version would:
 *
 * - **A workforce that is discovered rather than assumed.** Working age is
 *   young + adults, so a city full of children or pensioners genuinely cannot
 *   staff its factories, and `LABOUR_PARTICIPATION` becomes a fallback for a
 *   city with no breakdown yet rather than a law of nature.
 * - **Schooling that compounds.** A child is schooled or not depending on
 *   whether a school reached them *while they were a child*; that share travels
 *   with them into the workforce. Building schools pays off a band later, which
 *   is the longest-horizon decision in the game and the only one that rewards
 *   thinking about a city you will not see for ten minutes.
 * - **Death waves.** A cohort that arrives together ages together and dies
 *   together. A founding boom is a funeral one lifetime later, entirely as a
 *   consequence of the flow rather than as a scripted event — which is what
 *   makes it worth having.
 *
 * The bands are a *decomposition* of `state.population`, never a competing
 * source of truth: every step reconciles against it first, so migration, an
 * epidemic and a bulldozed block all land in the bands without any of those
 * systems knowing this file exists. Deaths are the one thing that flows the
 * other way, and they go out through `drainPopulation` like any other loss.
 *
 * Pure and deterministic: no dice at all. Ageing is not a thing that should
 * surprise anybody.
 */
export const BANDS = ['child', 'young', 'adult', 'elder'] as const;
export type Band = (typeof BANDS)[number];

export interface Cohorts {
  /** People in each band, in BANDS order. Sums to state.population. */
  people: number[];
  /**
   * People in each band who were schooled, in BANDS order.
   *
   * Carried per band rather than as one city-wide figure because that is the
   * entire mechanic: the share is fixed while a cohort is small and then travels
   * with it. One number could not tell a city that has always had schools from
   * one that opened its first last week.
   */
  schooled: number[];
  /** Bodies waiting for a plot. Grows when the city has nowhere to put them. */
  awaitingBurial: number;
  /**
   * Whether the city has already been told it is behind on burials.
   *
   * Held rather than sampled at the top of each step: the backlog can cross the
   * threshold *inside* a step, and comparing before-and-after within one step
   * misses exactly the crossing the announcement exists for.
   */
  behind: boolean;
}

export function createCohorts(): Cohorts {
  return {
    people: BANDS.map(() => 0),
    schooled: BANDS.map(() => 0),
    awaitingBurial: 0,
    behind: false,
  };
}

/** Total across the bands. Should track state.population to within a rounding. */
export function cohortTotal(cohorts: Cohorts): number {
  let total = 0;
  for (const n of cohorts.people) total += n;
  return total;
}

/**
 * Advances the bands by `dt` seconds.
 *
 * Reconcile, then age, then bury — in that order, because reconciliation is what
 * puts this step's arrivals into the bands and ageing them in the same step is
 * both harmless and one fewer frame of lag.
 */
export function stepCohorts(
  state: GameState,
  dt: number,
  live = true,
): readonly CohortEvent[] {
  const cohorts = state.cohorts;
  reconcile(state, cohorts);
  age(state, cohorts, dt, live);
  bury(state, cohorts, dt);

  // The wave is only drama if the player is told. Reported on the crossing rather
  // than every step, and reported again when the city catches up, so a cemetery
  // built in answer visibly answers it.
  const behind = burialHappiness(state) < 0;
  if (behind === cohorts.behind) return NO_EVENTS;
  cohorts.behind = behind;
  return [{ kind: behind ? 'burialBacklog' : 'burialCleared', waiting: cohorts.awaitingBurial }];
}

export type CohortEventKind = 'burialBacklog' | 'burialCleared';

export interface CohortEvent {
  kind: CohortEventKind;
  waiting: number;
}

const NO_EVENTS: readonly CohortEvent[] = [];

/**
 * Brings the bands back in line with the population the rest of the sim decided.
 *
 * A surplus is arrivals: families, so mostly workers with children and a few
 * grandparents. A shortfall is a loss the bands did not cause — an epidemic, a
 * demolished block — and it is taken proportionally, because a bulldozer does
 * not check anybody's age.
 */
function reconcile(state: GameState, cohorts: Cohorts): void {
  const total = cohortTotal(cohorts);
  const delta = state.population - total;
  // Under a person either way is float noise from the building pass, not news.
  if (Math.abs(delta) < 1e-6) return;

  if (delta > 0) {
    const child = delta * ARRIVAL_CHILD_SHARE;
    const elder = delta * ARRIVAL_ELDER_SHARE;
    const working = delta - child - elder;
    // Children arrive unschooled — the city's own schools are the only thing that
    // ever teaches anybody, which is what makes the school the whole story.
    add(cohorts, 'child', child, 0);
    // Workers arrive matching what the city already is.
    //
    // Measured before this was written: with arrivals landing unschooled, a city
    // fed by the motorway diluted its own graduates as fast as it produced them
    // and the schooled share pinned at about a half however many schools were
    // built — so the ceiling in the balance table was a number no city could
    // reach. Inheriting the standing share instead makes migration neutral and
    // leaves the child pipeline as the only thing that moves it, which is both
    // reachable and the honest reading: a city with good schools is a city
    // educated people move to.
    add(cohorts, 'young', working * 0.72, schooledShareOf(cohorts, 1));
    add(cohorts, 'adult', working * 0.28, schooledShareOf(cohorts, 2));
    add(cohorts, 'elder', elder, schooledShareOf(cohorts, 3));
    return;
  }

  const loss = -delta;
  if (total <= 0) return;
  for (let i = 0; i < BANDS.length; i++) {
    const share = (cohorts.people[i] ?? 0) / total;
    take(cohorts, i, loss * share);
  }
}

/**
 * Moves people up the bands, and the last band out of the city.
 *
 * The flow is a fixed share of each band per step rather than a queue of dated
 * arrivals: a queue would model the wave exactly and cost a record per cohort,
 * and the band version still produces a wave — a bulge entering `child` is still
 * a bulge leaving `elder` four bands later, just with softer edges. Softer edges
 * are arguably the more honest picture of a real cohort anyway.
 */
function age(state: GameState, cohorts: Cohorts, dt: number, live: boolean): void {
  if (dt <= 0) return;
  // The exact continuous-time share rather than dt/band.
  //
  // The linear version is dt-dependent, and the offline path steps in minutes
  // where the frame loop steps in fifths of a second: measured, an hour away came
  // back fourteen per cent smaller than the same hour lived, because a coarse step
  // overstates every outflow. The offline path reusing the same code is only worth
  // anything if the same code gives the same answer at any step size.
  const flow = 1 - Math.exp(-dt / COHORT_BAND_S);
  if (flow <= 0) return;

  // Schooling is decided while a cohort is in the child band and travels with
  // them. Read once per step: coverage cannot change inside a tick.
  const coverage = educationCoverage(state);

  // Walked from the top down so a person cannot cross two bands in one step.
  let deaths = cohorts.people[3] ?? 0;
  let deadSchooled = cohorts.schooled[3] ?? 0;
  deaths *= flow;
  deadSchooled *= flow;

  for (let i = BANDS.length - 1; i > 0; i--) {
    const moving = (cohorts.people[i - 1] ?? 0) * flow;
    const movingSchooled = (cohorts.schooled[i - 1] ?? 0) * flow;
    cohorts.people[i - 1] = (cohorts.people[i - 1] ?? 0) - moving;
    cohorts.schooled[i - 1] = (cohorts.schooled[i - 1] ?? 0) - movingSchooled;
    cohorts.people[i] = (cohorts.people[i] ?? 0) + moving;
    cohorts.schooled[i] = (cohorts.schooled[i] ?? 0) + movingSchooled;
  }
  // The band that just moved out of `elder`.
  cohorts.people[3] = Math.max(0, (cohorts.people[3] ?? 0) - deaths);
  cohorts.schooled[3] = Math.max(0, (cohorts.schooled[3] ?? 0) - deadSchooled);

  // Children are schooled where a school reaches them — set outright rather than
  // approached over time. The time it takes to educate somebody is already the
  // length of the child band; charging a second timer on top of it left the share
  // fighting the outflow at the same rate and pinned it near a half however many
  // schools the city built, which is a nonsense a fully covered city would have
  // had no way to explain.
  const children = cohorts.people[0] ?? 0;
  cohorts.schooled[0] = children * coverage;

  // The backlog only builds while somebody is watching, the same rule the fires
  // and the outbreaks keep (sim/offline.ts): people still age and still die while
  // the tab is shut — a city that did not turn over would be a stopped city — but
  // coming back to a mood-crushing pile of bodies nobody was given the chance to
  // answer is precisely the punishment-for-being-away that offline.ts refuses.
  //
  // It is also what made the two paths disagree. Measured: an hour away came back
  // fourteen per cent smaller, because updateHappiness snaps straight to its
  // target at a two-minute step and the growing burial penalty was in it.
  if (live) cohorts.awaitingBurial += deaths;

  /**
   * Births and deaths settled as one net figure.
   *
   * Deliberately net rather than gross. Births have to go through the housing
   * check — a birth competes for the same empty room a newcomer would take, which
   * is what keeps them from outrunning the housing the player has drawn — but a
   * hard stock like vacancy clips a big step harder than several small ones, and
   * that made the whole pass step-size dependent: measured, an hour away came back
   * fourteen per cent smaller than the same hour lived. Netting them first means a
   * settled city touches the housing check for almost nothing, so the offline path
   * and the frame loop agree, which is the entire point of them sharing this code.
   */
  const workers = (cohorts.people[1] ?? 0) + (cohorts.people[2] ?? 0);
  // Scaled by how much room the city has, as a smooth ramp rather than a hard
  // stop. A crowded city has fewer children, which is both true and — unlike
  // clipping the birth count against the vacancy stock — the same answer at any
  // step size. The stock version made an hour away come back fourteen per cent
  // smaller than the same hour lived, because two-minute offline steps grabbed
  // the whole pool at once where one-second steps let the building pass refill it.
  const wanted = (workers * BIRTHS_PER_WORKER_MIN * dt * roomFactor(state)) / 60;
  const net = wanted - deaths;
  let born = wanted;
  if (net > 0) {
    // Only as many children as found a room; the rest were never born here.
    born = deaths + settlePopulation(state, net);
  } else if (net < 0) {
    drainPopulation(state, -net);
  }
  // drainPopulation and settlePopulation move people between homes; neither
  // recomputes the headline figure, and without it the bands sit permanently out
  // of step and every reconciliation reads the gap as arrivals.
  refreshPopulation(state);
  // Born unschooled, like any child. The city's schools decide the rest.
  add(cohorts, 'child', born, 0);
}

/** Adds people to a band, `schooled` of them holding a certificate. */
function add(cohorts: Cohorts, band: Band, people: number, schooled: number): void {
  if (people <= 0) return;
  const i = BANDS.indexOf(band);
  cohorts.people[i] = (cohorts.people[i] ?? 0) + people;
  cohorts.schooled[i] = (cohorts.schooled[i] ?? 0) + people * clamp01(schooled);
}

/** Share of one band that went to school. Zero for an empty band, not NaN. */
function schooledShareOf(cohorts: Cohorts, i: number): number {
  const people = cohorts.people[i] ?? 0;
  if (people <= 0) return 0;
  return clamp01((cohorts.schooled[i] ?? 0) / people);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Takes people out of a band, schooled and unschooled in the proportion they
 * stand in. A bulldozer does not check anybody's certificates either.
 */
function take(cohorts: Cohorts, i: number, people: number): void {
  if (people <= 0) return;
  const had = cohorts.people[i] ?? 0;
  if (had <= 0) return;
  const gone = Math.min(had, people);
  const share = gone / had;
  cohorts.people[i] = had - gone;
  cohorts.schooled[i] = (cohorts.schooled[i] ?? 0) * (1 - share);
}

/**
 * How freely the city is having children, 0..1, by how much housing is spare.
 *
 * A ramp, not a gate: at a twentieth of the housing standing empty this is one,
 * and it falls to nothing as the last rooms fill. Reading the stock directly
 * would make the whole pass depend on how finely it is stepped.
 */
function roomFactor(state: GameState): number {
  let capacity = 0;
  for (const building of state.buildings.values()) {
    if (building.zone === 'res') capacity += capacityOf(building.zone, building.level);
  }
  if (capacity <= 0) return 0;
  const spare = (capacity - state.population) / capacity;
  return clamp01(spare / BIRTH_ROOM_RAMP);
}

/** Cemeteries work through the backlog; what they cannot reach stays waiting. */
function bury(state: GameState, cohorts: Cohorts, dt: number): void {
  if (cohorts.awaitingBurial <= 0) {
    cohorts.awaitingBurial = 0;
    return;
  }
  let plots = 0;
  for (const service of state.services.values()) {
    if (service.kind === 'cemetery') plots++;
  }
  const cleared = (plots * CEMETERY_RATE * dt) / 60;
  cohorts.awaitingBurial = Math.max(0, cohorts.awaitingBurial - cleared);
}

// --- What the rest of the sim asks this file ---------------------------------

/**
 * Share of residents of working age.
 *
 * Falls back to the old flat figure for a city the bands have not filled yet —
 * a freshly loaded save, or the first tick of a new one. Without the fallback
 * every economy test would see a workforce of zero on its opening frame and read
 * it as a city that cannot staff anything.
 */
export function workingShare(state: GameState): number {
  const total = cohortTotal(state.cohorts);
  if (total < 1) return LABOUR_PARTICIPATION;
  const working = (state.cohorts.people[1] ?? 0) + (state.cohorts.people[2] ?? 0);
  return working / total;
}

/** Share of the working-age population that went to school, 0..1. */
export function schooledShare(state: GameState): number {
  const working = (state.cohorts.people[1] ?? 0) + (state.cohorts.people[2] ?? 0);
  if (working < 1) return 0;
  const schooled = (state.cohorts.schooled[1] ?? 0) + (state.cohorts.schooled[2] ?? 0);
  return Math.min(1, schooled / working);
}

/**
 * What an educated workforce is worth, as an output multiplier.
 *
 * A pure bonus: an unschooled city earns exactly what it earned before this file
 * existed. Marking a city down for not having built something it was never shown
 * teaches resentment rather than planning — the same rule the lighting programme
 * is held to.
 */
export function skillFactor(state: GameState): number {
  return 1 + (SCHOOLED_OUTPUT - 1) * schooledShare(state);
}

/** What an educated workforce takes off the crime rate, as a multiplier. */
export function schoolingCrimeFactor(state: GameState): number {
  return 1 - (1 - SCHOOLED_CRIME) * schooledShare(state);
}

/** How many in each band, for the panel to read without recomputing. */
export function bandCount(state: GameState, band: Band): number {
  return state.cohorts.people[BANDS.indexOf(band)] ?? 0;
}

/**
 * Mood cost of the dead going uncollected.
 *
 * Tolerant of a few and then not: a city notices a backlog once it is a visible
 * fraction of itself, which is why a death wave in a city with no cemetery lands
 * as an event rather than as a slow drift nobody can attribute.
 */
export function burialHappiness(state: GameState): number {
  const waiting = state.cohorts.awaitingBurial;
  if (waiting <= 0) return 0;
  const tolerated = Math.max(2, (state.population / 1000) * BURIAL_TOLERANCE);
  if (waiting <= tolerated) return 0;
  const over = Math.min(1, (waiting - tolerated) / Math.max(1, tolerated * 3));
  return -BURIAL_HAPPINESS_HIT * over;
}
