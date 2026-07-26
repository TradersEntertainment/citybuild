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
 * Share of a facility's price returned when it is knocked down.
 *
 * Ground is cleared for nothing — charging to scrub off paint would make a
 * player hesitate over fixing their own mistake — but a station is a single
 * four-figure purchase, and getting nothing back for one placed a tile out of
 * position is the punished mis-touch the brief bans (§24). Half is enough to
 * make it an annoyance rather than a loss, and little enough that where a plant
 * goes stays a decision.
 */
export const DEMOLITION_REFUND = 0.5;

/**
 * Seconds at full suitability to gain the next level. Construction is short by
 * design (§1) — the "almost there" feeling has to stay constant.
 */
export const BUILDING_GROWTH_S = [14, 35, 80, 170] as const;
/**
 * Fraction of capacity a building starts with when it appears. A home only
 * gets built because people were already coming, so it arrives part-full;
 * seeding it nearly empty spikes the vacancy rate on every spawn wave and
 * takes residential demand down with it.
 */
export const BUILDING_SEED_OCCUPANCY = 0.6;

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

// --- Pollution and noise (§10) -----------------------------------------------
/**
 * Passes of the relaxation solver. Each pass spreads roughly one tile, so this
 * is also the practical reach of a factory's stain — far enough that industry
 * is a planning problem, close enough that a green belt can hold it.
 */
export const DIFFUSION_ITERATIONS = 12;
/** Fraction lost per pass. Higher fades faster and keeps the plume tight. */
export const POLLUTION_DECAY = 0.12;
/** Noise is tighter than smoke: it drops off within a couple of streets. */
export const NOISE_DECAY = 0.35;
/**
 * Emission per job. Calibrated so a mature industrial district reaches the
 * upper half of the 0..100 scale: at the -0.2 weight that is a real drag on a
 * neighbouring plot without being an outright veto, which is what makes
 * "where does the industry go" a decision instead of a rule.
 */
export const POLLUTION_PER_INDUSTRIAL_JOB = 1.8;
export const NOISE_PER_INDUSTRIAL_JOB = 2;
export const NOISE_PER_COMMERCIAL_JOB = 1;
/** Share of a tile's load removed each pass by a park. */
export const PARK_ABSORPTION = 0.3;
/** Standing woodland does the same, less well than a planted park. */
export const TREE_ABSORPTION = 0.16;
/**
 * How much each kind of building minds what it is standing in.
 *
 * The suitability weights are global, which would have a factory penalised by
 * its own smoke and warned about it on the map — noise in both senses. Industry
 * is indifferent, commerce minds a little, and homes mind all of it.
 */
export const NUISANCE_SENSITIVITY = {
  res: { pollution: 1, noise: 1 },
  com: { pollution: 0.65, noise: 0.5 },
  ind: { pollution: 0, noise: 0 },
} as const;

/** Pollution above this puts a warning mark on the building standing in it. */
export const POLLUTION_ALARM = 45;
/** Noise above this does the same. */
export const NOISE_ALARM = 55;

// --- National highway (ulusal otoyol) -----------------------------------------
/**
 * Through-traffic the motorway carries with no city at all, vehicles per
 * minute. A national road is never empty; the floor is what puts the first
 * few lorries on it while the map is still wilderness.
 */
export const TRANSIT_BASE_FLOW = 26;
/** Extra vehicles per minute per √population — a city is a destination. */
export const TRANSIT_POPULATION_PULL = 1.4;
/** Each interchange (max 4 counted) pulls this share more traffic past the city. */
export const TRANSIT_INTERCHANGE_PULL = 0.12;
/** Hard ceiling on through-traffic; keeps the highway's load figure honest. */
export const TRANSIT_FLOW_MAX = 320;
/**
 * ₺ per through-vehicle per minute, scaled by how much of the route crosses
 * owned land and how well the city is junctioned onto it. Sized so the first
 * interchange is worth a district's early tax take, not a fortune.
 */
export const TRANSIT_TOLL = 5.5;
/**
 * Output multiplier for shops and workshops within reach of an interchange:
 * through-traffic buys fuel, food and freight capacity as well as locals do.
 */
