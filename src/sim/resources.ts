import { RESOURCE_DEPLETION_PER_MIN, RESOURCE_OUTPUT } from '../data/balance';
import type { Building } from './buildings';
import type { GameState } from './state';
import { RESOURCE_ORDER, type ResourceKind } from './tiles';
import { index, type World } from './world';

/**
 * What the ground is made of, and what a workshop standing on it gets out (§25).
 *
 * Coal, iron, stone and clay have been generated into every map since the first
 * phase — twenty-six ragged clusters, placed by height and fertility so a seam
 * turns up where a seam ought to — and read by nothing but the tile inspector.
 * A whole layer of terrain the player could see and never use.
 *
 * Two rules, and they are the same rule twice: **a seam is worth working, and a
 * seam runs out.** Industry on coal earns half again as much; a district built on
 * it works through it over an hour or so and then has to be something else. That
 * is what turns the geology from a decoration into a reason to put the factories
 * *there* — and, later, a reason to be glad the city also learned to do something
 * that is not mining.
 *
 * Depletion is stored in a column beside the resource kind rather than by
 * clearing the kind outright: the difference matters, because a worked-out coal
 * field should still read as a coal field on the map and in the inspector. What
 * changed is that there is nothing left in it.
 *
 * Pure and deterministic — no dice. A seam does not surprise anybody either.
 */

/** How much of a seam is left under a tile, 0..1. Full where nothing has mined. */
export function seamLeft(world: World, x: number, y: number): number {
  const i = index(world, x, y);
  if ((world.resource[i] ?? 0) === 0) return 0;
  return 1 - (world.depleted[i] ?? 0) / FULLY_MINED;
}

/** The depletion column is a byte, so a worked-out seam reads 255, not 1. */
export const FULLY_MINED = 255;

export function resourceAt(world: World, x: number, y: number): ResourceKind {
  return RESOURCE_ORDER[world.resource[index(world, x, y)] ?? 0] ?? 'none';
}

/**
 * What a workshop on this tile multiplies its output by.
 *
 * Scaled by what is left, so a seam does not stop paying the moment it runs low —
 * it fades. A cliff would make the exhaustion feel like a bug rather than like
 * the end of a mine.
 */
export function resourceFactor(world: World, x: number, y: number): number {
  const kind = resourceAt(world, x, y);
  if (kind === 'none') return 1;
  const full = RESOURCE_OUTPUT[kind];
  return 1 + (full - 1) * seamLeft(world, x, y);
}

/**
 * Works the seams under the city's industry, by `dt` seconds.
 *
 * Only industry mines: a house on coal is a house on coal. And only industry that
 * is actually producing — a workshop with no staff takes nothing out of the
 * ground, which keeps a stalled city from quietly exhausting its own map.
 */
export function stepResources(state: GameState, dt: number): ResourceEvent[] {
  const events: ResourceEvent[] = [];
  const world = state.world;
  const rate = (RESOURCE_DEPLETION_PER_MIN * dt) / 60;
  if (rate <= 0) return events;

  for (const building of state.buildings.values()) {
    if (building.zone !== 'ind' || building.jobs <= 0) continue;
    for (const { x, y } of tilesOf(building)) {
      const i = index(world, x, y);
      if ((world.resource[i] ?? 0) === 0) continue;
      const was = world.depleted[i] ?? 0;
      if (was >= FULLY_MINED) continue;
      const now = Math.min(FULLY_MINED, was + rate * FULLY_MINED);
      world.depleted[i] = now;
      // Announced once, at the moment the last of it comes up.
      if (now >= FULLY_MINED && was < FULLY_MINED) {
        events.push({ kind: 'seamExhausted', x, y, resource: resourceAt(world, x, y) });
      }
    }
  }
  return events;
}

export interface ResourceEvent {
  kind: 'seamExhausted';
  x: number;
  y: number;
  resource: ResourceKind;
}

/** Every tile a building stands on. Most are one; some are not. */
function* tilesOf(building: Building): Generator<{ x: number; y: number }> {
  for (let dy = 0; dy < building.h; dy++) {
    for (let dx = 0; dx < building.w; dx++) {
      yield { x: building.x + dx, y: building.y + dy };
    }
  }
}

/** Seam tiles the city still has something left in, for the panel to report. */
export function seamsRemaining(world: World): number {
  let count = 0;
  for (let i = 0; i < world.resource.length; i++) {
    if ((world.resource[i] ?? 0) === 0) continue;
    if ((world.depleted[i] ?? 0) < FULLY_MINED) count++;
  }
  return count;
}
