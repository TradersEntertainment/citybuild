import { describe, expect, it } from 'vitest';
import { Clock, CLOCK_SPEEDS, type ClockSpeed } from '../src/sim/clock';

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

/**
 * Speed control.
 *
 * The complaint being answered is that the night is a third of every year and
 * there was nothing to do but wait it out. The load-bearing property is the
 * second test: a pause must not bank time. If it did, pausing would become a way
 * to store up a burst of free simulation and release it in one frame, which is
 * both an exploit and — because a hundred sim steps land at once — a stutter.
 */
describe('clock speed', () => {
  it('starts at real time', () => {
    expect(new Clock().currentSpeed).toBe(1);
  });

  it('banks nothing while paused', () => {
    const clock = new Clock();
    clock.setSpeed(0);
    for (let i = 0; i < 100; i++) {
      const budget = clock.advance(200);
      expect(budget.simTicks).toBe(0);
      expect(budget.economyTicks).toBe(0);
      expect(budget.droppedMs).toBe(0);
    }
    expect(clock.playedMs).toBe(0);
    // Resuming starts from now, not from the twenty seconds that went past.
    clock.setSpeed(1);
    expect(clock.advance(200).simTicks).toBe(1);
  });

  it('freezes the calendar while paused', () => {
    const clock = new Clock();
    clock.advance(1000);
    const at = clock.playedMs;
    clock.setSpeed(0);
    clock.advance(5000);
    expect(clock.playedMs).toBe(at);
  });

  it('runs four times the steps at four times the speed', () => {
    const slow = new Clock();
    const fast = new Clock();
    fast.setSpeed(4);
    let slowTicks = 0;
    let fastTicks = 0;
    // 25 ms frames for a whole second, which is a whole number of 200 ms steps
    // at both speeds. Pick a frame length that leaves a remainder and the ratio
    // is only approximately four, because each clock floors its own leftover.
    for (let i = 0; i < 40; i++) {
      slowTicks += slow.advance(25).simTicks;
      fastTicks += fast.advance(25).simTicks;
    }
    expect(slowTicks).toBe(5);
    expect(fastTicks).toBe(20);
    expect(fast.playedMs).toBeCloseTo(slow.playedMs * 4, 6);
  });

  it('runs half the steps at half the speed', () => {
    const clock = new Clock();
    clock.setSpeed(0.5);
    // 400 ms of real time is 200 ms of city, which is exactly one step.
    expect(clock.advance(400).simTicks).toBe(1);
  });

  it('applies the speed after the catch-up ceiling, not before it', () => {
    // A backgrounded tab must not come back to a multi-second freeze multiplied
    // by four. The ceiling is about real time; the speed is about the city.
    const clock = new Clock({ maxCatchUpMs: 1000 });
    clock.setSpeed(4);
    const budget = clock.advance(30_000);
    expect(budget.simTicks).toBe(20);
    expect(budget.droppedMs).toBe(29_000);
  });

  it('cycles through every speed and comes back round', () => {
    const clock = new Clock();
    const seen: ClockSpeed[] = [];
    for (let i = 0; i < CLOCK_SPEEDS.length; i++) {
      clock.setSpeed(clock.nextSpeed());
      seen.push(clock.currentSpeed);
    }
    // Every speed on offer is reachable from the button, and one more press is
    // back where it started — a cycling control that skips a value or dead-ends
    // is worse than no control.
    expect([...seen].sort((a, b) => a - b)).toEqual([...CLOCK_SPEEDS]);
    expect(clock.currentSpeed).toBe(1);
  });

  it('goes faster before it offers to go slower', () => {
    // A player reaching for this wants the night over with. Pause is last.
    const clock = new Clock();
    expect(clock.nextSpeed()).toBe(2);
    clock.setSpeed(2);
    expect(clock.nextSpeed()).toBe(4);
    clock.setSpeed(0.5);
    expect(clock.nextSpeed()).toBe(0);
  });
});