export const TRANSIT_TRADE_BONUS = 1.25;
/** How close to an interchange a workplace must be to feel the corridor. */
export const TRANSIT_TRADE_RADIUS = 6;

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
 * ₺ per unit of food, per minute. Food was always produced and never sold —
 * the farm belt employed people and fed a ledger line that did not exist,
 * which read as farms being free points. Now the harvest is income.
 */
export const FOOD_PRICE = 0.5;
/**
 * Work per farm tile. Farmland is the founding era's employer (§12.1 opens
 * with path, housing and farm), so without it the first village has nowhere
 * to work and no reason to stay.
 */
export const FARM_JOBS_PER_TILE = 0.35;
export const COMMERCIAL_TAX = 0.06;
export const INDUSTRIAL_TAX = 0.05;

// --- Hazards (§13): the chaos services answer --------------------------------
/**
 * Per-building chance of a fire starting, per second. ~0.0012 a minute: a
 * village of thirty buildings meets its first blaze around the half-hour
 * mark, a town of a hundred every eight minutes or so — often enough that a
 * brigade is a real purchase, rare enough that the city survives learning.
 */
export const FIRE_IGNITION_PER_SEC = 0.00002;
/** Taller buildings burn a little more readily; per level above one. */
export const FIRE_LEVEL_IGNITION_STEP = 0.5;
/** Fire coverage cuts both the chance a fire starts… */
export const FIRE_COVERED_IGNITION_MULT = 0.2;
/** …and how long it burns: fought fires are out in this many seconds. */
export const FIRE_RESPONSE_S = 25;
/** Tiles per second a dispatched engine covers on its way to the blaze. */
export const FIRE_TRUCK_SPEED = 9;
/** Seconds the crew works at the scene before the all-clear. */
export const FIRE_TRUCK_DWELL_S = 3;
/** An unfought fire takes the building after this many seconds. */
export const FIRE_BURNOUT_S = 80;
/** Seconds between spread rolls on an unfought fire. */
export const FIRE_SPREAD_S = 12;
/** Chance each spread roll ignites a neighbour… */
export const FIRE_SPREAD_CHANCE = 0.3;
/** …within this many tiles (manhattan). */
export const FIRE_SPREAD_RADIUS = 2;
/** Mood cost of each burning building, capped so the scale stays readable. */
export const FIRE_HAPPINESS_HIT = 9;
export const FIRE_HAPPINESS_CAP = 30;
/** Below this population an epidemic cannot take hold. */
export const EPIDEMIC_MIN_POP = 120;
/**
 * Per-second chance of an outbreak once the city is big enough. About one a
 * half-hour: a rhythm the player can answer, not a weather system.
 */
export const EPIDEMIC_PER_SEC = 0.0006;
/** How long an uncovered outbreak runs, in seconds. */
export const EPIDEMIC_DURATION_S = 150;
/** Share of the population taken per second at full severity. */
export const EPIDEMIC_DRAIN_PER_SEC = 0.0009;
/** Mood cost of an outbreak at full severity. */
export const EPIDEMIC_HAPPINESS_HIT = 26;

// --- Roads (§5.2, §20) -------------------------------------------------------
export const JUNCTION_PENALTY_4WAY = 0.25; // KAVŞAK_CEZASI
export const JUNCTION_PENALTY_3WAY = 0.1;
/** Congested segments lose speed: hız / (1 + (doluluk-1)×1.5) */
export const CONGESTION_SLOWDOWN = 1.5;
/**
 * Trips generated per minute. Residents leave and come back; a job draws
 * somebody in. These set the scale that road capacity is measured against, so
 * they are what decides whether a dirt track can serve a hamlet.
 */
