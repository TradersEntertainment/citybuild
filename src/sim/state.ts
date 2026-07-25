import { HAPPINESS_START, STARTING_MONEY, STARTING_TAX_RATE } from '../data/balance';
import type { Building } from './buildings';
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
  debt: number;
  taxRate: number;

  population: number;
  happiness: number;
  research: number;

  demand: { res: number; com: number; ind: number };
  power: { gen: number; use: number };
  water: { gen: number; use: number };

  world: World;
  buildings: Map<number, Building>;
  /** Painted farmland, recounted by the building pass; farms employ people. */
  farmTiles: number;
  /** Ids start at 1; 0 means "no building" in the tile column. */
  nextBuildingId: number;
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

    population: 0,
    happiness: HAPPINESS_START,
    research: 0,

    demand: { res: 0, com: 0, ind: 0 },
    power: { gen: 0, use: 0 },
    water: { gen: 0, use: 0 },

    world,
    buildings: new Map(),
    farmTiles: 0,
    nextBuildingId: 1,
    ledger: { taxIncome: 0, roadUpkeep: 0, net: 0, farmYield: 0 },
    lastSeen: now,
  };
}
