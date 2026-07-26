import { beforeEach, describe, expect, it } from 'vitest';
import { OFFLINE_CAP_HOURS, OFFLINE_MIN_REPORT_MS } from '../src/data/balance';
import type { TilePoint } from '../src/input/pathGeometry';
import {
  applyOfflineProgress,
  cityAtAGlance,
  creditAwayTime,
  offlineEfficiencyAt,
  splitDuration,
} from '../src/sim/offline';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE } from '../src/sim/tiles';
import { index, startingCentre, type World } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * These fixtures predate the national highway; a motorway through the working
 * area would move every figure they measure. With the highway stripped there
 * is no "abroad" to be cut off from, so every street connects (§6.1).
 */
function stripHighway(world: World): void {
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

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

/**
 * The banding above was measured correctly from Phase 0 and then thrown away —
 * the result only ever reached playedMs. A city that stands perfectly still
 * while its clock runs is the one thing an idle game may not do.
 */
let game: GameState;
let systems: Systems;
let origin: { x: number; y: number };

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.fertility[i] = 0.3;
      state.world.terrain[i] = 2;
    }
  }
}

function row(length: number, dy: number): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

/** A small working city: homes, shops, somewhere to work, all fronting a road. */
function seedCity(seconds: number): void {
  buildRoad(game.world, row(24, 0), 'path', 1_000_000);
  paintZone(game.world, row(24, 1), 'res', 1_000_000);
  paintZone(game.world, row(24, 2), 'res', 1_000_000);
  paintZone(game.world, row(24, -1), 'com', 1_000_000);
  paintZone(game.world, row(24, -2), 'ind', 1_000_000);
  systems.invalidateFields();
  for (let s = 0; s < seconds; s++) {
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
}

function freshCity(seconds: number): void {
  game = createGameState(hashSeed('offline'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  game.money = 200_000;
  systems = new Systems(game.world.size);
  seedCity(seconds);
}

beforeEach(() => {
  freshCity(0);
});

describe('what the city does while nobody is watching', () => {
  it('earns, which is the whole reason to come back', () => {
    freshCity(180);
    const before = game.money;
    const report = applyOfflineProgress(game, systems, creditAwayTime(0, 2 * HOUR));

    expect(game.money).toBeGreaterThan(before);
    expect(report.moneyEarned).toBeCloseTo(game.money - before, 5);
  });

  it('grows, rather than only banking the rent', () => {
    freshCity(60);
    const before = game.population;
    applyOfflineProgress(game, systems, creditAwayTime(0, 2 * HOUR));
    expect(game.population).toBeGreaterThan(before);
  });

  it('lands close to the same hour lived a second at a time', () => {
    freshCity(300);
    applyOfflineProgress(game, systems, creditAwayTime(0, HOUR));
    const caught = { money: game.money, population: game.population };

    // The same city again, this time actually living the hour. One hour is
    // inside the full-efficiency band, so the two are comparable. Hazards stay
    // off: chaos only strikes while somebody is watching, so an away-time
    // comparison that rolled dice would be measuring luck, not honesty.
    freshCity(300);
    for (let s = 0; s < 3600; s++) {
      systems.step(game, 1, false);
      systems.stepEconomy(game, 1);
    }

    // Within a tenth: close enough that the card is not telling a story the
    // simulation itself would not have produced.
    expect(caught.population).toBeGreaterThan(game.population * 0.9);
    expect(caught.population).toBeLessThan(game.population * 1.1);
    expect(caught.money).toBeGreaterThan(game.money * 0.9);
    expect(caught.money).toBeLessThan(game.money * 1.1);
  });

  it('pays a long absence less per hour than a short one', () => {
    freshCity(300);
    const two = applyOfflineProgress(game, systems, creditAwayTime(0, 2 * HOUR));

    freshCity(300);
    const day = applyOfflineProgress(game, systems, creditAwayTime(0, 24 * HOUR));

    expect(day.moneyEarned / 24).toBeLessThan(two.moneyEarned / 2);
    // But a whole day away is still worth more in total than two hours.
    expect(day.moneyEarned).toBeGreaterThan(two.moneyEarned);
  });

  it('advances the clock by the credited time, not the raw gap', () => {
    freshCity(60);
    const before = game.playedMs;
    const away = creditAwayTime(0, 24 * HOUR);
    applyOfflineProgress(game, systems, away);

    expect(game.playedMs - before).toBeCloseTo(away.effectiveMs, 5);
    expect(away.effectiveMs).toBeLessThan(away.rawMs);
  });

  it('does nothing at all when no time passed', () => {
    freshCity(60);
    const before = { money: game.money, population: game.population, played: game.playedMs };
    const report = applyOfflineProgress(game, systems, creditAwayTime(0, 0));

    expect(game.money).toBe(before.money);
    expect(game.population).toBe(before.population);
    expect(game.playedMs).toBe(before.played);
    expect(report.moneyEarned).toBe(0);
  });

  it('reports an era the city passed while away', () => {
    // Sixty seconds of live play already carries this city past the first
    // threshold, so the era to be crossed offline is the one after it.
    freshCity(60);
    const before = game.era;
    const report = applyOfflineProgress(game, systems, creditAwayTime(0, 4 * HOUR));
    expect(report.eraReached).not.toBeNull();
    expect(game.era).not.toBe(before);
  });
});

describe('what the returning card is allowed to say', () => {
  it('stays quiet about a glance at another tab', () => {
    freshCity(60);
    expect(applyOfflineProgress(game, systems, creditAwayTime(0, 20_000)).worthReporting).toBe(
      false,
    );
  });

  it('speaks up for a real absence', () => {
    freshCity(60);
    const report = applyOfflineProgress(game, systems, creditAwayTime(0, OFFLINE_MIN_REPORT_MS));
    expect(report.worthReporting).toBe(true);
  });

  it('still runs the city for the gap it did not report', () => {
    freshCity(120);
    const before = game.money;
    // Backgrounding a tab really does stop the frame loop, so even a short gap
    // is time the city is owed — it is just not worth a card.
    const quiet = applyOfflineProgress(game, systems, creditAwayTime(0, 30_000));
    expect(quiet.worthReporting).toBe(false);
    expect(game.money).toBeGreaterThan(before);
  });

  it('counts jobs and homes for its closing line', () => {
    freshCity(300);
    const glance = cityAtAGlance(game);
    expect(glance.housing).toBeGreaterThan(0);
    expect(glance.jobs).toBeGreaterThan(0);
  });
});
