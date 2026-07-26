import {
  COMMERCIAL_PER_INDUSTRIAL_JOB,
  DEMAND_RESPONSE,
  EPIDEMIC_HAPPINESS_HIT,
  FIRE_HAPPINESS_CAP,
  FIRE_HAPPINESS_HIT,
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
import { portHappiness } from './ports';
import { ritualHappiness } from './rituals';
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
  const jobs =
    totals.commercialJobs + totals.industrialJobs + totals.farmJobs + totals.portJobs;
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

  let target = clamp(employmentScore * 0.55 + taxScore * 0.45, 0, 100);
  // Chaos is felt before it is counted: a city watching itself burn, or queue
  // at a closed hospital, is not a content one whatever the tax rate says.
  target -= Math.min(FIRE_HAPPINESS_CAP, state.fires.size * FIRE_HAPPINESS_HIT);
  if (state.epidemic) target -= state.epidemic.severity * EPIDEMIC_HAPPINESS_HIT;
  // And history leans on the mood for years at a time: wars and depressions
  // press down, republics and booms lift.
  target += state.timelineEffects.happinessMod;
  // A waterfront worth walking on is worth something to live near (sim/ports.ts).
  target += portHappiness(state);
  // And a city on a holiday is a happier city, for the few seconds it lasts
  // (sim/rituals.ts). Derived from the date, so an absence cannot bank four.
  target += ritualHappiness(state);
  target = clamp(target, 0, 100);
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
  // Empty homes suppress demand — that is what stops the city paving itself —
  // but the coefficient has to survive the moment a district is built. A spawn
  // wave arrives seeded well below capacity, so vacancy spikes by design; at
  // 1.1 that spike alone was enough to drive the target to zero and leave it
  // there, which turned "do not overbuild" into "never build twice".
  const resTarget = clamp(
    0.35 + jobSurplus * 0.4 + (state.happiness - 50) / 140 - vacancyRate * 0.75,
    0,
    1,
  );

  // People who cannot find work are themselves demand for somewhere to work.
  //
  // Without this term the two ratios below are the only thing that ever asks
  // for a job, and they saturate at about a quarter of the workforce: shops
  // want pop/14 and industry wants another pop/22, against a workforce of
  // pop/2. Unemployment could therefore never fall below ~77% however well the
  // city was built, which held happiness down, which held residential demand at
  // zero, which stopped the city. Job pressure closes that loop — build work,
  // people take it, the city becomes somewhere worth moving to.
  const jobPressure = workers > 0 ? clamp((workers - jobs) / workers, 0, 1) : 0;

  // Shops follow people: every so many residents supports one more job.
  const wantedCommercial = state.population / RESIDENTS_PER_COMMERCIAL_JOB;
  const comTarget = Math.max(ratioDemand(wantedCommercial, totals.commercialJobs), jobPressure);

  // Industry follows the shops it supplies, and takes up the slack when there
  // is still work wanted — a little behind commerce, which a city would rather
  // have next to its homes.
  const wantedIndustrial = totals.commercialJobs / COMMERCIAL_PER_INDUSTRIAL_JOB;
  const indTarget = Math.max(
    ratioDemand(wantedIndustrial, totals.industrialJobs),
    jobPressure * 0.8,
  );

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
  let perMinute = migrationPerMinute(state.happiness, vacancy);
  // Nobody takes the motorway *into* a plague town: the sicker the outbreak,
  // the thinner the stream of new arrivals, until it stops entirely.
  if (state.epidemic && perMinute > 0) perMinute *= 1 - state.epidemic.severity * 0.9;
  // History decides how full the road in is: a draft empties it, a boom
  // decade fills every bus.
  if (perMinute > 0) perMinute *= state.timelineEffects.migrationMult;
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

/**
 * Removes people from the city outright — the way an epidemic takes them.
 * Distinct from migration, which is the market deciding; this is the morgue
 * and the evacuation bus. Empties the worst homes first, like any exodus.
 */
export function drainPopulation(state: GameState, people: number): void {
  moveOut(state, people);
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
