import {
  REPORT_EQUITY_FLOOR,
  REPORT_GRADE_BANDS,
  REPORT_LEGACY_SWING,
  REPORT_PARK_PER_RESIDENTS,
  REPORT_SERVICE_KINDS,
} from '../data/balance';
import { educationCoverage } from './tech';
import type { GameState } from './state';
import { decodeZone, ISSUE, NONE } from './tiles';
import { SERVICE_SPECS } from '../data/services';
import { stopCount } from './transit';
import { index } from './world';

/**
 * The city's report card (§25).
 *
 * The constitution names one dilemma as the design itself: *popülizm bazen iyi
 * planlamadan çok oy getirir*. Until now the game could only state one half of
 * that. Approval (sim/elections.ts) is the weighted sum of the factions, and it
 * is weighted **by how many people hold each opinion** — which is exactly right
 * for a ballot box and exactly wrong as a measure of whether a city was well
 * run. A mayor who pleases the drivers and the industrialists, who are many,
 * can lose the greens and whoever lives at the wrong end of the map, who are
 * few, and win every election for it.
 *
 * So this is the other half, and the whole of its design is one sentence: **the
 * report card counts nobody.** Six dimensions, each 0..1, each weighted equally
 * regardless of how many voters would agree with it. Approval says whether the
 * mayor kept their job. The card says what the city got.
 *
 * That the two can disagree is the point, and it is a tested property rather
 * than a hope — a populist city scores well at the ballot box and badly here,
 * and the panel shows both figures side by side so the divergence is one glance
 * rather than a lecture.
 *
 * Everything is read from state the simulation already keeps. Not one new
 * number is stored, which is what §2 asks for: the game has dozens of metrics
 * the player only feels, and this is a *consumer* for them rather than another
 * thing to feel. Nothing here is saved either — a card is a reading, and a
 * reading taken twice from the same city gives the same answer.
 */
export type ReportDimension =
  | 'mobility'
  | 'environment'
  | 'welfare'
  | 'economy'
  | 'equity'
  | 'endurance';

/** APPEND-ONLY where it reaches the chronicle; the panel draws them in order. */
export const REPORT_DIMENSIONS: readonly ReportDimension[] = [
  'mobility',
  'environment',
  'welfare',
  'economy',
  'equity',
  'endurance',
];

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ReportCard {
  /** Each dimension, 0..1. */
  scores: Record<ReportDimension, number>;
  /** The unweighted mean of them, 0..1. */
  overall: number;
  grade: Grade;
}

/**
 * A grade for a score.
 *
 * Bands rather than a curve: a letter has to mean the same thing in a village
 * and a metropolis, or a player cannot tell whether they improved or merely
 * grew. The bottom band is open — there is no score too low to be an F, and no
 * city is ever told it has failed at something it has not been shown.
 */
export function gradeOf(score: number): Grade {
  const clamped = clamp01(score);
  for (const band of REPORT_GRADE_BANDS) {
    if (clamped >= band.from) return band.grade;
  }
  return 'F';
}

/**
 * Reads the card.
 *
 * An empty city scores zero across the board and is graded F — and is never
 * shown the card at all, because a report on a city that does not exist yet is
 * the game marking a player down for not having started. The caller gates on
 * population, the same rule the electorate panel keeps.
 */
export function readReport(state: GameState): ReportCard {
  const scores: Record<ReportDimension, number> = {
    mobility: mobilityScore(state),
    environment: environmentScore(state),
    welfare: welfareScore(state),
    economy: economyScore(state),
    equity: equityScore(state),
    endurance: enduranceScore(state),
  };

  let sum = 0;
  for (const dimension of REPORT_DIMENSIONS) sum += scores[dimension];
  // Unweighted, deliberately and permanently. Weighting these by anything —
  // population, land area, how much the player looked at them — would make this
  // a second approval rating, and the game already has one of those.
  const overall = clamp01(sum / REPORT_DIMENSIONS.length);

  return { scores, overall, grade: gradeOf(overall) };
}

/**
 * Streets that move, and somewhere to be that is not a car.
 *
 * Traffic is counted off the issue flags rather than the load field so it is
 * the same congestion the buildings themselves are complaining about — the
 * player fixes one thing and both readings move.
 */
function mobilityScore(state: GameState): number {
  const total = state.buildings.size;
  if (total === 0) return 0;
  let jammed = 0;
  for (const building of state.buildings.values()) {
    if ((building.issues & ISSUE.traffic) !== 0) jammed++;
  }
  const flowing = 1 - jammed / total;
  // A city with no buses is not marked down to zero — a village has no business
  // running one — but a city that solved traffic with nothing but asphalt does
  // not get full marks either.
  const wanted = state.population / 4_000 + 1;
  const transit = Math.min(1, stopCount(state) / wanted);
  return clamp01(flowing * 0.75 + transit * 0.25);
}

/** Air worth breathing, and ground that is not all roof. */
function environmentScore(state: GameState): number {
  const total = state.buildings.size;
  if (total === 0) return 0;
  let smoky = 0;
  for (const building of state.buildings.values()) {
    if ((building.issues & ISSUE.pollution) !== 0) smoky++;
  }
  const clean = 1 - smoky / total;

  let parks = 0;
  const world = state.world;
  for (let i = 0; i < world.zone.length; i++) {
    if (decodeZone(world.zone[i] ?? NONE) === 'park') parks++;
  }
  const wanted = state.population / REPORT_PARK_PER_RESIDENTS + 1;
  const green = Math.min(1, parks / wanted);

  return clamp01(clean * 0.65 + green * 0.35);
}

