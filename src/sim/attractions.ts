import {
  ATTRACTION_HAPPINESS_CAP,
  ROAD_ACCESS_MAX_WALK,
  TOURIST_SPEND_PER_BED,
} from '../data/balance';
import {
  ATTRACTION_SPECS,
  isAttractionUnlocked,
  type AttractionKind,
} from '../data/attractions';
import type { Fields } from './fields';
import { touristTaxIncome, touristTaxPull } from './policies';
import type { GameState } from './state';
import { decodeTerrain, NONE } from './tiles';
import { visitorFactor, type VisitorField } from './visitors';
import { index, inBounds, isTileOwned } from './world';

/**
 * Attractions in play (§21): placement, pride, and the hotel ledger.
 *
 * The same shape as sim/ports.ts because it is the same kind of thing — a
 * hand-placed building with a standing cost and a reason to exist — and the
 * differences are exactly the interesting parts:
 *
 * - **Uniqueness is a rule, not a price.** A second stadium is refused, not
 *   made expensive: two of them would be a bug in what a stadium *is*.
 * - **A hotel earns from where it stands.** Its occupancy is read off the
 *   visitor field at its own tile, so a hotel behind a jammed junction on a
 *   street nobody reaches earns nothing — the same siting logic shops live by,
 *   pointed at beds instead of tills.
 * - **A landmark earns from existing.** Flat mood while it stands, capped so
 *   monuments cannot substitute for running a city, and a pull multiplier on
 *   the visitor flow every hotel and shop then feeds on.
 */
export interface Attraction {
  id: number;
  kind: AttractionKind;
  x: number;
  y: number;
}

export type AttractionRefusal =
  | 'locked'
  | 'unowned'
  | 'occupied'
  | 'noRoad'
  | 'tooDear'
  | 'alreadyBuilt';

export type PlaceAttractionResult =
  | { ok: true; attraction: Attraction }
  | { ok: false; reason: AttractionRefusal };

export function canPlaceAttraction(
  state: GameState,
  fields: Fields,
  kind: AttractionKind,
  x: number,
  y: number,
): PlaceAttractionResult | { ok: true } {
  const world = state.world;
  const spec = ATTRACTION_SPECS[kind];
  if (!isAttractionUnlocked(kind, state.era)) return { ok: false, reason: 'locked' };
  // Refused before the ground is even looked at: "you already have one" is the
  // answer however good the site is, and it is the answer the sheet shows too.
  if (spec.unique && hasAttraction(state, kind)) return { ok: false, reason: 'alreadyBuilt' };
  if (!inBounds(world, x, y) || !isTileOwned(world, x, y)) {
    return { ok: false, reason: 'unowned' };
  }
  const i = index(world, x, y);
  if (decodeTerrain(world.terrain[i] ?? 0) === 'water') return { ok: false, reason: 'occupied' };
  if ((world.road[i] ?? NONE) !== NONE) return { ok: false, reason: 'occupied' };
  if ((world.building[i] ?? 0) !== 0) return { ok: false, reason: 'occupied' };
  if (attractionAt(state, x, y)) return { ok: false, reason: 'occupied' };
  if ((fields.roadDistance[i] ?? 255) > ROAD_ACCESS_MAX_WALK) {
    return { ok: false, reason: 'noRoad' };
  }
  if (state.money < spec.cost) return { ok: false, reason: 'tooDear' };
  return { ok: true };
}

export function placeAttraction(
  state: GameState,
  fields: Fields,
  kind: AttractionKind,
  x: number,
  y: number,
): PlaceAttractionResult {
  const check = canPlaceAttraction(state, fields, kind, x, y);
  if (!check.ok) return check as PlaceAttractionResult;

  state.money -= ATTRACTION_SPECS[kind].cost;
  const id = state.nextAttractionId++;
  const attraction: Attraction = { id, kind, x, y };
  state.attractions.set(id, attraction);
  return { ok: true, attraction };
}

export function attractionAt(state: GameState, x: number, y: number): Attraction | null {
  for (const attraction of state.attractions.values()) {
    if (attraction.x === x && attraction.y === y) return attraction;
  }
  return null;
}

export function hasAttraction(state: GameState, kind: AttractionKind): boolean {
  for (const attraction of state.attractions.values()) {
    if (attraction.kind === kind) return true;
  }
  return false;
}

/** ₺ per minute the standing attractions cost, for the ledger. */
export function attractionUpkeep(state: GameState): number {
  let total = 0;
  for (const attraction of state.attractions.values()) {
    total += ATTRACTION_SPECS[attraction.kind].upkeep;
  }
  return total;
}

/**
 * The pull the city's landmarks exert on the visitor flow, ≥1.
 *
 * Multiplicative across landmarks and damped toward 1 for each additional one:
 * the second monument impresses less than the first, and a straight product
 * would make five landmarks a ×2.6 faucet no junction could justify.
 */
export function attractionPull(state: GameState): number {
  let pull = 1;
  let standing = 0;
  const seen = new Set<AttractionKind>();
  for (const attraction of state.attractions.values()) {
    const spec = ATTRACTION_SPECS[attraction.kind];
    if (spec.pull <= 1 || seen.has(attraction.kind)) continue;
    seen.add(attraction.kind);
    pull *= 1 + (spec.pull - 1) / (1 + standing * 0.5);
    standing++;
  }
  return pull * touristTaxPull(state);
}

/**
 * City-wide mood from the landmarks, capped.
 *
 * The cap is the design: pride is real and pride is finite, and a treasury
 * that could buy its way past every closed hospital with monuments would be
 * the lesson this game exists not to teach.
 */
export function attractionHappiness(state: GameState): number {
  let total = 0;
  const seen = new Set<AttractionKind>();
  for (const attraction of state.attractions.values()) {
    if (seen.has(attraction.kind)) continue;
    seen.add(attraction.kind);
    total += ATTRACTION_SPECS[attraction.kind].happiness;
  }
  return Math.min(ATTRACTION_HAPPINESS_CAP, total);
}

/**
 * ₺ per minute the hotels bring in, from the visitors actually reaching them.
 *
 * `visitorFactor` is the same read the shops use in the ledger, so a hotel and
 * the shop beside it always agree about whether anybody is on their street.
 * Without the field (offline, old tests) hotels earn a conservative floor
 * rather than nothing: an absence should not zero a building the player paid
 * for, and the same grace is extended to shops by the corridor fallback.
 */
export function tourismIncome(
  state: GameState,
  fields: Fields,
  visitors?: VisitorField,
): number {
  let total = 0;
  for (const attraction of state.attractions.values()) {
    const spec = ATTRACTION_SPECS[attraction.kind];
    if (spec.beds <= 0) continue;
    const reach = visitors
      ? visitorFactor(state.world, fields, visitors, attraction.x, attraction.y, 1)
      : 1.1;
    // The factor is ≥1 by construction; what exceeds 1 is footfall. Saturates
    // at full beds: a hotel cannot sleep more guests than it has rooms.
    const occupancy = Math.min(1, (reach - 1) * 2.5);
    total += spec.beds * occupancy * TOURIST_SPEND_PER_BED;
  }
  return total * touristTaxIncome(state);
}

/** Whether an airport stands — the third gate to the country (sim/ports.ts). */
export function hasAirGate(state: GameState): boolean {
  for (const attraction of state.attractions.values()) {
    if (ATTRACTION_SPECS[attraction.kind].gate) return true;
  }
  return false;
}
