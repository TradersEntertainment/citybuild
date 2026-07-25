import { BRUSH_SIZES, COST_LABEL_OFFSET_PX } from '../data/balance';
import { isRoadUnlocked } from '../data/roads';
import { buildRoad, estimateRoad, removeRoad, type RoadEstimate } from '../sim/roads';
import type { GameState } from '../sim/state';
import type { RoadKind, ZoneKind } from '../sim/tiles';
import type { UndoStack } from '../sim/undo';
import { brushTiles, estimateZone, paintZone, type ZoneEstimate } from '../sim/zoning';
import type { Camera } from '../render/camera';
import type { DraftRender } from '../render/layers/roads';
import type { TilePoint } from './pathGeometry';
import { buildRoadPath, type RoadPath } from './pathSmoothing';

/**
 * Active-tool state machine (§18). Owns the stroke in progress: it collects
 * raw finger samples, turns them into the tiles the tool would affect, prices
 * that live, and commits on release.
 *
 * The two tools read a drag differently and that difference is deliberate. A
 * road is a *line* the player meant, so the samples go through smoothing. A
 * zone is *paint*, so the samples are stamped with a brush and nothing is
 * straightened — painting a district is not supposed to be tidy.
 *
 * Either way the work happens once per frame, not once per sample: a fast drag
 * delivers dozens of coalesced points per frame, and re-deriving a 400-tile
 * stroke on each one would spend the budget on arithmetic nobody sees.
 */
export type ToolId = 'none' | 'road' | 'zone' | 'erase';

export interface DraftSummary {
  mode: 'build' | 'erase';
  /** Money the affordable part of the stroke will cost. */
  cost: number;
  tiles: number;
  truncated: boolean;
  /** Screen position for the cost label, already offset above the finger. */
  labelX: number;
  labelY: number;
}

export interface ToolEvents {
  /** Fired after an edit is committed, with the tiles that changed. */
  onBuilt?(tiles: readonly TilePoint[]): void;
  /** Fired when roads changed, so derived fields can be rebuilt. */
  onRoadsChanged?(): void;
  onChanged?(): void;
}

export class ToolController {
  private tool: ToolId = 'road';
  private roadKind: RoadKind = 'path';
  private zoneKind: ZoneKind = 'res';
  private brush: number = BRUSH_SIZES[1];
  private raw: TilePoint[] = [];
  private path: RoadPath | null = null;
  private painted: TilePoint[] = [];
  private roadEstimate: RoadEstimate | null = null;
  private zoneEstimate: ZoneEstimate | null = null;
  private dirty = false;
  private pointerScreen = { x: 0, y: 0 };
  private drawing = false;

  constructor(
    private readonly state: GameState,
    private readonly camera: Camera,
    private readonly undo: UndoStack,
    private readonly events: ToolEvents = {},
  ) {}

  get activeTool(): ToolId {
    return this.tool;
  }

  get activeRoadKind(): RoadKind {
    return this.roadKind;
  }

  get activeZoneKind(): ZoneKind {
    return this.zoneKind;
  }

