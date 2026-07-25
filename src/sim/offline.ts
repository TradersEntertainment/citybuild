import { OFFLINE_CAP_HOURS, OFFLINE_EFFICIENCY_BANDS } from '../data/balance';

/**
 * Away-time accounting (§11). Phase 0 wires only the measurement — the payout
 * and the City Chronicle land in Phase 4 — but the banding lives here now so
 * the visibility bookkeeping has a tested home from the start.
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
