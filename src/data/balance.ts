/**
 * Single source of truth for every tunable number (brief §4, §20).
 * No magic numbers anywhere else in the codebase.
 * Turkish names from the brief's table are kept in comments for traceability.
 */

// --- World (§4) --------------------------------------------------------------
export const WORLD_SIZE = 256; // tiles per side
export const PARCEL_SIZE = 48; // tiles per side of a purchasable parcel
export const SEA_LEVEL = 0.42; // heights below this are water
/** PARSEL_FİYAT(n) = 120_000 * 1.9^n */
export const PARCEL_PRICE_BASE = 120_000;
export const PARCEL_PRICE_GROWTH = 1.9;
/** maliyetÇarpanı = 1 + eğim × 2.5 */
export const SLOPE_COST_FACTOR = 2.5;
export const BRIDGE_COST_MULTIPLIER = 6;
export const FOREST_DEBRIS_MS = 8 * 60_000;

// --- Terrain generation (§4) -------------------------------------------------
/** How far above sea level the starting parcel is guaranteed to sit. */
export const START_LAND_MARGIN = 0.05;
export const TERRAIN_MARSH_BAND = 0.035; // height above sea that stays marsh
export const TERRAIN_HILL_HEIGHT = 0.62;
export const TERRAIN_ROCK_HEIGHT = 0.76;
export const TERRAIN_FOREST_FERTILITY = 0.56;
export const RIVER_COUNT = 7;
export const RIVER_MAX_LENGTH = 400;
export const RESOURCE_CLUSTERS = 26;
export const RESOURCE_CLUSTER_RADIUS = 6;

// --- Road drawing (§5.1) -----------------------------------------------------
/** Deviations shorter than this snap onto the main axis. */
export const SNAP_AXIS_TILES = 8;
/** A segment within this many tiles of square locks to exactly 45°. */
export const SNAP_DIAGONAL_TILES = 3;
/**
 * A run bowing further than this from its own chord is a deliberate curve.
 * The brief states a flat 3 tiles; that is kept as the floor, but the test also
 * scales with the run's length below — three tiles of drift across a sixty-tile
 * drag is a wobble, while the same three tiles across twelve is a bend.
 */
export const PATH_CURVE_SAGITTA_TILES = 3;
export const PATH_CURVE_SAGITTA_RATIO = 0.1;
/** Finer tolerance used inside a run that is being kept as a curve. */
export const PATH_CURVE_SIMPLIFY_TILES = 1;
/**
 * Arc length averaged over to cancel thumb tremor before measuring turns. Must
 * stay well below the corner window: smoothing wider than the span the turn is
 * measured over rounds a real corner away before it can be seen.
 */
export const PATH_TREMOR_WINDOW_TILES = 1.2;
/** Turn measured over this short a span, so only fast turns count as corners. */
export const PATH_CORNER_WINDOW_TILES = 3;
/** Turn angle, in radians, that counts as a deliberate corner (~55°). */
export const PATH_CORNER_ANGLE = 0.95;
/** Samples either side suppressed around a detected corner. */
export const PATH_CORNER_SUPPRESSION = 6;
/** Joints turning at least this sharply (radians, ~17°) get rounded. */
export const PATH_JOINT_MIN_ANGLE = 0.3;
/** Fillet radius at a joint, in tiles. */
export const PATH_JOINT_RADIUS_TILES = 2.5;
/** Points sampled along each fillet. */
export const PATH_JOINT_SAMPLES = 6;
/** Chaikin passes used to soften a deliberate curve. */
export const PATH_SMOOTH_PASSES = 3;
/** Longest stroke accepted in one gesture, so a stray drag cannot span the map. */
export const PATH_MAX_TILES = 400;
/** Cost label sits this far above the finger, out from under it. */
export const COST_LABEL_OFFSET_PX = 40;
/** "Ink drying" confirmation after a road is built. */
export const INK_DRY_MS = 250;

// --- Start conditions (§20) --------------------------------------------------
export const STARTING_MONEY = 25_000; // BAŞLANGIÇ_PARA
export const STARTING_TAX_RATE = 0.09; // BAŞLANGIÇ_VERGİ
export const TAX_RATE_MIN = 0;
export const TAX_RATE_MAX = 0.2;

