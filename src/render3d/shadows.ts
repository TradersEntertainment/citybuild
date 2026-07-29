import * as THREE from 'three';
import { HEIGHT_SCALE } from './constants';

/**
 * Cascaded shadow maps for the key light.
 *
 * The rig this replaces was one 2048² map over a fixed 280-unit box centred on
 * the camera target. That box was sized for the old camera (base distance 52)
 * and never revisited when the archetypes were rescaled, so it now covers ten
 * times the ground the player can actually see: one shadow texel is 0.137 world
 * units — 1.1 m — at every zoom, and the depth pass is paid in full for it. Its
 * bias was sized to match, and that is why the game currently has no visible
 * shadows at all: `bias -0.0006` over a 627-unit depth range plus `normalBias
 * 0.5` is 0.88 world units of push, and nothing shorter than that — no car
 * (0.16), no lamp (0.34), no two-storey house (0.75-0.85) — can survive it.
 *
 * Two things fix that, and they have to be done together or acne comes back:
 *
 *  1. Fit the frustum to the view instead of the map. The bounding sphere of a
 *     slice of the camera frustum is the standard fit because it is rotation
 *     invariant — the box cannot change size as the player orbits, which is one
 *     of the two ways a cheap shadow map shimmers.
 *  2. Snap the box to its own texel grid in light space, which is the other.
 *     Without it every pan slides the shadow map under the world by a fraction
 *     of a texel and every shadow edge crawls. It is the single most obvious
 *     tell of a cheap shadow implementation, and it costs two rounds.
 *
 * Cascades then split that fitted range so the near field gets a box it can
 * afford to be sharp in. World units per shadow texel, computed off the real
 * frustum at 390x780 portrait (fov 45, aspect 0.5) against today's flat 0.137:
 *
 *              ZOOM_MAX      zoom 1        zoom 0.5     ZOOM_MIN
 *   low         0.029        0.088          0.177        0.201
 *   high   .012/.015/.023  .037/.044/.068  .074/…/.135  .084/…/.154
 *
 * So the near cascade is 3.7x sharper than today at the zoom the game is
 * actually played at, and 11x sharper zoomed in, because the fit tracks the
 * camera. It is not sharper everywhere: one map fitted to the map-wide view is
 * a bigger box than the fixed one it replaced, so past about zoom 0.65 the low
 * tier is coarser than today and at ZOOM_MIN the high tier's last cascade is
 * too. That is the honest shape of the trade — resolution spent where the
 * player is looking rather than spread evenly over ground they cannot see.
 *
 * What it costs, stated as arithmetic because this machine has no GPU and
 * cannot measure a frame rate: a shadow map here is a depth texture plus the
 * colour attachment its render target carries, so about 8 bytes a texel.
 * Today's single 2048² map is 33 MB. `low` is one 1024² map — 8 MB, a quarter
 * of today's. `high` is three of them — 25 MB, still under today's, but three
 * depth passes instead of one: the same casters submitted three times. That is
 * the part that is genuinely more expensive, and the reason the tier exists and
 * defaults low. No frame rate is claimed for either; nothing here was measured
 * on a GPU.
 *
 * The lighting stays exactly as sky.ts computes it. The cascade lights are
 * clones of the key — same colour, same intensity, refreshed every frame — and
 * a shader gate picks one per fragment, so their contributions sum to one key
 * light and never two. The day cycle, the dusk tint, the moon and the funded
 * night all keep driving the look through sky.ts; this module only decides
 * where the shadows land.
 */

// ---------------------------------------------------------------------------
// Tunables. These belong in src/render3d/constants.ts with the other
// render-side numbers; they are here because this module had to ship as a
// single file. Move them across when it does, and keep the comments with them.
// ---------------------------------------------------------------------------

