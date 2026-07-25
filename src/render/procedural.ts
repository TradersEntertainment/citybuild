import type { TerrainKind } from '../sim/tiles';
import { hashUnit, wobble, PALETTE, type DrawStyle } from './style';

/**
 * Every mark on the map is drawn here, from code (§0.5). No sprites, no icon
 * packs, no image files — the art direction *is* the constraint.
 *
 * Marks are deterministic per tile: the same tile always draws the same tree
 * in the same spot, so panning does not make the forest shimmer.
 */
const TERRAIN_BASE: Record<TerrainKind, string> = {
  water: PALETTE.cobalt,
  marsh: '#5E7A70',
  plain: PALETTE.parchment,
  forest: PALETTE.moss,
  hill: '#C9B996',
  rock: '#9A9689',
};

/** Base colour for a tile, shaded by height so relief reads without contours. */
export function terrainColour(kind: TerrainKind, height: number, fertility: number): string {
  const base = TERRAIN_BASE[kind];
  if (kind === 'water') {
    // Deeper water is darker; shallows pick out the coastline for free.
    const depth = clamp01((0.42 - height) / 0.42);
    return mix(PALETTE.cobalt, '#12313F', depth * 0.8);
  }
  if (kind === 'plain') {
    // Fertile plains lean green, dry ones stay parchment.
    return mix(base, PALETTE.moss, fertility * 0.28);
  }
  const relief = clamp01((height - 0.42) / 0.5);
  return mix(base, PALETTE.ink, relief * 0.16);
}

export interface MarkContext {
  ctx: CanvasRenderingContext2D;
  style: DrawStyle;
  /** Tile size in device pixels within the cache. */
  size: number;
}

/**
 * Texture pass for one tile. Skipped entirely below the detail zoom, which is
 * what keeps a zoomed-out map cheap as well as legible.
 */
export function drawTerrainMark(
  mark: MarkContext,
  kind: TerrainKind,
  tileX: number,
  tileY: number,
  screenX: number,
  screenY: number,
): void {
  switch (kind) {
    case 'forest':
      drawTrees(mark, tileX, tileY, screenX, screenY);
      break;
    case 'hill':
      drawHatch(mark, tileX, tileY, screenX, screenY);
      break;
    case 'rock':
      drawRubble(mark, tileX, tileY, screenX, screenY);
      break;
    case 'water':
      drawRipple(mark, tileX, tileY, screenX, screenY);
      break;
    case 'marsh':
      drawReeds(mark, tileX, tileY, screenX, screenY);
      break;
    case 'plain':
      drawTuft(mark, tileX, tileY, screenX, screenY);
      break;
    default:
      break;
  }
}

