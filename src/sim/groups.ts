import {
  BURIAL_HAPPINESS_HIT,
  CRIME_HAPPINESS_CAP,
  GROUP_ISSUE_WEIGHT,
  GROUP_MOOD_WEIGHT,
  GROUP_PARK_PER_RESIDENTS,
  GROUP_POLICY_SWAY,
  GROUP_SOLVENT_WEIGHT,
  GROUP_STOP_PER_RESIDENTS,
  GROUP_TAX_WEIGHT,
  TAX_RATE_MAX,
} from '../data/balance';
import { bandCount, burialHappiness, schooledShare, workingShare } from './cohorts';
import { crimeHappiness } from './crime';
import { rubbishStrain } from './rubbish';
import type { GameState } from './state';
import { decodeZone, ISSUE, NONE } from './tiles';
import { stopCount } from './transit';

/**
 * The electorate (§23) — the death of the single happiness number.
 *
 * One mood figure is a construction game's idea of a city. A governed city
 * answers in factions: the shopkeepers judge the street their tills stand on,
 * the retired judge the noise through their windows, the industrialists judge
 * the night-shift ordinance the retired hate. Every reading here is a group's
 * *own* view of systems that already run — nothing in this file simulates,
 * it only reads, so the vote stays the same kind of honest as the old one:
 * a defeat is a warning that was ignored, never a die that came up badly.
 *
 * Three deliberate properties:
 *
 * - **Derived, never stored.** Weights and approvals recompute from the state
 *   every time; there is nothing here to save, drift, or corrupt.
 * - **Complaints are read off the buildings.** The sim already stamps every
 *   building with its grievances (`ISSUE` bits). A group's anger is the share
 *   of *its own* buildings complaining — the same icons the player sees over
 *   the roofs, aggregated by who lives under them.
 * - **Every group shares the same civic base** (mood, tax, solvency), then
 *   diverges on its pet issues. So the factions agree a bankrupt city is bad,
 *   and disagree — by design, permanently — about the night shift.
 */
export type GroupId =
  | 'young'
  | 'elders'
  | 'families'
  | 'shopkeepers'
  | 'industrialists'
  | 'greens'
  | 'drivers';

/** Append-only, same contract as every other order table in this game. */
export const GROUP_ORDER: readonly GroupId[] = [
  'young',
  'elders',
  'families',
  'shopkeepers',
  'industrialists',
  'greens',
  'drivers',
];

export interface GroupReading {
  id: GroupId;
  /** Share of the electorate, 0..1. All readings sum to 1 (or all are 0). */
  weight: number;
  /** How this group would vote today, 0..1. */
  approval: number;
}

/** One pass over the buildings; every group reads from the same tally. */
interface Tallies {
  resCount: number;
  comCount: number;
  indCount: number;
  comJobs: number;
  indJobs: number;
  totalJobs: number;
  /** Share of buildings with the given grievance, by constituency. */
  resNoise: number;
  resPollution: number;
  resNoService: number;
  comTraffic: number;
  indTraffic: number;
  allTraffic: number;
  allPollution: number;
  allCount: number;
}

function tally(state: GameState): Tallies {
  const t: Tallies = {
    resCount: 0,
    comCount: 0,
    indCount: 0,
    comJobs: 0,
    indJobs: 0,
    totalJobs: 0,
    resNoise: 0,
    resPollution: 0,
    resNoService: 0,
    comTraffic: 0,
    indTraffic: 0,
    allTraffic: 0,
    allPollution: 0,
    allCount: 0,
  };
  for (const building of state.buildings.values()) {
    t.allCount++;
    t.totalJobs += building.jobs;
    if ((building.issues & ISSUE.traffic) !== 0) t.allTraffic++;
    if ((building.issues & ISSUE.pollution) !== 0) t.allPollution++;
    if (building.zone === 'res') {
      t.resCount++;
      if ((building.issues & ISSUE.noise) !== 0) t.resNoise++;
      if ((building.issues & ISSUE.pollution) !== 0) t.resPollution++;
      if ((building.issues & ISSUE.noService) !== 0) t.resNoService++;
    } else if (building.zone === 'com') {
      t.comCount++;
      t.comJobs += building.jobs;
      if ((building.issues & ISSUE.traffic) !== 0) t.comTraffic++;
    } else if (building.zone === 'ind') {
      t.indCount++;
      t.indJobs += building.jobs;
      if ((building.issues & ISSUE.traffic) !== 0) t.indTraffic++;
    }
  }
  return t;
}

