import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * The image pipeline: occlusion, bloom, grade, sharpen, vignette.
 *
 * Everything before this file draws objects. This file draws the *frame* — the
 * handful of screen-wide operations that separate a correctly lit city from a
 * photographed one. It is also, by a wide margin, the most expensive thing the
 * renderer can be asked to do, so the first decision it makes is whether to
 * exist at all: at `low` no composer is built, no render target is allocated,
 * and `render()` is one call straight through to the default framebuffer. A
 * phone that cannot afford this pays literally nothing for it.
 *
 * Four structural choices are worth explaining, because each one is the reason
 * some other, more obvious approach was not taken.
 *
 * **The scene target is ours, the composer's buffers are not.** three disables
 * tone mapping and colour-space conversion whenever it renders into a render
 * target (WebGLPrograms.js:175-186), so the scene arrives here in linear HDR
 * with nothing clipped — which is what makes an honest emissive threshold
 * possible at all. We render it into one target we own, carrying 4x MSAA and a
 * sampleable depth texture, and hand the composer plain buffers for the tail of
 * the chain. Letting `RenderPass` own the scene would have put MSAA on *both*
 * of the composer's ping-pong buffers — twice the multisample memory for a pair
 * of full-screen quads that cannot produce an aliased edge.
 *
 * **MSAA survives.** `antialias: true` on the context applies to the default
 * framebuffer only; the moment the city is drawn into a plain target every edge
 * in it goes stair-stepped, which would be a far bigger regression than any
 * effect added here. The scene target is created with `samples: MSAA_SAMPLES`
 * for exactly that reason. Do not remove it to save memory — on a tile-based
 * mobile GPU 4x MSAA is close to free and FXAA in its place would also soften
 * the facade textures and the road markings.
 *
 * **Bloom is thresholded in linear HDR, not in display space.** After ACES
 * everything is squeezed toward 1.0 and a lit window is indistinguishable from
 * white paint; before it, a lamp head sits at ~5.9 and sunlit grass at ~0.37.
 * The threshold therefore separates *sources* from *surfaces* by arithmetic
 * rather than by taste. The sky is excluded outright by depth, not by value —
 * see BLOOM_THRESHOLD_NIGHT.
 *
 * **Occlusion reads depth only.** SSAO and GTAO as three ships them render the
 * scene a second time for a normal buffer. This one reconstructs both position
 * and normal from the depth texture the scene render already resolved, so the
 * city is rasterised once per frame no matter which effects are on.
 *
 * Nothing here has been measured for frame rate: this repository's environment
 * runs SwiftShader at one or two frames a second. The costs quoted throughout
 * are pixel, byte and tap counts, which are arithmetic and portable; the fps
 * they imply is not claimed.
 */

// --- Public shape ------------------------------------------------------------

/**
 * The graphics tier. There is no shared tier enum in the project yet; when one
 * lands in src/data/balance.ts this type should become an alias of it and the
 * numbers below should move there with it (AGENTS.md: tunables are not inline).
 * The three names are deliberately the same words a settings control would use.
 */
export type PostQuality = 'low' | 'medium' | 'high';

/** Each effect switches independently, whatever the tier defaults said. */
export interface PostEffects {
  ao: boolean;
  bloom: boolean;
  grade: boolean;
  sharpen: boolean;
  vignette: boolean;
}

/** What the pipeline needs to know about the frame it is about to finish. */
export interface PostFrame {
  /**
   * 0..1 from sim/daytime.ts — the same `nightAmount` the sky, the windows and
   * the lamps already read. The bloom threshold rides on it, so a frame cannot
   * disagree with the rest of the renderer about what time it is.
   */
  night: number;
  /**
   * True while a data lens is raised. The lens is a readout in a governance
   * game and its colours have to mean what the legend says, so the grade and
   * the vignette — the only two stages that move a hue or a level — fade out
   * while one is up. Occlusion, bloom and sharpen are hue-preserving and stay.
   */
  lensActive: boolean;
  /** Seconds since the last frame; drives the lens fade so it does not pop. */
  deltaSeconds: number;
}

export interface PostFx {
  /** The tier in force. */
  readonly quality: PostQuality;
  /** False at `low`: no composer exists and `render` draws straight to screen. */
  readonly active: boolean;
  readonly effects: Readonly<PostEffects>;
  setQuality(quality: PostQuality): void;
  setEffects(effects: Readonly<Partial<PostEffects>>): void;
  /** Draws the frame. Replaces `renderer.render(scene, camera)` entirely. */
  render(frame: PostFrame): void;
  /** Re-sizes every target. Call from Renderer.resize, after setSize. */
  resize(): void;
  /** Rebuilds every GPU resource. Call on `webglcontextrestored`. */
  invalidate(): void;
  dispose(): void;
}

/**
 * Where a fresh install starts.
 *
 * `low`, and it is not timidity. This project's rule is that anything expensive
 * sits behind a tier a mid-range phone can turn off, and there is no way from
 * here to measure whether a given phone can afford the chain — so the default
 * is the one tier whose cost is provably zero, and the settings control raises
 * it. A default of `medium` would mean every phone paid until its owner found
 * the switch, which is the arrangement the rule exists to prevent.
 */
export const DEFAULT_POST_QUALITY: PostQuality = 'low';

// --- Budget ------------------------------------------------------------------

