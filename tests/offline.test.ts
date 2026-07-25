import { describe, expect, it } from 'vitest';
import { OFFLINE_CAP_HOURS } from '../src/data/balance';
import { creditAwayTime, offlineEfficiencyAt, splitDuration } from '../src/sim/offline';

const HOUR = 3_600_000;

describe('offline crediting', () => {
  it('pays full rate for the first two hours', () => {
    const away = creditAwayTime(0, 2 * HOUR);
    expect(away.efficiency).toBeCloseTo(1, 6);
    expect(away.effectiveMs).toBeCloseTo(2 * HOUR, 6);
  });

  it('bands the rate down over a long absence rather than applying one rate', () => {
    const away = creditAwayTime(0, 8 * HOUR);
    // 2h at 100% + 6h at 60% = 5.6h effective.
    expect(away.effectiveMs).toBeCloseTo(5.6 * HOUR, 6);
    expect(away.efficiency).toBeCloseTo(0.7, 6);
  });

  it('caps credited time at 14 hours', () => {
    const away = creditAwayTime(0, 40 * HOUR);
    expect(away.creditedMs).toBe(OFFLINE_CAP_HOURS * HOUR);
    expect(away.rawMs).toBe(40 * HOUR);
    // 2h×1.0 + 6h×0.6 + 6h×0.35 = 7.7h
    expect(away.effectiveMs).toBeCloseTo(7.7 * HOUR, 6);
  });

  it('earns nothing past the ceiling', () => {
    expect(offlineEfficiencyAt(0)).toBe(1);
    expect(offlineEfficiencyAt(3)).toBe(0.6);
    expect(offlineEfficiencyAt(10)).toBe(0.35);
    expect(offlineEfficiencyAt(14)).toBe(0);
    expect(offlineEfficiencyAt(100)).toBe(0);
  });

  it('never credits negative time from a clock that moved backwards', () => {
    const away = creditAwayTime(5 * HOUR, 1 * HOUR);
    expect(away.rawMs).toBe(0);
    expect(away.effectiveMs).toBe(0);
  });

  it('splits a duration for the chronicle header', () => {
    expect(splitDuration(8 * HOUR + 12 * 60_000)).toEqual({ hours: 8, minutes: 12 });
    expect(splitDuration(45 * 60_000)).toEqual({ hours: 0, minutes: 45 });
  });
});