/** Share of a constituency complaining, 0..1; an empty constituency is calm. */
function share(complaints: number, of: number): number {
  return of > 0 ? complaints / of : 0;
}

/**
 * The civic base every faction starts from: the mood, the tax bill, and
 * whether the till is filling. These were most of the old single-number
 * approval, and they stay common because no faction votes for bankruptcy.
 */
export function civicBase(state: GameState): number {
  let base = (state.happiness / 100) * GROUP_MOOD_WEIGHT;
  base += (1 - state.taxRate / TAX_RATE_MAX) * GROUP_TAX_WEIGHT;
  base += state.ledger.net >= 0 ? GROUP_SOLVENT_WEIGHT : 0;
  return base;
}

/** Park tiles per resident, saturating — the greens' and families' yardstick. */
function parkShare(state: GameState): number {
  const world = state.world;
  let parks = 0;
  for (let i = 0; i < world.zone.length; i++) {
    if (decodeZone(world.zone[i] ?? NONE) === 'park') parks++;
  }
  const wanted = state.population / GROUP_PARK_PER_RESIDENTS + 1;
  return Math.min(1, parks / wanted);
}

/** Stops per resident, saturating — how present the network feels. */
function transitPresence(state: GameState): number {
  const wanted = state.population / GROUP_STOP_PER_RESIDENTS + 1;
  return Math.min(1, stopCount(state) / wanted);
}

/**
 * Each group's pet score, 0..1 — the part of its vote the base doesn't cover.
 *
 * Signature ordinances swing the factions they name (`GROUP_POLICY_SWAY`
 * each way): the night shift pleases the industrialists and costs it with the
 * retired and the greens; recycling the mirror image. That asymmetry is the
 * §22 design carried to the ballot box — no ordinance is free, and now the
 * bill says *who* is paying it.
 */
function petScore(state: GameState, id: GroupId, t: Tallies): number {
  const on = (policy: string): boolean => state.policies.has(policy as never);
  const crimeCalm = 1 + crimeHappiness(state) / CRIME_HAPPINESS_CAP;
  const burialCalm = 1 + burialHappiness(state) / BURIAL_HAPPINESS_HIT;
  let score: number;
  switch (id) {
    case 'young': {
      // Work to find, somewhere to go at night, a way to get there.
      const workers = workingShare(state) * state.population;
      const employment = Math.min(1, t.totalJobs / (workers + 1));
      const nightlife = Math.min(1, t.comCount / (t.resCount * 0.25 + 1));
      score =
        0.45 * employment +
        0.25 * nightlife +
        0.3 * transitPresence(state) +
        (on('nightShift') ? GROUP_POLICY_SWAY * 0.5 : 0) +
        (on('freeTransit') ? GROUP_POLICY_SWAY * 0.5 : 0);
      break;
    }
    case 'elders':
      // Quiet streets, a clinic that answers, a cemetery that keeps up. The
      // tourist tax thins the crowds, which is exactly how they like squares.
      // Terms sum to 0.94, not 1: contentment keeps a little headroom, so a
      // policy aimed at the retired still visibly lands in a quiet city.
      score =
        0.38 * (1 - share(t.resNoise, t.resCount)) +
        0.28 * (1 - share(t.resNoService, t.resCount)) +
        0.28 * burialCalm -
        (on('nightShift') ? GROUP_POLICY_SWAY : 0) +
        (on('touristTax') ? GROUP_POLICY_SWAY * 0.5 : 0);
      break;
    case 'families':
      // Safe streets, a served neighbourhood, a park to take the children to.
      // Service expectations are era-aware already (ISSUE.noService), so a
      // village is not marked down for schools it has never been shown.
      score =
        0.4 * (1 - share(t.resNoService, t.resCount)) +
        0.35 * crimeCalm +
        0.25 * parkShare(state) +
        (on('schoolBuses') ? GROUP_POLICY_SWAY : 0);
      break;
    case 'shopkeepers':
      // A street customers can reach and bins that don't drive them off.
      score =
        0.4 * (1 - share(t.comTraffic, t.comCount)) +
        0.3 * state.demand.com +
        0.3 * (1 - rubbishStrain(state)) -
        (on('smokeBan') ? GROUP_POLICY_SWAY : 0) -
        (on('touristTax') ? GROUP_POLICY_SWAY * 0.5 : 0);
      break;
    case 'industrialists':
      // Goods that move and orders that come in.
      score =
        0.5 * (1 - share(t.indTraffic, t.indCount)) +
        0.5 * state.demand.ind +
        (on('nightShift') ? GROUP_POLICY_SWAY : 0) -
        (on('recycling') ? GROUP_POLICY_SWAY : 0) -
        (on('smokeBan') ? GROUP_POLICY_SWAY * 0.5 : 0);
      break;
    case 'greens':
      // Clean air over everything, then green ground and full buses.
      score =
        0.5 * (1 - share(t.allPollution, t.allCount)) +
        0.3 * parkShare(state) +
        0.2 * transitPresence(state) +
        (on('recycling') ? GROUP_POLICY_SWAY : 0) +
        (on('smokeBan') ? GROUP_POLICY_SWAY * 0.5 : 0) -
        (on('nightShift') ? GROUP_POLICY_SWAY : 0);
      break;
    case 'drivers': {
      // Moving traffic and a motorway in repair; the fare box they fill and
      // never ride galls them.
      const wear = state.highwayWear;
      let worn = 0;
      for (const section of wear) worn += section;
      const road = wear.length > 0 ? 1 - worn / wear.length : 1;
      score =
        0.65 * (1 - share(t.allTraffic, t.allCount)) +
        0.35 * road -
        (on('freeTransit') ? GROUP_POLICY_SWAY * 0.5 : 0);
      break;
    }
  }
  return score < 0 ? 0 : score > 1 ? 1 : score;
}

