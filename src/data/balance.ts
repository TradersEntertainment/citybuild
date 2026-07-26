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
/**
 * What a workshop standing on a seam is worth, as an output multiplier.
 *
 * Coal, iron, stone and clay have been generated into every map since the first
 * phase and read by nothing but the tile inspector — a whole layer of terrain the
 * player could see and never use. This is what makes the map's own geology a
 * reason to put the industry *there* rather than anywhere flat.
 */
export const RESOURCE_OUTPUT = {
  none: 1,
  coal: 1.55,
  iron: 1.7,
  stone: 1.35,
  clay: 1.3,
} as const;
/**
 * Tiles of seam a workshop works through per minute at full output.
 *
 * A seam is a stock, not a tax break: work it and it runs out, and the district
 * built on it has to find something else to be. Slow enough that a player who
 * plants industry on coal gets a good long run out of it, fast enough that a
 * hundred-year city sees its first exhausted field.
 */
export const RESOURCE_DEPLETION_PER_MIN = 0.02;

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
/**
 * What an address on the park is worth, on the 0..100 land-value scale.
 *
 * Parks cost ninety a tile — the dearest thing the zone brush paints — and until
 * now the whole return was cleaner air. Nobody plants a park for the diffusion
 * pass. This is the link that was missing from the chain the game already has
 * everywhere else: park, then land value, then a taller building on it, then more
 * tax off the same ground.
 */
export const PARK_LAND_VALUE = 20;
/** How far that bonus carries, in tiles. Two streets, not a district. */
export const PARK_VALUE_REACH = 5;
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
/**
 * Share of residents who are of working age (§8).
 *
 * Kept as the fallback for a city with no cohort breakdown yet — see
 * sim/cohorts.ts, which derives the real figure from who actually lives there.
 */
export const LABOUR_PARTICIPATION = 0.5;

// --- Who lives there (§8b): age, schooling, and the waves they arrive in ------
/**
 * Seconds a resident spends in each of the four age bands.
 *
 * Deliberately *not* the calendar. A band of twenty real years would be 800
 * seconds at forty seconds to the year, which puts the annual death rate of a
 * real population — about eight in a thousand — against a migration rate tuned
 * per minute, and the arithmetic is brutal: a city of ten thousand would bury a
 * hundred people a minute and no amount of happiness could refill it. So the
 * band length is a game number, measured against gross migration rather than
 * against demography, and set so that replacing the dead is a pressure a
 * well-run city absorbs and a badly-run one does not.
 *
 * What survives from the real thing is the part worth having: a cohort that
 * arrives together moves through the bands together and leaves together, so a
 * founding boom is still a funeral three bands later.
 *
 * Measured, not guessed. At 420 seconds a band the whole population turned over
 * every twenty minutes — a city of forty-seven hundred buried two hundred and
 * forty people a minute, which is a treadmill rather than a city and would have
 * wanted nine cemeteries. At 900 the lifetime is an hour, the steady rate is
 * about one and a half per cent of the city a minute, two or three cemeteries
 * cover it, and the first wave off a founding boom lands around forty-five
 * minutes in — inside a long session, which is the whole reason to have it.
 */
export const COHORT_BAND_S = 900;
/**
 * Share of arrivals who are children rather than workers.
 *
 * A city fills from the motorway, and what comes up it is families. This is what
 * makes a school a demand rather than a coverage statistic — and what makes the
 * schooling decision pay off a full band later, when those children are the
 * workforce.
 */
export const ARRIVAL_CHILD_SHARE = 0.28;
/** …and share who are already old. Somebody's grandmother is on the bus. */
export const ARRIVAL_ELDER_SHARE = 0.04;
/**
 * What an educated workforce is worth, as a multiplier at full schooling.
 *
 * Applied to commercial and industrial output, which is where a wage comes from.
 * Modest on purpose: the point of schooling is that it compounds through the
 * bands, not that it is a bigger lever than the road network.
 */
export const SCHOOLED_OUTPUT = 1.35;
/** …and what it takes off the crime rate, likewise at full schooling. */
export const SCHOOLED_CRIME = 0.6;
/**
 * Mood cost of the dead going uncollected, and the cap on it.
 *
 * A city with no cemetery does not notice for a long time and then notices all
 * at once, which is exactly what a death wave should feel like.
 */
