import {
  BUILDING_DECAY_THRESHOLD,
  BUILDING_GROWTH_S,
  BUILDING_SEED_OCCUPANCY,
  BUILDING_SPAWN_THRESHOLD,
  FARM_JOBS_PER_TILE,
  DECAY_DURATION_S,
  ROAD_ACCESS_MAX_WALK,
  SUITABILITY_WEIGHTS,
} from '../data/balance';
import { capacityOf, isBuiltZone, type BuiltZone, type Level } from '../data/buildings';
import { UNREACHABLE, type Fields } from './fields';
import type { GameState } from './state';
import { decodeZone, ISSUE, NONE, type ZoneKind } from './tiles';
import { index, isTileOwned, type World } from './world';

/**
 * Where buildings come from and where they go (§6.2). This is the feedback
 * loop the whole game is built on: the player grants permission and supplies
 * access, the city decides whether that is enough, and says so by building,
 * by stagnating, or by walking away.
 */
export interface Building {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  zone: BuiltZone;
  level: Level;
  score: number;
  /** 0..1 toward the next level. */
  growthProgress: number;
  /** Seconds spent below the decay threshold. */
  decayTimer: number;
  population: number;
  jobs: number;
  output: number;
  /** Bit field of ISSUE flags, drawn as a mark on the building (§6.2). */
  issues: number;
  builtAt: number;
  /** Seeds the procedural drawing so a building always looks like itself. */
  variantSeed: number;
}

/**
 * Suitability, §6.2 verbatim in weights. Road access gates everything: with no
 * road within walking distance the score is zero and nothing is ever built,
 * which is what makes the road the player's real instrument.
 */
export function suitability(
  state: GameState,
  fields: Fields,
  x: number,
  y: number,
  zone: BuiltZone,
): number {
  const i = index(state.world, x, y);
  const distance = fields.roadDistance[i] ?? UNREACHABLE;
  if (distance > ROAD_ACCESS_MAX_WALK) return 0;

  const w = SUITABILITY_WEIGHTS;
  const roadAccess = 1 - distance / (ROAD_ACCESS_MAX_WALK + 1);
  const demand = state.demand[zone];
  // Services, pollution and noise are Phase 3 systems; their terms are wired
  // here so the weighting does not have to be re-derived when they arrive.
  const serviceCoverage = 0;
  const landValue = fields.landValue[i] ?? 0;
  const pollution = state.world.pollution[i] ?? 0;
  const noise = state.world.noise[i] ?? 0;

  const score =
    w.roadAccess * roadAccess +
    w.demand * demand +
    w.serviceCoverage * serviceCoverage +
    w.landValue * (landValue / 100) +
    w.neighbourFit * neighbourFit(state.world, x, y, zone) +
    w.pollution * (pollution / 100) +
    w.noise * (noise / 100);

  return score < 0 ? 0 : score > 1 ? 1 : score;
}

/**
 * How well the neighbours suit this zone (§6.2). Homes like homes and parks
 * and hate industry; shops want to be among people; industry does not mind
 * its own company. Returns 0..1 with 0.5 as "no opinion".
 */
export function neighbourFit(world: World, x: number, y: number, zone: BuiltZone): number {
  let score = 0.5;
  let counted = 0;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const neighbour = decodeZone(world.zone[index(world, nx, ny)] ?? NONE);
      if (!neighbour) continue;
      counted++;
      score += opinion(zone, neighbour) / 12;
    }
  }

  if (counted === 0) return 0.5;
  return score < 0 ? 0 : score > 1 ? 1 : score;
}

function opinion(zone: BuiltZone, neighbour: ZoneKind): number {
  if (zone === 'res') {
    if (neighbour === 'park') return 1;
    if (neighbour === 'res' || neighbour === 'farm') return 0.4;
    if (neighbour === 'com') return 0.1;
    return -1; // industry next to homes
  }
  if (zone === 'com') {
    if (neighbour === 'res') return 0.8;
    if (neighbour === 'com') return 0.3;
    if (neighbour === 'park') return 0.3;
    return -0.3;
  }
  // Industry is indifferent to almost everything, and dislikes only parks it
  // would be taking the place of.
  if (neighbour === 'ind') return 0.4;
  if (neighbour === 'park') return -0.2;
  return 0;
}

/**
 * One evaluation pass over every zoned tile. Spawns, grows and decays.
 * `dt` is the seconds since the last pass.
 */
