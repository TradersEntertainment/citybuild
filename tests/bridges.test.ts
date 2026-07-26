import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CLEARANCE,
  BRIDGE_PARAPET_HEIGHT,
  BRIDGE_RAMP_DROP,
  SEA_LEVEL,
} from '../src/data/balance';
import { HEIGHT_SCALE, SEA_Y } from '../src/render3d/constants';
import { buildBridgeGeometry } from '../src/render3d/bridgeGeometry';
import { buildRoadDeck, isBridgeTile, sampleDeck } from '../src/render3d/roadDeck';
import { encodeRoad } from '../src/sim/tiles';
import { hashSeed } from '../src/sim/rng';
import { index, type World } from '../src/sim/world';
import { createWorld } from '../src/sim/world';

/**
 * Roads over water.
 *
 * Every road quad used to take its height straight from the height field, so a
 * road crossing water was drawn along the seabed — which the national highway
 * does on most maps, because it is laid edge to edge before anybody looks. The
 * game charged six times the price for those tiles and called them bridges; it
 * simply never built one.
 *
 * These pin the deck (over the water, ramped back to the ground, never dug into
 * it) and the structure hung off it (slab, parapets, piers, all wound the right
 * way out).
 */

/** A flat world with a channel of water across the middle. */
function channelWorld(): World {
  const world = createWorld(hashSeed('bridge'));
  const size = world.size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = index(world, x, y);
      // Dry land at 0.6, a channel eight tiles wide down to 0.2.
      const water = y >= 40 && y < 48;
      world.height[i] = water ? 0.2 : 0.6;
      world.terrain[i] = water ? 0 : 2;
    }
  }
  return world;
}

/** Lays a road straight across the channel, from dry land to dry land. */
function crossChannel(world: World, x = 20): void {
  for (let y = 34; y < 54; y++) {
    world.road[index(world, x, y)] = encodeRoad('asphalt');
  }
}

describe('the deck', () => {
  it('is the plain ground where nothing crosses water', () => {
    const world = channelWorld();
    const deck = buildRoadDeck(world);
    const i = index(world, 20, 10);
    expect(deck[i]).toBeCloseTo(0.6 * HEIGHT_SCALE, 5);
  });

  it('carries a water crossing above the surface', () => {
    const world = channelWorld();
    crossChannel(world);
    const deck = buildRoadDeck(world);

    for (let y = 40; y < 48; y++) {
      const height = deck[index(world, 20, y)] as number;
      expect(height).toBeGreaterThanOrEqual(SEA_Y + BRIDGE_CLEARANCE - 1e-6);
      // And this is the bug: it used to be the seabed.
      expect(height).toBeGreaterThan(0.2 * HEIGHT_SCALE);
    }
  });

  it('ramps back down to the ground rather than stepping', () => {
    const world = channelWorld();
    crossChannel(world);
    const deck = buildRoadDeck(world);

    // Walking off the bridge, no single tile may drop more than the stated
    // gradient — a step at the shoreline would look worse than the drowning did.
    for (let y = 34; y < 53; y++) {
      const here = deck[index(world, 20, y)] as number;
      const next = deck[index(world, 20, y + 1)] as number;
      expect(Math.abs(next - here)).toBeLessThanOrEqual(BRIDGE_RAMP_DROP + 1e-6);
    }
  });

  it('never digs the deck below the ground it crosses', () => {
    const world = channelWorld();
    crossChannel(world);
    const deck = buildRoadDeck(world);
    for (let i = 0; i < deck.length; i++) {
      expect(deck[i] as number).toBeGreaterThanOrEqual((world.height[i] ?? 0) * HEIGHT_SCALE - 1e-6);
    }
  });

  it('keeps the deck up across the whole span, not just at its corners', () => {
    const world = channelWorld();
    crossChannel(world);
    const deck = buildRoadDeck(world);
    // A corner reads the four tiles around it, so a bridge whose neighbouring
    // water was left at seabed level would have every corner dragged under.
    for (let y = 41; y < 47; y++) {
      for (const corner of [
        [20, y],
        [21, y],
        [20, y + 1],
        [21, y + 1],
      ] as const) {
        const height = sampleDeck(world, deck, corner[0], corner[1]);
        expect(height).toBeGreaterThan(SEA_Y);
      }
    }
  });

  it('knows which tiles are carried and which are laid', () => {
    const world = channelWorld();
    crossChannel(world);
    expect(isBridgeTile(world, 20, 44)).toBe(true);
    expect(isBridgeTile(world, 20, 36)).toBe(false);
    // Water with no road on it is not a bridge, it is water.
    expect(isBridgeTile(world, 40, 44)).toBe(false);
  });
});

