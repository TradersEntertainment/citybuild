import * as THREE from 'three';
import { decodeTerrain, type TerrainKind } from '../sim/tiles';
import { index, isTileOwned, type World } from '../sim/world';
import { CHUNK_TILES, HEIGHT_SCALE, SEA_LEVEL, SEA_Y } from './constants';

/**
 * The height field as real ground (§4 data, §14 presentation). Built once as a
 * grid of chunk meshes: chunking is what lets the GPU throw away the two thirds
 * of a 256² map that is behind the camera, and lets an edit rebuild 32×32 tiles
 * instead of sixty-five thousand.
 *
 * Colour lives in vertex attributes rather than a texture, so the terrain needs
 * no image files and a tile's ground responds to fertility and height without a
 * second material.
 */
const GROUND_COLOURS: Record<TerrainKind, THREE.Color> = {
  water: new THREE.Color('#8A7F63'), // lake bed, seen through the water surface
  marsh: new THREE.Color('#5A6647'),
  plain: new THREE.Color('#6B7F49'),
  forest: new THREE.Color('#3E5733'),
  hill: new THREE.Color('#7A7355'),
  rock: new THREE.Color('#6E6B66'),
};

const SAND = new THREE.Color('#B6A57C');
const ROCK_HIGH = new THREE.Color('#8C8880');

export interface TerrainMesh {
  readonly group: THREE.Group;
  /**
   * Recolours the ground for the time of year (sim/seasons.ts).
   *
   * The ground is vertex-coloured and the material multiplies on top, so a
   * season is one colour assignment rather than a rebuild of every chunk. Values
   * above 1 are allowed and are what makes a winter *lighter* than a summer
   * instead of merely bluer.
   */
  setSeasonTint(tint: THREE.Color): void;
  /** Scene-space ground height at a fractional tile coordinate. */
  sample(tileX: number, tileY: number): number;
  /** Rebuilds the chunks covering a tile rectangle after an edit. */
  invalidate(x0: number, y0: number, x1: number, y1: number): void;
  rebuildAll(): void;
  dispose(): void;
}

export function createTerrain(world: World): TerrainMesh {
  const group = new THREE.Group();
  group.name = 'terrain';
  const chunksPerSide = Math.ceil(world.size / CHUNK_TILES);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
  });

  const chunks: THREE.Mesh[] = [];
  for (let cy = 0; cy < chunksPerSide; cy++) {
    for (let cx = 0; cx < chunksPerSide; cx++) {
      const mesh = new THREE.Mesh(buildChunkGeometry(world, cx, cy), material);
      mesh.receiveShadow = true;
      // Terrain casts too: without it a hill does not shade the valley it makes.
      mesh.castShadow = false;
      mesh.userData['cx'] = cx;
      mesh.userData['cy'] = cy;
      group.add(mesh);
      chunks[cy * chunksPerSide + cx] = mesh;
    }
  }

  const setSeasonTint = (tint: THREE.Color): void => {
    material.color.copy(tint);
  };

  const sample = (tileX: number, tileY: number): number => sampleHeight(world, tileX, tileY);

  const rebuildChunk = (cx: number, cy: number): void => {
    const mesh = chunks[cy * chunksPerSide + cx];
    if (!mesh) return;
    mesh.geometry.dispose();
    mesh.geometry = buildChunkGeometry(world, cx, cy);
  };

  return {
    group,
    sample,
    setSeasonTint,
    invalidate: (x0, y0, x1, y1) => {
      const cx0 = Math.max(0, Math.floor(x0 / CHUNK_TILES));
      const cy0 = Math.max(0, Math.floor(y0 / CHUNK_TILES));
      const cx1 = Math.min(chunksPerSide - 1, Math.floor(x1 / CHUNK_TILES));
      const cy1 = Math.min(chunksPerSide - 1, Math.floor(y1 / CHUNK_TILES));
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) rebuildChunk(cx, cy);
      }
    },
    rebuildAll: () => {
      for (let cy = 0; cy < chunksPerSide; cy++) {
        for (let cx = 0; cx < chunksPerSide; cx++) rebuildChunk(cx, cy);
      }
    },
    dispose: () => {
      for (const mesh of chunks) mesh.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}

/**
 * Raw height lookup with bilinear filtering. The grid stores one height per
 * tile; the mesh and the camera both want to ask about points between tiles,
 * and a nearest-neighbour answer makes the picker jump a whole tile at a time
 * on a slope.
 */
