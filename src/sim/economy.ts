import {
  COMMERCIAL_TAX,
  COMMERCIAL_TURNOVER,
  FARM_YIELD,
  FOOD_PRICE,
  INDUSTRIAL_OUTPUT,
  INDUSTRIAL_TAX,
} from '../data/balance';
import { ROAD_SPECS } from '../data/roads';
import { debtService, repayLoans } from './credit';
import type { Fields } from './fields';
import { highwayTradeFactor, transitIncome } from './highway';
import { visitorFactor, type VisitorField } from './visitors';
import { portUpkeep, seaIncome } from './ports';
import { farmSeasonMultiplier } from './seasons';
import { serviceUpkeep } from './services';
import { techFactor } from './tech';
import { weatherAt, weatherEffects } from './weather';
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
  /** What the harvest sells for — farms were jobs without a living before. */
  farmIncome: number;
  /** Through-traffic spending on the owned stretch of the national highway. */
  transitIncome: number;
  /** What the berths land and ship — the coast, finally earning (§ports). */
  seaIncome: number;
  /**
   * Tax on what visitors off the motorway spent, counted out of the shop takings
   * rather than added on top: it is a slice of `taxIncome`, shown separately so
   * the panel can say where the money came from.
   */
  visitorIncome: number;
  /** Berths cost the same every minute whether or not a ship came in. */
  portUpkeep: number;
}

/**
 * The trade multiplier for a plot.
 *
 * Falls back to the old flat corridor bonus when there is no visitor field —
 * the offline path and a handful of tests call the ledger without one, and a
 * shop beside a junction should not stop earning because nobody passed a field
 * in.
 */
function trade(
  state: GameState,
  fields: Fields,
  visitors: VisitorField | undefined,
  x: number,
  y: number,
): number {
  if (!visitors) return highwayTradeFactor(state, x, y);
  return visitorFactor(state.world, fields, visitors, x, y);
}

/**
 * vergiGeliri/dk = Σ(bina.nüfus × vergiOranı × (0.5 + araziDeğeri/100))
 *                + Σ(ticaret.ciro × ticaretVergisi)
 *                + Σ(sanayi.üretim × sanayiVergisi)
 */
export function computeLedger(
  state: GameState,
  fields: Fields,
  visitors?: VisitorField,
): Ledger {
  let taxIncome = 0;
  let visitorTrade = 0;

  for (const building of state.buildings.values()) {
    const landValue = fields.landValue[index(state.world, building.x, building.y)] ?? 0;
    if (building.zone === 'res') {
      // Richer addresses pay more of the same rate — the land value loop is
      // what makes a well-planned district worth more than a bigger one.
      taxIncome += building.population * state.taxRate * (0.5 + landValue / 100);
    } else if (building.zone === 'com') {
      // Visitors off the motorway, buying here. The old version was a flat bonus
      // for being anywhere near a junction, which could not tell a shop on the
      // road out of the interchange from one three districts away behind a jam —
      // so the player had nothing to aim at. Now it is the flow that actually
      // reaches the street the shop stands on (sim/visitors.ts).
      const corridor = trade(state, fields, visitors, building.x, building.y);
      building.output = building.jobs * COMMERCIAL_TURNOVER * corridor;
      // What the visitors themselves spend, kept apart from the city's own
      // custom so the panel can say where the money came from.
      visitorTrade += building.output * (1 - 1 / corridor) * COMMERCIAL_TAX;
      taxIncome += building.output * COMMERCIAL_TAX;
    } else {
      // A workshop beside a busy junction sells at the gate too, but less: its
      // customers are lorries, not families in a car.
      const corridor = 1 + (trade(state, fields, visitors, building.x, building.y) - 1) * 0.5;
      building.output = building.jobs * INDUSTRIAL_OUTPUT * corridor;
      visitorTrade += building.output * (1 - 1 / corridor) * INDUSTRIAL_TAX;
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
  // Rain feeds a farm and a hot spell does not — the one place the weather
  // reaches the ledger, and what makes painting farmland a decision that pays
  // differently in a wet decade than a dry one.
  const sky = weatherEffects(weatherAt(state).kind);
  // And the calendar leans on it too: a field yields differently in February
  // than in August, which is the whole reason seasons touch the sim at all.
  const farmYield =
    farmTiles(state) *
    FARM_YIELD *
    techFactor(state, 'agronomy') *
    sky.farmMult *
    farmSeasonMultiplier(state.playedMs);
  // History moves every income line at once: a depression year starves the
  // treasury, a boom decade fills it, whatever the tax rate says.
  const history = state.timelineEffects.incomeMult;
  taxIncome *= history;
  const farmIncome = farmYield * FOOD_PRICE * history;
  const transit = transitIncome(state) * history;
  // The coast, earning. Moved by history like every other income line: a
  // depression empties the docks as surely as it empties the shops.
  const sea = seaIncome(state) * history;
  const visiting = visitorTrade * history;
  const berths = portUpkeep(state) * admin;
  return {
    taxIncome,
    roadUpkeep: roads,
    serviceUpkeep: stations,
    utilityUpkeep: plants,
    debtService: debt,
    net:
      taxIncome + farmIncome + transit + sea - roads - stations - plants - berths - debt,
    farmYield,
    farmIncome,
    transitIncome: transit,
    seaIncome: sea,
    portUpkeep: berths,
    visitorIncome: visiting,
  };
}

export function roadUpkeep(state: GameState): number {
  let upkeep = 0;
  for (let i = 0; i < state.world.road.length; i++) {
    const kind = decodeRoad(state.world.road[i] ?? NONE);
    // The state maintains its own motorway; a mayor never gets its bill.
    if ((state.world.highway[i] ?? 0) === 1) continue;
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
export function stepEconomy(
  state: GameState,
  fields: Fields,
  dt: number,
  visitors?: VisitorField,
): Ledger {
  const ledger = computeLedger(state, fields, visitors);
  // Income and running costs first, then the bank. A loan taken to cover a
  // shortfall would otherwise be repaid out of money the city has not earned
  // yet, and the instalment is already counted in `net`.
  const operating = ledger.net + ledger.debtService;
  state.money = Math.max(0, state.money + (operating * dt) / 60);
  repayLoans(state, dt);
  state.ledger = ledger;
  return ledger;
}
