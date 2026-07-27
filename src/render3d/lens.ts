import * as THREE from 'three';
import { lensField, NO_READING, type LensKind } from '../sim/lens';
import type { GameState } from '../sim/state';
import { index, type World } from '../sim/world';
import { sampleHeight } from './terrain';

/**
 * The lens mesh: the sim's chosen field, painted onto the ground.
 *
 * The colour half of sim/lens.ts. One vertex-coloured mesh, rebuilt when the
 * lens changes and on a slow timer while one is up — never while none is, so a
 * player who ignores the feature pays nothing for it. Same construction as the
 * zone overlay, and the same discipline learned from the tab-killing leak:
 * every geometry this file replaces is disposed in the same breath.
 */
const LENS_LIFT = 0.16;
/** Fields drift slowly, and rebuilding a 65k-tile mesh per frame would not. */
export const LENS_REFRESH_MS = 3_000;

/**
 * Colour ramps, low reading → high. Per lens, because "high" is good news for
 * land value and bad news for pollution, and one ramp would have to lie to one
 * of them. Colours live here and not in balance.ts for the same reason the
 * archetypes' do: they are presentation, not tunables.
 */
const RAMPS: Record<LensKind, [string, string]> = {
  value: ['#2E4A3A', '#E4C15C'],
  pollution: ['#3A4A2E', '#8A3A24'],
  noise: ['#33415A', '#C9793B'],
  traffic: ['#2E6E4E', '#C4463A'],
  coverage: ['#C4463A', '#3E8656'],
  crime: ['#3A3A4E', '#B03A6E'],
  density: ['#4A5A66', '#7FB0C6'],
};

export interface LensLayer {
  readonly group: THREE.Group;
  /** The lens currently up, or null. */
  readonly kind: LensKind | null;
  /** Switches lens (null clears) and rebuilds immediately. */
  set(state: GameState, kind: LensKind | null, traffic?: Float32Array): void;
  /** Rebuilds the active lens from fresh state; a no-op with none up. */
  refresh(state: GameState, traffic?: Float32Array): void;
  dispose(): void;
}

export function createLens(world: World): LensLayer {
  const group = new THREE.Group();
  group.name = 'lens';

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.renderOrder = 5; // over the zone wash and the for-sale lines
  mesh.visible = false;
  group.add(mesh);

  let active: LensKind | null = null;
  const low = new THREE.Color();
  const high = new THREE.Color();
  const colour = new THREE.Color();

  const rebuild = (state: GameState, traffic?: Float32Array): void => {
    if (!active) return;
    const field = lensField(state, active, traffic);
    const [rampLow, rampHigh] = RAMPS[active];
    low.set(rampLow);
    high.set(rampHigh);

    // Counted first, then filled into buffers of exactly that size. A mature
    // city's value lens covers most of the owned map — tens of thousands of
    // tiles, 36 floats each — and growing that through push() on a plain array
    // every refresh was megabytes of transient doubles for the collector to
    // sweep up, on the machines least able to afford the pause.
    let tiles = 0;
    for (let i = 0; i < field.length; i++) if (field[i] !== NO_READING) tiles++;
    const positions = new Float32Array(tiles * 18);
    const colours = new Float32Array(tiles * 18);

    let at = 0;
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        const reading = field[index(world, x, y)] ?? NO_READING;
        if (reading === NO_READING) continue;
        colour.copy(low).lerp(high, reading);
        writeTile(positions, at, world, x, y);
        for (let v = 0; v < 6; v++) {
          colours[at + v * 3] = colour.r;
          colours[at + v * 3 + 1] = colour.g;
          colours[at + v * 3 + 2] = colour.b;
        }
        at += 18;
      }
    }

    mesh.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
    mesh.visible = tiles > 0;
  };

  const layer = {
    group,
    get kind() {
      return active;
    },
    set: (state: GameState, kind: LensKind | null, traffic?: Float32Array): void => {
      active = kind;
      if (!kind) {
        // Cleared, not merely hidden: an invisible 65k-tile mesh would go on
        // holding its buffers on the GPU for a feature that is switched off.
        mesh.geometry.dispose();
        mesh.geometry = new THREE.BufferGeometry();
        mesh.visible = false;
        return;
      }
      rebuild(state, traffic);
    },
    refresh: rebuild,
    dispose: (): void => {
      mesh.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
  return layer as LensLayer;
}

function writeTile(out: Float32Array, at: number, world: World, x: number, y: number): void {
  const h00 = sampleHeight(world, x, y) + LENS_LIFT;
  const h10 = sampleHeight(world, x + 1, y) + LENS_LIFT;
  const h01 = sampleHeight(world, x, y + 1) + LENS_LIFT;
  const h11 = sampleHeight(world, x + 1, y + 1) + LENS_LIFT;
  out.set(
    [
      x, h00, y, x, h01, y + 1, x + 1, h10, y,
      x + 1, h10, y, x, h01, y + 1, x + 1, h11, y + 1,
    ],
    at,
  );
}