/**
 * Most pixels the off-screen chain may work at, whatever the canvas is.
 *
 * Half of MAX_DRAWING_PIXELS (data/balance.ts), and the half is the point: a
 * composer pixel carries eight bytes of colour (RGBA16F) where the default
 * framebuffer carries four, so half the pixel count is roughly the same number
 * of bytes the existing budget already sanctions. That budget exists because a
 * player's tab died with "Out of Memory" and it must not be raised; this is the
 * one lever left, and it is a downscale of *our* buffers rather than of the
 * canvas — `pixelRatioFor` is pinned by tests and is not touched.
 *
 * Inert on the target device. A 390x780 phone at DPR 2 draws 1.22 M pixels and
 * sits under this, so the chain runs at 1:1 and nothing is softened. What it
 * catches is the large HiDPI desktop window, which was already being scaled
 * down by the drawing-buffer budget for the same reason.
 */
const POSTFX_MAX_PIXELS = 2_000_000;

/**
 * Multisample count for the scene target. Matches what `antialias: true` asks
 * of the default framebuffer, so routing the city through the composer changes
 * where the edges are resolved and not how well.
 */
const MSAA_SAMPLES = 4;

/** Occlusion runs at half the linear resolution: a quarter of the pixels. */
const AO_DIVISOR = 2;
/** Bloom runs at a quarter of the linear resolution: a sixteenth of the pixels. */
const BLOOM_DIVISOR = 4;

// --- Ambient occlusion -------------------------------------------------------

/**
 * Occlusion radius in world units.
 *
 * One tile is one unit is about eight metres, so 0.55 is roughly four and a
 * half metres: wide enough to darken the canyon between two towers standing a
 * tile apart and to put a seam where a wall meets the ground, narrow enough not
 * to smear a whole street into shadow. The scale facts it is set against are
 * the ones the archetype rescale established — a car is 0.16 tall, a two-storey
 * house 0.75-0.85, a level-5 office 7.7.
 */
const AO_RADIUS = 0.55;
/**
 * Depth pushed off the surface before a sample counts as an occluder, in world
 * units. Small, because the estimator is comparing reconstructed positions
 * rather than a shadow-map depth: this only has to clear the quantisation of a
 * 24-bit depth buffer, not the several texels a shadow bias has to clear.
 */
const AO_BIAS = 0.012;
/** Occlusion taps per pixel at `high`. Twelve on a spiral reads as smooth once blurred. */
const AO_SAMPLES = 12;
/** Turns of the sample spiral. Coprime-ish with the tap count, so taps do not line up. */
const AO_SPIRAL_TURNS = 7;
/**
 * Ceiling on the screen-space sample radius, in pixels of the half-res buffer.
 * Without it a pixel close to the camera in walk mode projects the world radius
 * across most of the screen and every tap lands on unrelated geometry — the
 * classic near-field AO smear.
 */
const AO_MAX_RADIUS_PX = 40;
/** Raw estimator gain, before the artistic strength below. */
const AO_INTENSITY = 1.1;
/**
 * How much of the computed occlusion actually reaches the picture.
 *
 * Deliberately not 1. Screen-space AO multiplies the whole shaded result, which
 * physically should only touch the indirect term, so a full-strength multiply
 * darkens sunlit faces that have no business being dark. Just over half reads
 * as contact and grime without pretending to be a light transport solution.
 */
const AO_STRENGTH = 0.55;
/**
 * Linear luminance above which occlusion backs off, and where it is fully gone.
 *
 * A street lamp is a source, not a surface: occluding it would darken the one
 * thing in the frame that is supposed to be emitting. 1.2 sits above anything
 * diffuse lighting can reach (see BLOOM_THRESHOLD_DAY for that arithmetic) and
 * below a lamp head at ~5.9, so surfaces keep their occlusion and sources keep
 * their light.
 */
const AO_LIGHT_PROTECT_FROM = 1.2;
const AO_LIGHT_PROTECT_TO = 3.0;
/**
 * Bilateral falloff for the occlusion blur, per world unit of depth difference.
 * At 4 a tap a quarter of a unit (two metres) behind the centre carries about a
 * third of the weight, which keeps the blur from bleeding a tower's occlusion
 * onto the ground behind it.
 */
const AO_BLUR_DEPTH_FALLOFF = 4;
/** Blur tap spacing in half-res texels: 3x3 taps two apart cover 5x5 for nine fetches. */
const AO_BLUR_SPREAD = 2;

// --- Bloom -------------------------------------------------------------------

/**
 * Linear luminance a pixel must beat, in full daylight, before it blooms.
 *
 * The arithmetic that fixes it: three's Lambert term is `albedo * irradiance /
 * PI`, the key is SUN_INTENSITY 2.75 and the fill AMBIENT_DAY 1.15 (sky.ts), so
 * the brightest a purely reflective surface can be at noon is about
 * `0.9 * 3.9 / PI = 1.12` — a white road marking under a vertical sun. 1.45
 * clears that with room for a specular lobe on glass or water. Anything above
 * it in daylight really is emitting: a hazard fire (emissiveIntensity 1.6) or
 * the 2065 shuttle. Noon does not haze over, which was the requirement.
 */
