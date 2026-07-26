import { describe, expect, it } from 'vitest';
import { SEASON_FARM_YIELD, SNOW_PEAK, SNOW_SPAN } from '../src/data/balance';
import { SECONDS_PER_YEAR, START_YEAR } from '../src/data/timeline';
import { computeLedger } from '../src/sim/economy';
import { createFields } from '../src/sim/fields';
import { hashSeed } from '../src/sim/rng';
import {
  farmSeasonMultiplier,
  seasonBlend,
  seasonOf,
  SEASONS,
  snowAmount,
  yearFraction,
} from '../src/sim/seasons';
import { createGameState, type GameState } from '../src/sim/state';
import { yearOf } from '../src/sim/timeline';
import { index } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * The year going round (Paket 3 §8).
 *
 * Pinned to the calendar year on the top bar, so "1929" and "winter" mean the
 * same forty seconds on every device. These check that pinning, the blend that
 * stops the ground changing colour in one frame, and the one place a season is
 * allowed to reach the ledger.
 */

/** Milliseconds of played time at a fraction through the given year. */
function at(year: number, fraction = 0): number {
  return (year - START_YEAR + fraction) * SECONDS_PER_YEAR * 1000;
}

describe('where in the year the city is', () => {
  it('opens in January, so a new city starts in winter', () => {
    expect(yearFraction(0)).toBe(0);
    expect(seasonOf(0)).toBe('winter');
  });

  it('runs the four seasons in calendar order inside one year', () => {
    const seen = [0.05, 0.3, 0.55, 0.8].map((f) => seasonOf(at(START_YEAR, f)));
    expect(seen).toEqual(['winter', 'spring', 'summer', 'autumn']);
  });

  it('stays in step with the year badge for a century', () => {
    // A drift here is the failure that matters: the bar would say 1955 while the
    // ground said something else, and no amount of pretty tinting survives that.
    for (const year of [1900, 1914, 1955, 1999, 2050, 2075]) {
      const ms = at(year, 0.4);
      expect(yearOf(ms)).toBe(year);
      expect(seasonOf(ms)).toBe('spring');
      expect(yearFraction(ms)).toBeCloseTo(0.4, 6);
    }
  });

  it('never reports a season outside the four', () => {
    for (let step = 0; step < 400; step++) {
      const ms = (step / 7) * SECONDS_PER_YEAR * 1000;
      expect(SEASONS).toContain(seasonOf(ms));
    }
  });

  it('treats time before the founding as the founding', () => {
    // Never happens in play, and a negative modulo would silently produce a
    // fifth season if it did.
    expect(seasonOf(-5_000)).toBe('winter');
    expect(yearFraction(-5_000)).toBe(0);
  });
});

describe('the blend between them', () => {
  it('names the next season and how far along the city is', () => {
    const start = seasonBlend(at(START_YEAR, 0.25));
    expect(start.season).toBe('spring');
    expect(start.next).toBe('summer');
    expect(start.t).toBeCloseTo(0, 6);

    const late = seasonBlend(at(START_YEAR, 0.49));
    expect(late.season).toBe('spring');
    expect(late.t).toBeGreaterThan(0.9);
  });

  it('wraps from the last season back to the first', () => {
    const end = seasonBlend(at(START_YEAR, 0.99));
    expect(end.season).toBe('autumn');
    expect(end.next).toBe('winter');
  });

  it('moves continuously, so nothing changes colour in one frame', () => {
    let previous = farmSeasonMultiplier(0);
    for (let step = 1; step <= 800; step++) {
      const ms = (step / 200) * SECONDS_PER_YEAR * 1000;
      const now = farmSeasonMultiplier(ms);
      // A whole year in two hundred steps: no single step may jump more than a
      // fraction, or the ground and the ledger would both flicker.
      expect(Math.abs(now - previous)).toBeLessThan(0.06);
      previous = now;
    }
  });
});

describe('what the calendar does to a harvest', () => {
  it('takes a bite out of winter and gives it back in summer', () => {
    expect(farmSeasonMultiplier(at(START_YEAR, 0.0))).toBeLessThan(1);
    expect(farmSeasonMultiplier(at(START_YEAR, 0.6))).toBeGreaterThan(1);
    expect(SEASON_FARM_YIELD.winter).toBeLessThan(SEASON_FARM_YIELD.summer);
  });

  it('leaves a farm slightly better off across a whole year, not worse', () => {
    // The calendar is meant to add texture, not to quietly nerf farming.
    let total = 0;
    const samples = 400;
    for (let step = 0; step < samples; step++) {
      total += farmSeasonMultiplier((step / samples) * SECONDS_PER_YEAR * 1000);
    }
    expect(total / samples).toBeGreaterThan(1);
    expect(total / samples).toBeLessThan(1.1);
  });

  it('reaches the ledger', () => {
    const winter = farmingGame(at(START_YEAR, 0.02));
    const summer = farmingGame(at(START_YEAR, 0.6));
    const fields = createFields(winter.world.size);
    const cold = computeLedger(winter, fields).farmYield;
    const warm = computeLedger(summer, fields).farmYield;
    expect(cold).toBeGreaterThan(0);
    expect(warm).toBeGreaterThan(cold);
  });
});

describe('the snow', () => {
  it('lies deepest in the depth of winter and nowhere near summer', () => {
    expect(snowAmount(at(START_YEAR, SNOW_PEAK))).toBeCloseTo(1, 5);
    expect(snowAmount(at(START_YEAR, 0.5))).toBe(0);
    expect(snowAmount(at(START_YEAR, 0.75))).toBe(0);
  });

  it('arrives and leaves gradually', () => {
    const edge = snowAmount(at(START_YEAR, SNOW_PEAK + SNOW_SPAN * 0.9));
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(0.1);
  });

  it('wraps around the turn of the year rather than stopping at it', () => {
    // The peak is in late January, so December has to be snowy — a naive
    // distance to the peak would say the year's last day is as far from winter
    // as it is possible to get.
    expect(snowAmount(at(START_YEAR, 0.97))).toBeGreaterThan(0);
  });

  it('stays inside 0..1 all year', () => {
    for (let step = 0; step < 500; step++) {
      const value = snowAmount((step / 500) * SECONDS_PER_YEAR * 1000);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

/** A city with real farmland on it, at a given moment in the year. */
function farmingGame(playedMs: number): GameState {
  const game = createGameState(hashSeed('seasons'), 0);
  game.playedMs = playedMs;
  const centre = 168;
  for (let y = centre - 3; y <= centre + 3; y++) {
    for (let x = centre - 3; x <= centre + 3; x++) {
      const i = index(game.world, x, y);
      game.world.height[i] = 0.6;
      game.world.fertility[i] = 0.8;
      game.world.terrain[i] = 2;
      game.world.road[i] = 0;
    }
  }
  const patch = [];
  for (let y = centre - 2; y <= centre + 2; y++) {
    for (let x = centre - 2; x <= centre + 2; x++) patch.push({ x, y });
  }
  paintZone(game.world, patch, 'farm', 100_000);
  // The ledger counts the zone column rather than the state field, so the field
  // has to be brought in step the way the building pass would.
  game.farmTiles = patch.length;
  return game;
}
