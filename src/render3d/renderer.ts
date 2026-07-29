import * as THREE from 'three';
import type { DraftRender } from '../input/draft';
import type { GameState } from '../sim/state';
import { createBuildings, type BuildingMeshes } from './buildings';
import type { CameraRig } from './cameraRig';
import { createHazards, type HazardLayer } from './hazards';
import { createTransit, type TransitLayer } from './transit';
import { createIssues, type IssueLayer } from './issues';
import { createLens, LENS_REFRESH_MS, type LensLayer } from './lens';
import type { LensKind } from '../sim/lens';
import { createOverlay, type OverlayLayer } from './overlay';
import { createPedestrians, type PedestrianLayer } from './pedestrians';
import { createRoads, type RoadMesh } from './roads';
import { dayFraction, nightAmount } from '../sim/daytime';
import { lightingShare } from '../sim/investments';
import { weatherAt } from '../sim/weather';
import { createSky, updateSky, type SkyRig } from './sky';
import { createStreetlights, type StreetlightLayer } from './streetlights';
import { createConstruction, type ConstructionLayer } from './construction';
import { createWildlife, type WildlifeLayer } from './wildlife';
import { seasonTint } from './seasonLook';
import { createShips, type ShipLayer } from './ships';
import { createStations, type StationLayer } from './stations';
import { createTerrain, sampleHeight, type TerrainMesh } from './terrain';
import { createTraffic, type TrafficLayer } from './traffic';
import { createTrees, type TreeLayer } from './trees';
import { createWeatherFx, type WeatherFx } from './weatherFx';

// The six layers that answer to the graphics tier, and the tier itself. Grouped
// rather than filed alphabetically above because they arrive as one decision:
// which of these is switched on, and how far, is `quality.ts`'s single answer.
import { createAtmosphere, WATER_HAZE_WEIGHT, type Atmosphere } from './atmosphere';
import { createFacadeMaps, type FacadeMapLayer } from './facadeMaps';
import { createPostFx, type PostFx } from './postfx';
import { createShadowCascades, type ShadowCascades } from './shadows';
import { createTerrainDetail, type TerrainDetailLayer } from './terrainDetail';
import { createWater, type WaterLayer } from './water';
import {
  decideQualityTier,
  MODULE_TIERS,
  pixelRatioFor,
  readDeviceProfile,
  type QualityTier,
} from './quality';

// Moved to render3d/quality.ts, where the tier decision can reach it without
// dragging three.js into a pure function. Re-exported rather than relocated in
// its callers, because this is the file everybody already looks in for it.
export { pixelRatioFor } from './quality';

/**
 * Owns the WebGL context and the scene graph, and nothing else. Everything the
 * player sees is assembled here from layers that each know how to build
 * themselves from sim state; the renderer's own job is the frame: update the
 * rig, refresh what is dirty, draw, and measure.
 *
 * Rebuilds are explicit rather than automatic. Terrain, roads and zoning change
 * on player edits — which the tool layer already announces — so scanning the
 * grid every frame would be pure waste on a phone.
 */
export interface FrameInput {
  state: GameState;
  draft: DraftRender | null;
  now: number;
  /** Per-tile congestion, so the cars move at the speed the sim says they do. */
  trafficLoad?: Float32Array;
}

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  /**
   * Milliseconds of JavaScript inside one `render()`, rolling worst-of-the-last-second.
   *
   * Separate from fps on purpose, because the two answer different questions and
   * only this one is portable. A frame can take two seconds because the machine
   * is rasterising in software — which says nothing about anybody else's machine
   * — or because our own per-building work has grown too big, which says
   * everything. When a player reports a frozen tab, this is the number that
   * decides which of those it was.
   */
  cpuMs: number;
}

/** Zoning changes on every building spawn; rebuilding that layer is a grid scan. */
const ZONE_REBUILD_INTERVAL_MS = 220;

export class Renderer {
  readonly stats: RenderStats = { fps: 0, drawCalls: 0, triangles: 0, cpuMs: 0 };