const BLOOM_THRESHOLD_DAY = 1.45;
/**
 * The same test at midnight, where "merely lit" means something much dimmer.
 *
 * At night the whole rig is AMBIENT_NIGHT 0.72 plus MOON_INTENSITY 0.85, so a
 * white surface reaches `0.9 * 1.57 / PI = 0.45`. A lit window is emissive
 * #FFD9A0 through a #FFE9BC window texel, which is (1.0, 0.57, 0.18) linear —
 * luminance 0.63 before its own diffuse term. 0.62 therefore sits above every
 * reflective surface in a night city and just under a lit window, so windows
 * enter through the soft knee while lamp heads (night x 1.3 x 2.4 x 2.4, up to
 * ~5.9) go straight through it.
 *
 * The overlays are safe by the same arithmetic: the zone wash is 0.42 opacity,
 * the lens 0.55, the for-sale marker #E4C15C at 0.6 — all under 0.45 composited
 * over night ground, and all far under the daylight threshold. A governance
 * readout does not bloom.
 */
const BLOOM_THRESHOLD_NIGHT = 0.62;
/**
 * Shapes the walk between the two thresholds against `night`.
 *
 * Above 1 so the threshold falls faster than the light does. Dusk is the shot
 * this effect exists for and a straight lerp arrives too late: at `night` 0.5
 * the linear blend still demands 1.03, which a window coming on at 0.75
 * intensity cannot reach. At 1.6 the same moment asks 0.91 and the window is at
 * the knee — a soft glow while the sky is still bright, which is what dusk
 * looks like.
 */
const BLOOM_THRESHOLD_FALLOFF = 1.6;
/**
 * Width of the soft knee, as a fraction of the threshold. A hard cut makes the
 * bloom pop on and off as a lamp crosses the line while the camera moves; the
 * knee also means the exact threshold placement above is a preference rather
 * than a cliff.
 */
const BLOOM_KNEE = 0.6;
/** How much of the blurred bright pass is added back. Restraint is the whole point. */
const BLOOM_STRENGTH = 0.55;
/** Separable blur iterations. Two widens the glow without a mip pyramid's passes. */
const BLOOM_BLUR_ITERATIONS = 2;
/** Tap spacing in quarter-res texels; the second iteration doubles it. */
const BLOOM_BLUR_SPREAD = 1.35;

// --- Grade, sharpen, vignette ------------------------------------------------

/**
 * Strength of the filmic S applied after ACES, in display space.
 *
 * The curve is a smoothstep blended over the identity, so it is monotonic and
 * pinned at both ends: nothing clips that was not already clipping and nothing
 * crushes to black. That matters more here than in most games — AMBIENT_NIGHT
 * exists because a playtester could not see the screen, and a grade that ate
 * the shadows would undo a measured fix.
 */
const GRADE_CONTRAST = 0.16;
/** Slight lift, weighted into the darkest values only, for the same reason. */
const GRADE_LIFT = 0.012;
/** A touch of saturation; ACES desaturates highlights and this puts some back. */
const GRADE_SATURATION = 1.06;
/**
 * Split tone: cool the shadows, warm the highlights. Kept within two per cent
 * of white — the point is that the eye reads a mood, not that it reads a tint.
 */
const GRADE_SHADOW_TINT = new THREE.Color(0.982, 0.99, 1.02);
const GRADE_HIGHLIGHT_TINT = new THREE.Color(1.018, 1.004, 0.982);
/**
 * Unsharp amount. Clamped to the neighbourhood's own min and max afterwards
 * (the ringing guard CAS uses), so it recovers the softness a downscaled
 * working buffer costs without haloing the road markings.
 */
const SHARPEN_AMOUNT = 0.22;
/** Vignette depth at the corners, and where the falloff starts along the diagonal. */
const VIGNETTE_STRENGTH = 0.18;
const VIGNETTE_START = 0.62;
/** Seconds for grade and vignette to stand down when a lens is raised. */
const LENS_FADE_SECONDS = 0.25;

/** Rec. 709 luminance, used by the bright pass, the grade and the AO protect. */
const LUMA = 'const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);';

// --- Tier presets ------------------------------------------------------------

/**
 * What each tier switches on before any explicit override.
 *
 * `medium` is the phone tier and buys the three cheapest wins: bloom at a
 * sixteenth of the pixels, and a grade/sharpen/vignette that ride along in one
 * shared pass. `high` adds occlusion, which is the only stage with a per-pixel
 * loop in it. `low` never reaches this table — there is no composer to
 * configure.
 */
const TIER_EFFECTS: Record<PostQuality, PostEffects> = {
  low: { ao: false, bloom: false, grade: false, sharpen: false, vignette: false },
  medium: { ao: false, bloom: true, grade: true, sharpen: true, vignette: true },
  high: { ao: true, bloom: true, grade: true, sharpen: true, vignette: true },
};

// --- Shaders -----------------------------------------------------------------

/**
 * One full-screen triangle, already in clip space, so no matrix is needed and
 * there is no diagonal seam for the sharpen pass to find.
 */
const SCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Depth-only ambient occlusion.
 *
 * Position comes back through the inverse projection, which costs one matrix
 * multiply per tap and is exact for any projection; the normal comes from the
 * closer of each pair of neighbours, which is what stops a silhouette edge
 * inventing a normal that faces nowhere. The estimator is McGuire's scalable
 * AO: a cubic falloff over the radius, divided by squared distance, which needs
 * no normal buffer and degrades gracefully when a tap lands on the sky.
 *
 * Output is (occlusion, view depth) so the blur below can be depth-aware from a
 * single fetch instead of re-sampling the depth texture nine more times.
 */
