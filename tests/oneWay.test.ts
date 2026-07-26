import { describe, expect, it } from 'vitest';
import { ONE_WAY_CAPACITY_BONUS, STARTING_MONEY } from '../src/data/balance';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeRoadDistance, createFields, type Fields } from '../src/sim/fields';
import { demolishArea } from '../src/sim/demolish';
import { ensureSections } from '../src/sim/highwayWear';
import {
  canTravel,
  oneWayCapacity,
  oneWayTiles,
  pruneOneWay,
  restoreOneWay,
  setOneWayAlong,
  WAY,
  wayAt,
  wayOfStep,
  wayStep,
} from '../src/sim/oneWay';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { computeTraffic, createTrafficField, type TrafficField } from '../src/sim/traffic';
import { encodeRoad } from '../src/sim/tiles';
import { computeVisitors, createVisitorField, visitorsArriving, type VisitorField } from '../src/sim/visitors';
import { index } from '../src/sim/world';

/**
 * One-way streets.
 *
 * The whole feature is one rule, and the rule has exactly one interesting edge:
 * an arrow forbids driving *against* it and says nothing about crossing it or
 * turning off it. Get that wrong in either direction and you have either a
 * street nobody can turn onto or a street the arrows do not actually govern.
 * Most of this file is that edge.
 */

/** A flat map with a straight street running east, and nothing else. */
function street(length = 12, y = 168, x0 = 150): GameState {
  const game = createGameState(hashSeed('one-way'), 0);
  const w = game.world;
  for (let i = 0; i < w.height.length; i++) {
    w.height[i] = 0.6;
    w.terrain[i] = 2;
    w.road[i] = 0;
  }
  w.highway.fill(0);
  w.highwayRoute = [];
  ensureSections(game);
  for (let n = 0; n < length; n++) w.road[index(w, x0 + n, y)] = encodeRoad('asphalt');
  return game;
}

/** The tiles of that street, west to east. */
function run(length = 12, y = 168, x0 = 150): { x: number; y: number }[] {
  return Array.from({ length }, (_, n) => ({ x: x0 + n, y }));
}