export const BURIAL_HAPPINESS_HIT = 14;
/** Burials one cemetery clears per minute. */
export const CEMETERY_RATE = 40;
/** Bodies awaiting a plot before the city minds, per thousand residents. */
export const BURIAL_TOLERANCE = 4;
/**
 * Children born per working-age resident per minute.
 *
 * Derived from the band length rather than chosen: at COHORT_BAND_S the steady
 * death rate is a quarter of the city divided by a band, and the working bands
 * are about half of it, so this is the figure at which a city that has stopped
 * growing replaces itself instead of decaying. Without births at all the child
 * band empties the moment migration slows, the schooling pipeline dries up with
 * it, and a mature city is a decay curve rather than a place with generations in
 * it — which was measured, not assumed.
 *
 * Births go in through the same housing check migration uses, so they compete for
 * the same empty rooms and cannot overfill a city or short-circuit the demand
 * loop the growth tests are tuned against.
 */
export const BIRTHS_PER_WORKER_MIN = (60 * 0.25) / (COHORT_BAND_S * 0.5);
/**
 * Share of housing standing empty at which the birth rate is at full tilt.
 *
 * Below it, births taper off smoothly. A ramp rather than a gate because the gate
 * version read the vacancy stock, and a stock clips one coarse step harder than
 * several fine ones — which put the offline catch-up and the frame loop fourteen
 * per cent apart on the same hour.
 */
export const BIRTH_ROOM_RAMP = 0.05;
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

// --- Crime (§13b): the hazard the player answers with a finger ----------------
/**
 * Per-building chance of a crime starting, per second.
 *
 * Deliberately about six times a fire. A fire is a disaster and has to stay
 * rare; a crime is an errand, and an errand that turns up twice an hour is not
 * a mechanic, it is a rumour. At this rate a town of a hundred buildings sees
 * one every minute or so, which is often enough that the player learns the verb
 * and buys the station that automates it.
 */
export const CRIME_PER_SEC = 0.00012;
/** Tills are worth robbing; a shop is this many times likelier than a home. */
export const CRIME_COMMERCIAL_MULT = 2.2;
/**
 * Crime after dark, as a multiplier at full night.
 *
 * This is the third thing the lighting programme buys, and the reason it is the
 * flagship purchase: lit streets scale this back towards the daytime figure, so
 * a city that paid for lamps genuinely has quieter nights rather than merely
 * brighter ones.
 */
export const CRIME_NIGHT_MULT = 2.4;
/** An unhappy city breeds more of it; multiplier at zero happiness. */
export const CRIME_MISERY_MULT = 1.8;
/** A covered street is a watched street: crimes start this much less often. */
export const CRIME_COVERED_MULT = 0.35;
/** Tiles per second a patrol car covers. Faster than an engine; less to carry. */
export const CRIME_CAR_SPEED = 11;
/** Seconds the officers spend at the scene before the arrest is made. */
export const CRIME_ARREST_S = 2.5;
/**
 * Seconds before an unanswered crime gets away with it.
 *
 * Long enough to notice the marker, pan to it and tap — the whole point is that
 * the player can answer it by hand — and short enough that ignoring one has a
 * cost inside the same minute.
 */
export const CRIME_ESCAPE_S = 45;
/** Loot as a share of the building's monthly worth, per level. */
export const CRIME_LOOT_BASE = 140;
export const CRIME_LOOT_PER_LEVEL = 90;
/** Mood cost of each unresolved crime, capped so the scale stays readable. */
export const CRIME_HAPPINESS_HIT = 4;
export const CRIME_HAPPINESS_CAP = 20;
/** Mood cost of a crime that got away, on top of the money. */
export const CRIME_ESCAPE_HAPPINESS = 3;
/** How long that sting lasts, in seconds. */
export const CRIME_ESCAPE_MEMORY_S = 90;

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

// --- Civic investments (belediye yatırımları) --------------------------------
/**
 * How much of a shop's trade the dark takes away, before lamps.
 *
 * Nearly half at the deepest part of the night, which sounds severe and is not:
 * the loss is paid back over the daytime hours (see DAY_TRADE_UPLIFT), so an
 * unlit city earns exactly what it earned before the night meant anything. The
 * number is really the *size of the prize* for lighting the city, and it wants to
 * be big enough that the player can watch the ledger change when they buy it.
 */
export const NIGHT_TRADE_LOSS = 0.45;
/** Mood each lighting tier is worth at the deepest part of the night. */
export const NIGHT_HAPPINESS_PER_LEVEL = 1.6;
/** Share of a tile's pollution each greening tier absorbs. */
export const GREENING_PER_LEVEL = 0.09;
/** How much each festival tier multiplies a holiday's worth. */
export const FESTIVAL_PER_LEVEL = 0.45;

// --- The national highway's shape --------------------------------------------
/**
 * Fewest tiles between two jogs in the motorway's line.
 *
 * The number that decides whether the road looks like a motorway or like a
 * mountain track. The route is a 4-connected staircase — it has to be, because
 * the connectivity BFS, the load spread and the trip injection all read the grid
 * four ways — so every change of direction is a one-tile jog, and how often those
 * come *is* how much the traffic weaves. Measured before and after: the old
 * curve jogged every 2.3 tiles with half of its runs a single tile long, which
 * no amount of spline smoothing on the vehicles could hide, because the control
 * points themselves were the zigzag.
 */