/**
 * How far in front of the camera shadows are drawn, as a multiple of the
 * distance to whatever it is looking at.
 *
 * At the default three-quarter view (polar 0.86, 40.7° below horizontal) the
 * top edge of a 45° frustum meets the ground 2.1 camera distances away — 71
 * world units at distance 34 — so 2.2 covered the whole visible ground. It
 * covered it with shadows nobody could see, which is worse than not covering
 * it, and the arithmetic says why.
 *
 * A shadow map has a fixed number of texels; spreading them over more ground
 * makes each one bigger. At 2.2 the single low-tier cascade is a 90-unit box
 * over 1024 texels: **0.088 world units a texel, 0.7 m.** Against the rescaled
 * archetypes a house is 0.6 units across (7 texels) and at a 50° sun casts a
 * shadow 0.37 units long — 4 texels. Take off 1.8 texels of normal bias, blur
 * what is left with a kernel spread over ±1.5 texels, and there is nothing
 * there. Captured and confirmed: village at midday, clear air, ambient forced
 * to 0.02 so anything unlit would be black — not one building cast a shadow
 * onto the ground.
 *
 * 1.45 buys the near two thirds of the frame instead, at 0.058 units a texel:
 * the same house is 10 texels wide and its shadow 6, which survives the bias
 * and the kernel below with a hard core left over. The far third keeps its
 * lighting and carries no shadow, which is the trade — and it is the right way
 * round, because the far third is also where the haze is doing its work and
 * where a building is twenty pixels tall.
 *
 * Nothing about the cost changes: one box, one map, one depth pass. This is
 * resolution moved, not resolution bought.
 */
const SHADOW_RANGE_SCALE = 1.45;

/**
 * Floor on the range. Walk mode anchors on the walker's own feet, so the
 * distance term collapses to eye height and would otherwise ask for a range of
 * a fraction of a tile. 18 units is 144 m — the street you are standing in.
 */
const SHADOW_RANGE_MIN = 18;

/**
 * Ceiling on the range, which is what keeps the map-wide view honest.
 *
 * Above CAMERA_MAX_POLAR the top of the frustum looks over the horizon and the
 * "visible ground" is unbounded, and at ZOOM_MIN the view is 61x122 tiles: a
 * box that tried to cover either would be blurrier than the fixed box it
 * replaced. 170 is LOD_DETAIL_DISTANCE — the distance at which buildings drop
 * their window material — so shadows stop being drawn exactly where the
 * buildings casting them stop being detailed. Past it the ground still lights
 * normally; it simply carries no shadow.
 */
const SHADOW_RANGE_MAX = 170;

/**
 * Where the split ladder starts, as a fraction of the range.
 *
 * The splits are geometric between this and the far end, which for this camera
 * lands them almost exactly on the screen thirds: at the default view the
 * nearest visible ground sits at 0.6 camera distances and the farthest at 2.2,
 * and 0.6/2.2 is 0.27. Under a third of the range is empty air above the
 * ground, which is why a purely logarithmic split from the camera near plane
 * would waste its first cascade on nothing.
 */
const FIRST_SPLIT_FRACTION = 0.27;

/**
 * Width of the cross-fade between neighbouring cascades, as a fraction of the
 * range. Two cascades are shaded inside the band, so it is kept narrow: 3% of
 * the range is about two world units at the default zoom, which is enough to
 * hide the resolution step without paying for a second light across the frame.
 */
const CASCADE_FADE = 0.03;

/**
 * Normal offset, in shadow texels of the cascade the surface falls in.
 *
 * This is the bias that matters, because it moves the lookup along the
 * receiver's own normal rather than pushing depth: it has to cover the PCF
 * kernel below or the kernel reaches back into the receiver and returns acne.
 *
 * It also *eats the shadow*, from the caster outwards, by the component of the
 * offset perpendicular to the light — and that is the term that has to be paid
 * attention to at this world's scale, where the thing casting is a five-metre
 * house. 1.1 texels covers a kernel spread over ±1 texel with a tenth to
 * spare, and at the fitted box above is 0.064 world units: half a metre of
 * shadow lost at each edge of a three-metre shadow, against the 1.8/1.5 pair
 * that lost all of it. Re-tune it with PCF_RADIUS, never alone.
 */
const NORMAL_BIAS_TEXELS = 1.1;

/**
 * Constant depth bias, also in shadow texels, converted to the normalised
 * depth three actually wants by the cascade's own near/far span. It reads like
 * the -0.0006 it replaces and is not: that number was small only because it was
 * divided by a 627-unit depth range. One texel is the right size once the
 * frustum is fitted.
 */
