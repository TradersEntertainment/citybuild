import * as THREE from 'three';
import { CAMERA_FOV, HEIGHT_SCALE, SEA_Y } from './constants';

/**
 * Ground material for the height field.
 *
 * The terrain is the largest surface on screen and until now it was a bilinear
 * ramp between vertex colours: between two tile corners there is literally no
 * information, so a hillside reads as felt from the map camera and as a painted
 * plane from the street. This layer does not replace those colours — it
 * multiplies a generated grain over them, so the season tint, the fertility
 * greening and the survey grey on unbought land all keep working exactly as
 * terrain.ts wrote them.
 *
 * Four surfaces — grass, rock, sand, soil — packed one per channel of a single
 * RGBA map, chosen per pixel by slope and height. Packing rather than atlasing
 * is what makes it affordable: one texture object, one fetch, full
 * RepeatWrapping with no atlas gutters to bleed across at the low mip levels.
 * A second, much smaller map carries the low-frequency field that stops a
 * hundred square kilometres of grass being one shade of green.
 *
 * Everything is a `DataTexture` built from arithmetic, so there is no asset
 * file, no `<canvas>` and no DOM anywhere in here — which also means a node
 * test runner can import and bake this file without a browser.
 *
 * Contributed to the terrain's existing `MeshStandardMaterial` through
 * `onBeforeCompile` rather than a `ShaderMaterial`, following the water surface
 * (terrain.ts). A custom material would have to re-implement fog, shadow
 * receipt and tone mapping, and would lose all three the day one of them
 * changes.
 */

// --- Texture size ------------------------------------------------------------

/**
 * The detail map, per side. 128² RGBA with a full mip chain is 85 KiB for all
 * four surfaces; the macro map adds 21 KiB. That is about six tenths of one per
 * cent of the 2048² shadow map the scene already carries, and the whole point
 * of packing four surfaces into four channels was to be able to say so.
 *
 * 256 was tried first and is the wrong trade twice over: the extra texels land
 * below one screen pixel at every camera distance the game is played at (see
 * FADE_FULL_PX), and baking it is four times the CPU on a phone's main thread
 * at boot for detail nobody can resolve.
 */
const DETAIL_SIZE = 128;

/**
 * The macro map, per side. It is sampled over ninety-odd tiles, so a texel is
 * already a tile and a half wide — resolution here would buy nothing but bytes.
 */
const MACRO_SIZE = 64;

/**
 * What the two maps cost on the GPU, mips included (a full chain adds a third).
 * Exported so a budget test can assert it without needing a WebGL context.
 */
export const TERRAIN_DETAIL_BYTES = Math.round(
  ((DETAIL_SIZE * DETAIL_SIZE + MACRO_SIZE * MACRO_SIZE) * 4 * 4) / 3,
);

// --- Scale -------------------------------------------------------------------

/**
 * How many tiles one repeat of the detail map spans.
 *
 * A tile is about eight metres, so this is an eleven-metre patch of ground
 * across 128 texels — 8.6 cm per texel, which is a clump of grass rather than a
 * blade, and about right for a camera that is never closer than walking height.
 *
 * Deliberately not a whole number of tiles. A detail pattern that repeats on
 * the tile grid draws the tile grid, and the entire purpose of this layer is to
 * stop the ground reading as a tile map with a 3D effect applied to it.
 */
const DETAIL_REPEAT_TILES = 1.37;

/**
 * The macro field's period, in tiles. Two and a bit repeats across a 256-tile
 * map: large enough that a region reads as a region — this stretch is drier,
 * that one greener — and small enough that one map holds several of them.
 * Not a divisor of the map size, for the same reason as above.
 */
const MACRO_REPEAT_TILES = 91;

/**
 * How far the macro field drags the detail UV, in world units.
 *
 * A repeat every 1.37 tiles is a repeat the eye will find in an open field. A
 * slow warp driven by the macro noise decorrelates it — the pattern is still
 * periodic, but its phase wanders over the map, which is enough. Two
 * multiply-adds and no extra memory; the alternative is a second detail fetch
 * at a different scale, which is twice the bandwidth for the same effect.
 */
