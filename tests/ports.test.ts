import { describe, expect, it } from 'vitest';
import { SEA_GATE_HAPPINESS_CAP, STARTING_MONEY } from '../src/data/balance';
import { PORT_SPECS, type PortKind } from '../src/data/ports';
import { totalBuildings } from '../src/sim/buildings';
import { computeConnectivity, hasConnection } from '../src/sim/connectivity';
import { computeLedger } from '../src/sim/economy';
import { computeRoadDistance, createFields, type Fields } from '../src/sim/fields';
import { ensureSections, refreshHighwayDamage } from '../src/sim/highwayWear';
import {
  canPlacePort,
  hasSeaGate,
  openWaterNear,
  placePort,
  portJobs,
  portHappiness,
  portUpkeep,
  refreshSeaGates,
  removePort,
  seaIncome,
  workingPorts,
} from '../src/sim/ports';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { encodeRoad, NONE } from '../src/sim/tiles';
import { claimParcel, index, parcelOfTile } from '../src/sim/world';

/**
 * The sea, as an investment (denize yatırım).
 *
 * Water had been scenery and an obstacle since the first build. These pin what
 * changed: a berth needs open water in front of it, it pays by what it can see
 * and by the city behind it, and a cargo port is a second way out of the country
 * — which is the whole strategic point, and the answer to a barricaded motorway.
 */