const DEPTH_BIAS_TEXELS = 1;

/**
 * PCF kernel spread, in texels.
 *
 * One, not 1.5. Softness is worth paying for when the shadow is large compared
 * with the kernel, and at this world's scale it is not: a house's shadow is six
 * texels of the fitted box above, so a kernel spread over three of them is a
 * blur that erases as much as it smooths. At one texel the 3x3 tap still lands
 * on nine distinct texels and the edge is a soft two-texel ramp — about 12 cm
 * of penumbra, which is roughly what a real edge looks like anyway.
 */
const PCF_RADIUS = 1;

/**
 * How far back up the sun ray the light is pulled, so casters standing outside
 * the cascade still cast into it.
 *
 * An ortho box perpendicular to the light ray projects a caster and its own
 * shadow to the same place, so pulling the light back this far catches anything
 * up to this many units up-sun of the box — which at a low sun is horizontal
 * distance, not height. Two height scales is 52 units (416 m), enough for the
 * 6.5x-height shadows the sun draws at 8.8° elevation. It costs depth range,
 * which a 24-bit depth buffer will not notice, and the extra casters it
 * rasterises are exactly the ones whose shadows are in frame.
 */
const CASTER_REACH = HEIGHT_SCALE * 2;

/** Ortho near plane. Nothing stands within half a unit of the light. */
const SHADOW_NEAR = 0.5;

/**
 * Shadow map edge, in texels, and how it is chosen.
 *
 * A phone at 390x780 CSS and MAX_DPR 2 draws 780x1560 device pixels; the near
 * cascade covers roughly the height of the frame, so a map of about the frame's
 * long edge puts a shadow texel a little under a screen pixel — past which
 * resolution buys nothing but bandwidth. 1024 is the cap for both tiers because
 * a 2048² map is 33 MB and the whole point of fitting the frustum is not having
 * to pay that.
 */
const MAP_SIZE_MAX = 1024;
const MAP_SIZE_MIN = 512;
/** Shadow texels per device pixel of the frame's long edge. */
const MAP_TEXELS_PER_PIXEL = 0.7;

/** Cascades per tier. Three splits is the most a single directional light earns. */
const CASCADES_LOW = 1;
const CASCADES_HIGH = 3;

/**
 * The outermost band edges. The first cascade reaches back past the near plane
 * and the last one runs to the far plane, so no fragment anywhere in the frame
 * can fall between cascades and lose its key light. Beyond the fitted range the
 * last cascade simply has nothing in its map and three's own frustum test
 * returns "lit", which is the behaviour we want.
 */
const BAND_EDGE = 1e6;

// ---------------------------------------------------------------------------
// The shader gate
// ---------------------------------------------------------------------------

/**
 * Declarations prepended to every lit material's fragment shader.
 *
 * The bands share their edges — each cascade rises exactly where the previous
 * one falls — so the weights sum to one at every depth. That is what lets the
 * cascades be separate lights without the seam between them showing up as a
 * step in brightness rather than a step in shadow resolution.
 */
const GATE_DECLARATIONS = /* glsl */ `
  uniform vec2 kdCascadeBand[ KD_CASCADES ];
  uniform float kdCascadeFade;

  float kdCascadeWeight( const in vec2 band, const in float depth ) {
    float entering = smoothstep( band.x - kdCascadeFade, band.x + kdCascadeFade, depth );
    float leaving = smoothstep( band.y - kdCascadeFade, band.y + kdCascadeFade, depth );
    return entering - leaving;
  }
`;

/**
 * Opened immediately inside three's directional light loop.
 *
 * The brace is ours: the unroller strips the `for` and repeats the body at one
 * scope, so a variable declared in the body without a block of its own would be
 * redeclared once per cascade. The `#if` is preprocessor arithmetic on the
 * literal the unroller substitutes for UNROLLED_LOOP_INDEX, which keeps the
 * array index constant — and leaves any directional light that is not one of
 * ours completely untouched.
 */