describe('reading a step', () => {
  it('names the four directions and refuses to name a diagonal', () => {
    expect(wayOfStep(1, 0)).toBe(WAY.east);
    expect(wayOfStep(-1, 0)).toBe(WAY.west);
    expect(wayOfStep(0, 1)).toBe(WAY.south);
    expect(wayOfStep(0, -1)).toBe(WAY.north);
    expect(wayOfStep(1, 1)).toBe(WAY.both);
    expect(wayOfStep(0, 0)).toBe(WAY.both);
  });

  it('hands back a unit step for each direction', () => {
    expect(wayStep(WAY.east)).toEqual({ dx: 1, dy: 0 });
    expect(wayStep(WAY.north)).toEqual({ dx: 0, dy: -1 });
    expect(wayStep(WAY.both)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('the rule', () => {
  it('lets anything through a street with no arrow on it', () => {
    const game = street();
    expect(canTravel(game.world, 150, 168, 151, 168)).toBe(true);
    expect(canTravel(game.world, 151, 168, 150, 168)).toBe(true);
  });

  it('allows the way it points and refuses the way it does not', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    expect(wayAt(game.world, 152, 168)).toBe(WAY.east);
    expect(canTravel(game.world, 152, 168, 153, 168)).toBe(true);
    expect(canTravel(game.world, 153, 168, 152, 168)).toBe(false);
  });

  it('lets traffic turn onto it from a side street', () => {
    // The edge that matters. A rule written as "you may only leave this tile the
    // way the arrow points" would make a one-way street impossible to join, and
    // the street would be a decoration nobody could use.
    const game = street();
    setOneWayAlong(game.world, run());
    game.world.road[index(game.world, 155, 167)] = encodeRoad('asphalt');
    expect(canTravel(game.world, 155, 167, 155, 168)).toBe(true);
  });

  it('lets traffic turn off it onto a side street', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    game.world.road[index(game.world, 155, 169)] = encodeRoad('asphalt');
    expect(canTravel(game.world, 155, 168, 155, 169)).toBe(true);
  });

  it('refuses a diagonal that runs against the arrow', () => {
    // The pathfinder moves eight ways. A diagonal waved through is a car driving
    // round the end of every one-way street, and the arrows become decoration.
    const game = street();
    setOneWayAlong(game.world, run());
    game.world.road[index(game.world, 154, 169)] = encodeRoad('asphalt');
    // North-west off an east-pointing tile: the westward component is illegal.
    expect(canTravel(game.world, 155, 168, 154, 169)).toBe(false);
    // South-east off the same tile is fine — nothing about it runs west.
    game.world.road[index(game.world, 156, 169)] = encodeRoad('asphalt');
    expect(canTravel(game.world, 155, 168, 156, 169)).toBe(true);
  });

  it('checks both ends, so a two-way tile cannot be used to sneak on backwards', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    // A two-way stub east of the run's end, driving west onto the last one-way
    // tile: legal at the stub, illegal at the tile it is entering.
    game.world.road[index(game.world, 162, 168)] = encodeRoad('asphalt');
    expect(wayAt(game.world, 162, 168)).toBe(WAY.both);
    expect(canTravel(game.world, 162, 168, 161, 168)).toBe(false);
  });

  it('says nothing about tiles off the map', () => {
    const game = street();
    expect(canTravel(game.world, -1, 168, 0, 168)).toBe(true);
  });
});

describe('signing a street', () => {
  it('points every tile the way the stroke went', () => {
    const game = street();
    const edits = setOneWayAlong(game.world, run());
    expect(edits.length).toBe(12);
    for (const tile of run()) expect(wayAt(game.world, tile.x, tile.y)).toBe(WAY.east);
    expect(oneWayTiles(game.world)).toBe(12);
  });

  it('points the other way when the stroke goes the other way', () => {
    const game = street();
    setOneWayAlong(game.world, [...run()].reverse());
    expect(wayAt(game.world, 155, 168)).toBe(WAY.west);
  });

  it('signs the last tile too, so the run has no gap at its end', () => {
    // The final tile has nothing ahead of it. Leaving it two-way would put a
    // hole in the street that traffic could legally u-turn in.
    const game = street();
    setOneWayAlong(game.world, run());
    expect(wayAt(game.world, 161, 168)).toBe(WAY.east);
  });

  it('clears the arrows when asked', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    setOneWayAlong(game.world, run(), true);
    expect(oneWayTiles(game.world)).toBe(0);
  });

  it('leaves the state’s motorway alone', () => {
    const game = createGameState(hashSeed('one-way-highway'), 0);
    const route = game.world.highwayRoute;
    setOneWayAlong(game.world, route.slice(0, 20));
    // The mayor does not re-sign the country's road.
    expect(oneWayTiles(game.world)).toBe(0);
  });

  it('marks nothing on bare ground', () => {
    const game = street();
    setOneWayAlong(game.world, [
      { x: 40, y: 40 },
      { x: 41, y: 40 },
    ]);
    expect(oneWayTiles(game.world)).toBe(0);
  });

  it('is undone exactly', () => {
    const game = street();
    setOneWayAlong(game.world, [...run()].reverse());
    const edits = setOneWayAlong(game.world, run());
    expect(wayAt(game.world, 155, 168)).toBe(WAY.east);
    restoreOneWay(game.world, edits);
    expect(wayAt(game.world, 155, 168)).toBe(WAY.west);
  });
});

describe('what happens to the arrow when the street goes', () => {
  it('comes up with the pavement', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    const result = demolishArea(game, [{ x: 155, y: 168 }]);
    expect(wayAt(game.world, 155, 168)).toBe(WAY.both);
    // And it is in the undo record, or undoing the erase would give back a
    // two-way street where a one-way one stood.
    expect(result.changes.some((c) => c.layer === 'oneWay')).toBe(true);
  });

  it('is pruned from anywhere that stopped being road', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    // Straight into the column, the way a bad save or an old build might.
    game.world.road[index(game.world, 155, 168)] = 0;
    pruneOneWay(game.world);
    expect(wayAt(game.world, 155, 168)).toBe(WAY.both);
    expect(wayAt(game.world, 156, 168)).toBe(WAY.east);
  });
});

