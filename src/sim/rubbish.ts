import {
  RUBBISH_DEPOT_RATE,
  RUBBISH_EPIDEMIC_MULT,
  RUBBISH_HAPPINESS_HIT,
  RUBBISH_PER_JOB_MIN,
  RUBBISH_PER_RESIDENT_MIN,
  RUBBISH_TOLERANCE_MIN,
} from '../data/balance';
import { budgetOf } from './budgets';
import type { GameState } from './state';
import { ISSUE, SERVICE } from './tiles';
import { index } from './world';

/**
 * What the city throws away (§15).
 *
 * The service nobody builds a city for and every city needs. It is here because
 * it is the missing cause behind a hazard the game already had: an epidemic used
 * to arrive out of nowhere on a timer, and the only lever was a hospital to
 * soften it after the fact. Rubbish gives it a cause the player can act on
 * *before* it happens, which is the whole difference between a hazard and a
 * weather report.
 *
 * Two halves, deliberately:
 *
 * - **A city-wide backlog**, because the decision is "how many depots", the same
 *   shape as the cemetery. One number, one tolerance, one mood hit.
 * - **A per-building flag**, because "how many" is not the only question — a
 *   depot on the far side of the map collects nothing from here. A building out
 *   of every depot's reach carries ISSUE.noRubbish and shows the mark, so the
 *   player can see *where* the problem is without a coverage overlay.
 *
 * Pure and deterministic; no dice. Nothing here is saved: a reload starts the
 * bins empty, which is a small mercy and cheaper than a schema change. The
 * backlog rebuilds within a minute of play if the depots really are short.
 */

/** Rubbish the city puts out per minute, in the depots' own units. */
export function rubbishPerMinute(state: GameState): number {
  let residents = 0;
  let jobs = 0;
  for (const building of state.buildings.values()) {
    residents += building.population;
    jobs += building.jobs;
  }
  return residents * RUBBISH_PER_RESIDENT_MIN + jobs * RUBBISH_PER_JOB_MIN;
}

/** What the depots standing can clear per minute. */
export function collectionPerMinute(state: GameState): number {
  let depots = 0;
  for (const service of state.services.values()) {
    if (service.kind === 'depot') depots++;
  }
  // Straight, like the cemetery: a rate is lorries on the road, and twice the
  // money is twice the lorries (sim/budgets.ts).
  return depots * RUBBISH_DEPOT_RATE * budgetOf(state, 'depot');
}

/**
 * How much the city tolerates before it minds, in the same units.
 *
 * Proportional to what the city produces rather than a flat figure, so a
 * metropolis is not punished for being a metropolis — it is punished for being a
 * metropolis with a town's worth of depots.
 */
export function rubbishTolerance(state: GameState): number {
  return Math.max(4, rubbishPerMinute(state) * RUBBISH_TOLERANCE_MIN);
}

/**
 * Advances the bins by `dt` seconds. Returns what happened, so the caller can
 * tell the player — the crossing in each direction, and nothing in between.
 */
export function stepRubbish(state: GameState, dt: number, live = true): readonly RubbishEvent[] {
  const produced = (rubbishPerMinute(state) * dt) / 60;
  const collected = (collectionPerMinute(state) * dt) / 60;
  const before = state.rubbishOverflowing;

  // Only while somebody is watching, the same rule the fires and the burials
  // keep: coming back from a night away to a city buried in its own rubbish is
  // the punishment-for-being-away that sim/offline.ts refuses. The bins still
  // fill and empty; what does not happen is the pile-up nobody could answer.
  const net = live ? produced - collected : Math.min(0, produced - collected);
  state.rubbish = Math.max(0, state.rubbish + net);

  const overflowing = state.rubbish > rubbishTolerance(state);
  if (overflowing === before) return NO_EVENTS;
  state.rubbishOverflowing = overflowing;
  return [{ kind: overflowing ? 'rubbishPiling' : 'rubbishCleared', waiting: state.rubbish }];
}

export type RubbishEventKind = 'rubbishPiling' | 'rubbishCleared';

export interface RubbishEvent {
  kind: RubbishEventKind;
  waiting: number;
}

const NO_EVENTS: readonly RubbishEvent[] = [];

/**
 * How badly the bins are overflowing, 0..1.
 *
 * Saturating rather than unbounded: a city that ignores this for an hour should
 * be at its worst, not a hundred times worse than one that ignored it for a
 * minute, or the scale stops meaning anything.
 */
export function rubbishStrain(state: GameState): number {
  const tolerated = rubbishTolerance(state);
  if (state.rubbish <= tolerated) return 0;
  return Math.min(1, (state.rubbish - tolerated) / (tolerated * 3));
}

/** Mood cost of the bins going uncollected. A pure penalty, and capped. */
export function rubbishHappiness(state: GameState): number {
  const strain = rubbishStrain(state);
  return strain === 0 ? 0 : -RUBBISH_HAPPINESS_HIT * strain;
}

/** What a rubbish backlog does to the chance of an outbreak. */
export function rubbishEpidemicFactor(state: GameState): number {
  return 1 + (RUBBISH_EPIDEMIC_MULT - 1) * rubbishStrain(state);
}

/**
 * Flags every building no depot reaches.
 *
 * Run with the rest of the coverage pass, and it only ever touches its own bit —
 * the civic services and the utilities each own theirs, and a wholesale rebuild
 * here would wipe them.
 */
export function markUncollected(state: GameState): void {
  const world = state.world;
  const anyDepot = collectionPerMinute(state) > 0;
  for (const building of state.buildings.values()) {
    const mask = world.serviceMask[index(world, building.x, building.y)] ?? 0;
    // No depot anywhere is not this building's fault in particular; the backlog
    // says that far more clearly than a mark over every roof in the city would.
    const missed = anyDepot && (mask & SERVICE.depot) === 0;
    building.issues = missed
      ? building.issues | ISSUE.noRubbish
      : building.issues & ~ISSUE.noRubbish;
  }
}
