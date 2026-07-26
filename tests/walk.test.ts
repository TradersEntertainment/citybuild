import { describe, expect, it } from 'vitest';
import {
  collides,
  moveVector,
  nearestWalkable,
  slide,
  WALK_RADIUS,
  type WalkBlocker,
} from '../src/render3d/walkPhysics';

/**
 * Street-level movement (§15): the circle-on-grid rules the walk mode runs
 * on, tested without a scene — a blocker callback is all the world these
 * functions ever see.
 */

/** A blocker with a single solid tile at (bx, by). */
function wallAt(bx: number, by: number): WalkBlocker {
  return (tx, ty) => tx === bx && ty === by;
}

describe('collision', () => {
  it('a clear circle passes, an overlapping one does not', () => {
    const blocked = wallAt(5, 5);
    expect(collides(blocked, 2.5, 2.5)).toBe(false);
    // The circle's edge crosses into the wall tile.
    expect(collides(blocked, 5 - WALK_RADIUS / 2, 5.5)).toBe(true);
  });

  it('the slide lets you brush along a wall instead of sticking to it', () => {
    // The wall is directly right; a diagonal push slides along it instead.
    const blocked = wallAt(6, 5);
    const next = slide(blocked, 5.5, 5.5, 0.4, -0.4);
    expect(next.x).toBe(5.5);
    expect(next.y).toBeCloseTo(5.1);
  });

  it('free ground moves on both axes', () => {
    const blocked = wallAt(99, 99);
    const next = slide(blocked, 5.5, 5.5, 0.3, 0.3);
    expect(next.x).toBeCloseTo(5.8);
    expect(next.y).toBeCloseTo(5.8);
  });
});

describe('the drop point', () => {
  it('standing on a roof drops you on the nearest free street', () => {
    // A solid block of tiles around (5,5); the walker must land outside it.
    const blocked: WalkBlocker = (tx, ty) => tx >= 4 && tx <= 6 && ty >= 4 && ty <= 6;
    const spot = nearestWalkable(blocked, 5.5, 5.5);
    expect(collides(blocked, spot.x, spot.y)).toBe(false);
  });

  it('an already-clear point is left alone', () => {
    const blocked = wallAt(99, 99);
    const spot = nearestWalkable(blocked, 5.5, 5.5);
    expect(spot.x).toBe(5.5);
    expect(spot.y).toBe(5.5);
  });
});

describe('the move vector', () => {
  it('faces where the camera faces', () => {
    // yaw 0 looks down -z, which in tile space is -y.
    const ahead = moveVector(1, 0, 0);
    expect(ahead.dx).toBeCloseTo(0);
    expect(ahead.dy).toBeCloseTo(-1);

    // A quarter turn: facing +x by the YXZ convention.
    const turned = moveVector(1, 0, -Math.PI / 2);
    expect(turned.dx).toBeCloseTo(1);
    expect(turned.dy).toBeCloseTo(0);
  });

  it('strafe is perpendicular to forward', () => {
    const right = moveVector(0, 1, 0);
    expect(right.dx).toBeCloseTo(1);
    expect(right.dy).toBeCloseTo(0);
  });
});
