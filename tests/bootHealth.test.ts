import { describe, expect, it } from 'vitest';
import { beginBoot, bootSucceeded, quarantineCity, QUARANTINE_KEY } from '../src/state/bootHealth';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState } from '../src/sim/state';

/**
 * Getting back in after a crash.
 *
 * From a playtest report: *"the game crashed at the tenth minute and no matter
 * how many times I refreshed it never came back — I could not open it at all."*
 *
 * The crash itself is a bug and will be found. This file is about the second
 * half of that sentence, which is the worse half: if whatever killed the tab
 * lives in the saved city then every load walks into the same wall, and there
 * is no action left for the player to take. Nothing in this game is allowed to
 * be unrecoverable — not a mis-drawn road, not a neglected city, and not this.
 *
 * Two independent guards, because they fail differently. The boot counter
 * catches a crash whatever caused it, including one this codebase has not
 * diagnosed yet. The finiteness check catches the specific way a save turns
 * permanently fatal: a NaN, which survives every operation it touches and gets
 * written straight back to the file by the next autosave.
 */

/** A localStorage stand-in; the real one is not in a node test runner. */
function fakeStore(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe('a boot that never finished is noticed by the next one', () => {
  it('escalates: normal, then no catch-up, then set the save aside', () => {
    const store = fakeStore();
    expect(beginBoot(store)).toBe('normal');
    // Nothing cleared it, so that boot died.
    expect(beginBoot(store)).toBe('skipCatchUp');
    expect(beginBoot(store)).toBe('quarantine');
    // And it stays there rather than cycling back round to normal.
    expect(beginBoot(store)).toBe('quarantine');
  });

  it('forgets the moment a frame is drawn', () => {
    const store = fakeStore();
    beginBoot(store);
    bootSucceeded(store);
    expect(beginBoot(store)).toBe('normal');
  });

  it('treats a session that ran fine as a fresh start every time', () => {
    const store = fakeStore();
    for (let i = 0; i < 5; i++) {
      expect(beginBoot(store)).toBe('normal');
      bootSucceeded(store);
    }
  });

  it('never takes the game down because storage will not co-operate', () => {
    // Private browsing, a full quota, a locked-down WebView. A player who
    // cannot save must still be able to play — and must certainly not be
    // dropped into safe mode forever by a storage that refuses to remember.
    expect(beginBoot(null)).toBe('normal');
    expect(() => bootSucceeded(null)).not.toThrow();
    expect(quarantineCity('kadastro.city', null)).toBe(false);

    const hostile = {
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('nope');
      },
      removeItem: () => {
        throw new Error('nope');
      },
    } as unknown as Storage;
    expect(beginBoot(hostile)).toBe('normal');
    expect(() => bootSucceeded(hostile)).not.toThrow();
  });

  it('shelves a suspect city rather than deleting it', () => {
    // A city is hours of somebody's evening, and a save that reliably kills the
    // game is the most useful thing they could hand over. Moved, never dropped.
    const store = fakeStore();
    store.setItem('kadastro.city', '{"the":"city"}');
    expect(quarantineCity('kadastro.city', store)).toBe(true);
    expect(store.getItem('kadastro.city')).toBeNull();
    expect(store.getItem(QUARANTINE_KEY)).toBe('{"the":"city"}');
    // Nothing to shelve the second time, and that is not an error.
    expect(quarantineCity('kadastro.city', store)).toBe(false);
  });
});

describe('a save with a broken number is refused, not loaded', () => {
  function file(): Record<string, unknown> {
    const game = createGameState(hashSeed('boot'), 0);
    game.money = 40_000;
    return serialize(game) as unknown as Record<string, unknown>;
  }

  it('loads a healthy one', () => {
    expect(deserialize(file() as never)).not.toBeNull();
  });

  it('refuses a NaN scalar', () => {
    // NaN is the one corruption that spreads: it survives every arithmetic
    // operation, so one poisoned figure works through happiness into migration
    // into demand into every score in the city — and the autosave writes it
    // back. Loading such a file costs the player the game; refusing it costs
    // them one city.
    for (const key of ['money', 'happiness', 'playedMs', 'taxRate'] as const) {
      const broken = file();
      broken[key] = Number.NaN;
      expect(deserialize(broken as never)).toBeNull();
    }
  });

  it('refuses an infinity, which arithmetic spreads just as far', () => {
    const broken = file();
    broken['money'] = Number.POSITIVE_INFINITY;
    expect(deserialize(broken as never)).toBeNull();
  });

  it('refuses a NaN hiding inside the building rows', () => {
    const game = createGameState(hashSeed('boot2'), 0);
    game.buildings.set(1, {
      id: 1,
      x: 20,
      y: 20,
      w: 1,
      h: 1,
      zone: 'res',
      level: 2,
      score: 0.8,
      growthProgress: 0,
      decayTimer: 0,
      population: Number.NaN,
      jobs: 0,
      output: 0,
      issues: 0,
      builtAt: 0,
      variantSeed: 7,
    });
    expect(deserialize(serialize(game) as never)).toBeNull();
  });

  it('still accepts a file written before offices existed', () => {
    // The guard must not mistake "older than a field" for "corrupt": that would
    // throw away every city saved before the last update.
    const older = file();
    older['demand'] = { res: 0.4, com: 0.3, ind: 0.2 };
    const back = deserialize(older as never);
    expect(back).not.toBeNull();
    expect(back!.demand.office).toBe(0);
  });
});
