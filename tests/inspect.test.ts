import { beforeEach, describe, expect, it } from 'vitest';
import {
  DENSE_SERVICE_GATE,
  OFFICE_SCHOOLING_GATE,
  ZONE_LEVEL_CAP,
} from '../src/data/balance';
import type { Level } from '../src/data/buildings';
import type { Building } from '../src/sim/buildings';
import { buildingAt, inspectBuilding } from '../src/sim/inspect';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { index, startingCentre } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * The building inspector (§14): the growth loop's gates, read back as reasons.
 *
 * The contract under test is honesty. Every blocker this file can name is a
 * gate that really exists in sim/buildings.ts, reported in the order the
 * growth pass hits them — because a card that says "needs schools" when the
 * building is actually stuck on services sends the player off to build the
 * wrong thing, which is worse than saying nothing.
 */
let game: GameState;
let origin: { x: number; y: number };

function put(over: Partial<Building> & { x: number; y: number }): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    w: 1,
    h: 1,
    zone: 'res',
    level: 1,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: 6,
    jobs: 0,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id,
    ...over,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, building.x, building.y)] = id;
  return building;
}

/** Full coverage at the tile, so the service gate is not what fires. */
function cover(x: number, y: number): void {
  game.world.serviceMask[index(game.world, x, y)] = 0xff;
}

/** A workforce that has (or has not) been to school, forced directly. */
function school(share: number): void {
  const { people, schooled } = game.cohorts;
  people[1] = 100;
  people[2] = 100;
  schooled[1] = 100 * share;
  schooled[2] = 100 * share;
}

beforeEach(() => {
  game = createGameState(hashSeed('inspect'), 0);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x), y: Math.floor(centre.y) };
  game.money = 1_000_000;
  game.era = 'city';
  game.demand.res = 0.8;
  game.demand.office = 0.8;
});

describe('the reasons a building gives', () => {
  it('a suburb at its ceiling asks for dense zoning', () => {
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'res', 1e9);
    const b = put({ x: origin.x, y: origin.y, level: ZONE_LEVEL_CAP as Level });
    cover(b.x, b.y);
    const report = inspectBuilding(game, b);
    expect(report.blockers[0]).toBe('denseZoning');
    expect(report.maxed).toBe(false);
    expect(report.cap).toBe(ZONE_LEVEL_CAP);
  });

  it('a dense block past three needs the era\'s services', () => {
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'res', 1e9, true);
    const b = put({ x: origin.x, y: origin.y, level: 4 });
    // No coverage at all: well under DENSE_SERVICE_GATE at the city era.
    const report = inspectBuilding(game, b);
    expect(report.blockers[0]).toBe('services');
    expect(DENSE_SERVICE_GATE).toBeGreaterThan(0);
  });

  it('an office without graduates names the schools', () => {
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'office', 1e9);
    const b = put({ x: origin.x, y: origin.y, zone: 'office', level: 1, jobs: 4, population: 0 });
    cover(b.x, b.y);
    school(0);
    expect(inspectBuilding(game, b).blockers[0]).toBe('schools');
    school(OFFICE_SCHOOLING_GATE + 0.1);
    expect(inspectBuilding(game, b).blockers).not.toContain('schools');
  });

  it('a tower at the top of dense ground is finished, not blocked', () => {
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'res', 1e9, true);
    const b = put({ x: origin.x, y: origin.y, level: 5 });
    cover(b.x, b.y);
    const report = inspectBuilding(game, b);
    expect(report.maxed).toBe(true);
    expect(report.blockers).toHaveLength(0);
  });

  it('a low score names what a player can act on, pollution before all', () => {
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'res', 1e9);
    const b = put({ x: origin.x, y: origin.y, level: 1, score: 0.2 });
    cover(b.x, b.y);
    game.demand.res = 0.05;
    game.world.pollution[index(game.world, b.x, b.y)] = 60;
    const report = inspectBuilding(game, b);
    expect(report.blockers).toContain('demand');
    expect(report.blockers).toContain('pollution');
  });

  it('a dying building says so before anything else, even at a cap', () => {
    // The growth pass runs its decay branch before the cap's early return, so
    // the card must too: "just needs dense zoning" about a block currently
    // losing floors sends the player shopping while the house burns.
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'res', 1e9);
    const b = put({ x: origin.x, y: origin.y, level: ZONE_LEVEL_CAP as Level, score: 0.1 });
    const report = inspectBuilding(game, b);
    expect(report.blockers[0]).toBe('decay');
    expect(report.blockers[0]).not.toBe('denseZoning');
  });

  it('never says "growing" about a building pinned under the bar', () => {
    // Below the spawn threshold with no single nameable cause: the first draft
    // answered "no problem, it will grow", which was a lie. The generic
    // 'stalled' is the honest floor under the specific reasons.
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'res', 1e9);
    const b = put({ x: origin.x, y: origin.y, level: 1, score: 0.4 });
    cover(b.x, b.y);
    game.demand.res = 0.8; // demand fine, air clean, services full…
    const report = inspectBuilding(game, b);
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers).toContain('stalled');
  });

  it('a healthy growing building has nothing to complain about', () => {
    paintZone(game.world, [{ x: origin.x, y: origin.y }], 'res', 1e9);
    const b = put({ x: origin.x, y: origin.y, level: 2, score: 0.7 });
    cover(b.x, b.y);
    const report = inspectBuilding(game, b);
    expect(report.blockers).toHaveLength(0);
    expect(report.maxed).toBe(false);
  });

  it('counts people for housing and desks for work', () => {
    const home = put({ x: origin.x, y: origin.y, population: 9 });
    const office = put({
      x: origin.x + 1,
      y: origin.y,
      zone: 'office',
      jobs: 12,
      population: 0,
      output: 340,
    });
    expect(inspectBuilding(game, home).occupants).toBe(9);
    expect(inspectBuilding(game, home).outputPerMinute).toBe(0);
    expect(inspectBuilding(game, office).occupants).toBe(12);
    expect(inspectBuilding(game, office).outputPerMinute).toBe(340);
  });
});

describe('what a tap finds', () => {
  it('the building on the tile, nothing on bare ground, null off the map', () => {
    const b = put({ x: origin.x, y: origin.y });
    expect(buildingAt(game, b.x, b.y)?.id).toBe(b.id);
    expect(buildingAt(game, b.x + 3, b.y)).toBeNull();
    expect(buildingAt(game, -1, 4)).toBeNull();
    expect(buildingAt(game, game.world.size, 4)).toBeNull();
  });

  it('a stale tile pointer does not resurrect a demolished building', () => {
    const b = put({ x: origin.x, y: origin.y });
    game.buildings.delete(b.id); // demolished; the column not yet swept
    expect(buildingAt(game, b.x, b.y)).toBeNull();
  });
});
