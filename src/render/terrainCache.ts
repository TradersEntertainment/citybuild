import { PARCEL_SIZE, TILE_PX, ZOOM_LOD_BLOBS } from '../data/balance';
import { decodeTerrain } from '../sim/tiles';
import type { Era } from '../sim/tiles';
import { index, isParcelOwned, parcelOfTile, type World } from '../sim/world';
import type { Camera } from './camera';
import { drawTerrainMark, terrainColour } from './procedural';
import { hashUnit, styleForEra, wobble, type DrawStyle } from './style';

/**
 * Offscreen terrain cache (§17). Terrain is static, so it is painted once into
 * a padded offscreen canvas and blitted thereafter — panning costs one
 * drawImage instead of thousands of per-tile paths.
 *
 * The cache is rendered at a quantised zoom from a short ladder and scaled on
 * blit. Re-rendering at the exact live zoom would repaint every frame of a
 * pinch, which is precisely the moment the frame budget matters most.
 */
const ZOOM_LADDER = [0.35, 0.5, 0.75, 1, 1.5, 2, 3] as const;
/** Tiles of slack around the viewport, so small pans never repaint. */
const PADDING_TILES = 20;

interface CacheKey {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  zoom: number;
  era: Era;
  version: number;
}

export class TerrainCache {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private key: CacheKey | null = null;
  private worldVersion = 0;
  private lastRepaintMs = 0;

  /** Call when terrain changes (generation, terraforming) to force a repaint. */
  invalidate(): void {
    this.worldVersion += 1;
  }

  get lastRepaintDuration(): number {
    return this.lastRepaintMs;
  }

  /** Repaints if the camera has moved outside the cached area. */
  ensure(world: World, camera: Camera, era: Era): void {
    const zoom = quantiseZoom(camera.zoom);
    const view = camera.visibleTileRect();
    const want = {
      x0: Math.max(0, view.x0 - PADDING_TILES),
      y0: Math.max(0, view.y0 - PADDING_TILES),
      x1: Math.min(world.size, view.x1 + PADDING_TILES),
      y1: Math.min(world.size, view.y1 + PADDING_TILES),
    };

    if (this.covers(want, zoom, era)) return;
    this.repaint(world, want, zoom, era);
  }

  /** Draws the cached sheet at the camera's current position and zoom. */
  blit(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.canvas || !this.key) return;
    const origin = camera.worldToScreen(this.key.x0, this.key.y0);
    const scale = camera.zoom / this.key.zoom;
    ctx.drawImage(
      this.canvas,
      origin.x,
      origin.y,
      this.canvas.width * scale,
      this.canvas.height * scale,
    );
  }

  private covers(
    want: { x0: number; y0: number; x1: number; y1: number },
    zoom: number,
    era: Era,
  ): boolean {
    const key = this.key;
    if (!key) return false;
    return (
      key.zoom === zoom &&
      key.era === era &&
      key.version === this.worldVersion &&
      key.x0 <= want.x0 &&
      key.y0 <= want.y0 &&
      key.x1 >= want.x1 &&
      key.y1 >= want.y1
    );
  }

  private repaint(
    world: World,
    rect: { x0: number; y0: number; x1: number; y1: number },
    zoom: number,
    era: Era,
  ): void {
    const started = performance.now();
    const tilePx = TILE_PX * zoom;
    const width = Math.max(1, Math.ceil((rect.x1 - rect.x0) * tilePx));
    const height = Math.max(1, Math.ceil((rect.y1 - rect.y0) * tilePx));

    if (!this.canvas) this.canvas = document.createElement('canvas');
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx = null;
    }
    if (!this.ctx) {
      this.ctx = this.canvas.getContext('2d', { alpha: false });
    }
    const ctx = this.ctx;
    if (!ctx) return;

    const style = styleForEra(era);
    paintSheet(ctx, world, rect, tilePx, zoom, style);

    this.key = { ...rect, zoom, era, version: this.worldVersion };
    this.lastRepaintMs = performance.now() - started;
  }
}

