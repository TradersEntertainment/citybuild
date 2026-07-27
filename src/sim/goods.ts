import {
  GOODS_CONGESTION_BITE,
  GOODS_DECAY_PER_TILE,
  GOODS_EXPORT_PRICE,
  GOODS_GLUT_FLOOR,
  GOODS_PER_COMMERCIAL_JOB,
  GOODS_PER_INDUSTRIAL_JOB,
  GOODS_REACH,
  GOODS_SHORTAGE_FLOOR,
} from '../data/balance';
import type { Fields } from './fields';
import { hasSeaGate } from './ports';
import type { GameState } from './state';
import { NONE } from './tiles';
import { nearestRoad } from './traffic';
import { index, type World } from './world';

/**
 * Crates (§16, §17): what the workshops make and the shops sell.
 *
 * Industry and commerce have never had anything to do with each other. A
 * workshop made money out of thin air, a shop made money out of thin air, and
 * the only thing joining them was a demand curve that asked for both. This is
 * the link: workshops put crates onto the road, the crates travel along it and
 * thin out with distance and with queues, and a shop sells what reaches it.
 *
 * Modelled as a **field**, not as lorries. A crate is not an object with a
 * destination — it is a quantity that spreads out from a factory gate and
 * decays, exactly the way the country's visitors spread from an interchange
 * (sim/visitors.ts). That is deliberate: this codebase's traffic is a field
 * rather than a fleet, and a supply chain made of tracked vehicles would be the
 * only system in the game that disagreed with that.
 *
 * What it buys, in the order the player meets it:
 *
 * - **A shop cut off from the workshops sells less.** Retail at the far end of
 *   the map is no longer as good as retail beside the factories.
 * - **Workshops with nowhere to send crates make less.** An industrial city with
 *   no shops is not a money printer.
 * - **A working harbour sells the surplus abroad** — the export the port system
 *   has always claimed in its name and never actually done.
 *
 * Two floors, both deliberate: a shortage never takes a shop below
 * GOODS_SHORTAGE_FLOOR and a glut never takes a workshop below GOODS_GLUT_FLOOR.
 * The point is a slope the player can feel and fix, not a cliff that empties a
 * district while they are looking somewhere else.
 *
 * Pure and deterministic. No dice.
 */
export interface GoodsField {
  /** Crates a minute reaching each road tile. */
  supply: Float32Array;
}

export function createGoodsField(size: number): GoodsField {
  return { supply: new Float32Array(size * size) };
}

/** What the city's workshops put out per minute. */
export function goodsProduced(state: GameState): number {
  let total = 0;
  for (const building of state.buildings.values()) {
    if (building.zone === 'ind') total += building.jobs * GOODS_PER_INDUSTRIAL_JOB;
  }
  return total;
}

/** What its shops want per minute. */
export function goodsWanted(state: GameState): number {
  let total = 0;
  for (const building of state.buildings.values()) {
    if (building.zone === 'com') total += building.jobs * GOODS_PER_COMMERCIAL_JOB;
  }
  return total;
}

/**
 * Spreads crates out from every workshop along the roads.
 *
 * The same wavefront the visitors use, and for the same reason: it is one pass
 * over the road network rather than a search per shop, and it produces a figure
 * per *tile* — which is what lets a shop ask "what reaches my street" instead of
 * "which factory is mine", a question a field cannot answer and a player would
 * not want to think about anyway.
 */