const GATE_OPEN = /* glsl */ `
  {
  #if ( UNROLLED_LOOP_INDEX >= KD_CASCADE_BASE ) && ( UNROLLED_LOOP_INDEX < KD_CASCADE_BASE + KD_CASCADES )
    float kdWeight = kdCascadeWeight( kdCascadeBand[ UNROLLED_LOOP_INDEX - KD_CASCADE_BASE ], vViewPosition.z );
  #else
    float kdWeight = 1.0;
  #endif
  if ( kdWeight > 0.0 ) {
`;

/** Closes the `if` and the block above, just inside the loop's own brace. */
const GATE_CLOSE = /* glsl */ `
  } }
`;

/** The one line in the loop body we have to find to scale a cascade's share. */
const LIGHT_INFO = 'getDirectionalLightInfo( directionalLight, directLight );';

/**
 * three's directional light loop, with the cascade gate wrapped around it.
 *
 * Built by surgery on whatever `lights_fragment_begin` the installed three
 * ships rather than from a copy of it, because a pinned copy of that chunk goes
 * stale silently — three's own CSM addon carries one that has already drifted
 * from r185's iridescence block. Returns null if the anchors are not where they
 * are expected, and the rig then refuses to run cascades at all rather than
 * emitting a shader that will not compile.
 */
function buildGatedChunk(chunk: string): string | null {
  const open = 'for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {';
  const start = chunk.indexOf(open);
  if (start < 0) return null;
  const bodyStart = start + open.length;
  const pragma = chunk.indexOf('#pragma unroll_loop_end', bodyStart);
  if (pragma < 0) return null;
  // The loop's own closing brace: the last one before the pragma that ends it.
  const brace = chunk.lastIndexOf('}', pragma);
  if (brace <= bodyStart) return null;
  const body = chunk.slice(bodyStart, brace);
  if (!body.includes(LIGHT_INFO)) return null;
  const scaled = body.replace(
    LIGHT_INFO,
    `${LIGHT_INFO}\n    directLight.color *= kdWeight;`,
  );
  return chunk.slice(0, bodyStart) + GATE_OPEN + scaled + GATE_CLOSE + chunk.slice(brace);
}

/** Materials that are lit at all — the only ones with a directional loop to gate. */
function isLit(material: THREE.Material): boolean {
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhongMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshToonMaterial
  );
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/**
 * `low` is one map at reduced size — cheaper and sharper than what it replaces,
 * and the tier a mid-range phone should stay on until somebody has measured the
 * alternative on a real device. `high` is the full cascade, which buys the near
 * field at the price of two more depth passes.
 */
export type ShadowQuality = 'low' | 'high';

export interface ShadowCascades {
  /** Holds the cascade lights and their targets. Added to the scene for you. */
  readonly group: THREE.Group;
  readonly quality: ShadowQuality;
  /** How many splits are live — 1 on the low tier, 3 on the high one. */
  readonly cascades: number;
  /**
   * Fits, snaps and places every cascade. Call once per frame, after the layers
   * have synced (so materials created this frame are gated before they draw)
   * and before the scene is rendered.
   *
   * `direction` is where the key light comes from as a unit vector — sky.ts's
   * `keyDirection`, which is the sun by day and the moon after dark. Reading
   * the sky shader's sun uniform instead would put the light under the map all
   * night. The target is what the camera is looking at, in tile space: the same
   * anchor `updateSky` is given, so the two rigs cannot disagree about where
   * the player is.
   */
  update(
    camera: THREE.PerspectiveCamera,
    direction: THREE.Vector3,
    targetX: number,
    targetY: number,
    targetZ: number,
  ): void;
  /**
   * Sizes the maps against the drawing buffer, in device pixels. Cheap, and a
   * no-op unless the size actually changes — a change drops the old maps, which
   * three then reallocates on the next shadow pass.
   */
  resize(pixelWidth: number, pixelHeight: number): void;
  setQuality(quality: ShadowQuality): void;
  dispose(): void;
}

/**
 * Builds the cascade rig and takes the key light over.
 *
 * `key` is sky.ts's directional light. It is hidden rather than left running:
 * the cascades carry its colour and intensity themselves, and a scene with both
 * would light the city twice and shadow it twice. It is handed back on dispose.
 */
