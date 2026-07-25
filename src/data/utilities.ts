import type { Era } from '../sim/tiles';

/**
 * Waterworks and power stations (§9).
 *
 * A plant is judged on three numbers and they pull against each other: what it
 * costs to build, what it costs to run forever, and how far its mains reach.
 * The cheap options are cheap because they do not reach far, which is why the
 * question is never "can I afford one" but "where does it go".
 */
export type UtilityKind = 'well' | 'waterworks' | 'coalPlant' | 'gasPlant';

export interface UtilitySpec {
  kind: UtilityKind;
  provides: 'water' | 'power';
  unlockedAt: Era;
  cost: number;
  /** ₺ per minute, forever. */
  upkeep: number;
  /** Units served: m³/min of water, or MW of power. */
  capacity: number;
  /** How many road tiles the mains run from the plant. */
  mains: number;
  /** Pollution emitted at the plant's own tile, on the 0..100 field's scale. */
  pollution: number;
}

export const UTILITY_SPECS: Readonly<Record<UtilityKind, UtilitySpec>> = {
  well: {
    kind: 'well',
    provides: 'water',
    unlockedAt: 'town',
    cost: 5_200,
    upkeep: 48,
    capacity: 900,
    mains: 26,
    pollution: 0,
  },
  waterworks: {
    kind: 'waterworks',
    provides: 'water',
    unlockedAt: 'city',
    cost: 24_000,
    upkeep: 190,
    capacity: 6_500,
    mains: 70,
    pollution: 0,
  },
  coalPlant: {
    kind: 'coalPlant',
    provides: 'power',
    unlockedAt: 'town',
    cost: 18_000,
    upkeep: 240,
    capacity: 42,
    mains: 55,
    // Cheap power, and the city downwind pays the rest of the price.
    pollution: 46,
  },
  gasPlant: {
    kind: 'gasPlant',
    provides: 'power',
    unlockedAt: 'city',
    cost: 46_000,
    upkeep: 520,
    capacity: 130,
    mains: 70,
    pollution: 14,
  },
};

export const UTILITY_ORDER: readonly UtilityKind[] = [
  'well',
  'waterworks',
  'coalPlant',
  'gasPlant',
];

const ERA_RANK: readonly Era[] = [
  'founding',
  'village',
  'town',
  'city',
  'metro',
  'metropolis',
  'megacity',
];

export function isUtilityUnlocked(kind: UtilityKind, era: Era): boolean {
  return ERA_RANK.indexOf(era) >= ERA_RANK.indexOf(UTILITY_SPECS[kind].unlockedAt);
}

/**
 * From which era the city expects to be plumbed and wired. Before that, a
 * settlement drawing its own water is not a failing one — the same principle
 * that keeps the tuned opening untouched by the civic services.
 */
export const UTILITIES_REQUIRED_FROM: Era = 'town';
