import { TILE_PX, ZOOM_MAX, ZOOM_MIN } from '../data/balance';

/**
 * Screen ↔ world transform. Pure maths — the camera holds no canvas reference,
 * so it is unit-testable and the pinch logic can be verified without a DOM.
 *
 * World units are tiles. Screen units are CSS pixels (the DPR scale lives in
 * the renderer, not here).
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  /** World-space tile coordinate shown at the centre of the viewport. */
  x = 0;
  y = 0;
  zoom = 1;
  viewportWidth = 1;
  viewportHeight = 1;
  private bounds: CameraBounds | null = null;

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.clampToBounds();
  }

  /** Keeps the camera centre inside the world so the map cannot be lost. */
  setBounds(bounds: CameraBounds | null): void {
    this.bounds = bounds;
    this.clampToBounds();
  }

  centreOn(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clampToBounds();
  }

  /** Pixels per tile at the current zoom. */
  get scale(): number {
    return TILE_PX * this.zoom;
  }

  worldToScreen(worldX: number, worldY: number): Vec2 {
    const s = this.scale;
    return {
      x: (worldX - this.x) * s + this.viewportWidth / 2,
      y: (worldY - this.y) * s + this.viewportHeight / 2,
    };
  }

  screenToWorld(screenX: number, screenY: number): Vec2 {
    const s = this.scale;
    return {
      x: (screenX - this.viewportWidth / 2) / s + this.x,
      y: (screenY - this.viewportHeight / 2) / s + this.y,
    };
  }

  /** Drag the map by a screen-space delta (two-finger pan). */
  panByScreen(dx: number, dy: number): void {
    const s = this.scale;
    this.x -= dx / s;
    this.y -= dy / s;
    this.clampToBounds();
  }

  /**
   * Zoom while keeping the world point under `anchor` pinned to that screen
   * position — the behaviour a pinch has to have to feel physical.
   */
  zoomAt(anchorScreenX: number, anchorScreenY: number, factor: number): void {
    const before = this.screenToWorld(anchorScreenX, anchorScreenY);
    this.setZoom(this.zoom * factor);
    const after = this.screenToWorld(anchorScreenX, anchorScreenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToBounds();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  }

  /** Visible world rectangle, in tiles, for viewport culling (§17). */
  visibleTileRect(): { x0: number; y0: number; x1: number; y1: number } {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.viewportWidth, this.viewportHeight);
    return {
      x0: Math.floor(topLeft.x),
      y0: Math.floor(topLeft.y),
      x1: Math.ceil(bottomRight.x),
      y1: Math.ceil(bottomRight.y),
    };
  }

  private clampToBounds(): void {
    if (!this.bounds) return;
    const { minX, minY, maxX, maxY } = this.bounds;
    this.x = Math.min(maxX, Math.max(minX, this.x));
    this.y = Math.min(maxY, Math.max(minY, this.y));
  }
}
