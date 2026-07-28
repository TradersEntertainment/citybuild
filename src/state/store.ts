import { createStore } from 'zustand/vanilla';
import { STARTING_MONEY, STARTING_TAX_RATE, HAPPINESS_START } from '../data/balance';
import { START_YEAR } from '../data/timeline';
import type { MissionGoal } from '../data/missions';
import type { ProgrammeId } from '../data/investments';
import { SERVICE_ORDER } from '../data/services';
import { REPORT_DIMENSIONS } from '../sim/report';
import type { Era } from '../sim/tiles';

/**
 * UI-facing state only (§2). The simulation keeps its own plain-object state
 * and pushes summaries here; nothing under src/sim imports this store.
 */
export type ToolId = 'none' | 'road' | 'zone' | 'service' | 'inspect';
export type OverlayId = 'none' | 'traffic' | 'pollution' | 'landValue' | 'services';

/** The department keys the equality check walks. */
const SERVICE_KEYS = SERVICE_ORDER;

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
  demand: { res: number; com: number; ind: number; office: number };
  net: number;
  ledger: LedgerView;
  /** Level bought in each civic programme, for the panel's buy buttons. */
  investments: Record<ProgrammeId, ProgrammeView>;
  totals: CityTotals;
  demography: DemographyView;
  rubbish: RubbishView;
  /** How many of each station stand, so the panel only offers real departments. */
  stations: Record<string, number>;
  /** What each is funded at (sim/budgets.ts). */
  budgets: Record<string, number>;
  /** How the city would vote today, 0..1 (sim/elections.ts). */
  approval: number;
  /** The factions and how each would vote (sim/groups.ts, §23). */
  groups: GroupView[];
  /** Lobby deals in force, with what is left of each (sim/lobbies.ts, §24). */
  lobbies: LobbyView[];
  /** How the city is graded, which is a different question from approval (§25). */
  report: ReportView;
  /** How the mayor came to power, and how the streets have taken it (§29). */
  mandate: string;
  unrest: number;
  /** The promises on offer, and where the city stands on each (§30). */
  promises: PromiseView[];
  /** How much of the room is holding a grudge, 0..n. */
  betrayed: number;
  /** Riders a minute the bus lines are carrying (sim/transit.ts). */
  riders: number;
  /** Seconds until the next vote is counted (sim/elections.ts). */
  secondsToElection: number;
  grid: GridView;
  fps: number;
  /** JS milliseconds in the worst frame of the last half-second (render3d/renderer.ts). */
  cpuMs: number;
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

/** One faction as the panel draws it (sim/groups.ts). */
export interface GroupView {
  id: string;
  /** Share of the electorate, 0..1. */
  weight: number;
  /** How the faction would vote today, 0..1. */
  approval: number;
}

/**
 * One campaign promise as the panel draws it (sim/promises.ts).
 *
 * Carries where the city stands as well as the bar, because a promise the
 * player cannot watch approach is a deadline with no dashboard — and the whole
 * fairness of the mechanic rests on being able to see it coming.
 */
export interface PromiseView {
  id: string;
  made: boolean;
  unlocked: boolean;
  /** 0..1 on the promise's own scale, and the bar it must clear. */
  progress: number;
  target: number;
}

/**
 * The report card as the panel draws it (sim/report.ts).
 *
 * Carried whole rather than as six loose fields, so the panel cannot draw a
 * grade from one reading and a bar from another.
 */
export interface ReportView {
  scores: Record<string, number>;
  overall: number;
  grade: string;
}

/**
 * One signed deal as the panel draws it (sim/lobbies.ts).
 *
 * The seconds are what make the section worth having: a deal the player can see
 * running down is a deal they can plan around, which is the difference between
 * a term and a thing that happens to them.
 */
export interface LobbyView {
  id: string;
  /** Seconds left on the term. */
  remaining: number;
}

/** One goal as the panel draws it — already measured, so the UI does no sums. */
export interface MissionView {
  id: string;
  goal: MissionGoal;
  reward: number;
  /** Legacy points, for a mandate; 0 for an ordinary goal (§27). */
  legacy: number;
  /** The marked square's name, for a site goal; empty otherwise (§28). */
  site: string;
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
  /** Fares in and stops out (sim/transit.ts). */
  fareIncome: number;
  tourismIncome: number;
  /** Net of the signed lobby deals; the one row that can be either sign. */
  lobbyIncome: number;
  transitUpkeep: number;
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
/**
 * Who lives there, as the panel draws it (sim/cohorts.ts).
 *
 * Measured by the sim, not derived here. The panel used to compute its workforce
 * as half the population from the same flat constant the sim has stopped using,
 * so a city of children reported a workforce it did not have.
 */
export interface DemographyView {
  child: number;
  young: number;
  adult: number;
  elder: number;
  /** Share of working age, 0..1. */
  working: number;
  /** Share of the workforce that went to school, 0..1. */
  schooled: number;
  /** Bodies waiting for a plot. */
  awaitingBurial: number;
}

/** The bins, as the panel draws them (sim/rubbish.ts). */
export interface RubbishView {
  waiting: number;
  /** How badly it is overflowing, 0..1. */
  strain: number;
}

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
  demand: { res: number; com: number; ind: number; office: number };
  /** Net income per minute; drives the sign and colour of the HUD figure. */
  net: number;
  ledger: LedgerView;
  /** Level bought in each civic programme, for the panel's buy buttons. */
  investments: Record<ProgrammeId, ProgrammeView>;
  totals: CityTotals;
  demography: DemographyView;
  rubbish: RubbishView;
  stations: Record<string, number>;
  budgets: Record<string, number>;
  approval: number;
  groups: GroupView[];
  lobbies: LobbyView[];
  report: ReportView;
  mandate: string;
  unrest: number;
  promises: PromiseView[];
  betrayed: number;
  riders: number;
  secondsToElection: number;
  grid: GridView;
}

