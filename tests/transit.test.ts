import { describe, expect, it } from 'vitest';
import {
  TRANSIT_COST_PER_TILE,
  TRANSIT_LINE_CAPACITY,
  TRANSIT_MAX_SHARE,
  TRANSIT_STOP_SPACING,
  TRANSIT_STOP_UPKEEP,
  TRANSIT_STOP_WALK,
  TRANSIT_UNLOCK_POPULATION,
  TRIPS_PER_RESIDENT,
} from '../src/data/balance';
import type { Level } from '../src/data/buildings';
import type { Building } from '../src/sim/buildings';
import { computeConnectivity } from '../src/sim/connectivity';
import { demolishArea } from '../src/sim/demolish';
import { computeRoadDistance, createFields, type Fields } from '../src/sim/fields';
import { buildRoad } from '../src/sim/roads';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE } from '../src/sim/tiles';
import { computeTraffic, createTrafficField } from '../src/sim/traffic';
import {
  fareIncome,
  layTransit,
  stopCount,
  stopsAlong,
  transitLoad,
  transitShare,
  transitUnlocked,
  transitUpkeep,
} from '../src/sim/transit';
import { index, startingCentre } from '../src/sim/world';

/**
 * Public transport (§18): the second thing the player draws.
 *
 * The load-bearing property is the one in "what a line is for": a line has to
 * measurably take traffic off the corridor it runs along. Everything else here —
 * the stops, the fares, the capacity — is bookkeeping around that one effect,
 * and if the effect ever stops reaching `computeTraffic` the whole feature is a
 * coloured ribbon and a bill.
 */

let origin = { x: 0, y: 0 };

function strip(state: GameState): void {
  const world = state.world;
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

function home(game: GameState, x: number, y: number, people: number): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone: 'res',
    level: 3 as Level,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: people,
    jobs: 0,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  return building;
}

/** A straight street with homes down one side, and the fields to read it. */
function street(homes = 20): { game: GameState; fields: Fields } {
  const game = createGameState(hashSeed('transit'), 0);
  strip(game);
  game.era = 'city';
  game.money = 5_000_000;
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };

  const lane = Array.from({ length: homes + 2 }, (_, i) => ({ x: origin.x + i, y: origin.y }));
  buildRoad(game.world, lane, 'asphalt', 10_000_000);
  for (let i = 0; i < homes; i++) home(game, origin.x + i, origin.y + 1, 40);
  game.population = homes * 40;

  const fields = createFields(game.world.size);
  computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
  return { game, fields };
}

/** The drawn path down the middle of that street. */
function alongStreet(length: number): { x: number; y: number }[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y }));
}

describe('drawing a line', () => {
  it('is locked until the city is big enough to fill a bus', () => {
    const { game } = street();
    game.population = TRANSIT_UNLOCK_POPULATION - 1;
    expect(transitUnlocked(game)).toBe(false);
    game.population = TRANSIT_UNLOCK_POPULATION;
    expect(transitUnlocked(game)).toBe(true);
  });

  it('puts a stop at each end and at the spacing between', () => {
    const stops = stopsAlong(alongStreet(TRANSIT_STOP_SPACING * 3 + 1));
    expect(stops.length).toBeGreaterThanOrEqual(4);
    // Both ends, always. A line whose last stop is four tiles short of where the
    // player stopped dragging reads as the game ignoring the end of the gesture.
    expect(stops[0]).toEqual({ x: origin.x, y: origin.y });
    expect(stops.at(-1)).toEqual({ x: origin.x + TRANSIT_STOP_SPACING * 3, y: origin.y });
  });

  it('does not put two stops in one doorway', () => {
    // A path a whisker longer than a spacing must not end with a stop on top of
    // the one before it.
    const stops = stopsAlong(alongStreet(TRANSIT_STOP_SPACING + 2));
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(TRANSIT_STOP_SPACING / 2);
    }
  });

  it('refuses a stroke too short to be a route', () => {
    const { game } = street();
    expect(layTransit(game, alongStreet(1))).toBeNull();
    expect(game.transit.size).toBe(0);
  });

  it('lays a line and bills the stops for it', () => {
    const { game } = street();
    const line = layTransit(game, alongStreet(22));
    expect(line).not.toBeNull();
    expect(game.transit.size).toBe(1);
    expect(stopCount(game)).toBe(line!.stops.length);
    expect(transitUpkeep(game)).toBe(line!.stops.length * TRANSIT_STOP_UPKEEP);
  });
});

describe('what a line is for', () => {
  it('takes measurable traffic off the street it runs along', () => {
    // The whole feature, in one assertion. If this ever stops holding, a line is
    // a coloured ribbon and a monthly bill.
    const plain = street();
    const traffic = createTrafficField(plain.game.world.size);
    computeTraffic(plain.game, plain.fields, traffic);
    const before = Math.max(...traffic.load);
    expect(before).toBeGreaterThan(0);

    const served = street();
    layTransit(served.game, alongStreet(22));
    const after = createTrafficField(served.game.world.size);
    computeTraffic(served.game, served.fields, after);

    expect(Math.max(...after.load)).toBeLessThan(before);
  });

  it('takes nothing off a street it does not reach', () => {
    const { game, fields } = street();
    // A line on the far side of the map.
    layTransit(game, Array.from({ length: 22 }, (_, i) => ({ x: 20 + i, y: 20 })));
    const traffic = createTrafficField(game.world.size);
    computeTraffic(game, fields, traffic);

    const plain = street();
    const control = createTrafficField(plain.game.world.size);
    computeTraffic(plain.game, plain.fields, control);
    expect(Math.max(...traffic.load)).toBeCloseTo(Math.max(...control.load), 6);
  });

  it('never empties the road entirely', () => {
    // The road network is the game's instrument. A line that took every trip
    // would take the instrument away.
    const { game, fields } = street();
    layTransit(game, alongStreet(22));
    const traffic = createTrafficField(game.world.size);
    computeTraffic(game, fields, traffic);
    expect(Math.max(...traffic.load)).toBeGreaterThan(0);
    expect(transitShare(game, origin.x, origin.y)).toBeLessThanOrEqual(TRANSIT_MAX_SHARE);
  });

  it('serves a doorstep better than the edge of the catchment', () => {
    const { game } = street();
    layTransit(game, alongStreet(22));
    const near = transitShare(game, origin.x, origin.y);
    const far = transitShare(game, origin.x, origin.y + TRANSIT_STOP_WALK);
    const outside = transitShare(game, origin.x, origin.y + TRANSIT_STOP_WALK + 2);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(outside).toBe(0);
  });
});

