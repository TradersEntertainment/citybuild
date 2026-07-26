import { SECONDS_PER_DAY, DAYLIGHT_SHARE } from '../data/balance';

/**
 * The day, as a number (Paket 1 §2).
 *
 * Pure and stateless: everything here is a function of played time, so the
 * renderer, the audio and the pedestrian layer all read the same clock without
 * anybody owning it. Nothing is stored and nothing has to be saved — a city
 * loaded at noon is at noon because its clock says so.
 *
 * **One day per year, deliberately.** The plan asked for a two-minute day, and
 * a year in this game is forty seconds — which would put three years inside one
 * sunrise and have the sun flatly contradict the year badge in the top bar. Tying
 * the two clocks together instead means every new year opens with a dawn, and
 * there is only one notion of "how fast time goes" to reason about. It is one
 * constant in balance.ts if that turns out to feel wrong.
 *
 * Daylight owns most of the cycle. An even split would leave a city dark half
 * the time it is being looked at, and the night is worth having because of the
 * lights coming on, not because of the dark.
 */

/** Where in the day the city is: 0 and 1 are midnight, 0.5 is noon. */
export function dayFraction(playedMs: number): number {
  const seconds = Math.max(0, playedMs) / 1000;
  const cycle = seconds / SECONDS_PER_DAY;
  return cycle - Math.floor(cycle);
}

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

/**
 * Named stretches of the cycle, for the things that want a word rather than a
 * curve — a lamp is on or it is not.
 */
export function dayPhase(fraction: number): DayPhase {
  const sun = sunHeight(fraction);
  if (sun <= 0) return 'night';
  if (sun < 0.22) return fraction < 0.5 ? 'dawn' : 'dusk';
  return 'day';
}

/**
 * How high the sun sits, −1 to 1, with the horizon at zero.
 *
 * Skewed so daylight fills `DAYLIGHT_SHARE` of the cycle: the raw sine of a
 * fraction spends exactly half the day below the horizon, which is more night
 * than a game wants. The skew warps the input, not the output, so the curve
 * stays smooth and the dawn still eases rather than snapping.
 */
export function sunHeight(fraction: number): number {
  return Math.sin(skew(fraction) * Math.PI * 2 - Math.PI / 2);
}

/** Cycle position of sunrise and sunset, placed symmetrically about noon. */
const DAWN = 0.5 - DAYLIGHT_SHARE / 2;
const DUSK = 0.5 + DAYLIGHT_SHARE / 2;
const NIGHT_LENGTH = 1 - DAYLIGHT_SHARE;

/**
 * Warps the cycle so the sun is up for exactly DAYLIGHT_SHARE of it.
 *
 * A remapping of time rather than a curve fitted to it: the raw sine is above
 * the horizon for s in (0.25, 0.75), so stretching the daylight stretch of the
 * day onto that interval and compressing the night onto the other half gives
 * the share by construction. An eased warp was tried first and came out nine
 * points short — close enough to look right and wrong enough that the number in
 * balance.ts would have been a lie.
 *
 * The rate of change has a kink at each horizon crossing, which is a sunset that
 * changes speed at the moment it touches the horizon. That is not visible; a
 * daylight share that does not match its own constant would have been.
 */
function skew(fraction: number): number {
  if (fraction >= DAWN && fraction <= DUSK) {
    return 0.25 + ((fraction - DAWN) / DAYLIGHT_SHARE) * 0.5;
  }
  // The night wraps midnight, so evening and small hours are one stretch.
  const since = fraction > DUSK ? fraction - DUSK : fraction + 1 - DUSK;
  return 0.75 + (since / NIGHT_LENGTH) * 0.5;
}

/**
 * How dark it is, 0 in full day and 1 at the bottom of the night.
 *
 * What the lit windows, the streetlamps and the headlights all fade on. Reaches
 * 1 well before the sun's lowest point, because a city is fully lit long before
 * midnight and staying half-lit until then reads as a bug.
 */
export function nightAmount(fraction: number): number {
  // Lamps come on before the sun is down, the way a real city's do — and it has
  // to be before, or this and daylightAmount can never both be positive and the
  // overlap below is a comment describing something that cannot happen.
  return clamp01((LAMPS_ON_HEIGHT - sunHeight(fraction)) / LAMPS_FULL_SPAN);
}

/** Sun height at which the lamps start coming on; above the horizon on purpose. */
const LAMPS_ON_HEIGHT = 0.12;
/** How far the sun falls between the first lamp and full night. */
const LAMPS_FULL_SPAN = 0.3;

/**
 * How much of the sun's own light reaches the ground, 0..1.
 *
 * Separate from nightAmount rather than one minus it: the two cross over during
 * dusk, which is the half-minute the city looks best — warm low sun on the west
 * faces and the first windows already lit.
 */
export function daylightAmount(fraction: number): number {
  return clamp01(sunHeight(fraction) / 0.3);
}

/**
 * Commuting pressure, 0..1, peaking twice a day.
 *
 * Read by the traffic and pedestrian layers so the streets fill and empty
 * instead of carrying the same load at four in the morning as at eight. It is
 * presentation only — the sim's own traffic model is about capacity, and making
 * the economy breathe on a two-minute cycle would make every reading the player
 * takes depend on when they happened to look.
 */
export function rushHour(fraction: number): number {
  const morning = bell(fraction, 0.3, 0.075);
  const evening = bell(fraction, 0.72, 0.085);
  return clamp01(Math.max(morning, evening));
}

/** How busy the streets should look at all, from dead night to rush hour. */
export function streetActivity(fraction: number): number {
  const base = 0.22 + daylightAmount(fraction) * 0.5;
  return clamp01(base + rushHour(fraction) * 0.34);
}

/** A peak at `centre` of width `width`, wrapping around the day. */
function bell(fraction: number, centre: number, width: number): number {
  let d = Math.abs(fraction - centre);
  if (d > 0.5) d = 1 - d; // the day is a circle
  return Math.exp(-(d * d) / (2 * width * width));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