export function sampleHeight(world: World, tileX: number, tileY: number): number {
  const maxIndex = world.size - 1;
  const fx = clamp(tileX - 0.5, 0, maxIndex);
  const fy = clamp(tileY - 0.5, 0, maxIndex);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(maxIndex, x0 + 1);
  const y1 = Math.min(maxIndex, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const h00 = world.height[index(world, x0, y0)] ?? 0;
  const h10 = world.height[index(world, x1, y0)] ?? 0;
  const h01 = world.height[index(world, x0, y1)] ?? 0;
  const h11 = world.height[index(world, x1, y1)] ?? 0;

  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return (top + (bottom - top) * ty) * HEIGHT_SCALE;
}

/**
 * One chunk of ground, one vertex per tile corner. Chunks overlap by a row and
 * a column so neighbours share an edge exactly and no seam of background shows
 * between them.
 */
function buildChunkGeometry(world: World, cx: number, cy: number): THREE.BufferGeometry {
  const x0 = cx * CHUNK_TILES;
  const y0 = cy * CHUNK_TILES;
  const wide = Math.min(CHUNK_TILES, world.size - x0);
  const tall = Math.min(CHUNK_TILES, world.size - y0);
  const cols = wide + 1;
  const rows = tall + 1;

  const positions = new Float32Array(cols * rows * 3);
  const colours = new Float32Array(cols * rows * 3);
  const indices: number[] = [];
  const colour = new THREE.Color();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tileX = x0 + c;
      const tileY = y0 + r;
      const v = (r * cols + c) * 3;
      // Vertices sit on tile corners, so the height there is the average of the
      // (up to four) tiles that meet at that corner — this is what rounds the
      // terrain off instead of leaving it as a field of little plateaus.
      const h = cornerHeight(world, tileX, tileY);
      positions[v] = tileX;
      positions[v + 1] = h * HEIGHT_SCALE;
      positions[v + 2] = tileY;

      groundColour(world, tileX, tileY, h, colour);
      colours[v] = colour.r;
      colours[v + 1] = colour.g;
      colours[v + 2] = colour.b;
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Average of the tiles meeting at a corner, clamped at the map edge. */
function cornerHeight(world: World, tileX: number, tileY: number): number {
  const maxIndex = world.size - 1;
  let total = 0;
  let count = 0;
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 0; dx++) {
      const x = clamp(tileX + dx, 0, maxIndex);
      const y = clamp(tileY + dy, 0, maxIndex);
      total += world.height[index(world, x, y)] ?? 0;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

/**
 * Ground colour at a corner. Beaches, treelines and bare rock are all height
 * ramps rather than per-tile decisions, which is what stops the terrain reading
 * as a tile map with a 3D effect applied.
 */
function groundColour(
  world: World,
  tileX: number,
  tileY: number,
  height: number,
  out: THREE.Color,
): void {
  const maxIndex = world.size - 1;
  const x = clamp(tileX, 0, maxIndex);
  const y = clamp(tileY, 0, maxIndex);
  const i = index(world, x, y);
  const kind = decodeTerrain(world.terrain[i] ?? 0);
  const fertility = world.fertility[i] ?? 0;

  out.copy(GROUND_COLOURS[kind]);

  // Patchiness before anything else: one flat green makes a plain read as
  // felt. Two frequencies of stable variation — broad meadows, then a fine
  // grain — break it up without touching the palette's meaning.
  const meadow = hashUnit(Math.floor(x / 4), Math.floor(y / 4), 5) - 0.5;
  const grain = hashUnit(x, y, 11) - 0.5;
  out.offsetHSL(0, meadow * 0.05, meadow * 0.055 + grain * 0.03);

  // Fertile ground greens up; dry ground goes straw.
  if (kind === 'plain' || kind === 'hill') {
    out.lerp(new THREE.Color('#87994F'), fertility * 0.4);
  }
  // A sand band just above the waterline, so coasts have a shore.
  const aboveSea = height - SEA_LEVEL;
  if (aboveSea >= 0 && aboveSea < 0.035) {
    out.lerp(SAND, 1 - aboveSea / 0.035);
  } else if (aboveSea < 0) {
    out.lerp(SAND, 0.55);
  }
  // Bare rock takes over on the peaks.
  const bare = (height - 0.78) / 0.22;
  if (bare > 0) out.lerp(ROCK_HIGH, Math.min(1, bare) * 0.75);

  // Land the player has not bought reads as survey grey — present, but plainly
  // not theirs yet (§4).
  if (!isTileOwned(world, x, y)) {
    const grey = (out.r + out.g + out.b) / 3;
    out.lerp(new THREE.Color(grey * 0.85, grey * 0.86, grey * 0.82), 0.62);
  }
}

/** Flat, translucent water surface at sea level. */
export function createWater(world: World): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(world.size * 2, world.size * 2, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: '#2E5F82',
    roughness: 0.08,
    metalness: 0.15,
    transparent: true,
    opacity: 0.82,
  });

  // Animated surface: a static plane reads as wet cardboard. The waves are a
  // normal perturbation injected into the standard material, so fog, shadows
  // and tone mapping all keep working; the time uniform is wound by the
  // renderer every frame via the tick hook hung on the mesh.
  const clock = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['waterTime'] = clock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float waterTime;
varying vec3 vWaterWorld;
float waterHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x),
    mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float waterWave(vec2 p, float t) {
  return sin(p.x * 1.7 + t) * 0.32
       + sin(p.y * 2.3 - t * 1.25) * 0.28
       + waterNoise(p * 1.4 + vec2(t * 0.45, -t * 0.3)) * 0.4;
}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
{
  float t = waterTime * 0.85;
  vec2 wp = vWaterWorld.xz * 0.45;
  float e = 0.4;
  float hC = waterWave(wp, t);
  float hX = waterWave(wp + vec2(e, 0.0), t);
  float hZ = waterWave(wp + vec2(0.0, e), t);
  vec3 waveWorld = normalize(vec3((hC - hX) * 0.55, 1.0, (hC - hZ) * 0.55));
  normal = normalize((viewMatrix * vec4(waveWorld, 0.0)).xyz);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor + (waterNoise(vWaterWorld.xz * 1.8 + waterTime * 0.4) - 0.5) * 0.1,
  0.02,
  1.0
);`,
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(world.size / 2, SEA_Y, world.size / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'water';
  mesh.userData.tick = (seconds: number): void => {
    clock.value = seconds;
  };
  return mesh;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Stable 0..1 hash per tile — the same recipe the building tints use. */
function hashUnit(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
