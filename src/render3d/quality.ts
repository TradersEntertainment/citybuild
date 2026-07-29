import {
  MAX_DPR,
  MAX_DRAWING_PIXELS,
  TIER_ASSUMED_CORES,
  TIER_HANDHELD_MAX_CSS_PX,
  TIER_HIGH_MAX_PIXELS_PER_CORE,
  TIER_MIN_CORES_HIGH,
  TIER_MIN_CORES_MEDIUM,
  TIER_MIN_MEMORY_GB_HIGH,
  TIER_MIN_MEMORY_GB_MEDIUM,
} from '../data/balance';
import type { AtmosphereQuality } from './atmosphere';
import type { FacadeMapQuality } from './facadeMaps';
import type { PostQuality } from './postfx';
import type { ShadowQuality } from './shadows';
import type { TerrainDetailQuality } from './terrainDetail';
import type { WaterQuality } from './water';

/**
 * How much rendering this device is asked to pay for, and how that one word is
 * spelled out across the six layers that can be turned down.
 *
 * Every import above is `import type`, and that is load-bearing rather than
 * tidy: the type-only form is erased before anything runs, so this file has no
 * runtime dependency on three.js at all. `decideQualityTier` is therefore a
 * pure function of numbers that a node test can call directly — which is the
 * only way a policy about phones can be held down by a test on a machine that
 * is not one.
 *
 * WHAT IS BEING PROTECTED. Six modules landed at once, and exactly two of them
 * are expensive in the sense the project's rule means:
 *
 * - `postfx` — up to five full-screen passes and about 99 MB of render targets
 *   at a phone's own resolution, on top of the drawing buffer that
 *   MAX_DRAWING_PIXELS already caps.
 * - `shadows` at `high` — three depth passes per frame instead of one.
 *
 * The other four add texture fetches, ALU and bytes, but no pass, no render
 * target and no draw call. So the ladder below is not a uniform dimmer: `low`
 * and `medium` both leave the composer switched off entirely and both take the
 * single-cascade shadow rig, and what `medium` buys over `low` is the cheap
 * half — ground grain, facade occlusion, a second wave layer, aerial haze.
 *
 * That is what makes the guarantee in the task statement true rather than
 * merely likely: a phone lands on `low` or `medium`, and *neither* of those
 * tiers allocates a single render target or issues a single extra pass.
 *
 * NOTHING HERE WAS MEASURED ON A GPU. This environment runs SwiftShader at one
 * or two frames a second. Every threshold is arithmetic and judgement, and the
 * direction of the judgement is always the same: when in doubt, the phone pays
 * less.
 */
export type QualityTier = 'low' | 'medium' | 'high';

/**
 * The device pixel ratio to draw at, given the window it has to fill.
 *
 * Two caps, not one. MAX_DPR keeps a phone from rendering at three or four times
 * its own screen for a sharpness nobody can see; MAX_DRAWING_PIXELS keeps a big
 * desktop window from asking for a framebuffer measured in hundreds of megabytes
 * (see the constant for the arithmetic). The second is the one that matters for
 * "Out of Memory", because it is the only term here that scales with something
 * the player can change without touching the game.
 *
 * Never returns more than the display actually has, and never less than a
 * quarter — below that the picture is mush, and a window big enough to hit that
 * floor has problems this cannot solve.
 *
 * Lives here rather than in renderer.ts, where it was written, because the tier
 * decision needs it: how many pixels the frame actually costs is a better
 * question than how big the window is, and this is the function that answers
 * it. renderer.ts re-exports it, so its existing callers are unaffected.
 */
export function pixelRatioFor(
  width: number,
  height: number,
  devicePixelRatio = 1,
): number {
  const area = Math.max(1, width * height);
  const capped = Math.min(MAX_DPR, Math.max(0.25, devicePixelRatio || 1));
  const budget = Math.sqrt(MAX_DRAWING_PIXELS / area);
  return Math.max(0.25, Math.min(capped, budget));
}

/**
 * Everything the decision is allowed to look at.
 *
 * Four signals, and every one of them is a guess about hardware rather than a
 * measurement of it — which is why the policy below leans on the two that are
 * hardest to get wrong (how big the viewport is, and whether a finger is
 * driving it) and treats the two self-reported numbers as vetoes rather than
 * as evidence in favour.
 *
 * The optional three are optional because browsers genuinely do not all answer:
 * `deviceMemory` is Chromium-only, and `matchMedia` may be absent in an
 * embedded view. Absent is not the same as zero and is not treated as such.
 */