export function evaluateBuildings(state: GameState, fields: Fields, dt: number): void {
  const { world } = state;
  // Farmland is counted here rather than in its own sweep: this pass already
  // visits every tile, and the count only has to be as fresh as the buildings.
  let farmTiles = 0;

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);
      const zoneCode = world.zone[i] ?? NONE;
      const buildingId = world.building[i] ?? 0;
      const zone = decodeZone(zoneCode);
      if (zone === 'farm') farmTiles++;

      if (buildingId !== 0) {
        const building = state.buildings.get(buildingId);
        if (!building) {
          world.building[i] = 0;
          continue;
        }
        // Permission withdrawn, or the parcel sold back: the building goes.
        if (!isBuiltZone(zone) || zone !== building.zone || !isTileOwned(world, x, y)) {
          demolish(state, building);
          continue;
        }
        updateBuilding(state, fields, building, dt);
        continue;
      }

      if (!isBuiltZone(zone)) continue;
      const score = suitability(state, fields, x, y, zone);
      if (score > BUILDING_SPAWN_THRESHOLD) spawn(state, x, y, zone, score);
    }
  }

  state.farmTiles = farmTiles;
}

function spawn(state: GameState, x: number, y: number, zone: BuiltZone, score: number): void {
  const id = state.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone,
    level: 1,
    score,
    growthProgress: 0,
    decayTimer: 0,
    population: 0,
    jobs: 0,
    output: 0,
    issues: 0,
    builtAt: state.playedMs,
    variantSeed: (x * 73856093) ^ (y * 19349663) ^ state.seed,
  };
  applyCapacity(building, true);
  state.buildings.set(id, building);
  state.world.building[index(state.world, x, y)] = id;
}

function updateBuilding(
  state: GameState,
  fields: Fields,
  building: Building,
  dt: number,
): void {
  const score = suitability(state, fields, building.x, building.y, building.zone);
  building.score = score;
  building.issues = diagnose(state, fields, building);

  if (score < BUILDING_DECAY_THRESHOLD) {
    building.decayTimer += dt;
    building.growthProgress = 0;
    if (building.decayTimer >= DECAY_DURATION_S) {
      if (building.level > 1) {
        // Decline before collapse: a block empties floor by floor.
        building.level = (building.level - 1) as Level;
        building.decayTimer = 0;
        applyCapacity(building, false);
      } else {
        demolish(state, building);
      }
    }
    return;
  }

  building.decayTimer = Math.max(0, building.decayTimer - dt);
  if (building.level >= 5) return;

  // Growth rate scales with how far above the spawn threshold the score sits,
  // so a merely adequate plot creeps while a good one races.
  const headroom = (score - BUILDING_SPAWN_THRESHOLD) / (1 - BUILDING_SPAWN_THRESHOLD);
  if (headroom <= 0) return;
  const seconds = BUILDING_GROWTH_S[building.level - 1] ?? 200;
  building.growthProgress += (dt * headroom) / seconds;

  if (building.growthProgress >= 1) {
    building.growthProgress = 0;
    building.level = (building.level + 1) as Level;
    applyCapacity(building, false);
  }
}

/** Recomputes what a building holds after its level changes. */
function applyCapacity(building: Building, seeded: boolean): void {
  const capacity = capacityOf(building.zone, building.level);
  if (building.zone === 'res') {
    const target = seeded ? capacity * BUILDING_SEED_OCCUPANCY : building.population;
    // A level-up adds empty homes; migration fills them (§8).
    building.population = Math.min(capacity, target);
    building.jobs = 0;
  } else {
    building.population = 0;
    building.jobs = capacity;
  }
}

function diagnose(state: GameState, fields: Fields, building: Building): number {
  let issues = 0;
  const i = index(state.world, building.x, building.y);
  if ((fields.roadDistance[i] ?? UNREACHABLE) > ROAD_ACCESS_MAX_WALK) issues |= ISSUE.noService;
  if (building.decayTimer > 0) issues |= ISSUE.noService;
  if ((state.world.pollution[i] ?? 0) > 50) issues |= ISSUE.pollution;
  return issues;
}

export function demolish(state: GameState, building: Building): void {
  state.world.building[index(state.world, building.x, building.y)] = 0;
  state.buildings.delete(building.id);
}

/** Totals the city reads off its buildings every economy tick. */
export interface BuildingTotals {
  housing: number;
  residents: number;
  commercialJobs: number;
  industrialJobs: number;
  /** Work on painted farmland, which grows no building of its own. */
  farmJobs: number;
}

export function totalBuildings(state: GameState): BuildingTotals {
  const totals: BuildingTotals = {
    housing: 0,
    residents: 0,
    commercialJobs: 0,
    industrialJobs: 0,
    farmJobs: state.farmTiles * FARM_JOBS_PER_TILE,
  };

  for (const building of state.buildings.values()) {
    if (building.zone === 'res') {
      totals.housing += capacityOf('res', building.level);
      totals.residents += building.population;
    } else if (building.zone === 'com') {
      totals.commercialJobs += building.jobs;
    } else {
      totals.industrialJobs += building.jobs;
    }
  }
  return totals;
}
