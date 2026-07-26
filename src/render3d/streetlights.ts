import * as THREE from 'three';
import { yearOf } from '../sim/timeline';
import { decodeRoad, NONE, type RoadKind } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { LOD_DETAIL_DISTANCE, ROAD_LIFT } from './constants';
import { sampleHeight } from './terrain';

/**
 * Street lighting (Paket 1 §3).
 *
 * Two instanced meshes for the whole city: the posts, which are always there,
 * and the lamp heads, which glow. A night city without lit streets is a black
 * map with some windows on it — the lamps are what draw the road network after
 * dark, which matters here more than in most games because the road network is
 * the thing the player made.
 *
 * The lamps are era-tinted. A 1910 street burning cold white LED is the sort of
 * detail nobody names but everybody feels, and the timeline is already tracking
 * the year for the history panel, so it costs one lookup.
 */

/** Lamps are placed every Nth road tile, so a boulevard is not a runway. */
const SPACING = 3;
/** Tiers worth lighting. Nobody puts a lamp post on a dirt track. */
const LIT_TIERS: ReadonlySet<RoadKind> = new Set<RoadKind>([
  'stone',
  'asphalt',
  'boulevard',
  'highway',
]);
const POST_HEIGHT = 0.34;
const POST_RADIUS = 0.012;
/** How far the head reaches out from the post, toward the carriageway. */
const ARM = 0.09;

/**
 * What the light looked like, by year.
 *
 * Gas is orange and dim, the incandescent era is warm, sodium is the orange
 * every photograph of a 1980s city has, and LED is the cold white that replaced
 * it. Ordered newest last; the first entry whose year has not been reached wins.
 */
export interface Lamp {
  from: number;
  colour: string;
  intensity: number;
}
export const LAMPS: readonly Lamp[] = [
  { from: 0, colour: '#FFB25A', intensity: 0.55 },
  { from: 1930, colour: '#FFD9A0', intensity: 0.8 },
  { from: 1970, colour: '#FFA843', intensity: 1.0 },
  { from: 2005, colour: '#E8F0FF', intensity: 1.15 },
  { from: 2040, colour: '#CFE4FF', intensity: 1.3 },
];

export function lampFor(year: number): Lamp {
  let chosen = LAMPS[0] as Lamp;
  for (const lamp of LAMPS) if (year >= lamp.from) chosen = lamp;
  return chosen;
}

export interface StreetlightLayer {
  readonly group: THREE.Group;
  /** Re-places the lamps; call when the road column changes. */
  rebuild(): void;
  /**
   * Per-frame: fades the heads up at dusk and picks the era's colour.
   * `night` is 0..1 from the day cycle.
   */
  update(night: number, playedMs: number, cameraDistance: number): void;
  dispose(): void;
}