const MACRO_WARP_UNITS = 0.34;

/**
 * Triplanar blend exponent. Four is sharp enough that a cliff face is rock
 * rather than a smear of rock and grass, and soft enough that the seam over the
 * top of a ridge is not a visible line.
 */
const TRIPLANAR_SHARPNESS = 4;

// --- Where each surface belongs ----------------------------------------------

/**
 * Where grass gives up, as the cosine of the ground's angle from flat.
 *
 * 0.93 is about 22°, 0.77 about 40°. The pair brackets the angle of repose —
 * the slope past which loose material stops staying put — which is why a
 * hillside goes to bare earth and then to rock instead of staying a lawn all
 * the way to the summit. Slope decides before height does: a cliff is rock at
 * any altitude.
 */
const ROCK_SLOPE_START = 0.93;
const ROCK_SLOPE_FULL = 0.77;

/** Soil arrives earlier and more gently than rock: 0.985 ≈ 10°, 0.9 ≈ 26°. */
const SOIL_SLOPE_START = 0.985;
const SOIL_SLOPE_FULL = 0.9;

/**
 * The shore band and the bare-rock ramp, in normalised height units.
 *
 * These mirror the ramps `groundColour` already paints in terrain.ts. They are
 * restated rather than imported because that function is private to terrain.ts
 * and needs a `World` to answer; if either set moves the other must move with
 * it, and the failure is loud rather than subtle — sand grain sitting on a
 * green vertex colour.
 */
const SAND_BAND_HEIGHT = 0.035;
const PEAK_ROCK_START = 0.78;
const PEAK_ROCK_FULL = 1;

// --- How strong it all is ----------------------------------------------------

/** How far the grain swings the ground either side of its own colour. */
const DETAIL_STRENGTH = 0.34;

/**
 * How far the macro field swings it. Much lower than the grain, because this
 * is the term that is still legible from the map-wide view — at the grain's
 * strength it would read as cloud shadow.
 */
const MACRO_BRIGHT_STRENGTH = 0.16;

/** How much the wear channel varies the grain itself, region by region. */
const MACRO_WEAR = 0.45;

/** How much bare earth the macro field is allowed to put on flat ground. */
const MACRO_SOIL_PATCH = 0.55;

/**
 * Relief. Small because the grain is centimetres of height, not metres: this is
 * the difference between a painted texture and a surface the sun can find, and
 * pushed any harder it turns a meadow into crumpled foil.
 */
const BUMP_SCALE = 0.09;

/** Snow fills the grain in. At the deepest winter three quarters of it is gone. */
const SNOW_SMOOTHING = 0.75;

// --- Distance fade -----------------------------------------------------------

/**
 * Where the grain stops being grain, measured in device pixels per repeat of
 * the detail map.
 *
 * Below the floor one repeat's 128 texels are crammed into twenty pixels — six
 * texels a pixel, so every mip level that carried structure has already been
 * averaged away and what survives only shimmers while the player pans. Fading
 * it out is an anti-aliasing measure and nothing else: the fetches still
 * happen, only their contribution goes to zero. No frame-rate claim is being
 * made for it.
 *
 * At the phone target these work out at full grain in to a camera distance of
 * about 64 world units and none past about 129 — so the default view (34) is
 * fully grained and the widest zoom out is clean.
 */
const FADE_FULL_PX = 40;
const FADE_GONE_PX = 20;

/**
 * Drawing-buffer height assumed until `resize` is called: the phone target,
 * 780 CSS pixels at the ratio of 2 that `pixelRatioFor` caps to. Guessing high
 * would put grain on the first frames of a map-wide view in a small window.
 */
const DEFAULT_BUFFER_HEIGHT = 1560;

/** World units spanned vertically per unit of camera distance, at CAMERA_FOV. */
const VIEW_SPAN_PER_UNIT = 2 * Math.tan((CAMERA_FOV * Math.PI) / 360);

// --- Public shape ------------------------------------------------------------