export function createShadowCascades(
  scene: THREE.Scene,
  key: THREE.DirectionalLight,
  quality: ShadowQuality = 'low',
): ShadowCascades {
  const group = new THREE.Group();
  group.name = 'shadow-cascades';

  const gatedChunk = buildGatedChunk(THREE.ShaderChunk.lights_fragment_begin);
  const lights: THREE.DirectionalLight[] = [];
  const bands: THREE.Vector2[] = [];
  const bandUniform: THREE.IUniform<THREE.Vector2[]> = { value: bands };
  const fadeUniform: THREE.IUniform<number> = { value: 1 };
  const patched = new WeakSet<THREE.Material>();

  /** Whether the key light was casting before we took it, for the handover back. */
  const keyCastShadow = key.castShadow;
  key.castShadow = false;
  key.visible = false;

  let tier: ShadowQuality = quality;
  let mapSize = MAP_SIZE_MAX;
  /**
   * Index of our first cascade among the scene's directional lights. Zero while
   * we own the only ones, which is the arrangement this rig makes for itself —
   * but it is compiled into the gate as a define, so a stray directional light
   * added ahead of ours shifts the gate instead of misfiring on it. It can only
   * change when the light set does, and that already forces every material to
   * recompile.
   */
  let base = 0;
  /**
   * Cascades the gate is currently compiled for. Read at compile time by the
   * injection below and by the cache key, so a tier change cannot hand a
   * material a program built for the other tier — and setting it to zero on
   * dispose makes the gate compile away to stock three.
   */
  let gated = 0;

  const inject = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    // One cascade needs no gate: its weight would be one everywhere, so the low
    // tier compiles to exactly the shader three would have written.
    if (gated < 2 || gatedChunk === null) return;
    shader.uniforms['kdCascadeBand'] = bandUniform;
    shader.uniforms['kdCascadeFade'] = fadeUniform;
    shader.fragmentShader =
      `#define KD_CASCADES ${gated}\n#define KD_CASCADE_BASE ${base}\n${GATE_DECLARATIONS}\n` +
      shader.fragmentShader.replace('#include <lights_fragment_begin>', gatedChunk);
  };

  const patch = (material: THREE.Material): void => {
    if (patched.has(material) || !isLit(material)) return;
    patched.add(material);
    // Chained, never replaced: the water's wave shader is an onBeforeCompile of
    // its own (terrain.ts), and its cache key has to survive too or it starts
    // sharing a compiled program with whatever else has its parameters.
    const hook = material.onBeforeCompile;
    const identity = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      hook.call(material, shader, renderer);
      inject(shader);
    };
    material.customProgramCacheKey = () => `${identity}|kd-cascades-${gated}-${base}`;
    // Its current program was compiled without the gate; three only recompiles
    // when it is told to.
    material.needsUpdate = true;
  };

  /**
   * Walks the scene in the order the renderer will, patching materials it has
   * not seen and counting the directional lights that come before ours.
   *
   * Every frame, because the layers build materials lazily — a building
   * archetype's facade appears the first time one of that kind is standing —
   * and a material has to be gated before its first draw call or it will be lit
   * by every cascade at once. It is a walk of a few hundred objects that
   * allocates nothing; the renderer already walks the same graph twice.
   */
  const scan = (): void => {
    let seen = 0;
    let found = false;
    const visit = (object: THREE.Object3D): void => {
      // Same test the renderer applies, so the count matches the one the shader
      // will be compiled against.
      if (!object.visible) return;
      if (object instanceof THREE.DirectionalLight) {
        if (lights.includes(object)) {
          if (!found) {
            base = seen;
            found = true;
          }
        }
        seen++;
      } else if (object instanceof THREE.Mesh) {
        const material = object.material;
        if (Array.isArray(material)) for (const slot of material) patch(slot);
        else patch(material);
      }
      for (const child of object.children) visit(child);
    };
    visit(scene);
  };

  const dropMap = (light: THREE.DirectionalLight): void => {
    const map = light.shadow.map;
    if (map === null) return;
    // Both halves, in three's own order: the render target holds a colour
    // attachment and a depth texture, and disposing only the target leaves the
    // larger of the two on the GPU.
    if (map.depthTexture !== null) {
      map.depthTexture.dispose();
      map.depthTexture = null;
    }
    map.dispose();
    light.shadow.map = null;
  };

  const makeLight = (): THREE.DirectionalLight => {
    // Colour and intensity are copied from the key every frame; the constructor
    // values are placeholders for the frame before the first update.
    const light = new THREE.DirectionalLight(key.color.getHex(), key.intensity);
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.radius = PCF_RADIUS;
    light.shadow.camera.near = SHADOW_NEAR;
    // Nothing is drawn from these lights, so their own transforms are the only
    // thing the shadow pass reads from them.
    group.add(light, light.target);
    return light;
  };

  const setCascadeCount = (count: number): void => {
    while (lights.length > count) {
      const light = lights.pop();
      if (!light) break;
      dropMap(light);
      group.remove(light, light.target);
    }
    while (lights.length < count) lights.push(makeLight());
    // The uniform array is declared at exactly this length in the shader, so it
    // has to be trimmed to match or the upload overruns the declaration.
    while (bands.length > count) bands.pop();
    while (bands.length < count) bands.push(new THREE.Vector2());
    gated = count;
  };

  const setQuality = (next: ShadowQuality): void => {
    if (next === tier) return;
    tier = next;
    setCascadeCount(cascadesFor(tier, gatedChunk !== null));
  };

  const resize = (pixelWidth: number, pixelHeight: number): void => {
    // The long edge: the cascade box is square, so the wider side of the frame
    // is the one that decides how many screen pixels a texel has to cover.
    const next = mapSizeFor(Math.max(pixelWidth, pixelHeight));
    if (next === mapSize) return;
    mapSize = next;
    for (const light of lights) {
      light.shadow.mapSize.set(mapSize, mapSize);
      // mapSize alone changes nothing once a map exists; three sizes it at
      // allocation, so the old one has to go.
      dropMap(light);
    }
  };

  // Scratch, so a per-frame fit allocates nothing.
  const dir = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const edges: number[] = [];

  const update = (
    camera: THREE.PerspectiveCamera,
    direction: THREE.Vector3,
    targetX: number,
    targetY: number,
    targetZ: number,
  ): void => {
    scan();
    if (lights.length === 0) return;

    // The sky rig goes on placing its own light every frame; hiding it again
    // here costs one write and closes the door on the city being lit twice.
    key.visible = false;

    dir.copy(direction);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    dir.normalize();

    for (const light of lights) {
      light.color.copy(key.color);
      light.intensity = key.intensity;
    }

    // The light-space basis, built exactly as three's own lookAt will build it
    // from the same position and target — x = up × z, y = z × x, z = dir — so
    // the grid we snap to is the grid the shadow map is rasterised on. The
    // fallback is for a light pointing straight up, where the cross collapses;
    // this game's sun never comes within 19° of it, but a caller's might.
    right.set(0, 1, 0).cross(dir);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    else right.normalize();
    up.copy(dir).cross(right).normalize();

    camera.getWorldDirection(forward);

    const span = Math.hypot(
      camera.position.x - targetX,
      camera.position.y - targetY,
      camera.position.z - targetZ,
    );
    const range = Math.min(
      SHADOW_RANGE_MAX,
      Math.max(SHADOW_RANGE_MIN, span * SHADOW_RANGE_SCALE),
    );
    fadeUniform.value = range * CASCADE_FADE;
    splitRange(camera.near, range, lights.length, edges);

    // Half-angles of the view frustum, which is all the bounding sphere of a
    // slice of it depends on: the fit is therefore independent of where the
    // camera is pointing, and orbiting cannot make a cascade breathe.
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    const spread = tanH * tanH + tanV * tanV;

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i]!;
      const near = edges[i]!;
      const far = edges[i + 1]!;

      // Centre of the smallest sphere around the slice, on the view axis, then
      // the exact radius from whichever end of the slice is further from it.
      const axis = Math.min(far, Math.max(near, ((far + near) * (1 + spread)) / 2));
      const radius = Math.max(
        Math.hypot(axis - near, near * Math.sqrt(spread)),
        Math.hypot(far - axis, far * Math.sqrt(spread)),
      );
      const texel = (2 * radius) / mapSize;

      centre.copy(camera.position).addScaledVector(forward, axis);
      // Snapped in light space, on the two axes the shadow map is indexed by.
      // Rounding the centre to whole texels is what stops the map sliding under
      // the world as the player pans; the third axis is depth and does not
      // quantise. The basis itself turns with the sun over the day, so the grid
      // does drift — at 3°/s, under the shadows' own movement.
      const alongX = Math.round(centre.dot(right) / texel) * texel;
      const alongY = Math.round(centre.dot(up) / texel) * texel;
      const alongZ = centre.dot(dir);
      centre
        .copy(right)
        .multiplyScalar(alongX)
        .addScaledVector(up, alongY)
        .addScaledVector(dir, alongZ);

      const reach = radius + CASTER_REACH;
      light.position.copy(centre).addScaledVector(dir, reach);
      light.target.position.copy(centre);
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();

      const shadow = light.shadow;
      const shadowCamera = shadow.camera;
      shadowCamera.left = -radius;
      shadowCamera.right = radius;
      shadowCamera.top = radius;
      shadowCamera.bottom = -radius;
      shadowCamera.near = SHADOW_NEAR;
      shadowCamera.far = reach + radius;
      // Never called by three after construction, and the extents mean nothing
      // until it is.
      shadowCamera.updateProjectionMatrix();

      // Both biases are texels of this cascade, which is the only scale at which
      // either of them means anything. The depth one is normalised by the span
      // it is measured across, because that is the unit three wants.
      shadow.normalBias = texel * NORMAL_BIAS_TEXELS;
      shadow.bias = -(texel * DEPTH_BIAS_TEXELS) / (shadowCamera.far - shadowCamera.near);

      const band = bands[i]!;
      band.set(
        i === 0 ? -BAND_EDGE : near,
        i === lights.length - 1 ? BAND_EDGE : far,
      );
    }
  };

  scene.add(group);
  setCascadeCount(cascadesFor(tier, gatedChunk !== null));

  return {
    group,
    get quality(): ShadowQuality {
      return tier;
    },
    get cascades(): number {
      return lights.length;
    },
    update,
    resize,
    setQuality,
    dispose: () => {
      setCascadeCount(0);
      scene.remove(group);
      group.clear();
      // Handed back the way it was found. The patched materials keep their hook,
      // but with no cascades left it injects nothing, and losing these lights
      // recompiles them back to stock three on the next frame they are drawn.
      key.castShadow = keyCastShadow;
      key.visible = true;
    },
  };
}

