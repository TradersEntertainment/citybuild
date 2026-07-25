import { SEA_LEVEL, WORLD_SIZE } from '../data/balance';

/**
 * World scale for the 3D presentation.
 *
 * One tile is one world unit, so tile coordinates and scene coordinates differ
 * only in the vertical axis: tile (x, y) sits at scene (x, height, y). Keeping
 * that mapping trivial is what lets the tool layer go on speaking in tiles and
 * the picker hand back tile coordinates without a translation table.
 */
export const TILE = 1;

/** Height column 0..1 is stretched over this many units of relief. */
export const HEIGHT_SCALE = 26;

/** Scene-space Y of the water surface. */
export const SEA_Y = SEA_LEVEL * HEIGHT_SCALE;

/** Terrain is built as chunks so the GPU can frustum-cull a 256² map. */
export const CHUNK_TILES = 32;
export const CHUNKS_PER_SIDE = WORLD_SIZE / CHUNK_TILES;

// --- Camera ------------------------------------------------------------------
// The rig always looks down at the city; a free-flying camera is a way to get
// lost, not a way to build. Polar is clamped away from both the horizon (which
// shows the world's edge) and straight down (which throws away the skyline the
// whole 3D pivot is for).

/**
 * Distance from target at zoom 1; zoom scales this inversely. Tuned so the
 * default view frames a neighbourhood — close enough that a house is a house,
 * wide enough to see where the next road should go.
 */
export const CAMERA_BASE_DISTANCE = 52;
export const CAMERA_MIN_POLAR = 0.18; // ~10° off vertical: near top-down
export const CAMERA_MAX_POLAR = 1.28; // ~73°: low, skyline-heavy
export const CAMERA_DEFAULT_POLAR = 0.86; // ~49°: the default three-quarter view
export const CAMERA_FOV = 45;
export const CAMERA_NEAR = 0.5;
export const CAMERA_FAR = 1400;

// --- Level of detail ---------------------------------------------------------
// Distances are in world units from the camera target.

/** Beyond this, buildings drop their window/detail material. */
export const LOD_DETAIL_DISTANCE = 170;
/** Beyond this, cars stop being drawn at all — they are pixels by then. */
export const LOD_TRAFFIC_DISTANCE = 220;

// --- Roads -------------------------------------------------------------------

/** Road surface sits this far above the terrain to beat z-fighting. */
export const ROAD_LIFT = 0.12;
/** Fraction of a tile the carriageway covers, per road tier. */
export const ROAD_WIDTH: Record<string, number> = {
  path: 0.4,
  stone: 0.55,
  asphalt: 0.7,
  boulevard: 0.86,
  highway: 0.94,
  metro: 0.7,
};

export { SEA_LEVEL, WORLD_SIZE };