/**
 * What a device is willing to pay for.
 *
 * `off` emits no shader code at all — the terrain compiles the stock standard
 * material and the maps are never even baked, which is what "a mid-range phone
 * can turn it off" has to mean. `low` is one detail fetch on a flat projection,
 * which is what any textured ground costs. `high` adds the two side
 * projections so cliffs get rock instead of stretched grass, and a relief term
 * derived from the detail value already in hand.
 */
export type TerrainDetailQuality = 'off' | 'low' | 'high';

export interface TerrainDetailLayer {
  /** The tier currently compiled into the attached materials. */
  readonly quality: TerrainDetailQuality;
  /**
   * Adopts every standard material under `root` — pass the terrain group.
   * Idempotent, so it is safe to call again after a context restore or a
   * terrain rebuild.
   */
  attach(root: THREE.Object3D): void;
  /**
   * Per frame. `cameraDistance` fades the grain out before it starts to
   * shimmer; `snow` is the 0..1 winter depth the renderer already computes for
   * the season tint, and it smooths the ground over as the snow deepens.
   */
  update(cameraDistance: number, snow: number): void;
  /** Re-derives the fade band from the drawing buffer the frame is drawn into. */
  resize(cssHeight: number, pixelRatio: number): void;
  setQuality(quality: TerrainDetailQuality): void;
  dispose(): void;
}

