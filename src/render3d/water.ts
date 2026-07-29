import * as THREE from 'three';
import { index, type World } from '../sim/world';
import { CAMERA_FOV, HEIGHT_SCALE, SEA_LEVEL, SEA_Y } from './constants';

/**
 * The sea, the lakes and the rivers — one plane, drawn as water rather than as
 * a blue lid.
 *
 * What replaced what. The old surface (terrain.ts) was a flat MeshStandardMaterial
 * with a normal perturbed by three sine-based noise samples per fragment: one
 * spatial frequency, one colour, one opacity, everywhere. At grazing angles a
 * single frequency reads as corduroy, and a bay is exactly as dark at the beach
 * as it is a kilometre out. This file keeps the one thing that surface got right
 * — it is a *patched standard material*, not a custom ShaderMaterial, so fog,
 * shadows, tone mapping and whatever the shadow rig injects all keep working —
 * and replaces everything else.
 *
 * Four things make water read as water, and three of them come from the height
 * field the sim already owns:
 *
 * **Depth.** `world.height` is read once into a small tile-space field texture.
 * Shallow water is bright and see-through, deep water is dark and opaque. This
 * is the single biggest change: a coastline stops being an outline and becomes
 * a shelf. Measured across five seeds, water covers 12–52% of a map and its
 * depth runs 0.3–11 world units (2–87 m at 8 m per tile), with the median
 * between 1.5 and 3.3 — so the ramp is sized to saturate a basin while leaving
 * the shelf and the river beds in the light half of it.
 *
 * **A shoreline.** The same bake stores distance-to-land, from a chamfer
 * transform over the water mask. That is what draws the surf: a band roughly
 * 1.5 tiles wide, which is about 10% of the water surface — a ribbon on the
 * coast rather than a wash across the bay.
 *
 * **Motion with more than one scale.** Two layers of one generated, tiling
 * normal map, at different sizes, drifting at different speeds and directions.
 * Two frequencies is the smallest number that stops the pattern reading as a
 * pattern. The map's alpha channel carries the height that generated the
 * normal, so the surf gets its churn from a fetch the waves have already paid
 * for.
 *
 * **Sky.** The scene has no environment map, so three's indirect specular
 * returns black and every `metalness` in the project is a pure darkening term.
 * Rather than fake a reflection on top of the lighting, this file feeds an
 * analytic sky into `radiance` — the exact variable an env map would have
 * written — and lets the material's own split-sum environment BRDF apply
 * Fresnel, roughness and F0. Overhead the water is 4% reflective and you see
 * the bed; toward the horizon it turns mirror. That is Fresnel doing it, not a
 * curve fitted to look like Fresnel.
 *
 * Nothing here has been measured for frame rate — this repository's environment
 * runs SwiftShader at one or two frames a second. What can be counted is:
 * 2 texture fetches per water fragment on the low tier and 3 on the others,
 * against roughly twenty-two `sin` calls per fragment in the surface it
 * replaces; and 371–699 KB of generated texture, against a 2048² shadow map's
 * 16 MB. No asset files, no render targets, no extra passes, no extra draw
 * calls: it is still one plane, drawn once.
 */

// --- Geometry ----------------------------------------------------------------

/**
 * How many map widths of water to draw, centred on the map.
 *
 * Two, as before. The map is 256 tiles and the camera can see past its edge, so
 * the plane has to run out beyond it or a coastal city ends at a cliff of
 * background colour. Everything past the map is treated as open sea by the
 * shader — see the edge fade below.
 */
const SPAN_IN_MAPS = 2;

// --- The baked field ---------------------------------------------------------

/**
 * Depth at which water stops getting any darker, in world units (~32 m).
 *
 * Measured over five seeds: the median water tile is 1.5–3.3 units deep and the
 * 75th percentile 2.7–5.6, so four saturates the open basins while leaving the
 * coastal shelf, the river beds (carved to about 0.26 units) and the harbour
 * approaches spread across the light end of the ramp. Raising it flattens the
 * bays; lowering it makes everything but the beach one colour.
 */
const DEEP_AT = 4;

/**
 * Width of the surf band, in tiles (~12 m).
 *
 * Measured: 1.5 tiles catches about 10% of the water surface on a typical seed.
 * It is a coastline, so it wants to be a ribbon — at 4 tiles roughly a third of
 * every bay is foam, which reads as an algal bloom.
 */
const FOAM_SPAN = 1.5;

/**
 * Distance from land at which water counts as fully open, in tiles (~48 m).
 *
 * Drives wave amplitude: a millpond and the Aegean should not have the same
 * chop. Six tiles means a two-tile river is almost glassy and anything past a
 * small harbour basin gets the full swell.
 */
const SHELTER_SPAN = 6;

/** Diagonal step of the chamfer distance transform. */
const CHAMFER_DIAGONAL = Math.SQRT2;

// --- Colour ------------------------------------------------------------------
// Colours, not tunables — the same exception sky.ts claims for its palette, and
// for the same reason: they are picked by eye against the ground palette in
// terrain.ts, not derived from anything.

