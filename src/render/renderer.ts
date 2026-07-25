import { MAX_DPR } from '../data/balance';
import type { GameState } from '../sim/state';
import type { Camera } from './camera';
import { drawBuildings, drawZones } from './layers/buildings';
import {
  drawDraft,
  drawInkDry,
  drawRoads,
  type DraftRender,
  type InkDryEffect,
} from './layers/roads';
import { TerrainLayer } from './layers/terrain';
import { styleForEra } from './style';

/**
 * Layer orchestration and canvas ownership (§17). The renderer reads sim state
 * and never writes to it.
 *
 * DPR is capped at 2: uncapped, a 3× phone screen quadruples the fill cost for
 * no visible gain and the frame budget is gone before anything is drawn.
 */
export interface RenderStats {
  fps: number;
  frameMs: number;
  terrainRepaintMs: number;
}

export interface Scene {
  state: GameState;
  draft: DraftRender | null;
  inkDry: readonly InkDryEffect[];
  now: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain = new TerrainLayer();
  private dpr = 1;
  private frameMs = 0;
  private fps = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
  }

  /**
   * Sizes the backing store to the element's CSS box × DPR. Called on resize,
   * orientation change and visualViewport changes — Safari reports a stale
   * innerHeight during the address-bar animation, so the element box is the
   * only trustworthy source.
   */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    if (
      this.canvas.width !== backingWidth ||
      this.canvas.height !== backingHeight ||
      this.dpr !== dpr
    ) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
      this.dpr = dpr;
    }
    this.camera.setViewport(width, height);
  }

  /**
   * One frame. Draw order matters: terrain, then the zones painted on it, then
   * roads over both, then the buildings that front onto them, then effects and
   * the live stroke on top of everything.
   */
  render(scene: Scene, deltaMs: number): void {
    const started = performance.now();
    const ctx = this.ctx;
    const { state } = scene;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.terrain.draw(ctx, state.world, this.camera, state.era);
    drawZones(ctx, state, this.camera);
    drawRoads(ctx, state.world, this.camera, styleForEra(state.era));
    drawBuildings(ctx, state, this.camera, scene.now);
    drawInkDry(ctx, this.camera, scene.inkDry, scene.now);
    if (scene.draft) drawDraft(ctx, this.camera, scene.draft);

    this.frameMs = performance.now() - started;
    this.trackFps(deltaMs);
  }

  invalidateTerrain(): void {
    this.terrain.invalidate();
  }

  get stats(): RenderStats {
    return { fps: this.fps, frameMs: this.frameMs, terrainRepaintMs: this.terrain.lastRepaintMs };
  }

  private trackFps(deltaMs: number): void {
    this.fpsAccumulator += deltaMs;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 500) {
      this.fps = (this.fpsFrames * 1000) / this.fpsAccumulator;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }
  }
}
