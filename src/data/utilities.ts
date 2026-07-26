import { eraReached, type Era } from '../sim/tiles';

/**
 * Waterworks and power stations (§9).
 *
 * A plant is judged on three numbers and they pull against each other: what it
 * costs to build, what it costs to run forever, and how far its mains reach.
 * The cheap options are cheap because they do not reach far, which is why the
 * question is never "can I afford one" but "where does it go".
 */
export type UtilityKind =
  | 'well'
  | 'waterworks'
  | 'coalPlant'
  | 'gasPlant'
  | 'oilPlant'
  | 'hydroPlant'
  | 'solarFarm'
  | 'nuclearPlant';

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
  /**
   * Water tiles the plant needs within `waterReach`, or 0 for none.
   *
   * A dam needs a river and a reactor needs cooling, and both are the same rule
   * as a harbour's: the terrain decides where it can go. This is what stops the
   * clean options from being strictly better than the dirty ones — coal goes
   * anywhere, and that is what the smoke buys.
   */
  waterNeeded: number;
  waterReach: number;
}

/**
 * Six ways to make power, and the point is that none of them wins.
 *
 * Coal is cheapest per MW and goes anywhere; the city downwind pays the rest.
 * Gas is the clean-ish default. Oil is the brute — more power per lira than gas
 * and dirtier, which is the trade a growing city takes when the grid browns out
 * and there is no time to be tidy. A dam is nearly free to run and emits
 * nothing, but it wants a real body of water, so most maps have a handful of
 * spots and no more. Solar costs nothing to run and reaches almost nowhere,
 * because it is a field rather than a station. A reactor is the endgame: more
 * capacity than the rest put together, a price to match, and it needs cooling
 * water like the dam does.
 *
 * Read as a table, the columns that matter are ₺/MW and pollution per MW —
 * whichever plant a city reaches for, it is paying in money, in smoke, or in
 * being tied to a river.
 */
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
    waterNeeded: 0,
    waterReach: 0,
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
    waterNeeded: 0,
    waterReach: 0,
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
    waterNeeded: 0,
    waterReach: 0,
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
    waterNeeded: 0,
    waterReach: 0,
  },
  oilPlant: {
    kind: 'oilPlant',
    provides: 'power',
    unlockedAt: 'city',
    cost: 62_000,
    upkeep: 680,
    capacity: 210,
    mains: 70,
    // Between coal and gas, and closer to coal: cheap MW are always dirty MW.
    pollution: 30,
    waterNeeded: 0,
    waterReach: 0,
  },
  hydroPlant: {
    kind: 'hydroPlant',
    provides: 'power',
    unlockedAt: 'city',
    cost: 140_000,
    // Nothing to burn, so almost nothing to pay: a dam is a one-off decision
    // that keeps paying, which is exactly why the map has to limit it.
    upkeep: 130,
    capacity: 190,
    mains: 62,
    pollution: 0,
    // Calibrated against the harbours rather than guessed: a cargo berth wants
    // about 12% of its surroundings underwater, and a dam wants 17% — more
    // demanding, as a dam should be, but met by any real river or coast. An
    // earlier pass asked for half the disc, which no ordinary map offers and
    // which would have made the entry decoration.
    waterNeeded: 26,
    waterReach: 7,
  },
  solarFarm: {
    kind: 'solarFarm',
    provides: 'power',
    unlockedAt: 'metro',
    cost: 88_000,
    upkeep: 60,
    capacity: 95,
    // Short mains: it is a field on the edge of town, not a station in it.
    mains: 34,
    pollution: 0,
    waterNeeded: 0,
    waterReach: 0,
  },
  nuclearPlant: {
    kind: 'nuclearPlant',
    provides: 'power',
    unlockedAt: 'metropolis',
    cost: 900_000,
    upkeep: 2_400,
    capacity: 1_400,
    mains: 90,
    // Not zero: a reactor's own tile is nobody's idea of a park.
    pollution: 8,
    // The same 17% share over a wider circle: a reactor wants a bigger body of
    // water than a dam, not a rarer one.
    waterNeeded: 34,
    waterReach: 8,
  },
};

export const UTILITY_ORDER: readonly UtilityKind[] = [
  'well',
  'waterworks',
  'coalPlant',
  'gasPlant',
  'oilPlant',
  'hydroPlant',
  'solarFarm',
  'nuclearPlant',
];

export function isUtilityUnlocked(kind: UtilityKind, era: Era): boolean {
  return eraReached(era, UTILITY_SPECS[kind].unlockedAt);
}

/**
 * From which era the city expects to be plumbed and wired. Before that, a
 * settlement drawing its own water is not a failing one — the same principle
 * that keeps the tuned opening untouched by the civic services.
 */
export const UTILITIES_REQUIRED_FROM: Era = 'town';
