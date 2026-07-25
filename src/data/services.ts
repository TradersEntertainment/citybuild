import { SERVICE, type Era } from '../sim/tiles';

/**
 * Civic services (§9).
 *
 * A service is a building the player places directly — the first thing in the
 * game that is not drawn or zoned — and it covers ground around itself. What
 * makes it a decision rather than a chore is that coverage is bounded and
 * upkeep is not: every station costs money every minute, forever, so a city
 * that over-provides goes broke as surely as one that under-provides stalls.
 */
export type ServiceKind = 'fire' | 'health' | 'education' | 'police';

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
  police: {
    kind: 'police',
    bit: SERVICE.police,
    requiredFrom: 'metro',
    unlockedAt: 'city',
    cost: 5_400,
    upkeep: 64,
    radius: 13,
  },
};

export const SERVICE_ORDER: readonly ServiceKind[] = ['fire', 'health', 'education', 'police'];

const ERA_RANK: readonly Era[] = [
  'founding',
  'village',
  'town',
  'city',
  'metro',
  'metropolis',
  'megacity',
];

function rank(era: Era): number {
  return ERA_RANK.indexOf(era);
}

export function isServiceUnlocked(kind: ServiceKind, era: Era): boolean {
  return rank(era) >= rank(SERVICE_SPECS[kind].unlockedAt);
}

/**
 * What the city expects at this point in its life. A founding settlement is not
 * marked down for having no fire brigade, which is what keeps the opening — the
 * part of the game that was already tuned and tested — exactly as it was.
 */
export function requiredServices(era: Era): readonly ServiceKind[] {
  return SERVICE_ORDER.filter((kind) => rank(era) >= rank(SERVICE_SPECS[kind].requiredFrom));
}
