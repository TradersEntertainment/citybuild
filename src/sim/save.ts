import { SAVE_VERSION, ZONE_LEVEL_CAP } from '../data/balance';
import type { BuiltZone, Level } from '../data/buildings';
import { missionById } from '../data/missions';
import { techById } from '../data/tech';
import { totalDebt } from './credit';
import { ensureSections, refreshHighwayDamage } from './highwayWear';
import { pruneDensity } from './density';
import { pruneOneWay } from './oneWay';
import { readBudgets } from './budgets';
import { refreshSeaGates } from './ports';
import { stopsAlong } from './transit';
import { PROGRAMME_ORDER, tiersOf } from '../data/investments';
import { investmentLevels } from './investments';
import { PORT_ORDER } from '../data/ports';
import { SERVICE_ORDER } from '../data/services';
import { UTILITY_ORDER } from '../data/utilities';
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
  /** Loans, flattened: id, principal, outstanding, instalment, rate. */
  loans: number[];
  nextLoanId: number;
  happiness: number;
  research: number;
  demand: { res: number; com: number; ind: number };
  farmTiles: number;
  /** Ids of goals already paid out; a file without them is simply an early city. */
  missionsDone: string[];
  /** Ids of techs researched. */
  techsDone: string[];
  /**
   * What each department is funded at (sim/budgets.ts).
   *
   * Saved because it is a decision, and one a city can be quietly ruined by
   * forgetting it made.
   */
  budgets: Record<string, number>;
  /** The last term settled, so a reload cannot re-run a vote (sim/elections.ts). */
  lastTermSettled: number;
  /** Level bought in each civic programme, by id. */
  investments: Record<string, number>;
  /** Legacy points this city was founded with. */
  legacy: number;
  /**
   * Wear on each stretch of the national highway, as whole percent. The route
   * is regenerated from the seed, so a stretch index means the same stretch on
   * every load and only the number has to be stored.
   */
  highwayWear: number[];
  nextBuildingId: number;
  lastSeen: number;
  /** Run-length encoded grid columns: [value, runLength, value, runLength, …]. */
  road: number[];
  /** Which way each tile runs, RLE'd beside the roads it belongs to. */
  oneWay: number[];
  zone: number[];
  /** Which ground is zoned for height, RLE'd beside the zoning it modifies. */
  density: number[];
  /**
   * How far each seam has been worked, RLE'd like the rest (sim/resources.ts).
   *
   * Saved because it must be: the resource column itself is regenerated from the
   * seed, so without this a player could refill a worked-out coal field by
   * closing the tab.
   */
  depleted: number[];
  parcelsOwned: number[];
  /** Buildings, flattened; see BUILDING_FIELDS for the column order. */
  buildings: number[];
  /** Stations, flattened: id, kind index, x, y. */
  services: number[];
  nextServiceId: number;
  /** Waterworks and power stations, flattened the same way. */
  utilities: number[];
  nextUtilityId: number;
  /** Berths on the coast, flattened the same way. */
  ports: number[];
  nextPortId: number;
  /**
   * Bus and tram lines, flattened: id, path length, then the path's x,y pairs.
   *
   * The stops are not stored — they are derived from the path by the same rule
   * that placed them (sim/transit.ts, stopsAlong), so a file cannot hold a line
   * whose stops disagree with its shape.
   */
  transit: number[];
  nextTransitId: number;
}