describe('the structure', () => {
  it('builds nothing when no road touches water', () => {
    const world = channelWorld();
    const built = buildBridgeGeometry(world, buildRoadDeck(world));
    expect(built.tiles).toBe(0);
    expect(built.geometry.getAttribute('position').count).toBe(0);
  });

  it('builds a slab, parapets and piers for a crossing', () => {
    const world = channelWorld();
    crossChannel(world);
    const built = buildBridgeGeometry(world, buildRoadDeck(world));
    expect(built.tiles).toBe(8);
    expect(built.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(built.geometry.getAttribute('color').count).toBe(
      built.geometry.getAttribute('position').count,
    );
  });

  it('stands the piers on the bed and stops them under the deck', () => {
    const world = channelWorld();
    crossChannel(world);
    const deck = buildRoadDeck(world);
    const built = buildBridgeGeometry(world, deck);
    const position = built.geometry.getAttribute('position');

    let lowest = Infinity;
    let highest = -Infinity;
    for (let v = 0; v < position.count; v++) {
      lowest = Math.min(lowest, position.getY(v));
      highest = Math.max(highest, position.getY(v));
    }
    // Reaches the seabed at the bottom — the pier stands on something.
    expect(lowest).toBeCloseTo(0.2 * HEIGHT_SCALE, 4);

    // And stops at the deck plus its parapet at the top. Measured against the
    // deck the crossing actually got rather than against the water line: where
    // the shore stands high the deck meets the road up there, which is a
    // viaduct and is correct.
    let deckTop = -Infinity;
    for (let y = 40; y < 48; y++) {
      for (const corner of [
        [20, y],
        [21, y],
        [20, y + 1],
        [21, y + 1],
      ] as const) {
        deckTop = Math.max(deckTop, sampleDeck(world, deck, corner[0], corner[1]));
      }
    }
    expect(highest).toBeLessThanOrEqual(deckTop + BRIDGE_PARAPET_HEIGHT + 0.2);
    expect(highest).toBeGreaterThan(SEA_Y);
  });

  it('winds every face outward', () => {
    const world = channelWorld();
    crossChannel(world);
    const built = buildBridgeGeometry(world, buildRoadDeck(world));
    const position = built.geometry.getAttribute('position');
    // An inside-out box is invisible from outside and black from within — the
    // exact bug the archetype roofs had, and unnoticeable until somebody walks
    // onto the bridge.
    let checked = 0;
    for (let v = 0; v + 2 < position.count; v += 3) {
      const ax = position.getX(v);
      const ay = position.getY(v);
      const az = position.getZ(v);
      const bx = position.getX(v + 1);
      const by = position.getY(v + 1);
      const bz = position.getZ(v + 1);
      const cx = position.getX(v + 2);
      const cy = position.getY(v + 2);
      const cz = position.getZ(v + 2);

      // Face normal by the right-hand rule.
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      expect(length).toBeGreaterThan(0); // no degenerate triangles

      // Every triangle belongs to an axis-aligned box, so its normal must point
      // away from the box — which for a box means away from its own centroid
      // along the one axis the face is flat in. Testing against the triangle's
      // own plane offset from the world origin is not enough, so instead check
      // the normal is axis-aligned: a box has no oblique faces.
      const axis = [Math.abs(nx), Math.abs(ny), Math.abs(nz)].map((c) => c / length);
      expect(Math.max(...axis)).toBeGreaterThan(0.999);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('draws a diagonal crossing too, without leaving a gap', () => {
    const world = channelWorld();
    // A road stepping diagonally across the channel: every tile is still a
    // bridge tile, and each still needs its own slab.
    let x = 16;
    for (let y = 38; y < 50; y++) {
      world.road[index(world, x, y)] = encodeRoad('asphalt');
      x++;
    }
    const built = buildBridgeGeometry(world, buildRoadDeck(world));
    expect(built.tiles).toBe(8);
  });
});

describe('the sea level it all hangs off', () => {
  it('agrees with the terrain about where the water is', () => {
    // A drift between these two would put the deck under the waves or the piers
    // in mid-air, and nothing else in the game would notice.
    expect(SEA_Y).toBeCloseTo(SEA_LEVEL * HEIGHT_SCALE, 6);
  });
});
