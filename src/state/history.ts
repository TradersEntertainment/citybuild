/**
 * The city's memory (§14). The event feed announces and forgets; this log
 * remembers. Every dated event that fires while the player watches, and every
 * era the city grows into, is written down here — so a city that has lived
 * through a war, two crises and a boom can look back over its own century.
 *
 * It lives in localStorage rather than the save: the save is a compressed
 * grid format with a fixed schema, and a list of sentences does not belong in
 * it. The log is per device, cleared when a city retires, and capped so a
 * long-lived city cannot grow it without bound.
 */
export interface HistoryEntry {
  year: number;
  icon: string;
  title: string;
  detail?: string | undefined;
}

const KEY = 'kadastro.history';
/** Long enough to cover the whole timeline twice over; short enough to stay cheap. */
const MAX_ENTRIES = 160;

/** The slice of Storage the log needs — injectable so tests can fake it. */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): HistoryStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Every entry so far, oldest first. Never throws — a bad log costs nothing. */
export function loadHistory(storage: HistoryStorage | null = defaultStorage()): HistoryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as HistoryEntry).year === 'number' &&
        typeof (entry as HistoryEntry).title === 'string',
    );
  } catch {
    return [];
  }
}

/** Writes entries at the end of the log, keeping the newest MAX_ENTRIES. */
export function appendHistory(
  entries: readonly HistoryEntry[],
  storage: HistoryStorage | null = defaultStorage(),
): void {
  if (!storage || entries.length === 0) return;
  try {
    const next = [...loadHistory(storage), ...entries].slice(-MAX_ENTRIES);
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store loses the diary, never the game.
  }
}

/** A retiring city takes its diary with it; the next city starts a blank page. */
export function clearHistory(storage: HistoryStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    /* nothing worth doing */
  }
}