  /**
   * The graphics tier this renderer was built at (render3d/quality.ts).
   *
   * Read-only, and there is deliberately no setter. Three of the six new layers
   * install their shader patch by *snapshotting* the material's
   * `customProgramCacheKey` at patch time (shadows.ts:389, atmosphere.ts:1211),
   * which freezes whatever tier was in force when the snapshot was taken — so a
   * runtime `setQuality` on the terrain grain or the facade maps would compile
   * nothing and change nothing, silently. Rather than ship a settings control
   * that half works, the tier is chosen once, before the first material is
   * patched. Whoever adds the settings screen should first make those two chain
   * the cache-key *function* instead of its result; then this can grow a setter.
   */
  readonly quality: QualityTier;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sky: SkyRig;
  private readonly atmosphere: Atmosphere;
  private readonly shadows: ShadowCascades;
  private readonly postfx: PostFx;
  private readonly terrain: TerrainMesh;
  private readonly terrainDetail: TerrainDetailLayer;
  private readonly water: WaterLayer;
  private readonly facadeMaps: FacadeMapLayer;
  private readonly roads: RoadMesh;
  private readonly streetlights: StreetlightLayer;
  private readonly buildings: BuildingMeshes;
  private readonly trees: TreeLayer;
  private readonly traffic: TrafficLayer;
  private readonly pedestrians: PedestrianLayer;
  private readonly issues: IssueLayer;
  private readonly hazards: HazardLayer;
  private readonly transit: TransitLayer;
  private readonly stations: StationLayer;
  private readonly ships: ShipLayer;
  private readonly construction: ConstructionLayer;
  private readonly wildlife: WildlifeLayer;
  private readonly overlay: OverlayLayer;
  private readonly lens: LensLayer;
  private lensRefreshedAt = 0;
  private lensPlayedMs = -1;
  private readonly weather: WeatherFx;

  /**
   * Set by the walk mode (§15): while someone else drives the camera, the rig
   * must not re-assert its orbit on the next frame.
   */
  externalCameraControl = false;

  /**
   * Told when the graphics context goes away and when it comes back, so the
   * shell can stop drawing and say so. Set by main.ts; the renderer itself has
   * no opinion about what the player should be told.
   */
  onContextLost?: () => void;
  onContextRestored?: () => void;

  private lost = false;

  /** Whether the context is currently gone. A frame drawn now is wasted work. */
  get contextLost(): boolean {
    return this.lost;
  }

