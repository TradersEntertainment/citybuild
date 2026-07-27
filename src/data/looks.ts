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
export type FacilityKind = ServiceKind | UtilityKind | PortKind;

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

export const FACILITY_LOOKS: Readonly<Record<FacilityKind, FacilityLook>> = {
  fire: { body: '#B9AFA3', accent: '#B03A2B', width: 0.78, height: 0.58, mast: 0.5 },
  health: { body: '#E2DED4', accent: '#3E86A8', width: 0.72, height: 0.5, mast: 0.34 },
  education: { body: '#D6CDB6', accent: '#8A6B2E', width: 0.86, height: 0.44, mast: 0.28 },
  police: { body: '#C2C6CB', accent: '#2E4A7A', width: 0.74, height: 0.52, mast: 0.44 },
  // Low, pale and wide, with nothing standing up off it: a cemetery should read
  // as ground rather than as a building, because that is what it is.
  cemetery: { body: '#C8CBBE', accent: '#7D8A6E', width: 0.9, height: 0.14, mast: 0.36 },
  // A yard: wide, low, drab, with a short stack. Nothing about a depot is meant
  // to be handsome, and a player scanning the map should read it as industry.
  depot: { body: '#8A8578', accent: '#4E6B3F', width: 0.92, height: 0.3, mast: 0.7 },
  // Infrastructure reads as heavier and squatter than a civic building, except
  // the chimneys — which are the tallest thing in a young city, and should be.
  well: { body: '#9FA9A4', accent: '#3E86A8', width: 0.6, height: 0.36, mast: 0.62 },
  waterworks: { body: '#93A0A6', accent: '#3E86A8', width: 0.94, height: 0.5, mast: 0.4 },
  coalPlant: { body: '#7C7671', accent: '#4A4441', width: 0.96, height: 0.72, mast: 1.5 },
  gasPlant: { body: '#8B8E92', accent: '#5B6166', width: 0.94, height: 0.66, mast: 1.1 },
  oilPlant: { body: '#6E6862', accent: '#8A5A24', width: 0.98, height: 0.7, mast: 1.35 },
  // A dam is wide and low with nothing on the roof: the wall *is* the building.
  hydroPlant: { body: '#A8AEB2', accent: '#2F7FA8', width: 1.05, height: 0.44, mast: 0 },
  // Panels, so: flat, broad, and dark. Nothing to see above the fence.
  solarFarm: { body: '#3A4450', accent: '#5FA8D8', width: 1.05, height: 0.16, mast: 0 },
  // The cooling tower is the silhouette, and it should be the tallest thing for
  // miles — a reactor is the last building a city ever builds.
  nuclearPlant: { body: '#D9DBD6', accent: '#5FB48A', width: 1.05, height: 0.8, mast: 2.4 },
  // The waterfront. Low sheds and tall thin masts: a crane is the one thing on
  // a coast you can see from the other side of the bay, which is exactly what a
  // player wants of a building they have to find the shoreline for.
  fishing: { body: '#8E7654', accent: '#C9793B', width: 0.66, height: 0.34, mast: 0.5 },
  cargo: { body: '#8D9297', accent: '#E0A32E', width: 0.98, height: 0.46, mast: 1.7 },
  shipyard: { body: '#6F757A', accent: '#B24C3A', width: 1, height: 0.6, mast: 2 },
  marina: { body: '#E8E6DF', accent: '#2F7FA8', width: 0.62, height: 0.3, mast: 1.3 },
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