export function createTerrainDetail(
  initialQuality: TerrainDetailQuality = 'low',
): TerrainDetailLayer {
  let quality: TerrainDetailQuality = initialQuality;
  let bufferHeight = DEFAULT_BUFFER_HEIGHT;

  let detailMap: THREE.DataTexture | null = null;
  let macroMap: THREE.DataTexture | null = null;

  // One set of uniform objects shared by every attached material, so a frame's
  // update is four writes however many chunk meshes the map is cut into.
  const uDetail: THREE.IUniform<THREE.Texture | null> = { value: null };
  const uMacro: THREE.IUniform<THREE.Texture | null> = { value: null };
  const uScale: THREE.IUniform<THREE.Vector4> = {
    value: new THREE.Vector4(
      // x: detail repeats per world unit. Tile space is world space here, so
      // `position.xz` already is the tile coordinate — there is no half-map
      // offset to subtract anywhere in this file.
      1 / DETAIL_REPEAT_TILES,
      1 / MACRO_REPEAT_TILES,
      MACRO_WARP_UNITS,
      BUMP_SCALE,
    ),
  };
  const uMix: THREE.IUniform<THREE.Vector4> = {
    value: new THREE.Vector4(
      DETAIL_STRENGTH,
      MACRO_BRIGHT_STRENGTH,
      MACRO_WEAR,
      MACRO_SOIL_PATCH,
    ),
  };
  const uSlope: THREE.IUniform<THREE.Vector4> = {
    value: new THREE.Vector4(
      ROCK_SLOPE_FULL,
      ROCK_SLOPE_START,
      SOIL_SLOPE_FULL,
      SOIL_SLOPE_START,
    ),
  };
  const uBand: THREE.IUniform<THREE.Vector4> = {
    value: new THREE.Vector4(
      SEA_Y,
      SAND_BAND_HEIGHT * HEIGHT_SCALE,
      PEAK_ROCK_START * HEIGHT_SCALE,
      PEAK_ROCK_FULL * HEIGHT_SCALE,
    ),
  };

  const attached = new Set<THREE.MeshStandardMaterial>();

  /**
   * Baked on first use rather than at construction, so a device that starts at
   * `off` never pays the CPU for maps it will not sample.
   */
  const ensureMaps = (): void => {
    if (detailMap && macroMap) return;
    detailMap = bake(DETAIL_SIZE, [GRASS, ROCK, SAND, SOIL]);
    // The ground is seen at a grazing angle more than any other surface in the
    // scene, which is exactly the case trilinear filtering handles worst.
    // three clamps this to whatever the device actually supports.
    detailMap.anisotropy = 8;
    macroMap = bake(MACRO_SIZE, [MACRO_BRIGHT, MACRO_PATCH, MACRO_WEAR_FIELD]);
    uDetail.value = detailMap;
    uMacro.value = macroMap;
  };

  const patch = (shader: {
    uniforms: { [name: string]: THREE.IUniform };
    vertexShader: string;
    fragmentShader: string;
  }): void => {
    if (quality === 'off') return;
    shader.uniforms['tdDetail'] = uDetail;
    shader.uniforms['tdMacro'] = uMacro;
    shader.uniforms['tdScale'] = uScale;
    shader.uniforms['tdMix'] = uMix;
    shader.uniforms['tdSlope'] = uSlope;
    shader.uniforms['tdBand'] = uBand;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERTEX_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${fragmentBody(quality === 'high')}`,
      );

    if (quality === 'high') {
      // After the normal maps rather than before them: this is the last word on
      // the shading normal, and terrain has no normalMap to fight with anyway.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${BUMP_BODY}`,
      );
    }
  };

  const adopt = (material: THREE.Material): void => {
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    if (attached.has(material)) return;
    // Never clobber a material that already carries a shader patch. The water's
    // waves are one (terrain.ts), and overwriting its onBeforeCompile would
    // silently flatten the sea — a failure nobody would trace back to here.
    if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;

    material.onBeforeCompile = patch;
    // Without this the program cache hands back whichever variant was compiled
    // first and `setQuality` becomes a no-op: three keys cached programs on
    // `onBeforeCompile.toString()` by default, and this closure's source text
    // is the same at every tier.
    material.customProgramCacheKey = () => `kadastro-terrain-detail:${quality}`;
    material.needsUpdate = true;
    attached.add(material);
  };

  return {
    get quality(): TerrainDetailQuality {
      return quality;
    },

    attach: (root) => {
      if (quality !== 'off') ensureMaps();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = object.material;
        if (Array.isArray(material)) {
          for (const entry of material) adopt(entry);
        } else {
          adopt(material);
        }
      });
    },

    update: (cameraDistance, snow) => {
      if (quality === 'off') return;
      // Pixels the drawing buffer gives one repeat of the detail map at this
      // camera distance. Everything else about the fade falls out of this one
      // number, which is why `resize` matters: a 4K window resolves the same
      // grain from twice as far away.
      const span = VIEW_SPAN_PER_UNIT * Math.max(cameraDistance, 0.001);
      const pixelsPerRepeat = (DETAIL_REPEAT_TILES * bufferHeight) / span;
      const fade = smoothstep(FADE_GONE_PX, FADE_FULL_PX, pixelsPerRepeat);
      const winter = 1 - clamp01(snow) * SNOW_SMOOTHING;
      const amount = fade * winter;

      uMix.value.x = DETAIL_STRENGTH * amount;
      uScale.value.w = BUMP_SCALE * amount;
      // The macro field deliberately does not fade: it is a large-scale signal
      // and it is most useful at exactly the zoom where the grain is useless.
    },

    resize: (cssHeight, pixelRatio) => {
      // Falls back rather than propagating: Safari fires a visualViewport resize
      // mid-rotation with a height of zero, and a zero here would put the fade
      // band at infinity and take the grain off the whole map until the next
      // resize that happened to be sane.
      bufferHeight = Math.round(cssHeight * pixelRatio) || DEFAULT_BUFFER_HEIGHT;
    },

    setQuality: (next) => {
      if (next === quality) return;
      quality = next;
      if (quality !== 'off') ensureMaps();
      // A tier is a different program, not a different uniform, so every
      // adopted material has to be recompiled. Rare enough — this is a settings
      // change — that the compile stall is the right trade for a tier that
      // genuinely costs nothing when it is off.
      for (const material of attached) material.needsUpdate = true;
    },

    dispose: () => {
      for (const material of attached) {
        material.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
        material.customProgramCacheKey = THREE.Material.prototype.customProgramCacheKey;
        material.needsUpdate = true;
      }
      attached.clear();
      detailMap?.dispose();
      macroMap?.dispose();
      detailMap = null;
      macroMap = null;
      uDetail.value = null;
      uMacro.value = null;
    },
  };
}

// --- Shader ------------------------------------------------------------------

const VERTEX_PARS = /* glsl */ `
varying vec3 vDetailWorld;
varying vec3 vDetailNormal;
`;

