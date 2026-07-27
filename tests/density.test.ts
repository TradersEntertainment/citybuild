import { beforeEach, describe, expect, it } from 'vitest';
import { DENSE_LEVEL_CAP, DENSE_ZONE_MULTIPLIER, ZONE_COST, ZONE_LEVEL_CAP } from '../src/data/balance';
import type { TilePoint } from '../src/input/pathGeometry';
import { denseTiles, isDense, levelCapAt, pruneDensity } from '../src/sim/density';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE } from '../src/sim/tiles';
import { revertEdits, UndoStack } from '../src/sim/undo';
import { index, startingCentre, type World } from '../src/sim/world';
import { estimateZone, paintZone } from '../src/sim/zoning';

/**
 * Suburb or downtown (§19).
 *
 * The city could always build a tower — every archetype table runs to five
 * levels and the fifth is a proper high-rise — but nothing decided *where*, so
 * a mature city was uniformly tall and had no districts at all. Density makes
 * that the player's decision: ordinary ground stops at three, dense ground
 * reaches five, and the top two floors are gated on the city having actually
 * serviced the block.
 *
 * The three properties worth holding down are the three ways this could have
 * been a bad feature: a free upgrade, a silent failure, or a rule that quietly
 * demolishes the city a returning player already built.
 */

let game: GameState;
let origin: { x: number; y: number };

