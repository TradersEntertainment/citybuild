import { BRUSH_SIZES, COST_LABEL_OFFSET_PX, TRANSIT_COST_PER_TILE } from '../data/balance';
import { isRoadUnlocked } from '../data/roads';
import { isPortUnlocked, type PortKind } from '../data/ports';
import { isServiceUnlocked, type ServiceKind } from '../data/services';
import { isUtilityUnlocked, type UtilityKind } from '../data/utilities';

import { demolishArea, didDemolish, isEmptyRemoval, touchedRoads } from '../sim/demolish';
import { isAttractionUnlocked, type AttractionKind } from '../data/attractions';
import { setOneWayAlong } from '../sim/oneWay';
import { buildRoad, estimateRoad, type RoadEstimate } from '../sim/roads';
import type { GameState } from '../sim/state';
import type { RoadKind, ZoneKind } from '../sim/tiles';
import { layTransit, transitUnlocked } from '../sim/transit';
import type { TileEdit, UndoStack } from '../sim/undo';
import { brushArea, brushTiles, estimateZone, paintZone, type ZoneEstimate } from '../sim/zoning';
import type { CameraRig } from '../render3d/cameraRig';
import type { DraftRender } from './draft';
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
/**
 * What the "service" tool is holding. Stations and plants are placed the same
 * way — a tap on owned ground — so they share one tool and one selection rather
 * than doubling the dock.
 */
export type FacilitySelection =
  | { type: 'service'; kind: ServiceKind }
  | { type: 'utility'; kind: UtilityKind }
  | { type: 'port'; kind: PortKind }
  | { type: 'attraction'; kind: AttractionKind };

export type ToolId = 'none' | 'road' | 'zone' | 'erase' | 'service' | 'transit';

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
  /** Fired when a station or plant was removed, so its mesh can go with it. */
  onFacilitiesChanged?(): void;
  /** A bus line went down; the caller confirms it. */
  onLaidTransit?(): void;
  /**
   * A stroke was refused, and why.
   *
   * The controller does not own any copy, so it reports the reason rather than
   * the sentence. What it must not do is stay quiet: a stroke that vanishes
   * without a word reads as a broken game, which is the rule the station
   * placement already keeps and the line drawing did not.
   */
  onRefused?(reason: TransitRefusal): void;
  onChanged?(): void;
}

export type TransitRefusal = 'locked' | 'tooDear' | 'tooShort';

