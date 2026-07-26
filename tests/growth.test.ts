import { beforeEach, describe, expect, it } from 'vitest';
import { LABOUR_PARTICIPATION } from '../src/data/balance';
import type { TilePoint } from '../src/input/pathGeometry';
import { totalBuildings } from '../src/sim/buildings';
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

/**
 * Long-horizon tests for the growth loop.
 *
 * The short integration tests can all pass on a city that is dead: three
 * seconds in, the first buildings have spawned, population is above zero and
 * tax is coming in — and then nothing ever happens again. These tests run for
 * simulated minutes and assert *progress*, which is the only thing that
 * distinguishes a game from a screensaver.
 */
let game: GameState;
let origin: { x: number; y: number };

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.fertility[i] = 0.3;
      state.world.terrain[i] = 2; // plain
    }
  }
}

function row(length: number, dy: number): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

/** Runs the sim for a number of simulated seconds at one-second steps. */
function run(systems: Systems, seconds: number): void {
  for (let second = 0; second < seconds; second++) {
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
}

/**
 * The city a reasonable player builds: a street, homes along both sides, and
 * somewhere to work. Nothing here requires knowing a hidden ratio.
 */
function buildMixedNeighbourhood(): Systems {
  const systems = new Systems(game.world.size);
  buildRoad(game.world, row(20, 0), 'path', 100_000);
  paintZone(game.world, row(20, -1), 'res', 100_000);
  paintZone(game.world, row(20, 1), 'res', 100_000);
  paintZone(game.world, row(20, 2), 'com', 100_000);
  paintZone(game.world, row(20, -2), 'ind', 100_000);
  systems.invalidateFields();
  return systems;
}

beforeEach(() => {
  game = createGameState(hashSeed('growth'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 10, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
});

describe('the growth loop over time', () => {
  it('builds something within a few seconds of the first zoning', () => {
    const systems = buildMixedNeighbourhood();
    run(systems, 4);
    expect(game.buildings.size).toBeGreaterThan(0);
  });

  it('levels buildings up rather than freezing them all at level one', () => {
    const systems = buildMixedNeighbourhood();
    run(systems, 600);

    const levels = [...game.buildings.values()].map((b) => b.level);
    const best = Math.max(...levels);
    // The regression this guards: every plot sitting a few hundredths below the
    // spawn threshold forever, so a ten-minute city is still a field of huts.
    expect(best).toBeGreaterThanOrEqual(3);
  });

  it('keeps population climbing well past the first spawn wave', () => {
    const systems = buildMixedNeighbourhood();
    run(systems, 60);
    const early = game.population;
    run(systems, 540);

    expect(early).toBeGreaterThan(0);
    expect(game.population).toBeGreaterThan(early * 2);
  });

  it('can employ most of its workforce once there is somewhere to work', () => {
    const systems = buildMixedNeighbourhood();
    run(systems, 900);

    const totals = totalBuildings(game);
    const workers = game.population * LABOUR_PARTICIPATION;
    const jobs = totals.commercialJobs + totals.industrialJobs + totals.farmJobs;
    const unemployment = workers > 0 ? Math.max(0, (workers - jobs) / workers) : 0;
    // The structural bug this guards: the demand model asking for jobs for only
    // a quarter of the workforce, pinning unemployment near 77% no matter how
    // well the city is built.
    expect(unemployment).toBeLessThan(0.35);
  });

  it('still refuses to grow housing with nowhere to work', () => {
    // The brake has to survive the fix: homes alone must not run away.
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(20, 0), 'path', 100_000);
    paintZone(game.world, row(20, 1), 'res', 100_000);
    systems.invalidateFields();

    run(systems, 600);
    expect(game.demand.res).toBeLessThan(0.5);
  });

  it('asks for workplaces when its people have none', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(20, 0), 'path', 100_000);
    paintZone(game.world, row(20, 1), 'res', 100_000);
    systems.invalidateFields();

    run(systems, 120);
    // A city full of unemployed people should be visibly begging for commerce;
    // that demand bar is the only guidance the player gets.
    expect(game.demand.com).toBeGreaterThan(0.5);
  });
});