/** Shelf and river water, over the tan lake bed terrain.ts draws under it. */
const SHALLOW = new THREE.Color('#5FB2A6');
/** Open basin. */
const DEEP = new THREE.Color('#123C5C');
/** Surf. Not pure white: foam is aerated water and picks up the sky. */
const FOAM = new THREE.Color('#E4EFF2');

/** How much of the bed shows through at the shore and out in the deep. */
const ALPHA_SHALLOW = 0.4;
const ALPHA_DEEP = 0.94;

/**
 * Bias of the depth ramp. Slightly below 1, so a bay reads as a body of water
 * and only the shelf reads as shallow; at 1 the whole of a wide bay sits in the
 * mid-tone and the two colours never quite land.
 */
const DEPTH_CURVE = 0.8;

// --- Waves -------------------------------------------------------------------
// Scales are texture repeats per world unit; one tile is one world unit is
// about 8 m. Drifts are repeats per second, which is why the world speed is
// spelled out beside each: a wave that moves at the wrong speed is the fastest
// way to make a big sea look like a small puddle.

/** Swell: one repeat every ~16.7 tiles (133 m). */
const SWELL_SCALE = 0.06;
/** Swell drift, ~0.14 tiles/s — about 1.1 m/s. */
const SWELL_DRIFT_U = 0.0075;
const SWELL_DRIFT_V = 0.0042;
/** How far the swell tilts the surface. Slope, so 0.16 is about 9°. */
const SWELL_AMPLITUDE = 0.16;

/** Chop: one repeat every ~4.5 tiles (36 m), crossing the swell. */
const CHOP_SCALE = 0.22;
/** Chop drift, ~0.24 tiles/s — about 1.9 m/s. */
const CHOP_DRIFT_U = -0.03;
const CHOP_DRIFT_V = 0.044;
const CHOP_AMPLITUDE = 0.11;

/** Wave amplitude in fully sheltered water, as a fraction of the open sea's. */
const SHELTERED_CALM = 0.45;

// --- Surf --------------------------------------------------------------------

/** Where in the band the foam breaks, and how softly. */
const SURF_CUT = 0.52;
const SURF_SOFT = 0.22;
/** How hard the wave height pushes the break line about. */
const SURF_CHURN = 0.85;
/**
 * The unconditional line at the waterline, as a fraction of the surf band —
 * about 0.24 tiles, 2 m. Keeps a coast legible when the whole band is a couple
 * of pixels wide at map height.
 */
const WATERLINE = 0.16;

// --- Surface response --------------------------------------------------------

/** Open water. Low, because water is smooth; the *waves* supply the breakup. */
const BASE_ROUGHNESS = 0.075;
/** Foam is aerated and scatters — the one part of the sea that is not a mirror. */
const FOAM_ROUGHNESS = 0.92;
/**
 * Roughness for water whose waves have mipped away to flat.
 *
 * A mipped normal map averages toward flat, but the roughness that described
 * those normals does not follow it — so far water becomes smooth and shiny and
 * sparkles a pixel at a time. Putting the lost normal variance back as
 * roughness is the standard remedy and is why the detail fade exists at all.
 */
const FAR_ROUGHNESS = 0.34;

/**
 * Dielectric F0 — the fraction reflected head-on.
 *
 * 0.04 rather than water's true 0.02, because 0.04 is what three's standard
 * material assumes for a non-metal and this term decides only the *opacity*.
 * Using the same number means what the surface hides and what it reflects
 * cannot disagree.
 */
const DIELECTRIC_F0 = 0.04;

/**
 * Metalness is zero and stays zero.
 *
 * The metallic lobe is fed by the environment. With no env map in the scene it
 * returns black, so a non-zero metalness only moves energy out of the diffuse
 * and into nothing — it makes water *darker and deader*, not shinier. The sky
 * this file supplies goes into the dielectric specular path instead, which is
 * what water actually is.
 */
const METALNESS = 0;

/** How far past the map edge the field fades to open sea, in tiles. */
const EDGE_FADE_TILES = 6;

// --- Reflection --------------------------------------------------------------

/**
 * The dome's own ramp exponent (sky.ts). Shared deliberately: the sky in the
 * water has to be the sky overhead, and two ramps drifting apart is how a
 * reflection starts looking painted on.
 */
const SKY_RAMP = 0.55;
/** The sun's halo, matching the dome's `pow(cos, 6) * 0.22`. */
const HALO_POWER = 6;
const HALO_STRENGTH = 0.22;

// --- Detail fade -------------------------------------------------------------

/**
 * Device pixels the finest wave feature has to cover before it is worth
 * drawing, and where it is fully paid for.
 *
 * The chop layer's finest octave is one twelfth of its repeat, so about 0.38
 * world units. At the default camera (distance 34, 45° vertical FOV) on a
 * 390x780 phone at DPR 2 that is 21 device pixels — full detail. Wound out to
 * ZOOM_MIN it falls to about 5, and at DPR 1 to about 2, which is where the
 * fade earns its keep.
 */
