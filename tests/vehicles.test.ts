import { describe, expect, it } from 'vitest';
import { START_YEAR, FLYING_YEAR } from '../src/data/timeline';
import { VEHICLE_AGES, vehicleAgeFor } from '../src/data/vehicles';

/**
 * The traffic was the one thing that looked the same in 1905 and 2005 while
 * everything around it — the buildings, the streetlamps — aged. The table is
 * data, it is read by year, and getting it wrong puts a Model T on a 2060
 * street.
 */
describe('what is on the road', () => {
  it('starts the city with carts', () => {
    expect(vehicleAgeFor(START_YEAR).id).toBe('cart');
  });

  it('has motorised by the middle of the century', () => {
    expect(vehicleAgeFor(1950).id).not.toBe('cart');
  });

  it('is flying by the year the plan says it flies', () => {
    expect(vehicleAgeFor(FLYING_YEAR).id).toBe('flying');
  });

  it('never goes backwards as the century runs', () => {
    let last = -1;
    for (let year = 1850; year <= 2120; year++) {
      const rank = VEHICLE_AGES.indexOf(vehicleAgeFor(year));
      expect(rank).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });

  it('gets faster as it gets newer', () => {
    for (let i = 1; i < VEHICLE_AGES.length; i++) {
      expect(VEHICLE_AGES[i]!.speed).toBeGreaterThan(VEHICLE_AGES[i - 1]!.speed);
      expect(VEHICLE_AGES[i]!.from).toBeGreaterThan(VEHICLE_AGES[i - 1]!.from);
    }
  });

  it('leaves the modern car at the speed the roads were tuned against', () => {
    // Every road tier's capacity and every travel time was balanced with this
    // at one. Moving it would silently retune the whole traffic model.
    expect(vehicleAgeFor(1990).speed).toBe(1);
  });

  it('gives every age something to paint with', () => {
    for (const age of VEHICLE_AGES) {
      expect(age.paints.length).toBeGreaterThan(0);
      for (const paint of age.paints) {
        expect(paint).toBeGreaterThanOrEqual(0);
        expect(paint).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('keeps the early fleet dark, which is the period more than the shape is', () => {
    const early = vehicleAgeFor(1930);
    // Every early paint is nearly black; the spread arrives with mass production.
    const bright = early.paints.filter((p) => ((p >> 16) & 0xff) > 80).length;
    expect(bright).toBe(0);
    expect(vehicleAgeFor(1990).paints.length).toBeGreaterThan(early.paints.length);
  });

  it('answers for a year outside the table rather than returning nothing', () => {
    expect(vehicleAgeFor(1500)).toBeDefined();
    expect(vehicleAgeFor(9999).id).toBe('flying');
  });
});
