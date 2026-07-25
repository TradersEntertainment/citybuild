import type { RoadKind, ZoneKind } from '../sim/tiles';
import type { TilePoint } from './pathGeometry';

/**
 * The stroke in progress, as the tool layer sees it and any renderer can draw
 * it. It lives here rather than beside a drawing routine because the tool owns
 * it and the presentation is free to change — the flat map and the 3D city read
 * the same draft.
 */
export interface DraftRender {
  polyline: readonly TilePoint[];
  /** Tiles the balance covers; the rest is drawn as unaffordable. */
  affordableTiles: number;
  tiles: readonly TilePoint[];
  kind: RoadKind;
  mode: 'road' | 'zone' | 'erase';
  /** Zone being painted, when mode is 'zone'. */
  zone: ZoneKind | null;
}