const DETAIL_FADE_LOW = 2;
const DETAIL_FADE_HIGH = 6;
/** Lattice period of the chop layer's finest octave, from the bake below. */
const FINEST_OCTAVE = 12;

// --- The generated wave map --------------------------------------------------

/**
 * Long crossing swell lines as (u repeats, v repeats, amplitude).
 *
 * Integer repeats, so each one closes exactly across the texture — the whole
 * reason the map tiles at all. Two of them at an angle is what gives the sea a
 * direction; noise alone has none and reads as static.
 *
 * The amplitudes are deliberately below the octaves' — a sine's gradient scales
 * with its frequency, so at 0.55 these two carried about twice the slope of all
 * three noise octaves put together and the open sea came out as corduroy. That
 * is the exact failure the surface this file replaces had, arrived at from the
 * other direction. They are here to bias the noise, not to be seen.
 */
const SWELL_LINES: readonly (readonly [number, number, number])[] = [
  [1, 2, 0.2],
  [2, -1, 0.1],
];

/**
 * Chop octaves as lattice periods and amplitudes.
 *
 * Fixed rather than derived from the texture size, so changing the quality tier
 * changes how finely the sea is *resolved* and not how choppy it is. The finest
 * period is 12, which is still five texels per lattice cell on the smallest
 * (64²) map.
 */
const CHOP_OCTAVES: readonly (readonly [number, number])[] = [
  [3, 0.34],
  [6, 0.19],
  [12, 0.1],
];

/**
 * Root-mean-square slope the baked normals are scaled to.
 *
 * Self-calibration, and it is load-bearing: without it a 64² map and a 256² map
 * hand the shader different wave steepness, because a finer grid resolves
 * steeper gradients from the same height field — so changing the quality tier
 * would visibly change the state of the sea. Normalising against the field's
 * own RMS makes the amplitude constants above mean one thing at every size.
 */
const TARGET_SLOPE = 0.5;

// --- Quality -----------------------------------------------------------------

/**
 * The graphics tier. There is no shared tier enum in the project yet; when one
 * lands in src/data/balance.ts this type should become an alias of it and the
 * table below should move there with it (AGENTS.md: tunables are not inline).
 * The names are the same words a settings control would use.
 */
export type WaterQuality = 'low' | 'medium' | 'high';

interface Tier {
  /** Wave layers sampled per fragment. One is swell only: no chop, no churn. */
  readonly layers: 1 | 2;
  /** Side of the generated wave map, in texels. */
  readonly wavePixels: number;
  /** Anisotropic taps. Water is seen at grazing angles almost exclusively. */
  readonly anisotropy: number;
}

/**
 * What each tier costs, in the only units this environment can honestly report.
 *
 * `low`:    2 fetches/fragment, 371 KB of texture (21.8 + 349.5 with mips)
 * `medium`: 3 fetches/fragment, 437 KB (87.4 + 349.5)
 * `high`:   3 fetches/fragment, 699 KB (349.5 + 349.5)
 *
 * The field texture is 349.5 KB of that in every tier and is not optional: it
 * is the depth ramp and the shoreline, which are most of what makes this read
 * as water, and it is one fetch either way.
 */
const TIERS: Record<WaterQuality, Tier> = {
  low: { layers: 1, wavePixels: 64, anisotropy: 1 },
  medium: { layers: 2, wavePixels: 128, anisotropy: 4 },
  high: { layers: 2, wavePixels: 256, anisotropy: 8 },
};

/**
 * Where a fresh install starts.
 *
 * `medium`, not `low`. Unlike a post-process chain this layer adds no pass, no
 * render target and no draw call — the difference between the tiers is one
 * texture fetch and about a dozen ALU over the water in frame, which is a small
 * fraction of a screen in most cities. `low` exists for the phone that needs
 * it, and it keeps the depth ramp and the shoreline, which are the parts worth
 * keeping.
 */
export const DEFAULT_WATER_QUALITY: WaterQuality = 'medium';

// --- Public shape ------------------------------------------------------------

/**
 * What the sky is doing this frame. Every field is read-only and every one of
 * them already exists on the sky rig, so the two cannot disagree about the time
 * of day — which is the same guarantee renderer.ts makes for the windows, the
 * lamps and the ledger by reading one clock per frame.
 */
export interface WaterSky {
  /** `SkyRig.keyDirection` — the sun by day, the moon after dark. */
  readonly keyDirection: THREE.Vector3;
  /** `SkyRig.key.color`. */
  readonly keyColour: THREE.Color;
  /** `SkyRig.key.intensity`. */
  readonly keyIntensity: number;
  /**
   * The sky's horizon band — `scene.fog.color`, which sky.ts rewrites every
   * frame. Taking it from the fog rather than re-deriving it means the water's
   * reflected horizon and the haze the far shore fades into are the same colour
   * by construction.
   */
  readonly horizon: THREE.Color;
  /** The upper sky — `SkyRig.ambient.color`, the sky half of the bounce. */
  readonly zenith: THREE.Color;
}

