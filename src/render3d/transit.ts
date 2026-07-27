import * as THREE from 'three';
import type { GameState } from '../sim/state';
import type { TransitLine } from '../sim/transit';
import { LOD_DETAIL_DISTANCE } from './constants';
import { sampleRoadHeight } from './roadDeck';

/**
 * Bus lines, as the player sees them (§18).
 *
 * A line takes no ground: it is not paved, it does not replace a road, and if it
 * were not drawn the player would have paid for a shape they cannot see. So this
 * layer is the whole feedback for the purchase — a coloured ribbon riding just
 * above the tarmac, a post at every stop, and a bus running the length of it.
 *
 * The ribbon sits slightly above the road deck rather than on the ground for the
 * same reason every other layer that rides on tarmac does: a bus route across a
 * bridge that dives into the water reads as a bug (`sampleRoadHeight`).
 *
 * Reads the sim and nothing else. The buses have no state here — where a bus is
 * comes from the frame clock and the line's own length, so nothing has to be
 * kept in step across a save, a pause or a reload.
 */
export interface TransitLayer {
  readonly group: THREE.Group;
  sync(state: GameState, cameraDistance: number, now: number): void;
  dispose(): void;
}

/** More lines than this on one map and the player has other problems. */
const MAX_LINES = 24;
const MAX_STOPS = 400;
/** Tiles a bus covers per second. Brisk, so a line reads as running. */
const BUS_SPEED = 5;
/** How far above the road deck the ribbon floats. */
const RIBBON_LIFT = 0.06;

/**
 * One hue per line, walked round the wheel.
 *
 * Distinct colours rather than one transit colour, because the question a player
 * asks of a network is "where does *that* one go" — and two lines crossing in one
 * colour is a knot rather than a map.
 */
function lineColour(id: number, target: THREE.Color): THREE.Color {
  return target.setHSL(((id * 0.37) % 1), 0.62, 0.55);
}

export function createTransit(): TransitLayer {
  const group = new THREE.Group();
  group.name = 'transit';

  // The ribbon is one mesh per line rather than one instanced mesh for all of
  // them: a line is an arbitrary polyline, which is geometry rather than a
  // transform, and there are at most a couple of dozen.
  const ribbons = new THREE.Group();
  const ribbonMeshes = new Map<number, THREE.Line>();

  const postGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5);
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#D8D2C4', roughness: 0.7 });
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, MAX_STOPS);
  posts.castShadow = false;
  posts.frustumCulled = false;
  posts.count = 0;
  posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // The sign on the post carries the line's colour, which is what ties a stop to
  // the ribbon running through it.
  const signGeometry = new THREE.BoxGeometry(0.34, 0.22, 0.05);
  const signMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, vertexColors: true });
  const signs = new THREE.InstancedMesh(signGeometry, signMaterial, MAX_STOPS);
  signs.castShadow = false;
  signs.frustumCulled = false;
  signs.count = 0;
  signs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const busGeometry = new THREE.BoxGeometry(0.34, 0.3, 0.86);
  const busMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0.1,
    vertexColors: true,
  });
  const buses = new THREE.InstancedMesh(busGeometry, busMaterial, MAX_LINES);
  buses.castShadow = true;
  buses.frustumCulled = false;
  buses.count = 0;
  buses.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  group.add(ribbons, posts, signs, buses);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();

  /** Rebuilds a line's ribbon. Only when the line is new or its shape changed. */
  const buildRibbon = (state: GameState, line: TransitLine): THREE.Line => {
    const points: number[] = [];
    for (const point of line.path) {
      const x = point.x + 0.5;
      const z = point.y + 0.5;
      points.push(x, sampleRoadHeight(state.world, x, z) + RIBBON_LIFT, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: lineColour(line.id, colour).clone() });
    return new THREE.Line(geometry, material);
  };

  const sync = (state: GameState, cameraDistance: number, now: number): void => {
    // Ribbons are kept between frames and only rebuilt when a line appears or
    // goes: the geometry is a hundred vertices and rebuilding it every frame for
    // a shape that never moves would be the one avoidable cost on this layer.
    for (const [id, mesh] of ribbonMeshes) {
      if (state.transit.has(id)) continue;
      ribbons.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      ribbonMeshes.delete(id);
    }
    for (const line of state.transit.values()) {
      if (ribbonMeshes.has(line.id)) continue;
      const mesh = buildRibbon(state, line);
      ribbons.add(mesh);
      ribbonMeshes.set(line.id, mesh);
    }

    // The posts and the buses are detail: at map zoom the ribbon alone says
    // where the network runs, which is the question being asked from up there.
    if (cameraDistance > LOD_DETAIL_DISTANCE) {
      posts.count = 0;
      signs.count = 0;
      buses.count = 0;
      return;
    }

    const seconds = now / 1000;
    let stopCount = 0;
    let busCount = 0;

    for (const line of state.transit.values()) {
      lineColour(line.id, colour);

      for (const stop of line.stops) {
        if (stopCount >= MAX_STOPS) break;
        const x = stop.x + 0.5;
        const z = stop.y + 0.5;
        const ground = sampleRoadHeight(state.world, x, z);
        position.set(x, ground + 0.45, z);
        quaternion.identity();
        matrix.compose(position, quaternion, scale);
        posts.setMatrixAt(stopCount, matrix);

        position.set(x, ground + 0.85, z);
        matrix.compose(position, quaternion, scale);
        signs.setMatrixAt(stopCount, matrix);
        signs.setColorAt(stopCount, colour);
        stopCount++;
      }

      // One bus per line, shuttling. Derived from the clock and the line's own
      // length, so there is no vehicle state to keep — and a paused city has a
      // stopped bus, which is exactly right.
      if (busCount < MAX_LINES && line.path.length >= 2) {
        const span = line.path.length - 1;
        // A saw wave: out along the route and back, which is what a bus does.
        const cycle = ((seconds * BUS_SPEED) / span + line.id * 0.31) % 2;
        const along = (cycle <= 1 ? cycle : 2 - cycle) * span;
        const seg = Math.min(Math.floor(along), span - 1);
        const t = along - seg;
        const a = line.path[seg] as { x: number; y: number };
        const b = line.path[seg + 1] as { x: number; y: number };
        const bx = a.x + (b.x - a.x) * t + 0.5;
        const bz = a.y + (b.y - a.y) * t + 0.5;
        const forward = cycle <= 1 ? 1 : -1;
        position.set(bx, sampleRoadHeight(state.world, bx, bz) + 0.25, bz);
        quaternion.setFromAxisAngle(axis, Math.atan2((b.x - a.x) * forward, (b.y - a.y) * forward));
        matrix.compose(position, quaternion, scale);
        buses.setMatrixAt(busCount, matrix);
        buses.setColorAt(busCount, colour);
        busCount++;
      }
    }

    posts.count = stopCount;
    signs.count = stopCount;
    buses.count = busCount;
    posts.instanceMatrix.needsUpdate = true;
    signs.instanceMatrix.needsUpdate = true;
    buses.instanceMatrix.needsUpdate = true;
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
    if (buses.instanceColor) buses.instanceColor.needsUpdate = true;
  };

  return {
    group,
    sync,
    dispose: () => {
      for (const mesh of ribbonMeshes.values()) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      ribbonMeshes.clear();
      posts.dispose();
      signs.dispose();
      buses.dispose();
      postGeometry.dispose();
      signGeometry.dispose();
      busGeometry.dispose();
      postMaterial.dispose();
      signMaterial.dispose();
      busMaterial.dispose();
      group.clear();
    },
  };
}
