import * as THREE from 'three';
import type { BuiltZone } from '../data/buildings';
import type { Building } from '../sim/buildings';
import type { GameState } from '../sim/state';
import { createEmissiveTexture, createFacadeTexture, type FacadeOptions } from './facade';
import { sampleHeight } from './terrain';

/**
 * The city itself: one InstancedMesh per (zone, level) archetype, fifteen draw
 * calls for however many thousand buildings stand. Per-building meshes are what
 * kill a city builder on a phone, so instancing is not an optimisation here —
 * it is the only reason the scene can hold a metropolis at all.
 *
 * Archetype geometry and facades are built once at start-up. What changes per
 * frame is the instance matrix: position on the terrain, a seeded rotation, and
 * the spring the building rides in on.
 */
interface Archetype {
  /** Footprint side as a fraction of a tile. */
  footprint: number;
  /** Height in world units; one unit is one tile width. */
  height: number;
  roof: string;
  facade: FacadeOptions;
}

/** Storey height in world units, used to scale facade UVs so windows stay put. */
const STOREY = 0.16;

const ARCHETYPES: Record<BuiltZone, readonly Archetype[]> = {
  res: [
    arch(0.46, 0.34, '#7C4436', wall('#D8CDBA', '#5C6E78', 3, 2, 0.22, false)),
    arch(0.56, 0.55, '#7A4A3A', wall('#D2C4AC', '#576975', 4, 3, 0.26, false)),
    arch(0.68, 1.15, '#6E6A62', wall('#C6BCAC', '#4E6472', 5, 7, 0.3, true)),
    arch(0.78, 2.1, '#65625C', wall('#B9B4AA', '#46606F', 6, 13, 0.34, true)),
    arch(0.86, 3.6, '#5C5A56', wall('#A9AEB2', '#3E5C6E', 7, 22, 0.38, true)),
  ],
  com: [
    arch(0.44, 0.36, '#4A5A62', wall('#E0D9C8', '#3E6E86', 3, 2, 0.4, false)),
    arch(0.56, 0.72, '#44545E', wall('#D2CFC4', '#37687F', 4, 4, 0.44, true)),
    arch(0.68, 1.7, '#3C4C57', wall('#9FB0BA', '#2E6079', 6, 10, 0.5, true)),
    arch(0.8, 3.2, '#36454F', wall('#8FA6B4', '#275872', 7, 20, 0.55, true)),
    arch(0.88, 5.4, '#2F3E48', wall('#7E9BAD', '#1F5069', 8, 34, 0.6, true)),
  ],
  ind: [
    arch(0.48, 0.4, '#6B5347', wall('#B9A992', '#5A6258', 3, 2, 0.14, false)),
    arch(0.6, 0.62, '#63503F', wall('#AD9E88', '#555E54', 4, 3, 0.16, false)),
    arch(0.72, 0.95, '#5C5750', wall('#9E9B88', '#4F584F', 5, 4, 0.18, false)),
    arch(0.84, 1.35, '#55534E', wall('#96938A', '#4A534B', 6, 6, 0.2, false)),
    arch(0.92, 1.8, '#4E4D4A', wall('#8D8B84', '#455049', 7, 8, 0.22, false)),
  ],
};

function arch(
  footprint: number,
  height: number,
  roof: string,
  facade: FacadeOptions,
): Archetype {
  return { footprint, height, roof, facade };
}

function wall(
  wallColour: string,
  glass: string,
  columns: number,
  rows: number,
  lit: number,
  banded: boolean,
): FacadeOptions {
  return {
    wall: wallColour,
    glass,
    columns,
    rows,
    lit,
    litColour: '#FFE9BC',
    banded,
  };
}