/**
 * Whether the city looks after the people in it.
 *
 * Service coverage across the kinds a city is expected to have, plus schooling
 * — which is the one input in the game that pays a generation later, so a mayor
 * optimising for the next election is exactly the mayor who skips it.
 */
function welfareScore(state: GameState): number {
  const total = state.buildings.size;
  if (total === 0) return 0;

  let covered = 0;
  for (const kind of REPORT_SERVICE_KINDS) {
    const bit = SERVICE_SPECS[kind]?.bit ?? 0;
    if (bit === 0) continue;
    let reached = 0;
    for (const building of state.buildings.values()) {
      const mask = state.world.serviceMask[index(state.world, building.x, building.y)] ?? 0;
      if ((mask & bit) !== 0) reached++;
    }
    covered += reached / total;
  }
  const services = REPORT_SERVICE_KINDS.length > 0 ? covered / REPORT_SERVICE_KINDS.length : 0;

  return clamp01(services * 0.6 + educationCoverage(state) * 0.4);
}

/**
 * Whether the city pays for itself.
 *
 * Solvency rather than wealth: a treasury is a snapshot a player can inflate by
 * selling nothing and building nothing, whereas a city running at a loss is a
 * city whose next mayor inherits a problem. Debt counts against it in
 * proportion to what the city earns, so a loan a growing city can service is
 * not the same failure as one it cannot.
 */
function economyScore(state: GameState): number {
  const income = Math.max(0, state.ledger.taxIncome);
  if (income <= 0 && state.buildings.size === 0) return 0;
  // Net against income: breaking even is a pass, and a healthy surplus is full
  // marks. A city cannot score here by hoarding.
  const margin = income > 0 ? clamp01(0.5 + state.ledger.net / (income * 2)) : 0;
  // A debt worth a few minutes of income is nothing; one worth an hour is not.
  const burden = income > 0 ? clamp01(state.debt / (income * 60)) : state.debt > 0 ? 1 : 0;
  return clamp01(margin * 0.65 + (1 - burden) * 0.35);
}

/**
 * Whether the city was built for everyone in it.
 *
 * The one dimension with no equivalent anywhere else in the game, and the
 * reason the card exists at all. Land value is already computed for every tile
 * and read only for what a plot earns; nobody has ever asked what its *spread*
 * says. It says a great deal: a gleaming centre ringed by neglect scores
 * exactly as well as a uniformly poor city on every other measure here, and
 * worse on this one.
 *
 * Measured as the mean of the worst fifth against the mean of the best fifth,
 * over built ground only. A ratio rather than a variance because it is
 * naturally 0..1, needs no tuning constant, and answers a question a player can
 * act on: *how much worse is the bad end of my city than the good end?*
 *
 * Empty ground is excluded on purpose. Unbuilt land has no residents to be
 * treated unequally, and counting it would score a city for the fields it has
 * not reached yet.
 */
function equityScore(state: GameState): number {
  const values: number[] = [];
  for (const building of state.buildings.values()) {
    const i = index(state.world, building.x, building.y);
    values.push(state.world.landValue[i] ?? 0);
  }
  // Below a handful of buildings a "worst fifth" is one building, and the
  // reading would swing wildly on a village placing its second shop. A city too
  // small to be unequal is scored as equal.
  if (values.length < REPORT_EQUITY_FLOOR) return values.length > 0 ? 1 : 0;

  values.sort((a, b) => a - b);
  const fifth = Math.max(1, Math.floor(values.length / 5));
  let worst = 0;
  let best = 0;
  for (let i = 0; i < fifth; i++) {
    worst += values[i] ?? 0;
    best += values[values.length - 1 - i] ?? 0;
  }
  if (best <= 0) return 1; // A city with no value anywhere is not an unequal one.
  return clamp01(worst / fifth / (best / fifth));
}

/**
 * What would still be here in fifty years.
 *
 * Buildings that reached their upper levels, because a district that grew tall
 * is one that stayed desirable long enough to; and the landmarks and parks a
 * city keeps rather than the sheds it throws up. The counterweight to every
 * other dimension being a snapshot: this one can only be earned slowly, so it
 * is the dimension a mayor cannot fix in the week before the vote.
 */
function enduranceScore(state: GameState): number {
  const total = state.buildings.size;
  if (total === 0) return 0;
  let tall = 0;
  for (const building of state.buildings.values()) {
    if (building.level >= 3) tall++;
  }
  const grown = Math.min(1, tall / (total * 0.35 + 1));
  // Landmarks are rare and expensive; two is already a city that built for
  // longer than its own term.
  const landmarks = Math.min(1, state.attractions.size / 2);
  return clamp01(grown * 0.7 + landmarks * 0.3);
}

/**
 * What the card is worth to the next city.
 *
 * The card's consumer, and the answer to "a number with no way to act on it".
 * Retiring already hands the next run an endowment from population and era
 * (sim/legacy.ts) — a figure a sprawling, polluted, unequal city earns exactly
 * as easily as a well-run one. This scales it.
 *
 * Deliberately a swing rather than a gate: a C city still passes something on,
 * and an A city passes on more. Making a bad card forfeit the endowment would
 * punish a player for the run they already finished, which nothing in this game
 * does; making it worth nothing would leave the card decorative.
 */
export function reportLegacyFactor(state: GameState): number {
  const { overall } = readReport(state);
  return 1 - REPORT_LEGACY_SWING + REPORT_LEGACY_SWING * 2 * clamp01(overall);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
