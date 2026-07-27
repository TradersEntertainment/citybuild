import { DENSE_LEVEL_CAP, ZONE_LEVEL_CAP } from '../data/balance';
import { isBuiltZone } from '../data/buildings';
import {
  FACILITY_LOOKS,
  ROAD_MARKED,
  ROAD_MARKING,
  ROAD_SURFACE,
  type FacilityKind,
} from '../data/looks';
import { archetypeFor, periodOf } from '../render3d/archetypes';
import type { Era, RoadKind, ZoneKind } from '../sim/tiles';

/**
 * Menu cards: a portrait of the thing the row builds, drawn from the same spec
 * the map draws it with.
 *
 * Every colour and proportion here comes out of data/looks.ts and the
 * archetype tables — the karakol on the card is pale grey with a navy stripe
 * because the karakol on the map is, and neither can drift without the other,
 * because there is only one table. That is the entire idea: no icon set, no
 * asset files (the project rule since §0.5), and a menu that cannot promise
 * something the map will not deliver.
 *
 * Two consequences worth naming, both free:
 * - **Zone cards age with the city.** The housing card shows the archetype of
 *   the *current* era — a tiled cottage at the founding, a windowed block in
 *   the modern period — because the card asks archetypeFor() exactly as the
 *   building layer does.
 * - **The density switch finally shows its goods**: the Normal card draws the
 *   level the suburb tops out at, the Yoğun card the tower, straight from the
 *   ZONE_LEVEL_CAP / DENSE_LEVEL_CAP pair the growth pass enforces.
 *
 * Everything is canvas 2D, drawn once and cached: a sheet re-render costs a
 * Map lookup, not a repaint.
 */
const SIZE = 88; // backing pixels for a 44px card — crisp on a 2× phone screen
const GROUND = 0.82; // where the ground line sits, as a fraction of the card

const cache = new Map<string, HTMLCanvasElement>();

