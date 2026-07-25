import { INK_DRY_MS } from '../../data/balance';
import type { TilePoint } from '../../input/pathGeometry';
import { ZONE_TINTS } from '../../data/buildings';
import { decodeRoad, NONE, type RoadKind, type ZoneKind } from '../../sim/tiles';
import { index, inBounds, type World } from '../../sim/world';
import type { Camera } from '../camera';
import { PALETTE, type DrawStyle } from '../style';

/**
 * Roads are stroked along their centreline rather than filled per tile: a road
 * built from squares reads as a staircase, a stroked line reads as a road. The
 * tile grid stays the data model; this is presentation.
 */
interface RoadLook {
  /** Stroke width as a fraction of a tile. */
  width: number;
  colour: string;
  /** Casing drawn under the road, giving it an edge against the terrain. */
  casing: string | null;
  dashed: boolean;
  /** Boulevards get a median line down the middle. */
  median: boolean;
}

const LOOKS: Record<RoadKind, RoadLook> = {
  path: { width: 0.3, colour: '#B9A57E', casing: null, dashed: false, median: false },
  stone: { width: 0.38, colour: '#A9A190', casing: '#7C7365', dashed: false, median: false },
  asphalt: { width: 0.46, colour: '#4A5158', casing: '#2E353B', dashed: false, median: false },
  boulevard: { width: 0.78, colour: '#4A5158', casing: '#2E353B', dashed: false, median: true },
  highway: { width: 0.62, colour: '#3B4249', casing: '#22282D', dashed: false, median: true },
  metro: { width: 0.34, colour: PALETTE.cobalt, casing: null, dashed: true, median: false },
};

const NEIGHBOURS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

/**
 * A diagonal link is only drawn when the two tiles are not already joined by an
 * orthogonal pair. On a staircase every tile touches its diagonal neighbour as
 * well as its side neighbours, and stroking all three fills the corner with a
 * little triangle — which is what makes a tile-drawn road look chewed.
 */
function shouldLink(
  world: World,
  x: number,
  y: number,
  dx: number,
  dy: number,
): boolean {
  if (!inBounds(world, x + dx, y + dy)) return false;
  if (!decodeRoad(world.road[index(world, x + dx, y + dy)] ?? NONE)) return false;
  if (dx === 0 || dy === 0) return true;

  const sideA = inBounds(world, x + dx, y) && decodeRoad(world.road[index(world, x + dx, y)] ?? NONE);
  const sideB = inBounds(world, x, y + dy) && decodeRoad(world.road[index(world, x, y + dy)] ?? NONE);
  return !sideA && !sideB;
}

export function drawRoads(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  style: DrawStyle,
): void {
  const view = camera.visibleTileRect();
  const x0 = Math.max(0, view.x0 - 1);
  const y0 = Math.max(0, view.y0 - 1);
  const x1 = Math.min(world.size, view.x1 + 1);
  const y1 = Math.min(world.size, view.y1 + 1);
  const scale = camera.scale;

  // Two passes so every casing sits under every surface; interleaving them
  // makes junctions look chipped.
  for (const pass of ['casing', 'surface'] as const) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const kind = decodeRoad(world.road[index(world, x, y)] ?? NONE);
        if (!kind) continue;
        const look = LOOKS[kind];
        const colour = pass === 'casing' ? look.casing : look.colour;
        if (!colour) continue;

        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(1, scale * look.width * (pass === 'casing' ? 1.28 : 1));
        ctx.setLineDash(look.dashed ? [scale * 0.5, scale * 0.35] : []);
        ctx.beginPath();
        traceTile(ctx, world, camera, x, y, scale);
        ctx.stroke();

        if (look.median && pass === 'surface' && scale > 10) {
          drawMedian(ctx, world, camera, x, y, scale);
        }
      }
    }
    ctx.restore();
  }

  void style;
}

/**
 * Draws one tile's share of the road: from the midpoint of each shared edge to
 * the tile centre. Every edge is therefore drawn twice, once as each tile's
 * half, and the halves meet exactly — so no connection is doubled up and no
 * junction is stitched from overlapping full-length strokes.
 *
 * A tile with exactly two links curves through its centre instead of turning a
 * hard corner there. Rasterising a shallow curve alternates diagonal and
 * orthogonal steps, and drawn as straight centre-to-centre segments those steps
 * read as a staircase; bending through the centre is what turns the same tiles
 * back into a road.
 */
