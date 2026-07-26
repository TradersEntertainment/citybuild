import { BRIDGE_CLEARANCE, BRIDGE_RAMP_DROP } from '../data/balance';
import { index, type World } from '../sim/world';
import { HEIGHT_SCALE, SEA_Y } from './constants';
import { NONE } from '../sim/tiles';

/**
 * How high a road sits, where that is not simply the ground.
 *
 * Every road quad used to take its corner heights straight from the height
 * field, which is right for the 99% of tarmac that lies on soil and badly wrong
 * for the rest: a road crossing water was drawn on the *seabed*, so the national
 * highway — which is laid across the whole map before anybody looks at it —
 * regularly ran along the bottom of a lake and surfaced on the far shore. The
 * game already charged six times the price for those tiles and called them
 * bridges. It just never built one.
 *
 * This produces a deck height per tile: the ground, except over water, where it
 * is the sea surface plus a clearance. The interesting part is the ramp. A hard
 * step at the shoreline would look worse than the drowning did, so the deck is
 * relaxed outward — each pass lets a tile pull its neighbours up to within one
 * ramp-drop of itself — which grows an approach out of the bridge in whatever
 * direction the road actually leaves, without anything having to know which
 * direction that is.
 *
 * The relaxation deliberately runs over water and bare ground as well as roads.
 * Corner heights are the average of the four tiles around them, so a bridge in
 * open water whose neighbours were still at seabed level would have all four
 * corners dragged back under the surface.
 */

/** Deck height per tile, in world units — already scaled, unlike `height`. */
export type RoadDeck = Float32Array;

/** How many relaxation passes reach far enough to hide the step. */
const RAMP_PASSES = Math.ceil(BRIDGE_CLEARANCE / BRIDGE_RAMP_DROP) + 1;

export function buildRoadDeck(world: World): RoadDeck {
  const size = world.size;
  const deck = new Float32Array(size * size);

  for (let i = 0; i < deck.length; i++) {
    deck[i] = (world.height[i] ?? 0) * HEIGHT_SCALE;
  }

  // The bridges themselves: a road tile standing in water gets a deck over it.
  let bridges = 0;
  for (let i = 0; i < deck.length; i++) {
    if ((world.road[i] ?? NONE) === NONE) continue;
    if ((deck[i] as number) >= SEA_Y) continue;
    deck[i] = SEA_Y + BRIDGE_CLEARANCE;
    bridges++;
  }
  // Nothing crosses water on this map: the deck is the ground, and the caller
  // can skip every bridge query for the rest of the rebuild.
  if (bridges === 0) return deck;

  const previous = new Float32Array(deck.length);
  for (let pass = 0; pass < RAMP_PASSES; pass++) {
    previous.set(deck);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = index(world, x, y);
        let highest = previous[i] as number;
        if (x > 0) highest = Math.max(highest, previous[i - 1] as number);
        if (x < size - 1) highest = Math.max(highest, previous[i + 1] as number);
        if (y > 0) highest = Math.max(highest, previous[i - size] as number);
        if (y < size - 1) highest = Math.max(highest, previous[i + size] as number);
        // Only ever raised. A ramp climbs to meet a bridge; it never digs a
        // trench to meet the ground.
        deck[i] = Math.max(deck[i] as number, highest - BRIDGE_RAMP_DROP);
      }
    }
  }

  return deck;
}

/**
 * Deck height at a point, bilinear across tile centres.
 *
 * Deliberately the same sampling as the terrain's own, corner for corner, so a
 * road that is not on a bridge lands exactly where it always did and the two
 * surfaces cannot disagree by a hair and z-fight.
 */
export function sampleDeck(world: World, deck: RoadDeck, tileX: number, tileY: number): number {
  const maxIndex = world.size - 1;
  const fx = clamp(tileX - 0.5, 0, maxIndex);
  const fy = clamp(tileY - 0.5, 0, maxIndex);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(maxIndex, x0 + 1);
  const y1 = Math.min(maxIndex, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const h00 = deck[index(world, x0, y0)] ?? 0;
  const h10 = deck[index(world, x1, y0)] ?? 0;
  const h01 = deck[index(world, x0, y1)] ?? 0;
  const h11 = deck[index(world, x1, y1)] ?? 0;

  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return top + (bottom - top) * ty;
}

/**
 * The deck for a world, built once and kept.
 *
 * Every layer that follows a road needs this — the vehicles, the walkers, the
 * lampposts — and none of them should each grow a parameter for it. The road
 * mesh's own rebuild refreshes the cache (see `cacheRoadDeck`), which is exactly
 * the moment the answer can have changed, because the deck is a pure function of
 * the road column and the ground.
 */
let cache: { world: World; deck: RoadDeck } | null = null;

export function roadDeckOf(world: World): RoadDeck {
  if (cache && cache.world === world) return cache.deck;
  const deck = buildRoadDeck(world);
  cache = { world, deck };
  return deck;
}

/** Called by the road mesh with the deck it has just built. */
export function cacheRoadDeck(world: World, deck: RoadDeck): void {
  cache = { world, deck };
}

/**
 * Height of the road surface at a point — the ground where there is no bridge.
 *
 * The drop-in replacement for `sampleHeight` in any layer that sits *on* the
 * tarmac. A layer that sits on the soil should keep using the terrain's own.
 */
export function sampleRoadHeight(world: World, x: number, y: number): number {
  return sampleDeck(world, roadDeckOf(world), x, y);
}

/** True where this road tile is carried over water rather than laid on ground. */
export function isBridgeTile(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  const i = index(world, x, y);
  if ((world.road[i] ?? NONE) === NONE) return false;
  return (world.height[i] ?? 0) * HEIGHT_SCALE < SEA_Y;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
