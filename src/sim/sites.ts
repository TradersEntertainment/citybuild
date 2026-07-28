import { SITE_SEARCH_RINGS, SITE_SIDE } from '../data/balance';
import { districtName } from '../data/districtNames';
import { createRng, hashSeed } from './rng';
import type { GameState } from './state';
import { decodeTerrain, decodeZone, NONE } from './tiles';
import { inBounds, index, startingCentre, type World } from './world';

/**
 * Goals with a *place* (§28) — saha görevleri.
 *
 * Every goal in the game so far measures the whole city: lay 24 tiles of road
 * anywhere, house 100,000 people anywhere, reach 70% on a report card that
 * counts the map entire. Not one has ever pointed at somewhere and said
 * **there**. That makes the chain a running commentary on a city the player was
 * going to build regardless — it never asks them to go anywhere in particular,
 * and a map with no places in it is a spreadsheet with hills.
 *
 * A site goal marks a square of the map and asks for something inside it. The
 * square is drawn on the ground and pulses, so it needs no explaining; the goal
 * completes when what stands inside it is what was asked for, and the marking
 * goes out.
 *
 * ## Where the square comes from
 *
 * Derived — never stored, never rolled at runtime. Same construction as the
 * lobbies and the elections and for the same reason: a reload must not move the
 * goalposts. Seed plus goal id fixes a direction, and the search then walks
 * outward from the city's own centre until it finds a patch of dry land big
 * enough.
 *
 * The walk matters more than it sounds. A square dropped in the sea is a goal
 * that cannot be completed, and an impossible goal in a chain the player trusts
 * is worse than no goal at all — so the search rejects wet squares and pushes
 * further out, and gives up honestly rather than marking water.
 *
 * ## What can be asked for
 *
 * Only things a player can do inside a boundary: paint, place, grow. Nothing
 * here asks a city-wide number to move, because every other goal already does
 * that, and a located goal completable from the far side of the map would be a
 * lie about its own square.
 */
export type SiteWant = 'park' | 'homes' | 'shops' | 'workshops' | 'service' | 'tall';

export interface SiteArea {
  /** Inclusive tile bounds. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * What to call it, from the same namer the neighbourhoods use
   * (data/districtNames.ts).
   *
   * Reused rather than reinvented so a site the player is sent to is named the
   * way the district it becomes will be named — "Yeşiltepe" on the goal card
   * and "Yeşiltepe" on the map once houses stand there. A second naming scheme
   * would have made those two different places.
   */
  name: string;
}

/**
 * The square for a goal, or null when this map has nowhere to put one.
 *
 * Null is a real answer rather than a failure: on a map that is nearly all
 * water there may be no dry square near the city, and the caller drops the goal
 * rather than marking the sea.
 */
export function siteArea(state: GameState, id: string): SiteArea | null {
  const world = state.world;
  const centre = startingCentre(world);
  const rng = createRng((state.seed ^ hashSeed(`site:${id}`)) >>> 0);

  // A direction from the city's middle, so goals land in different quarters
  // rather than stacking on one field.
  const angle = rng.next() * Math.PI * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  for (let ring = 1; ring <= SITE_SEARCH_RINGS; ring++) {
    const reach = ring * SITE_SIDE;
    const cx = Math.round(centre.x + dx * reach);
    const cy = Math.round(centre.y + dy * reach);
    const half = Math.floor(SITE_SIDE / 2);
    const x0 = cx - half;
    const y0 = cy - half;
    const area = { x0, y0, x1: x0 + SITE_SIDE - 1, y1: y0 + SITE_SIDE - 1, name: '' };
    if (!isDry(world, area)) continue;
    // Named from where it is, so it is called the same thing every session.
    area.name = districtName(hashSeed(`${x0},${y0}`));
    return area;
  }
  return null;
}

/** Every tile in bounds and out of the water. */
function isDry(world: World, area: SiteArea): boolean {
  for (let y = area.y0; y <= area.y1; y++) {
    for (let x = area.x0; x <= area.x1; x++) {
      if (!inBounds(world, x, y)) return false;
      if (decodeTerrain(world.terrain[index(world, x, y)] ?? 0) === 'water') return false;
    }
  }
  return true;
}

export function isOnSite(area: SiteArea, x: number, y: number): boolean {
  return x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1;
}

/**
 * How much of what the goal wants stands inside the square.
 *
 * Counted off the same state everything else reads, so a site goal cannot be
 * completed any way other than by building inside the square — which is what
 * makes the pulsing boundary honest rather than decorative.
 */
export function countOnSite(state: GameState, area: SiteArea, want: SiteWant): number {
  const world = state.world;

  if (want === 'park') {
    let tiles = 0;
    for (let y = area.y0; y <= area.y1; y++) {
      for (let x = area.x0; x <= area.x1; x++) {
        if (!inBounds(world, x, y)) continue;
        if (decodeZone(world.zone[index(world, x, y)] ?? NONE) === 'park') tiles++;
      }
    }
    return tiles;
  }

  if (want === 'service') {
    let count = 0;
    for (const service of state.services.values()) {
      if (isOnSite(area, service.x, service.y)) count++;
    }
    return count;
  }

  let count = 0;
  for (const building of state.buildings.values()) {
    if (!isOnSite(area, building.x, building.y)) continue;
    if (want === 'homes' && building.zone === 'res') count++;
    else if (want === 'shops' && building.zone === 'com') count++;
    else if (want === 'workshops' && building.zone === 'ind') count++;
    // "Tall" asks for standing rather than for a kind: a site that grew up is
    // one the player made worth living in, whatever they zoned it.
    else if (want === 'tall' && building.level >= 3) count++;
  }
  return count;
}
