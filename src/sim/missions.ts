import { MISSIONS, MISSIONS_SHOWN, type Mission, type MissionGoal } from '../data/missions';
import { totalBuildings, type BuildingTotals } from './buildings';
import { highwayInterchanges, transitFlow } from './highway';
import { seaIncome, workingPorts } from './ports';
import { readReport } from './report';
import { countOnSite, siteArea, type SiteArea } from './sites';
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
    case 'ports':
      // Working berths, not built ones: a jetty on a pond is not a waterfront,
      // and the goal should mean what the income means.
      return workingPorts(state).length;
    case 'seaIncome':
      return seaIncome(state);
    case 'atLevel':
      return countAtLeastLevel(state, goal.level);
    // The card, on the same 0..100 scale as happiness — so the panel's bar and
    // its "18 / 24" line need no special case, and a target reads the way a
    // player would say it out loud.
    case 'cardOverall':
      return readReport(state).overall * 100;
    case 'cardDimension':
      return readReport(state).scores[goal.dimension] * 100;
    // The only measure that asks *where* (sim/sites.ts). A map with nowhere to
    // put the square reads as zero rather than as complete: the goal is dropped
    // from the offered list by `activeMissions`, so nothing is ever shown a
    // player that they cannot finish.
    case 'onSite': {
      const area = siteArea(state, goal.want);
      return area ? countOnSite(state, area, goal.want) : 0;
    }
  }
}

/**
 * The squares the player is currently being sent to, for the map to mark.
 *
 * Only unfinished, era-unlocked goals: a site whose goal is done stops pulsing,
 * which is the whole of the feedback loop — the marking is the ask, and it goes
 * out when the ask is met.
 */
export function activeSites(state: GameState): { id: string; area: SiteArea }[] {
  const open: { id: string; area: SiteArea }[] = [];
  for (const mission of MISSIONS) {
    if (mission.goal.measure !== 'onSite') continue;
    if (state.missionsDone.includes(mission.id)) continue;
    if (!eraReached(state.era, mission.from)) continue;
    const area = siteArea(state, mission.goal.want);
    if (area) open.push({ id: mission.id, area });
  }
  return open;
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
    // A site goal on a map with nowhere dry to put its square is dropped rather
    // than offered at zero forever. An impossible goal in a chain the player
    // trusts is worse than no goal at all (§28).
    if (mission.goal.measure === 'onSite' && !siteArea(state, mission.goal.want)) continue;
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
