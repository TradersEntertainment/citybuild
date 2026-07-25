import { createStore } from 'zustand/vanilla';
import { STARTING_MONEY, STARTING_TAX_RATE, HAPPINESS_START } from '../data/balance';
import type { Era } from '../sim/tiles';

/**
 * UI-facing state only (§2). The simulation keeps its own plain-object state
 * and pushes summaries here; nothing under src/sim imports this store.
 */
export type ToolId = 'none' | 'road' | 'zone' | 'service' | 'inspect';
export type OverlayId = 'none' | 'traffic' | 'pollution' | 'landValue' | 'services';

export interface UiState {
  era: Era;
  money: number;
  population: number;
  happiness: number;
  taxRate: number;
  activeTool: ToolId;
  overlay: OverlayId;
  /** Diagnostics strip; Phase 0 uses it to prove the frame budget. */
  demand: { res: number; com: number; ind: number };
  net: number;
  ledger: LedgerView;
  totals: CityTotals;
  fps: number;
  /** Suppressed while the player is drawing, so ink is never under text. */
  hintVisible: boolean;
  /** What the game wants to say, or null when the city needs no advice. */
  guidance: string | null;
}

/** The city's books, as the panel shows them. All figures are per minute. */
export interface LedgerView {
  taxIncome: number;
  roadUpkeep: number;
  serviceUpkeep: number;
  farmYield: number;
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
  money: number;
  population: number;
  happiness: number;
  taxRate: number;
  demand: { res: number; com: number; ind: number };
  /** Net income per minute; drives the sign and colour of the HUD figure. */
  net: number;
  ledger: LedgerView;
  totals: CityTotals;
}

export interface UiActions {
  /** Push of the sim's public numbers; the store never reads sim state itself. */
  syncFromSim(snapshot: SimSnapshot): void;
  setEra(era: Era): void;
  setTool(tool: ToolId): void;
  setOverlay(overlay: OverlayId): void;
  setFps(fps: number): void;
  setGuidance(text: string | null): void;
  hideHint(): void;
  showHint(): void;
}

export const uiStore = createStore<UiState & UiActions>()((set) => ({
  era: 'founding',
  money: STARTING_MONEY,
  population: 0,
  happiness: HAPPINESS_START,
  taxRate: STARTING_TAX_RATE,
  activeTool: 'none',
  overlay: 'none',
  demand: { res: 0, com: 0, ind: 0 },
  net: 0,
  ledger: { taxIncome: 0, roadUpkeep: 0, serviceUpkeep: 0, farmYield: 0 },
  totals: { housing: 0, residents: 0, commercialJobs: 0, industrialJobs: 0, farmJobs: 0 },
  fps: 0,
  hintVisible: true,
  guidance: null,

  syncFromSim: (snapshot) =>
    set((current) =>
      // Identity when nothing moved, so subscribers do not repaint on a tick
      // that changed nothing.
      current.money === snapshot.money &&
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
      current.totals.housing === snapshot.totals.housing &&
      current.totals.commercialJobs === snapshot.totals.commercialJobs &&
      current.totals.industrialJobs === snapshot.totals.industrialJobs &&
      current.totals.farmJobs === snapshot.totals.farmJobs
        ? current
        : { ...current, ...snapshot },
    ),
  setEra: (era) => set({ era }),
  setTool: (activeTool) => set({ activeTool }),
  setOverlay: (overlay) => set({ overlay }),
  setFps: (fps) => set({ fps }),
  setGuidance: (guidance) =>
    set((current) => (current.guidance === guidance ? current : { ...current, guidance })),
  hideHint: () => set({ hintVisible: false }),
  showHint: () => set({ hintVisible: true }),
}));

export type UiStore = typeof uiStore;
