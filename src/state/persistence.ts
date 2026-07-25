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

export function saveCity(state: GameState): boolean {
  const store = storage();
  if (!store) return false;
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

  constructor(private readonly intervalSeconds: number) {}

  /** Call once per frame; saves when the interval has passed. */
  tick(state: GameState, deltaMs: number): void {
    this.accumulator += deltaMs;
    if (this.accumulator < this.intervalSeconds * 1000) return;
    this.accumulator = 0;
    saveCity(state);
  }

  /** Forces a save now, e.g. when the tab is being hidden or closed. */
  flush(state: GameState): void {
    this.accumulator = 0;
    saveCity(state);
  }
}