// --- Tick rates (§11, §20) ---------------------------------------------------
export const SIM_TICK_HZ = 5; // SIM_TICK_HZ
export const ECONOMY_TICK_HZ = 1; // EKONOMİ_TICK_HZ
export const TRAFFIC_REFRESH_S = 5; // TRAFİK_YENİLEME_SN
export const FIELD_DIFFUSION_S = 10; // ALAN_DİFÜZYON_SN
export const BUILDING_EVAL_S = 3; // BİNA_DEĞERLENDİRME_SN
/** Longest wall-clock gap the loop replays in one frame; beyond this the
 *  offline path takes over instead of spiralling on catch-up ticks. */
export const MAX_CATCH_UP_MS = 1_000;

// --- Buildings (§6, §20) -----------------------------------------------------
export const BUILDING_SPAWN_THRESHOLD = 0.45; // BİNA_DOĞUŞ_EŞİĞİ
export const BUILDING_DECAY_THRESHOLD = 0.25; // BİNA_ÇÖKÜŞ_EŞİĞİ
export const DECAY_DURATION_S = 90; // ÇÖKÜŞ_SÜRESİ_SN
/** KONUT_KAPASİTE(l) = 4 * l^1.6 */
export const residentialCapacity = (level: number): number => 4 * Math.pow(level, 1.6);
/** TİCARET_İŞ(l) = 3 * l^1.5 */
export const commercialJobs = (level: number): number => 3 * Math.pow(level, 1.5);
/** SANAYİ_İŞ(l) = 5 * l^1.4 */
export const industrialJobs = (level: number): number => 5 * Math.pow(level, 1.4);

/** Zone painting costs per tile (§6.1). */
export const ZONE_COST = {
  res: 40,
  com: 65,
  ind: 55,
  farm: 20,
  park: 90,
} as const;
/** Brush diameters offered in the dock (§6.1). */
export const BRUSH_SIZES = [1, 3, 5] as const;

/**
 * Seconds at full suitability to gain the next level. Construction is short by
 * design (§1) — the "almost there" feeling has to stay constant.
 */
export const BUILDING_GROWTH_S = [14, 35, 80, 170] as const;
/** Fraction of capacity a building starts with when it appears. */
export const BUILDING_SEED_OCCUPANCY = 0.35;

/** Suitability weights — §6.2 */
export const SUITABILITY_WEIGHTS = {
  roadAccess: 0.3,
  demand: 0.25,
  serviceCoverage: 0.2,
  landValue: 0.15,
  neighbourFit: 0.1,
  pollution: -0.2,
  noise: -0.1,
} as const;
export const ROAD_ACCESS_MAX_WALK = 4; // tiles

// --- Consumption (§20) -------------------------------------------------------
export const WATER_PER_CAPITA = 0.35; // m³/min — KİŞİ_BAŞI_SU
export const POWER_PER_CAPITA = 0.012; // MW — KİŞİ_BAŞI_ELEKTRİK

// --- Population (§8, §20) ----------------------------------------------------
/**
 * GÖÇ_KATSAYISI = k * (mutluluk-40)/60 * boşKonut, per minute.
 *
 * The shape is the brief's; the coefficient is not. Because migration is
 * proportional to vacancy, k sets how long an empty home takes to fill:
 * 1 / (k × (happiness−40)/60) minutes. The brief's 0.02 works out to roughly
 * an hour at a contented happiness of 85, which reads as a city that has
 * stopped rather than one that is filling, and it stalls the whole feedback
 * loop — vacancy stays high, residential demand stays at zero, and nothing
 * more is ever built. 0.5 gives a fill time near three minutes, which is slow
 * enough to watch and fast enough to keep the loop turning.
 */
export const MIGRATION_COEFFICIENT = 0.5;
export const MIGRATION_HAPPINESS_PIVOT = 40;
export const MIGRATION_HAPPINESS_SPAN = 60;
export const HAPPINESS_EXODUS_THRESHOLD = 35;
export const HAPPINESS_START = 60;
/** Share of residents who are of working age (§8). */
export const LABOUR_PARTICIPATION = 0.5;
/** Residents one commercial job serves; sets how much retail a city wants. */
export const RESIDENTS_PER_COMMERCIAL_JOB = 14;
/** Commercial jobs one industrial job supplies. */
export const COMMERCIAL_PER_INDUSTRIAL_JOB = 1.6;
/** How fast demand chases its target, per second. */
export const DEMAND_RESPONSE = 0.25;
/** How fast happiness chases its target, per second. */
export const HAPPINESS_RESPONSE = 0.08;
/** Unemployment above this starts hurting happiness. */
export const UNEMPLOYMENT_TOLERANCE = 0.08;
/**
 * Happiness lost at total unemployment. Kept moderate on purpose: a founding
 * village with no formal jobs should stagnate, not empty out. A steeper curve
 * makes the game punish the player for following its own opening move.
 */
