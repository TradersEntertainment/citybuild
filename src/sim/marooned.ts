import { NONE } from './tiles';
import { canTravel, wayAt, WAY } from './oneWay';
import { index, type World } from './world';

/**
 * Streets the arrows cut off (§26).
 *
 * sim/connectivity.ts deliberately ignores one-way signs, and says why: a single
 * mis-drawn arrow stranding a district silently is exactly the unexplained
 * failure this codebase works to avoid, so connectivity answers the simpler
 * question — is there a road from here to the country at all — and the cost of a
 * bad scheme was left as "congestion and lost visitors, both of which the player
 * can see on the map".
 *
 * Half of that turned out to be untrue. Congestion is visible. Lost visitors are
 * not: a junction signed the wrong way round means no car can legally enter the
 * street behind it, so every shop on it earns its base takings and nothing from
 * passing trade, forever, with no marker, no complaint, and a perfectly ordinary
 * looking map. The player sees shops that never do well and has no way to learn
 * why. That is the same class of bug as the land value overlay reading an array
 * nobody filled — wrong, silent, and invisible to every test that only checks
 * the values it does produce are in range.
 *
 * So this is the missing consumer. It asks the question connectivity refuses to:
 * respecting every arrow, can a car get **in**, and can it get back **out**?
 *
 * Two BFS passes over road tiles only:
 *
 * - **Inbound**: from the city's gates, following arrows forwards. A road tile
 *   never reached is one nothing can drive into.
 * - **Outbound**: from the same gates, following arrows *backwards* — which is
 *   the same as asking, from every tile, whether some legal route leads home. A
 *   road tile never reached this way is one a car could enter and not leave.
 *
 * Both are needed and they catch different mistakes. A cul-de-sac signed inward
 * is a trap; the same street signed outward is unreachable. Either one costs the
 * player money they were never told about.
 *
 * Nothing here changes what the sim does — no route is blocked, no income is
 * altered, nothing is stored. It is purely a reading, taken so the game can say
 * a sentence it could not say before. That matters: a check that also *punished*
 * the player would turn a silent loss into a loud one, and the loss was never
 * the problem. Not knowing was.
 */

const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;

export interface MaroonedRoads {
  /** Road tiles nothing can legally drive into. */
  unreachable: number;
  /** Road tiles a car can enter but not legally leave. */
  trapped: number;
  /**
   * One tile from the worst finding, for the UI to fly the camera to.
   *
   * A count alone tells a player something is wrong somewhere on a map they
   * have spent an hour on, which is halfway to a bug report and no way to a
   * fix. Unreachable is reported ahead of trapped because it is the one that
   * costs money.
   */
  where: { x: number; y: number } | null;
}

const NOTHING: MaroonedRoads = { unreachable: 0, trapped: 0, where: null };

/**
 * Where cars enter the city: every player street touching an open motorway
 * stretch or a sea gate.
 *
 * The same seeding as connectivity, and deliberately so — a street this pass
 * calls unreachable must be one connectivity already calls connected, or the
 * message would blame the arrows for a road that simply is not joined to
 * anything. The caller filters on `connected` for exactly that reason.
 */
function gatesOf(world: World): number[] {
  const seeds: number[] = [];
  const add = (x: number, y: number): void => {
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const i = index(world, nx, ny);
      if ((world.road[i] ?? NONE) === NONE) continue;
      if ((world.highway[i] ?? 0) === 1) continue;
      seeds.push(i);
    }
  };

  for (const point of world.highwayRoute) {
    if ((world.highwayBlocked[index(world, point.x, point.y)] ?? 0) === 1) continue;
    add(point.x, point.y);
  }
  for (let i = 0; i < world.seaGate.length; i++) {
    if (world.seaGate[i] !== 1) continue;
    const x = i % world.size;
    add(x, (i - x) / world.size);
  }
  return seeds;
}

