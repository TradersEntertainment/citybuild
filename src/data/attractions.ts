import { eraReached, type Era } from '../sim/tiles';

/**
 * Attractions (§21): the buildings a city is visited *for*.
 *
 * Everything else the player places keeps the city alive; these are what make
 * it somewhere. Three families in one table, because they share every rule
 * that matters — placed by hand, standing on a road, drawn by the stations
 * layer, paid for by the minute:
 *
 * - **Hotels**, repeatable. The half of tourism that earns: visitors already
 *   wash off the motorway and spend in shops (sim/visitors.ts); a hotel is
 *   where the ones worth the most stop washing back out at dusk.
 * - **Landmarks**, one each. A clock tower is a decision the way a karakol
 *   never is: it does nothing you can point to on a ledger row except make
 *   people proud and make strangers come — a flat mood lift and a pull on the
 *   visitor flow, for a price that stings at the era it unlocks.
 * - **The airport**, one, late. The third gate into the country after the
 *   motorway and the harbour, and the biggest visitor pull in the game.
 */
export type AttractionKind =
  | 'hotel'
  | 'clockTower'
  | 'opera'
  | 'stadium'
  | 'tvTower'
  | 'airport';

export interface AttractionSpec {
  kind: AttractionKind;
  /** Era that unlocks it; shown while still locked (§1: no hidden locks). */
  unlockedAt: Era;
  cost: number;
  /** ₺ per minute, forever. */
  upkeep: number;
  /** Only one may ever stand. What makes a landmark a landmark. */
  unique: boolean;
  /** Rooms, for the ones that sleep guests; income scales on this. */
  beds: number;
  /** Multiplier on the visitors the city draws; 1 = no pull. */
  pull: number;
  /** Flat city-wide mood while it stands. Pride does not have a radius. */
  happiness: number;
  /** Counts as a gate to the country, like a cargo harbour (sim/ports.ts). */
  gate: boolean;
}

export const ATTRACTION_SPECS: Readonly<Record<AttractionKind, AttractionSpec>> = {
  hotel: {
    kind: 'hotel',
    unlockedAt: 'town',
    cost: 8_500,
    upkeep: 95,
    unique: false,
    beds: 60,
    pull: 1,
    happiness: 0,
    gate: false,
  },
  clockTower: {
    kind: 'clockTower',
    unlockedAt: 'town',
    cost: 14_000,
    upkeep: 35,
    unique: true,
    beds: 0,
    pull: 1.08,
    happiness: 2,
    gate: false,
  },
  opera: {
    kind: 'opera',
    unlockedAt: 'city',
    cost: 34_000,
    upkeep: 170,
    unique: true,
    beds: 0,
    pull: 1.12,
    happiness: 3,
    gate: false,
  },
  stadium: {
    kind: 'stadium',
    unlockedAt: 'city',
    cost: 58_000,
    upkeep: 260,
    unique: true,
    beds: 0,
    pull: 1.2,
    happiness: 4,
    gate: false,
  },
  tvTower: {
    kind: 'tvTower',
    unlockedAt: 'metro',
    cost: 95_000,
    upkeep: 310,
    unique: true,
    beds: 0,
    pull: 1.25,
    happiness: 3,
    gate: false,
  },
  airport: {
    kind: 'airport',
    unlockedAt: 'metro',
    cost: 150_000,
    upkeep: 540,
    unique: true,
    beds: 0,
    pull: 1.5,
    happiness: 2,
    gate: true,
  },
};

/** Sheet and save order. Append only — the save stores the index. */
export const ATTRACTION_ORDER: readonly AttractionKind[] = [
  'hotel',
  'clockTower',
  'opera',
  'stadium',
  'tvTower',
  'airport',
];

export function isAttractionUnlocked(kind: AttractionKind, era: Era): boolean {
  return eraReached(era, ATTRACTION_SPECS[kind].unlockedAt);
}