export const UNEMPLOYMENT_PENALTY = 75;

// --- Trade and yields (§7) ---------------------------------------------------
/** Turnover per commercial job per minute. */
export const COMMERCIAL_TURNOVER = 26;
/** Output per industrial job per minute. */
export const INDUSTRIAL_OUTPUT = 18;
/** Food per farm tile per minute. */
export const FARM_YIELD = 4;
/**
 * Work per farm tile. Farmland is the founding era's employer (§12.1 opens
 * with path, housing and farm), so without it the first village has nowhere
 * to work and no reason to stay.
 */
export const FARM_JOBS_PER_TILE = 0.35;
export const COMMERCIAL_TAX = 0.06;
export const INDUSTRIAL_TAX = 0.05;

// --- Roads (§5.2, §20) -------------------------------------------------------
export const JUNCTION_PENALTY_4WAY = 0.25; // KAVŞAK_CEZASI
export const JUNCTION_PENALTY_3WAY = 0.1;
/** Congested segments lose speed: hız / (1 + (doluluk-1)×1.5) */
export const CONGESTION_SLOWDOWN = 1.5;
export const UNDO_STACK_SIZE = 20;

// --- Idle / offline (§11, §20) -----------------------------------------------
export const OFFLINE_CAP_HOURS = 14; // OFFLINE_TAVAN_SA
export const OFFLINE_EFFICIENCY_BANDS = [
  { untilHours: 2, efficiency: 1.0 },
  { untilHours: 8, efficiency: 0.6 },
  { untilHours: 14, efficiency: 0.35 },
] as const;
export const OFFLINE_VARIANCE = 0.08;
export const OFFLINE_EVENTS_MIN = 1;
export const OFFLINE_EVENTS_MAX = 4;

// --- Credit (§7, §20) --------------------------------------------------------
export const LOAN_INTEREST = 0.06; // KREDİ_FAİZ
export const LOAN_INTEREST_STACKED = 0.11;
export const LOAN_INSTALMENT_MIN = 20;
export const AUSTERITY_SERVICE_CAPACITY = 0.5;

// --- Research (§12.2, §20) ---------------------------------------------------
/** AP_KAZANIM/dk = 0.5 + nüfus^0.55/40 * (1 + eğitim/100) */
export const researchPerMinute = (population: number, education: number): number =>
  0.5 + (Math.pow(population, 0.55) / 40) * (1 + education / 100);

// --- Eras (§12.1) ------------------------------------------------------------
export const ERA_THRESHOLDS = [
  { era: 'founding', population: 0 },
  { era: 'village', population: 150 },
  { era: 'town', population: 1_500 },
  { era: 'city', population: 12_000 },
  { era: 'metro', population: 60_000 },
  { era: 'metropolis', population: 250_000 },
  { era: 'megacity', population: 1_000_000 },
] as const;

// --- Events (§13) ------------------------------------------------------------
export const EVENT_INTERVAL_MIN_S = 180;
export const EVENT_INTERVAL_MAX_S = 480;
export const EVENT_DECISION_TIMEOUT_S = 60;

// --- Prestige (§12.4) --------------------------------------------------------
/** MP = floor((zirveNüfus/1000)^0.75) */
export const legacyPoints = (peakPopulation: number): number =>
  Math.floor(Math.pow(peakPopulation / 1000, 0.75));

// --- Save (§16) --------------------------------------------------------------
export const AUTOSAVE_INTERVAL_S = 20;
export const SAVE_VERSION = 3;

// --- Camera & input (§3, §14.5) ----------------------------------------------
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 3.0;
export const ZOOM_DEFAULT = 1.0;
/** Below these zoom levels the renderer drops to blocks, then colour blobs. */
export const ZOOM_LOD_BLOCKS = 1.0;
export const ZOOM_LOD_BLOBS = 0.5;
export const TILE_PX = 16; // world tile size at zoom 1.0
export const MAX_DPR = 2; // Math.min(devicePixelRatio, 2)
export const LONG_PRESS_MS = 380;
export const TAP_SLOP_PX = 10; // movement still counted as a tap
export const TOUCH_TARGET_MIN_PX = 44;

// --- Performance budget (§17) ------------------------------------------------
export const FRAME_BUDGET_MS = 8;