export const HIGHWAY_MIN_RUN = 10;
/**
 * How far each end of the road may sit from where it crosses the city, in tiles.
 *
 * This is the other half of the same constraint, and the two multiply: with one
 * jog allowed per `HIGHWAY_MIN_RUN` tiles, a span of 250 tiles buys about
 * twenty-five jogs, so the line cannot move more than about twenty-five tiles in
 * total however it is drawn. Asking for more deviation than that is asking for
 * the staircase back.
 */
export const HIGHWAY_END_DRIFT = 18;
/** Amplitude of the gentle lobe on top of the tilt, in tiles. */
export const HIGHWAY_WANDER = 7;
/** Noise scale for that lobe. Long, so it is one bend and not a ripple. */
export const HIGHWAY_WANDER_SCALE = 200;

// --- One-way streets ---------------------------------------------------------
/**
 * What a one-way tile carries, against a two-way one.
 *
 * More than the lane it stops giving to the other direction: there is no turn
 * across the flow and no oncoming queue at the junctions. Worth having on its
 * own, which is what makes the decision interesting — the whole cost of a
 * one-way scheme is in what has to go round, so if the tile itself were not a
 * gain there would be no reason ever to draw one.
 */
export const ONE_WAY_CAPACITY_BONUS = 1.55;

// --- Visitors from the motorway ----------------------------------------------
/**
 * Share of the through-traffic with a reason to stop.
 *
 * A third. Most of what passes on a motorway is going somewhere else and always
 * will be; the point of the number is that the rest is worth catching, and that
 * catching it is a thing the player does with roads rather than a thing that
 * happens to them.
 */
export const VISITOR_SHARE = 0.34;
/**
 * Shop jobs at which the city's draw is about two thirds of its maximum.
 *
 * Saturating rather than linear: the first parade of shops is most of the reason
 * to pull off a motorway, and the hundredth adds very little. Without this a
 * metropolis would capture the entire corridor and a town would capture nothing.
 */
export const VISITOR_PER_SHOP_JOB = 180;
/** How many tiles from an interchange visitors will still go. */
export const VISITOR_REACH = 22;
/**
 * Fraction of the arrivals a street hands on to the next street.
 *
 * This is the whole geometry of the mechanic. At four fifths a shop ten streets
 * in sees about a tenth of what one at the junction sees, which is enough to make
 * "put the commercial strip on the road out of the interchange" a real decision
 * without making anywhere else worthless.
 */
export const VISITOR_DECAY_PER_TILE = 0.86;
/**
 * Visitors a minute on a street at which a shop is getting about two thirds of
 * the full bonus.
 *
 * Measured against what the field actually produces rather than guessed. A busy
 * junction street carries single figures per minute, not tens: an early version
 * of this number assumed tens, and the result was that a well-built corridor
 * earned less than the crude flat bonus it replaced.
 */
export const VISITOR_SATURATION = 4;
/**
 * How hard a jam turns visitors back.
 *
 * Measured against load *over* capacity, the same shape the vehicle speeds use:
 * a street inside its capacity has no queue on it and turns nobody away, and one
 * at twice capacity passes well under half. A queue is where a stranger gives up
 * and turns round — but a road that is merely busy is not a queue, and biting on
 * mere busyness would have punished the player for having a city.
 */
export const VISITOR_CONGESTION_BITE = 1.6;
/**
 * Most a shop's output can be lifted by standing on a busy visitor street.
 *
 * Generous — this is meant to be worth building a district around — but bounded
 * and saturating, so one shop on the perfect corner cannot out-earn a whole
 * parade, and adding shops always beats stacking one.
 */
export const VISITOR_SPEND = 0.85;

// --- Construction (Paket 3 §9) -----------------------------------------------
/**
 * How far into a building's climb the scaffolding stays up.
 *
 * Not all the way. A cage that came down on the frame the building finished
 * would mean every plot in a growing city wore scaffolding permanently, and a
 * skyline of scaffolding is not a busy city, it is a broken renderer. Coming off
 * at three fifths leaves the last stretch as the building itself, which is also
 * when the player most wants to see what they have got.
 */
export const CONSTRUCTION_SCAFFOLD_UNTIL = 0.6;