export interface WaterLayer {
  /** Holds the surface. Add it to the scene once. */
  readonly group: THREE.Group;
  readonly quality: WaterQuality;
  /**
   * Re-bakes the depth and shoreline field from `world.height`.
   *
   * Call whenever the terrain changes, and on `webglcontextrestored` — the
   * re-bake also flags the texture for re-upload, which is what a restored
   * context needs.
   */
  rebuild(): void;
  /**
   * Per frame, after the sky has been updated (it reads the colours the sky
   * just wrote) and before the scene is drawn.
   *
   * `seconds` is wall clock, not sim time: the sea keeps moving while the city
   * is paused, for the same reason the clouds do.
   */
  update(seconds: number, cameraDistance: number, sky: WaterSky): void;
  /**
   * Tells the layer how tall the drawing buffer is, in device pixels, so the
   * wave detail fade can be decided in pixels rather than in guesses. Call from
   * `Renderer.resize` after `setSize`, and once at start-up.
   */
  resize(drawingBufferHeight: number): void;
  setQuality(quality: WaterQuality): void;
  dispose(): void;
}

export function createWater(
  world: World,
  quality: WaterQuality = DEFAULT_WATER_QUALITY,
): WaterLayer {
  const group = new THREE.Group();
  group.name = 'water';

  let tier: WaterQuality = quality;

  // --- The field: depth, distance to shore, openness -------------------------
  // RGBA rather than R8 or RG8: three channels are wanted, and RGBA is the one
  // layout with no row-alignment trap at any map size. 256² is one texel per
  // tile, which is the resolution the data has — the height field is per-tile.
  const fieldData = new Uint8Array(world.size * world.size * 4);
  const field = new THREE.DataTexture(
    fieldData,
    world.size,
    world.size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  field.wrapS = THREE.ClampToEdgeWrapping;
  field.wrapT = THREE.ClampToEdgeWrapping;
  field.magFilter = THREE.LinearFilter;
  // Mipped, because at map height one texel is well under a pixel and an
  // unmipped shoreline band crawls. Averaging depth and distance is meaningful,
  // which is why this is safe to mip and a colour lookup table would not be.
  field.minFilter = THREE.LinearMipmapLinearFilter;
  field.generateMipmaps = true;
  // Distances and depths, not colour. An sRGB decode would bend both.
  field.colorSpace = THREE.NoColorSpace;

  const rebuild = (): void => {
    bakeField(world, fieldData);
    field.needsUpdate = true;
  };
  rebuild();

  // --- The wave map ---------------------------------------------------------
  let waves = buildWaveTexture(TIERS[tier].wavePixels, TIERS[tier].anisotropy);

  // --- Uniforms -------------------------------------------------------------
  // Held as objects so `update` can write `.value` without touching the shader.
  const uniforms = {
    waterField: { value: field } as THREE.IUniform<THREE.Texture>,
    waterWaves: { value: waves } as THREE.IUniform<THREE.Texture>,
    /** Tile coordinate to field UV. Tile space is 0..size, so this is 1/size. */
    waterFieldStep: { value: 1 / world.size } as THREE.IUniform<number>,
    /**
     * Wave scroll, wrapped into 0..1 on the CPU.
     *
     * The map repeats every unit of UV, so subtracting whole repeats changes
     * nothing — and it is the difference between a sea that still moves after an
     * hour and one that visibly quantises, because an hour of `performance.now()`
     * fed straight into a float texture coordinate has lost its low bits.
     */
    waterSwellOffset: { value: new THREE.Vector2() } as THREE.IUniform<THREE.Vector2>,
    waterChopOffset: { value: new THREE.Vector2() } as THREE.IUniform<THREE.Vector2>,
    /** 0..1: how much of the fine wave detail is worth drawing at this zoom. */
    waterDetail: { value: 1 } as THREE.IUniform<number>,
    waterShallow: { value: SHALLOW.clone() } as THREE.IUniform<THREE.Color>,
    waterDeep: { value: DEEP.clone() } as THREE.IUniform<THREE.Color>,
    waterFoam: { value: FOAM.clone() } as THREE.IUniform<THREE.Color>,
    // Seeds only — a noon sky, so a frame drawn before the first `update` is
    // still water. The sky rig owns these colours and overwrites both every
    // frame; this file must never become a second place they are decided.
    waterHorizon: { value: new THREE.Color('#D8E4EC') } as THREE.IUniform<THREE.Color>,
    waterZenith: { value: new THREE.Color('#BFD8EE') } as THREE.IUniform<THREE.Color>,
    /**
     * Key colour times key intensity — radiance, which is what a reflection
     * wants. Premultiplied here so the shader carries one uniform, not two.
     */
    waterSun: { value: new THREE.Color('#FFEDC4') } as THREE.IUniform<THREE.Color>,
    waterSunDirection: { value: new THREE.Vector3(0, 1, 0) } as THREE.IUniform<THREE.Vector3>,
  };

  // --- Material -------------------------------------------------------------
  const material = new THREE.MeshStandardMaterial({
    // The un-patched look, if the injection below ever fails to find an anchor:
    // still water, just flat water. Every one of these is overwritten per
    // fragment by the shader.
    color: DEEP.clone().lerp(SHALLOW, 0.35),
    roughness: BASE_ROUGHNESS,
    metalness: METALNESS,
    transparent: true,
    opacity: 0.85,
  });
  // The tier lives in `defines`, which three already folds into the program
  // cache key — so a tier change plus `needsUpdate` recompiles correctly, with
  // no `customProgramCacheKey` to keep in step. Spread rather than replace:
  // MeshStandardMaterial ships a STANDARD define of its own.
  const applyDefines = (): void => {
    material.defines = { ...material.defines, WATER_LAYERS: TIERS[tier].layers };
  };
  applyDefines();
  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      shader.uniforms[name] = uniform;
    }
    patchWater(shader);
  };

  // Two triangles. The surface is flat and every term here is per-fragment, so
  // tessellation would buy nothing: three interpolates the world position and
  // the fog depth perspective-correctly, and both are affine in world space, so
  // four vertices reproduce them exactly.
  const geometry = new THREE.PlaneGeometry(
    world.size * SPAN_IN_MAPS,
    world.size * SPAN_IN_MAPS,
    1,
    1,
  );
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  // Tile space: the map runs 0..size and the plane is centred on it. No world
  // half-offset anywhere, which is what lets the shader treat position.xz as
  // the tile coordinate and index the field with nothing but a scale.
  mesh.position.set(world.size / 2, SEA_Y, world.size / 2);
  mesh.receiveShadow = true;
  // Kept from the surface this replaces: transparent and drawn after the
  // opaque city, so a hull or a bridge pier in the water sorts correctly.
  mesh.renderOrder = 1;
  group.add(mesh);

  // --- Detail fade ----------------------------------------------------------
  /** Drawing buffer height in device pixels; corrected by the first resize. */
  let bufferHeight = 1080;
  let distance = 0;

  const refreshDetail = (): void => {
    // World units one device pixel covers at the camera target.
    const perPixel = (2 * distance * Math.tan((CAMERA_FOV * Math.PI) / 360)) / bufferHeight;
    if (!(perPixel > 0)) {
      uniforms.waterDetail.value = 1;
      return;
    }
    const finest = 1 / (CHOP_SCALE * FINEST_OCTAVE);
    uniforms.waterDetail.value = smoothstep(DETAIL_FADE_LOW, DETAIL_FADE_HIGH, finest / perPixel);
  };

  /** Scratch, so the per-frame sun premultiply allocates nothing. */
  const sunScratch = new THREE.Color();

  const update = (seconds: number, cameraDistance: number, sky: WaterSky): void => {
    uniforms.waterSwellOffset.value.set(
      wrapUnit(SWELL_DRIFT_U * seconds),
      wrapUnit(SWELL_DRIFT_V * seconds),
    );
    uniforms.waterChopOffset.value.set(
      wrapUnit(CHOP_DRIFT_U * seconds),
      wrapUnit(CHOP_DRIFT_V * seconds),
    );

    if (cameraDistance !== distance) {
      distance = cameraDistance;
      refreshDetail();
    }

    uniforms.waterHorizon.value.copy(sky.horizon);
    uniforms.waterZenith.value.copy(sky.zenith);
    uniforms.waterSunDirection.value.copy(sky.keyDirection);
    sunScratch.copy(sky.keyColour).multiplyScalar(Math.max(0, sky.keyIntensity));
    uniforms.waterSun.value.copy(sunScratch);
  };

  const setQuality = (next: WaterQuality): void => {
    if (next === tier) return;
    const before = TIERS[tier];
    tier = next;
    const after = TIERS[tier];
    if (after.wavePixels !== before.wavePixels || after.anisotropy !== before.anisotropy) {
      // Replaced rather than re-filled: the size changes, so the old upload is
      // no longer the right shape and has to go back to the driver.
      waves.dispose();
      waves = buildWaveTexture(after.wavePixels, after.anisotropy);
      uniforms.waterWaves.value = waves;
    }
    applyDefines();
    // The live program was compiled against the old layer count; three only
    // recompiles when it is told to.
    material.needsUpdate = true;
    refreshDetail();
  };

  return {
    group,
    get quality(): WaterQuality {
      return tier;
    },
    rebuild,
    update,
    resize: (drawingBufferHeight: number) => {
      bufferHeight = Math.max(1, drawingBufferHeight);
      refreshDetail();
    },
    setQuality,
    dispose: () => {
      group.remove(mesh);
      geometry.dispose();
      material.dispose();
      field.dispose();
      waves.dispose();
      group.clear();
    },
  };
}

