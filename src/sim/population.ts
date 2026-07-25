import {
  COMMERCIAL_PER_INDUSTRIAL_JOB,
  DEMAND_RESPONSE,
  HAPPINESS_RESPONSE,
  LABOUR_PARTICIPATION,
  MIGRATION_COEFFICIENT,
  MIGRATION_HAPPINESS_PIVOT,
  MIGRATION_HAPPINESS_SPAN,
  RESIDENTS_PER_COMMERCIAL_JOB,
  TAX_RATE_MAX,
  UNEMPLOYMENT_PENALTY,
  UNEMPLOYMENT_TOLERANCE,
} from '../data/balance';
import { capacityOf } from '../data/buildings';
import type { BuildingTotals } from './buildings';
import type { GameState } from './state';

/**
 * Population, demand and happiness (§8).
 *
 * Demand is what stops the city from paving itself: every home built raises
 * vacancy and lowers residential demand, which lowers suitability, which stops
 * the next home. The player raises demand by giving people somewhere to work,
 * something to buy, and a reason to stay.
 */
export function stepPopulation(state: GameState, totals: BuildingTotals, dt: number): void {
  const workers = state.population * LABOUR_PARTICIPATION;
  const jobs = totals.commercialJobs + totals.industrialJobs + totals.farmJobs;
  const vacancy = totals.housing - state.population;

  updateHappiness(state, workers, jobs, dt);
  updateDemand(state, totals, workers, jobs, vacancy, dt);
  migrate(state, vacancy, dt);
}

function updateHappiness(state: GameState, workers: number, jobs: number, dt: number): void {
  // Phase 2 knows about work and taxes. Services, traffic, pollution and parks
  // join the same weighted average in Phase 3.
  const unemployment = workers > 0 ? Math.max(0, (workers - jobs) / workers) : 0;
  const excess = Math.max(0, unemployment - UNEMPLOYMENT_TOLERANCE) / (1 - UNEMPLOYMENT_TOLERANCE);
  const employmentScore = 100 - excess * UNEMPLOYMENT_PENALTY;
  const taxScore = 100 - (state.taxRate / TAX_RATE_MAX) * 70;

  const target = clamp(employmentScore * 0.55 + taxScore * 0.45, 0, 100);
  // Mood moves slowly; a city that swung with every tick would be unreadable.
  state.happiness += (target - state.happiness) * Math.min(1, HAPPINESS_RESPONSE * dt);
}

function updateDemand(
  state: GameState,
  totals: BuildingTotals,
  workers: number,
  jobs: number,
  vacancy: number,
  dt: number,
): void {
  const vacancyRate = totals.housing > 0 ? vacancy / totals.housing : 0;

  // Homes are wanted when there is work going spare, people are content, and
  // little stands empty.
  const jobSurplus = workers > 0 ? clamp((jobs - workers) / workers, -1, 1) : jobs > 0 ? 1 : 0;
  const resTarget = clamp(
    0.35 + jobSurplus * 0.4 + (state.happiness - 50) / 140 - vacancyRate * 1.1,
    0,
    1,
  );

  // Shops follow people: every so many residents supports one more job.
  const wantedCommercial = state.population / RESIDENTS_PER_COMMERCIAL_JOB;
  const comTarget = ratioDemand(wantedCommercial, totals.commercialJobs);

  // Industry follows the shops it supplies.
  const wantedIndustrial = totals.commercialJobs / COMMERCIAL_PER_INDUSTRIAL_JOB;
  const indTarget = ratioDemand(wantedIndustrial, totals.industrialJobs);

  const rate = Math.min(1, DEMAND_RESPONSE * dt);
  state.demand.res += (resTarget - state.demand.res) * rate;
  state.demand.com += (comTarget - state.demand.com) * rate;
  state.demand.ind += (indTarget - state.demand.ind) * rate;
}

/**
 * Demand from a shortfall: full when nothing of the kind exists yet and there
 * is a reason for it, tapering to zero once supply has caught up.
 */
function ratioDemand(wanted: number, have: number): number {
  if (wanted <= 0) return 0;
  return clamp((wanted - have) / wanted, 0, 1);
}

/** GÖÇ_KATSAYISI = 0.02 * (mutluluk-40)/60 * boşKonut, per minute (§20). */
export function migrationPerMinute(happiness: number, vacancy: number): number {
  return (
    MIGRATION_COEFFICIENT *
    ((happiness - MIGRATION_HAPPINESS_PIVOT) / MIGRATION_HAPPINESS_SPAN) *
    Math.max(0, vacancy)
  );
}

function migrate(state: GameState, vacancy: number, dt: number): void {
  const perMinute = migrationPerMinute(state.happiness, vacancy);
  const change = (perMinute * dt) / 60;
  if (change === 0) return;

  if (change > 0) moveIn(state, change);
  else moveOut(state, -change);

  state.population = 0;
  for (const building of state.buildings.values()) {
    if (building.zone === 'res') state.population += building.population;
  }
}

/** Fills the emptiest homes first, so new blocks visibly populate. */
function moveIn(state: GameState, people: number): void {
  const homes = residential(state).sort(
    (a, b) => vacancyOf(b) - vacancyOf(a),
  );
  let remaining = people;
  for (const building of homes) {
    if (remaining <= 0) break;
    const room = vacancyOf(building);
    if (room <= 0) continue;
    const taken = Math.min(room, remaining);
    building.population += taken;
    remaining -= taken;
  }
}

/** Empties the worst homes first — decline shows where the city failed. */
function moveOut(state: GameState, people: number): void {
  const homes = residential(state).sort((a, b) => a.score - b.score);
  let remaining = people;
  for (const building of homes) {
    if (remaining <= 0) break;
    const leaving = Math.min(building.population, remaining);
    building.population -= leaving;
    remaining -= leaving;
  }
}

function residential(state: GameState) {
  return [...state.buildings.values()].filter((b) => b.zone === 'res');
}

function vacancyOf(building: { level: number; population: number }): number {
  return capacityOf('res', building.level as 1 | 2 | 3 | 4 | 5) - building.population;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
