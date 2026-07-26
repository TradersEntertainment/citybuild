import { DEMOLITION_REFUND } from '../data/balance';
import { PORT_SPECS } from '../data/ports';
import { SERVICE_SPECS } from '../data/services';
import { UTILITY_SPECS } from '../data/utilities';
import type { TilePoint } from '../input/pathGeometry';
import type { Building } from './buildings';
import { isNationalHighway } from './highway';
import type { Port } from './ports';
import type { ServiceBuilding } from './services';
import type { GameState } from './state';
import { NONE } from './tiles';
import type { TileEdit } from './undo';
import type { UtilityPlant } from './utilities';
import { inBounds, index } from './world';

/**
 * Taking things down (§5.1).
 *
 * One operation across every layer, because "sil" has to mean what the player
 * thinks it means. An eraser that only lifts roads leaves a mis-painted
 * district permanent past the twentieth undo, which is precisely the punished
 * mis-touch the brief forbids — and it is the sort of trap a player meets once
 * and then stops trusting the tool.
 *
 * Ground is free to clear: paint costs a few lira a tile and charging to scrub
 * it would make the player think twice about fixing a mistake. A facility is a
 * single four-figure purchase, so half of it comes back — enough that a station
 * one tile out of place is an annoyance rather than a loss, not so much that
 * placement stops being a decision.
 */
export interface RemovedEntities {
  services: ServiceBuilding[];
  utilities: UtilityPlant[];
  ports: Port[];
  /** Grown buildings, kept whole so undo restores their level rather than a hut. */
  buildings: Building[];
}

export interface DemolishResult {
  changes: TileEdit[];
  removed: RemovedEntities;
  /** Negative when demolition hands money back, so undo reverses it by sign. */
  spent: number;
}

export function createRemoved(): RemovedEntities {
  return { services: [], utilities: [], ports: [], buildings: [] };
}

export function isEmptyRemoval(removed: RemovedEntities | undefined): boolean {
  if (!removed) return true;
  return (
    removed.services.length === 0 &&
    removed.utilities.length === 0 &&
    removed.ports.length === 0 &&
    removed.buildings.length === 0
  );
}

/** True when the erase actually touched something worth an undo entry. */
export function didDemolish(result: DemolishResult): boolean {
  return result.changes.length > 0 || !isEmptyRemoval(result.removed);
}

/** True when a road tile was among the changes; road-derived fields must be redone. */
export function touchedRoads(changes: readonly TileEdit[]): boolean {
  return changes.some((change) => change.layer === 'road');
}

/**
 * Clears every layer under `tiles`: pavement, zoning, whatever grew there and
 * whatever the player placed by hand.
 *
 * Buildings are pulled down here rather than left for the building pass to
 * notice its permission is gone. The pass would get there within a second, but a
 * second of a house standing on ground the player just erased reads as the
 * eraser having missed.
 */
export function demolishArea(state: GameState, tiles: readonly TilePoint[]): DemolishResult {
  const { world } = state;
  const changes: TileEdit[] = [];
  const removed = createRemoved();
  let spent = 0;

  /** Indices touched, so a brush that overlaps itself does not erase twice. */
  const cleared = new Set<number>();

  for (const tile of tiles) {
    if (!inBounds(world, tile.x, tile.y)) continue;
    const at = index(world, tile.x, tile.y);
    if (cleared.has(at)) continue;
    cleared.add(at);

    const road = world.road[at] ?? NONE;
    // The national highway is the state's, and the state does not take it down
    // because a mayor swept an eraser across it.
    if (road !== NONE && !isNationalHighway(world, tile.x, tile.y)) {
      changes.push({ x: tile.x, y: tile.y, layer: 'road', previous: road });
      world.road[at] = NONE;
      // The arrow goes with the street it was painted on. Left behind it would
      // be a traffic law on bare ground: invisible, and waiting to surprise
      // whoever paves here next (sim/oneWay.ts).
      const way = world.oneWay[at] ?? 0;
      if (way !== 0) {
        changes.push({ x: tile.x, y: tile.y, layer: 'oneWay', previous: way });
        world.oneWay[at] = 0;
      }
    }

    const zone = world.zone[at] ?? NONE;
    if (zone !== NONE) {
      changes.push({ x: tile.x, y: tile.y, layer: 'zone', previous: zone });
      world.zone[at] = NONE;
    }

    const buildingId = world.building[at] ?? 0;
    if (buildingId !== 0) {
      const building = state.buildings.get(buildingId);
      if (building) {
        removed.buildings.push(building);
        state.buildings.delete(buildingId);
      }
      world.building[at] = 0;
    }
  }

  // Facilities are swept by walking the two maps once rather than asking each
  // tile what stands on it: a 5×5 brush is twenty-five tiles and a grown city
  // has dozens of stations, so the per-tile search is the expensive way round.
  for (const service of [...state.services.values()]) {
    if (!cleared.has(index(world, service.x, service.y))) continue;
    state.services.delete(service.id);
    removed.services.push(service);
    spent -= refundOf(SERVICE_SPECS[service.kind].cost);
  }
  for (const plant of [...state.utilities.values()]) {
    if (!cleared.has(index(world, plant.x, plant.y))) continue;
    state.utilities.delete(plant.id);
    removed.utilities.push(plant);
    spent -= refundOf(UTILITY_SPECS[plant.kind].cost);
  }
  for (const port of [...state.ports.values()]) {
    if (!cleared.has(index(world, port.x, port.y))) continue;
    state.ports.delete(port.id);
    removed.ports.push(port);
    spent -= refundOf(PORT_SPECS[port.kind].cost);
  }

  return { changes, removed, spent };
}

/**
 * Puts back what an erase took, for the undo stack. Tiles are the stack's own
 * job; this only covers the things that are not tiles.
 *
 * Ids are restored as they were. They cannot collide: the counters only ever go
 * up, so nothing has been handed the number in the meantime.
 */
export function restoreRemoved(state: GameState, removed: RemovedEntities): void {
  for (const service of removed.services) state.services.set(service.id, service);
  for (const plant of removed.utilities) state.utilities.set(plant.id, plant);
  for (const port of removed.ports) state.ports.set(port.id, port);
  for (const building of removed.buildings) {
    state.buildings.set(building.id, building);
    state.world.building[index(state.world, building.x, building.y)] = building.id;
  }
}

function refundOf(cost: number): number {
  return Math.round(cost * DEMOLITION_REFUND);
}
