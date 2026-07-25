import { STR } from '../data/strings.tr';
import { LABOUR_PARTICIPATION } from '../data/balance';
import type { BuildingTotals } from '../sim/buildings';

/**
 * What the game should be telling the player right now, or null when it should
 * say nothing.
 *
 * A single opening line is not guidance. "Draw a line and the rest follows" is
 * also not true — nothing at all grows until land is zoned — and a game whose
 * only instruction is wrong is worse than one that stays quiet. So the hint is
 * a chain: it answers whatever is actually blocking the city, and falls silent
 * once nothing is.
 *
 * Order matters. Each case is the thing the player must do before the next case
 * can possibly apply, so the first match is always the most useful sentence.
 */
export interface CityFacts {
  roadTiles: number;
  zonedTiles: number;
  buildings: number;
  population: number;
  totals: BuildingTotals;
}

/** Unemployment above this is worth interrupting the player about. */
const UNEMPLOYMENT_ALARM = 0.4;
/** Below this many people, an empty job market is not yet a problem. */
const ADVICE_MIN_POPULATION = 30;

export function guidanceFor(facts: CityFacts): string | null {
  if (facts.roadTiles === 0) return STR.empty.noRoads;
  if (facts.zonedTiles === 0) return STR.empty.noZones;
  if (facts.buildings === 0) return STR.empty.noPeople;

  const jobs = facts.totals.commercialJobs + facts.totals.industrialJobs + facts.totals.farmJobs;

  // A town with workplaces and no homes is the mirror of the usual mistake, and
  // just as stuck.
  if (facts.population === 0 && jobs > 0) return STR.empty.noHomes;
  if (facts.population < ADVICE_MIN_POPULATION) return null;

  const workers = facts.population * LABOUR_PARTICIPATION;
  const unemployment = workers > 0 ? Math.max(0, (workers - jobs) / workers) : 0;
  if (unemployment > UNEMPLOYMENT_ALARM) return STR.empty.noJobs;

  // The city is working. Silence is the correct message.
  return null;
}