export function createStreetlights(world: World): StreetlightLayer {
  const group = new THREE.Group();
  group.name = 'streetlights';

  const postGeometry = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS * 1.4, POST_HEIGHT, 5);
  postGeometry.translate(0, POST_HEIGHT / 2, 0);
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#2E3238', roughness: 0.85 });

  // The head is emissive rather than a real light: a hundred point lights is a
  // hundred shadow-less forward passes, and at this camera distance a glowing
  // quad is indistinguishable from the real thing.
  const headGeometry = new THREE.SphereGeometry(0.032, 6, 4);
  const headMaterial = new THREE.MeshStandardMaterial({
    color: '#1A1D22',
    emissive: new THREE.Color('#FFB25A'),
    emissiveIntensity: 0,
    roughness: 0.4,
  });

  // The pool of light on the ground. One flat disc per lamp, additive, so a
  // street reads as lit rather than as a row of dots floating in the dark.
  const poolGeometry = new THREE.CircleGeometry(0.42, 10);
  poolGeometry.rotateX(-Math.PI / 2);
  const poolMaterial = new THREE.MeshBasicMaterial({
    color: '#FFB25A',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  let posts: THREE.InstancedMesh | null = null;
  let heads: THREE.InstancedMesh | null = null;
  let pools: THREE.InstancedMesh | null = null;

  const clear = (): void => {
    for (const mesh of [posts, heads, pools]) {
      if (!mesh) continue;
      group.remove(mesh);
      mesh.dispose();
    }
    posts = null;
    heads = null;
    pools = null;
  };

  const rebuild = (): void => {
    clear();

    // Collect first, then size the meshes: an InstancedMesh cannot grow, and
    // guessing a cap either wastes memory on a village or clips a metropolis.
    const sites: { x: number; y: number; offX: number; offY: number }[] = [];
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        const kind = decodeRoad(world.road[index(world, x, y)] ?? NONE);
        if (!kind || !LIT_TIERS.has(kind)) continue;
        // A stable, spread-out subset rather than every tile: the same hash the
        // rest of the project uses, so an edit elsewhere does not reshuffle the
        // lamps already standing.
        if ((x * 7 + y * 13) % SPACING !== 0) continue;

        // Set the lamp at the kerb, on whichever side has no road, so it does
        // not stand in the middle of its own carriageway.
        const side = pickKerb(world, x, y);
        if (!side) continue;
        sites.push({ x, y, offX: side.x, offY: side.y });
      }
    }

    if (sites.length === 0) return;

    posts = new THREE.InstancedMesh(postGeometry, postMaterial, sites.length);
    heads = new THREE.InstancedMesh(headGeometry, headMaterial, sites.length);
    pools = new THREE.InstancedMesh(poolGeometry, poolMaterial, sites.length);
    for (const mesh of [posts, heads, pools]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < sites.length; i++) {
      const site = sites[i] as (typeof sites)[number];
      const px = site.x + 0.5 + site.offX * 0.42;
      const py = site.y + 0.5 + site.offY * 0.42;
      const ground = sampleHeight(world, px, py) + ROAD_LIFT;

      position.set(px, ground, py);
      matrix.compose(position, quaternion, one);
      posts.setMatrixAt(i, matrix);

      // The head hangs over the road, which is the direction the kerb faced away
      // from — so the arm reaches back toward the carriageway.
      position.set(px - site.offX * ARM, ground + POST_HEIGHT, py - site.offY * ARM);
      matrix.compose(position, quaternion, one);
      heads.setMatrixAt(i, matrix);

      position.set(px - site.offX * ARM, ground + 0.012, py - site.offY * ARM);
      matrix.compose(position, quaternion, one);
      pools.setMatrixAt(i, matrix);
    }

    group.add(posts, heads, pools);
  };

  const update = (night: number, playedMs: number, cameraDistance: number): void => {
    if (!heads || !pools) return;
    // Posts are a few pixels across from the map view and the glow still reads
    // without them, so distance drops the geometry and keeps the light. Night
    // must not: a lit head with no post under it is a floating dot.
    const far = cameraDistance > LOD_DETAIL_DISTANCE;
    if (posts) posts.visible = !far;

    const lamp = lampFor(yearOf(playedMs));
    headMaterial.emissive.set(lamp.colour);
    headMaterial.emissiveIntensity = night * lamp.intensity * 2.4;
    poolMaterial.color.set(lamp.colour);
    // The pool is the expensive-looking part and the first thing to look wrong
    // if it lingers into daylight, so it fades faster than the head does.
    poolMaterial.opacity = night * night * 0.3 * lamp.intensity;
    heads.visible = night > 0.01;
    pools.visible = night > 0.05 && !far;
  };

  rebuild();

  return {
    group,
    rebuild,
    update,
    dispose: () => {
      clear();
      postGeometry.dispose();
      headGeometry.dispose();
      poolGeometry.dispose();
      postMaterial.dispose();
      headMaterial.dispose();
      poolMaterial.dispose();
      group.clear();
    },
  };
}

/**
 * Which way the kerb is: the first neighbouring direction that is not itself
 * road. Returns null for a tile hemmed in on all four sides, where there is no
 * kerb to stand on.
 */
function pickKerb(world: World, x: number, y: number): { x: number; y: number } | null {
  const options: readonly [number, number][] = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  for (const [dx, dy] of options) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
    if ((world.road[index(world, nx, ny)] ?? NONE) !== NONE) continue;
    return { x: dx, y: dy };
  }
  return null;
}
