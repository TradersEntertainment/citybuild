import * as THREE from 'three';
import { daylightAmount, nightAmount, sunHeight } from '../sim/daytime';
import { HEIGHT_SCALE, WORLD_SIZE } from './constants';

/**
 * The palette the day swings through. Kept here rather than in balance.ts
 * because these are colours, not tunables — the same reason the archetypes and
 * the road surfaces live beside the meshes that use them.
 */
const DAY_TOP = new THREE.Color('#3574B4');
const DAY_HORIZON = new THREE.Color('#D8E4EC');
const DAY_GROUND = new THREE.Color('#8A8578');
const NIGHT_TOP = new THREE.Color('#0A1330');
const NIGHT_HORIZON = new THREE.Color('#2A3A63');
const NIGHT_GROUND = new THREE.Color('#151C2C');
/** Dusk, which is where the low sun and the first lit windows overlap. */
const DUSK_HORIZON = new THREE.Color('#E09A5A');
const DAY_SUN = new THREE.Color('#FFEDC4');
const DUSK_SUN = new THREE.Color('#FF9A4E');
const MOON = new THREE.Color('#C4D2F0');
const DAY_BOUNCE = new THREE.Color('#BFD8EE');
const NIGHT_BOUNCE = new THREE.Color('#8792B8');
const SUN_INTENSITY = 2.75;
const AMBIENT_DAY = 1.15;

/**
 * The night, and why it is lit the way it is.
 *
 * A playtester reported the screen was simply not visible after dark, and they
 * were right: the whole night was one 0.34 hemisphere light tinted near-navy,
 * about a twelfth of the daytime total, with the directional light switched off
 * entirely — so no shadows, no lit faces, no silhouettes, nothing to read a
 * street by. The only remedy was the lighting programme, which unlocks at town.
 * That made the first hour of every game a game with the lights off.
 *
 * Legibility is a baseline, not a reward. The night is now about 40% of noon's
 * total light, and what the lighting programme buys is a night that looks
 * *bought* — brighter, warmer, obviously funded — rather than the difference
 * between seeing the city and not.
 */
/** Sky bounce at the bottom of the night, before anything is paid for. */
const AMBIENT_NIGHT = 0.72;
/** The moon, so there is still a key light — and therefore shape — after dark. */
const MOON_INTENSITY = 0.85;
/** How far the sun has to sink before the moon is at full strength. */
const MOON_RISE = 0.25;
/**
 * Extra sky bounce around the horizon crossing.
 *
 * The sun gives nothing below the horizon and the moon nothing above it, so the
 * two horizon crossings are the darkest moments of the whole cycle — darker
 * than midnight, which reads as the lights failing rather than as the day
 * ending. Measured: without this, dawn sits at 12% of noon against midnight's
 * 24%; with it, 19%. It softens the trough rather than removing it, and the
 * remaining dip is what the hour before sunrise is supposed to feel like.
 *
 * Real twilight is bright for the same reason this exists: the lit sky is an
 * enormous soft source even with the sun itself out of sight.
 */
const TWILIGHT_LIFT = 0.5;
/** How far either side of the horizon the twilight lift reaches. */
const TWILIGHT_SPAN = 0.3;
/**
 * How much a fully funded lighting programme lifts the night's sky bounce.
 *
 * The answer to "the night lasts too long and is boring": a dark third of every
 * year the player can spend their way out of. It used to double the bounce,
 * back when the unfunded night was too dark to play in and doubling it was the
 * only way out. Now that the baseline is legible on its own, a 60% lift is the
 * right size: still unmistakable from the map height the game is played at,
 * without making midnight brighter than noon.
 */
const LIGHTING_BOUNCE = 0.6;