/**
 * `transformed` and `objectNormal` are both still in scope here, and the
 * terrain chunks carry no scale or rotation of their own, so the plain rotation
 * block of the model matrix is an exact world normal rather than an
 * approximation of one.
 */
const VERTEX_BODY = /* glsl */ `
vDetailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDetailNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D tdDetail;
uniform sampler2D tdMacro;
uniform vec4 tdScale; // detail repeats/unit, macro repeats/unit, warp units, bump
uniform vec4 tdMix;   // grain strength, macro brightness, wear, soil patch
uniform vec4 tdSlope; // rock full, rock start, soil full, soil start (cos)
uniform vec4 tdBand;  // sea Y, sand band height, peak rock start Y, peak rock full Y
varying vec3 vDetailWorld;
varying vec3 vDetailNormal;
`;

/**
 * Runs straight after `<color_fragment>`, which is where the vertex colour has
 * just been multiplied into `diffuseColor` and nothing has read it yet. That
 * seam is the whole reason this works as a contribution rather than a
 * replacement: the season tint, the fertility greening and the survey grey are
 * already in the value being multiplied.
 *
 * `tdHeight` and `tdWear` are declared outside the block on purpose: the relief
 * term further down main() reads both, so the bump costs no second fetch and no
 * second blend. Everything else is scoped to the block so the surrounding
 * shader keeps exactly the names it had.
 */
function fragmentBody(triplanar: boolean): string {
  const sample = triplanar
    ? /* glsl */ `
  // Three projections weighted by the face normal. Only worth paying for on a
  // cliff — which is exactly where a single flat projection smears a metre of
  // grass down a vertical rock face — so it is the tier's whole difference.
  vec3 tdW = pow(abs(tdN), vec3(${TRIPLANAR_SHARPNESS.toFixed(1)}));
  tdW /= (tdW.x + tdW.y + tdW.z);
  vec4 tdTex = texture2D(tdDetail, tdP.zy * tdScale.x) * tdW.x
             + texture2D(tdDetail, tdP.xz * tdScale.x) * tdW.y
             + texture2D(tdDetail, tdP.xy * tdScale.x) * tdW.z;`
    : /* glsl */ `
  // One projection down the world's Y axis. Terrain normals are within a few
  // degrees of straight up almost everywhere, so this is the same picture as a
  // triplanar blend for a third of the bandwidth.
  vec4 tdTex = texture2D(tdDetail, tdP.xz * tdScale.x);`;

  return /* glsl */ `
float tdHeight = 0.5;
float tdWear = 1.0;
{
  vec3 tdN = normalize(vDetailNormal);
  vec4 tdM = texture2D(tdMacro, vDetailWorld.xz * tdScale.y);

  // Slope answers first: grass cannot hold on a cliff at any altitude, and the
  // peaks go bare on the same ramp terrain.ts uses for their colour.
  float tdRock = 1.0 - smoothstep(tdSlope.x, tdSlope.y, tdN.y);
  tdRock = max(tdRock, smoothstep(tdBand.z, tdBand.w, vDetailWorld.y));
  // The shore. smoothstep clamps, so ground below the waterline — the lake bed
  // seen through the water plane — comes out fully sand without a branch.
  float tdSand = 1.0 - smoothstep(0.0, tdBand.y, vDetailWorld.y - tdBand.x);
  // Soil is the transition material: the earth apron under a slope too steep to
  // hold grass, plus whatever patches the macro field decides to scour.
  float tdSoil = 1.0 - smoothstep(tdSlope.z, tdSlope.w, tdN.y);
  tdSoil = max(tdSoil, smoothstep(0.52, 0.86, tdM.g) * tdMix.w);

  // Rock beats sand (a sea cliff is not a beach) and both beat soil, so the
  // four weights stay an exact partition of one — which is what lets the blend
  // change the material underfoot without changing how bright the ground is.
  tdSand *= 1.0 - tdRock;
  tdSoil *= (1.0 - tdRock) * (1.0 - tdSand);
  float tdGrass = (1.0 - tdRock) * (1.0 - tdSand) * (1.0 - tdSoil);

  // The macro field also drags the sampling point about by a fraction of a
  // repeat, which is what stops 1.37 tiles of pattern reading as wallpaper.
  vec3 tdP = vDetailWorld + vec3(tdM.r - 0.5, 0.0, tdM.g - 0.5) * tdScale.z;
${sample}

  tdHeight = dot(vec4(tdGrass, tdRock, tdSand, tdSoil), tdTex);
  // Wear: some ground is scoured and grainy, some is smooth. One macro channel,
  // so the amount of grain varies across the map instead of being one number.
  tdWear = mix(1.0 - tdMix.z, 1.0 + tdMix.z, tdM.b);

  // Both maps are baked with a mean of exactly 0.5, so these two centred terms
  // leave the average brightness of the ground alone. That is load-bearing: a
  // grain that darkened as it was added would quietly recalibrate the season
  // tint and the unowned-land grey that terrain.ts sets against it, and every
  // mip level of a mean-0.5 map fades to no contribution instead of to a stain.
  diffuseColor.rgb *= max(
    0.05,
    1.0 + (tdHeight - 0.5) * 2.0 * tdMix.x * tdWear + (tdM.r - 0.5) * 2.0 * tdMix.y
  );
}
`;
}

