import * as THREE from 'three';
import { decodeRoad, NONE, type RoadKind } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { ROAD_LIFT, ROAD_WIDTH } from './constants';
import { WAY, wayAt, wayStep, type Way } from '../sim/oneWay';
import { buildRoadDeck, cacheRoadDeck, sampleDeck, type RoadDeck } from './roadDeck';

/**
 * Turning the road column into triangles.
 *
 * Split from the mesh wiring because this is where all the judgement is: what
 * shape a tile is paved as, where a corner needs bridging, and how a run that
 * climbs a diagonal is made to look like a road rather than a staircase of
 * squares. The layer above it only owns two meshes and two materials.
 */
export interface BuiltRoads {
  surface: THREE.BufferGeometry;
  markings: THREE.BufferGeometry;
  /**
   * The height each tile's road sits at — the ground almost everywhere, a
   * bridge deck over water. Handed back so the bridge layer hangs its slabs and
   * piers off exactly the surface the player can see (see roadDeck.ts).
   */
  deck: RoadDeck;
}

const SURFACE: Record<RoadKind, string> = {
  path: '#9A8560',
  stone: '#8E8A82',
  asphalt: '#3B3E44',
  boulevard: '#35383E',
  highway: '#303339',
  metro: '#4A4550',
};

/** Tiers that get painted markings and kerbs; a dirt track has neither. */
const MARKED: ReadonlySet<RoadKind> = new Set<RoadKind>(['asphalt', 'boulevard', 'highway']);

/** What a chewed-up motorway tends toward: rubble and the earth beneath it. */
const BROKEN = new THREE.Color('#6B5A45');
/** Damage past which the lane markings are simply gone. */
const MARKINGS_GONE = 0.6;

/**
 * How a tile is paved. Worked out for the whole map first, because both the
 * surface and the corner bridges need to know what the *neighbour* is doing —
 * a bridge between two tiles that are each already drawing a diagonal ribbon
 * would lay a patch over a join that is solid.
 */
export const SHAPE = {
  none: 0,
  /** Axis-aligned: a straight run, a bend, a junction or a stub. */
  square: 1,
  /** A ribbon along the ↗↙ diagonal. */
  rising: 2,
  /** A ribbon along the ↘↖ diagonal. */
  falling: 3,
} as const;

/**
 * A road drawn tile by tile climbs a diagonal as a staircase of squares joined
 * at their corners, which is exactly what the player's finger did not do. A
 * tile whose only neighbours are two opposite diagonals is therefore paved as a
 * ribbon corner to corner instead — one straight band across the tile, at the
 * tier's own width, meeting its neighbours end to end.
 *
 * Only the pure case qualifies. Anything touching the orthogonal grid is a
 * junction or a bend and keeps its square, because that is where a real road
 * spreads out too, and because a mitre there would need to know about three
 * tiles at once.
 */
export function classifyRoads(world: World): Uint8Array {
  const shapes = new Uint8Array(world.size * world.size);

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);
      if ((world.road[i] ?? NONE) === NONE) continue;

      const orthogonal =
        isRoad(world, x - 1, y) ||
        isRoad(world, x + 1, y) ||
        isRoad(world, x, y - 1) ||
        isRoad(world, x, y + 1);
      if (orthogonal) {
        shapes[i] = SHAPE.square;
        continue;
      }

      const rising = isRoad(world, x + 1, y + 1) && isRoad(world, x - 1, y - 1);
      const falling = isRoad(world, x + 1, y - 1) && isRoad(world, x - 1, y + 1);
      // A tile on both diagonals is a crossing, not a run.
      if (rising && !falling) shapes[i] = SHAPE.rising;
      else if (falling && !rising) shapes[i] = SHAPE.falling;
      else shapes[i] = SHAPE.square;
    }
  }

  return shapes;
}