  private zonesDirty = true;
  private forSaleDirty = true;
  private stationsDirty = false;
  private lastZoneRebuild = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private cpuPeak = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly camera: CameraRig,
    state: GameState,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // The city is opaque and fills the frame; an alpha buffer would only cost
      // bandwidth on the devices least able to spare it.
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(
      pixelRatioFor(window.innerWidth, window.innerHeight, window.devicePixelRatio),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // The browser can take the graphics context away — under memory pressure,
    // when the GPU process is recycled, or when the machine sleeps. Until now
    // nothing listened, so the frame loop went on calling render() against a
    // dead context and the player watched a black rectangle with no idea
    // whether the game had frozen, crashed, or was simply thinking.
    //
    // preventDefault is what makes a restore possible at all: without it the
    // context is gone for good and only a reload brings the city back.
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.lost = true;
        this.onContextLost?.();
      },
      false,
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.lost = false;
        // Everything the layers hold was uploaded to a context that no longer
        // exists, so the ones built from the map are rebuilt rather than
        // trusted. three.js re-uploads its own resources on the next draw.
        this.zonesDirty = true;
        this.forSaleDirty = true;
        this.stationsDirty = true;
        this.terrain.rebuildAll();
        // What each new layer needs to come back, and nothing more.
        //
        // Render targets are framebuffers, which three does not restore, so the
        // whole post chain is dropped and rebuilt. The water's depth field and
        // the terrain's grain are DataTextures, which three re-uploads from the
        // arrays it still holds — but the water's field is re-baked anyway,
        // because `rebuild` is also what flags it for that upload. The
        // atmosphere and any material it patched have to be told to recompile:
        // a shader assembled in `onBeforeCompile` dies with the context and
        // three will not rebuild what it did not author. The shadow maps are
        // three's own render targets and are reallocated on the next shadow
        // pass; the facade maps are DataTextures whose byte arrays are still
        // referenced, so both are deliberately absent from this list.
        this.postfx.invalidate();
        this.water.rebuild();
        this.atmosphere.invalidate();
        // Idempotent — already-adopted materials are recognised and skipped —
        // so this is belt and braces against a terrain rebuild that ever starts
        // minting fresh materials rather than fresh geometry.
        this.terrainDetail.attach(this.terrain.group);
        this.onContextRestored?.();
      },
      false,
    );

    // Decided once, here, before a single material exists to be patched. See
    // the note on `quality` for why there is no setter.
    this.quality = decideQualityTier(readDeviceProfile());
    const tiers = MODULE_TIERS[this.quality];

    this.sky = createSky(this.scene);
    this.terrain = createTerrain(state.world);
    // Before anything else can touch the terrain material. `attach` refuses a
    // material that already carries an `onBeforeCompile`, which is its guard
    // against flattening the sea — and both the atmosphere and the shadow
    // cascades install one on every lit material they can reach. Adopt first
    // and they chain onto this; adopt second and it silently does nothing.
    this.terrainDetail = createTerrainDetail(tiers.terrainDetail);
    this.terrainDetail.attach(this.terrain.group);
    this.water = createWater(state.world, tiers.water);
    this.roads = createRoads(state.world);
    this.streetlights = createStreetlights(state.world);
    this.facadeMaps = createFacadeMaps(tiers.facadeMaps);
    // Passed in rather than reached for, so the maps are hung on a facade
    // material inside `kitFor` — once per archetype — and never from the bucket
    // doubling path, which is the leak meshLeaks.test.ts guards.
    this.buildings = createBuildings(undefined, this.facadeMaps);
    this.trees = createTrees(state.world);
    this.traffic = createTraffic(state.world);
    this.pedestrians = createPedestrians(state.world);
    this.issues = createIssues();
    this.hazards = createHazards();
    this.transit = createTransit();
    this.stations = createStations();
    this.stations.rebuild(state);
    // Ships share the stations' dirty flag: they exist because berths do, and
    // both change on exactly the same events.
    this.ships = createShips();
    this.ships.rebuild(state);
    this.construction = createConstruction();
    this.wildlife = createWildlife();
    this.wildlife.rebuild(state);
    this.overlay = createOverlay(state.world);
    this.lens = createLens(state.world);
    this.weather = createWeatherFx();

    this.scene.add(
      this.terrain.group,
      this.water.group,
      this.roads.group,
      this.streetlights.group,
      this.trees.group,
      this.buildings.group,
      this.traffic.group,
      this.pedestrians.group,
      this.issues.group,
      this.hazards.group,
      this.transit.group,
      this.stations.group,
      this.ships.group,
      this.construction.group,
      this.wildlife.group,
      this.overlay.group,
      this.lens.group,
      this.weather.group,
    );

    // The cascades take the key light over: sky.ts goes on colouring and aiming
    // it through the whole day cycle, and these carry that colour and intensity
    // into one to three fitted shadow maps instead of the single map-wide one
    // the light was casting itself. Do not re-enable `sky.key.castShadow`.
    this.shadows = createShadowCascades(this.scene, this.sky.key, tiers.shadows);

    this.atmosphere = createAtmosphere(this.scene, tiers.atmosphere);
    this.scene.add(this.atmosphere.group);
    // Required, not tidiness: the atmosphere's dome is a strict superset of the
    // sky rig's — the same gradient plus a sun disc, a moon on the anti-sun,
    // stars and drifting clouds — drawn last with LEQUAL depth. Two domes would
    // fight. Everything else in sky.ts stays: the key light, the ambient and
    // the funded-night coupling all still drive the look.
    this.sky.dome.visible = false;
    // The lens and the zone overlays are deliberately absent. They are a
    // readout in a governance game, and a legend that means one thing near the
    // camera and another at the far edge of the map is not a legend.
    this.atmosphere.attach(
      this.terrain.group,
      this.roads.group,
      this.buildings.group,
      this.trees.group,
      this.traffic.group,
      this.stations.group,
      this.ships.group,
      this.construction.group,
      this.transit.group,
      this.pedestrians.group,
      this.hazards.group,
      this.issues.group,
      this.streetlights.group,
      this.wildlife.group,
    );
    // The sea takes half. It is the one surface in the scene with no horizon
    // above it in frame to fade into, so a full mix turns it into a sheet of
    // sky colour and the coast reads as cloud — see WATER_HAZE_WEIGHT.
    this.atmosphere.attachDamped(WATER_HAZE_WEIGHT, this.water.group);

    // Last, after every layer is in the scene: it renders the scene it is
    // handed, and at anything above the floor tier it renders it into a target.
    this.postfx = createPostFx(this.renderer, this.scene, this.camera.camera, tiers.post);

    // Sized before the first frame rather than waiting for a resize event that
    // may never come — main.ts calls resize() immediately, but a renderer that
    // draws a correct first frame without being told to is one less ordering
    // rule for whoever wires it next.
    this.syncViewport();

    // The rig raycasts against the height field to turn a touch into a tile, so
    // it needs the same sampler the meshes were built from.
    this.camera.setHeightSampler((x, y) => sampleHeight(state.world, x, y));
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(pixelRatioFor(width, height, window.devicePixelRatio));
    this.renderer.setSize(width, height, false);
    this.camera.setViewport(width, height);
    this.syncViewport();
  }

  /**
   * Tells every layer that measures itself in pixels how big the frame is now.
   *
   * Strictly after `setPixelRatio`/`setSize`, because all of them read the
   * drawing buffer rather than the CSS window: the shadow maps are sized
   * against it, the water and the ground grain decide their detail fades in
   * pixels, the sun's disc is antialiased against one pixel's worth of angle,
   * and the post chain's targets simply are it. Each early-returns when nothing
   * moved, which matters because Safari fires `visualViewport` resize
   * continuously while the address bar slides.
   */
  private syncViewport(): void {
    const canvas = this.renderer.domElement;
    // Device pixels, straight off the buffer three just allocated — not
    // window.innerHeight × devicePixelRatio, which ignores the budget that
    // pixelRatioFor may have just applied.
    const pixelWidth = canvas.width;
    const pixelHeight = canvas.height;
    this.shadows.resize(pixelWidth, pixelHeight);
    this.water.resize(pixelHeight);
    this.atmosphere.resize(pixelHeight);
    this.terrainDetail.resize(window.innerHeight, this.renderer.getPixelRatio());
    this.postfx.resize();
  }

  /** Terrain changed — an era restyle, or ground the player just bought. */
  invalidateTerrain(): void {
    this.terrain.rebuildAll();
    // The sea's depth ramp and shoreline are baked from the height field, so
    // ground that just changed shape leaves them describing a coast that is no
    // longer there.
    this.water.rebuild();
    this.forSaleDirty = true;
  }

  /** Marks the parcels currently on the market. */
  setForSale(parcels: readonly { px: number; py: number }[]): void {
    this.overlay.setForSale(parcels);
    this.forSaleDirty = false;
  }

  /**
   * Marks the squares the site goals are pointing at (§28).
   *
   * Set from the sim rather than derived here, because which goals are open is
   * a rule and this file draws rules rather than deciding them. Cheap enough to
   * call whenever the goal list changes; the pulse itself costs one opacity
   * write a frame.
   */
  setSites(areas: readonly { x0: number; y0: number; x1: number; y1: number }[]): void {
    this.overlay.setSites(areas);
  }

  /** True when a purchase changed which parcels are on offer. */
  get needsForSaleRefresh(): boolean {
    return this.forSaleDirty;
  }

  /**
   * What the GPU is currently holding, straight from three.js.
   *
   * Both numbers are supposed to be flat once a city has settled. Either one
   * climbing with the clock is a leak, and a leak here is the one class of bug
   * that kills the tab outright rather than making it slow — WebGL resources
   * are not garbage collected, so a geometry replaced without `.dispose()`
   * lives until the context does.
   */
  get resources(): { geometries: number; textures: number; programs: number } {
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  /** A station was built or removed. */
  invalidateServices(): void {
    this.stationsDirty = true;
  }

  invalidateRoads(): void {
    this.roads.rebuild();
    this.streetlights.rebuild();
    this.traffic.rebuildNetwork();
    this.pedestrians.rebuildNetwork();
    this.zonesDirty = true;
  }

  invalidateZones(): void {
    this.zonesDirty = true;
  }

  /**
   * Raises a data lens over the map, or clears it with null (render3d/lens.ts).
   *
   * Takes the state because the mesh is built immediately: a lens that waits
   * for its refresh timer answers the tap that asked for it three seconds late.
   */
  setLens(state: GameState, kind: LensKind | null, traffic?: Float32Array): void {
    this.lens.set(state, kind, traffic);
    this.lensRefreshedAt = performance.now();
  }

  /** The lens currently up, for whoever draws the button state. */
  get activeLens(): LensKind | null {
    return this.lens.kind;
  }

  render(frame: FrameInput, deltaMs: number): void {
    // A draw against a dead context is at best wasted and at worst a stream of
    // console errors a second. The simulation keeps running either way — the
    // city is not paused by the browser reclaiming a graphics card.
    if (this.lost) return;
    const cpuStart = performance.now();
    if (!this.externalCameraControl) this.camera.update();

    if (this.zonesDirty && frame.now - this.lastZoneRebuild > ZONE_REBUILD_INTERVAL_MS) {
      this.overlay.rebuildZones();
      // Trees stand down for roads and buildings, so they go stale for exactly
      // the same reasons the zone layer does — and both are grid scans, so they
      // share one throttle rather than each paying for their own.
      this.trees.rebuild();
      // Pavement is ground that has nothing built on it, so it goes stale for
      // exactly the same reason the trees do — and on the same throttle, rather
      // than each grid scan buying its own timer.
      this.pedestrians.rebuildNetwork();
      // Aerial perspective is opt-in per material, and the layers mint
      // materials as the city grows — a facade archetype appears the first time
      // one of its kind is standing. A one-shot attach in the constructor would
      // leave a whole district drawn in clear air. It rides this throttle
      // rather than buying its own: it goes stale for the same reason the zone
      // layer does, which is that something was built.
      this.atmosphere.refresh();
      this.zonesDirty = false;
      this.lastZoneRebuild = frame.now;
    }

    if (this.stationsDirty) {
      this.stations.rebuild(frame.state);
      this.ships.rebuild(frame.state);
      // A berth and a hull that were not in the scene a moment ago. Unthrottled
      // because this branch is already the rare one — it runs on a build, not
      // on a clock.
      this.atmosphere.refresh();
      this.stationsDirty = false;
    }

    // The year going round. Two colour assignments; no geometry is touched.
    const season = seasonTint(frame.state.playedMs);
    this.terrain.setSeasonTint(season.ground);
    this.trees.setSeasonTint(season.foliage);
    // The ground's grain fades out before it can shimmer, and smooths over as
    // the winter deepens — both of which are already-computed numbers, so this
    // is a handful of uniform writes however many chunks the map is cut into.
    this.terrainDetail.update(this.camera.distance, season.snow);
    this.ships.update(deltaMs / 1000, this.camera.distance);
    this.construction.update(frame.state, this.camera.distance, frame.now);
    this.wildlife.update(deltaMs / 1000, frame.state, this.camera.distance);
    this.overlay.setDraft(frame.draft);
    // The site outline breathes on wall-clock time, not on the sim clock: it is
    // an instruction to the player, and it should keep pulsing while the game
    // is paused for exactly that reason.
    this.overlay.pulse(frame.now / 1000);
    this.buildings.sync(frame.state, frame.now);
    // After the sync, so a facade material minted this frame is fading with the
    // rest rather than at full relief for one frame. Writes nothing unless the
    // fade actually moved, and no-ops entirely below the top tier.
    this.facadeMaps.update(this.camera.distance);
    this.traffic.update(
      deltaMs / 1000,
      frame.state,
      this.camera.distance,
      frame.trafficLoad,
      frame.now,
    );
    this.pedestrians.update(
      deltaMs / 1000,
      frame.state.population,
      frame.state.playedMs,
      this.camera.distance,
    );
    this.issues.sync(frame.state, this.camera.distance, frame.now);
    this.hazards.sync(frame.state, this.camera.distance, frame.now);
    this.transit.sync(frame.state, this.camera.distance, frame.now);

    // A raised lens tracks the fields it is drawn from, on its own slow clock:
    // pollution drifts over minutes, and rebuilding 65k tiles per frame is what
    // the zone overlay's throttle exists to prevent.
    // …and never while the city is paused: the fields cannot have moved, so a
    // rebuild would be pure allocation for an identical picture.
    if (
      this.lens.kind &&
      frame.now - this.lensRefreshedAt > LENS_REFRESH_MS &&
      frame.state.playedMs !== this.lensPlayedMs
    ) {
      this.lens.refresh(frame.state, frame.trafficLoad);
      this.lensRefreshedAt = frame.now;
      this.lensPlayedMs = frame.state.playedMs;
    }

    // One clock for the whole frame: the sky, the lit windows and the streets
    // all read the same fraction, so nothing can disagree about what time it is.
    const dayFrac = dayFraction(frame.state.playedMs);
    this.sky.setDayFraction(dayFrac);
    // setNightFactor has existed since the facades were written and was never
    // once called — the windows had an emissive map and no reason to glow.
    const night = nightAmount(dayFrac);
    // What the city has paid to light itself (sim/investments.ts). The same
    // number the ledger uses, so what the player sees after dark and what they
    // earn after dark cannot disagree.
    const lit = lightingShare(frame.state);
    // Lit windows come on harder in a city that funded its own lighting: the
    // shops are open, so they are lit.
    this.buildings.setNightFactor(Math.min(1, night * (1 + lit * 0.5)));
    this.streetlights.update(night, frame.state.playedMs, this.camera.distance, lit);
    // And the sky bounce lifts with it, which is what stops a funded night city
    // being a field of glowing dots over a black ground.
    this.sky.setLighting(lit);

    // The sky anchors on whoever is looking: the rig's orbit target normally,
    // the walker's own feet while the camera is on loan.
    const anchorX = this.externalCameraControl ? this.camera.camera.position.x : this.camera.x;
    const anchorY = this.externalCameraControl ? this.camera.camera.position.z : this.camera.y;
    const targetY = sampleHeight(frame.state.world, anchorX, anchorY);
    updateSky(this.sky, this.camera.camera, anchorX, targetY, anchorY);
    // After the sky, which rewrites the fog colour every frame: this only
    // tightens the distances, and doing it first would have them overwritten.
    const sky = weatherAt(frame.state);
    this.weather.update(
      sky.kind,
      sky.progress,
      deltaMs / 1000,
      this.camera.camera.position.x,
      this.camera.camera.position.z,
      this.scene,
    );

    // The air, and the order is load-bearing in both directions.
    //
    // *After* the weather, because weatherFx scales the fog distances from a
    // base it cached on its very first frame; going first would mean being
    // overwritten every frame with frame-one values. Going second is
    // non-accumulating and correct — this layer re-derives near, far and the
    // colour from the camera and the same weather spell it is told about here.
    //
    // The sun is handed over rather than re-derived. The module can rebuild the
    // same arc from the same `sunHeight`, which is right today and would stop
    // being right the moment that arc is retuned in sky.ts and nowhere else —
    // and the failure would be a drawn sun in one part of the sky casting
    // shadows from another.
    this.atmosphere.setSunDirection(
      this.sky.sunDirection.x,
      this.sky.sunDirection.y,
      this.sky.sunDirection.z,
    );
    this.atmosphere.update({
      dayFraction: dayFrac,
      camera: this.camera.camera,
      weather: sky.kind,
      weatherProgress: sky.progress,
      lighting: lit,
      // Wall clock, not sim time: the clouds go on drifting and the stars go on
      // twinkling while the city is paused, for the same reason the site
      // outline goes on pulsing.
      seconds: performance.now() / 1000,
    });

    // Last of the three, because it reads the fog colour rather than writing
    // one: the sea reflects the same horizon the haze fades into, and the
    // atmosphere is the layer that had the last word on what that colour is.
    this.water.update(performance.now() / 1000, this.camera.distance, {
      keyDirection: this.sky.keyDirection,
      keyColour: this.sky.key.color,
      keyIntensity: this.sky.key.intensity,
      horizon: (this.scene.fog as THREE.Fog).color,
      zenith: this.sky.ambient.color,
    });

    // The last statement before the draw, and that is where it has to be: the
    // cascades gate every lit material in the scene through a shader patch, and
    // a material created earlier in *this* frame — a facade archetype that
    // appeared with the district — has to be gated before its first draw call
    // or it is lit twice. `keyDirection`, never the sky shader's sun uniform:
    // after dark the key is the moon and that uniform is under the map.
    this.shadows.update(this.camera.camera, this.sky.keyDirection, anchorX, targetY, anchorY);

    // Replaces `renderer.render(scene, camera)` outright. At the floor and
    // middle tiers this is one call straight through to the default
    // framebuffer with no target allocated; above them it is the composer.
    this.postfx.render({
      night,
      // The lens is a readout, and the two stages that move a hue or a level —
      // the grade and the vignette — fade out while one is raised so the legend
      // goes on meaning what it says.
      lensActive: this.lens.kind !== null,
      deltaSeconds: deltaMs / 1000,
    });
    // Before `measure`, and excluding nothing: every layer sync, every grid
    // rebuild and the draw submission itself. The GPU's own time is not in here,
    // which is the point.
    this.cpuPeak = Math.max(this.cpuPeak, performance.now() - cpuStart);
    this.measure(deltaMs);
  }

  /** A building spawn changes the zone layer; the sim tells us rather than us polling. */
  onBuildingsChanged(): void {
    this.zonesDirty = true;
  }

  private measure(deltaMs: number): void {
    this.fpsAccumulator += deltaMs;
    this.fpsFrames++;
    if (this.fpsAccumulator >= 500) {
      this.stats.cpuMs = Math.round(this.cpuPeak * 10) / 10;
      this.cpuPeak = 0;
      this.stats.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
      const info = this.renderer.info.render;
      this.stats.drawCalls = info.calls;
      this.stats.triangles = info.triangles;
    }
  }

  dispose(): void {
    // The borrowers first, and in this order, because four of the six do not
    // own the materials they changed — they hand them back. Unwinding before
    // the owners are torn down is what makes the handing-back mean anything.
    //
    // The atmosphere leads: it restores each material's original
    // `onBeforeCompile`, which unwinds the shadow cascades' chained patch with
    // it, so anything that walks the scene after this sees plain materials.
    this.postfx.dispose();
    this.atmosphere.dispose();
    this.shadows.dispose();
    this.facadeMaps.dispose();
    this.terrainDetail.dispose();

    this.lens.dispose();
    this.sky.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.roads.dispose();
    this.streetlights.dispose();
    this.trees.dispose();
    this.traffic.dispose();
    this.pedestrians.dispose();
    this.issues.dispose();
    this.stations.dispose();
    this.ships.dispose();
    this.transit.dispose();
    this.construction.dispose();
    this.wildlife.dispose();
    this.buildings.dispose();
    this.overlay.dispose();
    this.weather.dispose();
    this.renderer.dispose();
  }
}
