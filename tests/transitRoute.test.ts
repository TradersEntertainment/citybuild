import { describe, expect, it } from 'vitest';
import type { HighwayPoint } from '../src/sim/highway';
import { exitAhead, routeStepOf, throughLegs } from '../src/render3d/transitRoute';

/**
 * Through-trips on the motorway.
 *
 * The country's traffic crosses the map: in at one edge, out at the other. The
 * first version asked for "the nearer end of the route" for both the way in and
 * the way out, so every visiting car arrived from one edge and left back the same
 * one — a U-turn on a motorway, performed forever. It also stopped both legs one
 * tile short of the junction, leaving a hole the vehicle jumped across.
 *
 * These pin the two properties that were missing: the legs meet at the junction,
 * and the trip ends on the far side of the map from where it started.
 */

const SIZE = 64;

/** A straight route down the middle, so a step index is easy to reason about. */
function route(length = 40): HighwayPoint[] {
  return Array.from({ length }, (_, i) => ({ x: 32, y: 10 + i }));
}

const tile = (p: HighwayPoint): number => p.y * SIZE + p.x;

describe('finding a junction on the route', () => {
  it('gives the step it sits at', () => {
    const r = route();
    expect(routeStepOf(r, SIZE, tile(r[0] as HighwayPoint))).toBe(0);
    expect(routeStepOf(r, SIZE, tile(r[17] as HighwayPoint))).toBe(17);
  });

  it('gives −1 for a tile the road does not pass through', () => {
    expect(routeStepOf(route(), SIZE, 5 * SIZE + 5)).toBe(-1);
  });
});

describe('the two legs of a through-trip', () => {
  it('runs from one edge to the other, not back the way it came', () => {
    const r = route();
    const legs = throughLegs(r, SIZE, 12, 24, 'forward');
    expect(legs).not.toBeNull();
    const { leadIn, leadOut } = legs as { leadIn: Int32Array; leadOut: Int32Array };
    // In at step 0, out at the last step: the far edge, which is the whole point.
    expect(leadIn[0]).toBe(tile(r[0] as HighwayPoint));
    expect(leadOut[leadOut.length - 1]).toBe(tile(r[r.length - 1] as HighwayPoint));
  });

  it('includes the junction at both ends, so the path has no hole in it', () => {
    const r = route();
    const legs = throughLegs(r, SIZE, 12, 24, 'forward');
    const { leadIn, leadOut } = legs as { leadIn: Int32Array; leadOut: Int32Array };
    // The last tile in and the first tile out are the junctions themselves. The
    // street beside a junction is one step away, so the splice is continuous.
    expect(leadIn[leadIn.length - 1]).toBe(tile(r[12] as HighwayPoint));
    expect(leadOut[0]).toBe(tile(r[24] as HighwayPoint));
  });

  it('is 4-connected within each leg', () => {
    const r = route();
    const legs = throughLegs(r, SIZE, 12, 24, 'forward');
    const { leadIn, leadOut } = legs as { leadIn: Int32Array; leadOut: Int32Array };
    for (const leg of [leadIn, leadOut]) {
      for (let i = 1; i < leg.length; i++) {
        const a = leg[i - 1] as number;
        const b = leg[i] as number;
        const step = Math.abs((a % SIZE) - (b % SIZE)) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
        expect(step).toBe(1);
      }
    }
  });

  it('runs the other way when the driver is going the other way', () => {
    const r = route();
    const legs = throughLegs(r, SIZE, 24, 12, 'backward');
    expect(legs).not.toBeNull();
    const { leadIn, leadOut } = legs as { leadIn: Int32Array; leadOut: Int32Array };
    expect(leadIn[0]).toBe(tile(r[r.length - 1] as HighwayPoint));
    expect(leadOut[leadOut.length - 1]).toBe(tile(r[0] as HighwayPoint));
  });

  it('refuses a pair that would be a U-turn', () => {
    const r = route();
    // Going forward but rejoining behind where it left: the car would have to
    // drive back up the motorway it just came down.
    expect(throughLegs(r, SIZE, 24, 12, 'forward')).toBeNull();
    expect(throughLegs(r, SIZE, 12, 24, 'backward')).toBeNull();
  });

  it('accepts leaving and rejoining at the same junction', () => {
    // The common case: a city with one interchange. Not a U-turn — the car
    // arrived from one edge and still leaves by the other.
    const r = route();
    const legs = throughLegs(r, SIZE, 20, 20, 'forward');
    expect(legs).not.toBeNull();
    const { leadIn, leadOut } = legs as { leadIn: Int32Array; leadOut: Int32Array };
    expect(leadIn[leadIn.length - 1]).toBe(tile(r[20] as HighwayPoint));
    expect(leadOut[0]).toBe(tile(r[20] as HighwayPoint));
    expect(leadOut[leadOut.length - 1]).toBe(tile(r[r.length - 1] as HighwayPoint));
  });

  it('covers the whole road between the two legs and the city', () => {
    const r = route();
    const legs = throughLegs(r, SIZE, 12, 24, 'forward');
    const { leadIn, leadOut } = legs as { leadIn: Int32Array; leadOut: Int32Array };
    // Every route tile is either on a leg or between the two junctions, where
    // the car is off the motorway and in the streets.
    for (let step = 0; step < r.length; step++) {
      const t = tile(r[step] as HighwayPoint);
      const onLeg = leadIn.includes(t) || leadOut.includes(t);
      const inCity = step > 12 && step < 24;
      expect(onLeg || inCity).toBe(true);
    }
  });

  it('refuses steps that are not on the road at all', () => {
    const r = route();
    expect(throughLegs(r, SIZE, -1, 10, 'forward')).toBeNull();
    expect(throughLegs(r, SIZE, 10, 999, 'forward')).toBeNull();
  });
});

describe('choosing where to rejoin', () => {
  it('takes the nearest junction ahead', () => {
    const r = route();
    const stepOf = (t: number) => routeStepOf(r, SIZE, t);
    const junctions = [4, 18, 30].map((s) => tile(r[s] as HighwayPoint));
    expect(stepOf(exitAhead(junctions, stepOf, 12, 'forward'))).toBe(18);
    // Going the other way, "ahead" is the other way too.
    expect(stepOf(exitAhead(junctions, stepOf, 12, 'backward'))).toBe(4);
  });

  it('will use the junction it came off, when that is the only one', () => {
    const r = route();
    const stepOf = (t: number) => routeStepOf(r, SIZE, t);
    const only = [tile(r[20] as HighwayPoint)];
    expect(exitAhead(only, stepOf, 20, 'forward')).toBe(only[0]);
  });

  it('finds nothing when every junction is behind', () => {
    const r = route();
    const stepOf = (t: number) => routeStepOf(r, SIZE, t);
    const junctions = [4, 8].map((s) => tile(r[s] as HighwayPoint));
    expect(exitAhead(junctions, stepOf, 20, 'forward')).toBe(-1);
  });

  it('ignores candidates that are not on the road', () => {
    const r = route();
    const stepOf = (t: number) => routeStepOf(r, SIZE, t);
    expect(exitAhead([5 * SIZE + 5], stepOf, 0, 'forward')).toBe(-1);
  });
});