/** A world with a big lake to the west of the starting parcel, and a road to it. */
function coastalGame(): { game: GameState; fields: Fields; shore: { x: number; y: number } } {
  const game = createGameState(hashSeed('coast'), 0);
  const world = game.world;
  // Flat land everywhere, then a wide body of water on one side of the parcel.
  for (let i = 0; i < world.height.length; i++) {
    world.height[i] = 0.6;
    world.terrain[i] = 2;
    world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  ensureSections(game);
  refreshHighwayDamage(game);

  const cy = 168;
  for (let y = cy - 20; y <= cy + 20; y++) {
    for (let x = 140; x < 160; x++) {
      const i = index(world, x, y);
      world.height[i] = 0.2;
      world.terrain[i] = 0;
    }
  }

  // A street running east from the shoreline, so a berth beside it has access.
  for (let x = 160; x < 176; x++) world.road[index(world, x, cy)] = encodeRoad('asphalt');
  for (const point of [{ x: 160, y: cy }]) {
    const { px, py } = parcelOfTile(point.x, point.y);
    claimParcel(world, px, py);
  }

  const fields = createFields(world.size);
  computeConnectivity(world);
  computeRoadDistance(world, fields.roadDistance);
  return { game, fields, shore: { x: 160, y: cy } };
}

/** Places a berth at the shore, unlocking whatever era it needs first. */
function build(
  game: GameState,
  fields: Fields,
  kind: PortKind,
  at: { x: number; y: number },
): void {
  game.era = 'metro';
  game.money = 200_000;
  const result = placePort(game, fields, kind, at.x, at.y + 1);
  expect(result).toEqual({ ok: true });
}

describe('where a berth may go', () => {
  it('counts the open water in front of it', () => {
    const { game, shore } = coastalGame();
    // The lake is twenty tiles wide and forty deep, so a berth on its edge sees
    // a great deal of it and a berth inland sees none.
    expect(openWaterNear(game.world, shore.x, shore.y, 9)).toBeGreaterThan(60);
    expect(openWaterNear(game.world, 200, shore.y, 9)).toBe(0);
  });

  it('refuses dry ground, however well served', () => {
    const { game, fields } = coastalGame();
    game.era = 'metro';
    game.money = 200_000;
    // Beside the same road, but inland: the road is fine and the sea is not there.
    for (let x = 190; x < 200; x++) game.world.road[index(game.world, x, 168)] = encodeRoad('asphalt');
    const { px, py } = parcelOfTile(196, 168);
    claimParcel(game.world, px, py);
    // Connectivity first: road distance is only measured from streets that lead
    // somewhere, so a road added after the last pass is invisible to it.
    computeConnectivity(game.world);
    computeRoadDistance(game.world, fields.roadDistance);
    expect(canPlacePort(game, fields, 'cargo', 196, 169).reason).toBe('noWater');
  });

  it('refuses to stand in the water it needs to look at', () => {
    const { game, fields } = coastalGame();
    game.era = 'metro';
    game.money = 200_000;
    expect(canPlacePort(game, fields, 'fishing', 150, 168).reason).not.toBe('ok');
    expect(canPlacePort(game, fields, 'fishing', 150, 168).ok).toBe(false);
  });

  it('refuses a berth nobody can drive to', () => {
    const { game, fields } = coastalGame();
    game.era = 'metro';
    game.money = 200_000;
    // On the far shore, beside plenty of water and no road at all.
    const { px, py } = parcelOfTile(139, 168);
    claimParcel(game.world, px, py);
    expect(canPlacePort(game, fields, 'fishing', 139, 168).reason).toBe('noRoad');
  });

  it('keeps each kind behind its own era', () => {
    const { game, fields, shore } = coastalGame();
    game.money = 200_000;
    game.era = 'village';
    expect(canPlacePort(game, fields, 'fishing', shore.x, shore.y + 1).ok).toBe(true);
    expect(canPlacePort(game, fields, 'cargo', shore.x, shore.y + 1).reason).toBe('locked');
    game.era = 'town';
    expect(canPlacePort(game, fields, 'cargo', shore.x, shore.y + 1).ok).toBe(true);
    expect(canPlacePort(game, fields, 'shipyard', shore.x, shore.y + 1).reason).toBe('locked');
  });

  it('will not sell one the city cannot afford', () => {
    const { game, fields, shore } = coastalGame();
    game.era = 'metro';
    game.money = PORT_SPECS.cargo.cost - 1;
    expect(canPlacePort(game, fields, 'cargo', shore.x, shore.y + 1).reason).toBe('tooDear');
  });
});

describe('what the sea pays', () => {
  it('pays nothing before anything is built', () => {
    const { game } = coastalGame();
    expect(seaIncome(game)).toBe(0);
    expect(portUpkeep(game)).toBe(0);
    expect(portJobs(game)).toBe(0);
  });

  it('pays for the water it sees and the city behind it', () => {
    const { game, fields, shore } = coastalGame();
    build(game, fields, 'cargo', shore);

    game.population = 0;
    const empty = seaIncome(game);
    game.population = 10_000;
    const busy = seaIncome(game);
    // Both matter: a harbour with no city is a jetty, a city with no harbour is
    // inland, and only the two together are a port.
    expect(empty).toBeGreaterThan(0);
    expect(busy).toBeGreaterThan(empty);
  });

  it('bills its upkeep and employs its district', () => {
    const { game, fields, shore } = coastalGame();
    build(game, fields, 'cargo', shore);
    expect(portUpkeep(game)).toBe(PORT_SPECS.cargo.upkeep);
    expect(portJobs(game)).toBe(PORT_SPECS.cargo.jobs);
    // And those jobs are counted with the city's, or the docks would employ
    // nobody as far as the unemployment figure was concerned.
    expect(totalBuildings(game).portJobs).toBe(PORT_SPECS.cargo.jobs);
  });

  it('reaches the ledger on both sides', () => {
    const { game, fields, shore } = coastalGame();
    build(game, fields, 'cargo', shore);
    game.population = 4_000;
    const ledger = computeLedger(game, fields);
    expect(ledger.seaIncome).toBeGreaterThan(0);
    expect(ledger.portUpkeep).toBeGreaterThan(0);
    // The net has to have both, or the panel and the balance disagree.
    const withoutSea = ledger.net - ledger.seaIncome + ledger.portUpkeep;
    expect(ledger.net).not.toBeCloseTo(withoutSea, 3);
  });

  it('caps what the waterfront can do for the mood', () => {
    const { game, fields, shore } = coastalGame();
    game.era = 'metro';
    game.money = 500_000;
    // Eight marinas is not a happier city, it is an exploit.
    for (let n = 0; n < 8; n++) {
      placePort(game, fields, 'marina', shore.x + n, shore.y + 1);
    }
    expect(game.ports.size).toBeGreaterThan(1);
    expect(portHappiness(game)).toBeLessThanOrEqual(SEA_GATE_HAPPINESS_CAP);
  });

  it('stops paying for a berth that is knocked down', () => {
    const { game, fields, shore } = coastalGame();
    build(game, fields, 'cargo', shore);
    const port = [...game.ports.values()][0];
    expect(port).toBeDefined();
    expect(removePort(game, (port as { id: number }).id)).toBe(true);
    expect(seaIncome(game)).toBe(0);
    expect(portUpkeep(game)).toBe(0);
  });
});

describe('a port as a way out of the country', () => {
  it('wires the city in even with no motorway on the map', () => {
    const { game, fields, shore } = coastalGame();
    // This fixture has its highway stripped, so before the port the city's only
    // claim to being connected is that there is nothing to be cut off from.
    build(game, fields, 'cargo', shore);
    refreshSeaGates(game);
    computeConnectivity(game.world);

    expect(hasSeaGate(game)).toBe(true);
    expect(hasConnection(game.world)).toBe(true);
    // The street beside the berth is what got seeded.
    expect(game.world.connected[index(game.world, shore.x, shore.y)]).toBe(1);
  });

  it('holds the city together through a barricaded motorway', () => {
    const game = createGameState(hashSeed('port-vs-war'), 0);
    // A real map, with its real highway — and a street that touches it.
    const route = game.world.highwayRoute;
    const junction = route[Math.floor(route.length / 2)] as { x: number; y: number };
    for (let d = 0; d < 4; d++) {
      const nx = junction.x + [1, -1, 0, 0][d]!;
      const ny = junction.y + [0, 0, 1, -1][d]!;
      if ((game.world.highway[index(game.world, nx, ny)] ?? 0) === 1) continue;
      game.world.road[index(game.world, nx, ny)] = encodeRoad('asphalt');
      break;
    }
    ensureSections(game);
    computeConnectivity(game.world);
    expect(hasConnection(game.world)).toBe(true);

    // Now the war shuts every stretch.
    game.highwayWear.fill(1);
    refreshHighwayDamage(game);
    refreshSeaGates(game);
    computeConnectivity(game.world);
    expect(hasConnection(game.world)).toBe(false);

    // A working harbour brings the city back without a lira of repair money.
    // Placed by hand: this test is about connectivity, not about placement.
    game.ports.set(1, { id: 1, kind: 'cargo', x: 0, y: 0 });
    const gate = firstDeepShore(game);
    expect(gate).not.toBeNull();
    const at = gate as { x: number; y: number };
    game.ports.set(1, { id: 1, kind: 'cargo', x: at.x, y: at.y });
    for (let d = 0; d < 4; d++) {
      const nx = at.x + [1, -1, 0, 0][d]!;
      const ny = at.y + [0, 0, 1, -1][d]!;
      if ((game.world.height[index(game.world, nx, ny)] ?? 0) < 0.42) continue;
      game.world.road[index(game.world, nx, ny)] = encodeRoad('asphalt');
      break;
    }
    refreshSeaGates(game);
    computeConnectivity(game.world);
    expect(hasSeaGate(game)).toBe(true);
    expect(hasConnection(game.world)).toBe(true);
  });

  it('is only the cargo port; a fishing shelter is not a customs post', () => {
    const { game, fields, shore } = coastalGame();
    build(game, fields, 'fishing', shore);
    refreshSeaGates(game);
    expect(hasSeaGate(game)).toBe(false);
    expect(game.world.seaGate.some((v) => v === 1)).toBe(false);
    // But it is still a working berth that earns.
    expect(workingPorts(game)).toHaveLength(1);
    expect(seaIncome(game)).toBeGreaterThan(0);
  });
});

describe('berths across a save', () => {
  it('come back where they were', () => {
    const { game, fields, shore } = coastalGame();
    build(game, fields, 'cargo', shore);
    build(game, fields, 'fishing', { x: shore.x + 2, y: shore.y });

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.ports.size).toBe(game.ports.size);
    for (const [id, port] of game.ports) {
      expect(loaded.ports.get(id)).toEqual(port);
    }
    expect(loaded.nextPortId).toBe(game.nextPortId);
  });

  it('opens a save that predates the sea on a city with no waterfront', () => {
    const game = createGameState(hashSeed('inland'), 0);
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['ports'];
    delete data['nextPortId'];

    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.ports.size).toBe(0);
    expect(loaded.nextPortId).toBe(1);
  });
});

/** A shore tile beside deep enough water for a cargo port on a real map. */
function firstDeepShore(game: GameState): { x: number; y: number } | null {
  const spec = PORT_SPECS.cargo;
  const world = game.world;
  for (let y = 4; y < world.size - 4; y += 2) {
    for (let x = 4; x < world.size - 4; x += 2) {
      if ((world.height[index(world, x, y)] ?? 0) < 0.42) continue;
      if (openWaterNear(world, x, y, spec.reach) < spec.waterNeeded) continue;
      return { x, y };
    }
  }
  return null;
}

/** Kept honest: the two constants the fixture leans on have not drifted. */
describe('what a berth costs to keep', () => {
  it('never gives a berth away for free', () => {
    for (const kind of Object.keys(PORT_SPECS) as PortKind[]) {
      expect(PORT_SPECS[kind].cost).toBeGreaterThan(0);
      expect(PORT_SPECS[kind].upkeep).toBeGreaterThan(0);
      expect(PORT_SPECS[kind].cost).toBeLessThan(STARTING_MONEY * 2);
    }
  });
});