export function buildRoadGeometry(world: World): BuiltRoads {
  const positions: number[] = [];
  const colours: number[] = [];
  const markPositions: number[] = [];
  const colour = new THREE.Color();
  const shapes = classifyRoads(world);
  // Where the road is, vertically. Roads used to read the height field
  // directly, which drew every water crossing along the seabed; the deck is the
  // same field everywhere else and a bridge over water.
  const deck = buildRoadDeck(world);
  // Published for every other layer that rides on tarmac rather than on soil:
  // the vehicles, the walkers, the lampposts. This is the one moment the answer
  // can have changed, because roads have just been re-read.
  cacheRoadDeck(world, deck);

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const kind = decodeRoad(world.road[index(world, x, y)] ?? NONE);
      if (!kind) continue;
      const shape = shapes[index(world, x, y)] ?? SHAPE.square;

      colour.set(SURFACE[kind]);
      // Slight per-tile tonal drift: a kilometre of identical asphalt looks
      // like a solid, not a surface.
      const drift = 1 + (hash2(x, y) - 0.5) * 0.09;
      // A street that cannot reach the national highway leads nowhere, and is
      // drawn like it leads nowhere: faded, so the player reads the mistake
      // from the map rather than from a tooltip.
      const i = index(world, x, y);
      const blocked = (world.highwayBlocked[i] ?? 0) === 1;
      const reachable =
        ((world.highway[i] ?? 0) === 1 && !blocked) || (world.connected[i] ?? 0) === 1;
      const fade = reachable ? 1 : 0.55;
      // A stretch the convoys have chewed up: broken asphalt turning back
      // toward the earth under it, darkest where it is barricaded. The
      // damage column is only ever set on the motorway (sim/highwayWear.ts),
      // so this cannot touch the player's own pavement.
      const damage = (world.highwayDamage[i] ?? 0) / 255;
      if (damage > 0) {
        colour.lerp(BROKEN, Math.min(1, damage * 0.85));
        colour.multiplyScalar(1 - damage * 0.25);
      }
      const tint = (quads: number): void => {
        for (let v = 0; v < quads * 6; v++) {
          colours.push(colour.r * drift * fade, colour.g * drift * fade, colour.b * drift * fade);
        }
      };
      // Paint is the first thing to go. Dropping the stripe is what makes a
      // ruined stretch read as ruined from the map height rather than as a
      // slightly darker road.
      const painted = MARKED.has(kind) && damage < MARKINGS_GONE;

      // The arrows. Painted into the markings pass, so they get the same unlit
      // near-white the lane stripes do and read at dusk — a one-way street the
      // player cannot see the direction of is a rule they will break by accident.
      const way = wayAt(world, x, y);
      if (way !== WAY.both && damage < MARKINGS_GONE) {
        pushArrow(markPositions, world, deck, x, y, way);
      }

      if (shape === SHAPE.square) {
        pushCarriageway(positions, world, deck, x, y, kind);
        tint(1);
        // Where a square meets a square across a corner and nothing connects
        // them orthogonally, the corner still has to be bridged; a ribbon
        // reaches its own corners already.
        tint(pushDiagonalBridges(positions, world, deck, shapes, x, y));
        if (painted) pushMarking(markPositions, world, deck, x, y, kind);
        continue;
      }

      pushDiagonalRibbon(positions, world, deck, x, y, kind, shape === SHAPE.rising);
      tint(1);
      if (painted) {
        pushDiagonalMarking(markPositions, world, deck, x, y, kind, shape === SHAPE.rising);
      }
    }
  }

  return {
    surface: toGeometry(positions, colours),
    markings: toGeometry(markPositions, null),
    deck,
  };
}

/**
 * One tile of a diagonal run, as a band from corner to corner.
 *
 * The band runs a little past both corners so that consecutive tiles overlap
 * where they meet rather than touching at a single point: two rectangles that
 * share one vertex leave a pinch you can see through, and the overlap costs
 * nothing because the surfaces are the same colour at the same height.
 */
function pushDiagonalRibbon(
  out: number[],
  world: World,
  deck: RoadDeck,
  x: number,
  y: number,
  kind: RoadKind,
  rising: boolean,
): void {
  const half = (ROAD_WIDTH[kind] ?? 0.7) / 2;
  // The run's own corners: bottom-left to top-right, or top-left to bottom-right.
  const from = { x, y: rising ? y : y + 1 };
  const to = { x: x + 1, y: rising ? y + 1 : y };

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  // Half a width past each end, which is the amount that makes the join solid.
  const over = half;
  const ax = from.x - ux * over;
  const ay = from.y - uy * over;
  const bx = to.x + ux * over;
  const by = to.y + uy * over;

  const px = -uy * half;
  const py = ux * half;
  pushRibbonQuad(
    out,
    world,
    deck,
    [ax - px, ay - py],
    [ax + px, ay + py],
    [bx + px, by + py],
    [bx - px, by - py],
    ROAD_LIFT,
  );
}

