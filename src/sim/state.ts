import { HAPPINESS_START, STARTING_MONEY, STARTING_TAX_RATE } from '../data/balance';
import type { Building } from './buildings';
import type { Attraction } from './attractions';
import type { LobbyDeal } from './lobbies';
import type { Mandate } from './unrest';
import type { PromiseId } from '../data/promises';
import type { DecreeId } from '../data/decrees';
import { createBudgets, type Budgets } from './budgets';
import type { PolicyId } from '../data/policies';
import type { Loan } from './credit';
import { createCohorts, type Cohorts } from './cohorts';
import type { Crime } from './crime';
import type { Verdict } from './elections';
import type { Epidemic, Fire } from './hazards';
import { layNationalHighway } from './highway';
import { sectionCount } from './highwayWear';
import { CALM_EFFECTS, type TimelineEffects } from './timeline';
import { legacyEndowment } from './legacy';
import type { ServiceBuilding } from './services';
import type { ProgrammeId } from '../data/investments';
import type { Port } from './ports';
import type { TransitLine } from './transit';
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
  /**
   * The same population, broken into age bands (sim/cohorts.ts).
   *
   * A decomposition of `population`, never a second source of truth for it: the
   * cohort pass reconciles against it every step, so migration and epidemics land
   * in the bands without knowing the bands exist. Derived, and therefore not
   * saved — a loaded city re-fills its bands from its population within a tick,
   * which costs one generation of schooling history and nothing else.
   */
  cohorts: Cohorts;
  happiness: number;
  research: number;

  demand: { res: number; com: number; ind: number; office: number };
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
  /** Hotels, landmarks and the airport (sim/attractions.ts). */
  attractions: Map<number, Attraction>;
  nextAttractionId: number;
  /**
   * Ordinances in force (sim/policies.ts). A set of ids rather than flags on
   * state, so adding a policy never touches this file again.
   */
  policies: Set<PolicyId>;
  /**
   * Deals signed with the lobbies (sim/lobbies.ts), each with the played-time
   * it lapses at. Saved: a term the player signed has to still be running when
   * they come back, and has to have run down while they were away.
   */
  lobbies: LobbyDeal[];
  /**
   * Bus and tram lines the player drew (sim/transit.ts).
   *
   * Saved, because the player drew them and paid for them — unlike the fires and
   * the crimes, a line is a decision rather than a moment.
   */
  transit: Map<number, TransitLine>;
  nextTransitId: number;
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
  /**
   * Rubbish waiting to be collected, in the depots' own units (sim/rubbish.ts).
   *
   * Not saved: a reload starts the bins empty, which is a small mercy and cheaper
   * than a schema change. If the depots really are short it builds back within a
   * minute of play, so nothing is being given away.
   */
  rubbish: number;
  /** Whether the city has already been told the bins are overflowing. */
  rubbishOverflowing: boolean;
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
   * What each department is funded at, 0.5..1.5 (sim/budgets.ts).
   *
   * Saved: it is a decision, and one a city can be quietly ruined by forgetting
   * it made.
   */
  budgets: Budgets;
  /**
   * The last term whose election has been settled (sim/elections.ts).
   *
   * Saved. The term itself is derived from played time, so this is the only
   * thing that has to be remembered — and without it a reload mid-term would
   * hold the same vote again.
   */
  lastTermSettled: number;
  /** How the last one went, and how long the city will remember it. */
  lastVerdict: Verdict;
  verdictMemory: number;
  /**
   * How the mayor came to be governing, and what the streets make of it
   * (sim/unrest.ts, §29).
   *
   * Both saved. A refusal or a coup is the single most consequential thing a
   * player can do in this game, and a reload that quietly restored their
   * legitimacy would erase the decision along with its cost.
   */
  mandate: Mandate;
  unrest: number;
  /**
   * Promises outstanding, and what each faction remembers of the broken ones
   * (sim/promises.ts, §30).
   *
   * `betrayed` is parallel to GROUP_ORDER rather than a map, so the save is an
   * array of numbers and a faction added later simply starts at zero. Both
   * saved: a promise a player made is a debt, and a reload that cleared it
   * would make the whole mechanic free.
   */
  promises: PromiseId[];
  betrayed: number[];
  /**
   * Decrees in force, the fury they have banked, and the highest warning stage
   * the player has been told about (sim/decrees.ts, §32).
   *
   * Decrees and fury are saved — a decree is a standing order and fury is a
   * debt, and a reload that cleared either would make rule-by-force free. The
   * told-stage is transient: a loaded city syncs it to the current stage, so a
   * reload lands quiet and the *next* crossing announces.
   */
  decrees: DecreeId[];
  fury: number;
  furyToldStage: number;
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
    cohorts: createCohorts(),
    happiness: HAPPINESS_START,
    research: 0,

    demand: { res: 0, com: 0, ind: 0, office: 0 },
    power: { gen: 0, use: 0 },
    water: { gen: 0, use: 0 },

    legacy,

    world,
    buildings: new Map(),
    services: new Map(),
    utilities: new Map(),
    ports: new Map(),
    attractions: new Map(),
    nextAttractionId: 1,
    policies: new Set(),
    lobbies: [],
    promises: [],
    betrayed: [],
    decrees: [],
    fury: 0,
    furyToldStage: 0,
    mandate: 'elected',
    unrest: 0,
    transit: new Map(),
    nextTransitId: 1,
    farmTiles: 0,
    fires: new Map(),
    nextFireId: 1,
    crimes: new Map(),
    nextCrimeId: 1,
    crimeSting: 0,
    rubbish: 0,
    rubbishOverflowing: false,
    epidemic: null,
    lastYear: null,
    timelineEffects: { ...CALM_EFFECTS },
    highwayWear: new Array<number>(sectionCount(world)).fill(0),
    missionsDone: [],
    techsDone: [],
    budgets: createBudgets(),
    lastTermSettled: 0,
    lastVerdict: 'won',
    verdictMemory: 0,
    investments: { lighting: 0, greening: 0, festivals: 0 },
    nextBuildingId: 1,
    nextServiceId: 1,
    nextUtilityId: 1,
    nextPortId: 1,
    ledger: {
      taxIncome: 0,
      tourismIncome: 0,
      lobbyIncome: 0,
      decreeIncome: 0,
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
      fareIncome: 0,
      transitUpkeep: 0,
    },
    lastSeen: now,
  };
}
