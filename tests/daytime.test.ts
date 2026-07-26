import { describe, expect, it } from 'vitest';
import { DAYLIGHT_SHARE, SECONDS_PER_DAY } from '../src/data/balance';
import { SECONDS_PER_YEAR } from '../src/data/timeline';
import {
  dayFraction,
  dayPhase,
  daylightAmount,
  nightAmount,
  rushHour,
  streetActivity,
  sunHeight,
} from '../src/sim/daytime';

/**
 * The day is a function of played time and nothing else, so what is worth
 * testing is the shape of the curves — every layer that lights a window, dims a
 * lamp or spawns a pedestrian reads them, and a discontinuity anywhere shows up
 * as the whole city flickering at once.
 */
const DAY_MS = SECONDS_PER_DAY * 1000;

/** The cycle sampled evenly, for the properties that hold everywhere. */
function samples(count = 720): number[] {
  return Array.from({ length: count }, (_, i) => i / count);
}

describe('reading the clock', () => {
  it('starts the city at midnight', () => {
    expect(dayFraction(0)).toBe(0);
  });

  it('reaches noon halfway through', () => {
    expect(dayFraction(DAY_MS / 2)).toBeCloseTo(0.5, 6);
  });

  it('wraps rather than running off', () => {
    expect(dayFraction(DAY_MS * 3)).toBeCloseTo(0, 6);
    expect(dayFraction(DAY_MS * 3.25)).toBeCloseTo(0.25, 6);
  });

  it('never returns anything outside the day', () => {
    for (const ms of [0, 1, 999, DAY_MS - 1, DAY_MS * 1000 + 7]) {
      const f = dayFraction(ms);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('treats a clock that ran backwards as midnight rather than throwing', () => {
    expect(dayFraction(-5_000)).toBe(0);
  });

  it('runs one day to the year, so the sun agrees with the year badge', () => {
    // Three years inside one sunrise is the thing this avoids.
    expect(SECONDS_PER_DAY).toBe(SECONDS_PER_YEAR);
  });
});

describe('where the sun is', () => {
  it('is highest at noon and lowest at midnight', () => {
    expect(sunHeight(0.5)).toBeCloseTo(1, 3);
    expect(sunHeight(0)).toBeCloseTo(-1, 3);
  });

  it('is above the horizon for the share of the day it should be', () => {
    const lit = samples().filter((f) => sunHeight(f) > 0).length / samples().length;
    expect(lit).toBeCloseTo(DAYLIGHT_SHARE, 1);
  });

  it('moves smoothly — no step anywhere in the cycle', () => {
    const points = samples();
    let worst = 0;
    for (let i = 1; i < points.length; i++) {
      worst = Math.max(worst, Math.abs(sunHeight(points[i]!) - sunHeight(points[i - 1]!)));
    }
    // A jump would light the whole city at once, which reads as a bug.
    expect(worst).toBeLessThan(0.05);
  });

  it('is continuous across midnight, where the cycle wraps', () => {
    expect(Math.abs(sunHeight(0.999) - sunHeight(0.001))).toBeLessThan(0.05);
  });
});

describe('naming the time of day', () => {
  it('calls midnight night and noon day', () => {
    expect(dayPhase(0)).toBe('night');
    expect(dayPhase(0.5)).toBe('day');
  });

  it('finds a dawn before noon and a dusk after it', () => {
    const phases = samples(400).map((f) => ({ f, phase: dayPhase(f) }));
    expect(phases.some((p) => p.phase === 'dawn' && p.f < 0.5)).toBe(true);
    expect(phases.some((p) => p.phase === 'dusk' && p.f > 0.5)).toBe(true);
  });

  it('never calls anything by a name that is not a phase', () => {
    for (const f of samples()) {
      expect(['night', 'dawn', 'day', 'dusk']).toContain(dayPhase(f));
    }
  });
});

describe('what the lights answer to', () => {
  it('is fully dark at midnight and fully lit at noon', () => {
    expect(nightAmount(0)).toBe(1);
    expect(nightAmount(0.5)).toBe(0);
    expect(daylightAmount(0.5)).toBe(1);
    expect(daylightAmount(0)).toBe(0);
  });

  it('stays inside 0..1 everywhere', () => {
    for (const f of samples()) {
      expect(nightAmount(f)).toBeGreaterThanOrEqual(0);
      expect(nightAmount(f)).toBeLessThanOrEqual(1);
      expect(daylightAmount(f)).toBeGreaterThanOrEqual(0);
      expect(daylightAmount(f)).toBeLessThanOrEqual(1);
    }
  });

  it('has the lamps fully up well before the bottom of the night', () => {
    // A city half-lit until midnight looks broken rather than atmospheric.
    const dusk = samples(400).find((f) => f > 0.5 && nightAmount(f) >= 1);
    expect(dusk).toBeDefined();
    expect(dusk!).toBeLessThan(0.95);
  });

  it('overlaps sunlight and lamplight at dusk, which is the best minute', () => {
    const both = samples(400).filter((f) => nightAmount(f) > 0.05 && daylightAmount(f) > 0.05);
    expect(both.length).toBeGreaterThan(0);
  });
});

describe('when the streets are busy', () => {
  it('peaks twice a day', () => {
    const peaks = samples(400).filter((f) => rushHour(f) > 0.8);
    const morning = peaks.filter((f) => f < 0.5);
    const evening = peaks.filter((f) => f >= 0.5);
    expect(morning.length).toBeGreaterThan(0);
    expect(evening.length).toBeGreaterThan(0);
  });

  it('is quiet in the small hours', () => {
    expect(rushHour(0)).toBeLessThan(0.05);
  });

  it('leaves some traffic on the road even at the deadest hour', () => {
    // A road with nothing at all on it reads as a broken layer, not as 4am.
    expect(streetActivity(0)).toBeGreaterThan(0.1);
  });

  it('is busiest at rush hour and quietest at night', () => {
    const busiest = Math.max(...samples().map(streetActivity));
    expect(streetActivity(0)).toBeLessThan(busiest);
    expect(busiest).toBeLessThanOrEqual(1);
  });
});
