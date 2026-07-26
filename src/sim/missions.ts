import { MISSIONS, MISSIONS_SHOWN, type Mission, type MissionGoal } from '../data/missions';
import { totalBuildings, type BuildingTotals } from './buildings';
import { highwayInterchanges, transitFlow } from './highway';
import type { GameState } from './state';
import { eraReached, NONE } from './tiles';
import { ownedParcelCount } from './world';

/**
 * Goals, measured (§12.3).
 *
 * Nothing here decides anything: every figure is read off state the city was
 * already keeping, so a goal cannot be completed any way other than by building
 * the city that completes it. That is what makes the chain a reading of
 * progress rather than a second game played beside the first — and it is why an
 * absence completes goals too, because the city genuinely did the work.
 */
export interface MissionProgress {
  mission: Mission;
  have: number;
  want: number;
  /** 0..1, for a bar. */
  fraction: number;
}

/** A goal's current reading. */
export function measureGoal(state: GameState, totals: BuildingTotals, goal: MissionGoal): number {
  switch (goal.measure) {
    case 'roadTiles':
      return playerRoadTiles(state);
    case 'buildings':
      return state.buildings.size;
    case 'population':
      return state.population;
    case 'jobs':
      return totals.commercialJobs + totals.industrialJobs + totals.farmJobs;
    case 'housing':
      return totals.housing;
    case 'happiness':
      return state.happiness;
    case 'reserve':
      return state.money;
    case 'services':
      return state.services.size;
    case 'utilities':
      return state.utilities.size;
    case 'parcels':
      return ownedParcelCount(state.world);
    case 'farmTiles':
      return state.farmTiles;
    case 'interchanges':
      return highwayInterchanges(state.world);
    case 'transitFlow':
      return transitFlow(state);
    case 'atLevel':
      return countAtLeastLevel(state, goal.level);
  }
}

/**
 * Pays out every goal the city has met, and returns them so the caller can say
 * so. Called on the simulation's own clock, which means the offline catch-up
 * settles goals exactly as a live session would.
 */
export function settleMissions(state: GameState): Mission[] {
  const totals = totalBuildings(state);
  const finished: Mission[] = [];

  for (const mission of MISSIONS) {
    if (state.missionsDone.includes(mission.id)) continue;
    if (!eraReached(state.era, mission.from)) continue;
    if (measureGoal(state, totals, mission.goal) < mission.goal.target) continue;
    state.missionsDone.push(mission.id);
    state.money += mission.reward;
    finished.push(mission);
  }

  return finished;
}

/**
 * The goals on offer: unlocked, unfinished, nearest to done first.
 *
 * Nearest-first rather than in list order, because the one a player is about to
 * finish is the one worth showing them — and it puts the goal they are already
 * working toward at the top without their having to choose it.
 */
export function activeMissions(state: GameState, limit = MISSIONS_SHOWN): MissionProgress[] {
  const totals = totalBuildings(state);
  const open: MissionProgress[] = [];

  for (const mission of MISSIONS) {
    if (state.missionsDone.includes(mission.id)) continue;
    if (!eraReached(state.era, mission.from)) continue;
    const have = measureGoal(state, totals, mission.goal);
    const want = mission.goal.target;
    open.push({ mission, have, want, fraction: want > 0 ? Math.min(1, have / want) : 1 });
  }

  open.sort((a, b) => b.fraction - a.fraction);
  return open.slice(0, limit);
}

/** How much of the chain is behind the player, for the panel's heading. */
export function missionsCompleted(state: GameState): number {
  return state.missionsDone.length;
}

export function missionsTotal(): number {
  return MISSIONS.length;
}

/**
 * Roads the player actually drew. The national highway would otherwise count
 * toward "lay 24 tiles of road" from the first second of the game, which is
 * exactly the sort of unearned progress a goal exists to avoid.
 */
function playerRoadTiles(state: GameState): number {
  const { road, highway } = state.world;
  let count = 0;
  for (let i = 0; i < road.length; i++) {
    if ((road[i] ?? NONE) !== NONE && (highway[i] ?? 0) === 0) count++;
  }
  return count;
}

function countAtLeastLevel(state: GameState, level: number): number {
  let count = 0;
  for (const building of state.buildings.values()) {
    if (building.level >= level) count++;
  }
  return count;
}
