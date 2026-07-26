import { SEASON_FARM_YIELD, SNOW_PEAK, SNOW_SPAN } from '../data/balance';
import { SECONDS_PER_YEAR } from '../data/timeline';

/**
 * The year going round (Paket 3 §8).
 *
 * Pure and stateless, like the day cycle beside it: the season is a function of
 * played time and nothing else, so it costs nothing, needs no save field, and
 * cannot drift out of step with the calendar year on the top bar.
 *
 * It is pinned to that year deliberately. A city founded in 1900 opens in
 * January, so the first thing a new mayor sees is a winter, and "1929" and
 * "winter" mean the same forty seconds on every device. Four seasons inside one
 * year at forty seconds to the year makes ten seconds a season, which is the
 * plan's own figure and turns out to be about right: long enough to notice the
 * ground has changed colour, short enough that a wheat field's bad quarter is a
 * setback rather than a punishment.
 */
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** In calendar order from the turn of the year. */
export const SEASONS: readonly Season[] = ['winter', 'spring', 'summer', 'autumn'];

/** How far through the year the city is, 0..1. January is 0. */
export function yearFraction(playedMs: number): number {
  const seconds = Math.max(0, playedMs) / 1000;
  const within = seconds % SECONDS_PER_YEAR;
  return within / SECONDS_PER_YEAR;
}

export function seasonOf(playedMs: number): Season {
  const quarter = Math.floor(yearFraction(playedMs) * 4);
  return SEASONS[Math.min(3, quarter)] as Season;
}

/**
 * The season, the one after it, and how far between them the city is.
 *
 * The renderer wants this rather than a bare season: a ground colour that
 * changed in one frame four times a year would read as a bug, and a blend is
 * the same information without the step.
 */
export interface SeasonBlend {
  season: Season;
  next: Season;
  /** 0 at the start of `season`, 1 as `next` begins. */
  t: number;
}

export function seasonBlend(playedMs: number): SeasonBlend {
  const position = yearFraction(playedMs) * 4;
  const quarter = Math.min(3, Math.floor(position));
  return {
    season: SEASONS[quarter] as Season,
    next: SEASONS[(quarter + 1) % 4] as Season,
    t: position - quarter,
  };
}

/**
 * What the season does to a harvest.
 *
 * The one place seasons touch the ledger, and the reason they are in `src/sim`
 * rather than in the renderer. Farmland is the only zone whose output is a
 * *crop*, so it is the only one a calendar should be allowed to move.
 */
export function farmSeasonMultiplier(playedMs: number): number {
  const blend = seasonBlend(playedMs);
  const from = SEASON_FARM_YIELD[blend.season];
  const to = SEASON_FARM_YIELD[blend.next];
  // Blended, not stepped: a field does not stop yielding the instant a quarter
  // turns over, and a ledger that jumped would look broken rather than seasonal.
  return from + (to - from) * blend.t;
}

/**
 * How much snow is lying, 0..1.
 *
 * A curve rather than a flag, peaking in the depth of winter and gone by the
 * time the ground thaws. Purely presentational — nothing in the sim reads it —
 * but it lives here because it is a fact about the calendar, and the renderer
 * should not be the thing that decides when winter is.
 */
export function snowAmount(playedMs: number): number {
  const fraction = yearFraction(playedMs);
  // Distance to the peak, the short way round the year.
  const raw = Math.abs(fraction - SNOW_PEAK);
  const distance = Math.min(raw, 1 - raw);
  if (distance >= SNOW_SPAN) return 0;
  const closeness = 1 - distance / SNOW_SPAN;
  // Eased, so the first and last snow of the year arrive gradually.
  return closeness * closeness * (3 - 2 * closeness);
}