function stripHighway(world: World): void {
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

function row(length: number, dy = 0): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

beforeEach(() => {
  game = createGameState(hashSeed('density'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 10, y: Math.floor(centre.y) };
  for (let y = origin.y - 12; y <= origin.y + 12; y++) {
    for (let x = origin.x - 4; x <= origin.x + 30; x++) {
      const i = index(game.world, x, y);
      game.world.height[i] = 0.5;
      game.world.terrain[i] = 2;
    }
  }
  game.money = 5_000_000;
});

describe('what dense zoning costs and grants', () => {
  it('is not a free upgrade', () => {
    const plain = estimateZone(game.world, row(10, 1), 'res', 1e9);
    const tall = estimateZone(game.world, row(10, 1), 'res', 1e9, true);
    expect(tall.total).toBe(plain.total * DENSE_ZONE_MULTIPLIER);
    expect(tall.total).toBe(10 * ZONE_COST.res * DENSE_ZONE_MULTIPLIER);
  });

  it('raises the ceiling, and only where it was painted', () => {
    paintZone(game.world, row(6, 1), 'res', 1e9, true);
    paintZone(game.world, row(6, 2), 'res', 1e9);
    expect(levelCapAt(game.world, origin.x, origin.y + 1)).toBe(DENSE_LEVEL_CAP);
    expect(levelCapAt(game.world, origin.x, origin.y + 2)).toBe(ZONE_LEVEL_CAP);
  });

  it('charges for upzoning ground that is already the right kind', () => {
    // The common case, and the one a naive "has the zone changed?" test misses:
    // the player is looking at a finished suburb and deciding it should be a
    // downtown. If that stroke prices at zero it also changes nothing.
    paintZone(game.world, row(6, 1), 'res', 1e9);
    const upzone = estimateZone(game.world, row(6, 1), 'res', 1e9, true);
    expect(upzone.tiles.length).toBe(6);
    expect(upzone.total).toBeGreaterThan(0);
  });

  it('lets the player take it back', () => {
    paintZone(game.world, row(6, 1), 'res', 1e9, true);
    expect(denseTiles(game.world)).toBe(6);
    paintZone(game.world, row(6, 1), 'res', 1e9);
    expect(denseTiles(game.world)).toBe(0);
  });

  it('undoes the height along with the zoning', () => {
    // Two columns, one stroke. An undo that put the zone back and left the
    // ground upzoned would hand the player a downtown they had cancelled.
    const undo = new UndoStack();
    const result = paintZone(game.world, row(6, 1), 'res', 1e9, true);
    undo.push({ changes: result.changes, spent: result.spent });
    expect(denseTiles(game.world)).toBe(6);

    revertEdits(game, result.changes);
    expect(denseTiles(game.world)).toBe(0);
    expect(game.world.zone[index(game.world, origin.x, origin.y + 1)]).toBe(NONE);
  });

  it('leaves no marker on ground that cannot grow a building', () => {
    paintZone(game.world, row(6, 1), 'park', 1e9, true);
    expect(denseTiles(game.world)).toBe(0);
    // And clearing a zone clears the permission with it, rather than leaving a
    // marker to be inherited by whatever is painted there next.
    paintZone(game.world, row(6, 2), 'res', 1e9, true);
    paintZone(game.world, row(6, 2), null, 1e9);
    expect(denseTiles(game.world)).toBe(0);
  });

  it('prunes a marker whose zoning went away behind its back', () => {
    paintZone(game.world, row(6, 1), 'res', 1e9, true);
    // Something other than the brush cleared the zone — a bulldozer, a parcel
    // sold back, a load from an older file.
    for (const tile of row(6, 1)) game.world.zone[index(game.world, tile.x, tile.y)] = NONE;
    pruneDensity(game.world);
    expect(denseTiles(game.world)).toBe(0);
  });
});

describe('a tower has to be earned, not only bought', () => {
  /** A serviced street, so coverage is not what is being tested. */
  function street(dense: boolean, covered: boolean): Systems {
    buildRoad(game.world, row(20), 'asphalt', 1e9);
    paintZone(game.world, row(20, 1), 'res', 1e9, dense);
    const systems = new Systems(game.world.size);
    systems.invalidateFields();
    game.demand.res = 1;
    if (covered) {
      // Straight into the mask, and re-stamped each pass below: the coverage
      // sweep is derived from the stations that exist and would wipe anything
      // written here on its next run.
      game.world.serviceMask.fill(0xff);
    }
    return systems;
  }

  function grow(systems: Systems, covered: boolean, seconds: number): void {
    for (let s = 0; s < seconds; s++) {
      game.playedMs += 1000;
      systems.step(game, 1, false);
      if (covered) game.world.serviceMask.fill(0xff);
    }
  }

  function tallest(): number {
    let top = 0;
    for (const b of game.buildings.values()) if (b.level > top) top = b.level;
    return top;
  }

  it('stops an ordinary street at three however well it is served', () => {
    const systems = street(false, true);
    grow(systems, true, 1_200);
    expect(game.buildings.size).toBeGreaterThan(5);
    expect(tallest()).toBe(ZONE_LEVEL_CAP);
  });

  it('lets a served dense street climb past it', () => {
    const systems = street(true, true);
    grow(systems, true, 1_200);
    expect(tallest()).toBeGreaterThan(ZONE_LEVEL_CAP);
  });

  it('still builds on dense ground the city has not serviced — it just stays low', () => {
    // The property that killed the first design. An unserviced downtown that
    // grows *nothing* tells the player nothing: they paid four times the price
    // and are looking at an empty lot. A block that stands and stops at three
    // says "not yet" where it can be seen.
    //
    // At a city, where the era actually expects stations. Written first without
    // this and it read level four, because a village is asked for no services
    // at all and so counts as fully covered — see the test below, which is that
    // behaviour on purpose rather than by accident.
    game.era = 'city';
    const systems = street(true, false);
    grow(systems, false, 1_200);
    // Blocks stand — that is the whole point, against an empty lot — and none
    // of them is a tower. They are stuck at one rather than three, because
    // missing coverage also costs suitability and a plot scoring barely above
    // the spawn threshold creeps; a downtown with no services is a bad downtown
    // as well as a short one.
    expect(game.buildings.size).toBeGreaterThan(5);
    expect(tallest()).toBeLessThanOrEqual(ZONE_LEVEL_CAP);
  });

  it('asks a village for services it has no way to build', () => {
    // Or rather: it does not. Coverage is measured against what the era
    // expects, and a settlement is expected to have nothing — so early dense
    // zoning grows to five on the strength of the four-times price alone. That
    // is the same rule the rubbish and the burials are held to, and it is what
    // stops the feature being a purchase that silently does nothing until the
    // player unlocks a fire station two eras later.
    game.era = 'village';
    const systems = street(true, false);
    grow(systems, false, 1_200);
    expect(tallest()).toBeGreaterThan(ZONE_LEVEL_CAP);
  });

  it('brings a tower down a floor at a time when its ground is downzoned', () => {
    const systems = street(true, true);
    grow(systems, true, 1_200);
    const before = tallest();
    expect(before).toBeGreaterThan(ZONE_LEVEL_CAP);

    // The player changes their mind about the downtown.
    paintZone(game.world, row(20, 1), 'res', 1e9);
    grow(systems, true, 900);
    expect(tallest()).toBeLessThan(before);
    // Down, not away: the block is still standing, just shorter.
    expect(game.buildings.size).toBeGreaterThan(5);
  });
});

describe('an update may not demolish a city that already exists', () => {
  it('grandfathers the towers of a save written before density existed', () => {
    // Every city saved before this feature grew as tall as its services
    // allowed, and plenty of those blocks are above what ordinary zoning now
    // permits. Applying the rule retroactively would start pulling a floor off
    // every tower the player ever built, on the first tick after the update.
    buildRoad(game.world, row(20), 'asphalt', 1e9);
    paintZone(game.world, row(20, 1), 'res', 1e9);
    const systems = new Systems(game.world.size);
    systems.invalidateFields();
    game.demand.res = 1;
    systems.step(game, 1, false);
    for (const b of game.buildings.values()) b.level = 5;

    const file = serialize(game);
    // An older file simply has no column; the loader must not require one.
    const old = { ...file } as Record<string, unknown>;
    delete old['density'];

    const loaded = deserialize(old as unknown as ReturnType<typeof serialize>);
    expect(loaded).not.toBeNull();
    for (const b of loaded!.buildings.values()) {
      expect(b.level).toBe(5);
      expect(isDense(loaded!.world, b.x, b.y)).toBe(true);
    }
  });

  it('carries density through a save and back', () => {
    paintZone(game.world, row(8, 1), 'res', 1e9, true);
    paintZone(game.world, row(8, 2), 'res', 1e9);
    const back = deserialize(serialize(game));
    expect(back).not.toBeNull();
    expect(denseTiles(back!.world)).toBe(8);
    expect(isDense(back!.world, origin.x, origin.y + 1)).toBe(true);
    expect(isDense(back!.world, origin.x, origin.y + 2)).toBe(false);
  });

  it('treats a file with no density column as a city that never built upward', () => {
    paintZone(game.world, row(8, 1), 'res', 1e9);
    const file = { ...serialize(game) } as Record<string, unknown>;
    delete file['density'];
    const back = deserialize(file as unknown as ReturnType<typeof serialize>);
    expect(back).not.toBeNull();
    expect(denseTiles(back!.world)).toBe(0);
  });
});
