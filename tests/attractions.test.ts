import { beforeEach, describe, expect, it } from 'vitest';
import { ATTRACTION_SPECS } from '../src/data/attractions';
import { ATTRACTION_HAPPINESS_CAP } from '../src/data/balance';
import {
  attractionHappiness,
  attractionPull,
  attractionUpkeep,
  hasAirGate,
  placeAttraction,
  tourismIncome,
} from '../src/sim/attractions';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeRoadDistance, createFields } from '../src/sim/fields';
import { refreshSeaGates } from '../src/sim/ports';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE } from '../src/sim/tiles';
import { index, startingCentre } from '../src/sim/world';

/**
 * Attractions (§21): hotels, landmarks, the airport.
 *
 * The properties that make the family worth having: a landmark really is
 * one-of-a-kind, pride really is capped, a hotel really earns from the street
 * it stands on, and the airport really is a gate — the same column the
 * harbours seed, so a barricaded motorway cannot strand a city with a runway.
 */
let game: GameState;
let fields: ReturnType<typeof createFields>;
let origin: { x: number; y: number };

/**
 * Connectivity is measured from the highway, so a fixture that leaves the
 * motorway standing sees its own test road as unconnected and every placement
 * refused with noRoad (AGENTS.md trap 14). Strip it whole: tarmac, route and
 * connectivity column together.
 */
function stripHighway(state: GameState): void {
  const world = state.world;
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

beforeEach(() => {
  game = createGameState(hashSeed('attract'), 0);
  stripHighway(game);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x), y: Math.floor(centre.y) };
  for (let y = origin.y - 8; y <= origin.y + 8; y++) {
    for (let x = origin.x - 8; x <= origin.x + 8; x++) {
      const i = index(game.world, x, y);
      game.world.height[i] = 0.5;
      game.world.terrain[i] = 2;
    }
  }
  buildRoad(
    game.world,
    Array.from({ length: 10 }, (_, i) => ({ x: origin.x - 4 + i, y: origin.y })),
    'asphalt',
    1e9,
  );
  fields = createFields(game.world.size);
  computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
  game.money = 1_000_000;
  game.era = 'metro';
});

describe('placement and uniqueness', () => {
  it('places a hotel on owned ground by a road', () => {
    const result = placeAttraction(game, fields, 'hotel', origin.x, origin.y + 1);
    expect(result.ok).toBe(true);
    expect(game.attractions.size).toBe(1);
    expect(game.money).toBe(1_000_000 - ATTRACTION_SPECS.hotel.cost);
  });

  it('refuses a second stadium by rule, not by price', () => {
    expect(placeAttraction(game, fields, 'stadium', origin.x, origin.y + 1).ok).toBe(true);
    const second = placeAttraction(game, fields, 'stadium', origin.x + 2, origin.y + 1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('alreadyBuilt');
    // Hotels are the repeatable half of the family.
    expect(placeAttraction(game, fields, 'hotel', origin.x + 1, origin.y + 1).ok).toBe(true);
    expect(placeAttraction(game, fields, 'hotel', origin.x + 3, origin.y + 1).ok).toBe(true);
  });

  it('holds the era locks: no opera in a village', () => {
    game.era = 'village';
    const refused = placeAttraction(game, fields, 'opera', origin.x, origin.y + 1);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('locked');
  });
});

describe('what the family does', () => {
  it('caps pride however many monuments stand', () => {
    for (const kind of ['clockTower', 'opera', 'stadium', 'tvTower', 'airport'] as const) {
      const spot = game.attractions.size;
      placeAttraction(game, fields, kind, origin.x - 3 + spot, origin.y + 1);
    }
    expect(game.attractions.size).toBe(5);
    expect(attractionHappiness(game)).toBeLessThanOrEqual(ATTRACTION_HAPPINESS_CAP);
    expect(attractionHappiness(game)).toBeGreaterThan(0);
  });

  it('pulls more visitors with each landmark, but with diminishing force', () => {
    expect(attractionPull(game)).toBe(1);
    placeAttraction(game, fields, 'clockTower', origin.x, origin.y + 1);
    const one = attractionPull(game);
    placeAttraction(game, fields, 'stadium', origin.x + 2, origin.y + 1);
    const two = attractionPull(game);
    expect(one).toBeGreaterThan(1);
    expect(two).toBeGreaterThan(one);
    // The second monument impresses less than its own spec says it would alone.
    expect(two / one).toBeLessThan(ATTRACTION_SPECS.stadium.pull);
  });

  it('bills upkeep for everything standing', () => {
    placeAttraction(game, fields, 'hotel', origin.x, origin.y + 1);
    placeAttraction(game, fields, 'clockTower', origin.x + 1, origin.y + 1);
    expect(attractionUpkeep(game)).toBe(
      ATTRACTION_SPECS.hotel.upkeep + ATTRACTION_SPECS.clockTower.upkeep,
    );
  });

  it('earns hotel income only where visitors actually reach', () => {
    placeAttraction(game, fields, 'hotel', origin.x, origin.y + 1);
    // A visitor field with real flow along the hotel's street…
    const visitors = { flow: new Float32Array(game.world.size ** 2) };
    for (let i = 0; i < 10; i++) {
      visitors.flow[index(game.world, origin.x - 4 + i, origin.y)] = 40;
    }
    const busy = tourismIncome(game, fields, visitors as never);
    // …against the same city with empty streets.
    const dead = tourismIncome(game, fields, {
      flow: new Float32Array(game.world.size ** 2),
    } as never);
    expect(busy).toBeGreaterThan(0);
    expect(busy).toBeGreaterThan(dead);
  });

  it('the airport is a gate: it seeds the same column as a harbour', () => {
    expect(hasAirGate(game)).toBe(false);
    placeAttraction(game, fields, 'airport', origin.x, origin.y + 1);
    expect(hasAirGate(game)).toBe(true);
    refreshSeaGates(game);
    expect(game.world.seaGate[index(game.world, origin.x, origin.y + 1)]).toBe(1);
  });
});

describe('the save carries them', () => {
  it('round-trips attractions and drops unknown kinds without failing', () => {
    placeAttraction(game, fields, 'hotel', origin.x, origin.y + 1);
    placeAttraction(game, fields, 'tvTower', origin.x + 2, origin.y + 1);
    const back = deserialize(serialize(game));
    expect(back).not.toBeNull();
    expect(back!.attractions.size).toBe(2);
    expect([...back!.attractions.values()].map((a) => a.kind).sort()).toEqual([
      'hotel',
      'tvTower',
    ]);

    // A kind from a future build is dropped, not fatal.
    const file = serialize(game);
    file.attractions[1] = 99;
    const tolerant = deserialize(file);
    expect(tolerant).not.toBeNull();
    expect(tolerant!.attractions.size).toBe(1);
  });

  it('treats a file without the field as a city that never built one', () => {
    const file = serialize(game) as unknown as Record<string, unknown>;
    delete file['attractions'];
    delete file['policies'];
    const back = deserialize(file as never);
    expect(back).not.toBeNull();
    expect(back!.attractions.size).toBe(0);
    expect(back!.policies.size).toBe(0);
  });
});