const ZONES: readonly BuiltZone[] = ['res', 'com', 'ind'];
const INITIAL_CAPACITY = 256;

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

  const makeBucket = (zone: BuiltZone, level: number, capacity: number): Bucket => {
    const spec = ARCHETYPES[zone][level - 1] as Archetype;
    const salt = ZONES.indexOf(zone) * 11 + level;

    const facadeMap = createFacadeTexture(spec.facade, salt);
    const emissiveMap = createEmissiveTexture(spec.facade, salt);
    textures.push(facadeMap, emissiveMap);

    const facadeMaterial = new THREE.MeshStandardMaterial({
      map: facadeMap,
      emissiveMap,
      emissive: new THREE.Color('#FFD9A0'),
      emissiveIntensity: 0,
      roughness: zone === 'com' ? 0.32 : 0.76,
      metalness: zone === 'com' ? 0.28 : 0.04,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: spec.roof,
      roughness: 0.88,
      metalness: 0.05,
    });
    materials.push(facadeMaterial, roofMaterial);

    const geometry = buildArchetypeGeometry(spec);
    geometries.push(geometry);

    // Box groups let one instanced mesh carry a facade on the walls and a
    // different material on the roof, which is the whole difference between a
    // building and a textured cube.
    const mesh = new THREE.InstancedMesh(
      geometry,
      [facadeMaterial, facadeMaterial, roofMaterial, roofMaterial, facadeMaterial, facadeMaterial],
      capacity,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances span the map; the bounds would be the map
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    return { mesh, capacity, count: 0 };
  };

  for (const zone of ZONES) {
    for (let level = 1; level <= 5; level++) {
      buckets.set(`${zone}:${level}`, makeBucket(zone, level, INITIAL_CAPACITY));
    }
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  const sync = (game: GameState, now: number): void => {
    void now;
    for (const bucket of buckets.values()) bucket.count = 0;

    for (const building of game.buildings.values()) {
      const key = `${building.zone}:${building.level}`;
      let bucket = buckets.get(key);
      if (!bucket) continue;
      if (bucket.count >= bucket.capacity) {
        bucket = growBucket(group, bucket, makeBucket, building.zone, building.level);
        buckets.set(key, bucket);
      }

      const spec = ARCHETYPES[building.zone][building.level - 1] as Archetype;
      const rise = riseFactor(building, game.playedMs);
      if (rise <= 0) continue;

      // Seeded offsets: a row of identical buildings on identical centres is
      // the tell that a city was generated rather than grown.
      const jitterX = (hashUnit(building.x, building.y, 11) - 0.5) * (1 - spec.footprint) * 0.8;
      const jitterY = (hashUnit(building.x, building.y, 13) - 0.5) * (1 - spec.footprint) * 0.8;
      const ground = sampleHeight(game.world, building.x + 0.5, building.y + 0.5);

      position.set(building.x + 0.5 + jitterX, ground, building.y + 0.5 + jitterY);
      quaternion.setFromAxisAngle(axis, Math.round(hashUnit(building.x, building.y, 17) * 4) * (Math.PI / 2));
      const wobble = 0.92 + hashUnit(building.x, building.y, 19) * 0.16;
      scale.set(wobble, rise * wobble, wobble);
      matrix.compose(position, quaternion, scale);
      bucket.mesh.setMatrixAt(bucket.count, matrix);
      bucket.count++;
    }

    for (const bucket of buckets.values()) {
      bucket.mesh.count = bucket.count;
      bucket.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const setNightFactor = (factor: number): void => {
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
function growBucket(
  group: THREE.Group,
  old: Bucket,
  make: (zone: BuiltZone, level: number, capacity: number) => Bucket,
  zone: BuiltZone,
  level: number,
): Bucket {
  group.remove(old.mesh);
  old.mesh.dispose();
  return make(zone, level, old.capacity * 2);
}

/**
 * Box sized to the archetype, with its origin on the ground so scaling Y makes
 * a building rise out of the terrain rather than grow from its own middle.
 * UVs are scaled to the building's real size so a window is the same size on a
 * cottage and on a tower.
 */
function buildArchetypeGeometry(spec: Archetype): THREE.BufferGeometry {
  const w = spec.footprint;
  const h = spec.height;
  const geometry = new THREE.BoxGeometry(w, h, w);
  geometry.translate(0, h / 2, 0);

  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const across = Math.max(1, Math.round(w / (STOREY * 1.6)));
  const up = Math.max(1, Math.round(h / STOREY));
  // BoxGeometry lays out faces px, nx, py, ny, pz, nz with four vertices each;
  // only the four side faces want the storey grid.
  for (let face = 0; face < 6; face++) {
    const vertical = face === 2 || face === 3;
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      if (vertical) continue;
      uv.setXY(i, uv.getX(i) * across, uv.getY(i) * up);
    }
  }
  uv.needsUpdate = true;
  return geometry;
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
