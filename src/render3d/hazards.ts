import * as THREE from 'three';
import { FIRE_TRUCK_DWELL_S } from '../data/balance';
import { truckArrived } from '../sim/hazards';
import { SERVICE } from '../sim/tiles';
import type { GameState } from '../sim/state';
import { index } from '../sim/world';
import { LOD_DETAIL_DISTANCE } from './constants';
import { sampleHeight } from './terrain';

/**
 * What chaos looks like (§13): flames and smoke over a burning building, and a
 * green mark over homes the sickness has reached without a hospital to answer
 * it.
 *
 * The sim owns the facts (state.fires, state.epidemic); this layer only draws
 * them, freshly every frame, from two instanced meshes — a city fire is a
 * moment of a few dozen sprites at most, so there is nothing to pool here.
 * Flicker is derived from the frame clock and the fire's id, so no per-fire
 * animation state exists either.
 */
export interface HazardLayer {
  readonly group: THREE.Group;
  sync(state: GameState, cameraDistance: number, now: number): void;
  dispose(): void;
}

const MAX_FIRES = 96;
/** Sick marks beyond this stop being information and start being wallpaper. */
const MAX_SICK = 220;

export function createHazards(): HazardLayer {
  const group = new THREE.Group();
  group.name = 'hazards';

  // The flame: an emissive cone that reads as fire at any zoom the detail LOD
  // is still showing buildings at.
  const flameGeometry = new THREE.ConeGeometry(0.22, 0.55, 6);
  const flameMaterial = new THREE.MeshStandardMaterial({
    color: '#E8893B',
    emissive: new THREE.Color('#FF6A1F'),
    emissiveIntensity: 1.6,
    roughness: 0.6,
  });
  const flames = new THREE.InstancedMesh(flameGeometry, flameMaterial, MAX_FIRES);
  flames.castShadow = false;
  flames.receiveShadow = false;
  flames.frustumCulled = false;
  flames.count = 0;
  flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // The smoke: a soft dark ball riding above the flame, swelling as it climbs.
  const smokeGeometry = new THREE.IcosahedronGeometry(0.24, 0);
  const smokeMaterial = new THREE.MeshStandardMaterial({
    color: '#3A3A3E',
    transparent: true,
    opacity: 0.55,
    roughness: 1,
  });
  const smoke = new THREE.InstancedMesh(smokeGeometry, smokeMaterial, MAX_FIRES);
  smoke.castShadow = false;
  smoke.receiveShadow = false;
  smoke.frustumCulled = false;
  smoke.count = 0;
  smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // The sick mark: a green diamond over homes the outbreak is working through
  // without cover — the same visual language as the issue marks, one hue over.
  const sickGeometry = new THREE.OctahedronGeometry(0.13, 0);
  const sickMaterial = new THREE.MeshStandardMaterial({
    color: '#7FB069',
    emissive: new THREE.Color('#5C8A3C'),
    emissiveIntensity: 0.55,
    roughness: 0.5,
  });
  const sick = new THREE.InstancedMesh(sickGeometry, sickMaterial, MAX_SICK);
  sick.castShadow = false;
  sick.receiveShadow = false;
  sick.frustumCulled = false;
  sick.count = 0;
  sick.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // The brigade: a red engine per dispatched run, drawn exactly where the sim
  // says it has driven to, plus a light bar whose pulse is the one shared
  // material property — every engine flashing in step reads as a convoy.
  const engineGeometry = new THREE.BoxGeometry(0.3, 0.22, 0.6);
  const engineMaterial = new THREE.MeshStandardMaterial({
    color: '#C0272D',
    roughness: 0.4,
    metalness: 0.2,
  });
  const engines = new THREE.InstancedMesh(engineGeometry, engineMaterial, MAX_FIRES);
  engines.castShadow = true;
  engines.receiveShadow = false;
  engines.frustumCulled = false;
  engines.count = 0;
  engines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const lightGeometry = new THREE.BoxGeometry(0.16, 0.08, 0.2);
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: '#E8F4FF',
    emissive: new THREE.Color('#5FB4FF'),
    emissiveIntensity: 2,
    roughness: 0.3,
  });
  const lightBars = new THREE.InstancedMesh(lightGeometry, lightMaterial, MAX_FIRES);
  lightBars.castShadow = false;
  lightBars.receiveShadow = false;
  lightBars.frustumCulled = false;
  lightBars.count = 0;
  lightBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  group.add(flames, smoke, sick, engines, lightBars);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  const sync = (state: GameState, cameraDistance: number, now: number): void => {
    if (cameraDistance > LOD_DETAIL_DISTANCE) {
      flames.count = 0;
      smoke.count = 0;
      sick.count = 0;
      engines.count = 0;
      lightBars.count = 0;
      return;
    }

    const seconds = now / 1000;
    // The convoy's flash: one pulse for every engine on the road.
    lightMaterial.emissiveIntensity = 1.1 + 1.4 * (0.5 + 0.5 * Math.sin(seconds * 12));

    let fireCount = 0;
    let engineCount = 0;
    for (const fire of state.fires.values()) {
      if (fireCount >= MAX_FIRES) break;
      const x = fire.x + 0.5;
      const z = fire.y + 0.5;
      const ground = sampleHeight(state.world, x, z);

      // Once the crew is at work the blaze visibly loses: the dwell fraction
      // shrinks flame and smoke towards the all-clear.
      let douse = 1;
      if (fire.truck && truckArrived(fire)) {
        const working = fire.truck.progress - (fire.truck.path.length - 1);
        douse = Math.max(0.15, 1 - working / FIRE_TRUCK_DWELL_S);
      }

      // Flicker from the clock and the id: fast enough to read as flame,
      // stable enough not to shimmer under a still camera.
      const flicker = (0.85 + 0.28 * Math.sin(seconds * 13 + fire.id * 7.3)) * douse;
      const height = Math.min(1.6, 0.7 + fire.age * 0.03) * douse;
      position.set(x, ground + 0.55 * height * flicker, z);
      quaternion.setFromAxisAngle(axis, seconds * 2.4 + fire.id);
      scale.set(flicker, height * flicker, flicker);
      matrix.compose(position, quaternion, scale);
      flames.setMatrixAt(fireCount, matrix);

      // Smoke climbs in a loop: the cycle fraction moves it up and swells it,
      // so a single instance per fire reads as a plume rather than a balloon.
      const cycle = (seconds * 0.5 + fire.id * 0.37) % 1;
      const spread = 0.5 + cycle * 1.5;
      position.set(
        x + Math.sin(seconds * 1.7 + fire.id) * 0.12 * cycle,
        ground + 0.8 + cycle * 2.2,
        z + Math.cos(seconds * 1.3 + fire.id) * 0.12 * cycle,
      );
      quaternion.setFromAxisAngle(axis, fire.id + cycle * 2);
      scale.set(spread, spread * 0.9, spread);
      matrix.compose(position, quaternion, scale);
      smoke.setMatrixAt(fireCount, matrix);

      fireCount++;

      // The engine, mid-run or parked at the scene: the sim's path, the sim's
      // odometer, drawn tile space like everything else on this layer.
      const truck = fire.truck;
      if (truck && engineCount < MAX_FIRES) {
        const last = truck.path.length - 1;
        const clamped = Math.min(truck.progress, last);
        const seg = Math.min(Math.floor(clamped), Math.max(0, last - 1));
        const a = truck.path[seg] as { x: number; y: number };
        const b = truck.path[Math.min(seg + 1, last)] as { x: number; y: number };
        const t = clamped - seg;
        const tx = a.x + (b.x - a.x) * t + 0.5;
        const tz = a.y + (b.y - a.y) * t + 0.5;
        const heading = Math.atan2(b.x - a.x, b.y - a.y);
        const tGround = sampleHeight(state.world, tx, tz);

        position.set(tx, tGround + 0.18, tz);
        quaternion.setFromAxisAngle(axis, heading);
        scale.set(1, 1, 1);
        matrix.compose(position, quaternion, scale);
        engines.setMatrixAt(engineCount, matrix);

        position.set(tx, tGround + 0.33, tz);
        matrix.compose(position, quaternion, scale);
        lightBars.setMatrixAt(engineCount, matrix);
        engineCount++;
      }
    }
    flames.count = fireCount;
    smoke.count = fireCount;
    flames.instanceMatrix.needsUpdate = true;
    smoke.instanceMatrix.needsUpdate = true;
    engines.count = engineCount;
    lightBars.count = engineCount;
    engines.instanceMatrix.needsUpdate = true;
    lightBars.instanceMatrix.needsUpdate = true;

    // Sick marks: only while an outbreak runs, only over homes with no health
    // cover — a covered street is visibly fine, which is the whole lesson.
    let sickCount = 0;
    const epidemic = state.epidemic;
    if (epidemic) {
      const pulse = 1 + 0.18 * Math.sin(seconds * 4.2);
      for (const building of state.buildings.values()) {
        if (sickCount >= MAX_SICK) break;
        if (building.zone !== 'res' || building.population === 0) continue;
        const mask = state.world.serviceMask[index(state.world, building.x, building.y)] ?? 0;
        if ((mask & SERVICE.health) !== 0) continue;

        const x = building.x + 0.5;
        const z = building.y + 0.5;
        position.set(x, sampleHeight(state.world, x, z) + 0.7, z);
        quaternion.setFromAxisAngle(axis, seconds * 1.1);
        scale.set(pulse, pulse, pulse);
        matrix.compose(position, quaternion, scale);
        sick.setMatrixAt(sickCount, matrix);
        sickCount++;
      }
    }
    sick.count = sickCount;
    sick.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    sync,
    dispose: () => {
      flames.dispose();
      smoke.dispose();
      sick.dispose();
      engines.dispose();
      lightBars.dispose();
      flameGeometry.dispose();
      smokeGeometry.dispose();
      sickGeometry.dispose();
      engineGeometry.dispose();
      lightGeometry.dispose();
      flameMaterial.dispose();
      smokeMaterial.dispose();
      sickMaterial.dispose();
      engineMaterial.dispose();
      lightMaterial.dispose();
      group.clear();
    },
  };
}
