import {
  GOODS_PER_COMMERCIAL_JOB,
  COMMERCIAL_TAX,
  OFFICE_TAX,
  OFFICE_TURNOVER,
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
import { dayFraction, nightAmount } from './daytime';
import { investmentUpkeep, tradeNow } from './investments';
import { portUpkeep, seaIncome } from './ports';
import { farmSeasonMultiplier } from './seasons';
import { serviceUpkeep } from './services';
import { attractionUpkeep, tourismIncome } from './attractions';
import { skillFactor } from './cohorts';
import { commerceFactor, fareFactor, industryFactor, policyUpkeep } from './policies';
import { resourceFactor } from './resources';
import { fareIncome, transitUpkeep } from './transit';
import { exportIncome, marketFactor, stockFactor, type GoodsField } from './goods';
import { techFactor } from './tech';
import { weatherAt, weatherEffects } from './weather';
import { utilityUpkeep } from './utilities';
import type { GameState } from './state';
import { lobbyOutputFactor, lobbyStipend } from './lobbies';
import {
  decreeCommerceFactor,
  decreeIndustryFactor,
  decreeOfficeFactor,
  decreeStipend,
} from './decrees';
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
  /** What the civic programmes cost to run (data/investments.ts). */
  programmeUpkeep: number;
  /** Fares off the bus and tram lines (sim/transit.ts). */
  fareIncome: number;
  /** What the hotels billed their guests (sim/attractions.ts). */
  tourismIncome: number;
  /**
   * Net of every signed lobby deal (sim/lobbies.ts) — positive when the deals
   * pay the city, negative when they cost it.
   *
   * A row that swings both ways, which is the point: it is the line that says
   * out loud what the mayor traded for.
   */
  lobbyIncome: number;
  /** Net of the standing decrees (§32) — the price and proceeds of force. */
  decreeIncome: number;
  /** …and what running the stops costs, which is usually more at first. */
  transitUpkeep: number;
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
  return visitorFactor(state.world, fields, visitors, x, y, techFactor(state, 'hospitality'));
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
  riders = 0,
  goods?: GoodsField,
): Ledger {
  let taxIncome = 0;
  let visitorTrade = 0;
  // What time it is, and how much of the dark the city has bought its way out of
  // (sim/investments.ts). An unlit city's daily average comes out at exactly what
  // it earned before the night meant anything — the loss is paid back over the
  // day — so this is an opportunity rather than a nerf.
  const hour = tradeNow(state, nightAmount(dayFraction(state.playedMs)));
  // What the schools bought, a generation late (sim/cohorts.ts). A pure bonus: an
  // unschooled city earns exactly what it earned before the bands existed, so a
  // player who has never been shown a school is not marked down for lacking one.
  const skill = skillFactor(state);
  const decreeOffice = decreeOfficeFactor(state);
  // What the workshops can shift, city-wide (sim/goods.ts). A crate that cannot
  // be sold here goes on the next lorry, so which workshop is the unlucky one is
  // a precision the player could not act on.
  const market = goods ? marketFactor(state) : 1;
  // The ordinances in force (sim/policies.ts) and any signed deal
  // (sim/lobbies.ts): a night shift, a smoking ban, an oil contract, a wage
  // settlement. Every one answers 1 when off, so the output lines multiply
  // unconditionally.
  const industry = industryFactor(state) * lobbyOutputFactor(state) * decreeIndustryFactor(state);
  const commerce = commerceFactor(state) * decreeCommerceFactor(state);

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
      // …and what actually reaches the shelves. A shop at the far end of the map
      // is no longer as good as one beside the factories (sim/goods.ts).
      const stock = goods
        ? stockFactor(
            state.world,
            fields,
            goods,
            building.x,
            building.y,
            building.jobs * GOODS_PER_COMMERCIAL_JOB,
          )
        : 1;
      building.output =
        building.jobs * COMMERCIAL_TURNOVER * corridor * hour * skill * stock * commerce;
      // What the visitors themselves spend, kept apart from the city's own
      // custom so the panel can say where the money came from.
      visitorTrade += building.output * (1 - 1 / corridor) * COMMERCIAL_TAX;
      taxIncome += building.output * COMMERCIAL_TAX;
    } else if (building.zone === 'office') {
      // The most valuable ground in the city, and the least dependent on any of
      // the machinery the other zones need. No goods to deliver, so no lorries
      // and no market factor; no shopfront, so no passing trade off the
      // motorway and no closing time — an office tower is lit at midnight and
      // the night costs it nothing.
      //
      // What it does depend on is `skill`, and much harder than anywhere else.
      // Offices are where the schooling actually cashes out: an unschooled city
      // can zone them, build them, and watch them earn very little, which is
      // the long chain the education system never had an end for.
      // …unless the state has cut the wire the whole floor trades on (§32).
      building.output = building.jobs * OFFICE_TURNOVER * skill * skill * decreeOffice;
      taxIncome += building.output * OFFICE_TAX;
    } else {
      // A workshop beside a busy junction sells at the gate too, but less: its
      // customers are lorries, not families in a car.
      const corridor = 1 + (trade(state, fields, visitors, building.x, building.y) - 1) * 0.5;
      // A workshop keeps a night shift more readily than a shop keeps a
      // shopkeeper, so the dark costs it half as much.
      // And what is under it (sim/resources.ts): a workshop on a coal seam is
      // worth putting there, until the seam runs out.
      const seam = resourceFactor(state.world, building.x, building.y);
      building.output =
        building.jobs * INDUSTRIAL_OUTPUT * (1 + (hour - 1) * 0.5) * skill * seam * market * industry;
      building.output *= corridor;
      visitorTrade += building.output * (1 - 1 / corridor) * INDUSTRIAL_TAX;
      taxIncome += building.output * INDUSTRIAL_TAX;
    }
  }

  // Administration is a discount on standing costs, not on what the city has
  // already built: it is a civil service, so it bills less every minute rather
  // than refunding anything.
  const admin = techFactor(state, 'administration');
  const roads = roadUpkeep(state);
  const stations = (serviceUpkeep(state) + attractionUpkeep(state) + policyUpkeep(state)) * admin;
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
  // The programmes bill like everything else standing, and the administration
  // tech discounts them the same way.
  const programmes = investmentUpkeep(state) * admin;
  // Fares are counted from the ridership the traffic pass already measured
  // rather than recomputed here: the trips taken off the road and the trips that
  // paid a fare are the same trips, and working them out twice is how the two
  // would quietly drift apart.
  // Free transit collects nothing at the fare box — that is what it is for.
  const fares = fareIncome(riders) * fareFactor(state);
  // What the hotels brought in overnight (sim/attractions.ts), read off the
  // same visitor field the shops sell to.
  const tourism = tourismIncome(state, fields, visitors);
  const lines = transitUpkeep(state);
  // What the harbours ship out, folded into the sea line: it is the same quay,
  // and a second row for it would tell the player about a distinction they have
  // no separate lever over.
  const exports = goods ? exportIncome(state) : 0;
  // What the signed deals pay the city, net of what they cost it (sim/lobbies.ts).
  // Signed, so it belongs in the ledger rather than in a one-off: a deal the
  // player took for the cheque should be visible every minute it is running.
  const lobbies = lobbyStipend(state);
  // The decrees' levy and their bills (§32): conscription pays the treasury,
  // propaganda drains it. One net line, like the lobbies, and for the same
  // reason — it is the row that says what ruling by force is worth.
  const decrees = decreeStipend(state);

  return {
    taxIncome,
    roadUpkeep: roads,
    serviceUpkeep: stations,
    utilityUpkeep: plants,
    debtService: debt,
    net:
      taxIncome +
      farmIncome +
      transit +
      sea +
      exports +
      fares +
      tourism +
      lobbies +
      decrees -
      roads -
      stations -
      plants -
      berths -
      programmes -
      lines -
      debt,
    farmYield,
    farmIncome,
    transitIncome: transit,
    seaIncome: sea + exports,
    portUpkeep: berths,
    programmeUpkeep: programmes,
    visitorIncome: visiting,
    fareIncome: fares,
    tourismIncome: tourism,
    lobbyIncome: lobbies,
    decreeIncome: decrees,
    transitUpkeep: lines,
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
  riders = 0,
  goods?: GoodsField,
): Ledger {
  const ledger = computeLedger(state, fields, visitors, riders, goods);
  // Income and running costs first, then the bank. A loan taken to cover a
  // shortfall would otherwise be repaid out of money the city has not earned
  // yet, and the instalment is already counted in `net`.
  const operating = ledger.net + ledger.debtService;
  state.money = Math.max(0, state.money + (operating * dt) / 60);
  repayLoans(state, dt);
  state.ledger = ledger;
  return ledger;
}
