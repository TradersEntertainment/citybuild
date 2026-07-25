import type { Level } from './buildings';
import type { Era } from '../sim/tiles';

/**
 * Goals (§12.3).
 *
 * The game has always had plenty to do and never once said so. A player who
 * has drawn their first road is looking at a map, four verbs and no reason to
 * prefer any of them — which is exactly what they will tell you, and did.
 *
 * Every goal here is *measured* off state the simulation was already keeping.
 * Nothing is granted by pressing a button and nothing can be completed any way
 * other than by building the city, so the chain is a reading of progress rather
 * than a second currency laid over it. That also means an offline stretch
 * completes goals, which is the right answer: the city did the work.
 *
 * The order is the order the systems arrive in. Each goal is the smallest thing
 * that proves the player has understood the one before it.
 */
export type MissionGoal =
  | { measure: 'roadTiles'; target: number }
  | { measure: 'buildings'; target: number }
  | { measure: 'population'; target: number }
  | { measure: 'jobs'; target: number }
  | { measure: 'housing'; target: number }
  | { measure: 'happiness'; target: number }
  | { measure: 'reserve'; target: number }
  | { measure: 'services'; target: number }
  | { measure: 'utilities'; target: number }
  | { measure: 'parcels'; target: number }
  | { measure: 'farmTiles'; target: number }
  | { measure: 'atLevel'; level: Level; target: number };

export interface Mission {
  id: string;
  goal: MissionGoal;
  /** Paid once, on completion. */
  reward: number;
  /** Not offered before this era. */
  from: Era;
}

/**
 * The chain, in order.
 *
 * Rewards are deliberately small next to what the city earns by the time each
 * one lands — a goal that pays for the next district would make the chain the
 * game rather than a commentary on it. They are sized to be a leg-up at the
 * moment the player is most likely to be short: the first plant, the first
 * parcel, the first boulevard.
 */
export const MISSIONS: readonly Mission[] = [
  { id: 'firstRoad', goal: { measure: 'roadTiles', target: 24 }, reward: 400, from: 'founding' },
  { id: 'firstHomes', goal: { measure: 'buildings', target: 6 }, reward: 700, from: 'founding' },
  { id: 'firstWork', goal: { measure: 'jobs', target: 40 }, reward: 900, from: 'founding' },
  { id: 'hundred', goal: { measure: 'population', target: 150 }, reward: 1_500, from: 'founding' },

  { id: 'station', goal: { measure: 'services', target: 1 }, reward: 2_200, from: 'village' },
  { id: 'secondStorey', goal: { measure: 'atLevel', level: 2, target: 8 }, reward: 2_500, from: 'village' },
  { id: 'field', goal: { measure: 'farmTiles', target: 40 }, reward: 1_800, from: 'village' },
  { id: 'contented', goal: { measure: 'happiness', target: 62 }, reward: 3_000, from: 'village' },

  { id: 'mains', goal: { measure: 'utilities', target: 1 }, reward: 6_000, from: 'town' },
  { id: 'surveyor', goal: { measure: 'parcels', target: 2 }, reward: 9_000, from: 'town' },
  { id: 'thirdStorey', goal: { measure: 'atLevel', level: 3, target: 20 }, reward: 7_000, from: 'town' },
  { id: 'fiveThousand', goal: { measure: 'population', target: 5_000 }, reward: 12_000, from: 'town' },

  { id: 'served', goal: { measure: 'services', target: 6 }, reward: 18_000, from: 'city' },
  { id: 'reserve', goal: { measure: 'reserve', target: 120_000 }, reward: 15_000, from: 'city' },
  { id: 'fourthStorey', goal: { measure: 'atLevel', level: 4, target: 25 }, reward: 24_000, from: 'city' },
  { id: 'twentyThousand', goal: { measure: 'population', target: 20_000 }, reward: 35_000, from: 'city' },

  { id: 'skyline', goal: { measure: 'atLevel', level: 5, target: 30 }, reward: 60_000, from: 'metro' },
  { id: 'roofOver', goal: { measure: 'housing', target: 90_000 }, reward: 70_000, from: 'metro' },
  { id: 'hundredThousand', goal: { measure: 'population', target: 100_000 }, reward: 120_000, from: 'metropolis' },
];

/** How many goals are offered at once. Three is a choice; ten is a list. */
export const MISSIONS_SHOWN = 3;

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((mission) => mission.id === id);
}
