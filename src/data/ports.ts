import { eraReached, type Era } from '../sim/tiles';

/**
 * The sea, as something to invest in (denize yatırım).
 *
 * Water has been scenery and an obstacle since the first build: it costs six
 * times as much to bridge, it kills a parcel's buildable area, and it gives back
 * nothing. A coastal city that spent its whole life pretending the coast was a
 * wall was the largest missing verb in the game.
 *
 * A berth is placed like a station — a tap on owned ground — with one extra
 * condition that changes everything about where it can go: it has to be able to
 * see open water. That single rule turns every shoreline on the map from a
 * nuisance into the most valuable land the city owns.
 *
 * The four kinds are the four things a coast is actually for, in the order a
 * century opens them:
 *
 * - a fishing shelter, which a village can afford and which pays by the acre of
 *   water it looks out on;
 * - a cargo port, which is expensive, employs a district, and — the reason to
 *   build one — is a second way out of the country. A city with a working port
 *   is no longer hostage to the one motorway, which is exactly the hole the war
 *   damage opened;
 * - a shipyard, which is heavy industry with a hull in front of it: the most
 *   jobs on the list and a plume to go with them;
 * - a marina, which sells the view rather than the water, and is the only thing
 *   here that pays in mood instead of money.
 */
export type PortKind = 'fishing' | 'cargo' | 'shipyard' | 'marina';

export interface PortSpec {
  kind: PortKind;
  unlockedAt: Era;
  cost: number;
  /** ₺ per minute, forever, like every other standing facility. */
  upkeep: number;
  jobs: number;
  /** Tiles it looks for open water in. */
  reach: number;
  /** Water tiles it needs inside that reach before it will work at all. */
  waterNeeded: number;
  /** ₺ per minute per water tile in reach. */
  yieldPerWater: number;
  /** ₺ per minute per √resident — how much the city's own size is worth to it. */
  yieldPerRootCitizen: number;
  /**
   * Whether this berth is a way into the country in its own right.
   *
   * Only the cargo port. This is the strategic point of the whole branch: it
   * substitutes for the national highway as the city's link to everywhere else,
   * so a barricaded motorway stops being an existential problem and becomes an
   * expensive one.
   */
  seaGate?: true;
  /** Flat mood shift while it stands, for the one that sells a view. */
  happiness?: number;
  /** Pollution it adds at its own tile, in the diffusion field's units. */
  pollution?: number;
}

export const PORT_SPECS: Readonly<Record<PortKind, PortSpec>> = {
  fishing: {
    kind: 'fishing',
    unlockedAt: 'village',
    cost: 2_600,
    upkeep: 28,
    jobs: 16,
    reach: 6,
    waterNeeded: 8,
    yieldPerWater: 1.15,
    // A bigger city eats more fish, but a shelter can only land what it can land.
    yieldPerRootCitizen: 3.5,
  },
  cargo: {
    kind: 'cargo',
    unlockedAt: 'town',
    cost: 15_000,
    upkeep: 190,
    jobs: 64,
    reach: 9,
    // Needs genuinely open water, not a pond: a freighter has to get in.
    waterNeeded: 30,
    yieldPerWater: 0.85,
    yieldPerRootCitizen: 30,
    seaGate: true,
  },
  shipyard: {
    kind: 'shipyard',
    unlockedAt: 'city',
    cost: 24_000,
    upkeep: 275,
    jobs: 130,
    reach: 8,
    waterNeeded: 24,
    yieldPerWater: 0.5,
    yieldPerRootCitizen: 22,
    pollution: 34,
  },
  marina: {
    kind: 'marina',
    unlockedAt: 'city',
    cost: 9_500,
    upkeep: 120,
    jobs: 34,
    reach: 7,
    waterNeeded: 14,
    yieldPerWater: 0.7,
    yieldPerRootCitizen: 18,
    happiness: 4,
  },
};

export const PORT_ORDER: readonly PortKind[] = ['fishing', 'cargo', 'shipyard', 'marina'];

export function isPortUnlocked(kind: PortKind, era: Era): boolean {
  return eraReached(era, PORT_SPECS[kind].unlockedAt);
}
