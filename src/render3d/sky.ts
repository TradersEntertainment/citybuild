import * as THREE from 'three';
import { HEIGHT_SCALE, WORLD_SIZE } from './constants';

/**
 * Sky, sun and atmosphere. Everything here is generated — a gradient shader for
 * the dome and analytic lights for the sun — so the project keeps its "no asset
 * files" rule while still reading as a real sky rather than a flat clear colour.
 *
 * The sun is the only shadow caster. One directional light with a tight
 * orthographic frustum around the play area buys the whole city contact shadows
 * for a single depth pass, which is the difference between "boxes floating on a
 * texture" and "buildings standing on ground".
 */
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
  uniform float time;
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

    // Clouds: the dome direction projected onto a plane overhead, drifting
    // slowly. A clear sky is a screensaver; moving weather is a place.
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
      colour = mix(colour, cloudColor, cloud * 0.85);
    }

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export interface SkyRig {
  readonly dome: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  /** Moves the sun; angle is time of day in radians, 0 = dawn, PI/2 = noon. */
  setSunAngle(angle: number): void;
  dispose(): void;
}

export function createSky(scene: THREE.Scene): SkyRig {
  const sunDirection = new THREE.Vector3(0.6, 0.75, 0.3).normalize();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color('#3574B4') },
      horizonColor: { value: new THREE.Color('#D8E4EC') },
      groundColor: { value: new THREE.Color('#8A8578') },
      sunDirection: { value: sunDirection.clone() },
      sunColor: { value: new THREE.Color('#FFEFC9') },
      time: { value: 0 },
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

  const sun = new THREE.DirectionalLight('#FFEDC4', 2.75);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.5;
  // The shadow frustum follows the camera target rather than covering the whole
  // 256² map: a map-wide frustum at this resolution gives shadows a staircase
  // edge, and nobody can see the far side of the city anyway.
  const extent = 140;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = HEIGHT_SCALE * 8 + extent * 3;
  scene.add(sun);
  scene.add(sun.target);

  // Sky bounce: without it, every north-facing wall is pure black and the city
  // reads as cardboard.
  const ambient = new THREE.HemisphereLight('#BFD8EE', '#6E6A5A', 1.15);
  scene.add(ambient);

  const setSunAngle = (angle: number): void => {
    sunDirection.set(Math.cos(angle) * 0.7, Math.max(0.12, Math.sin(angle)), 0.34).normalize();
    material.uniforms['sunDirection']!.value.copy(sunDirection);
  };
  setSunAngle(Math.PI * 0.4);

  return {
    dome,
    sun,
    ambient,
    setSunAngle,
    dispose: () => {
      scene.remove(dome, sun, sun.target, ambient);
      dome.geometry.dispose();
      material.dispose();
    },
  };
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

  const sunDir = (rig.dome.material as THREE.ShaderMaterial).uniforms['sunDirection']!
    .value as THREE.Vector3;
  const reach = HEIGHT_SCALE * 6;
  rig.sun.target.position.set(targetX, targetY, targetZ);
  rig.sun.target.updateMatrixWorld();
  rig.sun.position.set(
    targetX + sunDir.x * reach,
    targetY + sunDir.y * reach,
    targetZ + sunDir.z * reach,
  );
  rig.sun.updateMatrixWorld();
}
