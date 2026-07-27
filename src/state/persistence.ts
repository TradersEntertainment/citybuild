import { deserialize, serialize } from '../sim/save';
import type { GameState } from '../sim/state';

/**
 * Where a city lives between sessions.
 *
 * Everything that touches the browser is here, so the codec beside it stays
 * pure and testable. Storage is allowed to fail — private browsing, a full
 * quota, a locked-down WebView — and none of those may take the game down with
 * them: a player who cannot save should still be able to play.
 */
const STORAGE_KEY = 'kadastro.city';
const SEED_KEY = 'kadastro.seed';
/** Legacy outlives every city, so it is kept apart from the save. */
const LEGACY_KEY = 'kadastro.legacy';

function storage(): Storage | null {
  try {
    // Touching localStorage itself throws in some privacy modes, so the guard
    // has to be around the access, not around a feature check.
    const probe = window.localStorage;
    const key = '__kadastro_probe__';
    probe.setItem(key, '1');
    probe.removeItem(key);
    return probe;
  } catch {
    return null;
  }
}

export function loadLegacy(): number {
  const raw = storage()?.getItem(LEGACY_KEY);
  const value = raw === null || raw === undefined ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saveLegacy(total: number): void {
  storage()?.setItem(LEGACY_KEY, String(Math.max(0, Math.round(total))));
}

/**
 * Signs off a city: banks what it earned and clears it, so the next load starts
 * a new one. The city is only wiped after the legacy is written — losing an
 * evening's work and the reward for it would be the worst possible order.
 */
export function retireCity(earned: number): number {
  const total = loadLegacy() + Math.max(0, Math.round(earned));
  saveLegacy(total);
  storage()?.removeItem(STORAGE_KEY);
  return total;
}

export function saveCity(state: GameState): boolean {
  const store = storage();
  if (!store) return false;
  // A city whose core numbers have gone non-finite is not written down.
  //
  // The autosave is what makes a transient bug permanent: whatever the sim is
  // holding at that moment becomes the file, and a NaN in the file is a city
  // that can never be loaded again — a player reported exactly that, a crash no
  // amount of refreshing recovered from. Keeping the previous save is strictly
  // better than overwriting it with a broken one, and the codec refuses such a
  // file on the way in as well (sim/save.ts) so both ends are closed.
  if (
    !Number.isFinite(state.money) ||
    !Number.isFinite(state.population) ||
    !Number.isFinite(state.happiness) ||
    !Number.isFinite(state.playedMs)
  ) {
    return false;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(serialize(state)));
    return true;
  } catch {
    // Almost always the quota. Dropping the save is better than dropping the
    // frame it was written on.
    return false;
  }
}

export function loadCity(): GameState | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return deserialize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export const CITY_KEY = STORAGE_KEY;

export function clearCity(): void {
  storage()?.removeItem(STORAGE_KEY);
}

/**
 * The seed for a brand-new city, kept so a player who clears their city can be
 * given a different map rather than the same one again.
 *
 * The original build hard-coded one seed for everybody, which meant every
 * player in the world got the same island and a restart changed nothing.
 */
export function nextSeed(): number {
  const store = storage();
  const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  try {
    store?.setItem(SEED_KEY, String(seed));
  } catch {
    // Not being able to remember the seed is harmless; the city still gets one.
  }
  return seed;
}

/**
 * Autosave driver. Counts real elapsed time rather than frames, so a background
 * tab that stops painting does not also stop saving what it already had.
 */
export class Autosave {
  private accumulator = 0;
  private stopped = false;

  constructor(private readonly intervalSeconds: number) {}

  /** Call once per frame; saves when the interval has passed. */
  tick(state: GameState, deltaMs: number): void {
    if (this.stopped) return;
    this.accumulator += deltaMs;
    if (this.accumulator < this.intervalSeconds * 1000) return;
    this.accumulator = 0;
    saveCity(state);
  }

  /** Forces a save now, e.g. when the tab is being hidden or closed. */
  flush(state: GameState): void {
    if (this.stopped) return;
    this.accumulator = 0;
    saveCity(state);
  }

  /**
   * Latches saving off for good.
   *
   * Needed exactly once: a retired city has just been wiped from storage, and
   * both the frame loop and the pagehide handler are still holding it. Either
   * would write it straight back before the reload lands, and the player would
   * find the city they just signed off waiting for them.
   */
  stop(): void {
    this.stopped = true;
  }
}