/**
 * Relief from the detail value already computed above, using Mikkelsen's
 * screen-space gradient — the same construction three's own bumpMap chunk uses.
 * It needs no second texture, no tangent attribute and no extra fetch: two
 * derivatives and a pair of cross products. Without it the grain is a painting
 * on a perfectly smooth plane and the sun cannot find it, which is most of why
 * the ground reads as plastic in the first place.
 *
 * The braces are the reason `tdHeight` survives from the block above — the
 * outer scope is main(), so the inner block only needs the name.
 */
const BUMP_BODY = /* glsl */ `
{
  vec2 tdDH = vec2(dFdx(tdHeight), dFdy(tdHeight)) * (tdScale.w * tdWear);
  vec3 tdSx = normalize(dFdx(-vViewPosition));
  vec3 tdSy = normalize(dFdy(-vViewPosition));
  vec3 tdR1 = cross(tdSy, normal);
  vec3 tdR2 = cross(normal, tdSx);
  float tdDet = dot(tdSx, tdR1) * faceDirection;
  vec3 tdGrad = sign(tdDet) * (tdDH.x * tdR1 + tdDH.y * tdR2);
  normal = normalize(abs(tdDet) * normal - tdGrad);
}
`;

// --- Baking ------------------------------------------------------------------

interface ChannelPlan {
  /** Raw, unnormalised value at (u, v) in texture space. Must tile at 1. */
  value(u: number, v: number): number;
  /**
   * How far the finished channel swings either side of its mean, 0..1. This is
   * how a beach ends up smoother than a cliff without either of them being a
   * different amount of noise — sand really is close to uniform, and pushing
   * grain into it is what makes a beach read as gravel.
   */
  contrast: number;
}

/**
 * Grass: broad tufts with a finer grain drawn across them. The fine field is
 * stretched four to one because grass lies down in a direction; an isotropic
 * speckle reads as gravel, not as a meadow.
 */
const GRASS: ChannelPlan = {
  contrast: 0.92,
  value: (u, v) => fbm(u, v, 4, 4, 5, 101) * 0.6 + fbm(u, v, 6, 24, 3, 137) * 0.4,
};

/**
 * Rock: bedding planes plus fractures. The bands are stretched hard along one
 * axis because sedimentary rock is layered, and the ridged term carves the
 * cracks — `1 - |2n - 1|` creases wherever the noise crosses its own middle,
 * which is the cheapest line generator there is.
 */
const ROCK: ChannelPlan = {
  contrast: 1,
  value: (u, v) =>
    fbm(u, v, 2, 14, 4, 211) * 0.55 +
    (1 - ridged(u, v, 6, 6, 4, 233)) * 0.3 +
    fbm(u, v, 32, 32, 2, 251) * 0.15,
};

/**
 * Sand: wind ripples under a fine grain. The ripple is a whole number of
 * periods so it tiles exactly, and the noise term bends it — a straight
 * sinusoid is corduroy, not a beach.
 */
