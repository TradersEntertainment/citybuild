import { beforeEach, describe, expect, it } from 'vitest';
import type { TilePoint } from '../src/input/pathGeometry';
import { ROAD_WIDTH } from '../src/render3d/constants';
import { buildRoadGeometry, classifyRoads, SHAPE } from '../src/render3d/roadGeometry';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE } from '../src/sim/tiles';
import { index, startingCentre, type World } from '../src/sim/world';

/**
 * A road drawn tile by tile climbs a diagonal as a staircase of squares that
 * meet only at their corners. The player's finger did not do that, so neither
 * should the surface — and the failure it replaces (a band wound the wrong way
 * round) is invisible from above rather than obviously wrong.
 */
let game: GameState;
let world: World;
let origin: { x: number; y: number };

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.terrain[i] = 2;
    }
  }
}

function diagonal(length: number, dy: 1 | -1): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + i * dy }));
}

function straight(length: number): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y }));
}

function shapeAt(shapes: Uint8Array, x: number, y: number): number {
  return shapes[index(world, x, y)] ?? SHAPE.none;
}

/**
 * These fixtures draw their own roads and count every vertex the builder
 * makes; the national highway would add a map's worth of surface they did not
 * ask about, so it is stripped. Its presence in the road column needs no
 * special casing here — it renders like any highway tier.
 */
function stripHighway(w: World): void {
  for (let i = 0; i < w.road.length; i++) {
    if ((w.highway[i] ?? 0) === 1) w.road[i] = NONE;
  }
  w.highway.fill(0);
  w.highwayRoute = [];
}

beforeEach(() => {
  game = createGameState(hashSeed('roads3d'), 0);
  world = game.world;
  stripHighway(world);
  const centre = startingCentre(world);
  origin = { x: Math.floor(centre.x) - 8, y: Math.floor(centre.y) - 4 };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 20);
});

describe('how a tile decides what shape it is', () => {
  it('leaves a straight run square', () => {
    buildRoad(world, straight(10), 'asphalt', 1_000_000);
    const shapes = classifyRoads(world);
    expect(shapeAt(shapes, origin.x + 5, origin.y)).toBe(SHAPE.square);
  });

  it('makes the middle of a rising diagonal a ribbon', () => {
    buildRoad(world, diagonal(10, 1), 'asphalt', 1_000_000);
    const shapes = classifyRoads(world);
    expect(shapeAt(shapes, origin.x + 5, origin.y + 5)).toBe(SHAPE.rising);
  });

  it('makes a falling diagonal the other ribbon', () => {
    buildRoad(world, diagonal(10, -1), 'asphalt', 1_000_000);
    const shapes = classifyRoads(world);
    expect(shapeAt(shapes, origin.x + 5, origin.y - 5)).toBe(SHAPE.falling);
  });

  it('keeps the ends of a diagonal square, since a run needs two neighbours', () => {
    buildRoad(world, diagonal(10, 1), 'asphalt', 1_000_000);
    const shapes = classifyRoads(world);
    expect(shapeAt(shapes, origin.x, origin.y)).toBe(SHAPE.square);
    expect(shapeAt(shapes, origin.x + 9, origin.y + 9)).toBe(SHAPE.square);
  });

  it('keeps a tile square where a diagonal meets the grid', () => {
    buildRoad(world, diagonal(10, 1), 'asphalt', 1_000_000);
    // A spur off the middle of the run: that tile is now a junction.
    buildRoad(world, [{ x: origin.x + 5, y: origin.y + 5 }, { x: origin.x + 6, y: origin.y + 5 }],
      'asphalt', 1_000_000);
    const shapes = classifyRoads(world);
    expect(shapeAt(shapes, origin.x + 5, origin.y + 5)).toBe(SHAPE.square);
  });

  it('keeps a crossing square rather than picking one of its two runs', () => {
    buildRoad(world, diagonal(9, 1), 'asphalt', 1_000_000);
    buildRoad(
      world,
      Array.from({ length: 9 }, (_, i) => ({ x: origin.x + i, y: origin.y + 8 - i })),
      'asphalt',
      1_000_000,
    );
    const shapes = classifyRoads(world);
    expect(shapeAt(shapes, origin.x + 4, origin.y + 4)).toBe(SHAPE.square);
  });

  it('says nothing about unpaved ground', () => {
    buildRoad(world, straight(10), 'asphalt', 1_000_000);
    const shapes = classifyRoads(world);
    expect(shapeAt(shapes, origin.x + 5, origin.y + 6)).toBe(SHAPE.none);
  });
});

