import { eraReached, type Era } from '../sim/tiles';

/**
 * Things a rich city can buy (belediye yatırımları).
 *
 * Two complaints, one answer. A city past its first hour has more money than
 * anything to spend it on — every verb in the game is priced for a town, so a
 * metropolis just watches a number climb. And the night, which is a third of
 * every year, does nothing at all: it is dark, and that is the whole of it.
 *
 * So the money buys the night. A lighting programme is the flagship here for a
 * reason: it is the only purchase in the game whose effect the player watches
 * happen, across the whole city, the moment they pay for it — and it turns the
 * dark third of the calendar from dead time into the part they invested in.
 *
 * These are not buildings. Nothing is placed, nothing takes a tile, and there is
 * no map decision to get wrong: a programme is bought once, applies everywhere,
 * costs upkeep forever, and cannot be sold. That is deliberately a *different*
 * kind of decision from the rest of the game — the question is not "where" but
 * "is the city big enough to carry this yet", which is the question a large
 * treasury should be asking.
 */
export type ProgrammeId = 'lighting' | 'greening' | 'festivals';

export interface Tier {
  /** One-off price. */
  cost: number;
  /** ₺ per minute, forever. */
  upkeep: number;
  /** Era from which this tier may be bought. */
  unlockedAt: Era;
  /** Short name for the tier, in Turkish. */
  name: string;
}

export interface Programme {
  id: ProgrammeId;
  /** Tiers in order; buying tier n requires n−1. */
  tiers: readonly Tier[];
}

/**
 * Prices are steep; upkeep is not.
 *
 * The one-off cost is the sink — the whole complaint being answered is that
 * nothing in the game was expensive enough to matter — and the standing cost is
 * deliberately light, because it is the standing cost that decides whether a
 * purchase was a *trap*.
 *
 * The eras matter more than either. Measured on a real city, lighting returns
 * about a tenth of a lira a minute per resident at full funding: about 36 ₺/min
 * for a town, six hundred for a city, four thousand for a metro. An earlier
 * version unlocked the first tier in a village, where there is almost no trade to
 * protect and no price at all could have paid it back — so a player who bought
 * the cheapest thing on offer watched their net fall and learned not to trust the
 * panel. Each tier now opens at the era where it starts earning.
 */
export const PROGRAMMES: Readonly<Record<ProgrammeId, Programme>> = {
  lighting: {
    id: 'lighting',
    tiers: [
      { cost: 20_000, upkeep: 30, unlockedAt: 'town', name: 'Gaz fenerleri' },
      { cost: 90_000, upkeep: 260, unlockedAt: 'city', name: 'Elektrik hattı' },
      { cost: 350_000, upkeep: 1_100, unlockedAt: 'metro', name: 'Sodyum lambalar' },
      { cost: 1_200_000, upkeep: 3_600, unlockedAt: 'metropolis', name: 'LED şehir' },
    ],
  },
  greening: {
    id: 'greening',
    tiers: [
      { cost: 28_000, upkeep: 45, unlockedAt: 'town', name: 'Fidan kampanyası' },
      { cost: 130_000, upkeep: 340, unlockedAt: 'city', name: 'Yeşil kuşak' },
      { cost: 480_000, upkeep: 1_300, unlockedAt: 'metro', name: 'Orman belediyesi' },
    ],
  },
  festivals: {
    id: 'festivals',
    tiers: [
      { cost: 34_000, upkeep: 60, unlockedAt: 'town', name: 'Bayram bütçesi' },
      { cost: 160_000, upkeep: 420, unlockedAt: 'city', name: 'Şehir festivali' },
      { cost: 560_000, upkeep: 1_500, unlockedAt: 'metro', name: 'Kültür başkenti' },
    ],
  },
};

export const PROGRAMME_ORDER: readonly ProgrammeId[] = ['lighting', 'greening', 'festivals'];

export function tiersOf(id: ProgrammeId): readonly Tier[] {
  return PROGRAMMES[id].tiers;
}

/** The tier a city at this level would buy next, or null when it is finished. */
export function tierAt(id: ProgrammeId, level: number): Tier | null {
  return tiersOf(id)[level] ?? null;
}

export function isTierUnlocked(id: ProgrammeId, level: number, era: Era): boolean {
  const tier = tierAt(id, level);
  return tier !== null && eraReached(era, tier.unlockedAt);
}
