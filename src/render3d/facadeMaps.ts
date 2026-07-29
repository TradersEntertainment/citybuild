import * as THREE from 'three';
import type { FacadeOptions } from './facade';

/**
 * Surface detail for the generated facades: a tangent-space normal map and a
 * packed occlusion/roughness/metalness map, both drawn from the *same*
 * `FacadeOptions` that `facade.ts` paints the colour and emissive canvases from.
 *
 * The coupling is the whole point. A window that is painted in the colour map is
 * a hole in the normal map, is dark in the AO map where the soffit hangs over
 * it, and is glassier in the roughness map than the plaster around it. Three
 * maps, one description of a facade — so they cannot drift apart, and so a
 * change to an archetype table moves all of them at once.
 *
 * Nothing here is an image file: the project generates every texture it uses
 * (facade.ts:4-11, sky.ts:75-79) and these are built the same way, as plain
 * `DataTexture` byte arrays. That has a second benefit over the colour canvases
 * — a `DataTexture` needs no `<canvas>`, so this file runs unmodified in a node
 * test runner and needs no injection seam of its own.
 *
 * WHAT IT COSTS, as arithmetic (there is no GPU in the environment this was
 * written in, so nothing here is a frame-rate claim):
 *
 *   The maps depend only on the window *layout* — columns, rows, and whether
 *   the facade is banded. They do not depend on any colour, nor on `lit`: a lit
 *   window is not more recessed than a dark one. So they are cached on the
 *   layout rather than on the archetype, and the sixty archetypes in
 *   archetypes.ts collapse to **thirty-two distinct layouts** (counted from the
 *   tables) — a 47% saving before a single byte is allocated.
 *
 *   Sizes are derived from the layout instead of fixed, because a two-by-one
 *   cottage facade and a nine-by-forty-two tower facade do not want the same
 *   texture. RGBA8 with a mip chain, summed over every layout in the game:
 *
 *     'low'   ORM only              0.72 MiB   (0.39 MiB for the modern period)
 *     'high'  ORM + normal          4.50 MiB   (2.51 MiB for the modern period)
 *
 *   Against the colour and emissive canvases already resident — 683 KiB per
 *   archetype, 13.3 MiB for one live period — 'low' is +3% and 'high' is +19%.
 *   Buckets are built on demand exactly as in buildings.ts, so a village still
 *   pays for a village.
 *
 *   Generation is CPU, on the frame a district first needs an archetype, next to
 *   the two facade canvases that frame already draws. Timed here (a desktop
 *   core, warm, not a phone): 1.1 ms for an average layout at 'low' and 1.9 ms
 *   for the worst; 4.4 ms average at 'high' and 10.7 ms for the worst, which is
 *   the 128x256 map the nine-by-forty-two office asks for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: there is no darkening at the foot of the
 * wall. The facade texture tiles `up` times up a building (buildings.ts:303), so
 * anything authored at the bottom of the tile repeats at every storey — a
 * ground-contact gradient here would come out as a stack of stripes. Contact
 * shadow belongs to the terrain vertex colours or to a decal under the
 * footprint, not to a tiling map.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
// These belong in src/data/balance.ts under the project's tunables rule, and
// should move there with the rest of the graphics tier when one exists. They
// are here because this change is allowed to create exactly one file, and a
// number with no home is worse than a number in the wrong file.

/** Quality tier. Everything expensive has to be something a phone can refuse. */
export type FacadeMapQuality =
  /** No maps generated, nothing uploaded, no shader patch. The escape hatch. */
  | 'off'
  /** Occlusion + roughness + metalness in one texture: one extra fetch. */
  | 'low'
  /** Adds the normal map: a second fetch plus a derivative tangent frame. */
  | 'high';

/**
 * Texels per window cell, and the ceiling on either axis.
 *
 * A window needs enough texels across it for the reveal to be more than one
 * texel wide, or the normal map is a single spike that the first mip erases.
 * Ten is comfortable; six still resolves the opening and halves the byte count,
 * which is the trade the low tier is making. The ceilings stop the tallest
 * archetype (nine columns by forty-two rows) from asking for a 128×512 map:
 * it lands on 128×256 at 'high', which is six texels per storey — the same six
 * pixels per storey the colour canvas already gives it. When the facade UV
 * repeat is eventually fixed in buildings.ts these get denser for free.
 */
const TEXELS_PER_CELL: Record<'low' | 'high', number> = { low: 6, high: 10 };
const MAP_MAX_DIMENSION: Record<'low' | 'high', number> = { low: 128, high: 256 };
/** Below this a map is all edge and no surface; the smallest layout is 2×1. */
const MAP_MIN_DIMENSION = 32;

/**
 * Matches `facade.ts:84`. Matching matters more than maximising: if the detail
 * maps filter differently from the colour map at the game's oblique camera
 * angle, the recess slides off the window it was cut for.
 */
const MAP_ANISOTROPY = 4;

/**
 * How wide one texture tile is against how tall, in storeys.
 *
 * buildings.ts:302-303 lays the facade out as `across = footprint / (STOREY *
 * 1.6)` and `up = top / STOREY`, so one tile is nominally 1.6 storeys wide and
 * one storey tall whatever the archetype — the two terms share STOREY and the
 * ratio survives. A normal map has to know this: the shader's tangent frame
 * (three's `getTangentFrame`) keeps the u:v world aspect, so a gradient encoded
 * as if the tile were square would make every vertical edge 2.6× too strong.
 */
