import * as THREE from 'three';
import { dayFraction, daylightAmount } from '../sim/daytime';
import type { GameState } from '../sim/state';
import { inBounds, startingCentre } from '../sim/world';
import { isWater } from '../sim/worldgen';
import { LOD_TRAFFIC_DISTANCE, SEA_Y, TILE, WORLD_SIZE } from './constants';
import { sampleHeight } from './terrain';

/**
 * Birds and fish (Paket 3 §10).
 *
 * The cheapest life in the game and, per line, some of the most effective: a
 * flock crossing a rooftop and a fish breaking the surface both say "this place
 * is going on without you", which is the whole feeling an idle city is trying to
 * produce.
 *
 * Two instanced meshes, a few dozen instances, no state that outlives a frame
 * beyond the flock's own drift. Both are gated: birds fly by day because a
 * silhouette against a night sky is invisible anyway, and fish only appear where
 * there is actually water to jump out of.
 *
 * The plan also asked for trees swaying. That one is deliberately left out: the
 * tree layer is tens of thousands of instances and swaying them means rewriting
 * every instance matrix every frame, which is the most expensive thing in this
 * file by three orders of magnitude and the least visible from map height.
 */
export interface WildlifeLayer {
  readonly group: THREE.Group;
  /** The map changed under it: find the water again. */
  rebuild(state: GameState): void;
  update(deltaSeconds: number, state: GameState, cameraDistance: number): void;
  dispose(): void;
}

const FLOCKS = 3;
const BIRDS_PER_FLOCK = 9;
const MAX_FISH = 14;
/** How long one fish's arc lasts, and how long until the next. */
const JUMP_S = 1.1;
const JUMP_GAP_S = 5;

interface Flock {
  /** Centre, in tile space. */
  x: number;
  z: number;
  height: number;
  heading: number;
  speed: number;
  seed: number;
}

interface Fish {
  x: number;
  z: number;
  /** Seconds until this one jumps; counts down, then the arc runs. */
  wait: number;
  /** 0..1 through the arc, or −1 while waiting. */
  t: number;
  heading: number;
}