const SAND: ChannelPlan = {
  contrast: 0.5,
  value: (u, v) => {
    const drift = fbm(u, v, 3, 3, 3, 307) - 0.5;
    const ripple = 0.5 + 0.5 * Math.sin((v * 9 + drift * 1.1) * Math.PI * 2);
    return ripple * 0.4 + fbm(u, v, 24, 24, 3, 311) * 0.35 + fbm(u, v, 4, 4, 3, 313) * 0.25;
  },
};

/**
 * Soil: clods with stones sitting in them. The stones are a threshold on a
 * noise field rather than another octave, because the top of a noise field is
 * sparse and rounded — which is what a stone in the dirt looks like, where a
 * fifth octave is just more dirt.
 */
const SOIL: ChannelPlan = {
  contrast: 0.86,
  value: (u, v) =>
    fbm(u, v, 5, 5, 4, 401) * 0.78 + smoothstep(0.62, 0.8, fbm(u, v, 20, 20, 2, 419)) * 0.22,
};

/** Macro brightness: the slow "this stretch is drier" field. */
const MACRO_BRIGHT: ChannelPlan = { contrast: 0.8, value: (u, v) => fbm(u, v, 2, 2, 4, 601) };
/** Macro material bias: where bare earth shows through on flat ground. */
const MACRO_PATCH: ChannelPlan = { contrast: 1, value: (u, v) => fbm(u, v, 3, 2, 3, 613) };
/** Macro wear: how grainy the ground is here at all. */
const MACRO_WEAR_FIELD: ChannelPlan = { contrast: 0.9, value: (u, v) => fbm(u, v, 2, 3, 3, 631) };

/**
 * Bakes up to four channel plans into one RGBA byte map.
 *
 * Every channel is forced to a mean of exactly one half. That is the property
 * the whole layer rests on — the shader multiplies the ground by
 * `1 + (detail - 0.5) * 2 * strength`, so a channel whose mean sat anywhere
 * else would tint every hillside in the game and no amount of retuning the
 * season colours would put it back. It is done in two exact steps rather than
 * by trial: a monotone power curve, bisected until the mean lands, and then a
 * contrast scale applied *around* 0.5, which cannot move a mean and — because
 * the input is already normalised to 0..1 and the contrast never exceeds 1 —
 * cannot clip either. All that is left is the 8-bit rounding, worth under two
 * tenths of one per cent.
 */
