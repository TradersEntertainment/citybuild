import { eraReached, type Era } from '../sim/tiles';

/**
 * Policies (§22): the levers a council pulls without building anything.
 *
 * Every ordinance is a trade, and the table is honest about both sides —
 * nothing here is a pure buff, because a toggle with no downside is not a
 * decision, it is a checkbox the player flips once and forgets. Each one
 * reaches into a system that already exists (fares, shifts, bins, wards,
 * school runs, tourists); none of them invents a new number to watch.
 *
 * The effect constants live here beside the ids rather than in balance.ts
 * because a policy IS its numbers — splitting "what it is" from "how much"
 * across two files would leave each half unreadable alone.
 */
export type PolicyId =
  | 'freeTransit'
  | 'nightShift'
  | 'schoolBuses'
  | 'recycling'
  | 'smokeBan'
  | 'touristTax';

export interface PolicySpec {
  id: PolicyId;
  unlockedAt: Era;
  /** ₺ per minute while active; 0 for the ones whose cost is a lost income. */
  upkeep: number;
}

export const POLICY_SPECS: Readonly<Record<PolicyId, PolicySpec>> = {
  /** Fares to zero, ridership up: the buses fill and the fare box empties. */
  freeTransit: { id: 'freeTransit', unlockedAt: 'town', upkeep: 0 },
  /** Workshops run dark hours: more output, more noise, tireder city. */
  nightShift: { id: 'nightShift', unlockedAt: 'town', upkeep: 0 },
  /** Buses to the school gates: coverage reaches further, and costs by the minute. */
  schoolBuses: { id: 'schoolBuses', unlockedAt: 'town', upkeep: 60 },
  /** Sorting lines: fewer crates to the tip, a little drag on the workshops. */
  recycling: { id: 'recycling', unlockedAt: 'city', upkeep: 110 },
  /** Cleaner wards, quieter tills: outbreaks bite less, shops sell less. */
  smokeBan: { id: 'smokeBan', unlockedAt: 'city', upkeep: 0 },
  /** A levy on every pillow: hotels pay more, fewer strangers come. */
  touristTax: { id: 'touristTax', unlockedAt: 'city', upkeep: 0 },
};

export const POLICY_ORDER: readonly PolicyId[] = [
  'freeTransit',
  'nightShift',
  'schoolBuses',
  'recycling',
  'smokeBan',
  'touristTax',
];

/** What each active policy multiplies, gathered so the hooks read as a table. */
export const POLICY_EFFECTS = {
  /** freeTransit: the network carries this much more before it strains. */
  FREE_TRANSIT_CAPACITY: 1.35,
  /** nightShift: workshop output, and the noise its neighbours breathe. */
  NIGHT_SHIFT_OUTPUT: 1.12,
  NIGHT_SHIFT_NOISE: 1.3,
  NIGHT_SHIFT_HAPPINESS: -2,
  /** schoolBuses: how much further the school run reaches. */
  SCHOOL_BUS_COVERAGE: 1.25,
  /** recycling: what reaches the tip, and the sorting line's drag. */
  RECYCLING_RUBBISH: 0.8,
  RECYCLING_OUTPUT: 0.97,
  /** smokeBan: outbreak severity, shop takings, and the city's lungs. */
  SMOKE_BAN_SEVERITY: 0.75,
  SMOKE_BAN_COMMERCE: 0.985,
  SMOKE_BAN_HAPPINESS: 1,
  /** touristTax: the levy on hotel income, and the strangers it turns away. */
  TOURIST_TAX_INCOME: 1.3,
  TOURIST_TAX_PULL: 0.85,
} as const;

export function isPolicyUnlocked(id: PolicyId, era: Era): boolean {
  return eraReached(era, POLICY_SPECS[id].unlockedAt);
}
