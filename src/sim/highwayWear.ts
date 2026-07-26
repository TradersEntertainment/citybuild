import {
  HIGHWAY_BILLED_HEAL_SHARE,
  HIGHWAY_HEAL_PER_S,
  HIGHWAY_REPAIR_BASE,
  HIGHWAY_REPAIR_PER_ROOT_CITIZEN,
  HIGHWAY_SECTION_TILES,
  HIGHWAY_WEAR_BILL,
  HIGHWAY_WEAR_PER_INTERCHANGE,
  HIGHWAY_WEAR_PER_S,
} from '../data/balance';
import type { GameState } from './state';
import { NONE } from './tiles';
import { index, isTileOwned, type World } from './world';

/**
 * What the war does to the road (savaş ve yol bakımı).
 *
 * The national highway has always been the one thing on the map the player
 * could take for granted: the state laid it, the state maintains it, and the
 * city's whole relationship with the country runs along it. That is exactly why
 * it is worth threatening. When the century turns violent, the convoys come
 * through — tank transporters, artillery trains, columns of lorries — and a
 * road built for carts and saloons takes it badly.
 *
 * The rules are deliberately few, because the punishment is already written
 * elsewhere. A stretch worn past use is barricaded, and a barricaded stretch
 * stops seeding connectivity and stops counting as an interchange. Everything
 * the player then feels — migration drying up, the toll income stopping, the
 * streets beyond the barricade fading on the map, the buildings on them
 * emptying — is the existing highway-connection rule doing its job. No new
 * penalty was written; an old one was simply pointed at the road.
 *
 * Only stretches crossing land the player owns wear. Out in the fog the road is
 * the state's business, and a city cannot be billed for, or cut off by, damage
 * it can neither see nor reach.
 */

/** One maintained stretch of motorway, as the state accounts for it. */
export interface HighwaySection {
  index: number;
  /** 0 = new, HIGHWAY_WEAR_BILL = the state sends a bill, 1 = barricaded. */
  wear: number;
  /** Route tiles in this stretch. */
  tiles: number;
  /** Whether any of it crosses land the player owns. */
  owned: boolean;
  /** Junctions onto it; the city's own lorries are what wear it fastest. */
  interchanges: number;
}

export type HighwayWearEventKind = 'damaged' | 'blocked' | 'reopened';

export interface HighwayWearEvent {
  kind: HighwayWearEventKind;
  /** How many stretches this happened to at once. */
  sections: number;
}

/** How many stretches this map's motorway is maintained in. */
export function sectionCount(world: World): number {
  if (world.highwayRoute.length === 0) return 0;
  return Math.ceil(world.highwayRoute.length / HIGHWAY_SECTION_TILES);
}

/**
 * Sizes the wear array to the route, keeping whatever wear is already recorded.
 *
 * Called on load as well as on creation: the route is regenerated from the seed
 * and is therefore the same length every time, but a save written by a build
 * with a different stretch length must not be allowed to leave the array and
 * the road disagreeing about how many stretches there are.
 */
export function ensureSections(state: GameState): void {
  const wanted = sectionCount(state.world);
  const wear = state.highwayWear;
  if (wear.length === wanted) return;
  wear.length = wanted;
  for (let i = 0; i < wanted; i++) {
    const value = wear[i];
    wear[i] = typeof value === 'number' && Number.isFinite(value) ? clamp(value) : 0;
  }
}

/** Reads every stretch, with the facts the wear rules need. */
export function readSections(state: GameState): HighwaySection[] {
  const { world } = state;
  const total = sectionCount(world);
  const sections: HighwaySection[] = [];
  for (let i = 0; i < total; i++) {
    sections.push({
      index: i,
      wear: clamp(state.highwayWear[i] ?? 0),
      tiles: 0,
      owned: false,
      interchanges: 0,
    });
  }

  for (let step = 0; step < world.highwayRoute.length; step++) {
    const point = world.highwayRoute[step];
    if (!point) continue;
    const section = sections[Math.floor(step / HIGHWAY_SECTION_TILES)];
    if (!section) continue;
    section.tiles++;
    if (isTileOwned(world, point.x, point.y)) section.owned = true;
    if (touchesPlayerRoad(world, point.x, point.y)) section.interchanges++;
  }

  return sections;
}

/** True where the motorway is barricaded and nothing gets through. */
export function isHighwayBlocked(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  return (world.highwayBlocked[index(world, x, y)] ?? 0) === 1;
}

/**
 * Writes the two derived columns the rest of the game reads: how worn each
 * motorway tile is (for the map) and whether it is shut (for every rule).
 *
 * Derived like `connected`, and never saved — the wear itself lives on the
 * state, and these are just it spread back over the tiles it applies to.
 */
