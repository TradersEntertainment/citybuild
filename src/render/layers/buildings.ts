import { ZOOM_LOD_BLOBS, ZOOM_LOD_BLOCKS } from '../../data/balance';
import { BUILDING_LOOKS, ZONE_TINTS, type BuildingLook } from '../../data/buildings';
import type { Building } from '../../sim/buildings';
import type { GameState } from '../../sim/state';
import { decodeZone, ISSUE, NONE } from '../../sim/tiles';
import { index } from '../../sim/world';
import type { Camera } from '../camera';
import { hashUnit, PALETTE } from '../style';

/**
 * Buildings as map marks, not models (§14.1). A building is drawn as a small
 * plan: a footprint, a darker cap, and window rows that only appear once there
 * is room for them. Level shows as footprint and detail, which is why a district
 * levelling up is visible from across the map rather than one tile at a time.
 *
 * Detail is dropped by zoom (§14.5): masses below 1.0×, then colour patches
 * below 0.5×. Drawing five levels of window grid at 0.35× costs the frame
 * budget and buys the player nothing.
 */
export function drawZones(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
): void {
  const view = camera.visibleTileRect();
  const world = state.world;
  const x0 = Math.max(0, view.x0);
  const y0 = Math.max(0, view.y0);
  const x1 = Math.min(world.size, view.x1);
  const y1 = Math.min(world.size, view.y1);
  const scale = camera.scale;

  // Hatching, not a flat wash: a zone is a marked intention on a survey sheet,
  // and a solid fill reads as something already built there.
  const hatched = scale > 5;
  ctx.save();
  ctx.lineWidth = Math.max(0.7, scale * 0.07);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = index(world, x, y);
      const zone = decodeZone(world.zone[i] ?? NONE);
      if (!zone) continue;
      // A zoned tile that has grown something is described by the building.
      if ((world.building[i] ?? 0) !== 0) continue;

      const screen = camera.worldToScreen(x, y);
      if (!hatched) {
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = ZONE_TINTS[zone];
        ctx.fillRect(screen.x, screen.y, scale + 1, scale + 1);
        continue;
      }

      ctx.globalAlpha = 0.16;
      ctx.fillStyle = ZONE_TINTS[zone];
      ctx.fillRect(screen.x, screen.y, scale + 1, scale + 1);

      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = ZONE_TINTS[zone];
      ctx.beginPath();
      // Two diagonals per tile, offset by the tile's own parity so the hatch
      // runs continuously across a district rather than restarting each tile.
      for (let pass = 0; pass < 2; pass++) {
        const offset = (pass * scale) / 2;
        ctx.moveTo(screen.x + offset, screen.y + scale);
        ctx.lineTo(screen.x + offset + scale, screen.y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawBuildings(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  now: number,
): void {
  const view = camera.visibleTileRect();
  const scale = camera.scale;
  const zoom = camera.zoom;

  for (const building of state.buildings.values()) {
    // Viewport culling (§17): everything outside the camera rectangle is
    // skipped before any drawing work happens.
    if (
      building.x < view.x0 - 1 ||
      building.y < view.y0 - 1 ||
      building.x > view.x1 ||
      building.y > view.y1
    ) {
      continue;
    }

    const look = BUILDING_LOOKS[building.zone][building.level - 1] as BuildingLook;
    const screen = camera.worldToScreen(building.x, building.y);

    if (zoom < ZOOM_LOD_BLOBS) {
      ctx.fillStyle = look.body;
      ctx.fillRect(screen.x, screen.y, scale + 1, scale + 1);
      continue;
    }

    const grown = riseFactor(building, state.playedMs, now);
    drawMark(ctx, building, look, screen.x, screen.y, scale, zoom, grown);
  }
}

/**
 * A building springs up over 180 ms when it appears (§14.5). The delay is
 * derived from the building's own seed rather than a queue, so a hundred
 * arriving at once ripple instead of popping in unison.
 */
function riseFactor(building: Building, playedMs: number, now: number): number {
  void now;
  const age = playedMs - building.builtAt;
  const delay = hashUnit(building.x, building.y, 3) * 800;
  if (age >= delay + 180) return 1;
  if (age < delay) return 0;
  const t = (age - delay) / 180;
  // Slight overshoot, then settle: the springiness is the whole point.
  return 1 + Math.sin(t * Math.PI) * 0.12 * (1 - t) - (1 - t) * 0.9;
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  building: Building,
  look: BuildingLook,
  x: number,
  y: number,
  scale: number,
  zoom: number,
  grown: number,
): void {
  if (grown <= 0) return;

  const footprint = look.footprint * Math.max(0.05, grown);
  const size = scale * footprint;
  // Nudge each building off-centre so a row does not look stamped.
  const offsetX = (hashUnit(building.x, building.y, 11) - 0.5) * scale * (1 - footprint);
  const offsetY = (hashUnit(building.x, building.y, 13) - 0.5) * scale * (1 - footprint);
  const left = x + (scale - size) / 2 + offsetX;
  const top = y + (scale - size) / 2 + offsetY;

  ctx.fillStyle = look.body;
  ctx.fillRect(left, top, size, size);

  if (zoom < ZOOM_LOD_BLOCKS) return;

  // Cap: a roof on the low levels, a parapet on the tall ones.
  ctx.fillStyle = look.cap;
  ctx.fillRect(left, top, size, Math.max(1, size * 0.26));

  if (look.windows > 0 && size > 7) {
    drawWindows(ctx, look, left, top, size);
  }
  if (building.issues !== 0) {
    drawIssue(ctx, building, left, top, size);
  }
}

function drawWindows(
  ctx: CanvasRenderingContext2D,
  look: BuildingLook,
  left: number,
  top: number,
  size: number,
): void {
  const rows = look.windows;
  const columns = Math.max(2, Math.round(rows * 1.2));
  const cell = size / (columns + 1);
  const dot = Math.max(0.7, cell * 0.42);

  ctx.fillStyle = 'rgba(230, 218, 194, 0.7)';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const wx = left + cell * (c + 0.8);
      const wy = top + size * 0.34 + ((size * 0.58) / rows) * (r + 0.2);
      ctx.fillRect(wx, wy, dot, dot);
    }
  }
}

/**
 * The small mark that tells the player why a building is failing (§6.2). It
 * has to be readable without opening anything — the brief is explicit that the
 * player should understand a loss from the map alone.
 */
function drawIssue(
  ctx: CanvasRenderingContext2D,
  building: Building,
  left: number,
  top: number,
  size: number,
): void {
  const radius = Math.max(1.5, size * 0.17);
  ctx.beginPath();
  ctx.arc(left + size, top, radius, 0, Math.PI * 2);
  ctx.fillStyle = (building.issues & ISSUE.pollution) !== 0 ? PALETTE.brick : PALETTE.brass;
  ctx.fill();
}
