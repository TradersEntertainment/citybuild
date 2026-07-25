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

export class Clock {
  readonly simStepMs: number;
  readonly economyStepMs: number;
  private readonly maxCatchUpMs: number;
  private simAccumulator = 0;
  private economyAccumulator = 0;
  private elapsedMs = 0;
  private simTickCount = 0;

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

    let droppedMs = 0;
    let usableMs = deltaMs;
    if (usableMs > this.maxCatchUpMs) {
      droppedMs = usableMs - this.maxCatchUpMs;
      usableMs = this.maxCatchUpMs;
    }

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