const TILE_ASPECT = 1.6;

/**
 * The window as facade.ts draws it, in fractions of one cell.
 *
 * DUPLICATED ON PURPOSE, AND THE ONE FRAGILE SEAM IN THIS FILE. facade.ts:57-78
 * owns these numbers and does not export them; if they change there and not
 * here, the painted window and the modelled hole come apart and the whole point
 * of generating both from one description is lost. Exported so a test can pin
 * the two files together.
 */
export const FACADE_CELL = {
  /** facade.ts:59 — `winW = cellW * 0.62`. */
  windowWidth: 0.62,
  /** facade.ts:60 — `winH = cellH * 0.54` on a banded wall. */
  windowHeightBanded: 0.54,
  /** facade.ts:60 — and 0.46 on a punched one. */
  windowHeightPunched: 0.46,
  /** facade.ts:72 — the dark head bar, as a fraction of the window height. */
  headFraction: 0.14,
  /** facade.ts:77 — the floor slab, as a fraction of the cell height. */
  slabFraction: 0.08,
} as const;

/** Half-width of a curtain-wall mullion, in cell fractions. */
const MULLION_HALF = 0.035;
/** Depth of the sill ledge under a punched window, in cell fractions. */
const SILL_DEPTH = 0.05;
/** How far the sill oversails the opening on each side. */
const SILL_OVERHANG = 0.03;
/** Frame thickness inside the opening, as a fraction of the window half-size. */
const FRAME_FRACTION = 0.16;
/** Soft edge width, in texels. Just over one, so the first mip keeps the edge. */
const EDGE_TEXELS = 1.25;

/**
 * Relief, as a proportion of one reveal depth. The wall is zero, so everything
 * here reads as "how far in or out of the plaster, relative to how deep a window
 * sits". Kept relative rather than absolute because the occlusion pass reads the
 * same field, and AO that changed strength with the archetype's window density
 * would be a different kind of wrong.
 */
const RELIEF_GLASS = -1;
const RELIEF_HEAD = -1.18;
const RELIEF_FRAME = -0.45;
const RELIEF_TRIM = 0.29;
const RELIEF_GRAIN = 0.055;

/**
 * And how deep one reveal actually is, in storeys — derived per layout, not
 * fixed.
 *
 * A fixed depth is the mistake this replaced. A reveal was authored at 0.11
 * storeys (26 cm at 1 tile ≈ 8 m, which is a correct masonry opening) and then
 * applied to a modern com L5, whose thirty-four rows make one window cell 1/34
 * of a storey — seven centimetres tall. A 26 cm reveal on a 7 cm window is not a
 * deep window, it is a slope: measured, the pane centre came back tilted 68°
 * and the tower read as stacked ledges. So the depth is a fraction of the
 * *smaller side of a window cell*, which keeps every reveal in proportion to the
 * opening it belongs to at every density in the tables. The ceiling stops a
 * two-by-one cottage facade — whose cells are most of a storey across — from
 * getting a two-thirds-of-a-metre cave; the floor stops the arithmetic
 * collapsing to nothing on the densest towers.
 */
const RELIEF_DEPTH_FRACTION = 0.18;
const RELIEF_DEPTH_MIN = 0.004;
const RELIEF_DEPTH_MAX = 0.12;

/**
 * Ceiling on the encoded gradient, as a slope. Four is about 76° — steep enough
 * for a reveal, shallow enough that a one-texel step on the smallest map cannot
 * flip a normal fully sideways and punch a black hole in the wall.
 */
const MAX_SLOPE = 4;

/**
 * FADE A FEATURE OUT, NEVER FATTEN IT. The rule that keeps dense layouts sane.
 *
 * The archetype tables author `rows` as storeys for the whole building, so a
 * level-five commercial block asks for thirty-four window rows inside one
 * texture tile and a level-five office asks for forty-two. Even at the
 * 256-texel ceiling that is seven and six texels per cell, and a mullion at
 * 3.5% of a cell is then a quarter of a texel wide. The obvious reflex — floor
 * every feature at about one soft edge so it stays visible — is wrong, and
 * measurably so: widening the window frame to a texel and a half made it wider
 * than the pane it was framing, and the pane centre of a modern com L5 came back
 * with a normal of (128, 251, 158), tilted almost fully *upward*. A tower
 * shaded with that reads as corrugated iron.
 *
 * So a feature narrower than the soft edge fades instead, proportionally, in all
 * three maps at once. That keeps them agreeing with each other and with the
 * colour canvas, which is smearing the same feature into grey for exactly the
 * same reason. When the facade UV repeat is fixed upstream, the cells get bigger
 * and every one of these features comes back on its own.
 */
function resolvable(half: number, soft: number): number {
  return clamp(half / soft, 0, 1);
}

/**
 * Occlusion is an unsharp mask on the relief: a texel lower than its own
 * neighbourhood is in a hole. The field runs from +0.29 to −1.18, so a gain a
 * little over one takes most of a reveal to full occlusion and leaves the
 * plaster grain (±0.055) contributing almost nothing. Measured across a cell at
 * this gain: plaster stays at a flat 255 — the map darkens nothing it was not
 * asked to — the reveal dips to about 0.6 and the soffit reaches the floor.
 */
