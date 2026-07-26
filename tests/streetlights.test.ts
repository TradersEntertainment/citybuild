import { describe, expect, it } from 'vitest';
import { START_YEAR } from '../src/data/timeline';
import { LAMPS, lampFor } from '../src/render3d/streetlights';

/**
 * The lamps are render-side, so most of that file is not the kind of thing a
 * unit test can speak about. Which lamp burns in which year is: it is a table,
 * it is read by year, and getting it wrong lights a 1910 street with LED.
 */
describe('what is burning on the street', () => {
  it('gives the founding city gaslight', () => {
    const lamp = lampFor(START_YEAR);
    expect(lamp.colour).toBe(LAMPS[0]!.colour);
  });

  it('has changed by the time the city is modern', () => {
    expect(lampFor(2060).colour).not.toBe(lampFor(START_YEAR).colour);
  });

  it('never goes backwards as the century runs', () => {
    let last = -1;
    for (let year = 1850; year <= 2100; year++) {
      const rank = LAMPS.indexOf(lampFor(year));
      expect(rank).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });

  it('gets brighter as the technology does', () => {
    for (let i = 1; i < LAMPS.length; i++) {
      expect(LAMPS[i]!.intensity).toBeGreaterThan(LAMPS[i - 1]!.intensity);
      expect(LAMPS[i]!.from).toBeGreaterThan(LAMPS[i - 1]!.from);
    }
  });

  it('answers for a year before the table starts rather than returning nothing', () => {
    // yearOf() cannot produce this, but a lamp lookup that can return undefined
    // is one an era restyle would trip over later.
    expect(lampFor(1000)).toBeDefined();
    expect(lampFor(9999)).toBeDefined();
  });
});