/** A civic building, plant or berth, from FACILITY_LOOKS. */
export function facilityCard(kind: FacilityKind): HTMLCanvasElement {
  return cached(`f:${kind}`, (g) => {
    const look = FACILITY_LOOKS[kind];
    const w = Math.min(70, look.width * 66);
    const h = Math.max(9, look.height * 74);
    const cx = SIZE / 2;
    const base = SIZE * GROUND;
    shadow(g, cx, w);
    g.fillStyle = look.body;
    g.fillRect(cx - w / 2, base - h, w, h);
    g.fillStyle = shade(look.body, 0.72);
    g.fillRect(cx - w / 2, base - h, w, 4);
    // The accent band — the stripe that identifies the service on the map.
    g.fillStyle = look.accent;
    g.fillRect(cx - w / 2, base - Math.max(6, h * 0.38), w, 5);
    g.fillStyle = shade(look.body, 0.5);
    g.fillRect(cx - 5, base - 14, 10, 14);
    if (look.mast > 0) {
      // Clamped so a power-station chimney stays inside the card; the map is
      // where it gets to be the tallest thing for miles.
      const mast = Math.min(look.mast * 38, SIZE * GROUND - h - 6);
      g.fillStyle = look.accent;
      g.fillRect(cx + w / 2 - 8, base - h - mast, 3, mast);
      g.beginPath();
      g.arc(cx + w / 2 - 6.5, base - h - mast - 2, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/**
 * What this zoning grows: the era's own archetype at the level the ground
 * permits — the whole suburb-or-downtown decision, as two pictures.
 */
export function zoneCard(kind: ZoneKind, era: Era, dense: boolean): HTMLCanvasElement {
  if (kind === 'farm') return cached('z:farm', drawFarm);
  if (kind === 'park') return cached('z:park', drawPark);
  return cached(`z:${kind}:${periodOf(era)}:${dense}`, (g) => {
    if (!isBuiltZone(kind)) return;
    const level = dense ? DENSE_LEVEL_CAP : ZONE_LEVEL_CAP;
    const spec = archetypeFor(periodOf(era), kind, level);
    const w = Math.max(18, spec.footprint * 54);
    const h = Math.min(SIZE * GROUND - 10, 12 + spec.height * 13);
    const cx = SIZE / 2;
    const base = SIZE * GROUND;
    shadow(g, cx, w);
    g.fillStyle = spec.facade.wall;
    g.fillRect(cx - w / 2, base - h, w, h);
    // The real facade grid, capped so a 42-row curtain wall still reads as
    // windows at 44 pixels rather than as noise.
    const cols = Math.min(spec.facade.columns, 5);
    const rows = Math.min(spec.facade.rows, 9);
    const cw = w / cols;
    const ch = h / rows;
    g.fillStyle = spec.facade.glass;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        g.fillRect(cx - w / 2 + c * cw + cw * 0.22, base - h + r * ch + ch * 0.24, cw * 0.56, ch * 0.5);
      }
    }
    if (spec.roofPitch > 0) {
      g.fillStyle = spec.roof;
      g.beginPath();
      g.moveTo(cx - w / 2 - 3, base - h);
      g.lineTo(cx, base - h - 12);
      g.lineTo(cx + w / 2 + 3, base - h);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = spec.roof;
      g.fillRect(cx - w / 2, base - h, w, 3.5);
    }
  });
}

/** A stretch of the tier's own carriageway, markings and all. */
export function roadCard(kind: RoadKind): HTMLCanvasElement {
  return cached(`r:${kind}`, (g) => {
    const y = SIZE * 0.56;
    const height = 26;
    g.fillStyle = ROAD_SURFACE[kind];
    g.fillRect(6, y - height / 2, SIZE - 12, height);
    if (ROAD_MARKED.has(kind)) {
      g.fillStyle = ROAD_MARKING;
      for (let x = 10; x < SIZE - 14; x += 16) g.fillRect(x, y - 1.2, 9, 2.4);
    } else {
      // A dirt track's edge is what tells it apart from a smear.
      g.fillStyle = shade(ROAD_SURFACE[kind], 0.7);
      g.fillRect(6, y - height / 2, SIZE - 12, 2);
      g.fillRect(6, y + height / 2 - 2, SIZE - 12, 2);
    }
  });
}

/** The bus and its stop, for the line tool. */
export function transitCard(): HTMLCanvasElement {
  return cached('t:bus', (g) => {
    const base = SIZE * GROUND;
    shadow(g, SIZE * 0.6, 40);
    g.fillStyle = '#2C6E8C';
    g.fillRect(SIZE * 0.32, base - 26, 44, 22);
    g.fillStyle = '#9FC4D4';
    for (let i = 0; i < 4; i++) g.fillRect(SIZE * 0.32 + 4 + i * 10, base - 22, 7, 8);
    g.fillStyle = '#101820';
    g.beginPath();
    g.arc(SIZE * 0.32 + 10, base - 3, 4.5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(SIZE * 0.32 + 34, base - 3, 4.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#C8CBD0';
    g.fillRect(SIZE * 0.16, base - 44, 3, 44);
    g.fillStyle = '#C08A2E';
    g.fillRect(SIZE * 0.16 - 7, base - 52, 17, 12);
  });
}

function drawFarm(g: CanvasRenderingContext2D): void {
  const base = SIZE * GROUND;
  // Furrows: alternating strips read as worked land from any height.
  for (let r = 0; r < 4; r++) {
    g.fillStyle = r % 2 === 0 ? '#8C9A4A' : '#77843C';
    g.fillRect(10, base - 34 + r * 8, SIZE - 20, 7);
  }
  g.fillStyle = '#6B5A38';
  g.fillRect(10, base + 2, SIZE - 20, 3);
}

function drawPark(g: CanvasRenderingContext2D): void {
  const base = SIZE * GROUND;
  g.fillStyle = '#56784A';
  g.fillRect(10, base - 30, SIZE - 20, 30);
  for (const [tx, s] of [
    [SIZE * 0.34, 1],
    [SIZE * 0.62, 0.8],
  ] as const) {
    g.fillStyle = '#4E4030';
    g.fillRect(tx - 1.5, base - 18 * s, 3, 18 * s);
    g.fillStyle = '#3E6B3A';
    g.beginPath();
    g.arc(tx, base - 22 * s, 9 * s, 0, Math.PI * 2);
    g.fill();
  }
}

/** Draws once per key; a rebuilt sheet gets the same canvas back. */
function cached(key: string, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const found = cache.get(key);
  if (found) return found;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.className = 'card';
  const g = canvas.getContext('2d');
  if (g) {
    background(g);
    draw(g);
  }
  cache.set(key, canvas);
  return canvas;
}

/** Sky wash and ground line: every card is a thing standing on land. */
function background(g: CanvasRenderingContext2D): void {
  const sky = g.createLinearGradient(0, 0, 0, SIZE);
  sky.addColorStop(0, '#27394A');
  sky.addColorStop(0.75, '#1B2A37');
  g.fillStyle = sky;
  g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = '#223026';
  g.fillRect(0, SIZE * GROUND, SIZE, SIZE * (1 - GROUND));
  g.strokeStyle = 'rgba(230, 218, 194, 0.15)';
  g.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
}

function shadow(g: CanvasRenderingContext2D, cx: number, width: number): void {
  g.fillStyle = 'rgba(0, 0, 0, 0.3)';
  g.beginPath();
  g.ellipse(cx, SIZE * GROUND, width * 0.55, 3.5, 0, 0, Math.PI * 2);
  g.fill();
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (((n >> 16) & 255) * factor) | 0;
  const g = (((n >> 8) & 255) * factor) | 0;
  const b = ((n & 255) * factor) | 0;
  return `rgb(${r},${g},${b})`;
}