function traceTile(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  x: number,
  y: number,
  scale: number,
): void {
  const centre = camera.worldToScreen(x + 0.5, y + 0.5);
  const midpoints: { x: number; y: number }[] = [];

  for (const [dx, dy] of NEIGHBOURS) {
    if (!shouldLink(world, x, y, dx, dy)) continue;
    midpoints.push(camera.worldToScreen(x + 0.5 + dx / 2, y + 0.5 + dy / 2));
  }

  if (midpoints.length === 0) {
    // A lone tile still has to be visible.
    ctx.moveTo(centre.x - scale * 0.18, centre.y);
    ctx.lineTo(centre.x + scale * 0.18, centre.y);
    return;
  }

  if (midpoints.length === 2) {
    const [a, b] = midpoints as [{ x: number; y: number }, { x: number; y: number }];
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(centre.x, centre.y, b.x, b.y);
    return;
  }

  for (const midpoint of midpoints) {
    ctx.moveTo(centre.x, centre.y);
    ctx.lineTo(midpoint.x, midpoint.y);
  }
}

function drawMedian(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  x: number,
  y: number,
  scale: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(230, 218, 194, 0.55)';
  ctx.lineWidth = Math.max(0.8, scale * 0.05);
  ctx.setLineDash([scale * 0.3, scale * 0.3]);
  ctx.beginPath();
  traceTile(ctx, world, camera, x, y, scale);
  ctx.stroke();
  ctx.restore();
}

// --- Draft (the wet ink under the finger) ------------------------------------

export interface DraftRender {
  polyline: readonly TilePoint[];
  /** Tiles the balance covers; the rest is drawn as unaffordable. */
  affordableTiles: number;
  tiles: readonly TilePoint[];
  kind: RoadKind;
  mode: 'road' | 'zone';
  /** Zone being painted, when mode is 'zone'. */
  zone: ZoneKind | null;
}

/**
 * The live stroke (§5.1): ink that flows under the finger. The unaffordable
 * tail turns red so the player sees the wall before they hit it, and it is
 * drawn as part of the same line rather than as a warning elsewhere on screen.
 */
export function drawDraft(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  draft: DraftRender,
): void {
  if (draft.mode === 'zone') {
    drawZoneDraft(ctx, camera, draft);
    return;
  }
  if (draft.polyline.length === 0) return;
  const scale = camera.scale;
  const look = LOOKS[draft.kind];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = Math.max(2, scale * look.width * 1.1);
  ctx.beginPath();
  const first = camera.worldToScreen(
    (draft.polyline[0] as TilePoint).x + 0.5,
    (draft.polyline[0] as TilePoint).y + 0.5,
  );
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < draft.polyline.length; i++) {
    const point = draft.polyline[i] as TilePoint;
    const screen = camera.worldToScreen(point.x + 0.5, point.y + 0.5);
    ctx.lineTo(screen.x, screen.y);
  }
  ctx.stroke();
  ctx.restore();

  // The tail the player cannot pay for.
  if (draft.affordableTiles < draft.tiles.length) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = PALETTE.brick;
    for (let i = draft.affordableTiles; i < draft.tiles.length; i++) {
      const tile = draft.tiles[i] as TilePoint;
      const screen = camera.worldToScreen(tile.x + 0.5, tile.y + 0.5);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(1.5, scale * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * The zone brush under the finger. Painted tiles are shown filled rather than
 * outlined so the player can see the shape of the district taking form, and
 * the unaffordable tail is hatched in brick the same way a road's is dotted.
 */
function drawZoneDraft(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  draft: DraftRender,
): void {
  if (!draft.zone || draft.tiles.length === 0) return;
  const scale = camera.scale;

  ctx.save();
  for (let i = 0; i < draft.tiles.length; i++) {
    const tile = draft.tiles[i] as TilePoint;
    const screen = camera.worldToScreen(tile.x, tile.y);
    const affordable = i < draft.affordableTiles;
    ctx.globalAlpha = affordable ? 0.55 : 0.4;
    ctx.fillStyle = affordable ? ZONE_TINTS[draft.zone] : PALETTE.brick;
    ctx.fillRect(screen.x, screen.y, scale + 1, scale + 1);
  }
  ctx.restore();
}


// --- Ink drying (build confirmation) -----------------------------------------

export interface InkDryEffect {
  tiles: readonly TilePoint[];
  startedAt: number;
}

/** 250 ms of ink settling into the paper — the receipt for a built road. */
export function drawInkDry(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  effects: readonly InkDryEffect[],
  now: number,
): void {
  const scale = camera.scale;
  ctx.save();
  for (const effect of effects) {
    const t = (now - effect.startedAt) / INK_DRY_MS;
    if (t < 0 || t > 1) continue;
    ctx.globalAlpha = (1 - t) * 0.55;
    ctx.fillStyle = PALETTE.ink;
    for (const tile of effect.tiles) {
      const screen = camera.worldToScreen(tile.x + 0.5, tile.y + 0.5);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, scale * (0.2 + t * 0.34), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
