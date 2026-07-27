/** Tile vocabulary and bit fields (§4, §19). Pure data — no DOM, no canvas. */

export type TerrainKind = 'water' | 'marsh' | 'plain' | 'forest' | 'hill' | 'rock';
export type ResourceKind = 'none' | 'coal' | 'iron' | 'stone' | 'clay';
export type RoadKind = 'path' | 'stone' | 'asphalt' | 'boulevard' | 'highway' | 'metro';
export type ZoneKind = 'res' | 'com' | 'ind' | 'farm' | 'park';
export type Era = 'founding' | 'village' | 'town' | 'city' | 'metro' | 'metropolis' | 'megacity';

/** Stored as small integers in typed arrays; these are the encodings. */
export const TERRAIN_ORDER: readonly TerrainKind[] = [
  'water',
  'marsh',
  'plain',
  'forest',
  'hill',
  'rock',
];
export const RESOURCE_ORDER: readonly ResourceKind[] = ['none', 'coal', 'iron', 'stone', 'clay'];
export const ROAD_ORDER: readonly RoadKind[] = [
  'path',
  'stone',
  'asphalt',
  'boulevard',
  'highway',
  'metro',
];
export const ZONE_ORDER: readonly ZoneKind[] = ['res', 'com', 'ind', 'farm', 'park'];
/**
 * Eras in the order they arrive. Everything that gates on an era compares ranks
 * from this one list — three separate copies of it had already accumulated, and
 * an era added to one and missed in another is a silent unlock bug rather than
 * a type error.
 */
export const ERA_ORDER: readonly Era[] = [
  'founding',
  'village',
  'town',
  'city',
  'metro',
  'metropolis',
  'megacity',
];

export function eraRank(era: Era): number {
  return ERA_ORDER.indexOf(era);
}

/** True when the city has reached `required` or gone past it. */
export function eraReached(era: Era, required: Era): boolean {
  return eraRank(era) >= eraRank(required);
}

/** Zone and road columns use 0 for "none", so kinds are stored offset by one. */
export const NONE = 0;

export function encodeTerrain(kind: TerrainKind): number {
  return TERRAIN_ORDER.indexOf(kind);
}

export function decodeTerrain(code: number): TerrainKind {
  return TERRAIN_ORDER[code] ?? 'plain';
}

export function encodeZone(kind: ZoneKind | null): number {
  return kind === null ? NONE : ZONE_ORDER.indexOf(kind) + 1;
}

export function decodeZone(code: number): ZoneKind | null {
  return code === NONE ? null : (ZONE_ORDER[code - 1] ?? null);
}

export function encodeRoad(kind: RoadKind | null): number {
  return kind === null ? NONE : ROAD_ORDER.indexOf(kind) + 1;
}

export function decodeRoad(code: number): RoadKind | null {
  return code === NONE ? null : (ROAD_ORDER[code - 1] ?? null);
}

/** serviceMask bit field (§19). */
export const SERVICE = {
  water: 1 << 0,
  power: 1 << 1,
  fire: 1 << 2,
  health: 1 << 3,
  education: 1 << 4,
  police: 1 << 5,
  cemetery: 1 << 6,
  depot: 1 << 7,
} as const;

/** Building.issues bit field (§19) — drives the icon over a failing building. */
export const ISSUE = {
  noWater: 1 << 0,
  noPower: 1 << 1,
  traffic: 1 << 2,
  pollution: 1 << 3,
  noService: 1 << 4,
  noise: 1 << 5,
  noRubbish: 1 << 6,
} as const;

export interface RoadSegment {
  kind: RoadKind;
  flow: number;
  capacity: number;
  wear: number;
  lifetimeTrips: number;
  nodeA: number;
  nodeB: number;
}

/** A materialised read of one grid cell; the grid itself stays columnar. */
export interface Tile {
  h: number;
  terrain: TerrainKind;
  fertility: number;
  resource: ResourceKind;
  road: RoadKind | null;
  zone: ZoneKind | null;
  /** Zoned for height (sim/density.ts): the difference between three and five. */
  dense: boolean;
  buildingId: number | null;
  landValue: number;
  pollution: number;
  noise: number;
  serviceMask: number;
}
