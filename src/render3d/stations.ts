import * as THREE from 'three';
import { FACILITY_LOOKS, type FacilityKind } from '../data/looks';
import { PORT_ORDER } from '../data/ports';
import { SERVICE_ORDER } from '../data/services';
import { UTILITY_ORDER } from '../data/utilities';
import type { GameState } from '../sim/state';
import { sampleHeight } from './terrain';

/**
 * Service buildings on the map.
 *
 * These are the only structures the player places by hand, so they have to be
 * findable at a glance among a thousand grown ones. Each kind gets its own
 * silhouette and a mast in its own colour: a station reads as civic
 * infrastructure from across the district rather than as one more block.
 */

/** The shared table, in data/looks.ts — the menu card draws from the same one. */
const LOOKS = FACILITY_LOOKS;

const FACILITY_ORDER: readonly FacilityKind[] = [
  ...SERVICE_ORDER,
  ...UTILITY_ORDER,
  ...PORT_ORDER,
];

const INITIAL_CAPACITY = 32;

/**
 * The look of one facility kind: two geometries and the two materials on them.
 *
 * Separate from the bucket for the same reason as in render3d/buildings.ts, and
 * because of the same bug. A bucket that outgrows its capacity is replaced by a
 * bigger one, and rebuilding the shape to do it leaked both geometries and both
 * materials every time — disposed of nothing, and appended to arrays drained
 * only at teardown, so neither the GPU nor the collector could take them back.
 * A kind's shape does not depend on how many of it the player has built.
 */
interface Kit {
  bodyGeometry: THREE.BufferGeometry;
  bodyMaterial: THREE.MeshStandardMaterial;
  mastGeometry: THREE.BufferGeometry;
  mastMaterial: THREE.MeshStandardMaterial;
}

interface Bucket {
  body: THREE.InstancedMesh;
  mast: THREE.InstancedMesh;
  capacity: number;
  kit: Kit;
}

export interface StationLayer {
  readonly group: THREE.Group;
  /** Re-places every station. Called when one is built or removed. */
  rebuild(state: GameState): void;
  dispose(): void;
}

export function createStations(): StationLayer {
  const group = new THREE.Group();
  group.name = 'stations';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const buckets = new Map<FacilityKind, Bucket>();

  const makeKit = (kind: FacilityKind): Kit => {
    const look = LOOKS[kind];

    const bodyGeometry = new THREE.BoxGeometry(look.width, look.height, look.width);
    bodyGeometry.translate(0, look.height / 2, 0);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: look.body,
      roughness: 0.72,
      metalness: 0.04,
    });

    // A tapered mast rather than a box: nothing else in the city is a spike, so
    // the eye finds it immediately.
    const mastGeometry = new THREE.ConeGeometry(0.09, Math.max(0.08, look.mast), 5);
    mastGeometry.translate(0, look.height + look.mast / 2, 0);
    const mastMaterial = new THREE.MeshStandardMaterial({
      color: look.accent,
      emissive: new THREE.Color(look.accent),
      emissiveIntensity: 0.18,
      roughness: 0.5,
    });

    geometries.push(bodyGeometry, mastGeometry);
    materials.push(bodyMaterial, mastMaterial);
    return { bodyGeometry, bodyMaterial, mastGeometry, mastMaterial };
  };

  const makeBucket = (kit: Kit, capacity: number): Bucket => {
    const body = new THREE.InstancedMesh(kit.bodyGeometry, kit.bodyMaterial, capacity);
    const mast = new THREE.InstancedMesh(kit.mastGeometry, kit.mastMaterial, capacity);
    for (const mesh of [body, mast]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      group.add(mesh);
    }
    return { body, mast, capacity, kit };
  };

  for (const kind of FACILITY_ORDER) buckets.set(kind, makeBucket(makeKit(kind), INITIAL_CAPACITY));

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  const counts = new Map<FacilityKind, number>();

  const rebuild = (state: GameState): void => {
    for (const kind of FACILITY_ORDER) counts.set(kind, 0);

    const standing = [
      ...state.services.values(),
      ...state.utilities.values(),
      ...state.ports.values(),
    ];
    for (const station of standing) {
      let bucket = buckets.get(station.kind);
      if (!bucket) continue;
      const used = counts.get(station.kind) ?? 0;
      if (used >= bucket.capacity) {
        const grown = makeBucket(bucket.kit, bucket.capacity * 2);
        // The stations already placed this pass, carried over. `used` keeps
        // counting from where it was, so without this the ones written before
        // the doubling stay at the identity matrix and the whole set of them
        // stacks up on tile zero until the next rebuild.
        grown.body.instanceMatrix.array.set(bucket.body.instanceMatrix.array);
        grown.mast.instanceMatrix.array.set(bucket.mast.instanceMatrix.array);
        group.remove(bucket.body, bucket.mast);
        bucket.body.dispose();
        bucket.mast.dispose();
        bucket = grown;
        buckets.set(station.kind, bucket);
      }

      const x = station.x + 0.5;
      const z = station.y + 0.5;
      position.set(x, sampleHeight(state.world, x, z), z);
      // Squared off to the grid: civic buildings are the one thing in this city
      // that should look deliberately placed rather than grown.
      quaternion.setFromAxisAngle(axis, 0);
      matrix.compose(position, quaternion, scale);
      bucket.body.setMatrixAt(used, matrix);
      bucket.mast.setMatrixAt(used, matrix);
      counts.set(station.kind, used + 1);
    }

    for (const [kind, bucket] of buckets) {
      const used = counts.get(kind) ?? 0;
      bucket.body.count = used;
      bucket.mast.count = used;
      bucket.body.instanceMatrix.needsUpdate = true;
      bucket.mast.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    group,
    rebuild,
    dispose: () => {
      for (const bucket of buckets.values()) {
        bucket.body.dispose();
        bucket.mast.dispose();
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
