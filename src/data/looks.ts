import type { AttractionKind } from './attractions';
import type { PortKind } from './ports';
import type { ServiceKind } from './services';
import type { UtilityKind } from './utilities';
import type { RoadKind } from '../sim/tiles';

/**
 * What things look like, as numbers rather than as meshes.
 *
 * This table used to live inside render3d/stations.ts, which was correct while
 * the map was the only thing that drew a karakol. It is not any more: the tool
 * sheet draws one too (ui/cards.ts), on a 2D canvas, and the whole point of the
 * menu card is that it cannot disagree with the thing the player is about to
 * build. Two copies of "a karakol is pale grey with a navy stripe" would drift
 * the first time either was touched.
 *
 * So it moved down here, beside the specs it describes. No three.js — a colour
 * and a size are data, and both drawings read them.
 */
export type FacilityKind = ServiceKind | UtilityKind | PortKind | AttractionKind;

export interface FacilityLook {
  /** Walls. */
  body: string;
  /** The stripe, the mast and the light on it: the kind's signature colour. */
  accent: string;
  /** Footprint as a fraction of a tile. */
  width: number;
  /** Height in world units, the same scale the archetypes use. */
  height: number;
  /** Mast or chimney above the roof; 0 for the ones with a flat silhouette. */
  mast: number;
}

/**
 * How much taller every facility stands than the table below says.
 *
 * The archetype tables were rescaled (render3d/archetypes.ts) because the city's
 * buildings were drawn far shorter than the world they stand in, and a station
 * left at its old height would simply have been overtaken by the housing around
 * it — a fire station shorter than the cottages it protects is not a landmark,
 * and finding one on the map is most of what these silhouettes are for.
 *
 * A flat lift rather than the archetypes' curve, and deliberately gentler than
 * the curve's low end. These are hand-placed buildings whose proportions carry
 * stated intent — a cemetery that reads as ground, a dam that is all wall, a
 * reactor that is the tallest thing for miles — and a curve steep enough to fix
 * a cottage would have turned the cemetery into a mausoleum and the TV mast into
 * a thing you cannot see past. At half again, the cemetery is still ground
 * (0.21) and the reactor is still the skyline.
 *
 * Widths are left alone: several are already at or over a whole tile, which is
 * as wide as anything in this game is allowed to be.
 */
const FACILITY_HEIGHT_GAIN = 1.5;

function look(body: string, accent: string, width: number, height: number, mast: number): FacilityLook {
  return {
    body,
    accent,
    width,
    height: height * FACILITY_HEIGHT_GAIN,
    mast: mast * FACILITY_HEIGHT_GAIN,
  };
}

export const FACILITY_LOOKS: Readonly<Record<FacilityKind, FacilityLook>> = {
  fire: look('#B9AFA3', '#B03A2B', 0.78, 0.58, 0.5),
  health: look('#E2DED4', '#3E86A8', 0.72, 0.5, 0.34),
  education: look('#D6CDB6', '#8A6B2E', 0.86, 0.44, 0.28),
  police: look('#C2C6CB', '#2E4A7A', 0.74, 0.52, 0.44),
  // Low, pale and wide, with nothing standing up off it: a cemetery should read
  // as ground rather than as a building, because that is what it is.
  cemetery: look('#C8CBBE', '#7D8A6E', 0.9, 0.14, 0.36),
  // A yard: wide, low, drab, with a short stack. Nothing about a depot is meant
  // to be handsome, and a player scanning the map should read it as industry.
  depot: look('#8A8578', '#4E6B3F', 0.92, 0.3, 0.7),
  // Infrastructure reads as heavier and squatter than a civic building, except
  // the chimneys — which are the tallest thing in a young city, and should be.
  well: look('#9FA9A4', '#3E86A8', 0.6, 0.36, 0.62),
  waterworks: look('#93A0A6', '#3E86A8', 0.94, 0.5, 0.4),
  coalPlant: look('#7C7671', '#4A4441', 0.96, 0.72, 1.5),
  gasPlant: look('#8B8E92', '#5B6166', 0.94, 0.66, 1.1),
  oilPlant: look('#6E6862', '#8A5A24', 0.98, 0.7, 1.35),
  // A dam is wide and low with nothing on the roof: the wall *is* the building.
  hydroPlant: look('#A8AEB2', '#2F7FA8', 1.05, 0.44, 0),
  // Panels, so: flat, broad, and dark. Nothing to see above the fence.
  solarFarm: look('#3A4450', '#5FA8D8', 1.05, 0.16, 0),
  // The cooling tower is the silhouette, and it should be the tallest thing for
  // miles — a reactor is the last building a city ever builds.
  nuclearPlant: look('#D9DBD6', '#5FB48A', 1.05, 0.8, 2.4),
  // The waterfront. Low sheds and tall thin masts: a crane is the one thing on
  // a coast you can see from the other side of the bay, which is exactly what a
  // player wants of a building they have to find the shoreline for.
  fishing: look('#8E7654', '#C9793B', 0.66, 0.34, 0.5),
  cargo: look('#8D9297', '#E0A32E', 0.98, 0.46, 1.7),
  shipyard: look('#6F757A', '#B24C3A', 1, 0.6, 2),
  marina: look('#E8E6DF', '#2F7FA8', 0.62, 0.3, 1.3),
  // Attractions read as occasions, not infrastructure: lighter bodies, warmer
  // accents, and the tallest silhouettes in the city short of a reactor —
  // a landmark the eye cannot find from across the map is not a landmark.
  hotel: look('#E4D6C2', '#C08A2E', 0.6, 0.9, 0.3),
  clockTower: look('#D8CDB6', '#C08A2E', 0.3, 1.1, 0.6),
  opera: look('#EDE8DC', '#8A5A8A', 0.95, 0.55, 0),
  stadium: look('#C9CDD2', '#3E8656', 1.1, 0.4, 0.9),
  tvTower: look('#B8BEC6', '#C4463A', 0.24, 1.6, 1.6),
  airport: look('#DDE0E4', '#2F7FA8', 1.15, 0.35, 1.2),
};

/** The carriageway, by tier. Read by the map's road mesh and by the menu card. */
export const ROAD_SURFACE: Readonly<Record<RoadKind, string>> = {
  path: '#9A8560',
  stone: '#8E8A82',
  asphalt: '#3B3E44',
  boulevard: '#35383E',
  highway: '#303339',
  metro: '#4A4550',
};

/** Tiers that get painted markings and kerbs; a dirt track has neither. */
export const ROAD_MARKED: ReadonlySet<RoadKind> = new Set<RoadKind>([
  'asphalt',
  'boulevard',
  'highway',
]);

/** The paint on a marked carriageway. */
export const ROAD_MARKING = '#D8D3C4';
