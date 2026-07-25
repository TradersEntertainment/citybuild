import { ERA_THRESHOLDS } from '../data/balance';
import type { GameState } from './state';
import type { Era } from './tiles';

/**
 * Eras (§12.1). Phase 2 uses them for what they gate — road tiers and, through
 * the style system, how the map is drawn. The blackout, the chronicle entry
 * and the three-second cross-fade are Phase 4's.
 *
 * Eras never go backwards. A city that loses population should not have its
 * boulevards taken away.
 */
export function eraForPopulation(population: number): Era {
  let era: Era = 'founding';
  for (const threshold of ERA_THRESHOLDS) {
    if (population >= threshold.population) era = threshold.era;
  }
  return era;
}

export function eraRank(era: Era): number {
  return ERA_THRESHOLDS.findIndex((threshold) => threshold.era === era);
}

/** Population still needed for the next era, or null at the last one. */
export function nextEraGap(population: number): { era: Era; remaining: number } | null {
  for (const threshold of ERA_THRESHOLDS) {
    if (population < threshold.population) {
      return { era: threshold.era, remaining: threshold.population - population };
    }
  }
  return null;
}

/** Returns the new era when one was reached, otherwise null. */
export function stepProgression(state: GameState): Era | null {
  const reached = eraForPopulation(state.population);
  if (eraRank(reached) <= eraRank(state.era)) return null;
  state.era = reached;
  return reached;
}