  get brushSize(): number {
    return this.brush;
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  setTool(tool: ToolId): void {
    this.cancelStroke();
    this.tool = tool;
    this.events.onChanged?.();
  }

  setRoadKind(kind: RoadKind): boolean {
    if (!isRoadUnlocked(kind, this.state.era)) return false;
    this.roadKind = kind;
    this.tool = 'road';
    this.events.onChanged?.();
    return true;
  }

  setZoneKind(kind: ZoneKind): void {
    this.zoneKind = kind;
    this.tool = 'zone';
    this.events.onChanged?.();
  }

  setBrush(size: number): void {
    this.brush = size;
    this.events.onChanged?.();
  }

  // --- Stroke lifecycle ------------------------------------------------------

  strokeStart(screenX: number, screenY: number): void {
    if (this.tool === 'none') return;
    this.drawing = true;
    this.raw = [];
    this.addSample(screenX, screenY);
  }

  strokeMove(screenX: number, screenY: number): void {
    if (!this.drawing) return;
    this.addSample(screenX, screenY);
  }

  /** Commits the stroke. Returns the money spent. */
  strokeEnd(): number {
    if (!this.drawing) return 0;
    this.recompute();
    this.drawing = false;

    const spent = this.tool === 'zone' ? this.commitZone() : this.commitRoad();
    this.clearDraft();
    this.events.onChanged?.();
    return spent;
  }

  cancelStroke(): void {
    this.drawing = false;
    this.clearDraft();
  }

  undoLast(): boolean {
    const action = this.undo.undo(this.state);
    if (!action) return false;
    if (action.changes.some((change) => change.layer === 'road')) {
      this.events.onRoadsChanged?.();
    }
    this.events.onChanged?.();
    return true;
  }

  // --- Per-frame work --------------------------------------------------------

  /** Recomputes the stroke's tiles at most once per frame. */
  update(): void {
    if (this.dirty) this.recompute();
  }

  get draft(): DraftRender | null {
    if (this.tool === 'zone') {
      if (this.painted.length === 0) return null;
      return {
        polyline: [],
        tiles: this.painted,
        affordableTiles: this.zoneEstimate?.affordable ?? 0,
        kind: this.roadKind,
        mode: 'zone',
        zone: this.zoneKind,
      };
    }

    const path = this.path;
    if (!path || path.tiles.length === 0) return null;
    return {
      polyline: path.polyline,
      tiles: path.tiles,
      affordableTiles:
        this.tool === 'erase' ? path.tiles.length : (this.roadEstimate?.affordable ?? 0),
      kind: this.roadKind,
      mode: 'road',
      zone: null,
    };
  }

  get summary(): DraftSummary | null {
    const label = {
      labelX: this.pointerScreen.x,
      labelY: this.pointerScreen.y - COST_LABEL_OFFSET_PX,
    };

    if (this.tool === 'zone') {
      const estimate = this.zoneEstimate;
      if (!estimate || estimate.tiles.length === 0) return null;
      return {
        mode: 'build',
        cost: estimate.affordableCost,
        tiles: estimate.tiles.length,
        truncated: estimate.truncatedAt !== -1,
        ...label,
      };
    }

    const path = this.path;
    if (!path || path.tiles.length === 0) return null;
    return {
      mode: this.tool === 'erase' ? 'erase' : 'build',
      cost: this.tool === 'erase' ? 0 : (this.roadEstimate?.affordableCost ?? 0),
      tiles: path.tiles.length,
      truncated: this.roadEstimate !== null && this.roadEstimate.truncatedAt !== -1,
      ...label,
    };
  }

  // --- Internals -------------------------------------------------------------

  private commitRoad(): number {
    const path = this.path;
    if (!path || path.tiles.length === 0) return 0;

    const result =
      this.tool === 'erase'
        ? removeRoad(this.state.world, path.tiles)
        : buildRoad(this.state.world, path.tiles, this.roadKind, this.state.money);

    this.state.money -= result.spent;
    this.undo.push({ changes: result.changes, spent: result.spent });
    if (result.changes.length > 0) {
      this.events.onBuilt?.(result.changes.map((c) => ({ x: c.x, y: c.y })));
      this.events.onRoadsChanged?.();
    }
    return result.spent;
  }

  private commitZone(): number {
    if (this.painted.length === 0) return 0;

    const result = paintZone(this.state.world, this.painted, this.zoneKind, this.state.money);
    this.state.money -= result.spent;
    this.undo.push({ changes: result.changes, spent: result.spent });
    if (result.changes.length > 0) {
      this.events.onBuilt?.(result.changes.map((c) => ({ x: c.x, y: c.y })));
    }
    return result.spent;
  }

  private addSample(screenX: number, screenY: number): void {
    this.pointerScreen = { x: screenX, y: screenY };
    const world = this.camera.screenToWorld(screenX, screenY);
    this.raw.push({ x: world.x, y: world.y });
    this.dirty = true;
  }

  private recompute(): void {
    this.dirty = false;
    if (this.raw.length === 0) {
      this.clearDraft();
      return;
    }

    if (this.tool === 'zone') {
      const stamped = this.raw.map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
      }));
      this.painted = brushTiles(this.state.world, stamped, this.brush);
      this.zoneEstimate = estimateZone(
        this.state.world,
        this.painted,
        this.zoneKind,
        this.state.money,
      );
      return;
    }

    this.path = buildRoadPath(this.raw);
    this.roadEstimate =
      this.tool === 'erase'
        ? null
        : estimateRoad(this.state.world, this.path.tiles, this.roadKind, this.state.money);
  }

  private clearDraft(): void {
    this.raw = [];
    this.path = null;
    this.painted = [];
    this.roadEstimate = null;
    this.zoneEstimate = null;
    this.dirty = false;
  }
}
