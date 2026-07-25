import { commercialJobs, industrialJobs, residentialCapacity } from './balance';
import type { ZoneKind } from '../sim/tiles';

/**
 * What a building is at each level (§6.3). Levels are the game's main visual
 * reward — the row a player is looking at is the story of their city so far —
 * so the names and the drawing weight both step up together.
 */
export type BuiltZone = 'res' | 'com' | 'ind';
export type Level = 1 | 2 | 3 | 4 | 5;

export interface BuildingLook {
  /** Body colour of the mark on the map. */
  body: string;
  /** Roof or cap colour, one step darker. */
  cap: string;
  /** Footprint as a fraction of the tile; higher levels fill more of it. */
  footprint: number;
  /** Rows of windows drawn at high zoom; 0 for the earliest levels. */
  windows: number;
}

export const BUILDING_LOOKS: Readonly<Record<BuiltZone, readonly BuildingLook[]>> = {
  res: [
    { body: '#B8845A', cap: '#8A5F3E', footprint: 0.46, windows: 0 },
    { body: '#C08A2E', cap: '#8E6420', footprint: 0.56, windows: 1 },
    { body: '#C9A16B', cap: '#8C6C42', footprint: 0.68, windows: 2 },
    { body: '#B7B0A2', cap: '#7E796E', footprint: 0.78, windows: 3 },
    { body: '#9FB6BE', cap: '#5F7A85', footprint: 0.86, windows: 4 },
  ],
  com: [
    { body: '#5E8FA3', cap: '#3E6878', footprint: 0.44, windows: 0 },
    { body: '#4E86A0', cap: '#33606F', footprint: 0.56, windows: 1 },
    { body: '#2C6E8C', cap: '#1E4E64', footprint: 0.68, windows: 2 },
    { body: '#39718A', cap: '#22505F', footprint: 0.80, windows: 3 },
    { body: '#6FA8BF', cap: '#3C7086', footprint: 0.88, windows: 4 },
  ],
  ind: [
    { body: '#A9765C', cap: '#7B5240', footprint: 0.48, windows: 0 },
    { body: '#A34C38', cap: '#743428', footprint: 0.60, windows: 1 },
    { body: '#8E5B4A', cap: '#653E32', footprint: 0.72, windows: 1 },
    { body: '#7E7266', cap: '#584F46', footprint: 0.84, windows: 2 },
    { body: '#8C8B84', cap: '#5E5D58', footprint: 0.92, windows: 2 },
  ],
};

/** Residents housed, or jobs offered, by one building at a level (§20). */
export function capacityOf(zone: BuiltZone, level: Level): number {
  if (zone === 'res') return residentialCapacity(level);
  if (zone === 'com') return commercialJobs(level);
  return industrialJobs(level);
}

/** Zones that grow buildings; farm and park are worked land, not structures. */
export function isBuiltZone(zone: ZoneKind | null): zone is BuiltZone {
  return zone === 'res' || zone === 'com' || zone === 'ind';
}

/** Tint painted over a zoned tile that has not grown anything yet (§6.1). */
export const ZONE_TINTS: Readonly<Record<ZoneKind, string>> = {
  res: '#C08A2E',
  com: '#2C6E8C',
  ind: '#A34C38',
  farm: '#8C9A4A',
  park: '#56784A',
};
