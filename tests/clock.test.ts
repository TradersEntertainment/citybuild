import { describe, expect, it } from 'vitest';
import { Clock } from '../src/sim/clock';

describe('Clock', () => {
  it('emits one sim tick per 200 ms at 5 Hz', () => {
    const clock = new Clock();
    expect(clock.advance(200).simTicks).toBe(1);
    expect(clock.advance(199).simTicks).toBe(0);
    expect(clock.advance(1).simTicks).toBe(1);
  });

  it('carries the remainder instead of losing it', () => {
    const clock = new Clock();
    let ticks = 0;
    for (let i = 0; i < 60; i++) ticks += clock.advance(16.6667).simTicks;
    // 60 frames × 16.67 ms = 1000 ms = five 200 ms steps.
    expect(ticks).toBe(5);
  });

  it('runs economy at 1 Hz alongside sim at 5 Hz', () => {
    const clock = new Clock();
    const budget = clock.advance(1000);
    expect(budget.simTicks).toBe(5);
    expect(budget.economyTicks).toBe(1);
  });

  it('drops time beyond the catch-up ceiling rather than replaying it', () => {
    const clock = new Clock({ maxCatchUpMs: 1000 });
    const budget = clock.advance(30_000);
    expect(budget.simTicks).toBe(5);
    expect(budget.droppedMs).toBe(29_000);
  });

  it('ignores non-positive and non-finite deltas', () => {
    const clock = new Clock();
    expect(clock.advance(0).simTicks).toBe(0);
    expect(clock.advance(-50).simTicks).toBe(0);
    expect(clock.advance(Number.NaN).simTicks).toBe(0);
  });

  it('reports interpolation alpha inside a step', () => {
    const clock = new Clock();
    clock.advance(100);
    expect(clock.alpha()).toBeCloseTo(0.5, 5);
  });
});
