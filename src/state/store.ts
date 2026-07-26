import { createStore } from 'zustand/vanilla';
import { STARTING_MONEY, STARTING_TAX_RATE, HAPPINESS_START } from '../data/balance';
import { START_YEAR } from '../data/timeline';
import type { MissionGoal } from '../data/missions';
import type { ProgrammeId } from '../data/investments';
import type { Era } from '../sim/tiles';

/**
 * UI-facing state only (§2). The simulation keeps its own plain-object state
 * and pushes summaries here; nothing under src/sim imports this store.
 */
export type ToolId = 'none' | 'road' | 'zone' | 'service' | 'inspect';
export type OverlayId = 'none' | 'traffic' | 'pollution' | 'landValue' | 'services';

export interface UiState {
  era: Era;
  /** The calendar year the city's played time has reached (§14). */
  year: number;
  money: number;
  /** Outstanding across every loan; zero hides the panel's debt row. */
  debt: number;
  population: number;
  happiness: number;
  taxRate: number;
  activeTool: ToolId;
  overlay: OverlayId;
  /** Diagnostics strip; Phase 0 uses it to prove the frame budget. */
  demand: { res: number; com: number; ind: number };
  net: number;
  ledger: LedgerView;
  /** Level bought in each civic programme, for the panel's buy buttons. */
  investments: Record<ProgrammeId, ProgrammeView>;
  totals: CityTotals;
  grid: GridView;
  fps: number;
  /** Suppressed while the player is drawing, so ink is never under text. */
  hintVisible: boolean;
  /** What the game wants to say, or null when the city needs no advice. */
  guidance: string | null;
  /** Legacy points carried in from retired cities. */
  legacy: number;
  /** True when this city is far enough along to be signed off. */
  canRetire: boolean;
  /** The goals on offer, nearest to done first (§12.3). */
  missions: MissionView[];
  missionsDone: number;
  missionsTotal: number;
}

/** One goal as the panel draws it — already measured, so the UI does no sums. */
export interface MissionView {
  id: string;
  goal: MissionGoal;
  reward: number;
  have: number;
  want: number;
  /** 0..1, for the bar. */
  fraction: number;
}

/** The city's books, as the panel shows them. All figures are per minute. */
export interface LedgerView {
  taxIncome: number;
  roadUpkeep: number;
  serviceUpkeep: number;
  utilityUpkeep: number;
  /** Loan instalments per minute. */
  debtService: number;
  farmYield: number;
  /** What the harvest brings in. */
  farmIncome: number;
  /** Through-traffic spending from the national highway. */
  transitIncome: number;
  /** What the berths land and ship (§ports). */
  seaIncome: number;
  /** Tax on what visitors off the motorway spent (§visitors). */
  visitorIncome: number;
  /** What the civic programmes cost to run. */
  programmeUpkeep: number;
}

/** One civic programme, as the panel needs it. */
export interface ProgrammeView {
  level: number;
}

/** Supply against demand for each grid, so a shortfall is visible before it bites. */
export interface GridView {
  waterSupply: number;
  waterDemand: number;
  powerSupply: number;
  powerDemand: number;
  /** False before the era expects utilities, which hides the section entirely. */
  expected: boolean;
}

/** What the city is made of, for the panel's population section. */
export interface CityTotals {
  housing: number;
  residents: number;
  commercialJobs: number;
  industrialJobs: number;
  farmJobs: number;
}

export interface SimSnapshot {
  era: Era;
  /** The calendar year the city's played time has reached (§14). */
  year: number;
  money: number;
  debt: number;
  legacy: number;
  canRetire: boolean;
  population: number;
  happiness: number;
  taxRate: number;
  demand: { res: number; com: number; ind: number };
  /** Net income per minute; drives the sign and colour of the HUD figure. */
  net: number;
  ledger: LedgerView;
  /** Level bought in each civic programme, for the panel's buy buttons. */
  investments: Record<ProgrammeId, ProgrammeView>;
  totals: CityTotals;
  grid: GridView;
}

export interface UiActions {
  /** Push of the sim's public numbers; the store never reads sim state itself. */
  syncFromSim(snapshot: SimSnapshot): void;
  setEra(era: Era): void;
  setTool(tool: ToolId): void;
  setOverlay(overlay: OverlayId): void;
  setFps(fps: number): void;
  setGuidance(text: string | null): void;
  setMissions(missions: MissionView[], done: number, total: number): void;
  hideHint(): void;
  showHint(): void;
}

