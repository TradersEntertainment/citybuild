import * as THREE from 'three';
import type { DraftRender } from '../input/draft';
import type { GameState } from '../sim/state';
import { createBuildings, type BuildingMeshes } from './buildings';
import type { CameraRig } from './cameraRig';
import { createHazards, type HazardLayer } from './hazards';
import { createIssues, type IssueLayer } from './issues';
import { createOverlay, type OverlayLayer } from './overlay';
import { createRoads, type RoadMesh } from './roads';
import { dayFraction, nightAmount } from '../sim/daytime';
import { createSky, updateSky, type SkyRig } from './sky';
import { createStreetlights, type StreetlightLayer } from './streetlights';
import { createStations, type StationLayer } from './stations';
import { createTerrain, createWater, sampleHeight, type TerrainMesh } from './terrain';
import { createTraffic, type TrafficLayer } from './traffic';
import { createTrees, type TreeLayer } from './trees';

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
}

/** Zoning changes on every building spawn; rebuilding that layer is a grid scan. */
const ZONE_REBUILD_INTERVAL_MS = 220;

export class Renderer {
  readonly stats: RenderStats = { fps: 0, drawCalls: 0, triangles: 0 };

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
  private readonly issues: IssueLayer;
  private readonly hazards: HazardLayer;
  private readonly stations: StationLayer;
  private readonly overlay: OverlayLayer;

  /**
   * Set by the walk mode (§15): while someone else drives the camera, the rig
   * must not re-assert its orbit on the next frame.
   */
  externalCameraControl = false;

  private zonesDirty = true;
  private forSaleDirty = true;
  private stationsDirty = false;
  private lastZoneRebuild = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;

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
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.sky = createSky(this.scene);
    this.terrain = createTerrain(state.world);
    this.water = createWater(state.world);
    this.roads = createRoads(state.world);
    this.streetlights = createStreetlights(state.world);
    this.buildings = createBuildings();
    this.trees = createTrees(state.world);
    this.traffic = createTraffic(state.world);
    this.issues = createIssues();
    this.hazards = createHazards();
    this.stations = createStations();
    this.stations.rebuild(state);
    this.overlay = createOverlay(state.world);

    this.scene.add(
      this.terrain.group,
      this.water,
      this.roads.group,
      this.streetlights.group,
      this.trees.group,
      this.buildings.group,
      this.traffic.group,
      this.issues.group,
      this.hazards.group,
      this.stations.group,
      this.overlay.group,
    );

    // The rig raycasts against the height field to turn a touch into a tile, so
    // it needs the same sampler the meshes were built from.
    this.camera.setHeightSampler((x, y) => sampleHeight(state.world, x, y));
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
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

  /** True when a purchase changed which parcels are on offer. */
  get needsForSaleRefresh(): boolean {
    return this.forSaleDirty;
  }

  /** A station was built or removed. */
  invalidateServices(): void {
    this.stationsDirty = true;
  }

  invalidateRoads(): void {
    this.roads.rebuild();
    this.streetlights.rebuild();
    this.traffic.rebuildNetwork();
    this.zonesDirty = true;
  }

  invalidateZones(): void {
    this.zonesDirty = true;
  }

  render(frame: FrameInput, deltaMs: number): void {
    if (!this.externalCameraControl) this.camera.update();

    if (this.zonesDirty && frame.now - this.lastZoneRebuild > ZONE_REBUILD_INTERVAL_MS) {
      this.overlay.rebuildZones();
      // Trees stand down for roads and buildings, so they go stale for exactly
      // the same reasons the zone layer does — and both are grid scans, so they
      // share one throttle rather than each paying for their own.
      this.trees.rebuild();
      this.zonesDirty = false;
      this.lastZoneRebuild = frame.now;
    }

    if (this.stationsDirty) {
      this.stations.rebuild(frame.state);
      this.stationsDirty = false;
    }

    this.overlay.setDraft(frame.draft);
    this.buildings.sync(frame.state, frame.now);
    this.traffic.update(
      deltaMs / 1000,
      frame.state,
      this.camera.distance,
      frame.trafficLoad,
      frame.now,
    );
    this.issues.sync(frame.state, this.camera.distance, frame.now);
    this.hazards.sync(frame.state, this.camera.distance, frame.now);

    // One clock for the whole frame: the sky, the lit windows and the streets
    // all read the same fraction, so nothing can disagree about what time it is.
    const dayFrac = dayFraction(frame.state.playedMs);
    this.sky.setDayFraction(dayFrac);
    // setNightFactor has existed since the facades were written and was never
    // once called — the windows had an emissive map and no reason to glow.
    const night = nightAmount(dayFrac);
    this.buildings.setNightFactor(night);
    this.streetlights.update(night, frame.state.playedMs, this.camera.distance);

    // The sky anchors on whoever is looking: the rig's orbit target normally,
    // the walker's own feet while the camera is on loan.
    const anchorX = this.externalCameraControl ? this.camera.camera.position.x : this.camera.x;
    const anchorY = this.externalCameraControl ? this.camera.camera.position.z : this.camera.y;
    const targetY = sampleHeight(frame.state.world, anchorX, anchorY);
    updateSky(this.sky, this.camera.camera, anchorX, targetY, anchorY);
    (this.water.userData['tick'] as ((seconds: number) => void) | undefined)?.(
      performance.now() / 1000,
    );

    this.renderer.render(this.scene, this.camera.camera);
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
      this.stats.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
      const info = this.renderer.info.render;
      this.stats.drawCalls = info.calls;
      this.stats.triangles = info.triangles;
    }
  }

  dispose(): void {
    this.sky.dispose();
    this.terrain.dispose();
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
    this.roads.dispose();
    this.streetlights.dispose();
    this.trees.dispose();
    this.traffic.dispose();
    this.issues.dispose();
    this.stations.dispose();
    this.buildings.dispose();
    this.overlay.dispose();
    this.renderer.dispose();
  }
}