export function computeGoods(
  state: GameState,
  fields: Fields,
  goods: GoodsField,
  load: Float32Array,
): void {
  const world = state.world;
  const { supply } = goods;
  supply.fill(0);

  // Every workshop pushes its crates onto the street it fronts onto.
  let frontier: number[] = [];
  const seen = new Uint8Array(supply.length);
  for (const building of state.buildings.values()) {
    if (building.zone !== 'ind' || building.jobs <= 0) continue;
    const road = nearestRoad(world, fields, building.x, building.y);
    if (road < 0) continue;
    supply[road] = (supply[road] ?? 0) + building.jobs * GOODS_PER_INDUSTRIAL_JOB;
    if (seen[road] === 1) continue;
    seen[road] = 1;
    frontier.push(road);
  }
  if (frontier.length === 0) return;

  for (let ring = 0; ring < GOODS_REACH && frontier.length > 0; ring++) {
    const next: number[] = [];
    for (const at of frontier) {
      const here = supply[at] ?? 0;
      if (here <= 0) continue;
      const x = at % world.size;
      const y = (at - x) / world.size;

      // A queue costs a lorry the same way it costs a visitor, and measured the
      // same way — over capacity, so a street that is merely busy is not a queue.
      const queue = Math.max(0, (load[at] ?? 0) - 1);
      const passed = here * GOODS_DECAY_PER_TILE * (1 / (1 + queue * GOODS_CONGESTION_BITE));

      const onward: number[] = [];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
        const ni = index(world, nx, ny);
        if ((world.road[ni] ?? NONE) === NONE) continue;
        if (seen[ni] === 1) continue;
        onward.push(ni);
      }
      if (onward.length === 0) continue;

      const share = passed / onward.length;
      for (const ni of onward) {
        seen[ni] = 1;
        supply[ni] = (supply[ni] ?? 0) + share;
        next.push(ni);
      }
    }
    frontier = next;
  }
}

/**
 * What a shop on this tile can actually sell, as an output multiplier.
 *
 * One is "everything it wanted arrived". Below one is a shortage, floored so a
 * shop nobody delivers to still sells what it has. Never above one: a lorry
 * queue outside the door is not a sales technique.
 */
export function stockFactor(
  world: World,
  fields: Fields,
  goods: GoodsField,
  x: number,
  y: number,
  wanted: number,
): number {
  // `wanted` is this shop's whole appetite, jobs included — not the per-job rate.
  // The supply field is crates a minute reaching a tile, so comparing it against
  // a per-job figure would have told a forty-job department store it was fully
  // stocked on what a single till gets through.
  if (wanted <= 0) return 1;
  const road = nearestRoad(world, fields, x, y);
  if (road < 0) return GOODS_SHORTAGE_FLOOR;
  const arriving = goods.supply[road] ?? 0;
  if (arriving >= wanted) return 1;
  const met = arriving / wanted;
  return GOODS_SHORTAGE_FLOOR + (1 - GOODS_SHORTAGE_FLOOR) * met;
}

/**
 * What a workshop can shift, as an output multiplier.
 *
 * City-wide rather than per-tile: a crate that cannot be sold here goes on the
 * next lorry, and modelling *which* workshop is the unlucky one would be a
 * precision the player has no way to act on. What they can act on is the ratio
 * — more shops, or a harbour — and that is what this reads.
 */
export function marketFactor(state: GameState): number {
  const made = goodsProduced(state);
  if (made <= 0) return 1;
  // A working harbour sells whatever the city cannot: the export the port
  // system has claimed in its name since it was written.
  const sold = goodsWanted(state) + (hasSeaGate(state) ? exportCapacity(state) : 0);
  if (sold >= made) return 1;
  const share = sold / made;
  return GOODS_GLUT_FLOOR + (1 - GOODS_GLUT_FLOOR) * share;
}

/**
 * Crates a minute the harbours can ship out.
 *
 * Scaled by how much waterfront the city built rather than being unlimited: a
 * fishing shelter is not a container terminal, and a city that wants to export
 * its way out of a glut has to have built somewhere to export from.
 */
export function exportCapacity(state: GameState): number {
  let crates = 0;
  for (const port of state.ports.values()) {
    crates += port.kind === 'cargo' ? 90 : port.kind === 'shipyard' ? 40 : 10;
  }
  return crates;
}

/** What the surplus fetches abroad, ₺ per minute. */
export function exportIncome(state: GameState): number {
  if (!hasSeaGate(state)) return 0;
  const surplus = goodsProduced(state) - goodsWanted(state);
  if (surplus <= 0) return 0;
  return Math.min(surplus, exportCapacity(state)) * GOODS_EXPORT_PRICE;
}

const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;
