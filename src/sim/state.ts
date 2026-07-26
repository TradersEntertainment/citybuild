import { HAPPINESS_START, STARTING_MONEY, STARTING_TAX_RATE } from '../data/balance';
import type { Building } from './buildings';
import type { Loan } from './credit';
import type { ServiceBuilding } from './services';
import type { UtilityPlant } from './utilities';
import type { Ledger } from './economy';
import type { Era } from './tiles';
import { createWorld, type World } from './world';
import { generateTerrain } from './worldgen';

/**
 * Live game state (§19). Systems mutate this; the renderer and UI only read
 * it. Fields for systems that do not exist yet are present and inert so the
 * save schema does not change shape underneath later phases.
 */
export interface GameState {
  seed: number;
  tick: number;
  era: Era;
  playedMs: number;

  money: number;
  /** Outstanding across every loan; derived, kept for the UI to read. */
  debt: number;
  taxRate: number;
  /** Loans being repaid (§7). */
  loans: Loan[];
  nextLoanId: number;
  /** Loans settled since the UI last looked, so it can say so. */
  loansClosed: number;

  population: number;
  happiness: number;
  research: number;

  demand: { res: number; com: number; ind: number };
  power: { gen: number; use: number };
  water: { gen: number; use: number };

  world: World;
  buildings: Map<number, Building>;
  /** Stations the player placed by hand; they never grow or decay on their own. */
  services: Map<number, ServiceBuilding>;
  /** Waterworks and power stations, which reach along roads rather than by radius. */
  utilities: Map<number, UtilityPlant>;
  /** Painted farmland, recounted by the building pass; farms employ people. */
  farmTiles: number;
  /** Goals already paid out, by id (§12.3). Order is completion order. */
  missionsDone: string[];
  /** Techs researched, by id (§12.2). */
  techsDone: string[];
  /** Ids start at 1; 0 means "no building" in the tile column. */
  nextBuildingId: number;
  nextServiceId: number;
  nextUtilityId: number;
  /** Last computed income/outgoings, for the UI to read without recomputing. */
  ledger: Ledger;
  lastSeen: number;
}

export function createGameState(seed: number, now: number): GameState {
  const world = createWorld(seed);
  generateTerrain(world);

  return {
    seed,
    tick: 0,
    era: 'founding',
    playedMs: 0,

    money: STARTING_MONEY,
    debt: 0,
    taxRate: STARTING_TAX_RATE,
    loans: [],
    nextLoanId: 1,
    loansClosed: 0,

    population: 0,
    happiness: HAPPINESS_START,
    research: 0,

    demand: { res: 0, com: 0, ind: 0 },
    power: { gen: 0, use: 0 },
    water: { gen: 0, use: 0 },

    world,
    buildings: new Map(),
    services: new Map(),
    utilities: new Map(),
    farmTiles: 0,
    missionsDone: [],
    techsDone: [],
    nextBuildingId: 1,
    nextServiceId: 1,
    nextUtilityId: 1,
    ledger: {
      taxIncome: 0,
      roadUpkeep: 0,
      serviceUpkeep: 0,
      utilityUpkeep: 0,
      debtService: 0,
      net: 0,
      farmYield: 0,
    },
    lastSeen: now,
  };
}
