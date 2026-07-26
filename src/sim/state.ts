import { HAPPINESS_START, STARTING_MONEY, STARTING_TAX_RATE } from '../data/balance';
import type { Building } from './buildings';
import type { Loan } from './credit';
import type { Crime } from './crime';
import type { Epidemic, Fire } from './hazards';
import { layNationalHighway } from './highway';
import { sectionCount } from './highwayWear';
import { CALM_EFFECTS, type TimelineEffects } from './timeline';
import { legacyEndowment } from './legacy';
import type { ServiceBuilding } from './services';
import type { ProgrammeId } from '../data/investments';
import type { Port } from './ports';
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

  /** Legacy points carried in from retired cities; endows the opening balance. */
  legacy: number;

  world: World;
  buildings: Map<number, Building>;
  /** Stations the player placed by hand; they never grow or decay on their own. */
  services: Map<number, ServiceBuilding>;
  /** Waterworks and power stations, which reach along roads rather than by radius. */
  utilities: Map<number, UtilityPlant>;
  /**
   * Berths on the coast (§denize yatırım). Placed like stations, but the only
   * facility whose worth comes from the terrain rather than from the city.
   */
  ports: Map<number, Port>;
  /** Painted farmland, recounted by the building pass; farms employ people. */
  farmTiles: number;
  /**
   * Buildings currently on fire (§13). Transient on purpose: a blaze is a
   * moment, not a fact to save, so a city saved mid-fire reloads to calm.
   */
  fires: Map<number, Fire>;
  nextFireId: number;
  /**
   * Crimes underway (§13b). Transient like fires, and for a stronger reason: a
   * crime is a thing the player is being asked to tap right now, and saving one
   * would mean reloading into a demand made of an interaction that has passed.
   */
  crimes: Map<number, Crime>;
  nextCrimeId: number;
  /**
   * Seconds left of the city's memory of the last robbery it lost. Keeps the
   * mood hit alive a little past the marker vanishing — never saved, because it
   * only exists to make a moment land.
   */
  crimeSting: number;
  /** The outbreak underway, if any — likewise a moment, never saved. */
  epidemic: Epidemic | null;
  /**
   * The last calendar year history was checked against (§14). Null until the
   * first step, so a loaded city notes the year instead of re-living every
   * event it already survived. Derived from played time — never saved.
   */
  lastYear: number | null;
  /** What the current year's events press on the sim; recomputed each step. */
  timelineEffects: TimelineEffects;
  /**
   * Wear on each maintained stretch of the national highway, 0..1 (see
   * sim/highwayWear.ts). Saved: a war that ruined the corridor must still have
   * ruined it after a reload, or closing the tab would be free road repair.
   */
  highwayWear: number[];
  /** Goals already paid out, by id (§12.3). Order is completion order. */
  missionsDone: string[];
  /** Techs researched, by id (§12.2). */
  techsDone: string[];
  /**
   * Level bought in each civic programme (data/investments.ts). What a rich city
   * spends its money on, and the only purchase whose effect is the whole map.
   */
  investments: Record<ProgrammeId, number>;
  /** Ids start at 1; 0 means "no building" in the tile column. */
  nextBuildingId: number;
  nextServiceId: number;
  nextUtilityId: number;
  nextPortId: number;
  /** Last computed income/outgoings, for the UI to read without recomputing. */
  ledger: Ledger;
  lastSeen: number;
}

/**
 * A fresh city. `legacy` is what previous cities earned, and it only ever
 * touches the opening balance — see sim/legacy.ts for why nothing else.
 */
export function createGameState(seed: number, now: number, legacy = 0): GameState {
  const world = createWorld(seed);
  generateTerrain(world);
  // The national road is laid with the terrain: deterministic in the seed, so
  // a loaded city gets back exactly the motorway it was built beside.
  layNationalHighway(world);

  return {
    seed,
    tick: 0,
    era: 'founding',
    playedMs: 0,

    money: STARTING_MONEY + legacyEndowment(legacy),
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

    legacy,

    world,
    buildings: new Map(),
    services: new Map(),
    utilities: new Map(),
    ports: new Map(),
    farmTiles: 0,
    fires: new Map(),
    nextFireId: 1,
    crimes: new Map(),
    nextCrimeId: 1,
    crimeSting: 0,
    epidemic: null,
    lastYear: null,
    timelineEffects: { ...CALM_EFFECTS },
    highwayWear: new Array<number>(sectionCount(world)).fill(0),
    missionsDone: [],
    techsDone: [],
    investments: { lighting: 0, greening: 0, festivals: 0 },
    nextBuildingId: 1,
    nextServiceId: 1,
    nextUtilityId: 1,
    nextPortId: 1,
    ledger: {
      taxIncome: 0,
      roadUpkeep: 0,
      serviceUpkeep: 0,
      utilityUpkeep: 0,
      debtService: 0,
      net: 0,
      farmYield: 0,
      farmIncome: 0,
      transitIncome: 0,
      seaIncome: 0,
      portUpkeep: 0,
      programmeUpkeep: 0,
      visitorIncome: 0,
    },
    lastSeen: now,
  };
}