export interface DeviceProfile {
  /** Viewport width in CSS pixels — `window.innerWidth`. */
  readonly width: number;
  /** Viewport height in CSS pixels — `window.innerHeight`. */
  readonly height: number;
  /** `window.devicePixelRatio`. */
  readonly devicePixelRatio: number;
  /** `navigator.hardwareConcurrency`, when the browser reports it. */
  readonly hardwareConcurrency?: number | undefined;
  /** `navigator.deviceMemory`, in GiB. Chromium only, rounded to 0.25/0.5/1/2/4/8. */
  readonly deviceMemory?: number | undefined;
  /**
   * `matchMedia('(pointer: coarse)').matches` — the primary pointer is a
   * finger. The single most reliable "this is a handheld" signal a browser
   * offers, and the only one that separates a 1024-wide tablet from a
   * 1024-wide desktop window. A laptop with a touchscreen still reports `fine`
   * for its *primary* pointer, so this does not sweep those up.
   */
  readonly coarsePointer?: boolean | undefined;
}

/**
 * The tier for a device, as a pure function of what it says about itself.
 *
 * Rules in order, first match wins. Written as rules rather than as a score
 * because a score cannot be argued with when somebody reports that their phone
 * is hot: with this shape the answer to "why did I get `medium`" is one line of
 * code, and moving it is one number in balance.ts.
 *
 *   1. A viewport that is not a viewport gets the floor. Defensive; a zero here
 *      would otherwise divide into the pixel term.
 *   2. Too few cores, or an explicit statement of too little memory: floor.
 *   3. A handheld is capped at `medium`, whatever it reports. This is the rule
 *      the task asks for, and it is unconditional on purpose — a flagship phone
 *      reports eight cores and would otherwise sail past every desktop gate
 *      below while holding a battery and no fan.
 *   4. The top tier additionally wants a desktop-class core count, no memory
 *      veto, and a window its cores can plausibly fill.
 *
 * Note what rule 4 implies and is meant to imply: a *bigger* window can get a
 * *lower* tier on the same machine. That is correct for this ladder, because
 * everything `high` adds is priced per pixel.
 */
export function decideQualityTier(device: DeviceProfile): QualityTier {
  const width = finite(device.width, 0);
  const height = finite(device.height, 0);
  if (width <= 0 || height <= 0) return 'low';

  const cores = Math.max(1, Math.floor(finite(device.hardwareConcurrency, TIER_ASSUMED_CORES)));
  // Absent rather than zero: `null` means "the browser did not say", which is
  // the answer every non-Chromium browser gives and must not be read as a
  // machine with no memory.
  const memory = device.deviceMemory !== undefined && Number.isFinite(device.deviceMemory)
    ? device.deviceMemory
    : null;

  if (cores < TIER_MIN_CORES_MEDIUM) return 'low';
  if (memory !== null && memory < TIER_MIN_MEMORY_GB_MEDIUM) return 'low';

  if (isHandheld(device)) return 'medium';

  if (cores < TIER_MIN_CORES_HIGH) return 'medium';
  if (memory !== null && memory < TIER_MIN_MEMORY_GB_HIGH) return 'medium';

  const ratio = pixelRatioFor(width, height, finite(device.devicePixelRatio, 1));
  const pixels = width * height * ratio * ratio;
  if (pixels / cores > TIER_HIGH_MAX_PIXELS_PER_CORE) return 'medium';

  return 'high';
}

/**
 * Whether this is a device somebody is holding.
 *
 * Two independent tests, either of which is enough. The size test catches every
 * phone and every phone-shaped window with no cooperation from the browser; the
 * pointer test catches the tablets the size test cannot, which is the whole
 * reason it is here — a 12.9" iPad reports 1024×1366 CSS pixels and eight
 * cores, which is a desktop by every number available except this one.
 *
 * A caller that cannot supply `coarsePointer` therefore leaves exactly one hole
 * open: a large tablet may reach `high`. `readDeviceProfile` always supplies it
 * where `matchMedia` exists, which is every browser this game runs in.
 */
function isHandheld(device: DeviceProfile): boolean {
  if (device.coarsePointer === true) return true;
  const shortest = Math.min(finite(device.width, 0), finite(device.height, 0));
  return shortest <= TIER_HANDHELD_MAX_CSS_PX;
}