function drawTrees(m: MarkContext, tx: number, ty: number, x: number, y: number): void {
  const { ctx, size } = m;
  // Density varies tile to tile: a canopy at a constant two crowns per tile
  // reads as wallpaper, not woodland.
  const density = hashUnit(tx, ty, 3);
  const count = density > 0.72 ? 3 : density > 0.3 ? 2 : 1;

  for (let i = 0; i < count; i++) {
    const ox = 0.2 + hashUnit(tx + i * 13, ty, 11) * 0.6;
    const oy = 0.2 + hashUnit(tx, ty + i * 17, 23) * 0.6;
    const r = size * (0.13 + hashUnit(tx + i, ty + i, 31) * 0.1);
    // Slight tonal drift between crowns gives the canopy depth for free.
    ctx.fillStyle = hashUnit(tx + i, ty, 41) > 0.5 ? '#3F5B35' : '#4C6B40';
    ctx.beginPath();
    ctx.arc(x + ox * size, y + oy * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHatch(m: MarkContext, tx: number, ty: number, x: number, y: number): void {
  const { ctx, size } = m;
  // Not every hill tile is hatched; gaps are what make it look drawn.
  if (hashUnit(tx, ty, 5) < 0.35) return;

  ctx.strokeStyle = 'rgba(22, 35, 46, 0.16)';
  ctx.lineWidth = Math.max(0.5, size * 0.04);
  ctx.beginPath();
  const lean = (hashUnit(tx, ty, 7) - 0.5) * 0.5;
  const count = hashUnit(tx, ty, 13) > 0.6 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const oy = y + size * (0.28 + i * 0.36 + (hashUnit(tx, ty + i, 17) - 0.5) * 0.14);
    const inset = size * (0.1 + hashUnit(tx + i, ty, 19) * 0.2);
    ctx.moveTo(x + inset, oy);
    ctx.lineTo(x + size - inset, oy + size * lean);
  }
  ctx.stroke();
}

function drawRubble(m: MarkContext, tx: number, ty: number, x: number, y: number): void {
  const { ctx, size } = m;
  if (hashUnit(tx, ty, 29) < 0.3) return;

  ctx.fillStyle = 'rgba(22, 35, 46, 0.28)';
  const count = hashUnit(tx, ty, 37) > 0.55 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const ox = 0.15 + hashUnit(tx + i * 29, ty, 43) * 0.7;
    const oy = 0.15 + hashUnit(tx, ty + i * 31, 47) * 0.7;
    const s = size * (0.08 + hashUnit(tx + i, ty + i, 53) * 0.09);
    ctx.save();
    ctx.translate(x + ox * size, y + oy * size);
    ctx.rotate(hashUnit(tx + i, ty, 59) * Math.PI);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

/** Sparse tufts keep open ground from reading as flat paint. */
function drawTuft(m: MarkContext, tx: number, ty: number, x: number, y: number): void {
  const { ctx, size } = m;
  if (hashUnit(tx, ty, 61) < 0.86) return;

  ctx.strokeStyle = 'rgba(86, 120, 74, 0.35)';
  ctx.lineWidth = Math.max(0.5, size * 0.045);
  ctx.beginPath();
  const ox = x + size * (0.25 + hashUnit(tx, ty, 67) * 0.5);
  const oy = y + size * (0.4 + hashUnit(tx, ty, 71) * 0.4);
  ctx.moveTo(ox - size * 0.12, oy);
  ctx.lineTo(ox, oy - size * 0.16);
  ctx.lineTo(ox + size * 0.12, oy);
  ctx.stroke();
}

function drawRipple(m: MarkContext, tx: number, ty: number, x: number, y: number): void {
  const { ctx, size } = m;
  // Sparse: ripples on every water tile turn the sea into corduroy.
  if (wobble(tx, ty, 1) < 0.45) return;
  ctx.strokeStyle = 'rgba(230, 218, 194, 0.20)';
  ctx.lineWidth = Math.max(0.5, size * 0.045);
  ctx.beginPath();
  const oy = y + size * (0.5 + wobble(tx, ty, 0.22));
  ctx.moveTo(x + size * 0.2, oy);
  ctx.quadraticCurveTo(x + size * 0.5, oy - size * 0.14, x + size * 0.8, oy);
  ctx.stroke();
}

function drawReeds(m: MarkContext, tx: number, ty: number, x: number, y: number): void {
  const { ctx, size } = m;
  ctx.strokeStyle = 'rgba(86, 120, 74, 0.5)';
  ctx.lineWidth = Math.max(0.5, size * 0.05);
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const ox = x + size * (0.3 + i * 0.35 + wobble(tx + i, ty, 0.08));
    ctx.moveTo(ox, y + size * 0.75);
    ctx.lineTo(ox + size * wobble(tx, ty + i, 0.12), y + size * 0.35);
  }
  ctx.stroke();
}

// --- Colour helpers ----------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = clamp01(t);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

const hexCache = new Map<string, [number, number, number]>();

function parseHex(hex: string): [number, number, number] {
  const cached = hexCache.get(hex);
  if (cached) return cached;
  const value = Number.parseInt(hex.slice(1), 16);
  const rgb: [number, number, number] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  hexCache.set(hex, rgb);
  return rgb;
}
