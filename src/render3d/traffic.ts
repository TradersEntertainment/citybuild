import * as THREE from 'three';
import { NONE } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { LOD_TRAFFIC_DISTANCE, ROAD_LIFT } from './constants';
import { sampleHeight } from './terrain';

/**
 * Vehicles on the road network.
 *
 * They drive the real road column rather than following a decorative spline:
 * a car picks its next tile from the tiles that are actually paved, so traffic
 * appears where the player drew and stops existing where they did not. That is
 * the whole point of putting cars in a game whose only verb is drawing roads —
 * they are the feedback that a line became a street.
 *
 * How many cars run is scaled by population, so a hamlet gets one van and a
 * city gets a stream. Phase 3's traffic model will replace that scalar with
 * real per-segment flow; the rendering does not change when it does.
 */
const CAR_COLOURS = [
  '#C9CDD2', '#2E3640', '#8E1F1F', '#1F4C8E', '#D8D3C4',
  '#3C6E4F', '#B8862A', '#6E6E76', '#A83E2C', '#20303A',
] as const;

/** Residents per vehicle on the road at any moment. */
const RESIDENTS_PER_CAR = 22;
/** Vehicles that run on any road network, city or not. */
const TRAFFIC_FLOOR = 4;
const MAX_CARS = 420;
/** Tiles per second at road speed 1. */
const BASE_SPEED = 2.4;
/** Half a lane, so oncoming traffic passes rather than overlapping. */
const LANE_OFFSET = 0.17;

interface Car {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** 0..1 along the current tile step. */
  t: number;
  speed: number;
  /** Per-car stream for turn choices, so two cars at a junction can differ. */
  seed: number;
  /** Advances on every step, so the same car does not loop the same block. */
  steps: number;
}

export interface TrafficLayer {
  readonly group: THREE.Group;
  /** Re-reads the road network; call when roads change. */
  rebuildNetwork(): void;
  /** Advances every vehicle and writes the instance matrices. */
  update(
    deltaSeconds: number,
    population: number,
    cameraDistance: number,
    /** Per-tile congestion from the sim; cars crawl where the city is jammed. */
    load?: Float32Array,
  ): void;
  dispose(): void;
}

