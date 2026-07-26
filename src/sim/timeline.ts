import {
  SECONDS_PER_YEAR,
  START_YEAR,
  TIMELINE,
  type TimelineEvent,
} from '../data/timeline';
import { demolish } from './buildings';
import { drainPopulation } from './population';
import { healthCoveredShare, refreshPopulation } from './hazards';
import { createRng } from './rng';
import type { GameState } from './state';

/**
 * History, stepped (§14). The city is founded in 1900 and the century happens
 * to it: wars conscript, depressions squeeze, booms lift, and twice the
 * century strikes without warning. The dates are fixed facts — every city
 * meets the same history — so a player who reads the year can see the next
 * crisis coming and build the hospital before the letter arrives.
 *
 * Only the watching city makes history: away time passes in years but the
 * events wait, the same mercy the hazards get. What an absence skips stays
 * skipped — the first step back simply notes the year and moves on.
 */

/** Multipliers history presses on the sim, recomputed every step. */
export interface TimelineEffects {
  migrationMult: number;
  incomeMult: number;
  happinessMod: number;
  draftDrainPerSec: number;
}

export const CALM_EFFECTS: TimelineEffects = {
  migrationMult: 1,
  incomeMult: 1,
  happinessMod: 0,
  draftDrainPerSec: 0,
};

/** The calendar year the city's played time has reached. */
export function yearOf(playedMs: number): number {
  return START_YEAR + Math.floor(playedMs / 1000 / SECONDS_PER_YEAR);
}

/** What history is doing to the city right now. */
export function computeTimelineEffects(year: number): TimelineEffects {
  const effects = { ...CALM_EFFECTS };
  for (const event of TIMELINE) {
    const span = event.durationYears ?? 0;
    if (span === 0 || !event.effects) continue;
    if (year < event.year || year >= event.year + span) continue;
    const e = event.effects;
    if (e.migrationMult !== undefined) effects.migrationMult *= e.migrationMult;
    if (e.incomeMult !== undefined) effects.incomeMult *= e.incomeMult;
    if (e.happinessMod !== undefined) effects.happinessMod += e.happinessMod;
    if (e.draftDrainPerSec !== undefined) effects.draftDrainPerSec += e.draftDrainPerSec;
  }
  return effects;
}

/** An event that arrived this step, for the feed to announce. */
export interface TimelineFired {
  event: TimelineEvent;
}

/**
 * Advances the calendar, fires whatever the new year brings, and applies the
 * running effects. Events whose year passed while `lastYear` was unset — a
 * city loaded from a save, history that ran during an absence — are noted and
 * left unfired: history only happens to a watching city.
 */
export function stepTimeline(state: GameState, dt: number): TimelineFired[] {
  const year = yearOf(state.playedMs);
  const fired: TimelineFired[] = [];

  if (state.lastYear === null) {
    state.lastYear = year;
  } else if (year > state.lastYear) {
    for (const event of TIMELINE) {
      if (event.year <= state.lastYear || event.year > year) continue;
      fired.push({ event });
      if (event.disaster === 'epidemic') forceEpidemic(state);
      if (event.disaster === 'earthquake') strikeEarthquake(state, event.year);
    }
    state.lastYear = year;
  }

  state.timelineEffects = computeTimelineEffects(year);

  // Conscription: the war takes its share of the town, steadily, for years.
  const draft = state.timelineEffects.draftDrainPerSec;
  if (draft > 0 && state.population > 0) {
    drainPopulation(state, state.population * draft * dt);
    refreshPopulation(state);
  }

  return fired;
}

/** A dated outbreak: the same machinery as a chance one, only certain. */
function forceEpidemic(state: GameState): void {
  if (state.epidemic) return; // one plague at a time is quite enough
  const coveredShare = healthCoveredShare(state);
  state.epidemic = {
    age: 0,
    duration: 150 * (1 - coveredShare * 0.55),
    severity: Math.min(1, Math.max(0.15, 1 - coveredShare * 0.8)),
    coveredShare,
    toll: 0,
  };
}

/**
 * The fault line lets go: a deterministic slice of the city comes down, the
 * same slice on every device, because a seed plus a year is all the luck a
 * disaster is allowed.
 */
function strikeEarthquake(state: GameState, year: number): void {
  const dice = createRng(state.seed ^ Math.imul(year, 0x9e3779b1));
  const standing = [...state.buildings.values()];
  const quota = Math.min(12, Math.ceil(standing.length * 0.08));
  for (let n = 0; n < quota && standing.length > 0; n++) {
    const pick = Math.floor(dice.next() * standing.length);
    const building = standing.splice(pick, 1)[0];
    if (building) demolish(state, building);
  }
}
