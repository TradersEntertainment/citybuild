import * as THREE from 'three';
import type { BuiltZone } from '../data/buildings';
import type { Building } from '../sim/buildings';
import type { GameState } from '../sim/state';
import { archetypeFor, periodOf, type Archetype, type Period } from './archetypes';
import { createEmissiveTexture, createFacadeTexture } from './facade';
import { sampleHeight } from './terrain';

/**
 * The city itself: one InstancedMesh per (period, zone, level) archetype —
 * fifteen draw calls for however many thousand buildings stand in a given era.
 * Per-building meshes are what kill a city builder on a phone, so instancing is
 * not an optimisation here; it is the only reason the scene can hold a
 * metropolis at all.
 *
 * Buckets are made the first time something needs them rather than up front.
 * Three periods would otherwise cost forty-five meshes and ninety generated
 * textures at start-up, most of them for buildings the player will not see for
 * an hour — and a settlement should pay for a settlement.
 */
const ZONES: readonly BuiltZone[] = ['res', 'com', 'ind'];
const PERIOD_SALT: Record<Period, number> = { early: 0, industrial: 61, modern: 127 };
const INITIAL_CAPACITY = 256;

/** Storey height in world units, used to scale facade UVs so windows stay put. */
const STOREY = 0.16;

interface Bucket {
  mesh: THREE.InstancedMesh;
  capacity: number;
  count: number;
}

export interface BuildingMeshes {
  readonly group: THREE.Group;
  /** Re-writes every instance matrix from sim state. Call once per frame. */
  sync(state: GameState, now: number): void;
  /** Dusk lighting: fades the lit-window emissive in and out. */
  setNightFactor(factor: number): void;
  dispose(): void;
}

