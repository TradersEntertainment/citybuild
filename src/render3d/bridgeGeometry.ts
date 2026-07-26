import * as THREE from 'three';
import {
  BRIDGE_DECK_THICKNESS,
  BRIDGE_PARAPET_HEIGHT,
  BRIDGE_PIER_SPACING,
} from '../data/balance';
import { decodeRoad, NONE } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { HEIGHT_SCALE, ROAD_LIFT, ROAD_WIDTH } from './constants';
import { pushColouredBox, toMeshGeometry } from './boxMesh';
import { isBridgeTile, sampleDeck, type RoadDeck } from './roadDeck';

/**
 * What a bridge is made of.
 *
 * The deck itself is drawn by the road layer — it is road, and it takes its
 * height from the deck field. This adds the three things that make it read as a
 * structure rather than as tarmac hovering over a lake: a slab with an
 * underside, a parapet down each side, and piers standing on the bed.
 *
 * One merged geometry with vertex colours, rebuilt with the road mesh it belongs
 * to. Instancing would be the obvious choice for a few hundred boxes, but the
 * boxes are not congruent — every pier is a different length, because the bed
 * under it is a different depth — and a per-instance scale on a shared box gets
 * you the same triangles for more machinery.
 */
export interface BuiltBridges {
  geometry: THREE.BufferGeometry;
  /** How many tiles are carried, so the caller can skip an empty mesh. */
  tiles: number;
}

const CONCRETE = new THREE.Color('#8A8578');
const PARAPET = new THREE.Color('#B4AE9C');
const PIER = new THREE.Color('#6E6A60');

export function buildBridgeGeometry(world: World, deck: RoadDeck): BuiltBridges {
  const positions: number[] = [];
  const colours: number[] = [];
  let tiles = 0;

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      if (!isBridgeTile(world, x, y)) continue;
      const kind = decodeRoad(world.road[index(world, x, y)] ?? NONE);
      if (!kind) continue;
      tiles++;

      const top = deckTop(world, deck, x, y);
      const width = ROAD_WIDTH[kind] ?? 0.7;
      // The slab is wider than the carriageway: a bridge with no shoulder looks
      // like the cars are driving along a plank.
      const half = Math.min(0.5, width / 2 + 0.08);

      // The slab, hanging below the road surface the road layer draws.
      pushColouredBox(
        positions,
        colours,
        x + 0.5 - half,
        top - BRIDGE_DECK_THICKNESS,
        y + 0.5 - half,
        x + 0.5 + half,
        top,
        y + 0.5 + half,
        CONCRETE,
      );

      // Parapets run along the road, so they go on whichever pair of edges the
      // traffic is not crossing. A junction or a bend in the middle of a bridge
      // is rare enough that walling all four sides of it is the right answer:
      // better a stub of railing than a gap you can see the sea through.
      const alongX = isBridgeTile(world, x - 1, y) || isBridgeTile(world, x + 1, y);
      const alongY = isBridgeTile(world, x, y - 1) || isBridgeTile(world, x, y + 1);
      const rail = 0.07;
      if (alongX || !alongY) {
        parapet(positions, colours, x + 0.5 - half, x + 0.5 + half, y + 0.5 - half, rail, top, true);
        parapet(positions, colours, x + 0.5 - half, x + 0.5 + half, y + 0.5 + half, rail, top, true);
      }
      if (alongY || !alongX) {
        parapet(positions, colours, y + 0.5 - half, y + 0.5 + half, x + 0.5 - half, rail, top, false);
        parapet(positions, colours, y + 0.5 - half, y + 0.5 + half, x + 0.5 + half, rail, top, false);
      }

      // Piers on a diagonal lattice rather than a grid one.
      //
      // The grid version — both coordinates divisible by the spacing — visits
      // one tile in nine, which means a north-south crossing at the wrong x got
      // no piers whatsoever and hung in the air. Summing the coordinates gives a
      // lattice that any 4-connected run crosses every `spacing` tiles whichever
      // way it goes, and a crossing that bends does not restart its count and
      // put two piers side by side in the corner.
      if ((x + y) % BRIDGE_PIER_SPACING !== 0) continue;
      const bed = (world.height[index(world, x, y)] ?? 0) * HEIGHT_SCALE;
      pushColouredBox(
        positions,
        colours,
        x + 0.5 - 0.11,
        bed,
        y + 0.5 - 0.11,
        x + 0.5 + 0.11,
        top - BRIDGE_DECK_THICKNESS,
        y + 0.5 + 0.11,
        PIER,
      );
    }
  }

  return { geometry: toMeshGeometry(positions, colours), tiles };
}

/**
 * The road surface's own height at this tile, so the slab hangs off the thing
 * the player can see rather than off a number recomputed slightly differently.
 */
function deckTop(world: World, deck: RoadDeck, x: number, y: number): number {
  const corners = [
    sampleDeck(world, deck, x, y),
    sampleDeck(world, deck, x + 1, y),
    sampleDeck(world, deck, x, y + 1),
    sampleDeck(world, deck, x + 1, y + 1),
  ];
  return Math.min(...corners) + ROAD_LIFT;
}

/** One kerb rail, along x or along z. */
function parapet(
  positions: number[],
  colours: number[],
  from: number,
  to: number,
  at: number,
  thickness: number,
  top: number,
  alongX: boolean,
): void {
  const a = at - thickness / 2;
  const b = at + thickness / 2;
  if (alongX) pushColouredBox(positions, colours, from, top, a, to, top + BRIDGE_PARAPET_HEIGHT, b, PARAPET);
  else pushColouredBox(positions, colours, a, top, from, b, top + BRIDGE_PARAPET_HEIGHT, to, PARAPET);
}

