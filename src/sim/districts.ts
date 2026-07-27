import type { BuiltZone } from '../data/buildings';
import { districtName } from '../data/districtNames';
import type { GameState } from './state';

/**
 * Neighbourhoods (§14.6).
 *
 * A city the player has spent an hour on is still "the city", with no part of
 * it they can point at and name. Districts fix that for almost nothing: the map
 * is cut into coarse blocks, any block with enough buildings in it is a
 * neighbourhood, and its name comes from its own coordinates.
 *
 * Nothing is stored and nothing is decided. A district appears when the
 * buildings are there, is called the same thing every session because the name
 * is a hash of where it is, and quietly stops existing if the player erases it.
 * That is the same contract as everything else here: the player builds, the
 * game reads back what they built.
 */
export interface District {
  name: string;
  /** Tile coordinates of the district's centre of mass. */
  x: number;
  y: number;
  buildings: number;
  population: number;
  /** What the neighbourhood is mostly made of. */
  character: BuiltZone;
}

/** Block side in tiles. Small enough that a city has several, large enough that a street is not one. */
export const DISTRICT_BLOCK = 12;
/** Buildings needed before a cluster is worth a name. */
export const DISTRICT_MIN_BUILDINGS = 8;

interface Accumulator {
  count: number;
  population: number;
  sumX: number;
  sumY: number;
  zones: { res: number; com: number; ind: number; office: number };
}

/**
 * Every named neighbourhood, largest first.
 *
 * Walks the buildings rather than the grid: a city of three thousand buildings
 * on a sixty-five-thousand-tile map is two orders of magnitude cheaper to visit
 * that way, and this runs on a timer rather than once at load.
 */
export function findDistricts(state: GameState): District[] {
  const blocks = new Map<number, Accumulator>();
  const perSide = Math.ceil(state.world.size / DISTRICT_BLOCK);

  for (const building of state.buildings.values()) {
    const bx = Math.floor(building.x / DISTRICT_BLOCK);
    const by = Math.floor(building.y / DISTRICT_BLOCK);
    const key = by * perSide + bx;
    let block = blocks.get(key);
    if (!block) {
      block = { count: 0, population: 0, sumX: 0, sumY: 0, zones: { res: 0, com: 0, ind: 0, office: 0 } };
      blocks.set(key, block);
    }
    block.count++;
    block.population += building.population;
    block.sumX += building.x;
    block.sumY += building.y;
    block.zones[building.zone]++;
  }

  const districts: District[] = [];
  // Sorted by key so the naming pass below is deterministic: two blocks that
  // want the same name have to resolve it the same way every session.
  const keys = [...blocks.keys()].sort((a, b) => a - b);
  const taken = new Set<string>();

  for (const key of keys) {
    const block = blocks.get(key) as Accumulator;
    if (block.count < DISTRICT_MIN_BUILDINGS) continue;

    districts.push({
      name: uniqueName(key, state.seed, taken),
      x: block.sumX / block.count,
      y: block.sumY / block.count,
      buildings: block.count,
      population: block.population,
      character: dominantZone(block.zones),
    });
  }

  districts.sort((a, b) => b.buildings - a.buildings);
  return districts;
}

/**
 * A name no other district has taken.
 *
 * Three hundred and sixty combinations against a dozen neighbourhoods make a
 * clash unlikely but not impossible, and two Yeşiltepes in one city is exactly
 * the sort of thing that gives a generator away. Re-salting is deterministic,
 * so the resolution is the same every time.
 */
function uniqueName(key: number, seed: number, taken: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const name = districtName(hash(key, seed, attempt));
    if (taken.has(name)) continue;
    taken.add(name);
    return name;
  }
  // More districts than names: number them rather than repeat.
  const fallback = `${districtName(hash(key, seed, 0))} ${taken.size}`;
  taken.add(fallback);
  return fallback;
}

function dominantZone(zones: { res: number; com: number; ind: number; office: number }): BuiltZone {
  // Widened with the office zone and, in the widening, fixed: the first version
  // gained `office` in its *type* and kept ignoring it in the comparisons, so a
  // pure business district was labelled by whatever came second. Offices win
  // only outright — every tie keeps its old answer, so no existing city wakes
  // up with its districts renamed.
  if (zones.office > zones.ind && zones.office > zones.com && zones.office > zones.res) {
    return 'office';
  }
  if (zones.ind >= zones.res && zones.ind >= zones.com) return 'ind';
  if (zones.com >= zones.res) return 'com';
  return 'res';
}

/** Integer hash; the same block in the same city always lands on the same name. */
function hash(key: number, seed: number, salt: number): number {
  let h = (key * 374761393 + seed * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}