/** Fields packed per building, in order. Zone is stored as an index. */
const ZONES: readonly BuiltZone[] = ['res', 'com', 'ind'];
const BUILDING_FIELDS = 12;
const LOAN_FIELDS = 5;
const SERVICE_FIELDS = 4;
const UTILITY_FIELDS = 4;
const PORT_FIELDS = 4;

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

  const services: number[] = [];
  for (const service of state.services.values()) {
    services.push(service.id, SERVICE_ORDER.indexOf(service.kind), service.x, service.y);
  }

  const ports: number[] = [];
  for (const port of state.ports.values()) {
    ports.push(port.id, PORT_ORDER.indexOf(port.kind), port.x, port.y);
  }

  const transit: number[] = [];
  for (const line of state.transit.values()) {
    transit.push(line.id, line.path.length);
    for (const point of line.path) transit.push(point.x, point.y);
  }

  const utilities: number[] = [];
  for (const plant of state.utilities.values()) {
    utilities.push(plant.id, UTILITY_ORDER.indexOf(plant.kind), plant.x, plant.y);
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
    loans: state.loans.flatMap((loan) => [
      loan.id,
      Math.round(loan.principal),
      Math.round(loan.outstanding * 100) / 100,
      Math.round(loan.instalment * 100) / 100,
      loan.rate,
    ]),
    nextLoanId: state.nextLoanId,
    happiness: state.happiness,
    research: state.research,
    demand: { ...state.demand },
    farmTiles: state.farmTiles,
    missionsDone: [...state.missionsDone],
    techsDone: [...state.techsDone],
    budgets: { ...state.budgets },
    lastTermSettled: state.lastTermSettled,
    investments: { ...investmentLevels(state) },
    legacy: state.legacy,
    highwayWear: state.highwayWear.map((wear) => Math.round(wear * 100)),
    nextBuildingId: state.nextBuildingId,
    lastSeen: state.lastSeen,
    road: encodeRuns(state.world.road),
    oneWay: encodeRuns(state.world.oneWay),
    zone: encodeRuns(state.world.zone),
    density: encodeRuns(state.world.density),
    depleted: encodeRuns(state.world.depleted),
    parcelsOwned: encodeRuns(state.world.parcelsOwned),
    buildings,
    services,
    nextServiceId: state.nextServiceId,
    utilities,
    nextUtilityId: state.nextUtilityId,
    ports,
    nextPortId: state.nextPortId,
    transit,
    nextTransitId: state.nextTransitId,
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
  const state = createGameState(data.seed, data.lastSeen, typeof data.legacy === 'number' ? data.legacy : 0);

  state.tick = data.tick;
  state.era = data.era;
  state.playedMs = data.playedMs;
  state.money = data.money;
  state.debt = data.debt;
  state.taxRate = data.taxRate;
  // Loans arrived after the first saves existed; a file without them is a city
  // that owes nothing rather than a corrupt one.
  const loans = Array.isArray(data.loans) ? data.loans : [];
  if (loans.length % LOAN_FIELDS !== 0) return null;
  for (let i = 0; i < loans.length; i += LOAN_FIELDS) {
    const outstanding = loans[i + 2] ?? 0;
    if (outstanding <= 0) continue;
    state.loans.push({
      id: loans[i] ?? 0,
      principal: loans[i + 1] ?? 0,
      outstanding,
      instalment: loans[i + 3] ?? 0,
      rate: loans[i + 4] ?? 0,
    });
  }
  state.nextLoanId = Math.max(1, data.nextLoanId ?? 1);
  state.debt = totalDebt(state);
  state.happiness = data.happiness;
  state.research = data.research;
  state.demand = { ...data.demand };
  state.farmTiles = data.farmTiles;
  // Goals arrived after the first saves existed. A file without them is a city
  // that has not claimed any yet — not a corrupt one — but the ids are filtered
  // so a save carrying a goal this build no longer has cannot block the chain.
  state.missionsDone = (Array.isArray(data.missionsDone) ? data.missionsDone : [])
    .filter((id): id is string => typeof id === 'string' && missionById(id) !== undefined);
  state.techsDone = (Array.isArray(data.techsDone) ? data.techsDone : []).filter(
    (id): id is string => typeof id === 'string' && techById(id) !== undefined,
  );
  // Budgets arrived after the stations, and a file without them is a city funding
  // everything normally — not a corrupt one. Read defensively and clamped, so a
  // save from a build with a wider range cannot hand a city an effect no slider
  // in this one can explain.
  state.budgets = readBudgets(data.budgets);
  // A file without it is a city that has never held a vote — which for a save
  // written before elections existed is exactly right, and for one written after
  // is only true of a city in its first term.
  const settled = data.lastTermSettled;
  state.lastTermSettled = typeof settled === 'number' && Number.isFinite(settled) && settled > 0
    ? Math.floor(settled)
    : 0;

  // Programmes arrived after the techs, and a file without them is a city that
  // has bought none — the same additive pattern as the loans and the berths.
  // Levels are clamped against the table this build actually has, so a save
  // carrying a tier that no longer exists cannot leave a city with an effect
  // nothing can explain.
  const bought = isRecord(data.investments) ? data.investments : {};
  for (const id of PROGRAMME_ORDER) {
    const raw = bought[id];
    const level = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
    state.investments[id] = Math.max(0, Math.min(tiersOf(id).length, level));
  }
  state.nextBuildingId = data.nextBuildingId;
  state.lastSeen = data.lastSeen;
  // Road wear arrived after the first saves existed, like the loans and the
  // stations before it: a file without it is a city whose motorway is in good
  // repair, not a corrupt one. Sized against the regenerated route afterwards,
  // so a save from a build that split the road differently cannot leave the
  // array and the road disagreeing.
  const wear = Array.isArray(data.highwayWear) ? data.highwayWear : [];
  state.highwayWear = wear.map((percent) =>
    typeof percent === 'number' && Number.isFinite(percent)
      ? Math.min(1, Math.max(0, percent / 100))
      : 0,
  );
  ensureSections(state);
  refreshHighwayDamage(state);

  if (
    !decodeRuns(data.road, state.world.road) ||
    !decodeRuns(data.zone, state.world.zone) ||
    !decodeRuns(data.parcelsOwned, state.world.parcelsOwned)
  ) {
    return null;
  }
  // Seams arrived after the map did, so a file without the column is a city whose
  // ground has never been mined — not a corrupt one.
  if (Array.isArray(data.depleted)) decodeRuns(data.depleted, state.world.depleted);

  // Arrows arrived after the roads did, so a file without them is a city whose
  // streets all run both ways — not a corrupt one. A malformed run is still
  // refused: half a set of arrows is a city whose traffic laws disagree with
  // its map.
  if (Array.isArray(data.oneWay) && !decodeRuns(data.oneWay, state.world.oneWay)) {
    return null;
  }
  // And nothing carries an arrow that is not a road: the road column is
  // authoritative, and an arrow on bare ground would be a rule nobody can see.
  pruneOneWay(state.world);

  // Density arrived after the zoning did, so a file without the column is a
  // city that never built upward — not a corrupt one. A malformed run is still
  // refused, for the same reason as the arrows: half a downtown is a map that
  // disagrees with itself.
  if (Array.isArray(data.density) && !decodeRuns(data.density, state.world.density)) {
    return null;
  }
  pruneDensity(state.world);

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
    // Grandfathered: every city saved before density existed grew as tall as
    // its services allowed, and a good many of those blocks are above what
    // ordinary zoning now permits. Marking their ground dense is both kinder
    // and truer than letting the rule apply retroactively — those blocks *are*
    // the city's downtown, the player simply was not asked. Without this, the
    // first tick after the update starts pulling a floor off every tower they
    // ever built, which is the update destroying a city rather than adding to
    // one. New towers are still paid for; only standing ones are forgiven.
    if (building.level > ZONE_LEVEL_CAP) {
      state.world.density[index(state.world, building.x, building.y)] = 1;
    }
  }

  // Services were added after the first saves existed; a file without them is
  // a city with no stations, not a corrupt one.
  const services = Array.isArray(data.services) ? data.services : [];
  if (services.length % SERVICE_FIELDS !== 0) return null;
  for (let i = 0; i < services.length; i += SERVICE_FIELDS) {
    const kind = SERVICE_ORDER[services[i + 1] ?? -1];
    if (!kind) return null;
    const x = services[i + 2] ?? 0;
    const y = services[i + 3] ?? 0;
    if (x < 0 || y < 0 || x >= state.world.size || y >= state.world.size) return null;
    const id = services[i] ?? 0;
    state.services.set(id, { id, kind, x, y });
  }
  state.nextServiceId = Math.max(1, data.nextServiceId ?? 1);

  const plants = Array.isArray(data.utilities) ? data.utilities : [];
  if (plants.length % UTILITY_FIELDS !== 0) return null;
  for (let i = 0; i < plants.length; i += UTILITY_FIELDS) {
    const kind = UTILITY_ORDER[plants[i + 1] ?? -1];
    if (!kind) return null;
    const x = plants[i + 2] ?? 0;
    const y = plants[i + 3] ?? 0;
    if (x < 0 || y < 0 || x >= state.world.size || y >= state.world.size) return null;
    const id = plants[i] ?? 0;
    state.utilities.set(id, { id, kind, x, y });
  }
  state.nextUtilityId = Math.max(1, data.nextUtilityId ?? 1);

  // Berths arrived with the sea, after the stations and the plants: a file from
  // before them is a city with no waterfront, not a corrupt one.
  const berths = Array.isArray(data.ports) ? data.ports : [];
  if (berths.length % PORT_FIELDS !== 0) return null;
  for (let i = 0; i < berths.length; i += PORT_FIELDS) {
    const kind = PORT_ORDER[berths[i + 1] ?? -1];
    if (!kind) return null;
    const x = berths[i + 2] ?? 0;
    const y = berths[i + 3] ?? 0;
    if (x < 0 || y < 0 || x >= state.world.size || y >= state.world.size) return null;
    const id = berths[i] ?? 0;
    state.ports.set(id, { id, kind, x, y });
  }
  state.nextPortId = Math.max(1, data.nextPortId ?? 1);

  // Lines arrived after the roads did, so a file without them is a city that
  // never ran a bus — not a corrupt one. A malformed run is dropped rather than
  // failing the load: half a route is worse than none.
  const lines = Array.isArray(data.transit) ? data.transit : [];
  for (let i = 0; i + 1 < lines.length; ) {
    const id = lines[i] ?? 0;
    const length = lines[i + 1] ?? 0;
    i += 2;
    if (length <= 0 || i + length * 2 > lines.length) break;
    const path: { x: number; y: number }[] = [];
    for (let n = 0; n < length; n++) {
      const x = lines[i + n * 2] ?? 0;
      const y = lines[i + n * 2 + 1] ?? 0;
      if (x < 0 || y < 0 || x >= state.world.size || y >= state.world.size) break;
      path.push({ x, y });
    }
    i += length * 2;
    if (path.length !== length) continue;
    const stops = stopsAlong(path);
    if (stops.length < 2) continue;
    state.transit.set(id, { id, path, stops });
  }
  state.nextTransitId = Math.max(1, data.nextTransitId ?? 1);
  // The gate column is derived, and the connectivity pass runs before anything
  // else touches it — but a loaded city is asked about its harbour by the UI
  // long before the first tick.
  refreshSeaGates(state);

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

/** A plain object, for the additive fields whose shape is a map rather than a list. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