export class ToolController {
  private tool: ToolId = 'road';
  private roadKind: RoadKind = 'path';
  private zoneKind: ZoneKind = 'res';
  private facility: FacilitySelection = { type: 'service', kind: 'fire' };
  private brush: number = BRUSH_SIZES[1];
  /**
   * Whether the next road stroke signs its street one-way.
   *
   * A toggle on the road tool rather than a tool of its own, and the direction
   * comes from the stroke: the player already drew the street the way they want
   * it to run, so asking them for a direction afterwards would be asking twice.
   * Drawing with it off clears any arrows on the tiles drawn over, which is how
   * a street is put back to two-way without a second verb.
   */
  private oneWay = false;
  /**
   * Whether the next zoning stroke buys height as well as permission.
   *
   * A switch on the zoning tool, exactly like the one-way switch on the road
   * tool, and for the same reason: the player is making one decision about what
   * a block is, not two. Painting with it off puts a block back to ordinary
   * streets — which is the only way to un-zone a downtown, and it has to exist
   * or the first mis-drawn tower is permanent.
   */
  private dense = false;
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
    private readonly camera: CameraRig,
    private readonly undo: UndoStack,
    private readonly events: ToolEvents = {},
  ) {}

  get activeTool(): ToolId {
    return this.tool;
  }

  get activeRoadKind(): RoadKind {
    return this.roadKind;
  }

  get oneWayArmed(): boolean {
    return this.oneWay;
  }

  setOneWay(on: boolean): void {
    this.oneWay = on;
    this.tool = 'road';
    this.events.onChanged?.();
  }

  get activeZoneKind(): ZoneKind {
    return this.zoneKind;
  }

  get denseArmed(): boolean {
    return this.dense;
  }

  setDense(on: boolean): void {
    this.dense = on;
    this.tool = 'zone';
    this.events.onChanged?.();
  }

  /** What the service tool will place: a civic station or a plant. */
  get activeFacility(): FacilitySelection {
    return this.facility;
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

  setFacility(selection: FacilitySelection): boolean {
    const unlocked =
      selection.type === 'service'
        ? isServiceUnlocked(selection.kind, this.state.era)
        : selection.type === 'utility'
          ? isUtilityUnlocked(selection.kind, this.state.era)
          : selection.type === 'attraction'
            ? isAttractionUnlocked(selection.kind, this.state.era)
            : isPortUnlocked(selection.kind, this.state.era);
    if (!unlocked) return false;
    this.facility = selection;
    this.tool = 'service';
    this.events.onChanged?.();
    return true;
  }

  setBrush(size: number): void {
    this.brush = size;
    this.events.onChanged?.();
  }

  // --- Stroke lifecycle ------------------------------------------------------

  strokeStart(screenX: number, screenY: number): void {
    // A station is placed with a tap, not dragged out, so the stroke machinery
    // stays out of its way entirely.
    if (this.tool === 'none' || this.tool === 'service') return;
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

    const spent =
      this.tool === 'zone'
        ? this.commitZone()
        : this.tool === 'erase'
          ? this.commitErase()
          : this.tool === 'transit'
            ? this.commitTransit()
            : this.commitRoad();
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
    if (touchedRoads(action.changes)) this.events.onRoadsChanged?.();
    // A facility just came back; its coverage and its mast have to come with it.
    if (!isEmptyRemoval(action.removed)) this.events.onFacilitiesChanged?.();
    this.events.onChanged?.();
    return true;
  }

  // --- Per-frame work --------------------------------------------------------

  /** Recomputes the stroke's tiles at most once per frame. */
  update(): void {
    if (this.dirty) this.recompute();
  }

  get draft(): DraftRender | null {
    if (this.tool === 'zone' || this.tool === 'erase') {
      if (this.painted.length === 0) return null;
      return {
        polyline: [],
        tiles: this.painted,
        // Nothing about an erase is unaffordable, so the whole sweep is drawn in
        // one colour rather than half of it flagged red.
        affordableTiles:
          this.tool === 'erase' ? this.painted.length : (this.zoneEstimate?.affordable ?? 0),
        kind: this.roadKind,
        mode: this.tool === 'erase' ? 'erase' : 'zone',
        zone: this.tool === 'erase' ? null : this.zoneKind,
      };
    }

    const path = this.path;
    if (!path || path.tiles.length === 0) return null;
    // A line is drawn as a road is: the ink says where it will run, and the
    // affordable count is what turns red when the money runs out.
    const affordable =
      this.tool === 'transit'
        ? Math.min(path.tiles.length, Math.floor(this.state.money / TRANSIT_COST_PER_TILE))
        : (this.roadEstimate?.affordable ?? 0);
    return {
      polyline: path.polyline,
      tiles: path.tiles,
      affordableTiles: affordable,
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

    if (this.tool === 'erase') {
      if (this.painted.length === 0) return null;
      return { mode: 'erase', cost: 0, tiles: this.painted.length, truncated: false, ...label };
    }

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
    if (this.tool === 'transit') {
      const cost = path.tiles.length * TRANSIT_COST_PER_TILE;
      return {
        mode: 'build',
        cost,
        tiles: path.tiles.length,
        truncated: cost > this.state.money,
        ...label,
      };
    }
    return {
      mode: 'build',
      cost: this.roadEstimate?.affordableCost ?? 0,
      tiles: path.tiles.length,
      truncated: this.roadEstimate !== null && this.roadEstimate.truncatedAt !== -1,
      ...label,
    };
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Erasing takes down every layer at once — pavement, zoning, whatever grew
   * there and whatever the player placed. Anything narrower means a player who
   * mis-paints a district finds it is permanent, which is the one outcome the
   * tool exists to prevent.
   */
  private commitErase(): number {
    if (this.painted.length === 0) return 0;

    const result = demolishArea(this.state, this.painted);
    // Demolition is free, but a knocked-down facility refunds — which arrives
    // here as negative spending, so undo reverses it by sign like everything else.
    this.state.money -= result.spent;
    if (!didDemolish(result)) return 0;

    this.undo.push({ changes: result.changes, spent: result.spent, removed: result.removed });
    this.events.onBuilt?.(result.changes.map((c) => ({ x: c.x, y: c.y })));
    if (touchedRoads(result.changes)) this.events.onRoadsChanged?.();
    // A line coming down changes what the roads have to carry, so the traffic
    // field is as stale as it is when a station goes.
    if (result.removed.transit.length > 0) this.events.onRoadsChanged?.();
    if (result.removed.services.length > 0 || result.removed.utilities.length > 0) {
      // Coverage is derived from the facilities that exist, so it is stale the
      // moment one comes down — and the mask is what buildings score against.
      this.events.onFacilitiesChanged?.();
    }
    return result.spent;
  }

  /**
   * Lays a bus line along the stroke.
   *
   * Shares the road tool's whole path pipeline — the same smoothing, the same
   * snapping, the same corner detection — because a line is drawn with the same
   * gesture and should feel identical under the finger. What differs is only what
   * the tiles become: nothing is paved, no ground is taken, and the stops fall
   * out of the shape rather than being placed one by one.
   *
   * Not undoable through the tile stack, for the same reason a fire station is
   * not: nothing here is a tile edit. It comes down with the eraser, at the same
   * refund every other facility gets.
   */
  private commitTransit(): number {
    const path = this.path;
    if (!path || path.tiles.length === 0) return 0;
    // Every refusal is spoken. A stroke that vanishes without a word is the
    // shape of bug the rest of this file is written to avoid — and there were
    // three of them here: locked, unaffordable, and too short to be a route.
    if (!transitUnlocked(this.state)) {
      this.events.onRefused?.('locked');
      return 0;
    }

    const cost = path.tiles.length * TRANSIT_COST_PER_TILE;
    if (cost > this.state.money) {
      this.events.onRefused?.('tooDear');
      return 0;
    }
    const line = layTransit(this.state, path.tiles);
    if (!line) {
      this.events.onRefused?.('tooShort');
      return 0;
    }

    this.state.money -= cost;
    // A line changes what the roads have to carry, so the traffic field is stale
    // the moment it is laid — the same invalidation a new road triggers.
    this.events.onRoadsChanged?.();
    this.events.onBuilt?.(line.stops.map((stop) => ({ x: stop.x, y: stop.y })));
    this.events.onLaidTransit?.();
    return cost;
  }

  private commitRoad(): number {
    const path = this.path;
    if (!path || path.tiles.length === 0) return 0;

    const result = buildRoad(this.state.world, path.tiles, this.roadKind, this.state.money);
    this.state.money -= result.spent;
    // Signing runs over the whole stroke, not only the tiles that were paid for:
    // drawing the same tier over your own street costs nothing (those tiles are
    // redundant) and is exactly how an existing street gets re-signed.
    const ways = setOneWayAlong(this.state.world, path.tiles, !this.oneWay);
    const changes: TileEdit[] = [
      ...result.changes,
      ...ways.map((edit) => ({ x: edit.x, y: edit.y, layer: 'oneWay' as const, previous: edit.previous })),
    ];
    this.undo.push({ changes, spent: result.spent });
    if (changes.length > 0) {
      this.events.onBuilt?.(changes.map((c) => ({ x: c.x, y: c.y })));
      this.events.onRoadsChanged?.();
    }
    return result.spent;
  }

  private commitZone(): number {
    if (this.painted.length === 0) return 0;

    const result = paintZone(
      this.state.world,
      this.painted,
      this.zoneKind,
      this.state.money,
      this.dense,
    );
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
        this.dense,
      );
      return;
    }

    this.path = buildRoadPath(this.raw);
    if (this.tool === 'erase') {
      // A tap is surgery, a drag is a sweep. Erasing used to widen every
      // stroke by the brush, so a tap on one bad tile bulldozed its neighbours
      // along with it — the "I only meant that one" failure. A stroke that
      // never leaves a tile and a half removes exactly the tile it lands on;
      // only a real drag earns the brush's width. Un-zonable ground counts
      // either way — a bridge stands on water.
      const first = this.raw[0]!;
      const last = this.raw[this.raw.length - 1]!;
      const span = Math.hypot(last.x - first.x, last.y - first.y);
      if (span < 1.5) {
        const x = Math.round(last.x);
        const y = Math.round(last.y);
        this.painted =
          x >= 0 && y >= 0 && x < this.state.world.size && y < this.state.world.size
            ? [{ x, y }]
            : [];
      } else {
        this.painted = brushArea(this.state.world, this.path.tiles, this.brush);
      }
      this.roadEstimate = null;
      return;
    }
    this.roadEstimate = estimateRoad(
      this.state.world,
      this.path.tiles,
      this.roadKind,
      this.state.money,
    );
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
