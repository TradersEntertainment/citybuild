import { NONE } from './tiles';
import { index, type World } from './world';

/**
 * Which streets lead anywhere (§6.1).
 *
 * Every settler, every lorry and every lira the city has ever seen arrived by
 * the national highway — it is the only way in from the rest of the country. A
 * street that cannot reach the motorway through the city's own network is
 * therefore a drawing on the ground, not a road: nothing spawns on it, nobody
 * moves in along it, and what already stands beside it quietly empties. This
 * module marks the tiles that are genuinely wired into the country so every
 * other system can tell the difference.
 *
 * Recomputed wholesale with the fields, like every other derived column: the
 * grid is small, roads change rarely, and incremental graph surgery is where
 * stale-state bugs live.
 */
export function computeConnectivity(world: World): void {
  const { connected } = world;
  connected.fill(0);

  // A world with no motorway at all — a stripped test fixture, say — has no
  // notion of "abroad" to be cut off from, so every street leads somewhere.
  if (world.highwayRoute.length === 0) {
    for (let i = 0; i < world.road.length; i++) {
      if ((world.road[i] ?? NONE) !== NONE) connected[i] = 1;
    }
    return;
  }

  // Ring-buffer BFS over road tiles, seeded where a city street meets the
  // national highway. Four-way movement only: a road you cannot drive along
  // diagonally does not connect diagonally.
  const queue = new Int32Array(world.size * world.size);
  let head = 0;
  let tail = 0;

  const seed = (i: number): void => {
    if (connected[i] === 1) return;
    connected[i] = 1;
    queue[tail++] = i;
  };

  for (const point of world.highwayRoute) {
    const { x, y } = point;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const i = index(world, nx, ny);
      // The motorway itself never joins the graph: it is the country's road,
      // not the city's, and standing beside it was never access (§6.2).
      if ((world.road[i] ?? NONE) === NONE) continue;
      if ((world.highway[i] ?? 0) === 1) continue;
      seed(i);
    }
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
      if (connected[next] === 1) continue;
      if ((world.road[next] ?? NONE) === NONE) continue;
      if ((world.highway[next] ?? 0) === 1) continue;
      seed(next);
    }
  }
}

/** Count of player-road tiles that can reach the national highway. */
export function connectedRoadTiles(world: World): number {
  let count = 0;
  for (let i = 0; i < world.connected.length; i++) {
    if (world.connected[i] === 1) count++;
  }
  return count;
}

/** Whether the city has drawn any road that actually leads to the country. */
export function hasConnection(world: World): boolean {
  for (let i = 0; i < world.connected.length; i++) {
    if (world.connected[i] === 1) return true;
  }
  return false;
}

const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;
