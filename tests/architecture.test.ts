import { describe, expect, it } from 'vitest';
import type { BuiltZone } from '../src/data/buildings';
import {
  archetypeFor,
  periodOf,
  PERIOD_ORDER,
  type Archetype,
} from '../src/render3d/archetypes';
import { buildArchetypeGeometry } from '../src/render3d/buildings';
import { ERA_ORDER } from '../src/sim/tiles';

/**
 * A roof wound the wrong way round is invisible from outside and black from
 * within, and it is not the sort of thing a screenshot makes obvious — a
 * pitched roof read as a hole in the sky the first time this was written.
 */
const ZONES: readonly BuiltZone[] = ['res', 'com', 'ind'];

function everyArchetype(): Archetype[] {
  const all: Archetype[] = [];
  for (const period of PERIOD_ORDER) {
    for (const zone of ZONES) {
      for (let level = 1; level <= 5; level++) all.push(archetypeFor(period, zone, level));
    }
  }
  return all;
}

describe('the periods', () => {
  it('covers every era', () => {
    for (const era of ERA_ORDER) {
      expect(PERIOD_ORDER).toContain(periodOf(era));
    }
  });

  it('never goes backwards as the city ages', () => {
    let last = -1;
    for (const era of ERA_ORDER) {
      const rank = PERIOD_ORDER.indexOf(periodOf(era));
      expect(rank).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });

  it('starts a settlement in the earliest period and ends a megacity in the latest', () => {
    expect(periodOf('founding')).toBe('early');
    expect(periodOf('megacity')).toBe('modern');
  });

  it('has five levels for every zone in every period', () => {
    expect(everyArchetype()).toHaveLength(PERIOD_ORDER.length * ZONES.length * 5);
  });
});

describe('the archetypes themselves', () => {
  it('gets taller with every level', () => {
    for (const period of PERIOD_ORDER) {
      for (const zone of ZONES) {
        for (let level = 2; level <= 5; level++) {
          const lower = archetypeFor(period, zone, level - 1);
          const upper = archetypeFor(period, zone, level);
          expect(upper.height).toBeGreaterThan(lower.height);
          expect(upper.footprint).toBeGreaterThanOrEqual(lower.footprint);
        }
      }
    }
  });

  it('never spills a building outside its own tile', () => {
    for (const spec of everyArchetype()) {
      expect(spec.footprint).toBeGreaterThan(0);
      expect(spec.footprint).toBeLessThan(1);
    }
  });

  it('builds the settlement in pitched roofs and the metropolis in flat ones', () => {
    const early = ZONES.map((z) => archetypeFor('early', z, 1));
    expect(early.every((spec) => spec.roofPitch > 0)).toBe(true);
    const tall = ZONES.map((z) => archetypeFor('modern', z, 5));
    expect(tall.every((spec) => spec.roofPitch === 0)).toBe(true);
  });
});

describe('the geometry', () => {
  /** Every face, as its centroid and its outward normal. */
  function faces(spec: Archetype): { centre: number[]; normal: number[] }[] {
    const geometry = buildArchetypeGeometry(spec);
    const position = geometry.getAttribute('position');
    const out: { centre: number[]; normal: number[] }[] = [];
    for (let i = 0; i < position.count; i += 3) {
      const p = [0, 1, 2].map((k) => [
        position.getX(i + k),
        position.getY(i + k),
        position.getZ(i + k),
      ]) as number[][];
      const [a, b, c] = p as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const normal = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ];
      const centre = [0, 1, 2].map((k) => (a[k]! + b[k]! + c[k]!) / 3);
      out.push({ centre, normal });
    }
    geometry.dispose();
    return out;
  }

  it('points every face away from the middle of the building', () => {
    for (const spec of everyArchetype()) {
      // The solid's own centre: half the wall height, since the roof is a cap.
      const middle = [0, spec.height / 2, 0];
      for (const face of faces(spec)) {
        const away = [0, 1, 2].map((k) => face.centre[k]! - middle[k]!);
        const dot = away.reduce((sum, value, k) => sum + value * face.normal[k]!, 0);
        // A face whose normal points back into the solid is inside-out.
        expect(dot).toBeGreaterThan(0);
      }
    }
  });

  it('has no degenerate triangles, which would render as nothing', () => {
    for (const spec of everyArchetype()) {
      for (const face of faces(spec)) {
        const length = Math.hypot(...face.normal);
        expect(length).toBeGreaterThan(1e-9);
      }
    }
  });

  it('sits on the ground, so scaling makes it rise rather than sink', () => {
    for (const spec of everyArchetype()) {
      const geometry = buildArchetypeGeometry(spec);
      const position = geometry.getAttribute('position');
      let lowest = Infinity;
      let highest = -Infinity;
      for (let i = 0; i < position.count; i++) {
        lowest = Math.min(lowest, position.getY(i));
        highest = Math.max(highest, position.getY(i));
      }
      expect(lowest).toBe(0);
      expect(highest).toBeCloseTo(spec.height + spec.roofPitch, 6);
      geometry.dispose();
    }
  });

  it('splits into exactly two material groups: walls, then roof', () => {
    for (const spec of everyArchetype()) {
      const geometry = buildArchetypeGeometry(spec);
      expect(geometry.groups).toHaveLength(2);
      expect(geometry.groups[0]?.materialIndex).toBe(0);
      expect(geometry.groups[1]?.materialIndex).toBe(1);
      // Four walls of two triangles each.
      expect(geometry.groups[0]?.count).toBe(24);
      const total = geometry.groups.reduce((sum, g) => sum + g.count, 0);
      expect(total).toBe(geometry.getAttribute('position').count);
      geometry.dispose();
    }
  });
});
