import {
  BUILDING_DECAY_THRESHOLD,
  BUILDING_SPAWN_THRESHOLD,
  DENSE_SERVICE_GATE,
  INSPECT_COVERAGE_WORRY,
  INSPECT_DEMAND_WORRY,
  INSPECT_NUISANCE_EARLY,
  NOISE_ALARM,
  OFFICE_SCHOOLING_GATE,
  POLLUTION_ALARM,
  ZONE_LEVEL_CAP,
} from '../data/balance';
import { capacityOf, type Level } from '../data/buildings';
import type { Building } from './buildings';
import { schooledShare } from './cohorts';
import { levelCapAt } from './density';
import { serviceCoverageAt } from './services';
import type { GameState } from './state';
import { index } from './world';

/**
 * Why this building is the way it is (§14).
 *
 * The growth loop makes good decisions and explains none of them. A block
 * stuck at three storeys might be waiting for dense zoning, for services, for
 * schools, for demand, or for a foundry upwind to close — five different
 * answers with five different remedies, and until now the player's only
 * instrument was zooming in and wondering. Every gate this file names already
 * exists in sim/buildings.ts; this is the same logic read back as sentences
 * instead of applied as arithmetic.
 *
 * Pure and renderer-free: a report in, words out is the UI's job
 * (ui/inspector.ts). Kept separate from buildings.ts so the explanation can
 * never accidentally *become* the rule — this file reads state and returns
 * facts, and if it drifted from the real gates the tests pin it back.
 *
 * Notably fields-free: everything a blocker needs — pollution, noise, land
 * value, coverage, the density column — lives on the world or the state, so
 * the UI can ask for a report without borrowing the systems' scratch arrays.
 */
export type Blocker =
  /** Below the decay threshold: not merely stalled, actively losing floors. */
  | 'decay'
  /** Ordinary zoning tops out at three; the ground needs the dense brush. */
  | 'denseZoning'
  /** Dense ground, but the era's services do not reach it (DENSE_SERVICE_GATE). */
  | 'services'
  /** An office with nobody schooled to sit in it (OFFICE_SCHOOLING_GATE). */
  | 'schools'
  /** Nobody is asking for more of this zone right now. */
  | 'demand'
  /** Something upwind is staining the plot. */
  | 'pollution'
  /** The street is too loud to be worth more floors. */
  | 'noise'
  /** Below the growth bar for no single nameable reason: a weak spot overall. */
  | 'stalled';

export interface InspectReport {
  zone: Building['zone'];
  level: Level;
  /** The tallest this ground permits (sim/density.ts). */
  cap: Level;
  /** True at the top of a dense plot: nothing is wrong, it is finished. */
  maxed: boolean;
  /** Residents for housing; desks or shifts for the working zones. */
  occupants: number;
  capacity: number;
  /** ₺ per minute the ledger last credited it with; 0 for housing. */
  outputPerMinute: number;
  score: number;
  /** What stands between this building and its next level, worst first. */
  blockers: Blocker[];
}

/**
 * The actionable contributors to a weak score, biggest lever first. Thresholds
 * sit a little inside the real alarms (data/balance.ts, INSPECT_*) so the card
 * warns before the warning icon does.
 */
function nameContributors(
  state: GameState,
  i: number,
  coverage: number,
  building: Building,
  blockers: Blocker[],
): void {
  const world = state.world;
  if (state.demand[building.zone] < INSPECT_DEMAND_WORRY) blockers.push('demand');
  if ((world.pollution[i] ?? 0) > POLLUTION_ALARM * INSPECT_NUISANCE_EARLY) {
    blockers.push('pollution');
  }
  if ((world.noise[i] ?? 0) > NOISE_ALARM * INSPECT_NUISANCE_EARLY) blockers.push('noise');
  if (coverage < INSPECT_COVERAGE_WORRY) blockers.push('services');
}

export function inspectBuilding(state: GameState, building: Building): InspectReport {
  const world = state.world;
  const i = index(world, building.x, building.y);
  const cap = levelCapAt(world, building.x, building.y);
  const coverage = serviceCoverageAt(world, state.era, i);
  const blockers: Blocker[] = [];

  const atCap = building.level >= cap;
  const maxed = atCap && cap > ZONE_LEVEL_CAP;
  // The gates, in the order the growth pass applies them (sim/buildings.ts) —
  // so the first blocker named is the first wall the building actually hits.
  // Decay outranks everything, including the caps: the decay branch runs
  // before the cap's early return over there, and a card that says "just needs
  // dense zoning" about a block currently losing floors is telling the player
  // to buy an upgrade for a building that is dying of something else.
  if (building.score < BUILDING_DECAY_THRESHOLD) {
    blockers.push('decay');
    nameContributors(state, i, coverage, building, blockers);
  } else if (atCap && !maxed) {
    blockers.push('denseZoning');
  } else if (!maxed) {
    if (building.level >= ZONE_LEVEL_CAP && coverage < DENSE_SERVICE_GATE) {
      blockers.push('services');
    }
    if (building.zone === 'office' && schooledShare(state) < OFFICE_SCHOOLING_GATE) {
      blockers.push('schools');
    }
    if (blockers.length === 0 && building.score <= BUILDING_SPAWN_THRESHOLD) {
      nameContributors(state, i, coverage, building, blockers);
      // Below the bar with no single nameable cause: say *that* rather than
      // "no problem". The first draft answered "growing" here, which for a
      // building pinned under the threshold was simply a lie.
      if (blockers.length === 0) blockers.push('stalled');
    }
  }

  const capacity = capacityOf(building.zone, building.level);
  return {
    zone: building.zone,
    level: building.level,
    cap,
    maxed,
    occupants: building.zone === 'res' ? building.population : building.jobs,
    capacity,
    outputPerMinute: building.zone === 'res' ? 0 : building.output,
    score: building.score,
    blockers: blockers.slice(0, 3),
  };
}

/**
 * The building a tap at this tile meant, if any.
 *
 * By the tile→building column rather than a radius: unlike a crime marker a
 * building fills its own tile, so where the finger lands is where the
 * building is.
 */
export function buildingAt(state: GameState, tileX: number, tileY: number): Building | null {
  const world = state.world;
  if (tileX < 0 || tileY < 0 || tileX >= world.size || tileY >= world.size) return null;
  const id = world.building[index(world, tileX, tileY)] ?? 0;
  return id === 0 ? null : (state.buildings.get(id) ?? null);
}
