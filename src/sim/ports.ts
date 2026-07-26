import { ROAD_ACCESS_MAX_WALK, SEA_GATE_HAPPINESS_CAP } from '../data/balance';
import { isPortUnlocked, PORT_SPECS, type PortKind } from '../data/ports';
import type { Fields } from './fields';
import type { PlacementResult } from './services';
import type { GameState } from './state';
import { NONE } from './tiles';
import { inBounds, index, isTileOwned, type World } from './world';
import { isWater } from './worldgen';

/**
 * Berths, and what the sea pays for them (denize yatırım).
 *
 * Modelled on the stations deliberately: same placement verb, same standing
 * upkeep, same map. What is different is the one condition — a berth has to see
 * open water — and what that condition does to the map. Every rule in this game
 * so far has made the middle of a parcel the good land; this makes the edge of
 * one worth more than the middle, and it is the first time the terrain the
 * generator produced has been an opportunity rather than a constraint.
 *
 * Income is deliberately two-sided. Water in reach is what the berth *can*
 * handle and the city's own size is what it *has to* handle, so a big harbour on
 * a pond earns little and a jetty beside an ocean earns little; a port earns when
 * both are true. That is what stops the answer being "put one on every tile of
 * coast".
 */
export interface Port {
  id: number;
  kind: PortKind;
  x: number;
  y: number;
}

/**
 * Open water within reach, counted by tile.
 *
 * A circle rather than a square, because a berth's business is how much sea is
 * in front of it and a square would quietly reward standing on a diagonal.
 */
export function openWaterNear(world: World, x: number, y: number, reach: number): number {
  let count = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > reach * reach) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(world, nx, ny)) continue;
      if (isWater(world, nx, ny)) count++;
    }
  }
  return count;
}

export function canPlacePort(
  state: GameState,
  fields: Fields,
  kind: PortKind,
  x: number,
  y: number,
): PlacementResult {
  const world = state.world;
  if (!isPortUnlocked(kind, state.era)) return { ok: false, reason: 'locked' };
  if (!inBounds(world, x, y) || !isTileOwned(world, x, y)) {
    return { ok: false, reason: 'unowned' };
  }
  const i = index(world, x, y);
  // Its own plot, like a station — and on dry land: the berth stands on the
  // shore and reaches out, rather than being built in the sea.
  if (isWater(world, x, y)) return { ok: false, reason: 'occupied' };
  if ((world.road[i] ?? NONE) !== NONE) return { ok: false, reason: 'occupied' };
  if ((world.building[i] ?? 0) !== 0) return { ok: false, reason: 'occupied' };
  if (portAt(state, x, y)) return { ok: false, reason: 'occupied' };
  if ((fields.roadDistance[i] ?? 255) > ROAD_ACCESS_MAX_WALK) {
    return { ok: false, reason: 'noRoad' };
  }
  const spec = PORT_SPECS[kind];
  if (openWaterNear(world, x, y, spec.reach) < spec.waterNeeded) {
    return { ok: false, reason: 'noWater' };
  }
  if (state.money < spec.cost) return { ok: false, reason: 'tooDear' };
  return { ok: true };
}

export function placePort(
  state: GameState,
  fields: Fields,
  kind: PortKind,
  x: number,
  y: number,
): PlacementResult {
  const check = canPlacePort(state, fields, kind, x, y);
  if (!check.ok) return check;

  state.money -= PORT_SPECS[kind].cost;
  const id = state.nextPortId++;
  state.ports.set(id, { id, kind, x, y });
  return { ok: true };
}

export function portAt(state: GameState, x: number, y: number): Port | null {
  for (const port of state.ports.values()) {
    if (port.x === x && port.y === y) return port;
  }
  return null;
}

export function removePort(state: GameState, id: number): boolean {
  return state.ports.delete(id);
}

/** Total upkeep of every berth standing, ₺ per minute. */
export function portUpkeep(state: GameState): number {
  let total = 0;
  for (const port of state.ports.values()) total += PORT_SPECS[port.kind].upkeep;
  return total;
}

/** Jobs the waterfront offers. Counted with the city's, like the farms are. */
export function portJobs(state: GameState): number {
  let total = 0;
  for (const port of state.ports.values()) total += PORT_SPECS[port.kind].jobs;
  return total;
}

/**
 * What the sea pays, ₺ per minute.
 *
 * Water in reach and city size multiply rather than add: a berth needs somewhere
 * to sail to *and* somebody to sail for. Recomputed rather than cached, because
 * the coast never changes and the population changes every second.
 */
export function seaIncome(state: GameState): number {
  let total = 0;
  for (const port of state.ports.values()) {
    const spec = PORT_SPECS[port.kind];
    const water = openWaterNear(state.world, port.x, port.y, spec.reach);
    if (water < spec.waterNeeded) continue;
    const berth = spec.yieldPerWater * water;
    const trade = spec.yieldPerRootCitizen * Math.sqrt(Math.max(0, state.population));
    total += berth + trade;
  }
  return total;
}

/**
 * Mood the waterfront returns.
 *
 * Capped, and low. A marina is worth having; a row of eight of them is not a
 * happy city, it is an exploit.
 */
export function portHappiness(state: GameState): number {
  let total = 0;
  for (const port of state.ports.values()) total += PORT_SPECS[port.kind].happiness ?? 0;
  return Math.min(SEA_GATE_HAPPINESS_CAP, total);
}

/**
 * Marks the tiles that are a way out of the country by sea.
 *
 * A derived column, like `connected` and `highwayBlocked`: written from the
 * ports that exist, read by the connectivity pass, never saved. A cargo port is
 * the only berth that counts — a fishing shelter lands fish, it does not import
 * a nation's goods.
 *
 * Cargo ports need to be working to count. A port whose harbour has somehow
 * stopped qualifying is not a gate, and neither is one nobody can drive to; the
 * road-access check happened when it was placed, and the sea does not move.
 */
export function refreshSeaGates(state: GameState): void {
  const world = state.world;
  world.seaGate.fill(0);
  for (const port of state.ports.values()) {
    const spec = PORT_SPECS[port.kind];
    if (!spec.seaGate) continue;
    if (openWaterNear(world, port.x, port.y, spec.reach) < spec.waterNeeded) continue;
    world.seaGate[index(world, port.x, port.y)] = 1;
  }
}

/** Whether the city has a working port at all. */
export function hasSeaGate(state: GameState): boolean {
  for (const port of state.ports.values()) {
    const spec = PORT_SPECS[port.kind];
    if (!spec.seaGate) continue;
    if (openWaterNear(state.world, port.x, port.y, spec.reach) >= spec.waterNeeded) return true;
  }
  return false;
}

/** Berths whose harbour is deep enough to work, for the panel to count. */
export function workingPorts(state: GameState): Port[] {
  const working: Port[] = [];
  for (const port of state.ports.values()) {
    const spec = PORT_SPECS[port.kind];
    if (openWaterNear(state.world, port.x, port.y, spec.reach) >= spec.waterNeeded) {
      working.push(port);
    }
  }
  return working;
}
