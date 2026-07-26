import { eraReached, SERVICE, type Era } from '../sim/tiles';

/**
 * Civic services (§9).
 *
 * A service is a building the player places directly — the first thing in the
 * game that is not drawn or zoned — and it covers ground around itself. What
 * makes it a decision rather than a chore is that coverage is bounded and
 * upkeep is not: every station costs money every minute, forever, so a city
 * that over-provides goes broke as surely as one that under-provides stalls.
 */
export type ServiceKind = 'fire' | 'health' | 'education' | 'police' | 'cemetery';

export interface ServiceSpec {
  kind: ServiceKind;
  /** Bit set in world.serviceMask for covered tiles. */
  bit: number;
  /** Era from which the city expects it; before that, its absence is no fault. */
  requiredFrom: Era;
  /** Era that lets the player build it. */
  unlockedAt: Era;
  cost: number;
  /** ₺ per minute, forever. */
  upkeep: number;
  /** Coverage radius in tiles. */
  radius: number;
}

export const SERVICE_SPECS: Readonly<Record<ServiceKind, ServiceSpec>> = {
  /**
   * A cemetery is the odd one out: it covers no ground and its radius is
   * meaningless, because the dead are brought to it from wherever they died
   * (sim/cohorts.ts). What it has instead is a rate — so the question a player
   * answers is "how many", not "where", and the answer is decided by a wave of
   * deaths they can see coming a band in advance if they are paying attention.
   *
   * Opens at town, which is the first era with enough people for a wave to be
   * a wave, and is not required at any era: nothing marks a city down for
   * having no cemetery. The backlog does that on its own, and far more
   * legibly than a coverage fraction could.
   */
  cemetery: {
    kind: 'cemetery',
    bit: SERVICE.cemetery,
    requiredFrom: 'megacity',
    unlockedAt: 'town',
    cost: 7_600,
    upkeep: 54,
    radius: 4,
  },
  fire: {
    kind: 'fire',
    bit: SERVICE.fire,
    requiredFrom: 'town',
    unlockedAt: 'village',
    cost: 3_200,
    upkeep: 42,
    radius: 14,
  },
  health: {
    kind: 'health',
    bit: SERVICE.health,
    requiredFrom: 'town',
    unlockedAt: 'village',
    cost: 4_500,
    upkeep: 58,
    radius: 12,
  },
  education: {
    kind: 'education',
    bit: SERVICE.education,
    requiredFrom: 'city',
    unlockedAt: 'town',
    cost: 6_800,
    upkeep: 76,
    radius: 11,
  },
  /**
   * Opened early, beside the brigade, because crime now begins in a village
   * (sim/crime.ts) and the karakol is the thing that answers it. A hazard the
   * player can see and cannot act on for two whole eras is not tension, it is a
   * missing button.
   *
   * `requiredFrom` deliberately stays at metro. Being *able* to build one and
   * being *marked down* for not having one are different questions, and moving
   * the second would retune the town era — a part of the game that was measured
   * without it — as a side effect of answering the first. Crime pays for itself
   * in mood and stolen money, which is a reason the player can see, unlike a
   * coverage fraction.
   */
  police: {
    kind: 'police',
    bit: SERVICE.police,
    requiredFrom: 'metro',
    unlockedAt: 'village',
    cost: 5_400,
    upkeep: 64,
    radius: 13,
  },
};

export const SERVICE_ORDER: readonly ServiceKind[] = [
  'fire',
  'health',
  'education',
  'police',
  'cemetery',
];

export function isServiceUnlocked(kind: ServiceKind, era: Era): boolean {
  return eraReached(era, SERVICE_SPECS[kind].unlockedAt);
}

/**
 * What the city expects at this point in its life. A founding settlement is not
 * marked down for having no fire brigade, which is what keeps the opening — the
 * part of the game that was already tuned and tested — exactly as it was.
 */
export function requiredServices(era: Era): readonly ServiceKind[] {
  return SERVICE_ORDER.filter((kind) => eraReached(era, SERVICE_SPECS[kind].requiredFrom));
}