function paintSheet(
  ctx: CanvasRenderingContext2D,
  world: World,
  rect: { x0: number; y0: number; x1: number; y1: number },
  tilePx: number,
  zoom: number,
  style: DrawStyle,
): void {
  ctx.fillStyle = style.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  paintTiles(ctx, world, rect, tilePx, style);

  // Texture only where it would be visible; below this zoom it is mud anyway.
  if (zoom >= ZOOM_LOD_BLOBS * 1.5) {
    const mark = { ctx, style, size: tilePx };
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const kind = decodeTerrain(world.terrain[index(world, x, y)] ?? 0);
        drawTerrainMark(mark, kind, x, y, (x - rect.x0) * tilePx, (y - rect.y0) * tilePx);
      }
    }
  }

  paintCoastline(ctx, world, rect, tilePx, style);
  paintGrid(ctx, rect, tilePx, zoom, style);
  paintFog(ctx, world, rect, tilePx);
}

/**
 * Ink along every land/water boundary. This one pass does more for the
 * cartographic identity than any amount of tile texture: without it the map is
 * coloured squares, with it the coastline is a drawn line on a sheet.
 */
function paintCoastline(
  ctx: CanvasRenderingContext2D,
  world: World,
  rect: { x0: number; y0: number; x1: number; y1: number },
  tilePx: number,
  style: DrawStyle,
): void {
  ctx.save();
  ctx.strokeStyle = style.rule;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(0.8, tilePx * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();

  const wet = (x: number, y: number): boolean =>
    decodeTerrain(world.terrain[index(world, x, y)] ?? 0) === 'water';

  // Same displacement the tile fills use, so the ink lands on the shore rather
  // than beside it.
  const jitter = cornerJitter(style, tilePx);
  const dx = (x: number, y: number): number => (hashUnit(x, y, 101) - 0.5) * 2 * jitter;
  const dy = (x: number, y: number): number => (hashUnit(x, y, 103) - 0.5) * 2 * jitter;

  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const here = wet(x, y);
      const sx = (x - rect.x0) * tilePx;
      const sy = (y - rect.y0) * tilePx;

      // Only the east and south edges are tested, so each boundary is inked
      // once rather than twice from both sides.
      if (x + 1 < world.size && wet(x + 1, y) !== here) {
        ctx.moveTo(sx + tilePx + dx(x + 1, y), sy + dy(x + 1, y));
        ctx.lineTo(sx + tilePx + dx(x + 1, y + 1), sy + tilePx + dy(x + 1, y + 1));
      }
      if (y + 1 < world.size && wet(x, y + 1) !== here) {
        ctx.moveTo(sx + dx(x, y + 1), sy + tilePx + dy(x, y + 1));
        ctx.lineTo(sx + tilePx + dx(x + 1, y + 1), sy + tilePx + dy(x + 1, y + 1));
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Fills every tile. In the hand-drawn eras the grid *vertices* are displaced by
 * a deterministic per-corner offset, so tiles become slightly irregular quads.
 *
 * The displacement has to be keyed on the corner, not the tile: neighbouring
 * tiles then agree on the corner they share, which keeps the fill watertight
 * while making region boundaries wander. Straight staircase edges are what make
 * a tile map look like a spreadsheet; this is the cheapest cure.
 */
function paintTiles(
  ctx: CanvasRenderingContext2D,
  world: World,
  rect: { x0: number; y0: number; x1: number; y1: number },
  tilePx: number,
  style: DrawStyle,
): void {
  const jitter = cornerJitter(style, tilePx);

  if (jitter <= 0.01) {
    // Technical eras draw true squares; overdraw by a hair so fractional tile
    // sizes do not leave seams.
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const i = index(world, x, y);
        ctx.fillStyle = terrainColour(
          decodeTerrain(world.terrain[i] ?? 0),
          world.height[i] ?? 0,
          world.fertility[i] ?? 0,
        );
        ctx.fillRect((x - rect.x0) * tilePx, (y - rect.y0) * tilePx, tilePx + 1, tilePx + 1);
      }
    }
    return;
  }

  // One row of corner offsets is reused as the next row's top edge, so each
  // corner is hashed once per repaint rather than four times.
  const width = rect.x1 - rect.x0 + 1;
  let top = cornerRow(rect.x0, rect.y0, width, jitter);
  let bottom = cornerRow(rect.x0, rect.y0 + 1, width, jitter);

  for (let y = rect.y0; y < rect.y1; y++) {
    const ty = (y - rect.y0) * tilePx;
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = index(world, x, y);
      const c = x - rect.x0;
      const tx = c * tilePx;
      ctx.fillStyle = terrainColour(
        decodeTerrain(world.terrain[i] ?? 0),
        world.height[i] ?? 0,
        world.fertility[i] ?? 0,
      );
      ctx.beginPath();
      ctx.moveTo(tx + (top[c * 2] as number), ty + (top[c * 2 + 1] as number));
      ctx.lineTo(tx + tilePx + (top[c * 2 + 2] as number), ty + (top[c * 2 + 3] as number));
      ctx.lineTo(
        tx + tilePx + (bottom[c * 2 + 2] as number),
        ty + tilePx + (bottom[c * 2 + 3] as number),
      );
      ctx.lineTo(tx + (bottom[c * 2] as number), ty + tilePx + (bottom[c * 2 + 1] as number));
      ctx.closePath();
      ctx.fill();
    }
    top = bottom;
    bottom = cornerRow(rect.x0, y + 2, width, jitter);
  }
}

