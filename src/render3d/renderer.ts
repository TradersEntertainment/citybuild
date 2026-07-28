import * as THREE from 'three';
import { MAX_DPR, MAX_DRAWING_PIXELS } from '../data/balance';
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
import { createTerrain, createWater, sampleHeight, type TerrainMesh } from './terrain';
import { createTraffic, type TrafficLayer } from './traffic';
import { createTrees, type TreeLayer } from './trees';
import { createWeatherFx, type WeatherFx } from './weatherFx';

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

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sky: SkyRig;
  private readonly terrain: TerrainMesh;
  private readonly water: THREE.Mesh;
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
        this.onContextRestored?.();
      },
      false,
    );

    this.sky = createSky(this.scene);
    this.terrain = createTerrain(state.world);
    this.water = createWater(state.world);
    this.roads = createRoads(state.world);
    this.streetlights = createStreetlights(state.world);
    this.buildings = createBuildings();
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
      this.water,
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
  }

  /** Terrain changed — an era restyle, or ground the player just bought. */
  invalidateTerrain(): void {
    this.terrain.rebuildAll();
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
      this.zonesDirty = false;
      this.lastZoneRebuild = frame.now;
    }

    if (this.stationsDirty) {
      this.stations.rebuild(frame.state);
      this.ships.rebuild(frame.state);
      this.stationsDirty = false;
    }

    // The year going round. Two colour assignments; no geometry is touched.
    const season = seasonTint(frame.state.playedMs);
    this.terrain.setSeasonTint(season.ground);
    this.trees.setSeasonTint(season.foliage);
    this.ships.update(deltaMs / 1000, this.camera.distance);
    this.construction.update(frame.state, this.camera.distance, frame.now);
    this.wildlife.update(deltaMs / 1000, frame.state, this.camera.distance);
    this.overlay.setDraft(frame.draft);
    // The site outline breathes on wall-clock time, not on the sim clock: it is
    // an instruction to the player, and it should keep pulsing while the game
    // is paused for exactly that reason.
    this.overlay.pulse(frame.now / 1000);
    this.buildings.sync(frame.state, frame.now);
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
    (this.water.userData['tick'] as ((seconds: number) => void) | undefined)?.(
      performance.now() / 1000,
    );

    this.renderer.render(this.scene, this.camera.camera);
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
    this.lens.dispose();
    this.sky.dispose();
    this.terrain.dispose();
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
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
