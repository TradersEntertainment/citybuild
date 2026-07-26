import { ECONOMY_TICK_HZ, MAX_CATCH_UP_MS, SIM_TICK_HZ } from '../data/balance';

/**
 * Fixed-timestep clock (§11). Pure: it never touches rAF, performance, or
 * Date — callers feed it elapsed milliseconds, which keeps it deterministic
 * and testable, and lets the offline path reuse the same accounting.
 */
export interface TickBudget {
  /** Sim steps to run this frame. */
  simTicks: number;
  /** Economy steps to run this frame (subset cadence of sim). */
  economyTicks: number;
  /** Wall-clock time skipped because it exceeded the catch-up ceiling. */
  droppedMs: number;
}

export interface ClockOptions {
  simHz?: number;
  economyHz?: number;
  maxCatchUpMs?: number;
}

/**
 * How fast the city lives, as a multiple of real time.
 *
 * Zero is a genuine pause: no sim step, no economy step, no played time. The
 * others are whole numbers on purpose — a fractional speed makes the calendar
 * drift against anything a player counts in years, and the whole reason to
 * offer speed is so a player can skip a long night or slow a busy one down.
 */
export const CLOCK_SPEEDS = [0, 0.5, 1, 2, 4] as const;
export type ClockSpeed = (typeof CLOCK_SPEEDS)[number];

export class Clock {
  readonly simStepMs: number;
  readonly economyStepMs: number;
  private readonly maxCatchUpMs: number;
  private simAccumulator = 0;
  private economyAccumulator = 0;
  private elapsedMs = 0;
  private simTickCount = 0;
  private speed: ClockSpeed = 1;

  constructor(options: ClockOptions = {}) {
    this.simStepMs = 1000 / (options.simHz ?? SIM_TICK_HZ);
    this.economyStepMs = 1000 / (options.economyHz ?? ECONOMY_TICK_HZ);
    this.maxCatchUpMs = options.maxCatchUpMs ?? MAX_CATCH_UP_MS;
  }

  /**
   * Feed one frame's wall-clock delta, get the steps to run. Deltas beyond the
   * catch-up ceiling are reported as dropped rather than replayed, so a
   * backgrounded tab does not return to a multi-second freeze — that gap
   * belongs to the offline system instead.
   */
  advance(deltaMs: number): TickBudget {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return { simTicks: 0, economyTicks: 0, droppedMs: 0 };
    }
    // A pause is a pause: nothing accumulates, so resuming does not replay the
    // time the city stood still. Anything else would make pausing a way to bank
    // a burst of free simulation.
    if (this.speed === 0) return { simTicks: 0, economyTicks: 0, droppedMs: 0 };

    let droppedMs = 0;
    let usableMs = deltaMs;
    if (usableMs > this.maxCatchUpMs) {
      droppedMs = usableMs - this.maxCatchUpMs;
      usableMs = this.maxCatchUpMs;
    }

    // The ceiling is applied to real time and the speed after it, so asking for
    // four times speed genuinely runs four times the steps rather than being
    // clipped by a limit meant for a backgrounded tab.
    usableMs *= this.speed;
    this.elapsedMs += usableMs;
    this.simAccumulator += usableMs;
    this.economyAccumulator += usableMs;

    const simTicks = Math.floor(this.simAccumulator / this.simStepMs);
    this.simAccumulator -= simTicks * this.simStepMs;
    this.simTickCount += simTicks;

    const economyTicks = Math.floor(this.economyAccumulator / this.economyStepMs);
    this.economyAccumulator -= economyTicks * this.economyStepMs;

    return { simTicks, economyTicks, droppedMs };
  }

  /** How fast the city is living. */
  get currentSpeed(): ClockSpeed {
    return this.speed;
  }

  setSpeed(speed: ClockSpeed): void {
    this.speed = speed;
  }

  /**
   * The next speed in the cycle, for a single button to walk through.
   *
   * Runs upward and puts the pause last, because a player reaching for this
   * control usually wants the night to go faster and only occasionally wants it
   * to stop.
   */
  nextSpeed(): ClockSpeed {
    const order: readonly ClockSpeed[] = [1, 2, 4, 0.5, 0];
    const at = order.indexOf(this.speed);
    return order[(at + 1) % order.length] as ClockSpeed;
  }

  /** Fraction of the way into the next sim step, for render interpolation. */
  alpha(): number {
    return this.simAccumulator / this.simStepMs;
  }

  /** Sim time consumed so far, excluding dropped gaps. */
  get playedMs(): number {
    return this.elapsedMs;
  }

  get ticks(): number {
    return this.simTickCount;
  }

  /** Called after a visibility gap so the next frame starts from zero. */
  resetAccumulators(): void {
    this.simAccumulator = 0;
    this.economyAccumulator = 0;
  }
}
