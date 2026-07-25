import { PARCEL_SIZE, WORLD_SIZE } from '../data/balance';
import {
  decodeRoad,
  decodeTerrain,
  decodeZone,
  encodeTerrain,
  NONE,
  RESOURCE_ORDER,
  type Tile,
} from './tiles';

/**
 * The 256×256 grid (§4), stored column-per-attribute in typed arrays rather
 * than 65k objects: the diffusion and traffic passes sweep whole columns, and
 * the save codec (§16) can RLE them directly. Phase 0 allocates an empty world;
 * terrain generation arrives in Phase 1.
 */
export interface World {
  readonly size: number;
  readonly seed: number;
  /** 0..1 height. */
  height: Float32Array;
  terrain: Uint8Array;
  fertility: Float32Array;
  resource: Uint8Array;
  road: Uint8Array;
  zone: Uint8Array;
  /** 0 means "no building"; ids start at 1. */
  building: Uint32Array;
  landValue: Float32Array;
  pollution: Float32Array;
  noise: Float32Array;
  serviceMask: Uint8Array;
  /** One flag per parcel: has the player bought it (fog cleared)? */
  parcelsOwned: Uint8Array;
}

export const PARCELS_PER_SIDE = WORLD_SIZE / PARCEL_SIZE;

export function createWorld(seed: number, size: number = WORLD_SIZE): World {
  const cells = size * size;
  const parcelSide = Math.ceil(size / PARCEL_SIZE);
  const world: World = {
    size,
    seed,
    height: new Float32Array(cells),
    terrain: new Uint8Array(cells).fill(encodeTerrain('plain')),
    fertility: new Float32Array(cells),
    resource: new Uint8Array(cells),
    road: new Uint8Array(cells),
    zone: new Uint8Array(cells),
    building: new Uint32Array(cells),
    landValue: new Float32Array(cells),
    pollution: new Float32Array(cells),
    noise: new Float32Array(cells),
    serviceMask: new Uint8Array(cells),
    parcelsOwned: new Uint8Array(parcelSide * parcelSide),
  };
  claimStartingParcel(world);
  return world;
}

export function index(world: World, x: number, y: number): number {
  return y * world.size + x;
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.size && y < world.size;
}

/** Materialises one cell. Used by the inspector and tests, not by hot loops. */
export function readTile(world: World, x: number, y: number): Tile | null {
  if (!inBounds(world, x, y)) return null;
  const i = index(world, x, y);
  return {
    h: world.height[i] ?? 0,
    terrain: decodeTerrain(world.terrain[i] ?? 0),
    fertility: world.fertility[i] ?? 0,
    resource: RESOURCE_ORDER[world.resource[i] ?? 0] ?? 'none',
    road: decodeRoad(world.road[i] ?? NONE),
    zone: decodeZone(world.zone[i] ?? NONE),
    buildingId: (world.building[i] ?? 0) || null,
    landValue: world.landValue[i] ?? 0,
    pollution: world.pollution[i] ?? 0,
    noise: world.noise[i] ?? 0,
    serviceMask: world.serviceMask[i] ?? 0,
  };
}

// --- Parcels (§4) ------------------------------------------------------------

export interface ParcelBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function parcelSide(world: World): number {
  return Math.ceil(world.size / PARCEL_SIZE);
}

export function parcelIndex(world: World, px: number, py: number): number {
  return py * parcelSide(world) + px;
}

export function parcelOfTile(x: number, y: number): { px: number; py: number } {
  return { px: Math.floor(x / PARCEL_SIZE), py: Math.floor(y / PARCEL_SIZE) };
}

export function parcelBounds(px: number, py: number): ParcelBounds {
  return {
    x0: px * PARCEL_SIZE,
    y0: py * PARCEL_SIZE,
    x1: px * PARCEL_SIZE + PARCEL_SIZE - 1,
    y1: py * PARCEL_SIZE + PARCEL_SIZE - 1,
  };
}

export function isParcelOwned(world: World, px: number, py: number): boolean {
  const side = parcelSide(world);
  if (px < 0 || py < 0 || px >= side || py >= side) return false;
  return world.parcelsOwned[parcelIndex(world, px, py)] === 1;
}

export function isTileOwned(world: World, x: number, y: number): boolean {
  const { px, py } = parcelOfTile(x, y);
  return isParcelOwned(world, px, py);
}

export function ownedParcelCount(world: World): number {
  let count = 0;
  for (let i = 0; i < world.parcelsOwned.length; i++) {
    if (world.parcelsOwned[i] === 1) count++;
  }
  return count;
}

export function claimParcel(world: World, px: number, py: number): void {
  const side = parcelSide(world);
  if (px < 0 || py < 0 || px >= side || py >= side) return;
  world.parcelsOwned[parcelIndex(world, px, py)] = 1;
}

/** The player starts on the single central parcel; the rest is fog (§4). */
export function claimStartingParcel(world: World): ParcelBounds {
  const centre = Math.floor(parcelSide(world) / 2);
  claimParcel(world, centre, centre);
  return parcelBounds(centre, centre);
}

/** Centre of the starting parcel in tile coordinates — the camera's home. */
export function startingCentre(world: World): { x: number; y: number } {
  const centre = Math.floor(parcelSide(world) / 2);
  const b = parcelBounds(centre, centre);
  return { x: (b.x0 + b.x1 + 1) / 2, y: (b.y0 + b.y1 + 1) / 2 };
}
