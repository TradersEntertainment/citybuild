import { describe, expect, it } from 'vitest';
import { PARCEL_SIZE, WORLD_SIZE } from '../src/data/balance';
import { hashSeed } from '../src/sim/rng';
import {
  claimParcel,
  createWorld,
  isTileOwned,
  ownedParcelCount,
  parcelBounds,
  parcelOfTile,
  readTile,
  startingCentre,
} from '../src/sim/world';

describe('World', () => {
  it('allocates a 256×256 grid', () => {
    const world = createWorld(1);
    expect(world.size).toBe(WORLD_SIZE);
    expect(world.height.length).toBe(WORLD_SIZE * WORLD_SIZE);
    expect(world.serviceMask.length).toBe(WORLD_SIZE * WORLD_SIZE);
  });

  it('starts with exactly one owned parcel, in the middle', () => {
    const world = createWorld(1);
    expect(ownedParcelCount(world)).toBe(1);
    const centre = startingCentre(world);
    expect(isTileOwned(world, centre.x, centre.y)).toBe(true);
    expect(isTileOwned(world, 0, 0)).toBe(false);
  });

  it('maps tiles to their parcel', () => {
    expect(parcelOfTile(0, 0)).toEqual({ px: 0, py: 0 });
    expect(parcelOfTile(PARCEL_SIZE, PARCEL_SIZE - 1)).toEqual({ px: 1, py: 0 });
    const bounds = parcelBounds(2, 1);
    expect(bounds.x0).toBe(2 * PARCEL_SIZE);
    expect(bounds.x1).toBe(3 * PARCEL_SIZE - 1);
  });

  it('opens neighbouring parcels when claimed', () => {
    const world = createWorld(1);
    claimParcel(world, 0, 0);
    expect(isTileOwned(world, 3, 3)).toBe(true);
    expect(ownedParcelCount(world)).toBe(2);
  });

  it('returns null outside the grid and a blank tile inside it', () => {
    const world = createWorld(hashSeed('kadastro'));
    expect(readTile(world, -1, 0)).toBeNull();
    expect(readTile(world, WORLD_SIZE, 0)).toBeNull();

    const tile = readTile(world, 10, 10);
    expect(tile).not.toBeNull();
    expect(tile?.road).toBeNull();
    expect(tile?.zone).toBeNull();
    expect(tile?.buildingId).toBeNull();
    expect(tile?.terrain).toBe('plain');
  });

  it('is reproducible from a seed', () => {
    const a = createWorld(hashSeed('sahil'));
    const b = createWorld(hashSeed('sahil'));
    expect(a.seed).toBe(b.seed);
    expect(hashSeed('sahil')).not.toBe(hashSeed('dağlık'));
  });
});
