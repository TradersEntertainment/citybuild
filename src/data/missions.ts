import type { Level } from './buildings';
import type { Era } from '../sim/tiles';
import type { ReportDimension } from '../sim/report';
import type { SiteWant } from '../sim/sites';

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
  | { measure: 'interchanges'; target: number }
  | { measure: 'transitFlow'; target: number }
  | { measure: 'ports'; target: number }
  | { measure: 'seaIncome'; target: number }
  | { measure: 'atLevel'; level: Level; target: number }
  // The mandates (§27). Everything above measures how *much* the player built;
  // these two measure how well it was run, off the report card (sim/report.ts).
  | { measure: 'cardOverall'; target: number }
  | { measure: 'cardDimension'; dimension: ReportDimension; target: number }
  // The site goals (§28). The only measure with a *place*: everything else is
  // counted across the whole map, this one only inside its own square.
  | { measure: 'onSite'; want: SiteWant; target: number };

export interface Mission {
  id: string;
  goal: MissionGoal;
  /** Paid once, on completion. */
  reward: number;
  /**
   * Legacy points added to what retiring this city is worth (sim/legacy.ts).
   *
   * The mandates' reward, and money is deliberately not it. A goal that says
   * "you ran this city well" should not pay in the currency the player already
   * has too much of by the time they can meet it; it should pay in the one
   * thing that outlives the city. Absent on every ordinary goal, which are
   * about building and are paid for in money.
   */
  legacy?: number;
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
  { id: 'junction', goal: { measure: 'interchanges', target: 1 }, reward: 3_500, from: 'village' },
  // The coast, which a player will otherwise never think to look at: the sea
  // branch is behind one condition nothing else in the game has, and a goal is
  // the cheapest way to say "there is something over there".
  { id: 'firstBerth', goal: { measure: 'ports', target: 1 }, reward: 3_800, from: 'village' },
  /**
   * The site goals (§28) — the first goals in this game with a *place*, sitting
   * at their own eras rather than in a block of their own.
   *
   * The chain's opening teaches the verbs (draw a road, paint a zone, place a
   * station) and then never once says *where*, so a player learns the tools
   * without ever learning that the map has parts. These send them somewhere: a
   * square is marked, it pulses, and the goal is what to put inside it.
   *
   * Each asks for a different verb — grow, paint, place — so together they are
   * a tour of what can be done to a piece of ground rather than one instruction
   * repeated five times.
   */
  { id: 'siteHomes', goal: { measure: 'onSite', want: 'homes', target: 6 }, reward: 3_900, from: 'village' },

  { id: 'mains', goal: { measure: 'utilities', target: 1 }, reward: 6_000, from: 'town' },
  { id: 'surveyor', goal: { measure: 'parcels', target: 2 }, reward: 9_000, from: 'town' },
  { id: 'thirdStorey', goal: { measure: 'atLevel', level: 3, target: 20 }, reward: 7_000, from: 'town' },
  { id: 'fiveThousand', goal: { measure: 'population', target: 5_000 }, reward: 12_000, from: 'town' },
  { id: 'corridor', goal: { measure: 'transitFlow', target: 200 }, reward: 8_000, from: 'town' },
  { id: 'harbour', goal: { measure: 'seaIncome', target: 260 }, reward: 14_000, from: 'town' },
  { id: 'sitePark', goal: { measure: 'onSite', want: 'park', target: 10 }, reward: 14_500, from: 'town' },
  { id: 'siteStation', goal: { measure: 'onSite', want: 'service', target: 1 }, reward: 15_000, from: 'town' },

