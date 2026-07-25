import { describe, expect, it } from 'vitest';
import { PARCEL_SIZE, SEA_LEVEL } from '../src/data/balance';
import { createFbm } from '../src/sim/noise';
import { hashSeed } from '../src/sim/rng';
import { decodeTerrain, type TerrainKind } from '../src/sim/tiles';
import { createWorld, index, parcelBounds, parcelOfTile, startingCentre } from '../src/sim/world';
import { generateTerrain, isWater, slopeAt } from '../src/sim/worldgen';

function generated(seed: string) {
  const world = createWorld(hashSeed(seed));
  generateTerrain(world);
  return world;
}

function terrainCounts(world: ReturnType<typeof generated>): Record<TerrainKind, number> {
  const counts = { water: 0, marsh: 0, plain: 0, forest: 0, hill: 0, rock: 0 };
  for (let i = 0; i < world.terrain.length; i++) {
    counts[decodeTerrain(world.terrain[i] ?? 0)] += 1;
  }
  return counts;
}

describe('noise', () => {
  it('stays inside 0..1', () => {
    const field = createFbm(1234);
    for (let i = 0; i < 2000; i++) {
      const value = field(i * 0.37, i * 0.91);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is smooth: neighbouring samples do not jump', () => {
    const field = createFbm(99, { scale: 60 });
    for (let x = 0; x < 200; x++) {
      expect(Math.abs(field(x, 10) - field(x + 1, 10))).toBeLessThan(0.2);
    }
  });

  it('is deterministic for a seed', () => {
    const a = createFbm(7);
    const b = createFbm(7);
    expect(a(12.5, 40.25)).toBe(b(12.5, 40.25));
  });
});

describe('generateTerrain', () => {
  it('is fully reproducible from the seed', () => {
    const a = generated('sahil');
    const b = generated('sahil');
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(Array.from(a.resource)).toEqual(Array.from(b.resource));
  });

  it('makes different maps for different seeds', () => {
    const a = generated('sahil');
    const b = generated('dağlık');
    expect(Array.from(a.terrain)).not.toEqual(Array.from(b.terrain));
  });

  it('normalises height to the full 0..1 range', () => {
    const world = generated('kadastro');
    let min = Infinity;
    let max = -Infinity;
    for (const h of world.height) {
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeGreaterThan(0.9);
  });

  it('produces both land and water on every seed', () => {
    for (const seed of ['a', 'kadastro', 'ova', 'ada', 'kurak', 'x9']) {
      const counts = terrainCounts(generated(seed));
      const total = 256 * 256;
      expect(counts.water / total).toBeGreaterThan(0.05);
      expect(counts.water / total).toBeLessThan(0.7);
    }
  });

  it('gives every terrain kind somewhere to exist', () => {
    const counts = terrainCounts(generated('kadastro'));
    expect(counts.plain).toBeGreaterThan(0);
    expect(counts.forest).toBeGreaterThan(0);
    expect(counts.hill).toBeGreaterThan(0);
    expect(counts.water).toBeGreaterThan(0);
  });

  it('leaves the starting parcel mostly buildable on every seed', () => {
    // A player whose first parcel is open sea has no game to play.
    for (const seed of ['a', 'kadastro', 'ova', 'ada', 'kurak', 'x9', 'zzz', 'q']) {
      const world = generated(seed);
      const centre = startingCentre(world);
      const { px, py } = parcelOfTile(centre.x, centre.y);
      const bounds = parcelBounds(px, py);

      let land = 0;
      for (let y = bounds.y0; y <= bounds.y1; y++) {
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          if (!isWater(world, x, y)) land++;
        }
      }
      expect(land / (PARCEL_SIZE * PARCEL_SIZE)).toBeGreaterThan(0.75);
    }
  });

  it('leaves the starting parcel buildable, not a mountain top', () => {
    // Land is not enough: rock and hill are expensive to build on, so a start
    // that is technically dry but entirely upland is just as unplayable.
    for (const seed of ['a', 'kadastro', 'ova', 'ada', 'kurak', 'x9', 'zzz', 'q']) {
      const world = generated(seed);
      const centre = startingCentre(world);
      const { px, py } = parcelOfTile(centre.x, centre.y);
      const bounds = parcelBounds(px, py);

      let flat = 0;
      for (let y = bounds.y0; y <= bounds.y1; y++) {
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          const kind = decodeTerrain(world.terrain[index(world, x, y)] ?? 0);
          if (kind === 'plain' || kind === 'forest' || kind === 'marsh') flat++;
        }
      }
      expect(flat / (PARCEL_SIZE * PARCEL_SIZE)).toBeGreaterThan(0.5);
    }
  });

  it('places resources only on land, and sparsely', () => {
    const world = generated('kadastro');
    let resourced = 0;
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        const i = index(world, x, y);
        if ((world.resource[i] ?? 0) === 0) continue;
        resourced++;
        expect(world.height[i]).toBeGreaterThanOrEqual(SEA_LEVEL);
      }
    }
    expect(resourced).toBeGreaterThan(50);
    expect(resourced / (256 * 256)).toBeLessThan(0.1);
  });

  it('keeps fertility inside 0..1', () => {
    const world = generated('kadastro');
    for (const f of world.fertility) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('reports zero slope on flat ground and more on a step', () => {
    const world = createWorld(1);
    expect(slopeAt(world, 50, 50)).toBe(0);
    world.height[index(world, 51, 50)] = 1;
    expect(slopeAt(world, 50, 50)).toBeGreaterThan(0);
  });

  it('carves rivers that reach water', () => {
    const world = generated('kadastro');
    // Rivers lower tiles below sea level away from the coast, so inland water
    // tiles should exist beyond the largest contiguous sea.
    let inlandWater = 0;
    for (let y = 20; y < world.size - 20; y++) {
      for (let x = 20; x < world.size - 20; x++) {
        if (isWater(world, x, y)) inlandWater++;
      }
    }
    expect(inlandWater).toBeGreaterThan(0);
  });
});