// --- Seasons (Paket 3 §8) ----------------------------------------------------
/**
 * What each season does to a harvest.
 *
 * Winter is the number that matters: a third off is enough that a city living on
 * wheat feels the quarter turn over, and not enough to bankrupt one that planned
 * for it. The other three sum to a little over three, so a farm across a whole
 * year earns slightly more than it did before seasons existed — the calendar adds
 * texture, it does not quietly nerf farming.
 */
export const SEASON_FARM_YIELD = {
  winter: 0.68,
  spring: 1.05,
  summer: 1.18,
  autumn: 1.1,
} as const;
/** Where in the year the snow is deepest, as a fraction. Late January. */
export const SNOW_PEAK = 0.08;
/** How far either side of the peak any snow lies at all. */
export const SNOW_SPAN = 0.17;

// --- Ports (denize yatırım) --------------------------------------------------
/**
 * Most mood the whole waterfront can be worth.
 *
 * A marina is a nice thing to have on your coast. A row of eight of them is not
 * a happier city, it is an exploit, and capping it is cheaper than pricing every
 * marina against how many are already there.
 */
export const SEA_GATE_HAPPINESS_CAP = 6;

// --- Bridges -----------------------------------------------------------------
/**
 * How far a bridge deck rides above the water, in world height units.
 *
 * Enough that a boat could plausibly pass and that the deck reads as carried
 * rather than floating. Bigger and every crossing becomes a viaduct; smaller
 * and the sea laps over the tarmac.
 */
export const BRIDGE_CLEARANCE = 0.55;
/**
 * How much the deck may fall per tile as it comes back down to the ground.
 *
 * This is the gradient of the approach ramp, and it is the only thing deciding
 * how far inland a bridge is felt: clearance divided by this is the ramp's
 * length in tiles. A quarter-unit drop puts the shoreline transition over two
 * or three tiles, which reads as a road climbing onto a bridge rather than as
 * a step somebody forgot to smooth.
 */
export const BRIDGE_RAMP_DROP = 0.24;
/** Thickness of the deck slab, so a bridge has an underside. */
export const BRIDGE_DECK_THICKNESS = 0.14;
/** Height of the parapet either side. Low: it must not hide the traffic. */
export const BRIDGE_PARAPET_HEIGHT = 0.16;
/** Tiles between piers. Every tile would be a wall, not a bridge. */
export const BRIDGE_PIER_SPACING = 3;

// --- Keyboard camera ---------------------------------------------------------
/**
 * Screen pixels a second the keys pan the map.
 *
 * Pixels rather than tiles on purpose: the pan goes through the same drag maths
 * the finger uses, so zooming out covers more ground per keystroke — which is
 * what a player expects, because that is what dragging does.
 */
export const KEY_PAN_SPEED = 900;
/** Multiplier while shift is held. Crossing the map should take seconds. */
export const KEY_SPRINT = 2.6;
/** Radians a second for Q/E. */
export const KEY_ROTATE_SPEED = 1.5;
/** Zoom factor per second held. */
export const KEY_ZOOM_SPEED = 2.4;
/**
 * Longest frame the keys are paid for, in seconds.
 *
 * Guards against a returning tab flinging the camera across the map, and
 * nothing else. Deliberately loose — four frames a second — because a tight cap
 * quietly halves the pan speed on cheap phones, which are the devices that
 * needed the keys in the first place.
 */
export const KEY_MAX_FRAME_S = 0.25;

// --- Music -------------------------------------------------------------------
/**
 * Overall level of the music bus.
 *
 * Above the ambient bed and below the effects. Music a player has to turn down
 * is music they turn off, and turning the sound off costs you every other cue
 * the game has.
 */
export const MUSIC_GAIN = 0.16;
/** Beats per minute. Slow enough that a note is an event rather than a rhythm. */
export const MUSIC_TEMPO = 68;
/** How long a piece runs, in seconds, before the city goes quiet again. */
export const MUSIC_PIECE_S = 110;
/**
 * How long the quiet between pieces lasts.
 *
 * Longer than most players expect, and deliberately so. Continuous music stops
 * being heard within ten minutes; music that comes back is heard every time.
 */
export const MUSIC_REST_S = 150;

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
 * v5: the motorway's line changed shape (HIGHWAY_MIN_RUN), and the route is not
 * in the save — it is regenerated from the seed. So a v4 city loaded by this
 * build would keep its own streets and buildings and find the national road
 * somewhere else entirely: interchanges gone, districts silently cut off, and
 * nothing on screen to say why. Declining the file is the honest answer, the
 * same one v4 gave when the highway first arrived. Legacy points are held
 * separately and carry over either way.
 *
 * The rule this implies, for whoever changes the generator next: **touching
 * plotRoute means bumping this number.** The map is deliberately not in the
 * save, and that trade is only safe if the generator's output is treated as part
 * of the save format.
 */
export const SAVE_VERSION = 5;

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