export interface UiActions {
  /** Push of the sim's public numbers; the store never reads sim state itself. */
  syncFromSim(snapshot: SimSnapshot): void;
  setEra(era: Era): void;
  setTool(tool: ToolId): void;
  setOverlay(overlay: OverlayId): void;
  setFps(fps: number, cpuMs: number): void;
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
  demand: { res: 0, com: 0, ind: 0, office: 0 },
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
    fareIncome: 0,
    tourismIncome: 0,
    lobbyIncome: 0,
    transitUpkeep: 0,
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
  demography: {
    child: 0,
    young: 0,
    adult: 0,
    elder: 0,
    working: 0,
    schooled: 0,
    awaitingBurial: 0,
  },
  rubbish: { waiting: 0, strain: 0 },
  stations: {},
  budgets: {},
  approval: 0,
  groups: [],
  lobbies: [],
  report: { scores: {}, overall: 0, grade: 'F' },
  mandate: 'elected',
  unrest: 0,
  promises: [],
  betrayed: 0,
  riders: 0,
  secondsToElection: 0,
  grid: { waterSupply: 0, waterDemand: 0, powerSupply: 0, powerDemand: 0, expected: false },
  fps: 0,
  cpuMs: 0,
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
      current.demand.office === snapshot.demand.office &&
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
      current.grid.expected === snapshot.grid.expected &&
      // The bands move every step, so comparing them is what keeps the panel from
      // repainting twice a second over a rounding.
      Math.round(current.demography.child) === Math.round(snapshot.demography.child) &&
      Math.round(current.demography.young) === Math.round(snapshot.demography.young) &&
      Math.round(current.demography.adult) === Math.round(snapshot.demography.adult) &&
      Math.round(current.demography.elder) === Math.round(snapshot.demography.elder) &&
      Math.round(current.demography.awaitingBurial) ===
        Math.round(snapshot.demography.awaitingBurial) &&
      Math.round(current.demography.schooled * 100) ===
        Math.round(snapshot.demography.schooled * 100) &&
      Math.round(current.rubbish.waiting) === Math.round(snapshot.rubbish.waiting) &&
      // Cheap because both objects are small and rebuilt from the same key set:
      // the panel repaints twice a second and a stale budget row would be the one
      // thing on it the player just changed.
      Math.round(current.approval * 100) === Math.round(snapshot.approval * 100) &&
      // Compared by what is drawn: a faction's row shows whole percentages.
      current.groups.length === snapshot.groups.length &&
      current.groups.every((row, i) => {
        const next = snapshot.groups[i];
        return (
          next !== undefined &&
          row.id === next.id &&
          Math.round(row.approval * 100) === Math.round(next.approval * 100) &&
          Math.round(row.weight * 100) === Math.round(next.weight * 100)
        );
      }) &&
      // Compared by the second, which is what the row displays: a countdown is
      // the one figure on the panel that changes on its own, and comparing it
      // any finer would repaint the whole section every frame.
      current.lobbies.length === snapshot.lobbies.length &&
      current.lobbies.every((row, i) => {
        const next = snapshot.lobbies[i];
        return (
          next !== undefined &&
          row.id === next.id &&
          Math.round(row.remaining) === Math.round(next.remaining)
        );
      }) &&
      // Compared by the whole percent the bars actually draw.
      current.report.grade === snapshot.report.grade &&
      Math.round(current.report.overall * 100) === Math.round(snapshot.report.overall * 100) &&
      REPORT_DIMENSIONS.every(
        (dimension) =>
          Math.round((current.report.scores[dimension] ?? 0) * 100) ===
          Math.round((snapshot.report.scores[dimension] ?? 0) * 100),
      ) &&
      current.mandate === snapshot.mandate &&
      current.promises.length === snapshot.promises.length &&
      current.promises.every((row, i) => {
        const next = snapshot.promises[i];
        return (
          next !== undefined &&
          row.id === next.id &&
          row.made === next.made &&
          row.unlocked === next.unlocked &&
          Math.round(row.progress * 100) === Math.round(next.progress * 100)
        );
      }) &&
      Math.round(current.betrayed * 100) === Math.round(snapshot.betrayed * 100) &&
      Math.round(current.unrest * 100) === Math.round(snapshot.unrest * 100) &&
      Math.round(current.riders) === Math.round(snapshot.riders) &&
      Math.ceil(current.secondsToElection) === Math.ceil(snapshot.secondsToElection) &&
      SERVICE_KEYS.every(
        (kind) =>
          current.stations[kind] === snapshot.stations[kind] &&
          current.budgets[kind] === snapshot.budgets[kind],
      )
        ? current
        : { ...current, ...snapshot },
    ),
  setEra: (era) => set({ era }),
  setTool: (activeTool) => set({ activeTool }),
  setOverlay: (overlay) => set({ overlay }),
  setFps: (fps, cpuMs) => set({ fps, cpuMs }),
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