// --- The shader --------------------------------------------------------------

/**
 * Patches the standard material rather than replacing it.
 *
 * Every injection is an *append* to an existing chunk, never a rewrite of one,
 * so fog, the shadow lookup, tone mapping and any gate another rig injects all
 * survive untouched. Order matters and follows meshphysical's own: the preamble
 * runs before `<map_fragment>` and fills a handful of globals that the colour,
 * roughness, normal and lighting chunks after it read. Sampling the waves once,
 * early, is why the normal and the surf cost one fetch between them instead of
 * two.
 */
function patchWater(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vWaterWorld;`)
    .replace(
      '#include <worldpos_vertex>',
      // Computed here rather than read from `worldPosition`: that variable only
      // exists when shadows, env maps or spot lights have asked for it, and the
      // water must not depend on which of those the scene happens to have.
      `#include <worldpos_vertex>\n\tvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${WATER_COMMON}`)
    .replace('#include <map_fragment>', `${WATER_PREAMBLE}\n#include <map_fragment>`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${WATER_COLOUR}`)
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>\n${WATER_ROUGHNESS}`,
    )
    .replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>\n${WATER_NORMAL}`,
    )
    .replace(
      '#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>\n${WATER_RADIANCE}`,
    );
}

/**
 * GLSL float literal.
 *
 * `1` is an integer in GLSL and will not implicitly convert, so a constant that
 * happens to be whole would fail to compile on some drivers and not others.
 */