/** A dash along a diagonal run, on every other tile like the straight one. */
function pushDiagonalMarking(
  out: number[],
  world: World,
  deck: RoadDeck,
  x: number,
  y: number,
  kind: RoadKind,
  rising: boolean,
): void {
  if (((x + y) & 1) === 0) return;
  const half = kind === 'highway' ? 0.045 : 0.035;
  const from = { x, y: rising ? y : y + 1 };
  const to = { x: x + 1, y: rising ? y + 1 : y };
  const ux = (to.x - from.x) / Math.SQRT2;
  const uy = (to.y - from.y) / Math.SQRT2;

  // Inset from both corners so the dashes read as dashes rather than a line.
  const trim = 0.3;
  const ax = from.x + ux * trim;
  const ay = from.y + uy * trim;
  const bx = to.x - ux * trim;
  const by = to.y - uy * trim;
  const px = -uy * half;
  const py = ux * half;
  pushRibbonQuad(
    out,
    world,
    deck,
    [ax - px, ay - py],
    [ax + px, ay + py],
    [bx + px, by + py],
    [bx - px, by - py],
    ROAD_LIFT + 0.02,
  );
}

/**
 * The paved part of one road tile.
 *
 * A straight run is narrowed to the tier's carriageway width so the road has
 * verges and reads as a road rather than a paved corridor a whole tile wide.
 * Junctions, bends and stubs keep the full tile: that is where a real road
 * spreads out anyway, and it means neighbouring tiles still meet edge to edge
 * with no gap to special-case.
 */
function pushCarriageway(
  out: number[],
  world: World,
  deck: RoadDeck,
  x: number,
  y: number,
  kind: RoadKind,
): void {
  const west = isRoad(world, x - 1, y);
  const east = isRoad(world, x + 1, y);
  const north = isRoad(world, x, y - 1);
  const south = isRoad(world, x, y + 1);
  const horizontal = west && east && !north && !south;
  const vertical = north && south && !west && !east;

  const width = ROAD_WIDTH[kind] ?? 0.7;
  const inset = (1 - width) / 2;
  const x0 = x + (vertical ? inset : 0);
  const x1 = x + 1 - (vertical ? inset : 0);
  const y0 = y + (horizontal ? inset : 0);
  const y1 = y + 1 - (horizontal ? inset : 0);
  pushQuad(out, world, deck, x0, y0, x1, y1, ROAD_LIFT);
}

/**
 * Fills the corner where two diagonally adjacent square tiles meet and nothing
 * connects them orthogonally. Where an orthogonal neighbour already paves the
 * join, a bridge would just widen the road for no reason — and where either
 * tile is a ribbon, the ribbon already reaches the corner.
 *
 * Returns how many quads it added, so the caller can colour them.
 */
function pushDiagonalBridges(
  positions: number[],
  world: World,
  deck: RoadDeck,
  shapes: Uint8Array,
  x: number,
  y: number,
): number {
  // Only the two forward diagonals: the backward pair is handled when the tile
  // on the other side of the corner is visited.
  const diagonals: readonly [number, number][] = [
    [1, 1],
    [1, -1],
  ];
  let added = 0;
  for (const [dx, dy] of diagonals) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
    if ((shapes[index(world, nx, ny)] ?? SHAPE.none) !== SHAPE.square) continue;
    if (isRoad(world, nx, y) || isRoad(world, x, ny)) continue;

    const cornerX = dx > 0 ? x + 1 : x;
    const cornerY = dy > 0 ? y + 1 : y;
    const half = 0.42;
    pushQuad(
      positions,
      world,
      deck,
      cornerX - half,
      cornerY - half,
      cornerX + half,
      cornerY + half,
      ROAD_LIFT,
    );
    added++;
  }
  return added;
}

/**
 * A chevron pointing the way traffic must go.
 *
 * Two thin bars meeting at a point rather than a triangle: at map height a solid
 * arrowhead on a 0.7-wide carriageway is a blob, and the chevron keeps a hole in
 * the middle that survives being a few pixels across. Repeated on every tile of
 * the run — a street signed once at its mouth is a street the player has to
 * remember, and this game does not ask anybody to remember anything.
 */
