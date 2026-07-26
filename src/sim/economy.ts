import {
  COMMERCIAL_TAX,
  COMMERCIAL_TURNOVER,
  FARM_YIELD,
  INDUSTRIAL_OUTPUT,
  INDUSTRIAL_TAX,
} from '../data/balance';
import { ROAD_SPECS } from '../data/roads';
import { debtService, repayLoans } from './credit';
import type { Fields } from './fields';
import { serviceUpkeep } from './services';
import { techFactor } from './tech';
import { utilityUpkeep } from './utilities';
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
  /** Stations cost the same every minute whether or not anyone needed them. */
  serviceUpkeep: number;
  /** Waterworks and power stations, billed the same way. */
  utilityUpkeep: number;
  /** Loan instalments, which the bank takes whether or not the city agrees. */
  debtService: number;
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

  // Administration is a discount on standing costs, not on what the city has
  // already built: it is a civil service, so it bills less every minute rather
  // than refunding anything.
  const admin = techFactor(state, 'administration');
  const roads = roadUpkeep(state);
  const stations = serviceUpkeep(state) * admin;
  const plants = utilityUpkeep(state) * admin;
  const debt = debtService(state);
  return {
    taxIncome,
    roadUpkeep: roads,
    serviceUpkeep: stations,
    utilityUpkeep: plants,
    debtService: debt,
    net: taxIncome - roads - stations - plants - debt,
    farmYield: farmTiles(state) * FARM_YIELD * techFactor(state, 'agronomy'),
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
  // Income and running costs first, then the bank. A loan taken to cover a
  // shortfall would otherwise be repaid out of money the city has not earned
  // yet, and the instalment is already counted in `net`.
  const operating = ledger.net + ledger.debtService;
  state.money = Math.max(0, state.money + (operating * dt) / 60);
  repayLoans(state, dt);
  state.ledger = ledger;
  return ledger;
}
