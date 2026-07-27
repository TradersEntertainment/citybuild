import { ROAD_ACCESS_MAX_WALK } from '../data/balance';
import {
  isServiceUnlocked,
  requiredServices,
  SERVICE_SPECS,
  type ServiceKind,
} from '../data/services';
import { UTILITIES_REQUIRED_FROM } from '../data/utilities';
import { budgetOf } from './budgets';
import type { Fields } from './fields';
import type { GameState } from './state';
import { eraReached, SERVICE, type Era } from './tiles';
import { index, inBounds, isTileOwned, type World } from './world';

/**
 * Service buildings and the ground they cover (§9).
 *
 * Coverage is a radius, but only over tiles that can reach a road. A station
 * does not serve the far side of a mountain it happens to be within twelve
 * tiles of, and tying it to road access keeps the road the thing every system
 * in this game answers to.
 */
export interface ServiceBuilding {
  id: number;
  kind: ServiceKind;
  x: number;
  y: number;
}

export interface PlacementResult {
  ok: boolean;
  /** Why not, when ok is false — the UI says this rather than failing silently. */
  reason?: 'locked' | 'unowned' | 'occupied' | 'noRoad' | 'tooDear' | 'noWater';
}

export function canPlaceService(
  state: GameState,
  fields: Fields,
  kind: ServiceKind,
  x: number,
  y: number,
): PlacementResult {
  const world = state.world;
  if (!isServiceUnlocked(kind, state.era)) return { ok: false, reason: 'locked' };
  if (!inBounds(world, x, y) || !isTileOwned(world, x, y)) {
    return { ok: false, reason: 'unowned' };
  }
  const i = index(world, x, y);
  // A station needs its own plot: not on a road, not on top of a building, and
  // not on another station.
  if ((world.road[i] ?? 0) !== 0) return { ok: false, reason: 'occupied' };
  if ((world.building[i] ?? 0) !== 0) return { ok: false, reason: 'occupied' };
  if (serviceAt(state, x, y)) return { ok: false, reason: 'occupied' };
  if ((fields.roadDistance[i] ?? 255) > ROAD_ACCESS_MAX_WALK) {
    return { ok: false, reason: 'noRoad' };
  }
  if (state.money < SERVICE_SPECS[kind].cost) return { ok: false, reason: 'tooDear' };
  return { ok: true };
}

export function placeService(
  state: GameState,
  fields: Fields,
  kind: ServiceKind,
  x: number,
  y: number,
): PlacementResult {
  const check = canPlaceService(state, fields, kind, x, y);
  if (!check.ok) return check;

  state.money -= SERVICE_SPECS[kind].cost;
  const id = state.nextServiceId++;
  state.services.set(id, { id, kind, x, y });
  return { ok: true };
}

export function serviceAt(state: GameState, x: number, y: number): ServiceBuilding | null {
  for (const service of state.services.values()) {
    if (service.x === x && service.y === y) return service;
  }
  return null;
}

export function removeService(state: GameState, id: number): boolean {
  return state.services.delete(id);
}

/** Total upkeep of every station standing, in ₺ per minute. */
export function serviceUpkeep(state: GameState): number {
  let total = 0;
  for (const service of state.services.values()) {
    // Scaled by what the department is funded at (sim/budgets.ts): the same
    // multiplier that decides what it achieves decides what it costs.
    total += SERVICE_SPECS[service.kind].upkeep * budgetOf(state, service.kind);
  }
  return total;
}

/**
 * The ground one station covers, given what its department is funded at.
 *
 * The square root is the point. Radius scaled straight by the budget would make
 * the *area* grow with the square of the money, which is a free upgrade every
 * player would max out on sight. Scaling the radius by the root makes the area
 * grow in step with the bill — a budget buys exactly what it costs, which is
 * what keeps the slider a question about priorities rather than a puzzle with an
 * answer.
 */
export function fundedRadius(state: GameState, kind: ServiceKind): number {
  return SERVICE_SPECS[kind].radius * Math.sqrt(budgetOf(state, kind));
}

/**
 * Rewrites world.serviceMask from the stations that exist. Wholesale, like
 * every other field: stations are few, the mask is one byte per tile, and an
 * incremental version would have to unpick overlapping coverage on removal.
 */
export function computeServiceCoverage(state: GameState, fields: Fields): void {
  const world = state.world;
  world.serviceMask.fill(0);

  for (const service of state.services.values()) {
    const spec = SERVICE_SPECS[service.kind];
    const radius = fundedRadius(state, service.kind);
    const radiusSquared = radius * radius;
    const reach = Math.ceil(radius);
    const x0 = Math.max(0, service.x - reach);
    const y0 = Math.max(0, service.y - reach);
    const x1 = Math.min(world.size - 1, service.x + reach);
    const y1 = Math.min(world.size - 1, service.y + reach);

    for (let y = y0; y <= y1; y++) {
      const dy = y - service.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x - service.x;
        if (dx * dx + dy * dy > radiusSquared) continue;
        const i = index(world, x, y);
        // Ground nobody can drive to is ground nobody is serving.
        if ((fields.roadDistance[i] ?? 255) > ROAD_ACCESS_MAX_WALK) continue;
        world.serviceMask[i] = (world.serviceMask[i] ?? 0) | spec.bit;
      }
    }
  }
}

/**
 * How well a tile is served, 0..1, judged against what the city's era expects.
 *
 * Before a service is expected its absence costs nothing — a founding
 * settlement is not marked down for having no fire brigade — which is what
 * keeps the opening exactly as it was tuned.
 */
export function serviceCoverageAt(world: World, era: Era, tileIndex: number): number {
  const required = requiredServices(era);
  const utilities = utilitiesExpected(era);
  const total = required.length + (utilities ? 2 : 0);
  if (total === 0) return 1;

  const mask = world.serviceMask[tileIndex] ?? 0;
  let covered = 0;
  for (const kind of required) {
    if ((mask & SERVICE_SPECS[kind].bit) !== 0) covered++;
  }
  if (utilities) {
    if ((mask & SERVICE.water) !== 0) covered++;
    if ((mask & SERVICE.power) !== 0) covered++;
  }
  return covered / total;
}

/**
 * Whether the era expects running water and electricity at all.
 *
 * Not before town, for the same reason the civic services wait: the opening was
 * measured and tuned with none of this, and a settlement drawing its own water
 * is not a failing one. It only became safe to count these at all once plants
 * were placeable — requiring a system the player cannot provide is precisely
 * the fault that once pinned every plot below the growth threshold.
 */
export function utilitiesExpected(era: Era): boolean {
  return eraReached(era, UTILITIES_REQUIRED_FROM);
}