/**
 * Sky, sun and atmosphere. Everything here is generated — a gradient shader for
 * the dome and analytic lights for the sun — so the project keeps its "no asset
 * files" rule while still reading as a real sky rather than a flat clear colour.
 *
 * The key light is the only shadow caster. One directional light with a tight
 * orthographic frustum around the play area buys the whole city contact shadows
 * for a single depth pass, which is the difference between "boxes floating on a
 * texture" and "buildings standing on ground".
 */

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vWorldDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // pin to the far plane
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform vec3 moonDirection;
  uniform vec3 moonColor;
  uniform float moon;
  uniform float time;
  uniform float night;
  varying vec3 vWorldDirection;

  // Cheap value noise, four octaves — enough for cloud shapes that read as
  // weather rather than as wallpaper.
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + vec2(17.0, 9.0);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDirection);
    float h = dir.y;

    // Two ramps: a wide one for the sky body, a tight one for the haze band that
    // sits on the horizon and sells the distance.
    vec3 sky = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55));
    vec3 below = mix(horizonColor, groundColor, pow(clamp(-h, 0.0, 1.0), 0.45));
    vec3 base = h > 0.0 ? sky : below;

    // Sun disc plus its bloom, so looking towards the light is not a flat patch.
    float cosAngle = dot(dir, normalize(sunDirection));
    float glow = pow(clamp(cosAngle, 0.0, 1.0), 220.0);
    float halo = pow(clamp(cosAngle, 0.0, 1.0), 6.0) * 0.22;
    vec3 colour = base + sunColor * (glow + halo);

    // The moon, on the same maths as the sun disc — it rides the anti-sun
    // direction, so it rises as the sun sets without a second clock to keep in
    // step. A wider, weaker halo than the sun's: it is a source you can look at.
    if (moon > 0.001) {
      float moonAngle = dot(dir, normalize(moonDirection));
      float disc = pow(clamp(moonAngle, 0.0, 1.0), 420.0);
      float moonHalo = pow(clamp(moonAngle, 0.0, 1.0), 14.0) * 0.16;
      colour += moonColor * (disc + moonHalo) * moon;
    }

    // Clouds: the dome direction projected onto a plane overhead, drifting
    // slowly. A clear sky is a screensaver; moving weather is a place.
    // Stars, before the clouds so a cloud can cover them. Hashed on a coarse
    // grid of the view direction: a real starfield would be a texture or a
    // point cloud, and both cost more than a game that never asks the player to
    // look up needs to spend.
    if (night > 0.01 && dir.y > 0.0) {
      vec2 grid = dir.xz / (dir.y + 0.35) * 34.0;
      vec2 cell = floor(grid);
      vec2 within = fract(grid) - 0.5;
      float pick = hash21(cell);
      if (pick > 0.86) {
        // Position jittered inside the cell, or the sky is graph paper.
        vec2 offset = vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5;
        float d = length(within - offset * 0.6);
        float star = smoothstep(0.09, 0.0, d);
        // Each one twinkles on its own phase, slowly.
        float twinkle = 0.65 + 0.35 * sin(time * 1.7 + pick * 40.0);
        // Fade the field out toward the horizon, where the haze owns the view.
        star *= smoothstep(0.03, 0.3, dir.y);
        colour += vec3(0.85, 0.9, 1.0) * star * twinkle * night * (pick - 0.86) * 7.0;
      }
    }

    if (dir.y > 0.015) {
      vec2 cloudUv = dir.xz / (dir.y + 0.22);
      cloudUv = cloudUv * 1.15 + vec2(time * 0.0062, time * 0.0024);
      float cover = fbm(cloudUv);
      float cloud = smoothstep(0.52, 0.74, cover);
      // Thin out toward the horizon, where haze owns the view anyway.
      cloud *= smoothstep(0.02, 0.2, dir.y);
      // Shading: darker bellies, lit crowns, and a warm tint toward the sun.
      float shade = fbm(cloudUv * 2.31 + 4.7);
      vec3 cloudColor = mix(vec3(0.82, 0.84, 0.88), vec3(1.08, 1.05, 1.0), shade);
      float sunAmt = pow(clamp(cosAngle, 0.0, 1.0), 3.0);
      cloudColor += sunColor * 0.14 * sunAmt;
      // A cloud is lit by the sun, so at night it is a dark shape against the
      // stars rather than the same white it was at noon.
      cloudColor = mix(cloudColor, vec3(0.07, 0.09, 0.15), night);
      colour = mix(colour, cloudColor, cloud * 0.85);
    }

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export interface SkyRig {
  readonly dome: THREE.Mesh;
  /**
   * The key light — the sun while it is up, the moon once it is not.
   *
   * One light rather than two because only one of them is ever above the
   * horizon, and a scene with two shadow-casting directionals pays for both
   * depth passes to get one set of doubled shadows. It is called `key` and not
   * `sun` for the same reason: it is the moon for a third of every day, and a
   * field named for the wrong half of its life is a trap for whoever reads it
   * next.
   */
  readonly key: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  /**
   * Where the key light is coming from, as a unit vector. Written by
   * `setDayFraction`, read by `updateSky` to place the light around the camera.
   */
  readonly keyDirection: THREE.Vector3;
  /**
   * Sets the time of day, 0..1 from the sim's clock. Moves the sun, dims it,
   * and swings the dome, the fog and the sky bounce from daylight to night.
   *
   * The only way to move the sun. There used to be a setSunAngle beside it that
   * clamped the sun's height above the horizon — harmless while it was the only
   * caller picking one fixed pleasant angle, and a silent fight with this one the
   * moment both existed, because a sun that cannot go below the horizon cannot
   * make a night.
   */
  setDayFraction(fraction: number): void;
  /**
   * How much the city has paid to light itself, 0..1 (sim/investments.ts).
   *
   * Lifts the sky bounce after dark. Without it a funded night is a field of
   * glowing dots over a black ground: the lamps get brighter and nothing they
   * are supposed to be lighting does.
   */
  setLighting(share: number): void;
  dispose(): void;
}