function glsl(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

const WATER_COMMON = /* glsl */ `
uniform sampler2D waterField;
uniform sampler2D waterWaves;
uniform float waterFieldStep;
uniform vec2 waterSwellOffset;
uniform vec2 waterChopOffset;
uniform float waterDetail;
uniform vec3 waterShallow;
uniform vec3 waterDeep;
uniform vec3 waterFoam;
uniform vec3 waterHorizon;
uniform vec3 waterZenith;
uniform vec3 waterSun;
uniform vec3 waterSunDirection;
varying vec3 vWaterWorld;

// Filled by the preamble, read by every chunk after it.
vec3 waterNormalWorld;
vec3 waterToEye;
float waterFoamMask;
float waterDepthMix;
float waterMirror;

// One wave layer. Returns the world XZ slope and the height that generated it.
//
// No tangent frame: the surface is a horizontal plane, so tangent space *is*
// world space with U along +X and V along +Z, and a tangent-space normal turns
// into a world slope by division alone. That is the one simplification a flat
// water plane genuinely earns.
vec3 waterWaveLayer(vec2 uv) {
  vec4 texel = texture2D(waterWaves, uv);
  vec3 n = texel.xyz * 2.0 - 1.0;
  return vec3(n.xy / max(n.z, 0.05), texel.w);
}
`;

const WATER_PREAMBLE = /* glsl */ `
{
  // position.xz IS the tile coordinate in this project — the mesh is authored
  // in tile space — so the field needs a scale and no offset table.
  vec2 tile = vWaterWorld.xz;
  vec2 fieldUv = tile * waterFieldStep;

  // Past the edge of the map the field has nothing to say. Fading to open sea
  // beats clamping, which would smear the edge row's shoreline — and its foam —
  // right around the horizon.
  float over = max(max(-fieldUv.x, fieldUv.x - 1.0), max(-fieldUv.y, fieldUv.y - 1.0));
  float inMap = 1.0 - smoothstep(0.0, waterFieldStep * ${glsl(EDGE_FADE_TILES)}, over);
  vec3 field = texture2D(waterField, clamp(fieldUv, 0.0, 1.0)).rgb;
  float depth01 = mix(1.0, field.r, inMap);
  float shore = mix(1.0, field.g, inMap);
  float openness = mix(1.0, field.b, inMap);

  vec3 swell = waterWaveLayer(tile * ${glsl(SWELL_SCALE)} + waterSwellOffset);
  vec2 slope = swell.xy * ${glsl(SWELL_AMPLITUDE)};
  float crest = swell.z - 0.5;
#if WATER_LAYERS > 1
  vec3 chop = waterWaveLayer(tile * ${glsl(CHOP_SCALE)} + waterChopOffset);
  slope += chop.xy * (${glsl(CHOP_AMPLITUDE)} * waterDetail);
  crest = mix(crest, crest * 0.55 + (chop.z - 0.5) * 0.9, waterDetail);
#endif
  // A pond is not the Aegean. The same bake that draws the surf decides how
  // much water there is to move, so a river stays glassy without a second field.
  slope *= mix(${glsl(SHELTERED_CALM)}, 1.0, openness);
  waterNormalWorld = normalize(vec3(slope.x, 1.0, slope.y));

  waterDepthMix = pow(depth01, ${glsl(DEPTH_CURVE)});

  // Surf: a band that thins away from land, cut into tongues by the wave height
  // already fetched, so it breathes instead of ringing the coast like a contour
  // line — plus one thin unconditional line at the waterline, which is what
  // survives when the whole band is two pixels wide from map height.
  float band = 1.0 - shore;
  float tongues = smoothstep(
    ${glsl(SURF_CUT - SURF_SOFT)},
    ${glsl(SURF_CUT + SURF_SOFT)},
    band + crest * ${glsl(SURF_CHURN)}
  );
  waterFoamMask = clamp(
    max(band * tongues, smoothstep(${glsl(WATERLINE)}, 0.0, shore)),
    0.0,
    1.0
  );

  // How much of the surface has turned mirror. This decides opacity only — the
  // reflection's own strength comes from the material's environment BRDF, which
  // does its own Fresnel. Schlick against the same F0 the material assumes, so
  // what the water hides and what it reflects cannot disagree.
  waterToEye = normalize(cameraPosition - vWaterWorld);
  float facing = clamp(dot(waterNormalWorld, waterToEye), 0.0, 1.0);
  waterMirror = ${glsl(DIELECTRIC_F0)} + ${glsl(1 - DIELECTRIC_F0)} * pow(1.0 - facing, 5.0);
}
`;

const WATER_COLOUR = /* glsl */ `
// Depth decides both the colour and how much of the bed shows through it. The
// bed underneath is terrain.ts's lake floor, which is already sand-tinted near
// the waterline — letting it through is most of what makes a beach a beach.
diffuseColor.rgb = mix(waterShallow, waterDeep, waterDepthMix);
diffuseColor.a = mix(${glsl(ALPHA_SHALLOW)}, ${glsl(ALPHA_DEEP)}, waterDepthMix);
// A mirror hides what is under it. Without this the bed shows through the
// reflected sky at exactly the angles where the reflection is strongest.
diffuseColor.a = mix(diffuseColor.a, 1.0, waterMirror);
diffuseColor.rgb = mix(diffuseColor.rgb, waterFoam, waterFoamMask);
diffuseColor.a = mix(diffuseColor.a, 1.0, waterFoamMask);
`;

const WATER_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, ${glsl(FOAM_ROUGHNESS)}, waterFoamMask);
// What the mip chain took out of the normals comes back as roughness, or far
// water is flat, smooth and sparkles one pixel at a time.
roughnessFactor = mix(${glsl(FAR_ROUGHNESS)}, roughnessFactor, waterDetail);
`;

const WATER_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(waterNormalWorld, 0.0)).xyz);
`;

