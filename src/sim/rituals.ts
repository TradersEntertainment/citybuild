import { RITUAL_WINDOW, RITUALS, type Ritual } from '../data/rituals';
import { yearFraction } from './seasons';
import type { GameState } from './state';
import { yearOf } from './timeline';

/**
 * The days that come round (Paket 3 §11).
 *
 * The timeline fires an event once and never again; a holiday has to fire once
 * *per year*, forever, which is a different problem and is why it is a different
 * module. The whole of the difference lives in one string: the caller remembers
 * `id@year` rather than `id`, so 23 April 1961 and 23 April 1962 are two
 * separate things that happened and 23 April 1961 twice is not.
 *
 * Nothing is saved. A reload lands mid-year on a holiday that has not been
 * announced yet and announces it, which is one extra line in the feed for a
 * player who reloaded during a fireworks display — cheaper than a save field,
 * and the mood bonus is derived from the date rather than granted on the day, so
 * it cannot be farmed by reloading.
 */
export interface RitualToday {
  ritual: Ritual;
  year: number;
  /** How deep into the holiday the city is, 0..1 at the middle, 0 at the edges. */
  strength: number;
}

/**
 * Whichever rituals the city is inside right now.
 *
 * A window rather than a day: at forty seconds to the year a single day is a
 * quarter of a second, and a holiday nobody can see happen is not a holiday.
 */
export function ritualsNow(state: GameState): RitualToday[] {
  const fraction = yearFraction(state.playedMs);
  const year = yearOf(state.playedMs);
  const found: RitualToday[] = [];

  for (const ritual of RITUALS) {
    if (ritual.from !== undefined && year < ritual.from) continue;
    // Distance the short way round, so a new-year window straddling December
    // and January is one window rather than two halves.
    const raw = Math.abs(fraction - ritual.at);
    const distance = Math.min(raw, 1 - raw);
    if (distance >= RITUAL_WINDOW) continue;
    found.push({ ritual, year, strength: 1 - distance / RITUAL_WINDOW });
  }

  return found;
}

/**
 * Mood the calendar is worth today.
 *
 * Derived from the date rather than added when a holiday fires, which is what
 * makes it honest: it fades in and out with the window, an offline catch-up
 * cannot bank four of them at once, and reloading on Republic Day does not pay
 * twice.
 */
export function ritualHappiness(state: GameState): number {
  let total = 0;
  for (const today of ritualsNow(state)) total += today.ritual.happiness * today.strength;
  return total;
}

/**
 * Rituals that have begun since the caller last looked.
 *
 * `announced` is the caller's own memory, keyed by ritual and year, and is
 * mutated in place — the same shape the petitions use. It is pruned to the last
 * two years so a city played for a century does not accumulate a set of every
 * holiday it has ever had.
 */
export function drainRituals(state: GameState, announced: Set<string>): RitualToday[] {
  const fresh: RitualToday[] = [];
  const year = yearOf(state.playedMs);

  for (const today of ritualsNow(state)) {
    const key = `${today.ritual.id}@${today.year}`;
    if (announced.has(key)) continue;
    announced.add(key);
    fresh.push(today);
  }

  if (announced.size > RITUALS.length * 2) {
    for (const key of [...announced]) {
      const at = key.lastIndexOf('@');
      const then = Number(key.slice(at + 1));
      if (Number.isFinite(then) && year - then > 1) announced.delete(key);
    }
  }

  return fresh;
}