/**
 * Flood the road graph from the gates. `forward` follows the arrows; reversed,
 * it asks which tiles can reach a gate rather than which a gate can reach.
 */
function flood(world: World, seeds: readonly number[], forward: boolean): Uint8Array {
  const seen = new Uint8Array(world.size * world.size);
  const queue = new Int32Array(world.size * world.size);
  let head = 0;
  let tail = 0;

  for (const seed of seeds) {
    if (seen[seed] === 1) continue;
    seen[seed] = 1;
    queue[tail++] = seed;
  }

  while (head < tail) {
    const at = queue[head++] as number;
    const x = at % world.size;
    const y = (at - x) / world.size;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const next = index(world, nx, ny);
      if (seen[next] === 1) continue;
      if ((world.road[next] ?? NONE) === NONE) continue;
      if ((world.highway[next] ?? 0) === 1) continue;
      // Forward: may a car drive from here to there? Backward: may one drive
      // from there to here — which is what "can this tile reach a gate" means
      // when the search starts at the gate.
      const legal = forward ? canTravel(world, x, y, nx, ny) : canTravel(world, nx, ny, x, y);
      if (!legal) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return seen;
}

/** Whether the player has drawn a single arrow anywhere. */
function anyArrows(world: World): boolean {
  for (let i = 0; i < world.oneWay.length; i++) {
    if ((world.oneWay[i] ?? WAY.both) !== WAY.both) return true;
  }
  return false;
}

/**
 * The two masks, or null when the question does not arise.
 *
 * Split out because two callers want the same two floods: the count, which runs
 * on every road rebuild, and the map overlay, which runs on a slow timer while
 * the player has it up. Computing them twice would be the cheaper mistake and
 * letting them disagree the worse one.
 *
 * Null for a city with no arrows at all — the common case, and two array scans
 * rather than two floods. A player who has never used the tool cannot have made
 * this mistake and should never pay for the check. Null too when there is no
 * way into the country: that is connectivity's story, and reporting every
 * street as unreachable because the motorway is barricaded would bury the real
 * message under a false one.
 */
export function roadAccess(world: World): { inbound: Uint8Array; outbound: Uint8Array } | null {
  if (!anyArrows(world)) return null;
  const seeds = gatesOf(world);
  if (seeds.length === 0) return null;
  return { inbound: flood(world, seeds, true), outbound: flood(world, seeds, false) };
}

/** Reads the map for streets the arrows have cut off. */
export function findMarooned(world: World): MaroonedRoads {
  const access = roadAccess(world);
  if (!access) return NOTHING;
  const { inbound, outbound } = access;

  let unreachable = 0;
  let trapped = 0;
  let firstUnreachable = -1;
  let firstTrapped = -1;

  for (let i = 0; i < world.road.length; i++) {
    if ((world.road[i] ?? NONE) === NONE) continue;
    if ((world.highway[i] ?? 0) === 1) continue;
    // Only streets that are joined to the country in the first place. A road in
    // a field nobody has linked up yet is not a signing mistake, and saying so
    // would train the player to ignore the message.
    if ((world.connected[i] ?? 0) !== 1) continue;

    if (inbound[i] !== 1) {
      unreachable++;
      if (firstUnreachable < 0) firstUnreachable = i;
    } else if (outbound[i] !== 1) {
      trapped++;
      if (firstTrapped < 0) firstTrapped = i;
    }
  }

  const at = firstUnreachable >= 0 ? firstUnreachable : firstTrapped;
  const where =
    at >= 0 ? { x: at % world.size, y: Math.floor(at / world.size) } : null;

  return { unreachable, trapped, where };
}

/** Whether the arrows have cut anything off at all. */
export function isMarooned(reading: MaroonedRoads): boolean {
  return reading.unreachable > 0 || reading.trapped > 0;
}

/** True when a tile carries an arrow — for a caller wanting to explain itself. */
export function hasArrow(world: World, x: number, y: number): boolean {
  return wayAt(world, x, y) !== WAY.both;
}
