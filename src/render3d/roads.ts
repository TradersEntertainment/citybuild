import * as THREE from 'three';
import { decodeRoad, NONE, type RoadKind } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { ROAD_LIFT } from './constants';
import { sampleHeight } from './terrain';

/**
 * Road surfaces as geometry laid over the ground. A road tile becomes a quad
 * that takes its four heights from the terrain beneath it, so a road climbing a
 * hill climbs with it instead of hovering — the reason the surface is built
 * from the height field rather than dropped on a plane.
 *
 * Everything is merged into one geometry per pass and rebuilt when the road
 * column changes, which is rare and already has a hook (§18). Per-tile meshes
 * would be thousands of draw calls for a city that is mostly one flat colour.
 */
const SURFACE: Record<RoadKind, string> = {
  path: '#9A8560',
  stone: '#8E8A82',
  asphalt: '#3B3E44',
  boulevard: '#35383E',
  highway: '#303339',
  metro: '#4A4550',
};

/** Tiers that get painted markings and kerbs; a dirt track has neither. */
const MARKED: ReadonlySet<RoadKind> = new Set<RoadKind>([
  'asphalt',
  'boulevard',
  'highway',
]);

export interface RoadMesh {
  readonly group: THREE.Group;
  rebuild(): void;
  dispose(): void;
}

export function createRoads(world: World): RoadMesh {
  const group = new THREE.Group();
  group.name = 'roads';

  const surfaceMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02,
  });
  // Markings are unlit-ish and never shadowed: worn paint that still reads at
  // dusk, rather than a stripe that vanishes under a tower's shadow.
  const markingMaterial = new THREE.MeshStandardMaterial({
    color: '#D8D3C4',
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const surface = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial);
  surface.receiveShadow = true;
  surface.castShadow = false;
  const markings = new THREE.Mesh(new THREE.BufferGeometry(), markingMaterial);
  markings.receiveShadow = false;
  group.add(surface, markings);

  const rebuild = (): void => {
    surface.geometry.dispose();
    markings.geometry.dispose();
    const built = buildRoadGeometry(world);
    surface.geometry = built.surface;
    markings.geometry = built.markings;
  };

  rebuild();

  return {
    group,
    rebuild,
    dispose: () => {
      surface.geometry.dispose();
      markings.geometry.dispose();
      surfaceMaterial.dispose();
      markingMaterial.dispose();
      group.clear();
    },
  };
}

interface BuiltRoads {
  surface: THREE.BufferGeometry;
  markings: THREE.BufferGeometry;
}

function buildRoadGeometry(world: World): BuiltRoads {
  const positions: number[] = [];
  const colours: number[] = [];
  const markPositions: number[] = [];
  const colour = new THREE.Color();

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const kind = decodeRoad(world.road[index(world, x, y)] ?? NONE);
      if (!kind) continue;

      colour.set(SURFACE[kind]);
      // Slight per-tile tonal drift: a kilometre of identical asphalt looks
      // like a solid, not a surface.
      const drift = 1 + (hash2(x, y) - 0.5) * 0.09;
      pushTileQuad(positions, world, x, y, ROAD_LIFT);
      for (let v = 0; v < 6; v++) {
        colours.push(colour.r * drift, colour.g * drift, colour.b * drift);
      }

      // A smoothed stroke is 8-connected, so a diagonal run leaves tiles that
      // meet only at a corner — a road that visibly comes apart into diamonds.
      // Bridging that pinch point is what makes a drawn line read as a road.
      pushDiagonalBridges(positions, colours, world, x, y, colour, drift);

      if (MARKED.has(kind)) {
        pushMarking(markPositions, world, x, y, kind);
      }
    }
  }

  return {
    surface: toGeometry(positions, colours),
    markings: toGeometry(markPositions, null),
  };
}

/**
 * A tile-sized quad whose corners sit on the terrain. Full-tile rather than
 * inset: neighbouring road tiles then share an edge exactly, so a junction is
 * seamless without any special case for corners and crossings.
 */
function pushTileQuad(
  out: number[],
  world: World,
  x: number,
  y: number,
  lift: number,
): void {
  const h00 = sampleHeight(world, x, y) + lift;
  const h10 = sampleHeight(world, x + 1, y) + lift;
  const h01 = sampleHeight(world, x, y + 1) + lift;
  const h11 = sampleHeight(world, x + 1, y + 1) + lift;
  out.push(
    x, h00, y, x, h01, y + 1, x + 1, h10, y,
    x + 1, h10, y, x, h01, y + 1, x + 1, h11, y + 1,
  );
}

/**
 * Fills the corner where two diagonally adjacent road tiles meet and nothing
 * connects them orthogonally. Only the "outside" corner is filled — where an
 * orthogonal neighbour already paves the join, a bridge would just widen the
 * road for no reason.
 */
function pushDiagonalBridges(
  positions: number[],
  colours: number[],
  world: World,
  x: number,
  y: number,
  colour: THREE.Color,
  drift: number,
): void {
  // Only the two forward diagonals: the backward pair is handled when the tile
  // on the other side of the corner is visited.
  const diagonals: readonly [number, number][] = [
    [1, 1],
    [1, -1],
  ];
  for (const [dx, dy] of diagonals) {
    if (!isRoad(world, x + dx, y + dy)) continue;
    if (isRoad(world, x + dx, y) || isRoad(world, x, y + dy)) continue;

    const cornerX = dx > 0 ? x + 1 : x;
    const cornerY = dy > 0 ? y + 1 : y;
    const half = 0.42;
    pushQuad(
      positions,
      world,
      cornerX - half,
      cornerY - half,
      cornerX + half,
      cornerY + half,
      ROAD_LIFT,
    );
    for (let v = 0; v < 6; v++) {
      colours.push(colour.r * drift, colour.g * drift, colour.b * drift);
    }
  }
}

/**
 * Centre line, drawn only where the road actually runs straight through. At a
 * junction — or a bend, where a straight stripe would cut the corner — nothing
 * is drawn, which is also what real markings do.
 */
function pushMarking(out: number[], world: World, x: number, y: number, kind: RoadKind): void {
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
    pushQuad(out, world, x0, y0, x1, y1, lift);
  } else {
    const x0 = x + 0.5 - half;
    const x1 = x + 0.5 + half;
    const y0 = y + 0.16;
    const y1 = y + 0.84;
    pushQuad(out, world, x0, y0, x1, y1, lift);
  }
}

function pushQuad(
  out: number[],
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lift: number,
): void {
  const a = sampleHeight(world, x0, y0) + lift;
  const b = sampleHeight(world, x1, y0) + lift;
  const c = sampleHeight(world, x0, y1) + lift;
  const d = sampleHeight(world, x1, y1) + lift;
  out.push(x0, a, y0, x0, c, y1, x1, b, y0, x1, b, y0, x0, c, y1, x1, d, y1);
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
