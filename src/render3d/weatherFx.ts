import * as THREE from 'three';
import type { WeatherKind } from '../sim/weather';

/**
 * Weather, seen (Paket 2 §6).
 *
 * The sim already decides what the weather is and what it does; this only draws
 * it. Rain is one instanced streak mesh that follows the camera and wraps
 * around it, which is the standard trick and the only one that stays cheap: a
 * particle system that covers a 256-tile map would be spending almost all of
 * its budget on drops nobody can see.
 *
 * Fog and haze are the fog the scene already has, pushed in. Nothing here adds
 * a pass.
 */

/** Drops in the column that follows the camera. */
const DROPS = 900;
/** Side of the box the drops live in, in tiles. */
const BOX = 26;
const BOX_HEIGHT = 14;
/** Tiles per second a drop falls. */
const FALL_SPEED = 26;
/** How far a storm leans the rain over. */
const STORM_SLANT = 0.32;

export interface WeatherFx {
  readonly group: THREE.Group;
  /**
   * Per frame. `progress` fades a spell in and out at its edges so weather
   * arrives rather than appearing.
   */
  update(
    kind: WeatherKind,
    progress: number,
    deltaSeconds: number,
    cameraX: number,
    cameraZ: number,
    scene: THREE.Scene,
  ): void;
  dispose(): void;
}

export function createWeatherFx(): WeatherFx {
  const group = new THREE.Group();
  group.name = 'weather';

  // A streak, not a sphere: a falling drop is motion blur, and drawing it as
  // the blur costs three vertices instead of a lit ball nobody resolves.
  const geometry = new THREE.PlaneGeometry(0.012, 0.42);
  const material = new THREE.MeshBasicMaterial({
    color: '#AFC6DA',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rain = new THREE.InstancedMesh(geometry, material, DROPS);
  rain.frustumCulled = false;
  rain.count = 0;
  rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(rain);

  // Each drop keeps its own offset inside the box and its own speed; the box
  // moves with the camera and the drops wrap inside it.
  const offsets = new Float32Array(DROPS * 3);
  const speeds = new Float32Array(DROPS);
  for (let i = 0; i < DROPS; i++) {
    offsets[i * 3] = Math.random() * BOX - BOX / 2;
    offsets[i * 3 + 1] = Math.random() * BOX_HEIGHT;
    offsets[i * 3 + 2] = Math.random() * BOX - BOX / 2;
    speeds[i] = FALL_SPEED * (0.8 + Math.random() * 0.4);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 0, 1);

  /** Fog as the scene had it, so a spell can be undone exactly. */
  let baseNear = -1;
  let baseFar = -1;

  const update = (
    kind: WeatherKind,
    progress: number,
    deltaSeconds: number,
    cameraX: number,
    cameraZ: number,
    scene: THREE.Scene,
  ): void => {
    // Weather arrives and leaves rather than switching: a spell that appears
    // fully formed reads as a bug in the renderer.
    const edge = Math.min(1, Math.min(progress, 1 - progress) / 0.08);
    const wet = kind === 'rain' ? 0.7 : kind === 'storm' ? 1 : 0;
    const strength = wet * edge;

    if (strength <= 0.01) {
      rain.count = 0;
    } else {
      material.opacity = 0.42 * strength;
      const slant = kind === 'storm' ? STORM_SLANT : 0.08;
      quaternion.setFromAxisAngle(axis, slant);
      const wanted = Math.floor(DROPS * strength);

      for (let i = 0; i < wanted; i++) {
        // Fall, then wrap. Modulo rather than a reset test, so a frame that
        // took a long time does not leave a drop hanging mid-air.
        let y = (offsets[i * 3 + 1] as number) - (speeds[i] as number) * deltaSeconds;
        while (y < 0) y += BOX_HEIGHT;
        offsets[i * 3 + 1] = y;

        position.set(
          cameraX + (offsets[i * 3] as number),
          y,
          cameraZ + (offsets[i * 3 + 2] as number),
        );
        matrix.compose(position, quaternion, scale);
        rain.setMatrixAt(i, matrix);
      }
      rain.count = wanted;
      rain.instanceMatrix.needsUpdate = true;
    }

    // Fog is the scene's own, tightened. The sky layer owns its colour and
    // rewrites it every frame, so only the distances are touched here — writing
    // the colour too would be two systems fighting over one property.
    const fog = scene.fog;
    if (!(fog instanceof THREE.Fog)) return;
    if (baseNear < 0) {
      baseNear = fog.near;
      baseFar = fog.far;
    }
    const thick =
      kind === 'fog' ? 0.72 * edge : kind === 'storm' ? 0.4 * edge : kind === 'rain' ? 0.25 * edge : 0;
    fog.near = baseNear * (1 - thick * 0.9);
    fog.far = baseFar * (1 - thick * 0.72);
  };

  return {
    group,
    update,
    dispose: () => {
      rain.dispose();
      geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