describe('capacity', () => {
  it('carries what it is asked for while there is room', () => {
    const { game } = street(4);
    layTransit(game, alongStreet(10));
    const load = transitLoad(game, () => 10);
    expect(load.strain).toBe(1);
    expect(load.riders).toBeGreaterThan(0);
    expect(load.riders).toBeLessThan(TRANSIT_LINE_CAPACITY);
  });

  it('scales the whole network back once the lines are full', () => {
    // Not the last stop drawn: a full bus is full everywhere on the route, and
    // "which of my stops is the unlucky one" is not a decision anybody could act
    // on.
    const { game } = street();
    layTransit(game, alongStreet(22));
    const load = transitLoad(game, () => 10_000);
    expect(load.riders).toBeCloseTo(TRANSIT_LINE_CAPACITY, 6);
    expect(load.strain).toBeLessThan(1);
  });

  it('answers a full line with another line rather than a longer one', () => {
    const { game } = street();
    layTransit(game, alongStreet(22));
    const one = transitLoad(game, () => 10_000);
    layTransit(game, alongStreet(22).map((p) => ({ x: p.x, y: p.y + 2 })));
    const two = transitLoad(game, () => 10_000);
    expect(two.riders).toBeGreaterThan(one.riders);
  });

  it('carries nobody with no line at all', () => {
    const { game } = street();
    const load = transitLoad(game, () => 10_000);
    expect(load.riders).toBe(0);
    expect(load.strain).toBe(1);
  });
});

describe('the fares', () => {
  it('are nothing without riders', () => {
    expect(fareIncome(0)).toBe(0);
  });

  it('reach the ledger from the ridership the traffic pass measured', () => {
    // Counted once, in one place. The trips taken off the road and the trips that
    // paid a fare are the same trips, and computing them twice is how the two
    // would drift apart.
    const { game, fields } = street();
    layTransit(game, alongStreet(22));
    const traffic = createTrafficField(game.world.size);
    computeTraffic(game, fields, traffic);
    expect(traffic.riders).toBeGreaterThan(0);

    // And it is a share of what the served homes generate, not a free number.
    const generated = game.population * TRIPS_PER_RESIDENT;
    expect(traffic.riders).toBeLessThan(generated);
  });
});

describe('taking a line down', () => {
  it('comes down whole when the eraser catches one stop', () => {
    // Whole rather than stop-by-stop: half a route still costs money and still
    // says it runs, which is not a thing a player means to own.
    const { game } = street();
    const line = layTransit(game, alongStreet(22))!;
    const middle = line.stops[1]!;
    const result = demolishArea(game, [middle]);
    expect(game.transit.size).toBe(0);
    expect(result.removed.transit.map((l) => l.id)).toEqual([line.id]);
  });

  it('hands back a share of what it cost to lay', () => {
    const { game } = street();
    const line = layTransit(game, alongStreet(22))!;
    const result = demolishArea(game, [line.stops[0]!]);
    // Negative spend is money coming back.
    expect(result.spent).toBeLessThan(0);
    expect(-result.spent).toBeLessThan(line.path.length * TRANSIT_COST_PER_TILE);
  });

  it('leaves a line the brush missed alone', () => {
    const { game } = street();
    layTransit(game, alongStreet(22));
    demolishArea(game, [{ x: 10, y: 10 }]);
    expect(game.transit.size).toBe(1);
  });
});

describe('a line across a save', () => {
  it('comes back with the same shape and the same stops', () => {
    const { game } = street();
    const line = layTransit(game, alongStreet(22))!;
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.transit.size).toBe(1);
    const back = loaded.transit.get(line.id)!;
    expect(back.path).toEqual(line.path);
    // Derived on load by the same rule that placed them, so a file cannot hold a
    // line whose stops disagree with its shape.
    expect(back.stops).toEqual(line.stops);
  });

  it('keeps the counter, so a reloaded city cannot reuse an id', () => {
    const { game } = street();
    layTransit(game, alongStreet(22));
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded!.nextTransitId).toBe(game.nextTransitId);
  });

  it('opens a file written before the city could run a bus', () => {
    const { game } = street();
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['transit'];
    delete data['nextTransitId'];
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.transit.size).toBe(0);
    expect(loaded.nextTransitId).toBe(1);
  });

  it('drops a malformed route rather than failing the load', () => {
    const { game } = street();
    layTransit(game, alongStreet(22));
    const data = serialize(game) as unknown as Record<string, unknown>;
    // A length that runs off the end of the array.
    data['transit'] = [1, 99];
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.transit.size).toBe(0);
  });
});
