import { describe, expect, it } from 'vitest';
import {
  appendHistory,
  clearHistory,
  loadHistory,
  type HistoryStorage,
} from '../src/state/history';

/**
 * The diary (§14): what it keeps, what it forgets, and what it survives.
 * Storage is faked, so the tests read exactly what a browser would.
 */
function fakeStorage(): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('the history log', () => {
  it('appends entries oldest-first and reads them back', () => {
    const storage = fakeStorage();
    appendHistory([{ year: 1914, icon: '⚔️', title: 'Savaş' }], storage);
    appendHistory([{ year: 1923, icon: '🎉', title: 'Bayram', detail: 'Detay' }], storage);

    const log = loadHistory(storage);
    expect(log).toHaveLength(2);
    expect(log[0]?.year).toBe(1914);
    expect(log[1]?.detail).toBe('Detay');
  });

  it('caps the log so a long-lived city cannot grow it forever', () => {
    const storage = fakeStorage();
    const entries = Array.from({ length: 200 }, (_, i) => ({
      year: 1900 + i,
      icon: '•',
      title: `Olay ${i}`,
    }));
    appendHistory(entries, storage);

    const log = loadHistory(storage);
    expect(log.length).toBeLessThanOrEqual(160);
    // The cap drops the oldest: the newest page is always kept.
    expect(log[log.length - 1]?.year).toBe(2099);
  });

  it('a corrupt log reads as an empty one rather than throwing', () => {
    const storage = fakeStorage();
    storage.data.set('kadastro.history', '{bozuk json');
    expect(loadHistory(storage)).toEqual([]);

    storage.data.set('kadastro.history', '42');
    expect(loadHistory(storage)).toEqual([]);
  });

  it('a retiring city takes its diary with it', () => {
    const storage = fakeStorage();
    appendHistory([{ year: 1999, icon: '🌋', title: 'Deprem' }], storage);
    clearHistory(storage);
    expect(loadHistory(storage)).toEqual([]);
  });

  it('entries without the right shape are filtered, not trusted', () => {
    const storage = fakeStorage();
    storage.data.set(
      'kadastro.history',
      JSON.stringify([
        { year: 1914, icon: '⚔️', title: 'Geçerli' },
        { year: 'yıl', title: 5 },
        null,
      ]),
    );
    const log = loadHistory(storage);
    expect(log).toHaveLength(1);
    expect(log[0]?.title).toBe('Geçerli');
  });
});
