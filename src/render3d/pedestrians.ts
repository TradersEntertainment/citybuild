import * as THREE from 'three';
import { dayFraction, streetActivity } from '../sim/daytime';
import { isNationalHighway } from '../sim/highway';
import { NONE } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { ROAD_LIFT } from './constants';
import { sampleHeight } from './terrain';

/**
 * People on the pavement (Paket 1 §1).
 *
 * Presentation only — the simulation has no notion of an individual and should
 * not gain one for this. A pedestrian here is a mark that says *someone lives
 * on this street*, and the number of marks is read off the population the sim
 * already keeps. Nothing about the city changes if this layer is deleted, which
 * is the test for whether a decorative layer has stayed decorative.
 *
 * They walk the pavement rather than the carriageway: a tile that is not road,
 * has nothing built on it, and touches a road. That is also what makes them
 * appear where the player built and nowhere else, which is the same reason the
 * traffic layer drives the real road column.
 */

/** Residents per walker on screen. */
const RESIDENTS_PER_WALKER = 30;
const MAX_WALKERS = 180;
/**
 * People are much smaller than cars, so they stop being legible sooner. Drawing
 * a hundred and eighty two-pixel figures is the definition of spending the
 * frame budget on nothing.
 */
const LOD_DISTANCE = 90;
/** Tiles per second. A person crosses a twenty-metre tile in a few seconds. */
const WALK_SPEED = 0.42;

const CLOTHES = [
  '#5A4632', '#3E4A5C', '#6B3A38', '#3F5646', '#7A6A4E',
  '#4A3F55', '#8A6B4A', '#2F4550', '#6E5A6B', '#55603A',
] as const;

interface Walker {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** 0..1 along the current step. */
  t: number;
  speed: number;
  seed: number;
  steps: number;
}

export interface PedestrianLayer {
  readonly group: THREE.Group;
  /** Re-reads which tiles are pavement; call when roads or buildings change. */
  rebuildNetwork(): void;
  update(deltaSeconds: number, population: number, playedMs: number, cameraDistance: number): void;
  dispose(): void;
}