export const TRIPS_PER_RESIDENT = 0.5;
export const TRIPS_PER_JOB = 0.35;
/** Passes of the spread that pushes district traffic onto its arterial. */
export const TRAFFIC_SPREAD_PASSES = 6;
/** Load above this puts a warning mark on the buildings it strands. */
export const CONGESTION_ALARM = 1.2;
/** How much a jam takes off the land value of what it runs past. */
export const CONGESTION_LAND_VALUE = 16;
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
/**
 * Steps the catch-up is allowed to take, however long the absence.
 *
 * Away time is simulated rather than paid out from a formula — the city that
 * greets a returning player has to be one the same rules could have produced,
 * or the numbers on the card are a fiction. That means the real systems run,
 * and the real systems cost milliseconds a pass, so the count is bounded and
 * the step lengthens instead.
 *
 * Thirty is where the curve flattens. Measured against an hour lived a second
 * at a time on a 450-building city: thirty steps lands within 1% on both
 * population and balance and gets the level distribution right, in about half a
 * second; sixteen is 4% out and visibly skews the mix toward taller blocks,
 * because a longer step lets migration fill a whole district's vacancy at once.
 * Going past thirty buys nothing and costs milliseconds a step.
 */
export const OFFLINE_STEPS = 30;
/**
 * Shortest catch-up step, so a brief absence is not charged the full thirty.
 *
 * A tab switched away for ten seconds is ten seconds the city really did not
 * run — rAF stops with the tab — so it is simulated like any other gap, but it
 * needs one step, not thirty. The count is the gap divided by this, capped.
 */
export const OFFLINE_STEP_MIN_S = 30;
/** Below this, an absence is a glance at another tab and gets no card. */
export const OFFLINE_MIN_REPORT_MS = 120_000;

// --- Petitions (Paket 3 §7) --------------------------------------------------
/**
 * Share of buildings that must be complaining about one thing before the city
 * puts it to the mayor.
 *
 * A fifth is the point at which a problem stops being a few unlucky plots and
 * starts being a district. Lower and the feed becomes weather; higher and a
 * player fixes it before anyone thinks to ask.
 */
export const PETITION_RAISE_SHARE = 0.22;
/**
 * Share it must fall below before the petition counts as settled.
 *
 * Well under the raising bar on purpose: one line for both would have a city
 * hovering at the boundary filing and withdrawing the same petition every few
 * seconds.
 */
export const PETITION_CLEAR_SHARE = 0.12;
/** Mood the city returns for a petition actually answered. */
export const PETITION_RESOLVED_HAPPINESS = 3;

// --- Weather (Paket 2 §6) ----------------------------------------------------
/**
 * How long one spell of weather lasts, in seconds.
 *
 * Three years at forty seconds to the year — long enough that a player notices
 * they are having a wet decade and short enough that the sky is not a setting.
 */
export const WEATHER_SPAN_S = 120;
/**
 * Weight of clear weather against every other spell put together.
 *
 * Heavy on purpose. Weather that is always happening is not weather, and the
 * value of a rainy spell is entirely that the last few were not.
 */
export const WEATHER_CLEAR_WEIGHT = 16;

// --- Day cycle (Paket 1 §2) --------------------------------------------------
/**
 * Seconds in one day/night cycle.
 *
 * Set equal to SECONDS_PER_YEAR so one year is one day: every new year opens
 * with a dawn, and there is a single notion of how fast time passes rather than
 * a sun that contradicts the year badge. The plan asked for 120, which would
 * have put three years inside one sunrise.
 */
export const SECONDS_PER_DAY = 40;
/**
 * Share of the cycle the sun spends above the horizon.
 *
 * An even split leaves the city dark half the time it is being looked at. The
 * night is worth having for the lights coming on, not for the dark.
 */
export const DAYLIGHT_SHARE = 0.68;

// --- National highway wear (savaş ve yol bakımı) -----------------------------
/**
 * Tiles per stretch of motorway the state maintains as one unit.
 *
 * The route is a couple of hundred tiles long, so this makes about ten
 * stretches. Per-tile damage would be confetti — a pothole here, a pothole
 * there, none of it legible from the map height a player actually plays at. A
 * stretch is long enough to see go bad and short enough that losing one is a
 * setback rather than the end of the city.
 */