function bake(size: number, plans: readonly ChannelPlan[]): THREE.DataTexture {
  const texels = size * size;
  // Filled opaque so a channel nobody wrote reads as 1 rather than as a
  // transparent black anyone debugging this would mistake for a bug.
  const data = new Uint8Array(texels * 4).fill(255);
  const raw = new Float32Array(texels);

  for (let channel = 0; channel < plans.length && channel < 4; channel++) {
    const plan = plans[channel] as ChannelPlan;
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Texel centres, so the wrap at the far edge meets the near edge with
        // the same spacing every other pair of texels has.
        raw[y * size + x] = plan.value((x + 0.5) / size, (y + 0.5) / size);
        // Read the value back rather than trusting the double the plan
        // returned: the store rounds it to a float, and a minimum that rounds
        // *down* leaves the remap below zero — where Math.pow returns NaN,
        // which then walks silently through the bisection (NaN fails every
        // comparison), collapses the exponent onto its bracket and comes out
        // the far end as a texture with a mean of 0.92. Measured, three of the
        // seven channels did exactly that.
        const stored = raw[y * size + x] ?? 0;
        if (stored < lo) lo = stored;
        if (stored > hi) hi = stored;
      }
    }
    const span = hi - lo || 1;
    for (let i = 0; i < texels; i++) raw[i] = ((raw[i] ?? 0) - lo) / span;

    const gamma = gammaForHalfMean(raw);
    const contrast = clamp01(plan.contrast);
    for (let i = 0; i < texels; i++) {
      const shaped = Math.pow(raw[i] ?? 0, gamma);
      data[i * 4 + channel] = Math.round((0.5 + (shaped - 0.5) * contrast) * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // These are masks, not colours. Left in sRGB the decode would bend every
  // value away from the mean this function just spent its time establishing.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Stride the bisection walks the raster with.
 *
 * A mean does not need every texel, and this bake runs on the main thread at
 * boot: measured here, sixteen full passes over the field cost more than
 * generating it did. Three rather than a round number because it has to be
 * coprime with the (power-of-two) texture width — a stride that divides the
 * width samples the same few columns over and over, and if one of the noise
 * lattices happens to line up with them the estimate is biased rather than
 * merely noisy. Coprime, the walk visits every column as it advances down the
 * rows. Measured over all seven channels the finished means land inside
 * 0.0005 of a half, which is an eighth of one 8-bit level.
 */
const MEAN_SAMPLE_STRIDE = 3;

/**
 * The exponent that puts the mean of `values ^ g` on one half.
 *
 * Raising a 0..1 field to a power is monotone in the exponent, so bisection
 * converges without ever leaving the range — which is why this and not a shift,
 * which would need clamping, and not a solve, which does not exist in closed
 * form for an arbitrary noise field. Sixteen halvings of the bracket pin the
 * exponent to 3e-4, far below what the 8-bit quantisation that follows can
 * carry.
 */
function gammaForHalfMean(values: Float32Array): number {
  const meanAt = (gamma: number): number => {
    let total = 0;
    let count = 0;
    for (let i = 0; i < values.length; i += MEAN_SAMPLE_STRIDE) {
      total += Math.pow(values[i] ?? 0, gamma);
      count++;
    }
    return count > 0 ? total / count : 0.5;
  };
  let low = 0.05;
  let high = 20;
  for (let step = 0; step < 16; step++) {
    const mid = (low + high) / 2;
    // A larger exponent pulls a 0..1 field down, so a mean above one half means
    // the exponent has to grow.
    if (meanAt(mid) > 0.5) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// --- Noise -------------------------------------------------------------------

/**
 * Value noise on a lattice that wraps, which is the only reason any of the
 * generated maps tile. The periods are independent so a field can be stretched
 * along one axis — bedding planes, grass grain — and still meet itself.
 */
function tiledNoise(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  salt: number,
): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, periodX);
  const x1 = wrap(ix + 1, periodX);
  const y0 = wrap(iy, periodY);
  const y1 = wrap(iy + 1, periodY);
  const top = mix(hashUnit(x0, y0, salt), hashUnit(x1, y0, salt), ux);
  const bottom = mix(hashUnit(x0, y1, salt), hashUnit(x1, y1, salt), ux);
  return mix(top, bottom, uy);
}

/**
 * Fractal sum. `periodX`/`periodY` are the coarsest lattice — the number of
 * features across one repeat of the texture — and each octave doubles both,
 * which keeps every lattice an integer and so keeps every octave tiling.
 */
function fbm(
  u: number,
  v: number,
  periodX: number,
  periodY: number,
  octaves: number,
  salt: number,
): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let px = periodX;
  let py = periodY;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * tiledNoise(u * px, v * py, px, py, salt + octave * 31);
    norm += amplitude;
    amplitude *= 0.5;
    px *= 2;
    py *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Fractal sum of creases: high wherever an octave crosses its own middle. */
function ridged(
  u: number,
  v: number,
  periodX: number,
  periodY: number,
  octaves: number,
  salt: number,
): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let px = periodX;
  let py = periodY;
  for (let octave = 0; octave < octaves; octave++) {
    const n = tiledNoise(u * px, v * py, px, py, salt + octave * 53);
    sum += amplitude * (1 - Math.abs(n * 2 - 1));
    norm += amplitude;
    amplitude *= 0.5;
    px *= 2;
    py *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Stable 0..1 hash — the recipe terrain.ts, facade.ts and buildings.ts share. */
function hashUnit(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Written the positive way round so a NaN falls out as 0 rather than as a NaN.
 * Everything downstream of this ends up in a uniform, and a NaN uniform is not
 * a wrong colour, it is a ground that renders as nothing — the same class of
 * silent, self-propagating fault the save layer already refuses to write.
 */
function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}