/**
 * Corner displacement in device pixels. Scaled by tile size so the wobble is a
 * constant fraction of a tile at every zoom, and capped so a deep zoom does not
 * turn the sheet into torn paper.
 */
function cornerJitter(style: DrawStyle, tilePx: number): number {
  return style.jitter * Math.min(tilePx * 0.16, 5);
}

/** Interleaved [dx, dy] offsets for one row of grid corners. */
function cornerRow(x0: number, y: number, width: number, jitter: number): Float32Array {
  const row = new Float32Array((width + 1) * 2);
  for (let i = 0; i <= width; i++) {
    const x = x0 + i;
    row[i * 2] = (hashUnit(x, y, 101) - 0.5) * 2 * jitter;
    row[i * 2 + 1] = (hashUnit(x, y, 103) - 0.5) * 2 * jitter;
  }
  return row;
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  rect: { x0: number; y0: number; x1: number; y1: number },
  tilePx: number,
  zoom: number,
  style: DrawStyle,
): void {
  if (zoom >= ZOOM_LOD_BLOBS) {
    ctx.save();
    ctx.globalAlpha = style.ruleAlpha;
    ctx.strokeStyle = style.rule;
    ctx.lineWidth = style.ruleWidth;
    ctx.beginPath();
    for (let x = rect.x0; x <= rect.x1; x++) {
      const sx = (x - rect.x0) * tilePx + wobble(x, 0, style.jitter);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, ctx.canvas.height);
    }
    for (let y = rect.y0; y <= rect.y1; y++) {
      const sy = (y - rect.y0) * tilePx + wobble(0, y, style.jitter);
      ctx.moveTo(0, sy);
      ctx.lineTo(ctx.canvas.width, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = style.parcelRule;
  ctx.lineWidth = style.parcelWidth;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  const firstX = Math.ceil(rect.x0 / PARCEL_SIZE) * PARCEL_SIZE;
  const firstY = Math.ceil(rect.y0 / PARCEL_SIZE) * PARCEL_SIZE;
  for (let x = firstX; x <= rect.x1; x += PARCEL_SIZE) {
    const sx = (x - rect.x0) * tilePx;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, ctx.canvas.height);
  }
  for (let y = firstY; y <= rect.y1; y += PARCEL_SIZE) {
    const sy = (y - rect.y0) * tilePx;
    ctx.moveTo(0, sy);
    ctx.lineTo(ctx.canvas.width, sy);
  }
  ctx.stroke();
  ctx.restore();
}

/** Unowned parcels stay veiled (§4) — land you can see but not yet touch. */
function paintFog(
  ctx: CanvasRenderingContext2D,
  world: World,
  rect: { x0: number; y0: number; x1: number; y1: number },
  tilePx: number,
): void {
  ctx.save();
  ctx.fillStyle = '#97A2A6';
  ctx.globalAlpha = 0.62;
  const first = parcelOfTile(rect.x0, rect.y0);
  const last = parcelOfTile(rect.x1 - 1, rect.y1 - 1);
  for (let py = first.py; py <= last.py; py++) {
    for (let px = first.px; px <= last.px; px++) {
      if (isParcelOwned(world, px, py)) continue;
      ctx.fillRect(
        (px * PARCEL_SIZE - rect.x0) * tilePx,
        (py * PARCEL_SIZE - rect.y0) * tilePx,
        PARCEL_SIZE * tilePx,
        PARCEL_SIZE * tilePx,
      );
    }
  }
  ctx.restore();
}

function quantiseZoom(zoom: number): number {
  let best: number = ZOOM_LADDER[0] as number;
  let bestError = Infinity;
  for (const step of ZOOM_LADDER) {
    const error = Math.abs(Math.log(zoom / step));
    if (error < bestError) {
      bestError = error;
      best = step;
    }
  }
  return best;
}