const WATER_RADIANCE = /* glsl */ `
#if defined( RE_IndirectSpecular )
{
  // The indirect specular the scene has no environment map to supply.
  //
  // Written into radiance — the exact variable an env map would fill — so
  // RE_IndirectSpecular puts it through the split-sum environment BRDF and
  // Fresnel, roughness and F0 are all handled there rather than by hand here.
  // Only the specular term: the diffuse sky bounce is the HemisphereLight's
  // job and adding it again would light the sea twice.
  vec3 mirror = reflect(-waterToEye, waterNormalWorld);
  vec3 sky = mix(waterHorizon, waterZenith, pow(clamp(mirror.y, 0.0, 1.0), ${glsl(SKY_RAMP)}));
  // The sun's halo, but not its disc: the disc's reflection is the material's
  // own specular lobe scattered across these wave normals, which is what a
  // glitter path physically is. Drawing it here as well would put two suns on
  // one sea.
  float cosSun = clamp(dot(mirror, waterSunDirection), 0.0, 1.0);
  sky += waterSun * pow(cosSun, ${glsl(HALO_POWER)}) * ${glsl(HALO_STRENGTH)};
  radiance += sky;
}
#endif
`;

// --- Baking ------------------------------------------------------------------

/**
 * Depth, distance to shore and openness, per tile, into an RGBA byte field.
 *
 * Read-only over `world.height`: this is render-side derivation of sim data and
 * writes nothing back. Runs on a terrain change, not per frame — two sweeps
 * over 65k tiles, which is the same order as one chunk rebuild in terrain.ts.
 */
function bakeField(world: World, out: Uint8Array): void {
  const size = world.size;
  const count = size * size;

  // Distance from every water tile to the nearest land, by chamfer transform:
  // seed land at zero and water at infinity, then one forward sweep and one
  // backward sweep relaxing against the neighbours already visited. Two passes
  // for a distance field that is within a few percent of Euclidean, which is
  // far more than a foam band needs.
  const distance = new Float32Array(count);
  const far = size * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = index(world, x, y);
      distance[i] = (world.height[i] ?? 0) < SEA_LEVEL ? far : 0;
    }
  }

  // Row-major, the layout sim/world.ts's `index` returns — walked arithmetically
  // here because the sweep touches eight neighbours per tile.
  const relax = (target: number, from: number, step: number): void => {
    const candidate = (distance[from] ?? far) + step;
    if (candidate < (distance[target] ?? far)) distance[target] = candidate;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (distance[i] === 0) continue;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) {
        relax(i, i - size, 1);
        if (x > 0) relax(i, i - size - 1, CHAMFER_DIAGONAL);
        if (x < size - 1) relax(i, i - size + 1, CHAMFER_DIAGONAL);
      }
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (distance[i] === 0) continue;
      if (x < size - 1) relax(i, i + 1, 1);
      if (y < size - 1) {
        relax(i, i + size, 1);
        if (x < size - 1) relax(i, i + size + 1, CHAMFER_DIAGONAL);
        if (x > 0) relax(i, i + size - 1, CHAMFER_DIAGONAL);
      }
    }
  }

  for (let i = 0; i < count; i++) {
    // Depth in world units, so the constant above is in the same units as every
    // other height in the renderer rather than in the sim's 0..1 column.
    const below = (SEA_LEVEL - (world.height[i] ?? 0)) * HEIGHT_SCALE;
    const depth = clamp01(Math.max(0, below) / DEEP_AT);
    const toShore = distance[i] ?? 0;
    const o = i * 4;
    out[o] = Math.round(depth * 255);
    out[o + 1] = Math.round(clamp01(toShore / FOAM_SPAN) * 255);
    out[o + 2] = Math.round(clamp01(toShore / SHELTER_SPAN) * 255);
    // Unused. RGBA is carried for the alignment guarantee, not for a fourth
    // channel — see the field allocation above.
    out[o + 3] = 255;
  }
}