/** How many voters each banner plausibly claims. Overlap is fine — this is a
 * lobby model, not a census — because the weights are normalized at the end. */
function rawWeight(state: GameState, id: GroupId, t: Tallies): number {
  switch (id) {
    case 'young':
      return bandCount(state, 'young');
    case 'elders':
      return bandCount(state, 'elder');
    case 'families':
      // Parents vote where their children live.
      return bandCount(state, 'child');
    case 'shopkeepers':
      return t.comJobs;
    case 'industrialists':
      return t.indJobs;
    case 'greens':
      // An educated city grows a green movement; an unschooled one hasn't yet.
      return bandCount(state, 'adult') * schooledShare(state) * 0.5;
    case 'drivers':
      return bandCount(state, 'adult') * 0.5;
  }
}

/**
 * The factions as they stand today. Weights sum to 1 once anybody lives here;
 * an empty map returns every group at zero weight and the civic base alone.
 */
export function readGroups(state: GameState): GroupReading[] {
  const t = tally(state);
  const base = civicBase(state);
  const raw = GROUP_ORDER.map((id) => ({
    id,
    weight: rawWeight(state, id, t),
    approval: clamp01(base + GROUP_ISSUE_WEIGHT * petScore(state, id, t)),
  }));
  let total = 0;
  for (const group of raw) total += group.weight;
  if (total <= 0) return raw.map((g) => ({ ...g, weight: 0 }));
  return raw.map((g) => ({ ...g, weight: g.weight / total }));
}

/**
 * How the city would vote today, 0..1 — the weighted sum of the factions.
 *
 * This is what the ballot box actually counts (sim/elections.ts reads it).
 * A city too new to have factions judges as one household: the civic base
 * plus the three visible failures everybody minds (bins, crime, burials).
 * That keeps the pre-§23 contract — the bins cost votes in *every* city —
 * without inventing factions nobody has joined yet.
 */
export function electorateApproval(state: GameState): number {
  const groups = readGroups(state);
  let weight = 0;
  for (const group of groups) weight += group.weight;
  if (weight <= 0) {
    const crimeCalm = 1 + crimeHappiness(state) / CRIME_HAPPINESS_CAP;
    const burialCalm = 1 + burialHappiness(state) / BURIAL_HAPPINESS_HIT;
    const civic = (1 - rubbishStrain(state) + crimeCalm + burialCalm) / 3;
    return clamp01(civicBase(state) + GROUP_ISSUE_WEIGHT * clamp01(civic));
  }
  let sum = 0;
  for (const group of groups) sum += group.weight * group.approval;
  return clamp01(sum);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