const AO_FRAGMENT = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uInverseProjection;
  uniform vec2 uTexel;
  uniform float uProjScale;
  uniform float uRadius;
  uniform float uBias;
  uniform float uIntensity;
  varying vec2 vUv;

  vec3 viewPositionAt(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uInverseProjection * clip;
    return view.xyz / view.w;
  }

  // Interleaved gradient noise: a per-pixel rotation with no texture to upload,
  // which keeps the project's "everything is generated" rule intact and costs
  // two multiplies. Its 3x3 pattern is exactly what the blur below erases.
  float dither(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    float centre = texture2D(tDepth, vUv).x;
    vec3 P = viewPositionAt(vUv, centre);

    // The sky dome writes no depth (it is depthTest false, depthWrite false, and
    // pinned to the far plane), so anything still at 1.0 is sky and is not
    // occluded by anything.
    if (centre >= 0.99999) {
      gl_FragColor = vec4(1.0, -P.z, 0.0, 1.0);
      return;
    }

    vec2 dx = vec2(uTexel.x, 0.0);
    vec2 dy = vec2(0.0, uTexel.y);
    float dL = texture2D(tDepth, vUv - dx).x;
    float dR = texture2D(tDepth, vUv + dx).x;
    float dD = texture2D(tDepth, vUv - dy).x;
    float dU = texture2D(tDepth, vUv + dy).x;
    vec3 alongX = abs(dL - centre) < abs(dR - centre)
      ? P - viewPositionAt(vUv - dx, dL)
      : viewPositionAt(vUv + dx, dR) - P;
    vec3 alongY = abs(dD - centre) < abs(dU - centre)
      ? P - viewPositionAt(vUv - dy, dD)
      : viewPositionAt(vUv + dy, dU) - P;
    vec3 N = normalize(cross(alongX, alongY));

    // World radius to screen radius. Falls off with distance exactly as the
    // geometry does, so a tower occludes the same way from the map view and from
    // the street; clamped because the near field would otherwise sample halfway
    // across the screen in walk mode.
    float radiusPx = min(uProjScale * uRadius / max(0.0001, -P.z), ${AO_MAX_RADIUS_PX}.0);
    float rotation = dither(gl_FragCoord.xy) * 6.2831853;
    float radius2 = uRadius * uRadius;
    float occlusion = 0.0;

    for (int i = 0; i < ${AO_SAMPLES}; i++) {
      float t = (float(i) + 0.5) / ${AO_SAMPLES}.0;
      float angle = t * ${AO_SPIRAL_TURNS}.0 * 6.2831853 + rotation;
      // sqrt(t) spaces the taps evenly over the disc rather than crowding them
      // at the centre, where they would all report the same occlusion.
      vec2 offset = vec2(cos(angle), sin(angle)) * (radiusPx * sqrt(t)) * uTexel;
      float sampleDepth = texture2D(tDepth, vUv + offset).x;
      // A tap that landed on sky occludes nothing. Multiplied rather than
      // branched: the taps around it will not have taken the same path.
      float solid = step(sampleDepth, 0.99999);
      vec3 v = viewPositionAt(vUv + offset, sampleDepth) - P;
      float vv = dot(v, v);
      float vn = dot(v, N);
      float falloff = max(radius2 - vv, 0.0);
      occlusion += solid * falloff * falloff * falloff * max((vn - uBias) / (0.01 + vv), 0.0);
    }

    occlusion *= (5.0 * uIntensity) / (${AO_SAMPLES}.0 * pow(uRadius, 6.0));
    gl_FragColor = vec4(clamp(1.0 - occlusion, 0.0, 1.0), -P.z, 0.0, 1.0);
  }
`;

/**
 * Depth-aware blur over the occlusion buffer. Nine taps two texels apart, so it
 * covers a 5x5 neighbourhood for the cost of a 3x3 — enough to erase the
 * dither pattern without the two separable passes a wider kernel would need.
 */
const AO_BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tAo;
  uniform vec2 uTexel;
  varying vec2 vUv;

  void main() {
    vec4 centre = texture2D(tAo, vUv);
    float sum = 0.0;
    float weight = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y)) * ${AO_BLUR_SPREAD}.0 * uTexel;
        vec4 tap = texture2D(tAo, vUv + offset);
        // Weight by depth agreement, or a tower's occlusion bleeds onto the
        // ground several metres behind it and buildings grow a dark halo.
        float w = exp(-abs(tap.y - centre.y) * ${AO_BLUR_DEPTH_FALLOFF}.0);
        sum += tap.x * w;
        weight += w;
      }
    }
    gl_FragColor = vec4(sum / max(weight, 0.0001), centre.y, 0.0, 1.0);
  }
`;

/**
 * The bright pass. Runs on the linear HDR scene before any tone mapping, which
 * is the only place where "emissive" and "brightly lit" are still different
 * numbers, and rejects the sky by depth rather than by value so the sun disc
 * and the lit cloud crowns cannot leak in however bright the palette gets.
 */
const BLOOM_BRIGHT_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uThreshold;
  varying vec2 vUv;
  ${LUMA}

  void main() {
    vec3 colour = texture2D(tScene, vUv).rgb;
    float lum = dot(colour, LUMA);

    // Karis' soft knee: a quadratic ramp of width 2*knee centred on the
    // threshold, so a lamp drifting across the line fades in instead of popping.
    float knee = uThreshold * ${BLOOM_KNEE.toFixed(3)} + 0.00001;
    float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    float contribution = max(soft, lum - uThreshold) / max(lum, 0.00001);

    // Sky is whatever never wrote depth. See the same test in the AO pass.
    contribution *= step(texture2D(tDepth, vUv).x, 0.99999);
    gl_FragColor = vec4(colour * contribution, 1.0);
  }
