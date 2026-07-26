import { describe, expect, it } from 'vitest';
import { catmullRom, catmullRomSlope } from '../src/render3d/traffic';

/**
 * A route is a list of tiles, and a road at an angle is a staircase of them.
 * Driving straight between tile centres made every vehicle weave — right, down,
 * right, down — with the heading snapping a quarter turn each step, along a road
 * the surface layer draws as one straight ribbon.
 *
 * What has to hold: the curve still goes through the tiles the router chose, and
 * it stops turning corners.
 */
describe('the curve a vehicle drives', () => {
  it('passes exactly through the tiles it was routed along', () => {
    // A vehicle that cuts a corner it was told to drive through is a vehicle
    // driving over somebody's garden.
    expect(catmullRom(0, 3, 7, 9, 0)).toBeCloseTo(3, 9);
    expect(catmullRom(0, 3, 7, 9, 1)).toBeCloseTo(7, 9);
  });

  it('stays between the two tiles it is travelling between', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const value = catmullRom(0, 1, 2, 3, t);
      expect(value).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(value).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('runs at constant speed down a straight, adding nothing of its own', () => {
    // Four collinear points must give back the straight line, or every vehicle
    // on a straight road would sway.
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      expect(catmullRom(0, 1, 2, 3, t)).toBeCloseTo(1 + t, 9);
      expect(catmullRomSlope(0, 1, 2, 3, t)).toBeCloseTo(1, 9);
    }
  });

  it('cuts the corner of a staircase instead of turning it', () => {
    // The classic step: across, then down. Halfway along, a vehicle following
    // the tile grid is still at the corner; one following the curve has already
    // started to turn.
    const x = catmullRom(0, 0, 1, 1, 0.5);
    const z = catmullRom(0, 1, 1, 2, 0.5);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1);
    expect(z).toBeGreaterThan(0.9);
    expect(z).toBeLessThan(1.1);
  });

  it('turns gradually rather than snapping a quarter turn', () => {
    // Heading sampled across a corner: the biggest single step must be small.
    // This is the weave itself, stated as a number.
    let worst = 0;
    let previous = Math.atan2(catmullRomSlope(0, 0, 1, 1, 0), catmullRomSlope(0, 1, 1, 2, 0));
    for (let i = 1; i <= 40; i++) {
      const t = i / 40;
      const heading = Math.atan2(
        catmullRomSlope(0, 0, 1, 1, t),
        catmullRomSlope(0, 1, 1, 2, t),
      );
      worst = Math.max(worst, Math.abs(heading - previous));
      previous = heading;
    }
    // A tile-grid path would put a full 90° into one frame here.
    expect(worst).toBeLessThan(Math.PI / 8);
  });

  it('never stops dead mid-segment, which would freeze the heading', () => {
    // A zero tangent makes atan2 return whatever it likes, and the vehicle
    // would flick to face north for a frame.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const dx = catmullRomSlope(0, 0, 1, 1, t);
      const dz = catmullRomSlope(0, 1, 1, 2, t);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.01);
    }
  });
});