const AO_GAIN = 1.6;
/** How much of that occlusion is actually spent. */
const AO_STRENGTH = 0.85;
/** Extra darkening under the head, where facade.ts paints its dark bar. */
const AO_HEAD = 0.3;
/**
 * Occlusion never goes to black. three multiplies indirect diffuse by this
 * (aomap_fragment), and this scene is fill-dominated — one hemisphere at 1.15
 * against a key of 2.75 — so a zero here would put a window reveal several
 * stops below anything else on screen.
 */
const AO_FLOOR = 0.38;
/**
 * Blur radius as a fraction of a cell, per axis.
 *
 * Deliberately short. At a third of a cell the blur is wider than a window is,
 * so the whole pane comes back uniformly occluded — measured at 0.68 across a
 * five-by-seven curtain wall, which is not contact shading, it is a grey filter
 * over the glazing. At a fifth of a cell the pane centre sees only itself and
 * comes back clean, and the occlusion collects where it belongs: in the reveal.
 */
const AO_RADIUS_CELLS = 0.2;
const AO_RADIUS_MAX = 5;

/**
 * Roughness and metalness are written as multipliers on whatever the material
 * authored (three does `roughnessFactor *= texel.g`, `metalnessFactor *=
 * texel.b`), which is why the wall sits at exactly 1.0: the map can only make a
 * surface glassier than the wall around it, never rougher, and buildings.ts
 * keeps its authored 0.76 plaster / 0.32 curtain wall meaning what it says.
 */
const ROUGH_WALL = 1;
const ROUGH_GRAIN = 0.07;
const ROUGH_GLASS_BANDED = 0.3;
const ROUGH_GLASS_PUNCHED = 0.44;
const ROUGH_TRIM = 0.8;
const ROUGH_FRAME = 0.72;

/**
 * Metalness only ever comes down. With no environment map in the scene the
 * metallic lobe has nothing to reflect and returns black, so metalness on
 * plaster is a pure darkening term — buildings.ts:125 puts 0.28 on the whole of
 * a modern commercial facade, mortar included. Pulling the wall to 0.12 of that
 * leaves the plaster matte and keeps the sheen on the glass, which is the safe
 * direction until a PMREM sky exists. When one does, this map is already the
 * right shape for it.
 */
const METAL_WALL = 0.12;
const METAL_TRIM = 0.75;
const METAL_GLASS = 1;

/**
 * The runtime dial on the relief, and the first number to turn down if the
 * facades read as embossed rather than built. Below one because the encoded
 * gradients are already steep: measured across the whole archetype table, a
 * reveal comes out between 10° off the wall on the densest towers — where the
 * cell is a few texels and the depth scales down with it — and 43° on a
 * four-by-three industrial shed.
 */
const NORMAL_SCALE = 0.85;
/**
 * three applies occlusion as `(texel.r - 1) * aoMapIntensity + 1`, and only to
 * indirect diffuse. Slightly under one leaves a little air in the deepest
 * reveals rather than letting them race the AO floor to the bottom.
 */
const AO_INTENSITY = 0.9;
/** Spread of the per-building roughness wobble; ±6% of the authored value. */
const ROUGH_SPREAD = 0.12;

/**
 * Where the relief stops being worth shading.
 *
 * Not `LOD_DETAIL_DISTANCE`: that constant is 170 (constants.ts:56) and the
 * orbit camera tops out at `CAMERA_BASE_DISTANCE / ZOOM_MIN` = 34 / 0.23 = 148,
 * so nothing anchored on it would ever fire. The arithmetic that matters here
 * is screen scale: at FOV 45 over 780 CSS px the frame shows `780 / (2 d
 * tan22.5°)` = 941/d pixels per world unit, so one storey (0.3 units) is 6.3 px
 * at d = 45 and 2.6 px at d = 110. Below three pixels a storey the reveal is
 * sub-pixel and the normal map is contributing shimmer, not shape — so it fades
 * out across that band. The AO map is left alone: it is low-frequency, its mips
 * average correctly, and it is the cheap tier's whole reason to exist.
 */
const RELIEF_FULL_DISTANCE = 45;
const RELIEF_GONE_DISTANCE = 110;

/** RGBA8, plus the mip chain (1 + 1/4 + 1/16 + … = 4/3). */
const BYTES_PER_TEXEL = 4;
const MIP_FACTOR = 4 / 3;

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface FacadeMapStats {
  quality: FacadeMapQuality;
  /** Distinct window layouts generated so far. */
  layouts: number;
  /** Textures currently held. */
  textures: number;
  /** Bytes on the GPU, mip chains included. Arithmetic, not a measurement. */
  bytes: number;
}

export interface FacadeMapLayer {
  readonly quality: FacadeMapQuality;
  readonly stats: FacadeMapStats;
  /**
   * Hangs the detail maps on a facade material and installs the per-instance
   * variation hook. Call once per material, from `kitFor`, right after the
   * material is made — never from `makeBucket` or `growBucket`, which is the
   * rule the whole Kit/Bucket split exists to hold (buildings.ts:40-57).
   */
  attach(material: THREE.MeshStandardMaterial, options: FacadeOptions): void;
  /** Per-frame: fades the relief out as the camera pulls back. Cheap. */
  update(cameraDistance: number): void;
  /** Switches tier. Rebinds every attached material and frees what is unused. */
  setQuality(quality: FacadeMapQuality): void;
  dispose(): void;
}

/**
 * The cache key: everything about a facade that changes its *relief*. Colours,
 * `lit` and `litColour` are all absent on purpose — they change the picture,
 * not the surface, and including them would triple the texture count for maps
 * that would come out byte-identical.
 */