describe('the surface it produces', () => {
  /** Every triangle's upward normal component. */
  function upwardness(geometry: { getAttribute(name: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } }): number[] {
    const position = geometry.getAttribute('position');
    const out: number[] = [];
    for (let i = 0; i < position.count; i += 3) {
      const p = [0, 1, 2].map((k) => [
        position.getX(i + k),
        position.getY(i + k),
        position.getZ(i + k),
      ]);
      const [a, b, c] = p as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      out.push(u[2]! * v[0]! - u[0]! * v[2]!);
    }
    return out;
  }

  it('faces every triangle upward, on a diagonal as on a straight', () => {
    buildRoad(world, diagonal(12, 1), 'asphalt', 1_000_000);
    buildRoad(world, straight(12), 'asphalt', 1_000_000);
    const built = buildRoadGeometry(world);
    for (const up of upwardness(built.surface)) expect(up).toBeGreaterThan(0);
    for (const up of upwardness(built.markings)) expect(up).toBeGreaterThan(0);
    built.surface.dispose();
    built.markings.dispose();
  });

  it('carries one colour per vertex, or the surface renders black', () => {
    buildRoad(world, diagonal(12, 1), 'asphalt', 1_000_000);
    const built = buildRoadGeometry(world);
    const position = built.surface.getAttribute('position');
    const colour = built.surface.getAttribute('color');
    expect(colour.count).toBe(position.count);
    built.surface.dispose();
    built.markings.dispose();
  });

  it('overlaps consecutive tiles of a diagonal rather than meeting at a point', () => {
    buildRoad(world, diagonal(12, 1), 'asphalt', 1_000_000);
    const built = buildRoadGeometry(world);
    const position = built.surface.getAttribute('position');

    // The corner shared by the tiles at (+4,+4) and (+5,+5). Both bands have to
    // reach past it — if each stopped exactly there they would touch at a single
    // point, and a join you can see through is the thing this replaces.
    const cornerX = origin.x + 5;
    const cornerZ = origin.y + 5;
    // How far from the corner to go looking, derived from the carriageway rather
    // than picked. A band overshoots by half its width and is half a width across,
    // so its end vertices sit at half·√2 — 0.71 of a width — from the corner, and
    // the next tile's far end is a full 1.2 widths beyond that. One width is the
    // window between them. It used to be a flat 0.5, which happened to clear
    // 0.71 × 0.7 by one per cent and silently stopped being a tolerance the day
    // the asphalt got wider.
    const window = ROAD_WIDTH['asphalt'] as number;
    let before = 0;
    let after = 0;
    for (let i = 0; i < position.count; i++) {
      const dx = position.getX(i) - cornerX;
      const dz = position.getZ(i) - cornerZ;
      if (Math.hypot(dx, dz) >= window) continue;
      // Distance along the run, signed: the band that ends here should overshoot
      // and the band that starts here should begin early.
      const along = (dx + dz) / Math.SQRT2;
      if (along > 0.1) after++;
      if (along < -0.1) before++;
    }
    expect(after).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
    built.surface.dispose();
    built.markings.dispose();
  });

  it('draws nothing at all for a map with no roads', () => {
    const built = buildRoadGeometry(world);
    expect(built.surface.getAttribute('position').count).toBe(0);
    built.surface.dispose();
    built.markings.dispose();
  });
});