export const HIGHWAY_SECTION_TILES = 24;
/**
 * Wear a stretch takes per second of war, before the interchange weighting.
 *
 * One over two hundred: an untouched stretch would take two hundred seconds —
 * five years at this calendar — to go from new to impassable. The Great War
 * runs four years and the Second six, so a war ruins a busy corridor and merely
 * scars a quiet one, which is the difference the interchange weighting is for.
 */
export const HIGHWAY_WEAR_PER_S = 1 / 200;
/**
 * Extra wear per interchange on the stretch.
 *
 * The convoys are the state's, but the lorries queueing to join them are the
 * city's. A stretch the city actually plugs into carries more than one it
 * merely runs past, and wears out sooner for it.
 */
export const HIGHWAY_WEAR_PER_INTERCHANGE = 0.2;
/**
 * Wear the state repairs for free, per second, in peacetime.
 *
 * Only below the invoice threshold: the state patches potholes on its own road,
 * but a stretch it has already sent a bill for is the city's problem until the
 * city pays. Slow enough — a quarter of the war rate — that a war leaves a mark
 * on the decade after it.
 */
export const HIGHWAY_HEAL_PER_S = 1 / 800;
/**
 * What fraction of that trickles on once the bill has been sent.
 *
 * Not zero, and that is the whole point of the number. A city that genuinely
 * cannot raise the money must not be locked out of the country forever — but at
 * a quarter rate, waiting out a barricade costs twenty-odd minutes of a dead
 * corridor, which is a far worse deal than paying. The escape hatch exists to
 * be refused.
 */
export const HIGHWAY_BILLED_HEAL_SHARE = 0.25;
/** Wear at which the state stops patching and sends the city an invoice. */
export const HIGHWAY_WEAR_BILL = 0.55;
/** Seconds between reminders while a stretch stands billed or barricaded. */
export const HIGHWAY_BILL_REMINDER_S = 90;
/** Flat part of a repair bill, in ₺. */
export const HIGHWAY_REPAIR_BASE = 700;
/**
 * The part of the bill that scales with the city, per √resident.
 *
 * Square root, like the transit flow it mirrors: a village pays a village's
 * share of the corridor and a metropolis pays more without paying a hundred
 * times more. A bill that scaled linearly would be pocket change at ten
 * thousand residents and confiscation at a hundred thousand.
 */
export const HIGHWAY_REPAIR_PER_ROOT_CITIZEN = 38;

// --- Legacy / prestige (§6 of Phase 6) ---------------------------------------
/**
 * Population that scores one legacy point at the square root.
 *
 * Set so a first city that reaches the town era with a few thousand residents
 * is worth roughly a doubling of the starting balance — enough that the second
 * run visibly opens differently, not so much that it skips the opening.
 */
export const LEGACY_POPULATION_DIVISOR = 40;
/** Points for each era reached, so building well is worth as much as sprawling. */
export const LEGACY_ERA_BONUS = 4;
/** Starting money each point endows. */
export const LEGACY_MONEY_PER_POINT = 2_200;

// --- Credit (§7, §20) --------------------------------------------------------
export const LOAN_INTEREST = 0.06; // KREDİ_FAİZ
export const LOAN_INTEREST_STACKED = 0.11;
export const LOAN_INSTALMENT_MIN = 20;
/**
 * What the bank lends, as minutes of the city's gross tax take.
 *
 * Twelve minutes is about what a district costs to lay out, which is the size
 * of hole a player actually digs for themselves — enough to be a bridge across
 * one bad decision, not enough to fund a second city on credit.
 */
export const LOAN_TO_INCOME = 12;
/** Minutes to repay. Long enough to be survivable, short enough to be felt. */
export const LOAN_TERM_MINUTES = 20;
/** Below this the paperwork is worth more than the loan. */
export const LOAN_MIN_PRINCIPAL = 500;
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
/**
 * v4: the national highway exists and the road column may contain state-owned
 * tiles the old rules never met. Rather than half-merge an old city with a
 * motorway it was built without, old saves are declined — legacy points are
 * held separately and carry over either way.
 */
export const SAVE_VERSION = 4;

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
