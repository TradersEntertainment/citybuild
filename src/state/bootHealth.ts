/**
 * Whether the last boot survived, and what to do about it if it did not.
 *
 * Written after a playtest report that matters more than the crash itself:
 * *"the game crashed at the tenth minute and no matter how many times I
 * refreshed it never came back — I could not open it at all."*
 *
 * A crash is a bug and gets fixed. A crash the player cannot refresh their way
 * out of is a different and worse thing: whatever killed the tab is in the
 * saved city, so every load walks into the same wall and the game is simply
 * over for that player. Nothing else in this codebase can be allowed to be
 * unrecoverable, and neither can this.
 *
 * The mechanism is a counter, not a flag. A flag would say "the last boot did
 * not finish", which is also true of a tab the player closed while it was
 * loading; a counter says how many boots in a row failed, and the answer scales
 * the response:
 *
 * - **0** — normal. Load the city, credit the time away, play.
 * - **1** — one boot died. Load the city but skip the offline catch-up, which
 *   is by far the most expensive thing that happens at start-up and therefore
 *   the most likely thing to have killed it. The player keeps their city.
 * - **2 or more** — the save itself is suspect. Set it aside under its own key,
 *   unharmed, and start a new city. Nothing is deleted; a copy is kept so it can
 *   be looked at, and so the player can be told where it went rather than
 *   discovering an empty map.
 *
 * The counter is cleared by the first frame that actually renders, so a boot
 * only counts as failed if the game never got that far.
 */
const BOOT_KEY = 'kadastro.boot';
/** Where a save that killed two boots in a row is kept rather than deleted. */
export const QUARANTINE_KEY = 'kadastro.city.broken';

function storage(): Storage | null {
  try {
    const probe = window.localStorage;
    const key = '__kadastro_boot_probe__';
    probe.setItem(key, '1');
    probe.removeItem(key);
    return probe;
  } catch {
    return null;
  }
}

export type BootPlan = 'normal' | 'skipCatchUp' | 'quarantine';

/**
 * What this boot should do, given how the last ones went. Call once, early, and
 * before anything that could hang: it is the act of recording the attempt that
 * makes the next one able to react.
 */
export function beginBoot(store: Storage | null = storage()): BootPlan {
  if (!store) return 'normal';
  let failures = 0;
  try {
    const raw = store.getItem(BOOT_KEY);
    const parsed = raw === null ? 0 : Number(raw);
    failures = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
    store.setItem(BOOT_KEY, String(failures + 1));
  } catch {
    return 'normal';
  }
  if (failures >= 2) return 'quarantine';
  if (failures >= 1) return 'skipCatchUp';
  return 'normal';
}

/** The game is up and drawing. Whatever happens now is not a boot failure. */
export function bootSucceeded(store: Storage | null = storage()): void {
  try {
    store?.removeItem(BOOT_KEY);
  } catch {
    // A storage that will not forget is not worth taking the game down for.
  }
}

/**
 * Moves the current save out of the way, keeping it.
 *
 * Kept rather than deleted for two reasons: a city is hours of somebody's
 * evening, and a save that reliably kills the game is the single most useful
 * thing anybody could hand a developer. Returns whether there was one to move.
 */
export function quarantineCity(
  cityKey: string,
  store: Storage | null = storage(),
): boolean {
  if (!store) return false;
  try {
    const raw = store.getItem(cityKey);
    if (raw === null) return false;
    store.setItem(QUARANTINE_KEY, raw);
    store.removeItem(cityKey);
    return true;
  } catch {
    return false;
  }
}
