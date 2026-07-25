import {
  COMMERCIAL_TAX,
  COMMERCIAL_TURNOVER,
  FARM_YIELD,
  INDUSTRIAL_OUTPUT,
  INDUSTRIAL_TAX,
} from '../data/balance';
import { ROAD_SPECS } from '../data/roads';
import type { Fields } from './fields';
import type { GameState } from './state';
import { decodeRoad, decodeZone, NONE } from './tiles';
import { index } from './world';

/**
 * Income and outgoings (§7). Phase 2 covers the two the player can already
 * feel: tax on what the city produces, and upkeep on the roads they drew.
 * Credit, service running costs and austerity arrive with the systems that
 * justify them.
 */
export interface Ledger {
  /** ₺ per minute. */
  taxIncome: number;
  roadUpkeep: number;
  net: number;
  /** Food produced per minute; consumption arrives with the food system. */
  farmYield: number;
}

/**
 * vergiGeliri/dk = Σ(bina.nüfus × vergiOranı × (0.5 + araziDeğeri/100))
 *                + Σ(ticaret.ciro × ticaretVergisi)
 *                + Σ(sanayi.üretim × sanayiVergisi)
 */
export function computeLedger(state: GameState, fields: Fields): Ledger {
  let taxIncome = 0;

  for (const building of state.buildings.values()) {
    const landValue = fields.landValue[index(state.world, building.x, building.y)] ?? 0;
    if (building.zone === 'res') {
      // Richer addresses pay more of the same rate — the land value loop is
      // what makes a well-planned district worth more than a bigger one.
      taxIncome += building.population * state.taxRate * (0.5 + landValue / 100);
    } else if (building.zone === 'com') {
      building.output = building.jobs * COMMERCIAL_TURNOVER;
      taxIncome += building.output * COMMERCIAL_TAX;
    } else {
      building.output = building.jobs * INDUSTRIAL_OUTPUT;
      taxIncome += building.output * INDUSTRIAL_TAX;
    }
  }

  return {
    taxIncome,
    roadUpkeep: roadUpkeep(state),
    net: taxIncome - roadUpkeep(state),
    farmYield: farmTiles(state) * FARM_YIELD,
  };
}

export function roadUpkeep(state: GameState): number {
  let upkeep = 0;
  for (let i = 0; i < state.world.road.length; i++) {
    const kind = decodeRoad(state.world.road[i] ?? NONE);
    if (kind) upkeep += ROAD_SPECS[kind].upkeep;
  }
  return upkeep;
}

function farmTiles(state: GameState): number {
  let count = 0;
  for (let i = 0; i < state.world.zone.length; i++) {
    if (decodeZone(state.world.zone[i] ?? NONE) === 'farm') count++;
  }
  return count;
}

/**
 * Applies one economy tick. The balance floors at zero rather than going
 * negative (§7); the bank that would lend against the shortfall belongs with
 * the rest of the credit system.
 */
export function stepEconomy(state: GameState, fields: Fields, dt: number): Ledger {
  const ledger = computeLedger(state, fields);
  state.money = Math.max(0, state.money + (ledger.net * dt) / 60);
  state.ledger = ledger;
  return ledger;
}
