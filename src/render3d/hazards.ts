import * as THREE from 'three';
import { FIRE_TRUCK_DWELL_S } from '../data/balance';
import { runPosition } from '../sim/dispatch';
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
/** More crime markers than this on screen at once and the city has other problems. */
const MAX_CRIMES = 64;

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
  // One bar mesh for both services, sized for whichever fleet is bigger: an
  // engine and a patrol car want the same flashing box, and the pulse is a
  // material property they may as well share.
  const lightBars = new THREE.InstancedMesh(lightGeometry, lightMaterial, MAX_FIRES + MAX_CRIMES);
  lightBars.castShadow = false;
  lightBars.receiveShadow = false;
  lightBars.frustumCulled = false;
  lightBars.count = 0;
  lightBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // The crime marker: the one thing on this layer the player is meant to press,
  // so it is the loudest thing on it. It bobs and spins above the building, and
  // it is drawn at *every* zoom rather than hidden by the detail LOD — a demand
  // for a tap that disappears when the player pulls back to look for it is worse
  // than no demand at all.
  const markGeometry = new THREE.TetrahedronGeometry(0.34, 0);
  const markMaterial = new THREE.MeshStandardMaterial({
    color: '#FFD166',
    emissive: new THREE.Color('#FF8A2B'),
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  const marks = new THREE.InstancedMesh(markGeometry, markMaterial, MAX_CRIMES);
  marks.castShadow = false;
  marks.receiveShadow = false;
  marks.frustumCulled = false;
  marks.count = 0;
  marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // The patrol car: navy, and shorter than an engine so the two fleets read
  // apart from above, which is the only angle most of this game is seen from.
  const carGeometry = new THREE.BoxGeometry(0.28, 0.18, 0.5);
  const carMaterial = new THREE.MeshStandardMaterial({
    color: '#20386B',
    roughness: 0.35,
    metalness: 0.25,
  });
  const cars = new THREE.InstancedMesh(carGeometry, carMaterial, MAX_CRIMES);
  cars.castShadow = true;
  cars.receiveShadow = false;
  cars.frustumCulled = false;
  cars.count = 0;
  cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  group.add(flames, smoke, sick, engines, lightBars, marks, cars);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  /**
   * Markers and patrol cars. Returns the light-bar count it used, so the fire
   * pass can carry on from there in the shared buffer.
   *
   * An unanswered crime gets the marker; an answered one loses it and gains a
   * car. That swap *is* the feedback for the tap — the player pressed something
   * and the thing they pressed visibly turned into a response.
   */
  const syncCrime = (state: GameState, seconds: number, barsUsed: number): number => {
    let markCount = 0;
    let carCount = 0;
    let bars = barsUsed;
    for (const crime of state.crimes.values()) {
      const x = crime.x + 0.5;
      const z = crime.y + 0.5;
      const ground = sampleHeight(state.world, x, z);

      if (!crime.car) {
        if (markCount >= MAX_CRIMES) continue;
        // Bobbing and turning: on a still map a static diamond is easy to read
        // as scenery, and this one is a button.
        const bob = 0.9 + 0.16 * Math.sin(seconds * 3 + crime.id * 2.1);
        const urgency = 1 + 0.14 * Math.sin(seconds * 7 + crime.id);
        position.set(x, ground + 0.95 + bob * 0.35, z);
        quaternion.setFromAxisAngle(axis, seconds * 1.8 + crime.id);
        scale.set(urgency, urgency, urgency);
        matrix.compose(position, quaternion, scale);
        marks.setMatrixAt(markCount, matrix);
        markCount++;
        continue;
      }

      if (carCount >= MAX_CRIMES) continue;
      const at = runPosition(crime.car);
      const cx = at.x + 0.5;
      const cz = at.y + 0.5;
      const cGround = sampleHeight(state.world, cx, cz);
      position.set(cx, cGround + 0.16, cz);
      quaternion.setFromAxisAngle(axis, at.heading);
      scale.set(1, 1, 1);
      matrix.compose(position, quaternion, scale);
      cars.setMatrixAt(carCount, matrix);
      position.set(cx, cGround + 0.29, cz);
      matrix.compose(position, quaternion, scale);
      lightBars.setMatrixAt(bars, matrix);
      carCount++;
      bars++;
    }
    marks.count = markCount;
    cars.count = carCount;
    marks.instanceMatrix.needsUpdate = true;
    cars.instanceMatrix.needsUpdate = true;
    return bars;
  };

  const sync = (state: GameState, cameraDistance: number, now: number): void => {
    const seconds = now / 1000;
    // The convoy's flash: one pulse for every vehicle on the road.
    lightMaterial.emissiveIntensity = 1.1 + 1.4 * (0.5 + 0.5 * Math.sin(seconds * 12));
    // Shared between the two fleets, so the count has to be one counter. Order
    // inside the instance buffer is invisible; only the total matters.
    let barCount = 0;

    // Crime first, and outside the LOD guard: a marker asking for a tap must
    // survive the player zooming out to find it.
    barCount = syncCrime(state, seconds, barCount);

    if (cameraDistance > LOD_DETAIL_DISTANCE) {
      flames.count = 0;
      smoke.count = 0;
      sick.count = 0;
      engines.count = 0;
      lightBars.count = barCount;
      lightBars.instanceMatrix.needsUpdate = true;
      return;
    }

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
        const at = runPosition(truck);
        const tx = at.x + 0.5;
        const tz = at.y + 0.5;
        const tGround = sampleHeight(state.world, tx, tz);

        position.set(tx, tGround + 0.18, tz);
        quaternion.setFromAxisAngle(axis, at.heading);
        scale.set(1, 1, 1);
        matrix.compose(position, quaternion, scale);
        engines.setMatrixAt(engineCount, matrix);

        position.set(tx, tGround + 0.33, tz);
        matrix.compose(position, quaternion, scale);
        lightBars.setMatrixAt(barCount, matrix);
        engineCount++;
        barCount++;
      }
    }
    flames.count = fireCount;
    smoke.count = fireCount;
    flames.instanceMatrix.needsUpdate = true;
    smoke.instanceMatrix.needsUpdate = true;
    engines.count = engineCount;
    lightBars.count = barCount;
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
      marks.dispose();
      cars.dispose();
      flameGeometry.dispose();
      smokeGeometry.dispose();
      sickGeometry.dispose();
      engineGeometry.dispose();
      lightGeometry.dispose();
      markGeometry.dispose();
      carGeometry.dispose();
      flameMaterial.dispose();
      smokeMaterial.dispose();
      sickMaterial.dispose();
      engineMaterial.dispose();
      lightMaterial.dispose();
      markMaterial.dispose();
      carMaterial.dispose();
      group.clear();
    },
  };
}
