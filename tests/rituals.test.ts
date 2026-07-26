import { describe, expect, it } from 'vitest';
import { RITUAL_WINDOW, RITUALS } from '../src/data/rituals';
import { SECONDS_PER_YEAR, START_YEAR } from '../src/data/timeline';
import { drainRituals, ritualHappiness, ritualsNow } from '../src/sim/rituals';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';

/**
 * The days that come round (Paket 3 §11).
 *
 * The whole difficulty is the difference from the timeline: a war fires once
 * ever, a holiday fires once per year forever, and the failure mode is a feed
 * that reads out Republic Day forty times in a row. These pin the once-per-year
 * rule, the years before a holiday exists, and the fact that a reload cannot
 * farm the mood bonus.
 */

function at(year: number, fraction: number): number {
  return (year - START_YEAR + fraction) * SECONDS_PER_YEAR * 1000;
}

function gameAt(year: number, fraction: number): GameState {
  const game = createGameState(hashSeed('rituals'), 0);
  game.playedMs = at(year, fraction);
  return game;
}

const ritual = (id: string) => RITUALS.find((r) => r.id === id);

describe('which days the city keeps', () => {
  it('finds a holiday when the city is standing in it', () => {
    const republic = ritual('republic-day');
    expect(republic).toBeDefined();
    const game = gameAt(1960, (republic as { at: number }).at);
    const today = ritualsNow(game);
    expect(today.map((t) => t.ritual.id)).toContain('republic-day');
  });

  it('finds nothing on an ordinary day', () => {
    // Deliberately between every window: mid-June is nobody's holiday here.
    const game = gameAt(1960, 0.46);
    expect(ritualsNow(game)).toHaveLength(0);
    expect(ritualHappiness(game)).toBe(0);
  });

  it('does not celebrate a republic before there is one', () => {
    const republic = ritual('republic-day') as { at: number; from?: number };
    expect(republic.from).toBeGreaterThan(START_YEAR);
    const early = gameAt(1905, republic.at);
    expect(ritualsNow(early).map((t) => t.ritual.id)).not.toContain('republic-day');
    const later = gameAt(1930, republic.at);
    expect(ritualsNow(later).map((t) => t.ritual.id)).toContain('republic-day');
  });

  it('keeps the new year across the turn of the year, not twice', () => {
    // The window straddles December and January; measured the long way round it
    // would be two half-holidays with an ordinary week in the middle.
    const before = ritualsNow(gameAt(1960, 0.995));
    const after = ritualsNow(gameAt(1961, 0.005));
    expect(before.map((t) => t.ritual.id)).toContain('new-year');
    expect(after.map((t) => t.ritual.id)).toContain('new-year');
  });

  it('fades in and out rather than switching on', () => {
    const day = (ritual('childrens-day') as { at: number }).at;
    const middle = ritualsNow(gameAt(1960, day))[0];
    const edge = ritualsNow(gameAt(1960, day + RITUAL_WINDOW * 0.9))[0];
    expect(middle?.strength).toBeCloseTo(1, 5);
    expect(edge?.strength).toBeGreaterThan(0);
    expect(edge?.strength).toBeLessThan(0.2);
  });
});

describe('what a holiday is worth', () => {
  it('lifts the mood while it lasts and not after', () => {
    const day = (ritual('childrens-day') as { at: number }).at;
    expect(ritualHappiness(gameAt(1960, day))).toBeGreaterThan(0);
    expect(ritualHappiness(gameAt(1960, day + RITUAL_WINDOW * 2))).toBe(0);
  });

  it('cannot be farmed by reloading', () => {
    // The bonus is derived from the date, so asking twice gives the same answer
    // rather than paying twice — which is the entire reason it is not granted
    // when the holiday fires.
    const day = (ritual('republic-day') as { at: number }).at;
    const game = gameAt(1960, day);
    const first = ritualHappiness(game);
    const second = ritualHappiness(game);
    expect(second).toBe(first);
  });
});

describe('announcing them', () => {
  it('reads a holiday out once, however often it is asked', () => {
    const day = (ritual('republic-day') as { at: number }).at;
    const game = gameAt(1960, day);
    const announced = new Set<string>();

    expect(drainRituals(game, announced).map((t) => t.ritual.id)).toContain('republic-day');
    // Twenty sim steps inside the same window: the feed must stay quiet.
    for (let step = 0; step < 20; step++) {
      game.playedMs = at(1960, day + step * 0.0005);
      expect(drainRituals(game, announced)).toHaveLength(0);
    }
  });

  it('reads it out again the following year', () => {
    const day = (ritual('republic-day') as { at: number }).at;
    const announced = new Set<string>();
    const game = gameAt(1960, day);
    drainRituals(game, announced);

    game.playedMs = at(1961, day);
    expect(drainRituals(game, announced).map((t) => t.ritual.id)).toContain('republic-day');
  });

  it('does not accumulate a set of every holiday of the century', () => {
    const announced = new Set<string>();
    const game = createGameState(hashSeed('rituals'), 0);
    for (let year = 1900; year < 2000; year++) {
      for (const r of RITUALS) {
        game.playedMs = at(year, r.at);
        drainRituals(game, announced);
      }
    }
    // A hundred years of four holidays would be four hundred keys; pruning keeps
    // it to roughly the last two years' worth.
    expect(announced.size).toBeLessThanOrEqual(RITUALS.length * 3);
  });
});

describe('the table itself', () => {
  it('places every ritual inside a year', () => {
    for (const r of RITUALS) {
      expect(r.at).toBeGreaterThanOrEqual(0);
      expect(r.at).toBeLessThan(1);
      expect(r.happiness).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });

  it('keeps the windows from overlapping', () => {
    // Two holidays at once would double the mood bonus and stack two lines in
    // the feed, which is a balance question disguised as a table.
    const sorted = [...RITUALS].sort((a, b) => a.at - b.at);
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i] as { at: number }).at - (sorted[i - 1] as { at: number }).at;
      expect(gap).toBeGreaterThan(RITUAL_WINDOW * 2);
    }
  });

  it('leaves most of the year an ordinary working day', () => {
    // The check the overlap test does not make. Windows that clear each other
    // can still cover the whole calendar between them, and a mood bonus that is
    // nearly always on is not a holiday — it is a higher baseline with flags on.
    let onHoliday = 0;
    const samples = 500;
    const game = createGameState(hashSeed('rituals'), 0);
    for (let step = 0; step < samples; step++) {
      game.playedMs = at(1960, step / samples);
      if (ritualsNow(game).length > 0) onHoliday++;
    }
    expect(onHoliday / samples).toBeLessThan(0.25);
  });
});