export function createWildlife(): WildlifeLayer {
  const group = new THREE.Group();
  group.name = 'wildlife';

  // A bird is two slabs at an angle. At the distance these are ever seen that is
  // a bird, and anything more detailed is triangles nobody will resolve.
  const birdGeometry = buildBirdGeometry();
  const fishGeometry = new THREE.BoxGeometry(0.06, 0.06, 0.2);
  const birdMaterial = new THREE.MeshStandardMaterial({
    color: '#2E3238',
    roughness: 0.9,
    // Lit from both sides: a bird seen from below is a silhouette, and a
    // single-sided one flickers out every time the flock banks.
    side: THREE.DoubleSide,
  });
  const fishMaterial = new THREE.MeshStandardMaterial({
    color: '#B9C6CF',
    roughness: 0.35,
    metalness: 0.4,
  });

  const birds = new THREE.InstancedMesh(birdGeometry, birdMaterial, FLOCKS * BIRDS_PER_FLOCK);
  const fishes = new THREE.InstancedMesh(fishGeometry, fishMaterial, MAX_FISH);
  for (const mesh of [birds, fishes]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.count = 0;
    group.add(mesh);
  }

  const flocks: Flock[] = [];
  const fish: Fish[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  let clock = 0;

  const rebuild = (state: GameState): void => {
    const home = startingCentre(state.world);
    flocks.length = 0;
    for (let f = 0; f < FLOCKS; f++) {
      flocks.push({
        x: home.x + (f - 1) * 24,
        z: home.y + (f % 2 === 0 ? 18 : -22),
        height: 7 + f * 2.5,
        heading: f * 2.1,
        speed: 2.6 + f * 0.5,
        seed: f * 31.7,
      });
    }

    // Fish go wherever there is open water. Sampled on a coarse lattice rather
    // than searched: the map is a quarter of a million tiles and this only needs
    // fourteen answers.
    fish.length = 0;
    const size = state.world.size;
    for (let n = 0; n < 400 && fish.length < MAX_FISH; n++) {
      const x = 4 + Math.floor(((n * 61) % 233) * ((size - 8) / 233));
      const z = 4 + Math.floor(((n * 149) % 251) * ((size - 8) / 251));
      if (!inBounds(state.world, x, z)) continue;
      if (!isWater(state.world, x, z)) continue;
      // Not right at the shoreline: a fish jumping in the shallows next to a
      // road looks like a rendering fault.
      if (!isWater(state.world, x + 2, z) || !isWater(state.world, x, z + 2)) continue;
      fish.push({
        x: x + 0.5,
        z: z + 0.5,
        wait: (n % 7) * 0.8,
        t: -1,
        heading: n * 0.7,
      });
    }
  };

  const update = (deltaSeconds: number, state: GameState, cameraDistance: number): void => {
    clock += deltaSeconds;
    if (cameraDistance > LOD_TRAFFIC_DISTANCE * 1.4) {
      birds.count = 0;
      fishes.count = 0;
      return;
    }

    const daylight = daylightAmount(dayFraction(state.playedMs));
    let birdCount = 0;
    if (daylight > 0.25) {
      for (const flock of flocks) {
        // A slow wander rather than a straight line, and a wrap at the map edge
        // so a flock never simply leaves and never comes back.
        flock.heading += Math.sin(clock * 0.19 + flock.seed) * deltaSeconds * 0.5;
        flock.x += Math.sin(flock.heading) * flock.speed * deltaSeconds;
        flock.z += Math.cos(flock.heading) * flock.speed * deltaSeconds;
        flock.x = wrap(flock.x);
        flock.z = wrap(flock.z);

        const ground = sampleHeight(state.world, flock.x, flock.z);
        for (let b = 0; b < BIRDS_PER_FLOCK; b++) {
          if (birdCount >= FLOCKS * BIRDS_PER_FLOCK) break;
          // A ragged V: spread across the flock's heading, trailing behind it.
          const rank = b - (BIRDS_PER_FLOCK - 1) / 2;
          const side = Math.sin(flock.heading + Math.PI / 2) * rank * 0.9;
          const back = Math.cos(flock.heading + Math.PI / 2) * rank * 0.9;
          const lag = Math.abs(rank) * 0.7;
          const flap = Math.sin(clock * 9 + b * 1.3 + flock.seed) * 0.28;
          position.set(
            flock.x + side - Math.sin(flock.heading) * lag,
            Math.max(SEA_Y, ground) + flock.height + flap,
            flock.z + back - Math.cos(flock.heading) * lag,
          );
          quaternion.setFromAxisAngle(axis, flock.heading);
          matrix.compose(position, quaternion, scale);
          birds.setMatrixAt(birdCount, matrix);
          birdCount++;
        }
      }
    }

    let fishCount = 0;
    for (const one of fish) {
      if (one.t < 0) {
        one.wait -= deltaSeconds;
        if (one.wait > 0) continue;
        one.t = 0;
      }
      one.t += deltaSeconds / JUMP_S;
      if (one.t >= 1) {
        one.t = -1;
        // Irregular by construction, like the birdsong: a fish on a fixed period
        // is a metronome, and an ear — or an eye — finds one in three repeats.
        one.wait = JUMP_GAP_S * (0.5 + ((one.heading * 7) % 1));
        one.heading += 1.9;
        continue;
      }
      if (fishCount >= MAX_FISH) continue;

      // A parabola out of the water and back into it, nose following the arc.
      const arc = Math.sin(one.t * Math.PI);
      const along = (one.t - 0.5) * 1.4;
      position.set(
        one.x + Math.sin(one.heading) * along,
        SEA_Y + arc * 0.5,
        one.z + Math.cos(one.heading) * along,
      );
      quaternion.setFromAxisAngle(axis, one.heading);
      matrix.compose(position, quaternion, scale);
      // Pitch with the arc: nose up on the way out, down on the way back.
      matrix.multiply(pitch((0.5 - one.t) * 1.6));
      fishes.setMatrixAt(fishCount, matrix);
      fishCount++;
    }

    birds.count = birdCount;
    fishes.count = fishCount;
    if (birdCount > 0) birds.instanceMatrix.needsUpdate = true;
    if (fishCount > 0) fishes.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    rebuild,
    update,
    dispose: () => {
      group.remove(birds, fishes);
      birds.dispose();
      fishes.dispose();
      birdGeometry.dispose();
      fishGeometry.dispose();
      birdMaterial.dispose();
      fishMaterial.dispose();
      group.clear();
    },
  };
}

const pitchMatrix = new THREE.Matrix4();
function pitch(radians: number): THREE.Matrix4 {
  return pitchMatrix.makeRotationX(radians);
}

function wrap(value: number): number {
  const span = WORLD_SIZE * TILE;
  if (value < 0) return value + span;
  if (value >= span) return value - span;
  return value;
}

/** Two swept wings and nothing else. */
function buildBirdGeometry(): THREE.BufferGeometry {
  const positions = [
    // Left wing.
    0, 0, 0, -0.22, 0.05, -0.07, -0.2, 0.05, 0.06,
    // Right wing.
    0, 0, 0, 0.2, 0.05, 0.06, 0.22, 0.05, -0.07,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
