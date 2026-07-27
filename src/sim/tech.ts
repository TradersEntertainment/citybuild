import { researchPerMinute } from '../data/balance';
import { techById, TECHS, type Tech, type TechId } from '../data/tech';
import { SERVICE_SPECS } from '../data/services';
import { budgetOf } from './budgets';
import type { GameState } from './state';
import { eraReached } from './tiles';
import { index } from './world';

/**
 * Research: earning it, and what it buys (§12.2).
 *
 * Every tech is a single multiplier looked up through one function, which is
 * the point rather than a shortcut. Systems that answer to research ask what
 * their factor is at the moment they need it, so a tech can never be applied
 * twice, can never be forgotten when a code path is added, and never has to be
 * baked into the save.
 */
export function techFactor(state: GameState, id: TechId): number {
  if (!state.techsDone.includes(id)) return 1;
  return techById(id)?.factor ?? 1;
}

/** Accrues research over `dt` seconds. Education makes a city think faster. */
export function stepResearch(state: GameState, dt: number): void {
  if (state.population <= 0) return;
  const perMinute = researchPerMinute(state.population, educationCoverage(state) * 100);
  state.research += (perMinute * dt) / 60;
}

/**
 * Share of built ground within reach of a school, 0..1.
 *
 * Measured over buildings rather than over tiles: the coverage that matters is
 * of people, and half a mountain inside a school's radius is not education.
 */
export function educationCoverage(state: GameState): number {
  if (state.buildings.size === 0) return 0;
  const bit = SERVICE_SPECS.education.bit;
  let covered = 0;
  for (const building of state.buildings.values()) {
    const mask = state.world.serviceMask[index(state.world, building.x, building.y)] ?? 0;
    if ((mask & bit) !== 0) covered++;
  }
  // Funding is already in the radius that wrote the mask (sim/services.ts), so
  // what it adds here is what happens *inside* a covered classroom: a thinly
  // funded school reaches the same streets and teaches them less.
  const share = (covered / state.buildings.size) * budgetOf(state, 'education');
  return share > 1 ? 1 : share;
}

export interface TechOffer {
  tech: Tech;
  affordable: boolean;
  done: boolean;
}

/** Every tech the era has reached, researched or not, cheapest first. */
export function techOffers(state: GameState): TechOffer[] {
  return TECHS.filter((tech) => eraReached(state.era, tech.from))
    .map((tech) => ({
      tech,
      affordable: state.research >= tech.cost,
      done: state.techsDone.includes(tech.id),
    }))
    .sort((a, b) => a.tech.cost - b.tech.cost);
}

export type ResearchResult = 'ok' | 'locked' | 'done' | 'tooDear';

/** Spends the points. Nothing here can fail halfway. */
export function research(state: GameState, id: TechId): ResearchResult {
  const tech = techById(id);
  if (!tech || !eraReached(state.era, tech.from)) return 'locked';
  if (state.techsDone.includes(id)) return 'done';
  if (state.research < tech.cost) return 'tooDear';

  state.research -= tech.cost;
  state.techsDone.push(id);
  return 'ok';
}