/** Splits with no gate to hold them apart would light the city once per cascade. */
function cascadesFor(quality: ShadowQuality, gatable: boolean): number {
  if (!gatable) return CASCADES_LOW;
  return quality === 'high' ? CASCADES_HIGH : CASCADES_LOW;
}

/**
 * The split ladder, written into `out` as cascade edges by view depth.
 *
 * Geometric rather than even, because a perspective frustum's slices grow with
 * depth: even splits give the far cascade a box four times the near one's and
 * the sharpness lands where nobody is looking. The ladder starts a fraction of
 * the way in rather than at the near plane so the first cascade is not spent on
 * the empty air between the camera and the ground.
 */
function splitRange(near: number, range: number, count: number, out: number[]): void {
  out.length = count + 1;
  out[0] = near;
  out[count] = range;
  const start = Math.max(near, range * FIRST_SPLIT_FRACTION);
  for (let i = 1; i < count; i++) out[i] = start * Math.pow(range / start, i / count);
}

/**
 * Shadow map edge for a frame this many device pixels across its long side,
 * clamped to a power of two so the map is a size a GPU likes allocating.
 */
function mapSizeFor(pixels: number): number {
  const wanted = Math.max(1, pixels) * MAP_TEXELS_PER_PIXEL;
  let size = MAP_SIZE_MIN;
  while (size * 2 <= wanted && size < MAP_SIZE_MAX) size *= 2;
  return size;
}