function pushArrow(
  out: number[],
  world: World,
  deck: RoadDeck,
  x: number,
  y: number,
  way: Way,
): void {
  // Only every other tile carries one, like the lane dashes: an unbroken line of
  // chevrons reads as a pattern rather than as a direction.
  if (((x + y) & 1) === 1) return;
  const { dx, dy } = wayStep(way);
  const cx = x + 0.5;
  const cy = y + 0.5;
  const lift = ROAD_LIFT + 0.025;
  // Along the direction of travel, and across it.
  const ax = dx;
  const ay = dy;
  const px = -dy;
  const py = dx;
  const reach = 0.22;
  const spread = 0.15;
  const bar = 0.035;

  // Each half of the chevron is a quad from the tip back along one diagonal.
  for (const side of [-1, 1]) {
    const tipX = cx + ax * reach;
    const tipY = cy + ay * reach;
    const tailX = cx - ax * reach * 0.4 + px * spread * side;
    const tailY = cy - ay * reach * 0.4 + py * spread * side;
    // Widen the bar perpendicular to its own run, not to the road.
    const runX = tailX - tipX;
    const runY = tailY - tipY;
    const length = Math.hypot(runX, runY) || 1;
    const offX = (-runY / length) * bar;
    const offY = (runX / length) * bar;
    pushRibbonQuad(
      out,
      world,
      deck,
      [tipX - offX, tipY - offY],
      [tailX - offX, tailY - offY],
      [tailX + offX, tailY + offY],
      [tipX + offX, tipY + offY],
      lift,
    );
  }
}

/**
 * Centre line, drawn only where the road actually runs straight through. At a
 * junction — or a bend, where a straight stripe would cut the corner — nothing
 * is drawn, which is also what real markings do.
 */
function pushMarking(
  out: number[],
  world: World,
  deck: RoadDeck,
  x: number,
  y: number,
  kind: RoadKind,
): void {
  const west = isRoad(world, x - 1, y);
  const east = isRoad(world, x + 1, y);
  const north = isRoad(world, x, y - 1);
  const south = isRoad(world, x, y + 1);
  const horizontal = west && east;
  const vertical = north && south;
  if (horizontal === vertical) return; // junction, stub or bend

  const lift = ROAD_LIFT + 0.02;
  const half = kind === 'highway' ? 0.045 : 0.035;
  // Dashes, not a continuous line: every other tile carries paint.
  if (((x + y) & 1) === 0) return;

  if (horizontal) {
    const y0 = y + 0.5 - half;
    const y1 = y + 0.5 + half;
    const x0 = x + 0.16;
    const x1 = x + 0.84;
    pushQuad(out, world, deck, x0, y0, x1, y1, lift);
  } else {
    const x0 = x + 0.5 - half;
    const x1 = x + 0.5 + half;
    const y0 = y + 0.16;
    const y1 = y + 0.84;
    pushQuad(out, world, deck, x0, y0, x1, y1, lift);
  }
}

function pushQuad(
  out: number[],
  world: World,
  deck: RoadDeck,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lift: number,
): void {
  const a = sampleDeck(world, deck, x0, y0) + lift;
  const b = sampleDeck(world, deck, x1, y0) + lift;
  const c = sampleDeck(world, deck, x0, y1) + lift;
  const d = sampleDeck(world, deck, x1, y1) + lift;
  out.push(x0, a, y0, x0, c, y1, x1, b, y0, x1, b, y0, x0, c, y1, x1, d, y1);
}

type Corner = readonly [number, number];

/**
 * A quad on arbitrary ground points rather than an axis-aligned rectangle, for
 * a band that runs at an angle. Corners are given in order around the shape;
 * the winding puts the face upward.
 */
function pushRibbonQuad(
  out: number[],
  world: World,
  deck: RoadDeck,
  a: Corner,
  b: Corner,
  c: Corner,
  d: Corner,
  lift: number,
): void {
  const at = (p: Corner): [number, number, number] => [
    p[0],
    sampleDeck(world, deck, p[0], p[1]) + lift,
    p[1],
  ];
  const [ax, ay, az] = at(a);
  const [bx, by, bz] = at(b);
  const [cx, cy, cz] = at(c);
  const [dx, dy, dz] = at(d);
  out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  out.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
}

function isRoad(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  return (world.road[index(world, x, y)] ?? NONE) !== NONE;
}

function toGeometry(positions: number[], colours: number[] | null): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colours) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Deterministic 0..1 per tile, so the tonal drift never shimmers. */
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
