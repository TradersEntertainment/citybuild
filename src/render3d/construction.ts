import * as THREE from 'three';
import { CONSTRUCTION_SCAFFOLD_UNTIL } from '../data/balance';
import type { GameState } from '../sim/state';
import { archetypeFor, periodOf } from './archetypes';
import { pushBox, toMeshGeometry } from './boxMesh';
import { LOD_TRAFFIC_DISTANCE } from './constants';
import { sampleHeight } from './terrain';

/**
 * Buildings being built (Paket 3 §9).
 *
 * A building levelling up used to be a silent number: the same block stood
 * there, and some seconds later it was taller. The city was always working and
 * never looked busy. This draws the working — a scaffold cage while a plot is
 * early in its climb, and a crane over the tall ones.
 *
 * Presentation only, and derived entirely from `growthProgress`, which the
 * simulation was already keeping. Nothing here can make a building rise faster;
 * it only shows that it is rising, which is the difference between a city and a
 * spreadsheet with a camera on it.
 *
 * Two instanced meshes and no per-plot geometry: a cage is the same cage at
 * every size, scaled, and the crane is the same crane turned to a seeded angle.
 */
export interface ConstructionLayer {
  readonly group: THREE.Group;
  update(state: GameState, cameraDistance: number, nowMs: number): void;
  dispose(): void;
}

const MAX_SITES = 220;
/** Level from which a site is tall enough to want a crane rather than a ladder. */
const CRANE_FROM_LEVEL = 3;

export function createConstruction(): ConstructionLayer {
  const group = new THREE.Group();
  group.name = 'construction';

  const cageGeometry = buildCageGeometry();
  const craneGeometry = buildCraneGeometry();
  // One material for both: galvanised steel with enough warmth in it to read as
  // a site rather than as more of the city's own grey.
  const material = new THREE.MeshStandardMaterial({
    color: '#C4A961',
    roughness: 0.62,
    metalness: 0.3,
  });
  const cages = new THREE.InstancedMesh(cageGeometry, material, MAX_SITES);
  const cranes = new THREE.InstancedMesh(craneGeometry, material, MAX_SITES);
  for (const mesh of [cages, cranes]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.count = 0;
    group.add(mesh);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  const update = (state: GameState, cameraDistance: number, nowMs: number): void => {
    if (cameraDistance > LOD_TRAFFIC_DISTANCE) {
      cages.count = 0;
      cranes.count = 0;
      return;
    }

    const period = periodOf(state.era);
    const seconds = nowMs / 1000;
    let cageCount = 0;
    let craneCount = 0;

    for (const building of state.buildings.values()) {
      // Only a plot actually climbing. A finished building sits at zero, which
      // is also where a brand-new one starts — so the floor matters: without it
      // every building in the city would wear scaffolding forever.
      if (building.growthProgress <= 0.02) continue;
      if (building.growthProgress >= CONSTRUCTION_SCAFFOLD_UNTIL) continue;

      const spec = archetypeFor(period, building.zone, building.level);
      const ground = sampleHeight(state.world, building.x + 0.5, building.y + 0.5);
      // The cage clears the walls it is standing against, and grows with the
      // work: a scaffold that was full height on the first day would look like
      // the building had already been built and then wrapped.
      const climb = 0.35 + (building.growthProgress / CONSTRUCTION_SCAFFOLD_UNTIL) * 0.75;
      const side = spec.footprint * 1.08;

      if (cageCount < MAX_SITES) {
        position.set(building.x + 0.5, ground, building.y + 0.5);
        quaternion.setFromAxisAngle(axis, 0);
        scale.set(side, (spec.height + spec.roofPitch) * climb, side);
        matrix.compose(position, quaternion, scale);
        cages.setMatrixAt(cageCount, matrix);
        cageCount++;
      }

      if (building.level < CRANE_FROM_LEVEL || craneCount >= MAX_SITES) continue;
      // The jib swings, slowly and out of step with its neighbours, because a row
      // of cranes all pointing the same way is worse than no cranes at all.
      const phase = building.variantSeed * 0.37;
      position.set(building.x + 0.5, ground, building.y + 0.5);
      quaternion.setFromAxisAngle(axis, Math.sin(seconds * 0.12 + phase) * 1.5 + phase);
      const reach = 0.8 + spec.footprint;
      scale.set(reach, spec.height + spec.roofPitch + 0.8, reach);
      matrix.compose(position, quaternion, scale);
      cranes.setMatrixAt(craneCount, matrix);
      craneCount++;
    }

    cages.count = cageCount;
    cranes.count = craneCount;
    if (cageCount > 0) cages.instanceMatrix.needsUpdate = true;
    if (craneCount > 0) cranes.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    update,
    dispose: () => {
      group.remove(cages, cranes);
      cages.dispose();
      cranes.dispose();
      cageGeometry.dispose();
      craneGeometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}

/**
 * A scaffold cage in unit space: four uprights at the corners and two rings of
 * ledgers, all inside a 1×1×1 box so the caller can scale it to any plot.
 */
function buildCageGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const pole = 0.045;
  const half = 0.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushBox(positions, sx * half - pole, 0, sz * half - pole, sx * half + pole, 1, sz * half + pole);
    }
  }
  // Two lifts of ledgers, which is what makes it read as scaffolding rather
  // than as four sticks.
  for (const y of [0.36, 0.72]) {
    pushBox(positions, -half, y, -half - pole * 0.6, half, y + pole, -half + pole * 0.6);
    pushBox(positions, -half, y, half - pole * 0.6, half, y + pole, half + pole * 0.6);
    pushBox(positions, -half - pole * 0.6, y, -half, -half + pole * 0.6, y + pole, half);
    pushBox(positions, half - pole * 0.6, y, -half, half + pole * 0.6, y + pole, half);
  }
  return toMeshGeometry(positions, null);
}

/** A tower crane in unit space: mast up the middle, jib out one side, counterweight. */
function buildCraneGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const mast = 0.05;
  pushBox(positions, -mast, 0, -mast, mast, 1, mast);
  // The jib, at the top, reaching out past the plot.
  pushBox(positions, -0.03, 0.9, -0.06, -0.03 + 1, 0.96, 0.06);
  pushBox(positions, -0.28, 0.9, -0.06, -0.03, 0.99, 0.06);
  // A hook line hanging off the jib, which is the detail that sells it.
  pushBox(positions, 0.6, 0.62, -0.012, 0.624, 0.9, 0.012);
  return toMeshGeometry(positions, null);
}