export function createTraffic(world: World): TrafficLayer {
  const group = new THREE.Group();
  group.name = 'traffic';

  const geometry = buildCarGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: false,
    roughness: 0.42,
    metalness: 0.35,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_CARS);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(mesh);

  const colour = new THREE.Color();
  for (let i = 0; i < MAX_CARS; i++) {
    colour.set(CAR_COLOURS[i % CAR_COLOURS.length] as string);
    mesh.setColorAt(i, colour);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  /** Every paved tile, as a flat list so a spawn can pick one in O(1). */
  let roadTiles: number[] = [];
  const cars: Car[] = [];

  const rebuildNetwork = (): void => {
    roadTiles = [];
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        if ((world.road[index(world, x, y)] ?? NONE) === NONE) continue;
        roadTiles.push(x, y);
      }
    }
    // Cars whose road was bulldozed under them are retired rather than left
    // driving through a field.
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i] as Car;
      if (!isRoad(world, car.toX, car.toY)) cars.splice(i, 1);
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
    cameraDistance: number,
    load?: Float32Array,
  ): void => {
    // Cars are a few pixels from far away; drawing them there costs the frame
    // budget and buys nothing (§17).
    if (cameraDistance > LOD_TRAFFIC_DISTANCE || roadTiles.length === 0) {
      mesh.count = 0;
      return;
    }

    // A road with nobody on it still carries deliveries and passers-by, so a
    // handful of vehicles run from the moment there is somewhere to drive —
    // above that floor, traffic is the city's own.
    const byPopulation = Math.floor(population / RESIDENTS_PER_CAR);
    const wanted = Math.min(
      MAX_CARS,
      Math.floor(roadTiles.length / 6),
      Math.max(TRAFFIC_FLOOR, byPopulation),
    );
    while (cars.length > wanted) cars.pop();
    while (cars.length < wanted) {
      const spawned = spawnCar(world, roadTiles, cars.length);
      if (!spawned) break;
      cars.push(spawned);
    }

    const step = Math.min(0.1, deltaSeconds);
    let visible = 0;
    for (const car of cars) {
      // A jam the sim has measured is a jam the player can see: the whole point
      // of drawing cars is that the road's state is legible without a readout.
      const jam = load ? (load[index(world, car.toX, car.toY)] ?? 0) : 0;
      const slowdown = jam > 1 ? 1 / (1 + (jam - 1) * 1.5) : 1;
      car.t += car.speed * slowdown * step;
      while (car.t >= 1) {
        car.t -= 1;
        advance(world, car);
      }

      const x = car.fromX + (car.toX - car.fromX) * car.t;
      const y = car.fromY + (car.toY - car.fromY) * car.t;
      const dx = car.toX - car.fromX;
      const dy = car.toY - car.fromY;
      const heading = Math.atan2(dx, dy);

      // Keep right: offset perpendicular to travel so the two directions form
      // two lanes instead of one column of overlapping cars.
      const length = Math.hypot(dx, dy) || 1;
      const offsetX = (-dy / length) * LANE_OFFSET;
      const offsetY = (dx / length) * LANE_OFFSET;

      const cx = x + 0.5 + offsetX;
      const cy = y + 0.5 + offsetY;
      position.set(cx, sampleHeight(world, cx, cy) + ROAD_LIFT + 0.035, cy);
      quaternion.setFromAxisAngle(axis, heading);
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

function spawnCar(world: World, roadTiles: readonly number[], salt: number): Car | null {
  const count = roadTiles.length / 2;
  if (count === 0) return null;
  const pick = Math.floor(hashUnit(salt, count, 7) * count) * 2;
  const x = roadTiles[pick] ?? 0;
  const y = roadTiles[pick + 1] ?? 0;

  const car: Car = {
    fromX: x,
    fromY: y,
    toX: x,
    toY: y,
    t: hashUnit(salt, x + y, 13),
    speed: BASE_SPEED * (0.8 + hashUnit(salt, x, 17) * 0.5),
    seed: salt * 7919 + 13,
    steps: 0,
  };
  advance(world, car);
  return car;
}

/**
 * Moves a car onto its next tile. Going straight on is preferred so traffic
 * runs down a street instead of jittering at every junction, and reversing is
 * only allowed at a dead end.
 */
function advance(world: World, car: Car): void {
  const prevX = car.fromX;
  const prevY = car.fromY;
  car.fromX = car.toX;
  car.fromY = car.toY;

  const dx = car.fromX - prevX;
  const dy = car.fromY - prevY;

  const options: [number, number][] = [];
  const straight: [number, number][] = [];
  for (const [ox, oy] of NEIGHBOURS) {
    const nx = car.fromX + ox;
    const ny = car.fromY + oy;
    if (!isRoad(world, nx, ny)) continue;
    if (nx === prevX && ny === prevY) continue; // no U-turns while there is a way on
    options.push([nx, ny]);
    if (ox === dx && oy === dy) straight.push([nx, ny]);
  }

  car.steps++;
  const roll = hashUnit(car.seed + car.steps, car.fromX + car.fromY, 23);
  const pool = straight.length > 0 && roll < 0.72 ? straight : options;
  if (pool.length === 0) {
    // Dead end: turn around.
    car.toX = prevX;
    car.toY = prevY;
    return;
  }
  const turn = hashUnit(car.seed, car.steps + car.fromX, 29);
  const chosen = (pool[Math.floor(turn * pool.length)] ?? pool[0]) as [number, number];
  car.toX = chosen[0];
  car.toY = chosen[1];
}

const NEIGHBOURS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function isRoad(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  return (world.road[index(world, x, y)] ?? NONE) !== NONE;
}

/**
 * A car, body plus cabin. Drawn about half again as large as a saloon would
 * really be against a 20 m tile: at true scale a car is two pixels at the
 * distance the camera actually sits, and traffic you cannot see is traffic
 * that may as well not be simulated.
 */
function buildCarGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.15, 0.062, 0.31);
  body.translate(0, 0.031, 0);
  const cabin = new THREE.BoxGeometry(0.125, 0.055, 0.15);
  cabin.translate(0, 0.087, -0.018);

  const positions: number[] = [];
  for (const part of [body, cabin]) {
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