export function createSky(scene: THREE.Scene): SkyRig {
  const sunDirection = new THREE.Vector3(0.6, 0.75, 0.3).normalize();
  const moonDirection = sunDirection.clone().negate();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color('#3574B4') },
      horizonColor: { value: new THREE.Color('#D8E4EC') },
      groundColor: { value: new THREE.Color('#8A8578') },
      sunDirection: { value: sunDirection.clone() },
      sunColor: { value: new THREE.Color('#FFEFC9') },
      moonDirection: { value: new THREE.Vector3(0, -1, 0) },
      moonColor: { value: MOON.clone() },
      moon: { value: 0 },
      time: { value: 0 },
      night: { value: 0 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  dome.frustumCulled = false;
  // Drawn first, with depth off, so it costs one full-screen fill and nothing else.
  dome.renderOrder = -1000;
  scene.add(dome);

  // Distance haze tinted to the horizon band, so far districts fade into the sky
  // instead of ending at a hard line.
  scene.fog = new THREE.Fog('#D8E4EC', WORLD_SIZE * 0.5, WORLD_SIZE * 1.9);

  const key = new THREE.DirectionalLight('#FFEDC4', SUN_INTENSITY);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.5;
  // The shadow frustum follows the camera target rather than covering the whole
  // 256² map: a map-wide frustum at this resolution gives shadows a staircase
  // edge, and nobody can see the far side of the city anyway.
  const extent = 140;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = HEIGHT_SCALE * 8 + extent * 3;
  scene.add(key);
  scene.add(key.target);

  /** Where the key light comes from; the anti-sun once the sun is down. */
  const keyDirection = sunDirection.clone();

  // Sky bounce: without it, every north-facing wall is pure black and the city
  // reads as cardboard.
  const ambient = new THREE.HemisphereLight('#BFD8EE', '#6E6A5A', 1.15);
  scene.add(ambient);

  // Scratch colours, so a per-frame lerp allocates nothing.
  const top = new THREE.Color();
  const horizon = new THREE.Color();
  const ground = new THREE.Color();
  const sunTint = new THREE.Color();

  /** Held between frames, because the sky is re-tinted on the day clock. */
  let lighting = 0;
  let lastFraction = 0;

  const setLighting = (share: number): void => {
    const next = Math.max(0, Math.min(1, share));
    if (next === lighting) return;
    lighting = next;
    setDayFraction(lastFraction);
  };

  const setDayFraction = (fraction: number): void => {
    lastFraction = fraction;
    const height = sunHeight(fraction);
    const night = nightAmount(fraction);
    const daylight = daylightAmount(fraction);

    // The sun tracks a full circle. Horizontal component swings east to west so
    // shadows sweep across the city over the day rather than pivoting in place.
    const travel = (fraction - 0.5) * Math.PI;
    sunDirection.set(Math.sin(travel) * 0.85, height, Math.cos(travel) * 0.34).normalize();
    material.uniforms['sunDirection']!.value.copy(sunDirection);

    // The moon is the anti-sun: opposite the sky, so it is exactly as far above
    // the horizon as the sun is below it and needs no clock of its own. The
    // shared direction flips through 180° at the crossing, which would be a
    // visible jump in the shadows if the moon were lit then — it ramps from
    // zero at the horizon precisely so it is not.
    const moon = clamp01(-height / MOON_RISE);
    moonDirection.copy(sunDirection).negate();
    material.uniforms['moonDirection']!.value.copy(moonDirection);
    material.uniforms['moon']!.value = moon;
    keyDirection.copy(height >= 0 ? sunDirection : moonDirection);

    // Dusk reddens the light and the horizon: the sun's colour is a function of
    // how much atmosphere it is shining through, which is what low means.
    const low = 1 - Math.min(1, Math.max(0, height / 0.35));
    sunTint.copy(DAY_SUN).lerp(DUSK_SUN, low);
    material.uniforms['sunColor']!.value.copy(sunTint);
    // The key light follows the tint while the sun owns it and cools to
    // moonlight after — an orange moon would read as a permanent sunset.
    rig.key.color.copy(sunTint).lerp(MOON, moon);
    rig.key.intensity = SUN_INTENSITY * daylight + MOON_INTENSITY * moon;

    top.copy(DAY_TOP).lerp(NIGHT_TOP, night);
    horizon.copy(DAY_HORIZON).lerp(NIGHT_HORIZON, night);
    // Dusk pushes the horizon band warm before the night takes it dark.
    horizon.lerp(DUSK_HORIZON, low * (1 - night) * 0.8);
    ground.copy(DAY_GROUND).lerp(NIGHT_GROUND, night);
    material.uniforms['topColor']!.value.copy(top);
    material.uniforms['horizonColor']!.value.copy(horizon);
    material.uniforms['groundColor']!.value.copy(ground);

    material.uniforms['night']!.value = night;

    // Haze matches the horizon, or the far districts fade into yesterday's sky.
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(horizon);

    // Sky bounce is what keeps a night city from being pure black silhouettes.
    //
    // A floor lifted by daylight, not two ramps added together. The old form
    // was `AMBIENT_DAY * daylight + AMBIENT_NIGHT * night`, and those two ramps
    // are not complements: daylight is already zero at the horizon while night
    // is only four tenths of the way in, so their sum had a trough exactly at
    // sunset. Written this way the fill can only rise with the sun, and the
    // twilight lift fills the stretch where neither the sun nor the moon is
    // contributing anything.
    const twilight = clamp01(1 - Math.abs(height) / TWILIGHT_SPAN);
    ambient.intensity =
      AMBIENT_NIGHT * (1 + lighting * LIGHTING_BOUNCE * night) +
      (AMBIENT_DAY - AMBIENT_NIGHT) * daylight +
      TWILIGHT_LIFT * twilight;
    ambient.color.copy(DAY_BOUNCE).lerp(NIGHT_BOUNCE, night);
  };

  const rig: SkyRig = {
    dome,
    setLighting,
    key,
    keyDirection,
    ambient,
    setDayFraction,
    dispose: () => {
      scene.remove(dome, key, key.target, ambient);
      dome.geometry.dispose();
      material.dispose();
    },
  };

  setDayFraction(0.5);
  return rig;
}

/**
 * Keeps the sky dome on the camera and the shadow frustum over whatever the
 * player is looking at. Called once per frame from the renderer.
 */
export function updateSky(
  rig: SkyRig,
  camera: THREE.Camera,
  targetX: number,
  targetY: number,
  targetZ: number,
): void {
  rig.dome.position.copy(camera.position);
  // Weather moves; rendering time, not sim time, so pausing the city pauses
  // nothing in the sky.
  (rig.dome.material as THREE.ShaderMaterial).uniforms['time']!.value =
    performance.now() / 1000;

  // The rig's own vector, not the shader's sun uniform: after dark the light
  // comes from the moon and the uniform still points at the sun, under the map.
  // Reading the uniform used to be harmless because it was the same direction;
  // it would now put the key light below the ground and light every roof from
  // underneath.
  const dir = rig.keyDirection;
  const reach = HEIGHT_SCALE * 6;
  rig.key.target.position.set(targetX, targetY, targetZ);
  rig.key.target.updateMatrixWorld();
  rig.key.position.set(
    targetX + dir.x * reach,
    targetY + dir.y * reach,
    targetZ + dir.z * reach,
  );
  rig.key.updateMatrixWorld();
}
