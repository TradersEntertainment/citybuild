import * as THREE from 'three';
import type { GameState } from '../sim/state';
import { ISSUE } from '../sim/tiles';
import { LOD_DETAIL_DISTANCE } from './constants';
import { sampleHeight } from './terrain';

/**
 * The marks over buildings that are in trouble (§6.2).
 *
 * The brief is explicit that a player should be able to understand a loss from
 * the map alone, and the sim has computed an issue bit field all along with
 * nothing drawing it. A stalled district is otherwise indistinguishable from a
 * district that is merely still growing — which is exactly the confusion that
 * makes a city builder feel broken rather than hard.
 *
 * One instanced mesh per issue colour: at most a few hundred marks, three draw
 * calls, and no per-building objects.
 */
interface Band {
  mask: number;
  colour: string;
}

/**
 * Ordered by how much the player can do about it. A building shows the first
 * band it matches, so the mark always names the most actionable problem rather
 * than whichever bit happens to be lowest.
 */
const BANDS: readonly Band[] = [
  { mask: ISSUE.noWater | ISSUE.noPower, colour: '#4FA3C7' },
  { mask: ISSUE.pollution, colour: '#B4442F' },
  { mask: ISSUE.noise, colour: '#D2A03A' },
  { mask: ISSUE.traffic, colour: '#C77A2F' },
  { mask: ISSUE.noService, colour: '#8C8F94' },
  // Last, because a street the lorry misses is the least urgent of these — but
  // it is on the list at all because the city-wide backlog says how much rubbish
  // is uncollected and nothing else says where (sim/rubbish.ts).
  { mask: ISSUE.noRubbish, colour: '#6E7A4A' },
];

const INITIAL_CAPACITY = 128;
/** Height above the ground the mark floats at. */
const FLOAT_HEIGHT = 0.55;

export interface IssueLayer {
  readonly group: THREE.Group;
  sync(state: GameState, cameraDistance: number, now: number): void;
  dispose(): void;
}

export function createIssues(): IssueLayer {
  const group = new THREE.Group();
  group.name = 'issues';

  // A diamond reads as a marker rather than as a thing standing in the city —
  // no building in this game is a faceted octahedron, so it can never be
  // mistaken for one.
  const geometry = new THREE.OctahedronGeometry(0.12, 0);
  const materials: THREE.MeshStandardMaterial[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const capacities: number[] = [];

  for (const band of BANDS) {
    const material = new THREE.MeshStandardMaterial({
      color: band.colour,
      emissive: new THREE.Color(band.colour),
      emissiveIntensity: 0.45,
      roughness: 0.5,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, INITIAL_CAPACITY);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    materials.push(material);
    meshes.push(mesh);
    capacities.push(INITIAL_CAPACITY);
    group.add(mesh);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  const counts = new Array<number>(BANDS.length).fill(0);

  const sync = (state: GameState, cameraDistance: number, now: number): void => {
    // From far enough away a mark is a pixel of noise, and the player is not
    // reading individual buildings at that range anyway.
    if (cameraDistance > LOD_DETAIL_DISTANCE) {
      for (const mesh of meshes) mesh.count = 0;
      return;
    }

    counts.fill(0);
    // A slow bob, shared by every mark, so trouble catches the eye without any
    // of them needing their own animation state.
    const bob = Math.sin(now / 420) * 0.06;
    const spin = now / 1400;

    for (const building of state.buildings.values()) {
      if (building.issues === 0) continue;
      const band = BANDS.findIndex((b) => (building.issues & b.mask) !== 0);
      if (band < 0) continue;

      let mesh = meshes[band] as THREE.InstancedMesh;
      if ((counts[band] ?? 0) >= (capacities[band] ?? 0)) {
        mesh = grow(group, mesh, geometry, materials[band] as THREE.Material, capacities, band);
        meshes[band] = mesh;
      }

      const x = building.x + 0.5;
      const z = building.y + 0.5;
      position.set(x, sampleHeight(state.world, x, z) + FLOAT_HEIGHT + bob, z);
      quaternion.setFromAxisAngle(axis, spin);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(counts[band] as number, matrix);
      counts[band] = (counts[band] ?? 0) + 1;
    }

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i] as THREE.InstancedMesh;
      mesh.count = counts[i] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    group,
    sync,
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
      for (const material of materials) material.dispose();
      geometry.dispose();
      group.clear();
    },
  };
}

function grow(
  group: THREE.Group,
  old: THREE.InstancedMesh,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  capacities: number[],
  band: number,
): THREE.InstancedMesh {
  const capacity = (capacities[band] ?? INITIAL_CAPACITY) * 2;
  capacities[band] = capacity;

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // This frame's markers, carried over. `sync` is partway through its walk when
  // a band fills up and it does not rewind — it keeps counting from where it
  // was, so without the carry every marker written before the doubling is left
  // at the identity matrix: unscaled and sitting on tile zero. A cluster of
  // oversized diamonds in the corner of the map, for one frame, every time a
  // band crosses a power of two.
  mesh.instanceMatrix.array.set(old.instanceMatrix.array);
  group.remove(old);
  old.dispose();
  group.add(mesh);
  return mesh;
}