export function refreshHighwayDamage(state: GameState): void {
  const { world } = state;
  world.highwayDamage.fill(0);
  world.highwayBlocked.fill(0);
  for (let step = 0; step < world.highwayRoute.length; step++) {
    const point = world.highwayRoute[step];
    if (!point) continue;
    const wear = clamp(state.highwayWear[Math.floor(step / HIGHWAY_SECTION_TILES)] ?? 0);
    if (wear <= 0) continue;
    const i = index(world, point.x, point.y);
    world.highwayDamage[i] = Math.round(wear * 255);
    if (wear >= 1) world.highwayBlocked[i] = 1;
  }
}

/**
 * Advances the wear and reports what crossed a line.
 *
 * War adds, peace subtracts. The one asymmetry that matters: below the invoice
 * threshold the state patches its own road at full rate, and above it the state
 * has already sent a bill and all but stops — a token trickle, so a city that
 * genuinely cannot pay is not locked out of the country forever, but slow
 * enough that waiting it out is a far worse deal than paying.
 */
export function stepHighwayWear(state: GameState, dt: number): HighwayWearEvent[] {
  ensureSections(state);
  const total = state.highwayWear.length;
  if (total === 0 || dt <= 0) return [];

  const atWar = state.timelineEffects.war;
  const sections = readSections(state);
  let damaged = 0;
  let blocked = 0;
  let reopened = 0;

  for (const section of sections) {
    // Out in the fog the motorway is the state's problem. A stretch the player
    // has never seen must not be able to cut their city off.
    if (!section.owned) continue;
    const before = section.wear;
    let wear = before;

    if (atWar) {
      const convoy = 1 + HIGHWAY_WEAR_PER_INTERCHANGE * section.interchanges;
      wear += HIGHWAY_WEAR_PER_S * convoy * dt;
    } else {
      const rate = before >= HIGHWAY_WEAR_BILL
        ? HIGHWAY_HEAL_PER_S * HIGHWAY_BILLED_HEAL_SHARE
        : HIGHWAY_HEAL_PER_S;
      wear -= rate * dt;
    }

    wear = clamp(wear);
    if (wear === before) continue;
    state.highwayWear[section.index] = wear;

    if (before < HIGHWAY_WEAR_BILL && wear >= HIGHWAY_WEAR_BILL) damaged++;
    if (before < 1 && wear >= 1) blocked++;
    if (before >= 1 && wear < 1) reopened++;
  }

  if (damaged === 0 && blocked === 0 && reopened === 0) return [];
  refreshHighwayDamage(state);

  const events: HighwayWearEvent[] = [];
  if (blocked > 0) events.push({ kind: 'blocked', sections: blocked });
  else if (damaged > 0) events.push({ kind: 'damaged', sections: damaged });
  if (reopened > 0) events.push({ kind: 'reopened', sections: reopened });
  return events;
}

/** Stretches the state has invoiced the city for. */
export function billedSections(state: GameState): number {
  let count = 0;
  for (const wear of state.highwayWear) {
    if (wear >= HIGHWAY_WEAR_BILL) count++;
  }
  return count;
}

/** Stretches currently barricaded. */
export function blockedSections(state: GameState): number {
  let count = 0;
  for (const wear of state.highwayWear) {
    if (wear >= 1) count++;
  }
  return count;
}

/**
 * What the state is asking for, in ₺. Zero when there is no bill outstanding.
 *
 * Each stretch costs by how bad it is, and the whole bill scales with the city
 * by the square root of its population — the same curve the corridor's income
 * follows, so what the road gives and what it asks for grow together.
 */
export function repairCost(state: GameState): number {
  let worn = 0;
  for (const wear of state.highwayWear) {
    if (wear >= HIGHWAY_WEAR_BILL) worn += wear;
  }
  if (worn === 0) return 0;
  const perSection =
    HIGHWAY_REPAIR_BASE + HIGHWAY_REPAIR_PER_ROOT_CITIZEN * Math.sqrt(Math.max(0, state.population));
  return Math.round(perSection * worn);
}

/**
 * Pays the bill and puts the road back. All of it or none of it: a half-paid
 * motorway is an accounting screen, and the bank is one prompt away for a city
 * that is short.
 */
export function repairHighway(state: GameState): boolean {
  const cost = repairCost(state);
  if (cost <= 0) return false;
  if (state.money < cost) return false;

  state.money -= cost;
  for (let i = 0; i < state.highwayWear.length; i++) {
    if ((state.highwayWear[i] ?? 0) >= HIGHWAY_WEAR_BILL) state.highwayWear[i] = 0;
  }
  refreshHighwayDamage(state);
  return true;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** True when any of the four orthogonal neighbours is the player's pavement. */
function touchesPlayerRoad(world: World, x: number, y: number): boolean {
  for (let d = 0; d < 4; d++) {
    const nx = x + (DX[d] as number);
    const ny = y + (DY[d] as number);
    if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
    const i = index(world, nx, ny);
    if ((world.road[i] ?? NONE) === NONE) continue;
    if ((world.highway[i] ?? 0) === 1) continue;
    return true;
  }
  return false;
}

const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;