/**
 * The tiling wave map: RGB a tangent-space normal, A the height that made it.
 *
 * Packing the height beside its own normal is what makes the surf free. The
 * shader needs both — the normal to tilt the surface, the height to decide
 * where the foam breaks — and this way it fetches them together.
 */
function buildWaveTexture(pixels: number, anisotropy: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    bakeWaves(pixels),
    pixels,
    pixels,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // Water is seen at grazing angles almost exclusively, which is precisely the
  // case trilinear filtering blurs into mush.
  texture.anisotropy = anisotropy;
  // A normal and a height, not a colour.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function bakeWaves(pixels: number): Uint8Array {
  const count = pixels * pixels;
  const height = new Float32Array(count);
  const tau = Math.PI * 2;

  let lowest = Infinity;
  let highest = -Infinity;
  for (let y = 0; y < pixels; y++) {
    for (let x = 0; x < pixels; x++) {
      const u = x / pixels;
      const v = y / pixels;
      let h = 0;
      for (const [repeatsU, repeatsV, amplitude] of SWELL_LINES) {
        h += Math.sin((u * repeatsU + v * repeatsV) * tau) * amplitude;
      }
      for (let o = 0; o < CHOP_OCTAVES.length; o++) {
        const octave = CHOP_OCTAVES[o] as readonly [number, number];
        const period = octave[0];
        h += (periodicNoise(u * period, v * period, period, o * 5 + 1) - 0.5) * 2 * octave[1];
      }
      const i = y * pixels + x;
      height[i] = h;
      if (h < lowest) lowest = h;
      if (h > highest) highest = h;
    }
  }

  // Gradients with wrap-around, then scaled so the field's RMS slope matches
  // TARGET_SLOPE — see that constant for why this is not cosmetic.
  const gradientU = new Float32Array(count);
  const gradientV = new Float32Array(count);
  let squares = 0;
  for (let y = 0; y < pixels; y++) {
    for (let x = 0; x < pixels; x++) {
      const i = y * pixels + x;
      const left = height[y * pixels + ((x + pixels - 1) % pixels)] ?? 0;
      const right = height[y * pixels + ((x + 1) % pixels)] ?? 0;
      const up = height[((y + pixels - 1) % pixels) * pixels + x] ?? 0;
      const down = height[((y + 1) % pixels) * pixels + x] ?? 0;
      const gu = (right - left) * 0.5;
      const gv = (down - up) * 0.5;
      gradientU[i] = gu;
      gradientV[i] = gv;
      squares += gu * gu + gv * gv;
    }
  }
  const rms = Math.sqrt(squares / Math.max(1, count));
  const gain = rms > 1e-6 ? TARGET_SLOPE / rms : 0;

  const span = highest - lowest;
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    // A height field's normal is (-dh/du, -dh/dv, 1) once normalised, in a
    // tangent space whose Z is up.
    const nx = -(gradientU[i] ?? 0) * gain;
    const ny = -(gradientV[i] ?? 0) * gain;
    const length = Math.hypot(nx, ny, 1);
    const o = i * 4;
    data[o] = Math.round((nx / length) * 0.5 * 255 + 127.5);
    data[o + 1] = Math.round((ny / length) * 0.5 * 255 + 127.5);
    data[o + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
    data[o + 3] = Math.round(
      span > 1e-6 ? clamp01(((height[i] ?? 0) - lowest) / span) * 255 : 128,
    );
  }
  return data;
}

/**
 * Value noise on a lattice that wraps every `period` cells, so the octave
 * closes exactly across the texture. Wrapping the lattice rather than mirroring
 * the samples is what keeps the map seamless without halving its usable detail.
 */
function periodicNoise(x: number, y: number, period: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const h00 = hashUnit(x0, y0, salt);
  const h10 = hashUnit(x1, y0, salt);
  const h01 = hashUnit(x0, y1, salt);
  const h11 = hashUnit(x1, y1, salt);
  const top = h00 + (h10 - h00) * ux;
  const bottom = h01 + (h11 - h01) * ux;
  return top + (bottom - top) * uy;
}

/** Stable 0..1 hash — the same recipe the terrain and the facades use. */
function hashUnit(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Drops whole texture repeats, which the wave map cannot tell apart. */
function wrapUnit(value: number): number {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
