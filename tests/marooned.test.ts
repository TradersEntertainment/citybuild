import { describe, expect, it } from 'vitest';
import { findMarooned, isMarooned } from '../src/sim/marooned';
import { computeConnectivity } from '../src/sim/connectivity';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { WAY, type Way } from '../src/sim/oneWay';
import { index as tileIndex } from '../src/sim/world';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE } from '../src/sim/tiles';
import { index } from '../src/sim/world';

/**
 * A city on a real map, with a working motorway — this check is about the
 * arrows, so the way out of the country has to be genuinely there.
 */
function city(): { game: GameState; ox: number; oy: number } {
  const game = createGameState(hashSeed('marooned'), 0);
  // Anchored to the real motorway, because this check is about the arrows and a
  // street that never reaches the country is connectivity's problem, not this
  // one. The route is generated from the seed, so pick a point off it and lay
  // the city street one tile alongside — connectivity seeds any player road
  // touching an open motorway tile.
  const anchor = game.world.highwayRoute[Math.floor(game.world.highwayRoute.length / 2)]!;
  const ox = anchor.x;
  const oy = anchor.y - 1;
  for (let y = oy - 22; y <= oy + 8; y++) {
    for (let x = ox - 8; x <= ox + 24; x++) {
      if (x < 0 || y < 0 || x >= game.world.size || y >= game.world.size) continue;
      const i = index(game.world, x, y);
      if ((game.world.highway[i] ?? 0) === 1) continue;
      game.world.height[i] = 0.5;
      game.world.terrain[i] = 2;
    }
  }
  // The anchor is nowhere near the starting parcel, and roads may only be laid
  // on ground the city owns.
  game.world.parcelsOwned.fill(1);
  return { game, ox, oy };
}

/**
 * Draws a street running *away* from the motorway, so it meets the country at
 * exactly one tile. A street laid alongside the motorway touches it everywhere
 * and every tile of it is a gate — which is correct, and useless for testing a
 * cut-off district.
 */
function street(game: GameState, from: { x: number; y: number }, length: number) {
  const path = Array.from({ length }, (_, i) => ({ x: from.x, y: from.y - i }));
  buildRoad(game.world, path, 'asphalt', 1e9);
  computeConnectivity(game.world);
  return path;
}

/** Writes the arrow column directly; the brush API takes a whole path. */
function sign(game: GameState, tile: { x: number; y: number }, way: Way): void {
  game.world.oneWay[tileIndex(game.world, tile.x, tile.y)] = way;
}

describe('streets the arrows cut off', () => {
  it('says nothing at all about a city with no arrows', () => {
    const { game, ox, oy } = city();
    street(game, { x: ox, y: oy }, 16);
    const reading = findMarooned(game.world);
    expect(isMarooned(reading)).toBe(false);
    expect(reading.unreachable).toBe(0);
    expect(reading.trapped).toBe(0);
    expect(reading.where).toBeNull();
  });

  it('says nothing about a sensibly signed one-way street', () => {
    const { game, ox, oy } = city();
    const path = street(game, { x: ox, y: oy }, 16);
    // Every tile pointing away from the gate: cars can drive the whole length
    // in, which is a perfectly sensible scheme for a dead-end approach road.
    for (const tile of path) sign(game, tile, WAY.north);
    computeConnectivity(game.world);
    const reading = findMarooned(game.world);
    expect(reading.unreachable).toBe(0);
  });

  it('reports a cul-de-sac signed so nothing can drive in', () => {
    const { game, ox, oy } = city();
    const path = street(game, { x: ox, y: oy }, 16);
    computeConnectivity(game.world);
    // The far half signed back toward the gate: a car may leave it, never enter.
    for (const tile of path.slice(8)) sign(game, tile, WAY.south);
    const reading = findMarooned(game.world);
    expect(reading.unreachable).toBeGreaterThan(0);
    expect(isMarooned(reading)).toBe(true);
    expect(reading.where).not.toBeNull();
  });

  it('points at a tile the player can actually be shown', () => {
    const { game, ox, oy } = city();
    const path = street(game, { x: ox, y: oy }, 16);
    computeConnectivity(game.world);
    for (const tile of path.slice(8)) sign(game, tile, WAY.south);
    const { where } = findMarooned(game.world);
    expect(where).not.toBeNull();
    const at = index(game.world, where!.x, where!.y);
    // Whatever it points at must be a real street, not open ground.
    expect(game.world.road[at]).not.toBe(NONE);
  });

  it('clears the moment the arrows are put right — nothing is unrecoverable', () => {
    const { game, ox, oy } = city();
    const path = street(game, { x: ox, y: oy }, 16);
    computeConnectivity(game.world);
    for (const tile of path.slice(8)) sign(game, tile, WAY.south);
    expect(isMarooned(findMarooned(game.world))).toBe(true);

    for (const tile of path) sign(game, tile, WAY.both);
    expect(isMarooned(findMarooned(game.world))).toBe(false);
  });

  it('does not blame the arrows for a road that was never joined up', () => {
    const { game, ox, oy } = city();
    street(game, { x: ox, y: oy }, 16);
    // A lane out in a field, signed, and connected to nothing.
    const orphan = Array.from({ length: 5 }, (_, i) => ({ x: ox + 6 + i, y: oy - 6 }));
    buildRoad(game.world, orphan, 'asphalt', 1e9);
    for (const tile of orphan) sign(game, tile, WAY.south);
    computeConnectivity(game.world);

    const reading = findMarooned(game.world);
    // Whatever it says, it must not be counting the disconnected lane: that is
    // connectivity's story, and blaming the signs would train the player to
    // ignore this message.
    for (const tile of orphan) {
      const i = index(game.world, tile.x, tile.y);
      if ((game.world.connected[i] ?? 0) === 1) continue;
      expect(reading.unreachable).toBe(0);
    }
  });

  it('is a reading and nothing else — it never touches the world', () => {
    const { game, ox, oy } = city();
    const path = street(game, { x: ox, y: oy }, 16);
    computeConnectivity(game.world);
    for (const tile of path.slice(8)) sign(game, tile, WAY.south);

    const roads = Uint8Array.from(game.world.road as never);
    const ways = Uint8Array.from(game.world.oneWay);
    const connected = Uint8Array.from(game.world.connected);
    findMarooned(game.world);
    expect(Uint8Array.from(game.world.road as never)).toEqual(roads);
    expect(game.world.oneWay).toEqual(ways);
    expect(game.world.connected).toEqual(connected);
  });

  it('gives the same answer twice on the same map', () => {
    const { game, ox, oy } = city();
    const path = street(game, { x: ox, y: oy }, 16);
    computeConnectivity(game.world);
    for (const tile of path.slice(8)) sign(game, tile, WAY.south);
    expect(findMarooned(game.world)).toEqual(findMarooned(game.world));
  });
});
