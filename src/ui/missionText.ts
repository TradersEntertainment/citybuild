import type { MissionGoal } from '../data/missions';
import { STR } from '../data/strings.tr';

/**
 * A goal, said in words.
 *
 * Kept apart from both the data and the panel: the mission list is balance
 * numbers, the panel is layout, and neither should be the place a sentence is
 * assembled. Exhaustive over the union, so adding a goal kind is a type error
 * here rather than a blank line in the panel.
 */
export function describeGoal(goal: MissionGoal): string {
  const say = STR.mission.goal;
  switch (goal.measure) {
    case 'roadTiles':
      return say.roadTiles(goal.target);
    case 'buildings':
      return say.buildings(goal.target);
    case 'population':
      return say.population(goal.target);
    case 'jobs':
      return say.jobs(goal.target);
    case 'housing':
      return say.housing(goal.target);
    case 'happiness':
      return say.happiness(goal.target);
    case 'reserve':
      return say.reserve(goal.target);
    case 'services':
      return say.services(goal.target);
    case 'utilities':
      return say.utilities(goal.target);
    case 'parcels':
      return say.parcels(goal.target);
    case 'farmTiles':
      return say.farmTiles(goal.target);
    case 'interchanges':
      return say.interchanges(goal.target);
    case 'transitFlow':
      return say.transitFlow(goal.target);
    case 'atLevel':
      return say.atLevel(goal.level, goal.target);
  }
}