function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** What `navigator` may be carrying beyond what the DOM types admit to. */
interface DeviceNavigator extends Navigator {
  deviceMemory?: number;
}

/**
 * Reads the profile off the live browser.
 *
 * Split from `decideQualityTier` so that the policy — the part worth arguing
 * about and worth testing — never has to touch a global. Every read is
 * defensive: an embedded web view with no `matchMedia` should get a tier, not
 * an exception on the first frame.
 */
export function readDeviceProfile(): DeviceProfile {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as DeviceNavigator);
  let coarsePointer: boolean | undefined;
  try {
    coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    coarsePointer = undefined;
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemory: nav?.deviceMemory,
    coarsePointer,
  };
}

/**
 * What one tier means to each of the six layers that can be turned down.
 *
 * The names on the right are the modules' own tier words, pulled in as types so
 * that renaming one of them upstream breaks this table at compile time instead
 * of silently falling back to a default.
 *
 * Read the `post` column first, because it is the whole point:
 *
 *   `low`, `medium` -> `'low'`, which in postfx.ts means *no composer at all*.
 *   No render target is allocated, no pass is added, and `render` is a straight
 *   call through to the default framebuffer. A phone on either tier pays
 *   nothing — not "a little", nothing.
 *
 *   `high` -> `'medium'`, not `'medium'` by timidity but because the only
 *   difference between postfx's `medium` and `high` is ambient occlusion, and
 *   AO is the one stage in the whole delivery whose cost is a multi-tap loop
 *   plus a depth-aware blur rather than arithmetic anyone can count. Bloom, the
 *   grade, the sharpen and the vignette — the entire look — are in `medium`.
 *   Turning on the one stage nobody could time, on the strength of a core
 *   count, would be a performance claim this repository is not allowed to make.
 *   Whoever gets a GPU and a profiler should change this line first.
 *
 * The rest of the ladder:
 *
 *   `shadows`  `low` is one fitted cascade at 8 MB against the 33 MB the game
 *              ships today, and sharper at every zoom it is played at, so even
 *              the floor tier is a straight improvement. `high` is three
 *              cascades and, importantly, three depth passes — the second
 *              genuinely expensive thing here, so it is gated to `high` alone.
 *   `terrain`  `off` at the floor because a full-screen ground shader is where
 *              a weak phone's fragment budget actually goes; one fetch at
 *              `medium`, three plus a relief term at `high`.
 *   `water`    the module's own scale. `low` keeps the depth ramp, the
 *              shoreline and the reflection, which is most of the look.
 *   `facades`  `off` at the floor (no maps generated, nothing uploaded, no
 *              patch); `low` is the packed occlusion/roughness/metalness map at
 *              +3% texture bytes; `high` adds the normal map.
 *   `atmos`    `off` still draws the dome — it only switches off the
 *              per-fragment aerial perspective, and the scene fog is still
 *              driven from the same model, so the floor tier keeps a coherent
 *              sky for free. `low` adds the haze, `high` the directional
 *              scattering and the extra cloud octaves.
 */
export interface ModuleTiers {
  readonly post: PostQuality;
  readonly shadows: ShadowQuality;
  readonly terrainDetail: TerrainDetailQuality;
  readonly water: WaterQuality;
  readonly facadeMaps: FacadeMapQuality;
  readonly atmosphere: AtmosphereQuality;
}

export const MODULE_TIERS: Record<QualityTier, ModuleTiers> = {
  low: {
    post: 'low',
    shadows: 'low',
    terrainDetail: 'off',
    water: 'low',
    facadeMaps: 'off',
    atmosphere: 'off',
  },
  medium: {
    post: 'low',
    shadows: 'low',
    terrainDetail: 'low',
    water: 'medium',
    facadeMaps: 'low',
    atmosphere: 'low',
  },
  high: {
    post: 'medium',
    shadows: 'high',
    terrainDetail: 'high',
    water: 'high',
    facadeMaps: 'high',
    atmosphere: 'high',
  },
};

/**
 * True when the tier allocates an off-screen chain — the one question anybody
 * auditing this for a phone actually wants answered.
 *
 * Exported so a test can assert the guarantee directly rather than by reading
 * the table, and so the answer cannot drift from the table it is derived from.
 */
export function usesOffscreenPasses(tier: QualityTier): boolean {
  return MODULE_TIERS[tier].post !== 'low';
}