  { id: 'served', goal: { measure: 'services', target: 6 }, reward: 18_000, from: 'city' },
  { id: 'waterfront', goal: { measure: 'ports', target: 4 }, reward: 26_000, from: 'city' },
  { id: 'reserve', goal: { measure: 'reserve', target: 120_000 }, reward: 15_000, from: 'city' },
  { id: 'fourthStorey', goal: { measure: 'atLevel', level: 4, target: 25 }, reward: 24_000, from: 'city' },
  { id: 'twentyThousand', goal: { measure: 'population', target: 20_000 }, reward: 35_000, from: 'city' },
  { id: 'siteShops', goal: { measure: 'onSite', want: 'shops', target: 8 }, reward: 38_000, from: 'city' },

  { id: 'skyline', goal: { measure: 'atLevel', level: 5, target: 30 }, reward: 60_000, from: 'metro' },
  { id: 'roofOver', goal: { measure: 'housing', target: 90_000 }, reward: 70_000, from: 'metro' },
  { id: 'siteTall', goal: { measure: 'onSite', want: 'tall', target: 8 }, reward: 75_000, from: 'metro' },
  { id: 'hundredThousand', goal: { measure: 'population', target: 100_000 }, reward: 120_000, from: 'metropolis' },

  /**
   * The mandates (§27) — the constitution's "görev sistemi asıl oyun olmalı".
   *
   * Everything above this line asks *how much*: lay 24 tiles, house 100,000
   * people, raise 30 towers. Not one of them asks how well, which means the
   * whole chain can be finished by a mayor running a choked, filthy, unequal
   * city, congratulating them at every step. That is the gap §25 exists to
   * close, and these are its consumer.
   *
   * Four properties, all deliberate:
   *
   * - **They pay in legacy, not money.** By the city era a player has more money
   *   than uses for it; the mandate's answer to "what did running it well get
   *   me" has to be the thing that outlives the city (sim/legacy.ts).
   * - **They can be met and then lost, and stay met.** Sign the oil lobby after
   *   earning the clean-air mandate and the card drops — the mandate does not.
   *   Taking back something a player earned would be the one unrecoverable
   *   thing in this game, and "you were able to run it this way" is a true
   *   statement about a mayor whatever they did next.
   * - **They are era-gated late.** A village cannot be graded on equity and
   *   should not be shown a goal about it.
   * - **They are not all offered at once.** Each names one dimension, so the
   *   player learns the card a column at a time rather than being handed six
   *   bars and told to raise them.
   */
  {
    id: 'cleanAir',
    goal: { measure: 'cardDimension', dimension: 'environment', target: 70 },
    reward: 0,
    legacy: 3,
    from: 'town',
  },
  {
    id: 'streetsThatMove',
    goal: { measure: 'cardDimension', dimension: 'mobility', target: 70 },
    reward: 0,
    legacy: 3,
    from: 'town',
  },
  {
    id: 'lookedAfter',
    goal: { measure: 'cardDimension', dimension: 'welfare', target: 70 },
    reward: 0,
    legacy: 4,
    from: 'city',
  },
  {
    id: 'paysItsWay',
    goal: { measure: 'cardDimension', dimension: 'economy', target: 70 },
    reward: 0,
    legacy: 4,
    from: 'city',
  },
  // The hardest of the six to hold, and the one nothing else in the game asks
  // for: a city where the worst end is not far behind the best.
  {
    id: 'oneCity',
    goal: { measure: 'cardDimension', dimension: 'equity', target: 70 },
    reward: 0,
    legacy: 6,
    from: 'city',
  },
  {
    id: 'builtToLast',
    goal: { measure: 'cardDimension', dimension: 'endurance', target: 70 },
    reward: 0,
    legacy: 5,
    from: 'metro',
  },
  // Six dimensions at once, which is a different thing from six dimensions one
  // at a time: the mandates above can each be met in a city built around that
  // one column, and this one cannot.
  {
    id: 'wellGoverned',
    goal: { measure: 'cardOverall', target: 70 },
    reward: 0,
    legacy: 12,
    from: 'metro',
  },
];

/** How many goals are offered at once. Three is a choice; ten is a list. */
export const MISSIONS_SHOWN = 3;

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((mission) => mission.id === id);
}
