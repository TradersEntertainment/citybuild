import * as THREE from 'three';
import { PORT_ORDER, type PortKind } from '../data/ports';
import { SERVICE_ORDER, type ServiceKind } from '../data/services';
import { UTILITY_ORDER, type UtilityKind } from '../data/utilities';
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
interface StationLook {
  /** Body colour of the shed. */
  body: string;
  /** Roof and mast colour — the part that identifies the service. */
  accent: string;
  width: number;
  height: number;
  /** Height of the mast above the roof; 0 for none. */
  mast: number;
}

type FacilityKind = ServiceKind | UtilityKind | PortKind;

const LOOKS: Readonly<Record<FacilityKind, StationLook>> = {
  fire: { body: '#B9AFA3', accent: '#B03A2B', width: 0.78, height: 0.58, mast: 0.5 },
  health: { body: '#E2DED4', accent: '#3E86A8', width: 0.72, height: 0.5, mast: 0.34 },
  education: { body: '#D6CDB6', accent: '#8A6B2E', width: 0.86, height: 0.44, mast: 0.28 },
  police: { body: '#C2C6CB', accent: '#2E4A7A', width: 0.74, height: 0.52, mast: 0.44 },
  // Low, pale and wide, with nothing standing up off it: a cemetery should read
  // as ground rather than as a building, because that is what it is.
  cemetery: { body: '#C8CBBE', accent: '#7D8A6E', width: 0.9, height: 0.14, mast: 0.36 },
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

const FACILITY_ORDER: readonly FacilityKind[] = [
  ...SERVICE_ORDER,
  ...UTILITY_ORDER,
  ...PORT_ORDER,
];

const INITIAL_CAPACITY = 32;

interface Bucket {
  body: THREE.InstancedMesh;
  mast: THREE.InstancedMesh;
  capacity: number;
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

  const makeBucket = (kind: FacilityKind, capacity: number): Bucket => {
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

    const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
    const mast = new THREE.InstancedMesh(mastGeometry, mastMaterial, capacity);
    for (const mesh of [body, mast]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      group.add(mesh);
    }
    return { body, mast, capacity };
  };

  for (const kind of FACILITY_ORDER) buckets.set(kind, makeBucket(kind, INITIAL_CAPACITY));

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
        group.remove(bucket.body, bucket.mast);
        bucket.body.dispose();
        bucket.mast.dispose();
        bucket = makeBucket(station.kind, bucket.capacity * 2);
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