export const uiStore = createStore<UiState & UiActions>()((set) => ({
  era: 'founding',
  year: START_YEAR,
  money: STARTING_MONEY,
  debt: 0,
  population: 0,
  happiness: HAPPINESS_START,
  taxRate: STARTING_TAX_RATE,
  activeTool: 'none',
  overlay: 'none',
  demand: { res: 0, com: 0, ind: 0 },
  net: 0,
  ledger: {
    taxIncome: 0,
    roadUpkeep: 0,
    serviceUpkeep: 0,
    utilityUpkeep: 0,
    debtService: 0,
    farmYield: 0,
    farmIncome: 0,
    transitIncome: 0,
    seaIncome: 0,
    visitorIncome: 0,
    programmeUpkeep: 0,
  },
  investments: { lighting: { level: 0 }, greening: { level: 0 }, festivals: { level: 0 } },
  totals: {
    housing: 0,
    residents: 0,
    commercialJobs: 0,
    industrialJobs: 0,
    farmJobs: 0,
    portJobs: 0,
  },
  grid: { waterSupply: 0, waterDemand: 0, powerSupply: 0, powerDemand: 0, expected: false },
  fps: 0,
  hintVisible: true,
  guidance: null,
  legacy: 0,
  canRetire: false,
  missions: [],
  missionsDone: 0,
  missionsTotal: 0,

  syncFromSim: (snapshot) =>
    set((current) =>
      // Identity when nothing moved, so subscribers do not repaint on a tick
      // that changed nothing.
      current.money === snapshot.money &&
      current.year === snapshot.year &&
      current.debt === snapshot.debt &&
      current.canRetire === snapshot.canRetire &&
      current.legacy === snapshot.legacy &&
      current.era === snapshot.era &&
      current.population === snapshot.population &&
      current.happiness === snapshot.happiness &&
      current.taxRate === snapshot.taxRate &&
      current.net === snapshot.net &&
      current.demand.res === snapshot.demand.res &&
      current.demand.com === snapshot.demand.com &&
      current.demand.ind === snapshot.demand.ind &&
      // The ledger has to be compared too, not inferred from `net`: a tax rise
      // and an upkeep rise of the same size leave net untouched while both
      // figures on the panel have moved.
      current.ledger.taxIncome === snapshot.ledger.taxIncome &&
      current.ledger.roadUpkeep === snapshot.ledger.roadUpkeep &&
      current.ledger.serviceUpkeep === snapshot.ledger.serviceUpkeep &&
      current.ledger.farmYield === snapshot.ledger.farmYield &&
      current.ledger.farmIncome === snapshot.ledger.farmIncome &&
      current.ledger.transitIncome === snapshot.ledger.transitIncome &&
      current.totals.housing === snapshot.totals.housing &&
      current.totals.commercialJobs === snapshot.totals.commercialJobs &&
      current.totals.industrialJobs === snapshot.totals.industrialJobs &&
      current.totals.farmJobs === snapshot.totals.farmJobs &&
      current.ledger.utilityUpkeep === snapshot.ledger.utilityUpkeep &&
      current.grid.waterSupply === snapshot.grid.waterSupply &&
      current.grid.waterDemand === snapshot.grid.waterDemand &&
      current.grid.powerSupply === snapshot.grid.powerSupply &&
      current.grid.powerDemand === snapshot.grid.powerDemand &&
      current.grid.expected === snapshot.grid.expected
        ? current
        : { ...current, ...snapshot },
    ),
  setEra: (era) => set({ era }),
  setTool: (activeTool) => set({ activeTool }),
  setOverlay: (overlay) => set({ overlay }),
  setFps: (fps) => set({ fps }),
  setGuidance: (guidance) =>
    set((current) => (current.guidance === guidance ? current : { ...current, guidance })),
  // Compared by what is drawn rather than by reference: this is rebuilt twice a
  // second from fresh objects, and repainting every row each time would undo
  // the point of the store's identity check.
  setMissions: (missions, missionsDone, missionsTotal) =>
    set((current) =>
      current.missionsDone === missionsDone &&
      current.missions.length === missions.length &&
      current.missions.every((row, i) => {
        const next = missions[i];
        return next !== undefined && row.id === next.id && row.have === next.have;
      })
        ? current
        : { ...current, missions, missionsDone, missionsTotal },
    ),
  hideHint: () => set({ hintVisible: false }),
  showHint: () => set({ hintVisible: true }),
}));

export type UiStore = typeof uiStore;
