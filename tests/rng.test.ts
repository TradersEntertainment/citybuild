import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../src/sim/rng';

describe('seeded RNG', () => {
  it('replays the same stream for the same seed', () => {
    const a = createRng(1337);
    const b = createRng(1337);
    const drawsA = Array.from({ length: 200 }, () => a.next());
    const drawsB = Array.from({ length: 200 }, () => b.next());
    expect(drawsA).toEqual(drawsB);
  });

  it('diverges for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng(9);
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('produces integers inside an inclusive range', () => {
    const rng = createRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) seen.add(rng.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('is roughly uniform', () => {
    const rng = createRng(7);
    const buckets = new Array(10).fill(0) as number[];
    const draws = 100_000;
    for (let i = 0; i < draws; i++) {
      const bucket = Math.floor(rng.next() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(Math.abs(count - draws / 10) / (draws / 10)).toBeLessThan(0.05);
    }
  });

  it('hashes text seeds stably', () => {
    expect(hashSeed('kadastro')).toBe(hashSeed('kadastro'));
    expect(hashSeed('kadastro')).not.toBe(hashSeed('Kadastro'));
  });
});