export function facadeMapKey(
  options: Pick<FacadeOptions, 'columns' | 'rows' | 'banded'>,
): string {
  return `${options.columns}x${options.rows}${options.banded ? 'b' : 'p'}`;
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

interface Layout {
  columns: number;
  rows: number;
  banded: boolean;
}

interface DetailMaps {
  /** Tangent-space normal, RGB. Null below the 'high' tier. */
  normal: THREE.DataTexture | null;
  /** R = occlusion, G = roughness, B = metalness — three reads exactly those. */
  orm: THREE.DataTexture;
  bytes: number;
}

type ProgramParameters = Parameters<THREE.Material['onBeforeCompile']>[0];

interface Registration {
  layout: Layout;
  /** Live uniform objects, reused across recompiles so `update` keeps landing. */
  cells: { value: THREE.Vector2 };
  spread: { value: number };
  baseCompile: THREE.Material['onBeforeCompile'];
  baseCacheKey: THREE.Material['customProgramCacheKey'];
  release: () => void;
}

/**
 * @param quality Defaults to 'low' — the occlusion and roughness maps, without
 * the normal map. That is the conservative default on purpose: AO is the large
 * cheap win in a scene lit by one key and one fill, at +3% texture memory and
 * one fetch, whereas the normal map adds a second fetch and a screen-space
 * tangent frame across the largest opaque surfaces in the frame. Once the
 * project has a graphics tier, pass 'high' from it on anything that can afford
 * it; this file should not be the thing deciding what a device can do.
 */
export function createFacadeMaps(quality: FacadeMapQuality = 'low'): FacadeMapLayer {
  const cache = new Map<string, DetailMaps>();
  const registry = new Map<THREE.MeshStandardMaterial, Registration>();
  let current = quality;
  /** 0..1 LOD fade on the normal map; see RELIEF_FULL_DISTANCE. */
  let reliefFade = 1;

  const mapsFor = (layout: Layout): DetailMaps | null => {
    if (current === 'off') return null;
    const key = `${facadeMapKey(layout)}:${current}`;
    const found = cache.get(key);
    if (found) return found;
    const built = buildDetailMaps(layout, current);
    cache.set(key, built);
    return built;
  };

  /** Points a material at the maps its layout wants, or at nothing. */
  const bind = (material: THREE.MeshStandardMaterial, registration: Registration): void => {
    const maps = mapsFor(registration.layout);
    if (!maps) {
      material.normalMap = null;
      material.aoMap = null;
      material.roughnessMap = null;
      material.metalnessMap = null;
      // Restore the material exactly as buildings.ts left it, so 'off' really
      // is off: no patched program, no extra varying, no uniform upload.
      material.onBeforeCompile = registration.baseCompile;
      material.customProgramCacheKey = registration.baseCacheKey;
      material.needsUpdate = true;
      return;
    }

    if (maps.normal) {
      material.normalMap = maps.normal;
      material.normalMapType = THREE.TangentSpaceNormalMap;
      material.normalScale.set(NORMAL_SCALE * reliefFade, NORMAL_SCALE * reliefFade);
    } else {
      material.normalMap = null;
    }
    // One texture serving three slots: this is the glTF occlusion/roughness/
    // metalness packing, and three reads R, G and B respectively (see
    // aomap_fragment, roughnessmap_fragment, metalnessmap_fragment). Three
    // bindings, one upload. `channel` stays 0, so it samples the same `uv` the
    // colour map does — no second UV set anywhere.
    material.aoMap = maps.orm;
    material.aoMapIntensity = AO_INTENSITY;
    material.roughnessMap = maps.orm;
    material.metalnessMap = maps.orm;
    material.needsUpdate = true;
  };

  const attach = (material: THREE.MeshStandardMaterial, options: FacadeOptions): void => {
    if (registry.has(material)) return;

    const layout: Layout = {
      columns: Math.max(1, Math.round(options.columns)),
      rows: Math.max(1, Math.round(options.rows)),
      banded: options.banded,
    };
    const registration: Registration = {
      layout,
      cells: { value: new THREE.Vector2(layout.columns, layout.rows) },
      spread: { value: ROUGH_SPREAD },
      baseCompile: material.onBeforeCompile,
      baseCacheKey: material.customProgramCacheKey,
      release: () => undefined,
    };

    // A material that disposes itself takes its registration with it. The
    // buildings layer drops every material at once (buildings.ts:245), but a
    // registry holding hard references to dead materials is the same leak class
    // tests/meshLeaks.test.ts exists for, and this costs one listener.
    const onDispose = (): void => {
      registry.delete(material);
    };
    material.addEventListener('dispose', onDispose);
    registration.release = () => material.removeEventListener('dispose', onDispose);

    // Chained, not replaced: another layer may already be patching this
    // material, and silently dropping its patch would be invisible until
    // something it drew went missing. Chaining means the emitted source now
    // differs per material, so the cache key has to carry the previous
    // function's identity — two materials sharing a key but not a shader is the
    // classic onBeforeCompile trap.
    const base = registration.baseCompile;
    material.onBeforeCompile = function patchFacadeMaps(shader, renderer) {
      base.call(this, shader, renderer);
      patchVariation(shader, registration);
    };
    material.customProgramCacheKey = function facadeMapsCacheKey() {
      return `facadeMaps:${base.toString()}`;
    };

    registry.set(material, registration);
    bind(material, registration);
  };

  const update = (cameraDistance: number): void => {
    if (current !== 'high') return;
    const faded =
      1 - smoothstep(RELIEF_FULL_DISTANCE, RELIEF_GONE_DISTANCE, cameraDistance);
    // Only write when it has actually moved: this runs on every frame for every
    // live archetype, and a Vector2 write per material per frame for a number
    // that changes on a zoom is work nobody asked for.
    if (Math.abs(faded - reliefFade) < 0.01) return;
    reliefFade = faded;
    const scale = NORMAL_SCALE * reliefFade;
    for (const material of registry.keys()) material.normalScale.set(scale, scale);
  };

  const setQuality = (next: FacadeMapQuality): void => {
    if (next === current) return;
    // Take the old maps out of the cache first, then rebind — every material is
    // pointed at its replacement (or at null) before a single texture is freed.
    // Disposing a texture a live material still holds is a black facade at best
    // and a lost context at worst.
    const stale = [...cache.values()];
    cache.clear();
    current = next;
    for (const [material, registration] of registry) bind(material, registration);
    for (const maps of stale) {
      maps.normal?.dispose();
      maps.orm.dispose();
    }
  };

  return {
    get quality(): FacadeMapQuality {
      return current;
    },
    get stats(): FacadeMapStats {
      let bytes = 0;
      let textures = 0;
      for (const maps of cache.values()) {
        bytes += maps.bytes;
        textures += maps.normal ? 2 : 1;
      }
      return { quality: current, layouts: cache.size, textures, bytes };
    },
    attach,
    update,
    setQuality,
    dispose: () => {
      for (const [material, registration] of registry) {
        material.normalMap = null;
        material.aoMap = null;
        material.roughnessMap = null;
        material.metalnessMap = null;
        material.onBeforeCompile = registration.baseCompile;
        material.customProgramCacheKey = registration.baseCacheKey;
        registration.release();
      }
      registry.clear();
      for (const maps of cache.values()) {
        maps.normal?.dispose();
        maps.orm.dispose();
      }
      cache.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Per-instance variation
// ---------------------------------------------------------------------------

/**
 * The photocopy fix, for no bytes and no extra attribute.
 *
 * A row of five level-3 blocks currently lights the same windows in the same
 * pattern five times over: the archetype's texture is shared, so the facade is
 * identical however much the instance colour wobbles. The cure is to give each
 * building its own phase into the texture — but the phase has to be *whole
 * cells*, or the painted window slides off the recess this file cut for it, and
 * it has to be *the same* phase for the colour, emissive, normal and ORM maps
 * or they come apart from each other.
 *
 * The seed is a hash of the instance's own translation, which is already in the
 * vertex shader as `instanceMatrix[3].xz` in tile space. That buys the whole
 * feature with no `InstancedBufferAttribute` at all — nothing to allocate,
 * nothing for `growBucket` to carry across a doubling (buildings.ts:268), and
 * it survives a reload for the same reason the existing plot hashes do: a
 * building does not move.
 *
 * The same hash rides through to the fragment shader as a small roughness
 * wobble, so two identical towers do not have identical sheen either.
 */
function patchVariation(shader: ProgramParameters, registration: Registration): void {
  shader.uniforms['uFacadeCells'] = registration.cells;
  shader.uniforms['uFacadeRoughSpread'] = registration.spread;

  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
uniform vec2 uFacadeCells;
varying float vFacadeVary;
// Sine-free, and that is not a style choice.
//
// The project's own hash is fract(sin(x * 127.1 + y * 311.7 + salt) * 43758.5),
// which is exact enough in JavaScript's doubles and is used everywhere on the
// CPU side. On the GPU it is a float32, and a plot at tile (200, 200) hands
// sin() an argument near ninety thousand — past the point where a 24-bit
// mantissa still holds the low bits the range reduction needs. Measured here
// under SwiftShader: every plot in the city came back with the *same* hash, the
// shift was always zero, and the whole variation did nothing at all while
// looking perfectly correct in the source. This is Hoskins' hash22, which is
// multiply-and-fract only and therefore bit-exact on any conformant GLSL.
vec2 facadeHash2(vec2 plot) {
  vec3 p = fract(vec3(plot.x, plot.y, plot.x) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xx + p.yz) * p.zy);
}`,
    )
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
{
  #ifdef USE_INSTANCING
    vec2 facadePlot = floor(vec2(instanceMatrix[3].x, instanceMatrix[3].z));
  #else
    vec2 facadePlot = vec2(0.0);
  #endif
  vec2 facadeRand = facadeHash2(facadePlot);
  vFacadeVary = fract(facadeRand.x * 3.7 + facadeRand.y * 5.3);
  // Whole cells only. The window grid is exactly periodic at 1/columns and
  // 1/rows, so a whole-cell shift leaves every opening where it was and only
  // changes which of them are lit and which grain column runs down the wall.
  vec2 facadeShift = floor(facadeRand * uFacadeCells) / uFacadeCells;
  #ifdef USE_MAP
    vMapUv += facadeShift;
  #endif
  #ifdef USE_EMISSIVEMAP
    vEmissiveMapUv += facadeShift;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv += facadeShift;
  #endif
  #ifdef USE_AOMAP
    vAoMapUv += facadeShift;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv += facadeShift;
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv += facadeShift;
  #endif
}`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uFacadeRoughSpread;
varying float vFacadeVary;`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor * (1.0 + (vFacadeVary - 0.5) * uFacadeRoughSpread),
  0.03,
  1.0
);`,
    );
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * One pass over the facade description produces a relief field, four masks and a
 * grain field; all three maps are read off those and nothing else. That single
 * source is what keeps them agreeing with each other and with the colour canvas
 * — the moment the normal map has its own idea of where a window is, the
 * coupling this file exists for is gone.
 */
function buildDetailMaps(layout: Layout, quality: 'low' | 'high'): DetailMaps {
  const width = mapDimension(layout.columns, quality);
  const height = mapDimension(layout.rows, quality);
  const count = width * height;

  const relief = new Float32Array(count);
  const open = new Float32Array(count);
  const head = new Float32Array(count);
  const frame = new Float32Array(count);
  const trim = new Float32Array(count);
  const grain = new Float32Array(count);

  const halfW = FACADE_CELL.windowWidth / 2;
  const halfH =
    (layout.banded ? FACADE_CELL.windowHeightBanded : FACADE_CELL.windowHeightPunched) / 2;
  // Soft edges are specified in texels and converted to cell fractions, so a
  // 32-texel map and a 256-texel one both get an edge the mip chain can hold.
  const softU = (EDGE_TEXELS * layout.columns) / width;
  const softV = (EDGE_TEXELS * layout.rows) / height;
  const frameU = halfW * FRAME_FRACTION;
  const frameV = halfH * FRAME_FRACTION;
  // facade.ts paints the head bar down from the top of the opening; in v — which
  // runs up the wall — that is the top of the window, i.e. a lintel soffit.
  const headHalf = halfH * FACADE_CELL.headFraction;
  const headCentre = 0.5 + halfH - headHalf;
  const slabHalf = FACADE_CELL.slabFraction / 2;
  const slabCentre = 1 - slabHalf;
  const sillHalf = SILL_DEPTH / 2;
  const sillCentre = 0.5 - halfH - sillHalf;

  // How much of each sub-feature this map can actually hold. See `resolvable`.
  const frameFade = Math.min(resolvable(frameU, softU), resolvable(frameV, softV));
  const headFade = resolvable(headHalf, softV);
  const slabFade = resolvable(slabHalf, softV);
  const mullionFade = resolvable(MULLION_HALF, softU);
  const sillFade = resolvable(sillHalf, softV);

  // Two octaves of plaster mottle. Frequencies are integers so both wrap.
  const coarseMottle = tileNoiseField(width, height, 8, 8, 5);
  const fineMottle = tileNoiseField(width, height, 24, 24, 17);

  // EVERY MASK ON THIS FACADE IS SEPARABLE. A window is a horizontal band times
  // a vertical band; a mullion is horizontal only; a slab and a soffit vertical
  // only. So the bands are evaluated once per column and once per row instead of
  // once per texel, and the inner loop is left with multiplications. On the
  // largest layout that is under two thousand `cellBand` calls rather than a
  // quarter of a million, which is most of the difference between a 128x256 map
  // costing about 15 ms on the frame a district first needs an archetype and the
  // 10.7 ms it costs now, alongside the two facade canvases that frame is
  // already drawing.
  const uWindow = new Float32Array(width);
  const uInner = new Float32Array(width);
  const uMullion = new Float32Array(width);
  const uSill = new Float32Array(width);
  const uStreak = new Float32Array(width);
  for (let i = 0; i < width; i++) {
    const u = (i + 0.5) / width;
    const cellU = frac(u * layout.columns);
    uWindow[i] = cellBand(cellU, 0.5, halfW, softU);
    uInner[i] = cellBand(cellU, 0.5, halfW - frameU, softU);
    uMullion[i] = cellBand(cellU, 0, MULLION_HALF, softU) * mullionFade;
    uSill[i] = cellBand(cellU, 0.5, halfW + SILL_OVERHANG, softU);
    // Vertical grain in the plaster: integer harmonics of u, so it wraps.
    uStreak[i] =
      0.5 +
      Math.sin(u * Math.PI * 2 * 3 + 0.9) * 0.2 +
      Math.sin(u * Math.PI * 2 * 7 + 2.3) * 0.16 +
      Math.sin(u * Math.PI * 2 * 13 + 4.1) * 0.1;
  }

  const vWindow = new Float32Array(height);
  const vInner = new Float32Array(height);
  const vHead = new Float32Array(height);
  const vSlab = new Float32Array(height);
  const vSill = new Float32Array(height);
  for (let j = 0; j < height; j++) {
    const cellV = frac(((j + 0.5) / height) * layout.rows);
    vWindow[j] = cellBand(cellV, 0.5, halfH, softV);
    vInner[j] = cellBand(cellV, 0.5, halfH - frameV, softV);
    vHead[j] = cellBand(cellV, headCentre, headHalf, softV) * headFade;
    vSlab[j] = cellBand(cellV, slabCentre, slabHalf, softV) * slabFade;
    vSill[j] = cellBand(cellV, sillCentre, sillHalf, softV) * sillFade;
  }

  for (let j = 0; j < height; j++) {
    const windowV = vWindow[j] as number;
    const innerV = vInner[j] as number;
    const headV = vHead[j] as number;
    const slabV = vSlab[j] as number;
    const sillV = vSill[j] as number;
    for (let i = 0; i < width; i++) {
      const k = j * width + i;

      const inWindow = (uWindow[i] as number) * windowV;
      const inner = (uInner[i] as number) * innerV;
      const headMask = inWindow * headV;

      // Curtain wall gets a floor slab across the top of every cell — the line
      // facade.ts:77 paints — and a mullion up the joint between cells. A
      // punched wall gets a stone sill oversailing the reveal instead: there is
      // nothing for it in the colour map, and there does not need to be, because
      // a sill is relief rather than paint and that is exactly what a normal map
      // can say and a painted canvas cannot.
      const trimMask = layout.banded
        ? Math.max(slabV, uMullion[i] as number)
        : (uSill[i] as number) * sillV;

      const mottle = (coarseMottle[k] as number) * 0.55 + (fineMottle[k] as number) * 0.45;
      const grainValue = clamp((uStreak[i] as number) * 0.6 + mottle * 0.4, 0, 1);

      const frameMask = (inWindow - inner) * frameFade;
      let h = 0;
      h = mix(h, RELIEF_TRIM, trimMask);
      h = mix(h, RELIEF_GLASS, inWindow);
      h = mix(h, RELIEF_FRAME, frameMask);
      h = mix(h, RELIEF_HEAD, headMask);
      // Grain lives on the plaster only; glass is flat, which is most of what
      // makes glass read as glass at this distance.
      h += (grainValue - 0.5) * RELIEF_GRAIN * (1 - inWindow);

      relief[k] = h;
      open[k] = inWindow;
      head[k] = headMask;
      frame[k] = frameMask;
      trim[k] = trimMask;
      grain[k] = grainValue;
    }
  }

  // Occlusion reference: the relief blurred over roughly a fifth of a cell.
  // Naive and wrapped rather than a sliding sum — this runs once per layout, at
  // most 128x256 texels with a radius of five, which is half a million adds on
  // the frame that first needs the archetype and never again.
  const radiusX = blurRadius(width, layout.columns);
  const radiusY = blurRadius(height, layout.rows);
  const blurred = boxBlurWrapped(relief, width, height, radiusX, radiusY);

  const orm = new Uint8Array(count * 4);
  const glassRough = layout.banded ? ROUGH_GLASS_BANDED : ROUGH_GLASS_PUNCHED;
  for (let k = 0; k < count; k++) {
    const inWindow = open[k] as number;
    const headMask = head[k] as number;
    const frameMask = frame[k] as number;
    const trimMask = trim[k] as number;

    const cavity = clamp(((blurred[k] as number) - (relief[k] as number)) * AO_GAIN, 0, 1);
    let ao = 1 - cavity * AO_STRENGTH;
    ao *= 1 - headMask * AO_HEAD;
    ao = clamp(ao, AO_FLOOR, 1);

    let rough = ROUGH_WALL - ROUGH_GRAIN * (grain[k] as number);
    rough = mix(rough, ROUGH_TRIM, trimMask);
    rough = mix(rough, glassRough, inWindow);
    rough = mix(rough, ROUGH_FRAME, frameMask);

    let metal = METAL_WALL;
    metal = mix(metal, METAL_TRIM, trimMask);
    metal = mix(metal, METAL_GLASS, inWindow);
    metal = mix(metal, METAL_TRIM, frameMask);

    const o = k * 4;
    orm[o] = byte(ao);
    orm[o + 1] = byte(rough);
    orm[o + 2] = byte(metal);
    orm[o + 3] = 255;
  }

  let normal: THREE.DataTexture | null = null;
  if (quality === 'high') {
    const bytes = new Uint8Array(count * 4);
    // One reveal, in storeys, for this layout's window size. See the constants.
    const depth = clamp(
      Math.min(TILE_ASPECT / layout.columns, 1 / layout.rows) * RELIEF_DEPTH_FRACTION,
      RELIEF_DEPTH_MIN,
      RELIEF_DEPTH_MAX,
    );
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const k = j * width + i;
        // Central differences in texture space, wrapped.
        const dhdu =
          ((relief[j * width + wrap(i + 1, width)] as number) -
            (relief[j * width + wrap(i - 1, width)] as number)) *
          0.5 *
          width;
        const dhdv =
          ((relief[wrap(j + 1, height) * width + i] as number) -
            (relief[wrap(j - 1, height) * width + i] as number)) *
          0.5 *
          height;
        // The tile is TILE_ASPECT storeys wide and one tall, and three's
        // derivative tangent frame keeps that ratio, so the u term is divided
        // by the aspect and the v term multiplied by it. Encoding a square tile
        // here would make every vertical reveal 2.6x too strong and every sill
        // too weak — the classic "normal map looks embossed" failure.
        const gx = clamp((-dhdu * depth) / TILE_ASPECT, -MAX_SLOPE, MAX_SLOPE);
        const gy = clamp(-dhdv * depth * TILE_ASPECT, -MAX_SLOPE, MAX_SLOPE);
        const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const o = k * 4;
        bytes[o] = byte(gx * inv * 0.5 + 0.5);
        bytes[o + 1] = byte(gy * inv * 0.5 + 0.5);
        bytes[o + 2] = byte(inv * 0.5 + 0.5);
        bytes[o + 3] = 255;
      }
    }
    normal = makeTexture(bytes, width, height, `facade-normal-${width}x${height}`);
  }

  const ormTexture = makeTexture(orm, width, height, `facade-orm-${width}x${height}`);
  const perMap = width * height * BYTES_PER_TEXEL * MIP_FACTOR;
  return { normal, orm: ormTexture, bytes: Math.round(perMap * (normal ? 2 : 1)) };
}

function makeTexture(
  data: Uint8Array,
  width: number,
  height: number,
  name: string,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  // DataTexture defaults to nearest with no mips, which on a facade seen at
  // three pixels a storey is a wall of crawling speckle.
  texture.generateMipmaps = true;
  texture.anisotropy = MAP_ANISOTROPY;
  // Data, not colour. An sRGB decode here would bend the encoded normals and
  // pull the roughness curve sideways; three's ColorManagement is on, so this
  // has to be said out loud rather than assumed.
  texture.colorSpace = THREE.NoColorSpace;
  // DataTexture's rows run bottom-up (flipY is false and stays false), which is
  // the orientation these were authored in: v is measured up the wall, so the
  // head band sits at the top of a window exactly as facade.ts paints it.
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Texture size for one axis: enough texels per window cell to resolve a reveal,
 * rounded up to a power of two and clamped. Powers of two are not required in
 * WebGL2 but they keep the mip chain exact and the sizes predictable.
 */
function mapDimension(cells: number, quality: 'low' | 'high'): number {
  const wanted = cells * TEXELS_PER_CELL[quality];
  let size = MAP_MIN_DIMENSION;
  while (size < wanted) size *= 2;
  return Math.min(size, MAP_MAX_DIMENSION[quality]);
}

function blurRadius(dimension: number, cells: number): number {
  return Math.max(1, Math.min(AO_RADIUS_MAX, Math.round((dimension / cells) * AO_RADIUS_CELLS)));
}

/** Separable box blur that wraps, because the map it reads tiles. */
function boxBlurWrapped(
  source: Float32Array,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): Float32Array {
  const pass = new Float32Array(source.length);
  const spanX = radiusX * 2 + 1;
  for (let j = 0; j < height; j++) {
    const row = j * width;
    for (let i = 0; i < width; i++) {
      let sum = 0;
      for (let d = -radiusX; d <= radiusX; d++) sum += source[row + wrap(i + d, width)] as number;
      pass[row + i] = sum / spanX;
    }
  }
  const out = new Float32Array(source.length);
  const spanY = radiusY * 2 + 1;
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      let sum = 0;
      for (let d = -radiusY; d <= radiusY; d++) sum += pass[wrap(j + d, height) * width + i] as number;
      out[j * width + i] = sum / spanY;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------

/**
 * A soft band inside one cell, measured the short way round so it tiles: a
 * mullion centred on the cell edge reaches into both neighbours without a seam.
 */
function cellBand(x: number, centre: number, half: number, soft: number): number {
  let d = Math.abs(x - centre);
  if (d > 0.5) d = 1 - d;
  return smoothstep(-soft, soft, half - d);
}

/**
 * One texel of tileable value noise per texel of the map, over an `fu` × `fv`
 * lattice.
 *
 * Tileable because the lattice wraps: the cell past the right edge *is* the cell
 * at the left edge, so the texture has no seam where it repeats up a wall.
 *
 * Built as a whole field rather than sampled in the mask loop for the same
 * reason the masks themselves are separable — the lattice index and the
 * interpolation weight depend on one axis each, so precomputing them costs
 * `width + height` divisions instead of two per texel, and the hash (a
 * `Math.sin`) is evaluated `fu * fv` times rather than four times per texel.
 * Measured on the largest layout: the naive form put generation at about 15 ms
 * on the frame a district first needs an archetype.
 */
function tileNoiseField(
  width: number,
  height: number,
  fu: number,
  fv: number,
  salt: number,
): Float32Array {
  const lattice = new Float32Array(fu * fv);
  for (let y = 0; y < fv; y++) {
    for (let x = 0; x < fu; x++) lattice[y * fu + x] = hashUnit(x, y, salt);
  }
  const colA = new Int32Array(width);
  const colB = new Int32Array(width);
  const weightU = new Float32Array(width);
  for (let i = 0; i < width; i++) {
    const x = ((i + 0.5) / width) * fu;
    const x0 = Math.floor(x);
    colA[i] = mod(x0, fu);
    colB[i] = mod(x0 + 1, fu);
    weightU[i] = ease(x - x0);
  }
  const field = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const y = ((j + 0.5) / height) * fv;
    const y0 = Math.floor(y);
    const rowA = mod(y0, fv) * fu;
    const rowB = mod(y0 + 1, fv) * fu;
    const sy = ease(y - y0);
    for (let i = 0; i < width; i++) {
      const a = colA[i] as number;
      const b = colB[i] as number;
      const sx = weightU[i] as number;
      field[j * width + i] = mix(
        mix(lattice[rowA + a] as number, lattice[rowA + b] as number, sx),
        mix(lattice[rowB + a] as number, lattice[rowB + b] as number, sx),
        sy,
      );
    }
  }
  return field;
}

/** The project's hash, unchanged: generated detail has to be reproducible. */
function hashUnit(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Hermite ease on an already-normalised 0..1 parameter. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function frac(x: number): number {
  return x - Math.floor(x);
}

function mod(v: number, n: number): number {
  return ((v % n) + n) % n;
}

function wrap(v: number, n: number): number {
  return v < 0 ? v + n : v >= n ? v - n : v;
}

function byte(v: number): number {
  return Math.round(clamp(v, 0, 1) * 255);
}