export function createPedestrians(world: World): PedestrianLayer {
  const group = new THREE.Group();
  group.name = 'pedestrians';

  const geometry = buildFigureGeometry();
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_WALKERS);
  mesh.castShadow = false; // a person's shadow is smaller than a shadow-map texel
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(mesh);

  const colour = new THREE.Color();
  for (let i = 0; i < MAX_WALKERS; i++) {
    colour.set(CLOTHES[i % CLOTHES.length] as string);
    mesh.setColorAt(i, colour);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  /** Pavement tiles as a flat x,y list, so a spawn picks one in O(1). */
  let pavement: number[] = [];
  const walkers: Walker[] = [];

  const rebuildNetwork = (): void => {
    pavement = [];
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        if (!isPavement(world, x, y)) continue;
        pavement.push(x, y);
      }
    }
    // Anyone whose pavement was built over is retired rather than left walking
    // through a wall.
    for (let i = walkers.length - 1; i >= 0; i--) {
      const walker = walkers[i] as Walker;
      if (!isPavement(world, walker.toX, walker.toY)) walkers.splice(i, 1);
    }
  };

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3(0, 1, 0);

  const update = (
    deltaSeconds: number,
    population: number,
    playedMs: number,
    cameraDistance: number,
  ): void => {
    if (cameraDistance > LOD_DISTANCE || pavement.length === 0) {
      mesh.count = 0;
      return;
    }

    // The street empties overnight and fills at rush hour. This is the one place
    // the day cycle reaches the crowd, and it is why a city looks awake.
    const activity = streetActivity(dayFraction(playedMs));
    const wanted = Math.min(
      MAX_WALKERS,
      Math.floor(pavement.length / 4),
      Math.round((Math.max(0, population) / RESIDENTS_PER_WALKER) * activity),
    );

    while (walkers.length > wanted) walkers.pop();
    while (walkers.length < wanted) {
      const spawned = spawnWalker(world, pavement, walkers.length);
      if (!spawned) break;
      walkers.push(spawned);
    }

    const step = Math.min(0.1, deltaSeconds);
    let visible = 0;
    for (const walker of walkers) {
      walker.t += walker.speed * step;
      while (walker.t >= 1) {
        walker.t -= 1;
        advance(world, walker);
      }

      const x = walker.fromX + (walker.toX - walker.fromX) * walker.t;
      const y = walker.fromY + (walker.toY - walker.fromY) * walker.t;
      const dx = walker.toX - walker.fromX;
      const dy = walker.toY - walker.fromY;

      // Spread across the tile rather than down its centre line, or a busy
      // pavement is a single-file queue.
      const offX = (hashUnit(walker.seed, 3, 5) - 0.5) * 0.5;
      const offY = (hashUnit(walker.seed, 7, 11) - 0.5) * 0.5;
      const cx = x + 0.5 + offX;
      const cy = y + 0.5 + offY;

      // A gentle bob, phased per walker, so a crowd is not a sliding decal.
      const bob = Math.sin((walker.steps + walker.t) * Math.PI * 2 + walker.seed) * 0.006;
      position.set(cx, sampleHeight(world, cx, cy) + ROAD_LIFT + bob, cy);
      quaternion.setFromAxisAngle(axis, Math.atan2(dx, dy));
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(visible++, matrix);
    }

    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
  };

  rebuildNetwork();

  return {
    group,
    rebuildNetwork,
    update,
    dispose: () => {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}

/**
 * Pavement: unpaved, unbuilt ground beside a road.
 *
 * Exported because it is the whole rule this layer stands on, and a rule with a
 * test is a rule that stays true when the road tiers change.
 */
export function isPavement(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  const i = index(world, x, y);
  if ((world.road[i] ?? NONE) !== NONE) return false;
  if ((world.building[i] ?? 0) !== 0) return false;
  // Terrain 0 is water; nobody strolls on it.
  if ((world.terrain[i] ?? 0) === 0) return false;
  return (
    isWalkableRoad(world, x + 1, y) ||
    isWalkableRoad(world, x - 1, y) ||
    isWalkableRoad(world, x, y + 1) ||
    isWalkableRoad(world, x, y - 1)
  );
}

/**
 * A road with a pavement beside it — which the national motorway is not.
 *
 * The state highway crosses every map before the player has drawn anything, so
 * without this a brand-new city already has people strolling the hard shoulder.
 * The zoning code makes the same distinction: the motorway reservation is not a
 * plot, and for the same reason it is not a street.
 */
function isWalkableRoad(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  if ((world.road[index(world, x, y)] ?? NONE) === NONE) return false;
  return !isNationalHighway(world, x, y);
}

function spawnWalker(world: World, pavement: readonly number[], salt: number): Walker | null {
  const count = pavement.length / 2;
  if (count === 0) return null;
  const pick = Math.floor(hashUnit(salt, count, 19) * count) * 2;
  const x = pavement[pick] ?? 0;
  const y = pavement[pick + 1] ?? 0;

  const walker: Walker = {
    fromX: x,
    fromY: y,
    toX: x,
    toY: y,
    t: hashUnit(salt, x + y, 23),
    speed: WALK_SPEED * (0.75 + hashUnit(salt, x, 29) * 0.5),
    seed: salt * 6151 + 7,
    steps: 0,
  };
  advance(world, walker);
  return walker;
}

/**
 * Moves a walker onto the next pavement tile. Carrying straight on is preferred
 * so people go somewhere instead of milling, and turning back is only allowed
 * where there is nowhere else to go.
 */
function advance(world: World, walker: Walker): void {
  const prevX = walker.fromX;
  const prevY = walker.fromY;
  walker.fromX = walker.toX;
  walker.fromY = walker.toY;

  const dx = walker.fromX - prevX;
  const dy = walker.fromY - prevY;

  const options: [number, number][] = [];
  const straight: [number, number][] = [];
  for (const [ox, oy] of NEIGHBOURS) {
    const nx = walker.fromX + ox;
    const ny = walker.fromY + oy;
    if (!isPavement(world, nx, ny)) continue;
    if (nx === prevX && ny === prevY) continue;
    options.push([nx, ny]);
    if (ox === dx && oy === dy) straight.push([nx, ny]);
  }

  walker.steps++;
  const roll = hashUnit(walker.seed + walker.steps, walker.fromX + walker.fromY, 31);
  const pool = straight.length > 0 && roll < 0.7 ? straight : options;
  if (pool.length === 0) {
    walker.toX = prevX;
    walker.toY = prevY;
    return;
  }
  const turn = hashUnit(walker.seed, walker.steps + walker.fromX, 37);
  const chosen = (pool[Math.floor(turn * pool.length)] ?? pool[0]) as [number, number];
  walker.toX = chosen[0];
  walker.toY = chosen[1];
}

const NEIGHBOURS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * A person: body and head, drawn a little larger than life against a
 * twenty-metre tile for the same reason the cars are — at true scale a person
 * is under a pixel from anywhere the camera actually sits.
 */
function buildFigureGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.05, 0.1, 0.035);
  body.translate(0, 0.05, 0);
  const head = new THREE.BoxGeometry(0.035, 0.035, 0.035);
  head.translate(0, 0.118, 0);

  const positions: number[] = [];
  for (const part of [body, head]) {
    const nonIndexed = part.toNonIndexed();
    const attribute = nonIndexed.getAttribute('position');
    for (let i = 0; i < attribute.count; i++) {
      positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
    }
    nonIndexed.dispose();
    part.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function hashUnit(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
