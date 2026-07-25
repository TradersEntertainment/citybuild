import {
  OFFLINE_CAP_HOURS,
  OFFLINE_EFFICIENCY_BANDS,
  OFFLINE_MIN_REPORT_MS,
  OFFLINE_STEP_MIN_S,
  OFFLINE_STEPS,
} from '../data/balance';
import type { Mission } from '../data/missions';
import { totalBuildings } from './buildings';
import type { GameState } from './state';
import type { Systems } from './systems';
import type { Era } from './tiles';

/**
 * Away time (§11): what it is worth, and what the city did with it.
 *
 * Pure: takes timestamps, returns numbers. No Date.now inside.
 */
export interface AwayTime {
  /** Raw wall-clock gap. */
  rawMs: number;
  /** Gap after the 14-hour ceiling. */
  creditedMs: number;
  /** Weighted efficiency applied to that credited time. */
  efficiency: number;
  /** creditedMs × efficiency — the production window actually earned. */
  effectiveMs: number;
}

const HOUR_MS = 3_600_000;

/**
 * Efficiency for a single instant `hours` into the absence (§11):
 * 0–2h 100%, 2–8h 60%, 8–14h 35%, beyond 14h nothing.
 */
export function offlineEfficiencyAt(hours: number): number {
  for (const band of OFFLINE_EFFICIENCY_BANDS) {
    if (hours < band.untilHours) return band.efficiency;
  }
  return 0;
}

/**
 * Integrates the bands across the whole absence, so eight hours away is not
 * charged at the eight-hour rate for its first two hours.
 */
export function creditAwayTime(lastSeenMs: number, nowMs: number): AwayTime {
  const rawMs = Math.max(0, nowMs - lastSeenMs);
  const creditedMs = Math.min(rawMs, OFFLINE_CAP_HOURS * HOUR_MS);

  let effectiveMs = 0;
  let cursor = 0;
  for (const band of OFFLINE_EFFICIENCY_BANDS) {
    const bandEnd = Math.min(creditedMs, band.untilHours * HOUR_MS);
    if (bandEnd <= cursor) continue;
    effectiveMs += (bandEnd - cursor) * band.efficiency;
    cursor = bandEnd;
  }

  return {
    rawMs,
    creditedMs,
    efficiency: creditedMs > 0 ? effectiveMs / creditedMs : 0,
    effectiveMs,
  };
}

/** Absence split into whole hours and minutes; the Chronicle formats it. */
export function splitDuration(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.floor(ms / 60_000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

const EMPTY_MISSIONS: readonly Mission[] = [];

/** What the city got up to while nobody was watching, for the Chronicle to read. */
export interface OfflineReport {
  away: AwayTime;
  moneyEarned: number;
  populationGained: number;
  buildingsBuilt: number;
  /** The furthest era reached while away, or null if the city stayed put. */
  eraReached: Era | null;
  /** Goals the city claimed while nobody was watching. */
  missionsDone: readonly Mission[];
  /** True when the absence was long enough to be worth telling the player about. */
  worthReporting: boolean;
}

/**
 * Runs the city forward across an absence.
 *
 * The whole simulation runs, rather than a payout formula being applied to the
 * balance: an idle game's returning card is the moment its numbers are read
 * most carefully, and a city that could not have arrived at those numbers by
 * its own rules is one the player will eventually catch out. Running the real
 * systems also means every loop keeps working here for free — buildings level,
 * people move in and out, congestion builds, an era can pass.
 *
 * The cost of that is bounded by taking a fixed number of long steps instead of
 * many short ones. Growth, decay and migration are all linear in `dt`, so the
 * long step lands in the same place; the one thing it cannot do is move a
 * building more than one level per pass, which is why there are far more passes
 * than there are levels.
 */
export function applyOfflineProgress(
  state: GameState,
  systems: Systems,
  away: AwayTime,
): OfflineReport {
  const worthReporting = away.rawMs >= OFFLINE_MIN_REPORT_MS;
  const report: OfflineReport = {
    away,
    moneyEarned: 0,
    populationGained: 0,
    buildingsBuilt: 0,
    eraReached: null,
    missionsDone: EMPTY_MISSIONS,
    worthReporting,
  };
  if (away.effectiveMs <= 0) return report;

  const moneyBefore = state.money;
  const populationBefore = state.population;
  const buildingsBefore = state.buildings.size;

  // Charged against played time whether or not it is reported: the clock the
  // save writes down has to agree with the city it is written beside.
  state.playedMs += away.effectiveMs;

  const seconds = away.effectiveMs / 1000;
  const steps = Math.min(OFFLINE_STEPS, Math.max(1, Math.ceil(seconds / OFFLINE_STEP_MIN_S)));
  const step = seconds / steps;
  for (let i = 0; i < steps; i++) {
    const era = systems.step(state, step);
    if (era) report.eraReached = era;
    systems.stepEconomy(state, step);
  }

  // Goals settled inside the loop above, on the simulation's own clock. Drained
  // here so the returning card lists them rather than the frame loop toasting
  // eight of them at once a moment later.
  report.missionsDone = systems.drainCompletedMissions();
  report.moneyEarned = state.money - moneyBefore;
  report.populationGained = state.population - populationBefore;
  report.buildingsBuilt = state.buildings.size - buildingsBefore;
  return report;
}

/** Jobs and homes as they stand, for the Chronicle's second line. */
export function cityAtAGlance(state: GameState): { jobs: number; housing: number } {
  const totals = totalBuildings(state);
  return {
    jobs: totals.commercialJobs + totals.industrialJobs + totals.farmJobs,
    housing: totals.housing,
  };
}