export function createBuildings(): BuildingMeshes {
  const group = new THREE.Group();
  group.name = 'buildings';

  const buckets = new Map<string, Bucket>();
  const materials: THREE.MeshStandardMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  let nightFactor = 0;

  const makeBucket = (
    period: Period,
    zone: BuiltZone,
    level: number,
    capacity: number,
  ): Bucket => {
    const spec = archetypeFor(period, zone, level);
    const salt = PERIOD_SALT[period] + ZONES.indexOf(zone) * 11 + level;

    const facadeMap = createFacadeTexture(spec.facade, salt);
    const emissiveMap = createEmissiveTexture(spec.facade, salt);
    textures.push(facadeMap, emissiveMap);

    const facadeMaterial = new THREE.MeshStandardMaterial({
      map: facadeMap,
      emissiveMap,
      emissive: new THREE.Color('#FFD9A0'),
      // A bucket built after dusk has to arrive already lit; starting at zero
      // would leave a whole district dark until the next sunset.
      emissiveIntensity: nightFactor,
      roughness: period === 'modern' && zone === 'com' ? 0.32 : 0.76,
      metalness: period === 'modern' && zone === 'com' ? 0.28 : 0.04,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: spec.roof,
      roughness: 0.88,
      metalness: 0.05,
    });
    materials.push(facadeMaterial, roofMaterial);

    const geometry = buildArchetypeGeometry(spec);
    geometries.push(geometry);

    // Two material groups let one instanced mesh carry a facade on the walls and
    // tile or asphalt on the roof, which is most of the difference between a
    // building and a textured cube.
    const mesh = new THREE.InstancedMesh(geometry, [facadeMaterial, roofMaterial], capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances span the map; the bounds would be the map
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    return { mesh, capacity, count: 0 };
  };

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  const sync = (game: GameState, now: number): void => {
    void now;
    for (const bucket of buckets.values()) bucket.count = 0;

    // One period is live at a time. The others keep their meshes — an era does
    // not go backwards, but a save loaded mid-session can start anywhere — and
    // are simply drawn with no instances.
    const period = periodOf(game.era);

    for (const building of game.buildings.values()) {
      const key = `${period}:${building.zone}:${building.level}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = makeBucket(period, building.zone, building.level, INITIAL_CAPACITY);
        buckets.set(key, bucket);
      }
      if (bucket.count >= bucket.capacity) {
        bucket = growBucket(group, bucket, () =>
          makeBucket(period, building.zone, building.level, bucket!.capacity * 2),
        );
        buckets.set(key, bucket);
      }

      const spec = archetypeFor(period, building.zone, building.level);
      const rise = riseFactor(building, game.playedMs);
      if (rise <= 0) continue;

      // Seeded offsets: a row of identical buildings on identical centres is
      // the tell that a city was generated rather than grown.
      const jitterX = (hashUnit(building.x, building.y, 11) - 0.5) * (1 - spec.footprint) * 0.8;
      const jitterY = (hashUnit(building.x, building.y, 13) - 0.5) * (1 - spec.footprint) * 0.8;
      const ground = sampleHeight(game.world, building.x + 0.5, building.y + 0.5);

      position.set(building.x + 0.5 + jitterX, ground, building.y + 0.5 + jitterY);
      quaternion.setFromAxisAngle(
        axis,
        Math.round(hashUnit(building.x, building.y, 17) * 4) * (Math.PI / 2),
      );
      const wobble = 0.92 + hashUnit(building.x, building.y, 19) * 0.16;
      scale.set(wobble, rise * wobble, wobble);
      matrix.compose(position, quaternion, scale);
      bucket.mesh.setMatrixAt(bucket.count, matrix);
      bucket.count++;
    }

    for (const bucket of buckets.values()) {
      bucket.mesh.count = bucket.count;
      // Hidden rather than merely emptied. An instanced mesh with no instances
      // issues no GL draw, but it still costs a program bind and a uniform
      // upload every frame — and after two era changes thirty of them are
      // standing about with nothing in them.
      bucket.mesh.visible = bucket.count > 0;
      bucket.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const setNightFactor = (factor: number): void => {
    nightFactor = factor;
    for (const material of materials) {
      if (material.emissiveMap) material.emissiveIntensity = factor;
    }
  };

  return {
    group,
    sync,
    setNightFactor,
    dispose: () => {
      for (const bucket of buckets.values()) bucket.mesh.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const texture of textures) texture.dispose();
      group.clear();
    },
  };
}

/**
 * Grows a bucket that filled up. Districts arrive in bursts, so the capacity
 * doubles rather than creeping — a linear grow would rebuild the mesh on almost
 * every spawn wave.
 */
function growBucket(group: THREE.Group, old: Bucket, make: () => Bucket): Bucket {
  group.remove(old.mesh);
  old.mesh.dispose();
  return make();
}

/**
 * A building, as geometry: four walls, a floor, and a roof that is either flat
 * or pitched. Origin on the ground so scaling Y makes it rise out of the
 * terrain rather than grow from its own middle, and wall UVs scaled to the real
 * size so a window is the same size on a cottage and on a tower.
 *
 * Two material groups — walls then roof — rather than the box's own six, so the
 * pitched case can add faces without the group indices going out of step.
 */
export function buildArchetypeGeometry(spec: Archetype): THREE.BufferGeometry {
  const h = spec.footprint / 2;
  const top = spec.height;
  const positions: number[] = [];
  const uvs: number[] = [];

  const across = Math.max(1, Math.round(spec.footprint / (STOREY * 1.6)));
  const up = Math.max(1, Math.round(top / STOREY));

  /** One wall, wound so its outward face points away from the building. */
  const wall = (x0: number, z0: number, x1: number, z1: number): void => {
    positions.push(x0, 0, z0, x1, 0, z1, x1, top, z1);
    positions.push(x0, 0, z0, x1, top, z1, x0, top, z0);
    uvs.push(0, 0, across, 0, across, up, 0, 0, across, up, 0, up);
  };

  wall(-h, h, h, h); // +z
  wall(h, h, h, -h); // +x
  wall(h, -h, -h, -h); // -z
  wall(-h, -h, -h, h); // -x

  const wallVertices = positions.length / 3;

  // The roof, in its own group. A flat roof is one quad; a pitched one is two
  // slopes meeting at a ridge, with a gable triangle closing each end.
  if (spec.roofPitch <= 0) {
    quad(positions, uvs, [-h, top, -h], [-h, top, h], [h, top, h], [h, top, -h]);
  } else {
    const ridge = top + spec.roofPitch;
    // Slopes run along z, so the ridge line is the building's long axis. Wound
    // so each face's normal points away from the roof: the −x slope leans −x
    // and up, the +x slope +x and up.
    quad(positions, uvs, [-h, top, -h], [-h, top, h], [0, ridge, h], [0, ridge, -h]);
    quad(positions, uvs, [h, top, h], [h, top, -h], [0, ridge, -h], [0, ridge, h]);
    // Gables, facing out along z.
    triangle(positions, uvs, [-h, top, h], [h, top, h], [0, ridge, h]);
    triangle(positions, uvs, [h, top, -h], [-h, top, -h], [0, ridge, -h]);
  }

  // The underside, which shows on a slope steep enough to lift one corner.
  quad(positions, uvs, [-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.addGroup(0, wallVertices, 0);
  geometry.addGroup(wallVertices, positions.length / 3 - wallVertices, 1);
  return geometry;
}

type Point = readonly [number, number, number];

function quad(out: number[], uvs: number[], a: Point, b: Point, c: Point, d: Point): void {
  triangle(out, uvs, a, b, c);
  triangle(out, uvs, a, c, d);
}

function triangle(out: number[], uvs: number[], a: Point, b: Point, c: Point): void {
  out.push(...a, ...b, ...c);
  uvs.push(0, 0, 1, 0, 1, 1);
}

/**
 * The spring a building rides in on (§14.5). Delay comes from the building's
 * own seed rather than a queue, so a hundred arriving together ripple instead
 * of popping in unison.
 */
function riseFactor(building: Building, playedMs: number): number {
  const age = playedMs - building.builtAt;
  const delay = hashUnit(building.x, building.y, 3) * 700;
  if (age >= delay + 420) return 1;
  if (age < delay) return 0;
  const t = (age - delay) / 420;
  return 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.08 * (1 - t);
}

function hashUnit(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