describe('what a one-way street is worth', () => {
  it('carries more than a two-way one', () => {
    const game = street();
    expect(oneWayCapacity(game.world, 155, 168)).toBe(1);
    setOneWayAlong(game.world, run());
    expect(oneWayCapacity(game.world, 155, 168)).toBe(ONE_WAY_CAPACITY_BONUS);
    expect(ONE_WAY_CAPACITY_BONUS).toBeGreaterThan(1);
  });

  it('shows up as less load for the same traffic', () => {
    const bare = loaded(street());
    const signed = loaded((() => {
      const game = street();
      setOneWayAlong(game.world, run());
      return game;
    })());
    const at = (s: { traffic: TrafficField; game: GameState }) =>
      s.traffic.load[index(s.game.world, 155, 168)] ?? 0;
    expect(at(bare)).toBeGreaterThan(0);
    expect(at(signed)).toBeLessThan(at(bare));
  });

  it('cannot push its load back upstream', () => {
    // The cost of a one-way scheme, and the only place the load spread can
    // express it. Homes in the middle of the street, so there is somewhere for
    // the flow to go in both directions if the rule lets it.
    const game = street(16);
    setOneWayAlong(game.world, run(16));
    const fields = createFields(game.world.size);
    const traffic = createTrafficField(game.world.size);
    addHome(game, 158, 169, 60);
    computeConnectivity(game.world);
    computeRoadDistance(game.world, fields.roadDistance);
    computeTraffic(game, fields, traffic);

    const at = (x: number) => traffic.flow[index(game.world, x, 168)] ?? 0;
    // Downstream of the house carries traffic; upstream of it carries none,
    // because on an east-pointing street nothing may travel west.
    expect(at(158)).toBeGreaterThan(0);
    expect(at(161)).toBeGreaterThan(0);
    expect(at(155)).toBe(0);

    // The same city with no arrows spreads both ways, which is the contrast.
    const twoWay = street(16);
    const plainFields = createFields(twoWay.world.size);
    const plainTraffic = createTrafficField(twoWay.world.size);
    addHome(twoWay, 158, 169, 60);
    computeConnectivity(twoWay.world);
    computeRoadDistance(twoWay.world, plainFields.roadDistance);
    computeTraffic(twoWay, plainFields, plainTraffic);
    expect(plainTraffic.flow[index(twoWay.world, 155, 168)] ?? 0).toBeGreaterThan(0);
  });
});

describe('what it does to the visitors', () => {
  it('lets them in along the arrow and not against it', () => {
    // Two identical corridors off the motorway: one signed inward, one signed
    // outward. The outward one is a street the country cannot use.
    const inward = corridor('in');
    const outward = corridor('out');
    expect(visitorsArriving(inward.visitors, inward.game.world)).toBeGreaterThan(0);
    const deepIn = inward.visitors.flow[index(inward.game.world, 158, 168)] ?? 0;
    const deepOut = outward.visitors.flow[index(outward.game.world, 158, 168)] ?? 0;
    expect(deepIn).toBeGreaterThan(0);
    expect(deepOut).toBe(0);
  });
});

describe('arrows across a save', () => {
  it('come back pointing the same way', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    for (const tile of run()) expect(wayAt(loaded.world, tile.x, tile.y)).toBe(WAY.east);
  });

  it('opens a save that predates them as a two-way city', () => {
    const game = street();
    setOneWayAlong(game.world, run());
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['oneWay'];
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    expect(oneWayTiles(loaded.world)).toBe(0);
  });
});

// --- helpers -------------------------------------------------------------------

/** One house, wired into the tile index the way the growth loop would. */
function addHome(game: GameState, x: number, y: number, population: number): void {
  const id = game.nextBuildingId++;
  game.buildings.set(id, {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone: 'res',
    level: 3,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population,
    jobs: 0,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  });
  game.world.building[index(game.world, x, y)] = id;
}

/** Runs the traffic passes over a city whose street carries some homes. */
function loaded(game: GameState): { game: GameState; traffic: TrafficField } {
  const fields = createFields(game.world.size);
  const traffic = createTrafficField(game.world.size);
  for (let n = 1; n < 11; n++) addHome(game, 150 + n, 169, 40);
  computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
  computeTraffic(game, fields, traffic);
  return { game, traffic };
}

/** A motorway with a corridor off it, signed toward or away from the city. */
function corridor(direction: 'in' | 'out'): { game: GameState; visitors: VisitorField } {
  const game = createGameState(hashSeed('one-way-visitors'), 0);
  const w = game.world;
  for (let i = 0; i < w.height.length; i++) {
    w.height[i] = 0.6;
    w.terrain[i] = 2;
    w.road[i] = 0;
  }
  w.highway.fill(0);
  w.highwayRoute = [];
  for (let y = 120; y < 220; y++) {
    const i = index(w, 150, y);
    w.highway[i] = 1;
    w.road[i] = encodeRoad('highway');
    w.highwayRoute.push({ x: 150, y });
  }
  ensureSections(game);
  const tiles = run(14, 168, 151);
  for (const tile of tiles) w.road[index(w, tile.x, tile.y)] = encodeRoad('asphalt');
  setOneWayAlong(w, direction === 'in' ? tiles : [...tiles].reverse());

  const fields: Fields = createFields(w.size);
  const traffic = createTrafficField(w.size);
  const visitors = createVisitorField(w.size);
  game.population = 8_000;
  game.money = STARTING_MONEY;
  computeConnectivity(w);
  computeRoadDistance(w, fields.roadDistance);
  computeTraffic(game, fields, traffic);
  computeVisitors(game, visitors, traffic.load, 300);
  return { game, visitors };
}