`;

/** Nine-tap separable Gaussian; the direction uniform turns it horizontal or vertical. */
const BLOOM_BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uStep;
  varying vec2 vUv;

  void main() {
    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
    sum += (texture2D(tDiffuse, vUv + uStep * 1.0).rgb
          + texture2D(tDiffuse, vUv - uStep * 1.0).rgb) * 0.194595;
    sum += (texture2D(tDiffuse, vUv + uStep * 2.0).rgb
          + texture2D(tDiffuse, vUv - uStep * 2.0).rgb) * 0.121622;
    sum += (texture2D(tDiffuse, vUv + uStep * 3.0).rgb
          + texture2D(tDiffuse, vUv - uStep * 3.0).rgb) * 0.054054;
    sum += (texture2D(tDiffuse, vUv + uStep * 4.0).rgb
          + texture2D(tDiffuse, vUv - uStep * 4.0).rgb) * 0.016216;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

/**
 * The entry to the composer chain: scene, times occlusion, plus bloom, still in
 * linear HDR so the glow rolls off through ACES in the pass after this one
 * rather than clipping flat. Both terms are `#define`d in, so with neither on
 * this is a single fetch and a write.
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tAo;
  uniform sampler2D tBloom;
  uniform float uAoStrength;
  uniform float uBloomStrength;
  varying vec2 vUv;
  ${LUMA}

  void main() {
    vec3 colour = texture2D(tScene, vUv).rgb;

    #ifdef USE_AO
      float ao = texture2D(tAo, vUv).x;
      // A source is not occluded by the wall it is set into. Lamp heads and
      // fires keep their light; surfaces, however bright, keep their occlusion.
      float protect = smoothstep(
        ${AO_LIGHT_PROTECT_FROM.toFixed(3)},
        ${AO_LIGHT_PROTECT_TO.toFixed(3)},
        dot(colour, LUMA)
      );
      colour *= mix(mix(1.0, ao, uAoStrength), 1.0, protect);
    #endif

    #ifdef USE_BLOOM
      colour += texture2D(tBloom, vUv).rgb * uBloomStrength;
    #endif

    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * Grade, sharpen and vignette in one pass.
 *
 * Three effects, one set of texture fetches, because each of them alone would
 * cost a whole extra full-screen read and write of a 1.2-megapixel buffer and
 * none of them needs the others' result to be finished first. They stay
 * independently switchable through `#define`, so an effect that is off is
 * absent from the compiled shader rather than multiplied by zero.
 *
 * This runs *after* OutputPass, so its input is display-referred: ACES has
 * already happened and the values are sRGB-encoded in 0..1. That is the right
 * place for all three — a film grade is a display-space operation, a sharpen
 * that ran in linear would halo around every specular, and a vignette in linear
 * would darken far more than it looks like it should.
 */
const FINISH_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform float uGradeMix;
  uniform float uContrast;
  uniform float uLift;
  uniform float uSaturation;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  uniform float uSharpen;
  uniform float uVignette;
  varying vec2 vUv;
  ${LUMA}

  void main() {
    vec3 colour = texture2D(tDiffuse, vUv).rgb;

    #ifdef USE_SHARPEN
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 lo = min(colour, min(min(n, s), min(e, w)));
      vec3 hi = max(colour, max(max(n, s), max(e, w)));
      // Clamping the sharpened value back into the neighbourhood's own range is
      // what stops a bright lane marking growing a dark outline against tarmac.
      colour = clamp(colour + (colour * 4.0 - n - s - e - w) * uSharpen, lo, hi);
    #endif

    #ifdef USE_GRADE
      // A smoothstep blended over the identity: monotonic, and pinned at 0 and
      // 1, so it adds contrast without inventing a clip or crushing a shadow.
      vec3 curved = colour * colour * (3.0 - 2.0 * colour);
      vec3 graded = mix(colour, curved, uContrast);
      // Lift weighted into the darkest values only. The night has to stay
      // legible; this is the toe that keeps it so under the added contrast.
      graded += uLift * pow(1.0 - graded, vec3(3.0));
      float lum = dot(graded, LUMA);
      graded = mix(vec3(lum), graded, uSaturation);
      graded *= mix(uShadowTint, uHighlightTint, smoothstep(0.0, 1.0, lum));
      colour = mix(colour, clamp(graded, 0.0, 1.0), uGradeMix);
    #endif

    #ifdef USE_VIGNETTE
      // Measured along the diagonal in uv, so the falloff follows the frame
      // instead of describing a circle that would swallow a portrait phone's
      // top and bottom thirds. The dock and the top bar are DOM above the
      // canvas and are not touched by this.
      float edge = smoothstep(${VIGNETTE_START.toFixed(3)}, 1.0, length(vUv - vec2(0.5)) * 1.41421356);
      colour *= 1.0 - edge * uVignette * uGradeMix;
    #endif

    gl_FragColor = vec4(colour, 1.0);
  }
`;

// --- Implementation ----------------------------------------------------------

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  initialQuality: PostQuality = DEFAULT_POST_QUALITY,
): PostFx {
  let quality: PostQuality = initialQuality;
  let effects: PostEffects = { ...TIER_EFFECTS[quality] };
  let rig: Rig | null = null;
  /** 1 with no lens up, 0 with one raised; walked rather than snapped. */
  let gradeMix = 1;

  const build = (): void => {
    if (quality === 'low' || rig) return;
    rig = createRig(renderer, effects);
  };

  const teardown = (): void => {
    rig?.dispose();
    rig = null;
  };

  const render = (frame: PostFrame): void => {
    if (!rig) {
      // The straight-through path. three resets `info` at the top of every
      // `render()` when autoReset is on, which is the behaviour Renderer.measure
      // was written against, so it goes back the way it was found.
      renderer.info.autoReset = true;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    const target = frame.lensActive ? 0 : 1;
    const walk = frame.deltaSeconds / LENS_FADE_SECONDS;
    gradeMix += Math.max(-walk, Math.min(walk, target - gradeMix));

    // One reset for the whole chain instead of one per pass: without this the
    // renderer's drawCalls and triangles would report the final full-screen
    // quad and nothing else, and those two numbers are the project's only
    // portable performance signal.
    renderer.info.autoReset = false;
    renderer.info.reset();

    rig.render(scene, camera, frame, gradeMix, effects);
  };

  build();

  return {
    get quality() {
      return quality;
    },
    get active() {
      return rig !== null;
    },
    get effects() {
      return effects;
    },
    setQuality: (next: PostQuality) => {
      if (next === quality) return;
      quality = next;
      effects = { ...TIER_EFFECTS[quality] };
      teardown();
      build();
    },
    setEffects: (next: Readonly<Partial<PostEffects>>) => {
      effects = {
        ao: next.ao ?? effects.ao,
        bloom: next.bloom ?? effects.bloom,
        grade: next.grade ?? effects.grade,
        sharpen: next.sharpen ?? effects.sharpen,
        vignette: next.vignette ?? effects.vignette,
      };
      rig?.setEffects(effects);
    },
    render,
    resize: () => rig?.resize(),
    invalidate: () => {
      // Every target, program and texture below belonged to a context that no
      // longer exists. three re-uploads its own resources lazily, but a render
      // target's framebuffer is not one of them, so this rebuilds outright.
      teardown();
      build();
    },
    dispose: () => {
      teardown();
      renderer.info.autoReset = true;
    },
  };
}

// --- The rig -----------------------------------------------------------------

/**
 * Everything that only exists while the composer does. Split out so that
 * `low` — and a lost context — is a null reference rather than a field of
 * disabled flags, and so that `dispose` has exactly one list to walk.
 */
interface Rig {
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    frame: PostFrame,
    gradeMix: number,
    effects: PostEffects,
  ): void;
  setEffects(effects: PostEffects): void;
  resize(): void;
  dispose(): void;
}

function createRig(renderer: THREE.WebGLRenderer, effects: PostEffects): Rig {
  const size = workingSize(renderer);
  const quad = new ScreenQuad();

  // The scene target. HalfFloat because the bright pass has to see values above
  // 1, MSAA because the default framebuffer's antialias does not follow the city
  // into a render target, and a depth texture because it is the difference
  // between reconstructing occlusion and rendering the world a second time to
  // get normals. The depth attachment exists either way — only the resolved
  // texture is new, four bytes a pixel.
  const depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
  const sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    samples: MSAA_SAMPLES,
    depthTexture,
  });

  const aoSize = divided(size, AO_DIVISOR);
  const aoTarget = makeWorkTarget(aoSize);
  const aoBlurTarget = makeWorkTarget(aoSize);

  const bloomSize = divided(size, BLOOM_DIVISOR);
  const bloomTargetA = makeWorkTarget(bloomSize);
  const bloomTargetB = makeWorkTarget(bloomSize);

  const aoMaterial = screenMaterial(AO_FRAGMENT, {
    tDepth: { value: depthTexture },
    uInverseProjection: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2(1 / aoSize.x, 1 / aoSize.y) },
    uProjScale: { value: 1 },
    uRadius: { value: AO_RADIUS },
    uBias: { value: AO_BIAS },
    uIntensity: { value: AO_INTENSITY },
  });

  const aoBlurMaterial = screenMaterial(AO_BLUR_FRAGMENT, {
    tAo: { value: aoTarget.texture },
    uTexel: { value: new THREE.Vector2(1 / aoSize.x, 1 / aoSize.y) },
  });

  const brightMaterial = screenMaterial(BLOOM_BRIGHT_FRAGMENT, {
    tScene: { value: sceneTarget.texture },
    tDepth: { value: depthTexture },
    uThreshold: { value: BLOOM_THRESHOLD_DAY },
  });

  const bloomBlurMaterial = screenMaterial(BLOOM_BLUR_FRAGMENT, {
    tDiffuse: { value: null },
    uStep: { value: new THREE.Vector2() },
  });

  const compositeMaterial = screenMaterial(COMPOSITE_FRAGMENT, {
    tScene: { value: sceneTarget.texture },
    tAo: { value: aoBlurTarget.texture },
    tBloom: { value: bloomTargetA.texture },
    uAoStrength: { value: AO_STRENGTH },
    uBloomStrength: { value: BLOOM_STRENGTH },
  });

  // The composer's own ping-pong buffers carry no depth and no multisampling:
  // a full-screen quad cannot produce an aliased edge, and the scene's edges
  // were already resolved on the way out of sceneTarget.
  const composerBase = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const composer = new EffectComposer(renderer, composerBase);
  // Sizes here are already device pixels; the composer must not scale them again.
  composer.setPixelRatio(1);
  composer.renderToScreen = true;

  const compositePass = new CompositePass(quad, compositeMaterial);
  // OutputPass rather than a hand-written ACES fit: it reads `renderer.toneMapping`
  // and `renderer.toneMappingExposure` every frame, so the composed frame cannot
  // drift away from what the direct path at `low` would have produced.
  const outputPass = new OutputPass();
  const finishPass = new ShaderPass({
    name: 'KadastroFinish',
    uniforms: {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
      uGradeMix: { value: 1 },
      uContrast: { value: GRADE_CONTRAST },
      uLift: { value: GRADE_LIFT },
      uSaturation: { value: GRADE_SATURATION },
      uShadowTint: { value: GRADE_SHADOW_TINT.clone() },
      uHighlightTint: { value: GRADE_HIGHLIGHT_TINT.clone() },
      uSharpen: { value: SHARPEN_AMOUNT },
      uVignette: { value: VIGNETTE_STRENGTH },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: FINISH_FRAGMENT,
  });
  finishPass.material.depthTest = false;
  finishPass.material.depthWrite = false;

  composer.addPass(compositePass);
  composer.addPass(outputPass);
  composer.addPass(finishPass);
  composer.setSize(size.x, size.y);

  const applyEffects = (next: PostEffects): void => {
    setDefines(compositeMaterial, {
      USE_AO: next.ao,
      USE_BLOOM: next.bloom,
    });
    setDefines(finishPass.material, {
      USE_GRADE: next.grade,
      USE_SHARPEN: next.sharpen,
      USE_VIGNETTE: next.vignette,
    });
    // Nothing left for the tail to do means one less full-screen read and write.
    finishPass.enabled = next.grade || next.sharpen || next.vignette;
  };
  applyEffects(effects);

  const resize = (): void => {
    const next = workingSize(renderer);
    if (next.x === size.x && next.y === size.y) return;
    size.copy(next);

    // setSize disposes the target's framebuffer and three rebuilds it — including
    // the depth attachment, whose image is re-synced from the target's own size
    // (WebGLTextures.setupDepthTexture) — on the next bind.
    sceneTarget.setSize(size.x, size.y);
    const nextAo = divided(size, AO_DIVISOR);
    aoTarget.setSize(nextAo.x, nextAo.y);
    aoBlurTarget.setSize(nextAo.x, nextAo.y);
    const nextBloom = divided(size, BLOOM_DIVISOR);
    bloomTargetA.setSize(nextBloom.x, nextBloom.y);
    bloomTargetB.setSize(nextBloom.x, nextBloom.y);

    vec2Uniform(aoMaterial, 'uTexel').set(1 / nextAo.x, 1 / nextAo.y);
    vec2Uniform(aoBlurMaterial, 'uTexel').set(1 / nextAo.x, 1 / nextAo.y);
    vec2Uniform(finishPass.material, 'uTexel').set(1 / size.x, 1 / size.y);

    composer.setSize(size.x, size.y);
  };

  const render = (
    scene: THREE.Scene,
    activeCamera: THREE.PerspectiveCamera,
    frame: PostFrame,
    gradeMix: number,
    active: PostEffects,
  ): void => {
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, activeCamera);

    if (active.ao) {
      matrixUniform(aoMaterial, 'uInverseProjection').copy(activeCamera.projectionMatrixInverse);
      // Half the buffer height times the projection's vertical scale converts a
      // view-space radius into pixels at unit depth; the shader divides by depth.
      const verticalScale = activeCamera.projectionMatrix.elements[5] ?? 1;
      numberUniform(aoMaterial, 'uProjScale').value = 0.5 * aoTarget.height * verticalScale;
      quad.draw(renderer, aoMaterial, aoTarget);
      quad.draw(renderer, aoBlurMaterial, aoBlurTarget);
    }

    if (active.bloom) {
      // The threshold walks between "only a fire is emitting" and "a window is",
      // shaped so it arrives in time for dusk. See BLOOM_THRESHOLD_FALLOFF.
      const daylight = Math.pow(1 - clamp01(frame.night), BLOOM_THRESHOLD_FALLOFF);
      numberUniform(brightMaterial, 'uThreshold').value =
        BLOOM_THRESHOLD_NIGHT + (BLOOM_THRESHOLD_DAY - BLOOM_THRESHOLD_NIGHT) * daylight;
      quad.draw(renderer, brightMaterial, bloomTargetA);

      let source = bloomTargetA;
      let destination = bloomTargetB;
      for (let i = 0; i < BLOOM_BLUR_ITERATIONS; i++) {
        // Each iteration reaches further, which widens the glow without paying
        // for the mip pyramid a full Unreal-style bloom would build.
        const spread = BLOOM_BLUR_SPREAD * (i + 1);
        for (let axis = 0; axis < 2; axis++) {
          textureUniform(bloomBlurMaterial, 'tDiffuse').value = source.texture;
          vec2Uniform(bloomBlurMaterial, 'uStep').set(
            axis === 0 ? spread / source.width : 0,
            axis === 0 ? 0 : spread / source.height,
          );
          quad.draw(renderer, bloomBlurMaterial, destination);
          const swap = source;
          source = destination;
          destination = swap;
        }
      }
      textureUniform(compositeMaterial, 'tBloom').value = source.texture;
    }

    numberUniform(finishPass.material, 'uGradeMix').value = gradeMix;
    composer.render(frame.deltaSeconds);
  };

  return {
    render,
    setEffects: applyEffects,
    resize,
    dispose: () => {
      composer.dispose();
      composerBase.dispose();
      compositePass.dispose();
      outputPass.dispose();
      finishPass.dispose();
      sceneTarget.dispose();
      depthTexture.dispose();
      aoTarget.dispose();
      aoBlurTarget.dispose();
      bloomTargetA.dispose();
      bloomTargetB.dispose();
      aoMaterial.dispose();
      aoBlurMaterial.dispose();
      brightMaterial.dispose();
      bloomBlurMaterial.dispose();
      compositeMaterial.dispose();
      quad.dispose();
    },
  };
}

// --- Plumbing ----------------------------------------------------------------

/**
 * The entry to the composer chain, as a Pass rather than a ShaderPass because it
 * reads a texture the composer knows nothing about — the scene target this file
 * owns — and ShaderPass would overwrite that uniform with the read buffer.
 */
class CompositePass extends Pass {
  private readonly quad: ScreenQuad;
  private readonly material: THREE.ShaderMaterial;

  constructor(quad: ScreenQuad, material: THREE.ShaderMaterial) {
    super();
    this.quad = quad;
    this.material = material;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.quad.draw(renderer, this.material, this.renderToScreen ? null : writeBuffer);
  }

  override dispose(): void {
    // The material is owned by the rig, which disposes it alongside every other
    // one; disposing it twice here would be a lie about who owns what.
  }
}

/**
 * One clip-space triangle and a camera to satisfy `renderer.render`.
 *
 * Deliberately not three's `FullScreenQuad`: that class shares a single
 * module-level geometry between every instance, so disposing one pass would
 * free the buffers the others are still drawing from. This owns exactly one
 * geometry and frees it exactly once.
 */
class ScreenQuad {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly mesh: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    // A triangle twice the size of the screen rather than two triangles: no
    // diagonal, and the fragments outside the viewport are never rasterised.
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(this.geometry);
    // The vertex shader writes clip space directly, so the bounding sphere means
    // nothing to the frustum test and the mesh would be culled on its own terms.
    this.mesh.frustumCulled = false;
  }

  draw(
    renderer: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null = null,
  ): void {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** The intermediate buffers: HDR, no depth, no multisampling, clamped and filtered. */
function makeWorkTarget(size: THREE.Vector2): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
  return target;
}

function screenMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SCREEN_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

/**
 * Rewrites a material's defines and asks for a recompile.
 *
 * A switched-off effect is absent from the compiled shader rather than
 * multiplied by zero, which is the difference between not paying for it and
 * paying for it quietly. Recompiles happen on a settings change, not per frame.
 */
function setDefines(material: THREE.ShaderMaterial, flags: Record<string, boolean>): void {
  const next: Record<string, string> = {};
  for (const key of Object.keys(flags)) if (flags[key]) next[key] = '';
  const before = Object.keys(material.defines ?? {}).sort().join(',');
  const after = Object.keys(next).sort().join(',');
  if (before === after) return;
  material.defines = next;
  material.needsUpdate = true;
}

/**
 * The size the off-screen chain works at.
 *
 * The drawing buffer, unless that would put the chain over POSTFX_MAX_PIXELS —
 * in which case it shrinks by the same square-root rule `pixelRatioFor` uses on
 * the canvas, and the final pass upscales. The sharpen stage exists partly for
 * this case: it is only on a window big enough to trip the budget that the
 * working buffer is ever softer than the canvas.
 */
function workingSize(renderer: THREE.WebGLRenderer): THREE.Vector2 {
  const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  const pixels = Math.max(1, buffer.x * buffer.y);
  const scale = Math.min(1, Math.sqrt(POSTFX_MAX_PIXELS / pixels));
  return new THREE.Vector2(
    Math.max(1, Math.round(buffer.x * scale)),
    Math.max(1, Math.round(buffer.y * scale)),
  );
}

function divided(size: THREE.Vector2, divisor: number): THREE.Vector2 {
  return new THREE.Vector2(
    Math.max(1, Math.ceil(size.x / divisor)),
    Math.max(1, Math.ceil(size.y / divisor)),
  );
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Uniform accessors. three types a uniform's value as `any`, and this file has
// enough of them that a typo would otherwise reach the GPU as a silent no-op.

function vec2Uniform(material: THREE.ShaderMaterial, name: string): THREE.Vector2 {
  const uniform = material.uniforms[name];
  if (!uniform) throw new Error(`postfx: missing vec2 uniform ${name}`);
  return uniform.value as THREE.Vector2;
}

function matrixUniform(material: THREE.ShaderMaterial, name: string): THREE.Matrix4 {
  const uniform = material.uniforms[name];
  if (!uniform) throw new Error(`postfx: missing matrix uniform ${name}`);
  return uniform.value as THREE.Matrix4;
}

function numberUniform(material: THREE.ShaderMaterial, name: string): { value: number } {
  const uniform = material.uniforms[name];
  if (!uniform) throw new Error(`postfx: missing number uniform ${name}`);
  return uniform as { value: number };
}

function textureUniform(
  material: THREE.ShaderMaterial,
  name: string,
): { value: THREE.Texture | null } {
  const uniform = material.uniforms[name];
  if (!uniform) throw new Error(`postfx: missing texture uniform ${name}`);
  return uniform as { value: THREE.Texture | null };
}
