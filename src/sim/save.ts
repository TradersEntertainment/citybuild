import { SAVE_VERSION } from '../data/balance';
import type { BuiltZone, Level } from '../data/buildings';
import type { Building } from './buildings';
import { createGameState, type GameState } from './state';
import type { Era } from './tiles';
import { index } from './world';

/**
 * Save codec (§16).
 *
 * The map is not in the save. Terrain generation is deterministic in the seed —
 * that is a tested property, not an assumption — so height, terrain, fertility
 * and resources are regenerated on load and only what the player did is stored:
 * the road and zone columns, which parcels they own, and the buildings that
 * grew. Those columns are almost entirely empty, so they are run-length encoded
 * and a large city still fits in a few kilobytes of localStorage.
 *
 * Derived fields (land value, pollution, noise, service coverage, and the tile
 * → building index) are left out too. They are recomputed from the columns on
 * the first tick after loading, and storing them would only create a way for a
 * save to disagree with itself.
 */
export interface SaveData {
  version: number;
  seed: number;
  tick: number;
  era: Era;
  playedMs: number;
  money: number;
  debt: number;
  taxRate: number;
  happiness: number;
  research: number;
  demand: { res: number; com: number; ind: number };
  farmTiles: number;
  nextBuildingId: number;
  lastSeen: number;
  /** Run-length encoded grid columns: [value, runLength, value, runLength, …]. */
  road: number[];
  zone: number[];
  parcelsOwned: number[];
  /** Buildings, flattened; see BUILDING_FIELDS for the column order. */
  buildings: number[];
}

/** Fields packed per building, in order. Zone is stored as an index. */
const ZONES: readonly BuiltZone[] = ['res', 'com', 'ind'];
const BUILDING_FIELDS = 12;

export function serialize(state: GameState): SaveData {
  const buildings: number[] = [];
  for (const b of state.buildings.values()) {
    buildings.push(
      b.id,
      b.x,
      b.y,
      ZONES.indexOf(b.zone),
      b.level,
      Math.round(b.score * 1000) / 1000,
      Math.round(b.growthProgress * 1000) / 1000,
      Math.round(b.decayTimer * 100) / 100,
      Math.round(b.population * 100) / 100,
      Math.round(b.jobs * 100) / 100,
      b.builtAt,
      b.variantSeed,
    );
  }

  return {
    version: SAVE_VERSION,
    seed: state.seed,
    tick: state.tick,
    era: state.era,
    playedMs: state.playedMs,
    money: state.money,
    debt: state.debt,
    taxRate: state.taxRate,
    happiness: state.happiness,
    research: state.research,
    demand: { ...state.demand },
    farmTiles: state.farmTiles,
    nextBuildingId: state.nextBuildingId,
    lastSeen: state.lastSeen,
    road: encodeRuns(state.world.road),
    zone: encodeRuns(state.world.zone),
    parcelsOwned: encodeRuns(state.world.parcelsOwned),
    buildings,
  };
}

/**
 * Rebuilds a game from a save, or returns null if it cannot be trusted. A
 * corrupt or future-version save must never half-load: a city with the roads of
 * one game and the buildings of another is worse than a fresh start.
 */
export function deserialize(data: unknown): GameState | null {
  if (!isSaveData(data)) return null;
  if (data.version !== SAVE_VERSION) return null;

  // Regenerating from the seed gives back exactly the terrain this city was
  // built on, and claims the starting parcel; the saved ownership overwrites it.
  const state = createGameState(data.seed, data.lastSeen);

  state.tick = data.tick;
  state.era = data.era;
  state.playedMs = data.playedMs;
  state.money = data.money;
  state.debt = data.debt;
  state.taxRate = data.taxRate;
  state.happiness = data.happiness;
  state.research = data.research;
  state.demand = { ...data.demand };
  state.farmTiles = data.farmTiles;
  state.nextBuildingId = data.nextBuildingId;
  state.lastSeen = data.lastSeen;

  if (
    !decodeRuns(data.road, state.world.road) ||
    !decodeRuns(data.zone, state.world.zone) ||
    !decodeRuns(data.parcelsOwned, state.world.parcelsOwned)
  ) {
    return null;
  }

  if (data.buildings.length % BUILDING_FIELDS !== 0) return null;
  for (let i = 0; i < data.buildings.length; i += BUILDING_FIELDS) {
    const building = readBuilding(data.buildings, i);
    if (!building) return null;
    if (building.x < 0 || building.y < 0) return null;
    if (building.x >= state.world.size || building.y >= state.world.size) return null;
    state.buildings.set(building.id, building);
    // The tile → building index is derived, so it is rebuilt here rather than
    // stored and risked going out of step with the map.
    state.world.building[index(state.world, building.x, building.y)] = building.id;
  }

  state.population = 0;
  for (const building of state.buildings.values()) {
    if (building.zone === 'res') state.population += building.population;
  }

  return state;
}

function readBuilding(flat: readonly number[], at: number): Building | null {
  const zoneIndex = flat[at + 3] ?? -1;
  const zone = ZONES[zoneIndex];
  if (!zone) return null;
  const level = flat[at + 4] ?? 0;
  if (level < 1 || level > 5) return null;

  return {
    id: flat[at] ?? 0,
    x: flat[at + 1] ?? 0,
    y: flat[at + 2] ?? 0,
    w: 1,
    h: 1,
    zone,
    level: level as Level,
    score: flat[at + 5] ?? 0,
    growthProgress: flat[at + 6] ?? 0,
    decayTimer: flat[at + 7] ?? 0,
    population: flat[at + 8] ?? 0,
    jobs: flat[at + 9] ?? 0,
    output: 0,
    issues: 0,
    builtAt: flat[at + 10] ?? 0,
    variantSeed: flat[at + 11] ?? 0,
  };
}

/**
 * Run-length encoding. These columns are one value repeated across almost the
 * whole map with a thin scratch of road or zoning through them, which is the
 * case RLE is for: a 65k-cell column of a real city compresses to a few hundred
 * numbers.
 */
export function encodeRuns(column: Uint8Array): number[] {
  const runs: number[] = [];
  if (column.length === 0) return runs;

  let value = column[0] as number;
  let length = 1;
  for (let i = 1; i < column.length; i++) {
    const current = column[i] as number;
    if (current === value) {
      length++;
      continue;
    }
    runs.push(value, length);
    value = current;
    length = 1;
  }
  runs.push(value, length);
  return runs;
}

/** Returns false if the runs do not fill the column exactly. */
export function decodeRuns(runs: readonly number[], into: Uint8Array): boolean {
  if (runs.length % 2 !== 0) return false;
  let at = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const value = runs[i] ?? 0;
    const length = runs[i + 1] ?? 0;
    if (length < 0 || at + length > into.length) return false;
    into.fill(value, at, at + length);
    at += length;
  }
  return at === into.length;
}

function isSaveData(data: unknown): data is SaveData {
  if (typeof data !== 'object' || data === null) return false;
  const save = data as Partial<SaveData>;
  return (
    typeof save.version === 'number' &&
    typeof save.seed === 'number' &&
    typeof save.money === 'number' &&
    typeof save.lastSeen === 'number' &&
    typeof save.era === 'string' &&
    typeof save.demand === 'object' &&
    save.demand !== null &&
    Array.isArray(save.road) &&
    Array.isArray(save.zone) &&
    Array.isArray(save.parcelsOwned) &&
    Array.isArray(save.buildings)
  );
}
