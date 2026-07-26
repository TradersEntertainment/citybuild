/**
 * Street-level movement, kept free of three.js so the rules can be tested like
 * any sim code (§0.5). The walker is a small circle sliding over the tile
 * grid; a tile is either walkable or it is not, and what makes it unwalkable —
 * a building, the sea — is the caller's business, passed in as a callback.
 *
 * Movement is axis-separated: try the x move, then the y move, each against
 * the corners of the circle. That is what lets a player brush along a wall
 * instead of sticking to it.
 */

/** True when the tile under (integer) tile coordinates may not be entered. */
export type WalkBlocker = (tileX: number, tileY: number) => boolean;

/** The walker's half-width in tiles: slim enough for pavements, wide enough to feel solid. */
export const WALK_RADIUS = 0.2;
/** Tiles per second at a stroll. */
export const WALK_SPEED = 6;
/** Tiles per second with the sprint key held. */
export const WALK_SPRINT = 10;
/** Eye height above the ground, in scene units, scaled to the city's houses. */
export const WALK_EYE = 0.34;

/** True when a circle centred at (x, y) overlaps any blocked tile. */
export function collides(blocked: WalkBlocker, x: number, y: number, radius = WALK_RADIUS): boolean {
  const x0 = Math.floor(x - radius);
  const x1 = Math.floor(x + radius);
  const y0 = Math.floor(y - radius);
  const y1 = Math.floor(y + radius);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (blocked(tx, ty)) return true;
    }
  }
  return false;
}

/**
 * Moves from (x, y) by (dx, dy), sliding along whatever is in the way. Each
 * axis is attempted on its own, so a diagonal push against a wall resolves to
 * motion along the wall rather than a dead stop.
 */
export function slide(
  blocked: WalkBlocker,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius = WALK_RADIUS,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  if (dx !== 0 && !collides(blocked, x + dx, ny, radius)) nx = x + dx;
  if (dy !== 0 && !collides(blocked, nx, y + dy, radius)) ny = y + dy;
  return { x: nx, y: ny };
}

/**
 * The nearest walkable tile centre to (x, y), spiralling outwards — where the
 * walker is dropped when the map camera happened to be hovering over a
 * rooftop or open water. Gives up after a generous search and returns the
 * point unchanged: standing on a roof is odd, refusing to walk is broken.
 */
export function nearestWalkable(
  blocked: WalkBlocker,
  x: number,
  y: number,
  maxRadius = 24,
): { x: number; y: number } {
  if (!collides(blocked, x, y)) return { x, y };
  for (let ring = 1; ring <= maxRadius; ring++) {
    for (let ty = -ring; ty <= ring; ty++) {
      for (let tx = -ring; tx <= ring; tx++) {
        if (Math.max(Math.abs(tx), Math.abs(ty)) !== ring) continue;
        const cx = Math.floor(x) + tx + 0.5;
        const cy = Math.floor(y) + ty + 0.5;
        if (!collides(blocked, cx, cy)) return { x: cx, y: cy };
      }
    }
  }
  return { x, y };
}

/**
 * Camera-relative input to world-space movement, rotated by the view yaw.
 * The yaw convention matches the walk controller's YXZ euler: facing
 * (−sin yaw, −cos yaw), so "right" is (cos yaw, −sin yaw).
 */
export function moveVector(
  forward: number,
  strafe: number,
  yaw: number,
): { dx: number; dy: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    dx: -sin * forward + cos * strafe,
    dy: -cos * forward - sin * strafe,
  };
}
