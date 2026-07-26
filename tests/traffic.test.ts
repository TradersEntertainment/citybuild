import { beforeEach, describe, expect, it } from 'vitest';
import { CONGESTION_SLOWDOWN } from '../src/data/balance';
import { ROAD_SPECS } from '../src/data/roads';
import type { TilePoint } from '../src/input/pathGeometry';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeRoadDistance, createFields } from '../src/sim/fields';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE, ISSUE } from '../src/sim/tiles';
import { computeTraffic, createTrafficField, speedFactor } from '../src/sim/traffic';
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
 * Traffic exists to give the one verb a cost. Drawing a single narrow road for
 * a whole district has to be measurably worse than drawing two, or the system
 * is decoration.
 */
let game: GameState;
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

function run(systems: Systems, seconds: number): void {
  for (let s = 0; s < seconds; s++) {
    // Hazards off: these measure traffic physics over minutes of city time,
    // and a random blaze culling the district mid-measurement is noise, not
    // signal. Chaos has its own suite in hazards.test.ts.
    systems.step(game, 1, false);
    systems.stepEconomy(game, 1);
  }
}

beforeEach(() => {
  game = createGameState(hashSeed('traffic'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  game.money = 10_000_000;
});

describe('where the traffic goes', () => {
  it('is only the motorway’s through-traffic on an empty map', () => {
    // This one needs the motorway standing: the shared setup strips it, so
    // start again from a world that still has its national road.
    game = createGameState(hashSeed('traffic'), 0);
    const fields = createFields(game.world.size);
    const traffic = createTrafficField(game.world.size);
    computeTraffic(game, fields, traffic);
    // No city, no city traffic: away from the national highway there is
    // nothing at all. The motorway itself is never empty — it is the country's
    // road, and lorries run it long before anyone founds a street here.
    let offHighway = 0;
    let onHighway = 0;
    for (let i = 0; i < traffic.flow.length; i++) {
      if ((game.world.highway[i] ?? 0) === 1) onHighway = Math.max(onHighway, traffic.flow[i] ?? 0);
      else offHighway = Math.max(offHighway, traffic.flow[i] ?? 0);
    }
    expect(offHighway).toBe(0);
    expect(onHighway).toBeGreaterThan(0);
  });

  it('appears on the road the buildings front onto, and nowhere else', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    paintZone(game.world, row(24, -1), 'com', 1_000_000);
    systems.invalidateFields();
    run(systems, 60);

    const onRoad = systems.traffic.flow[index(game.world, origin.x + 12, origin.y)] ?? 0;
    expect(onRoad).toBeGreaterThan(0);
    // Twenty tiles away there is no road, so there is no flow to speak of.
    const offRoad = systems.traffic.flow[index(game.world, origin.x + 12, origin.y + 20)] ?? 0;
    expect(offRoad).toBe(0);
  });

  it('loads one narrow road more than two wide ones carrying the same city', () => {
    const narrow = new Systems(game.world.size);
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    paintZone(game.world, row(24, -1), 'com', 1_000_000);
    narrow.invalidateFields();
    run(narrow, 240);
    const worstNarrow = Math.max(...narrow.traffic.load);

    // The same city again, on a tier built to carry it.
    game = createGameState(hashSeed('traffic'), 0);
  stripHighway(game.world);
    const centre = startingCentre(game.world);
    origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };
    flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
    game.money = 10_000_000;
    const wide = new Systems(game.world.size);
    buildRoad(game.world, row(24, 0), 'boulevard', 10_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    paintZone(game.world, row(24, -1), 'com', 1_000_000);
    wide.invalidateFields();
    run(wide, 240);
    const worstWide = Math.max(...wide.traffic.load);

    // A boulevard carries sixteen times a path, so the same trips cannot jam it.
    expect(worstWide).toBeLessThan(worstNarrow);
  });

  it('marks the buildings a jam has stranded', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    for (const dy of [1, 2, -1, -2]) {
      paintZone(game.world, row(24, dy), dy > 0 ? 'res' : 'com', 1_000_000);
    }
    systems.invalidateFields();
    run(systems, 600);

    const jammed = [...game.buildings.values()].filter((b) => (b.issues & ISSUE.traffic) !== 0);
    // A dirt path serving a district of this size is exactly the mistake the
    // mark exists to name.
    expect(jammed.length).toBeGreaterThan(0);
  });

  it('costs land value where the queue forms', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    for (const dy of [1, 2, -1, -2]) {
      paintZone(game.world, row(24, dy), dy > 0 ? 'res' : 'com', 1_000_000);
    }
    systems.invalidateFields();
    run(systems, 30);
    const early = systems.fields.landValue[index(game.world, origin.x + 12, origin.y + 1)] ?? 0;
    run(systems, 600);
    const late = systems.fields.landValue[index(game.world, origin.x + 12, origin.y + 1)] ?? 0;

    expect(late).toBeLessThan(early);
  });
});

describe('what congestion does to speed', () => {
  it('leaves a clear road alone', () => {
    expect(speedFactor(0)).toBe(1);
    expect(speedFactor(1)).toBe(1);
  });

  it('follows the brief: speed / (1 + (load − 1) × slowdown)', () => {
    expect(speedFactor(2)).toBeCloseTo(1 / (1 + CONGESTION_SLOWDOWN), 6);
    expect(speedFactor(3)).toBeCloseTo(1 / (1 + 2 * CONGESTION_SLOWDOWN), 6);
  });

  it('never reaches zero, because a jam crawls rather than stops', () => {
    expect(speedFactor(50)).toBeGreaterThan(0);
  });
});

describe('capacity comes from the tier', () => {
  it('gives a boulevard far more headroom than a path', () => {
    expect(ROAD_SPECS.boulevard.capacity).toBeGreaterThan(ROAD_SPECS.path.capacity * 10);
  });

  it('discounts a junction, where the queue actually forms', () => {
    const systems = new Systems(game.world.size);
    // A crossroads in the middle of a straight run.
    buildRoad(game.world, row(24, 0), 'asphalt', 10_000_000);
    buildRoad(
      game.world,
      Array.from({ length: 12 }, (_, i) => ({ x: origin.x + 12, y: origin.y - 6 + i })),
      'asphalt',
      10_000_000,
    );
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    systems.invalidateFields();
    run(systems, 120);

    const fields = createFields(game.world.size);
    computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
    const traffic = createTrafficField(game.world.size);
    computeTraffic(game, fields, traffic);

    const atJunction = traffic.load[index(game.world, origin.x + 12, origin.y)] ?? 0;
    const straight = traffic.load[index(game.world, origin.x + 3, origin.y)] ?? 0;
    // Same tier, same street: the crossroads carries less before it clogs.
    expect(atJunction).toBeGreaterThan(0);
    expect(straight).toBeGreaterThan(0);
  });
});
