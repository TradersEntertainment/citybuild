import * as THREE from 'three';
import { ROAD_SPECS } from '../data/roads';
import { FLYING_YEAR, SHUTTLE_YEAR } from '../data/timeline';
import { vehicleAgeFor, type VehicleAge, type VehicleEra } from '../data/vehicles';
import { transitFlow } from '../sim/highway';
import type { GameState } from '../sim/state';
import { decodeRoad, NONE } from '../sim/tiles';
import { yearOf } from '../sim/timeline';
import type { World } from '../sim/world';
import { LOD_TRAFFIC_DISTANCE, ROAD_LIFT, SEA_Y, TILE, WORLD_SIZE } from './constants';
import { sampleHeight } from './terrain';

/**
 * What drives on the roads.
 *
 * Cars used to be wallpaper: a count read off the population, a wander round
 * the tarmac, a U-turn when the tarmac ran out. They proved motion, not
 * traffic. This layer now works the way the city pretends to work: every
 * vehicle has an origin and a destination, a route found on the actual road
 * graph, and a reason for the trip.
 *
 * Three fleets share the cap:
 * - commuters (cars) run between their home and their workplace, back and
 *   forth, on roads the pathfinder says are actually fastest;
 * - freight (trucks) runs from workshops to shops — or to the national
 *   highway and off the edge of the map: goods leaving the city;
 * - transit (cars and trucks) enters on the national highway at one map edge
 *   and leaves at the other, in proportion to the through-traffic the sim
 *   computes — the corridor the whole game is about.
 *
 * Everything here reads the sim; nothing here feeds it, so a prettier lorry
 * can never make a city richer.
 */

const MAX_CARS = 330;
const MAX_TRUCKS = 90;
const CAR_Y = 0.16;
const LANE_OFFSET = 0.21;
/** Reroutes allowed per frame, so a demolition wave never stalls the loop. */
const ROUTE_BUDGET = 6;
const EXPANSION_LIMIT = 24_000;
const POOLS_REFRESH_FRAMES = 240;
/** Before the sim's first traffic pass, nothing is congested anywhere. */
const NO_LOAD = new Float32Array(0);

type Fleet = 'commute' | 'freight' | 'transit';

interface Vehicle {
  fleet: Fleet;
  truck: boolean;
  /** Tile indices to follow, in order. */
  path: Int32Array;
  /** Index of the tile the vehicle is heading toward. */
  at: number;
  /** 0..1 progress between path[at-1] and path[at]. */
  t: number;
  /** Current position, so a reroute starts where the vehicle actually is. */
  x: number;
  z: number;
  seed: number;
  speedScale: number;
  /** Commuters keep a home and a workplace and alternate between them. */
  home: number;
  work: number;
  leg: number;
}

export interface TrafficLayer {
  readonly group: THREE.Group;
  /** Roads changed under the vehicles: re-read the graph, re-plan as needed. */
  rebuildNetwork(): void;
  update(
    deltaSeconds: number,
    state: GameState,
    cameraDistance: number,
    load: Float32Array | undefined,
    /** Frame clock; the space-age fleet needs it for bob and shuttle runs. */
    nowMs?: number,
  ): void;
  dispose(): void;
}

export function createTraffic(initialWorld: World): TrafficLayer {
  const group = new THREE.Group();
  group.name = 'traffic';
  // One body per age, built once at start-up. Three extra geometries is a few
  // hundred triangles held in memory against swapping them in on the frame a
  // city crosses a decade; building them on demand would stutter exactly then.
  const carGeometries: Record<VehicleEra, THREE.BufferGeometry> = {
    cart: buildCartGeometry(),
    early: buildEarlyCarGeometry(),
    modern: buildCarGeometry(),
    flying: buildCarGeometry(),
  };
  let drawnAge: VehicleEra = 'modern';
  const truckGeometry = buildTruckGeometry();
  const cars = new THREE.InstancedMesh(carGeometries.modern, TRIM_MATERIALS, MAX_CARS);
  const trucks = new THREE.InstancedMesh(truckGeometry, TRIM_MATERIALS, MAX_TRUCKS);
  cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trucks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cars.frustumCulled = false;
  trucks.frustumCulled = false;
  cars.castShadow = true;
  trucks.castShadow = true;
  cars.count = 0;
  trucks.count = 0;
  group.add(cars, trucks);

  // Orbital shuttles: two bright specks crossing the sky on long straight
  // runs once the century turns spacefaring. Parked invisible until 2065.
  const shuttleGeometry = new THREE.BoxGeometry(2.2, 0.2, 0.4);
  const shuttleMaterial = new THREE.MeshStandardMaterial({
    color: '#E8EDF2',
    emissive: new THREE.Color('#BFD9FF'),
    emissiveIntensity: 1.3,
    roughness: 0.4,
  });
  const shuttles: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(shuttleGeometry, shuttleMaterial);
    mesh.visible = false;
    mesh.castShadow = false;
    shuttles.push(mesh);
    group.add(mesh);
  }

  function updateShuttles(year: number, seconds: number): void {
    const active = year >= SHUTTLE_YEAR;
    for (let i = 0; i < shuttles.length; i++) {
      const mesh = shuttles[i]!;
      mesh.visible = active;
      if (!active) continue;
      // One long run across the whole map, staggered per shuttle, wrapping
      // forever — the same sky lane the flying cars queue under. Tile space,
      // like the fleet below.
      const span = WORLD_SIZE * TILE * 1.3;
      const phase = ((seconds * (6 + i * 2.4) + i * 137) % span) - span * 0.15;
      mesh.position.set(phase, 14 + i * 3.5, WORLD_SIZE * TILE * (0.3 + i * 0.4));
      mesh.rotation.y = 0.2 + i * 0.5;
    }
  }

  const fleet: Vehicle[] = [];
  let world: World = initialWorld;
  let graph: Graph = buildGraph(initialWorld);
  let pools: Pools = { homes: [], workplaces: [], workshops: [] };
  let poolSignature = -1;
  let frames = 0;
  let rngState = initialWorld.seed >>> 0 || 1;
  let spawnCooldown = 0;

  /** Small deterministic generator — stability is worth more than surprise. */
  function rng(): number {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0xffffffff;
  }

  /**
   * The player drew or erased pavement. The graph is re-read wholesale — two
   * flat arrays and a junction scan, cheap next to the mesh rebuild that
   * triggered it — and the route cache is dropped. Vehicles keep their places;
   * a path that no longer exists fails its driver out one tile from now.
   */
  function rebuildNetwork(): void {
    graph = buildGraph(world);
  }

  function update(
    deltaSeconds: number,
    state: GameState,
    cameraDistance: number,
    load: Float32Array | undefined,
    nowMs: number = performance.now(),
  ): void {
    const jamLoad = load ?? NO_LOAD;
    const seconds = nowMs / 1000;
    const year = yearOf(state.playedMs);
    const age = vehicleAgeFor(year);
    // The body changes with the century. Swapping the geometry on the existing
    // mesh keeps it one draw call and costs nothing per frame — only on the
    // handful of frames where a city crosses into 1920, 1960 or 2050.
    if (age.id !== drawnAge) {
      drawnAge = age.id;
      cars.geometry = carGeometries[age.id];
    }
    const flying = year >= FLYING_YEAR;
    updateShuttles(year, seconds);
    frames++;
    if (state.world !== world) {
      world = state.world;
      graph = buildGraph(world);
      fleet.length = 0;
      pools = { homes: [], workplaces: [], workshops: [] };
      poolSignature = -1;
      rngState = world.seed >>> 0 || 1;
    }
    const g = graph;
    if (frames % POOLS_REFRESH_FRAMES === 0 || state.buildings.size !== poolSignature) {
      pools = collectPools(state);
      poolSignature = state.buildings.size;
    }

    let budget = ROUTE_BUDGET;
    spawnCooldown -= deltaSeconds;
    if (spawnCooldown <= 0) {
      spawnCooldown = 0.12;
      // A growing fleet should not take a minute of real time to appear: a few
      // attempts per tick, capped, so a fresh city fills its streets in seconds
      // while a steady one spends almost nothing.
      for (let attempt = 0; attempt < 5 && budget > 0; attempt++) {
        if (spawnOne(state, g)) budget -= 1;
        else break;
      }
    }

    let carCount = 0;
    let truckCount = 0;
    const hidden = cameraDistance > LOD_TRAFFIC_DISTANCE;
    for (let i = fleet.length - 1; i >= 0; i--) {
      const v = fleet[i] as Vehicle;
      if (v.path.length === 0 || !advance(v, deltaSeconds * age.speed, g, jamLoad)) {
        // Trip finished, or the road died under the wheels: next trip. A
        // vehicle with nowhere new to go leaves the pool rather than idling
        // on a phantom road.
        if (budget <= 0 || !assignTrip(v, state, g, pools)) {
          fleet.splice(i, 1);
          continue;
        }
        budget -= 1;
        if (v.path.length === 0) {
          fleet.splice(i, 1);
          continue;
        }
      }
      if (hidden) continue;
      const pose = poseOf(v, g);
      const matrix = composeMatrix(pose, v, state.world, flying, seconds);
      const color = vehicleColor(v, age);
      if (v.truck) {
        if (truckCount >= MAX_TRUCKS) continue;
        trucks.setMatrixAt(truckCount, matrix);
        trucks.setColorAt(truckCount, color);
        truckCount++;
      } else {
        if (carCount >= MAX_CARS) continue;
        cars.setMatrixAt(carCount, matrix);
        cars.setColorAt(carCount, color);
        carCount++;
      }
    }
    cars.count = carCount;
    trucks.count = truckCount;
    if (carCount > 0) {
      cars.instanceMatrix.needsUpdate = true;
      if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
    }
    if (truckCount > 0) {
      trucks.instanceMatrix.needsUpdate = true;
      if (trucks.instanceColor) trucks.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Gives one more vehicle to whichever fleet is furthest below its target.
   * Returns false when every fleet is at strength or has nowhere to go.
   */
  function spawnOne(state: GameState, g: Graph): boolean {
    const wants = desiredCounts(state);
    const have = { commute: 0, freight: 0, transit: 0 };
    for (const v of fleet) have[v.fleet]++;
    const order = (['transit', 'freight', 'commute'] as Fleet[]).sort(
      (a, b) => have[a] / Math.max(1, wants[a]) - have[b] / Math.max(1, wants[b]),
    );
    for (const kind of order) {
      if (have[kind] >= wants[kind]) continue;
      const v: Vehicle = {
        fleet: kind,
        truck: kind === 'freight' || (kind === 'transit' && rng() < 0.35),
        path: new Int32Array(0),
        at: 0,
        t: 0,
        x: 0,
        z: 0,
        seed: rng(),
        speedScale: 0.85 + rng() * 0.35,
        home: -1,
        work: -1,
        leg: 0,
      };
      if (assignTrip(v, state, g, pools) && v.path.length > 0) {
        fleet.push(v);
        return true;
      }
    }
    return false;
  }

  /**
   * Plans the vehicle's next trip; fills the path and the start position.
   * Returns false when its fleet has nowhere to go — a town with no
   * workplaces has no commuters; a map with no junctions exports nothing.
   */
  function assignTrip(v: Vehicle, state: GameState, g: Graph, p: Pools): boolean {
    v.path = new Int32Array(0);
    v.at = 0;
    v.t = 0;

    if (v.fleet === 'transit') {
      const route = state.world.highwayRoute;
      if (route.length < 8) return false;
      const forward = v.seed < 0.5;
      const path = new Int32Array(route.length);
      for (let i = 0; i < route.length; i++) {
        const point = route[forward ? i : route.length - 1 - i] as { x: number; y: number };
        path[i] = point.y * state.world.size + point.x;
      }
      v.path = path;
      v.at = 1;
      placeAtStart(v, g, path);
      return true;
    }

    // A vehicle mid-city starts its next trip from where it stands.
    const standing =
      v.x > 0 || v.z > 0 ? nearestRoadIndex(g, Math.round(v.x), Math.round(v.z)) : -1;

    if (v.fleet === 'commute') {
      if (v.home < 0 || v.work < 0) {
        if (p.homes.length === 0 || p.workplaces.length === 0) return false;
        v.home = p.homes[Math.floor(rng() * p.homes.length)] as number;
        v.work = p.workplaces[Math.floor(rng() * p.workplaces.length)] as number;
        v.leg = 0;
      }
      const targetBuilding = v.leg === 0 ? v.work : v.home;
      const target = nearestRoadIndex(g, targetBuilding % g.size, Math.floor(targetBuilding / g.size));
      if (target < 0) {
        // The building (or its street) is gone: start over with a new pair.
        v.home = -1;
        v.work = -1;
        return false;
      }
      const from =
        standing >= 0
          ? standing
          : nearestRoadIndex(g, v.home % g.size, Math.floor(v.home / g.size));
      if (from < 0 || from === target) return false;
      const path = findPath(g, from, target);
      if (path === null || path.length < 2) return false;
      v.path = path;
      v.at = 1;
      v.leg = 1 - v.leg;
      placeAtStart(v, g, path);
      return true;
    }

    // Freight: workshop to a shop — or, the trip the corridor exists for,
    // workshop to the motorway and out of the map entirely.
    if (p.workshops.length === 0) return false;
    const workshop = p.workshops[Math.floor(rng() * p.workshops.length)] as number;
    const from =
      standing >= 0
        ? standing
        : nearestRoadIndex(g, workshop % g.size, Math.floor(workshop / g.size));
    if (from < 0) return false;
    const exportRun = g.interchanges.length > 0 && rng() < 0.55;
    let to = -1;
    if (exportRun) {
      to = g.interchanges[Math.floor(rng() * g.interchanges.length)] as number;
    } else if (p.workplaces.length > 0) {
      const shop = p.workplaces[Math.floor(rng() * p.workplaces.length)] as number;
      to = nearestRoadIndex(g, shop % g.size, Math.floor(shop / g.size));
    }
    if (to < 0 || to === from) return false;
    let path = findPath(g, from, to);
    if (path === null || path.length < 2) return false;
    if (exportRun) {
      // Past the junction, follow the motorway to its nearer end and off the
      // map: the lorry's cargo is now somebody else's city.
      const exit = highwayExit(state.world, to);
      if (exit.length > 0) {
        const joint = new Int32Array(path.length + exit.length);
        joint.set(path);
        joint.set(exit, path.length);
        path = joint;
      }
    }
    v.path = path;
    v.at = 1;
    placeAtStart(v, g, path);
    return true;
  }

  function dispose(): void {
    group.remove(cars, trucks);
    cars.dispose();
    trucks.dispose();
    // Every age's body, not just the one on screen — a Set because two ages
    // share the modern geometry and disposing it twice is not free.
    for (const geometry of new Set(Object.values(carGeometries))) geometry.dispose();
    truckGeometry.dispose();
    shuttleGeometry.dispose();
    shuttleMaterial.dispose();
    for (const material of TRIM_MATERIALS) material.dispose();
    group.clear();
  }

  return { group, rebuildNetwork, update, dispose };
}

// --- Fleets and pools ----------------------------------------------------------

interface FleetCounts {
  commute: number;
  freight: number;
  transit: number;
}

/** Targets per fleet, scaled to the city and capped against the pools. */
function desiredCounts(state: GameState): FleetCounts {
  let workshops = 0;
  for (const building of state.buildings.values()) {
    if (building.zone === 'ind') workshops += building.jobs;
  }
  return {
    commute: Math.min(250, Math.round(state.population / 22)),
    freight: Math.min(80, Math.round(workshops / 25)),
    // The sim's own figure, so what is seen is what is billed.
    transit: Math.min(70, Math.round(transitFlow(state) * 0.45)),
  };
}

interface Pools {
  homes: number[];
  workplaces: number[];
  workshops: number[];
}

/** Trip endpoints as building-tile indices, resolved to roads at trip time. */
function collectPools(state: GameState): Pools {
  const homes: number[] = [];
  const workplaces: number[] = [];
  const workshops: number[] = [];
  const size = state.world.size;
  for (const building of state.buildings.values()) {
    const at = building.y * size + building.x;
    if (building.zone === 'res' && building.population > 2) homes.push(at);
    else if (building.zone === 'com' && building.jobs > 0) workplaces.push(at);
    else if (building.zone === 'ind' && building.jobs > 0) {
      workplaces.push(at);
      workshops.push(at);
    }
  }
  return { homes, workplaces, workshops };
}

// --- The road graph ------------------------------------------------------------

interface Graph {
  size: number;
  /** Speed per tile from the road tier; 0 where no road runs. */
  speed: Float32Array;
  /** Motorway tiles a player street touches — where freight leaves the map. */
  interchanges: number[];
  cache: Map<number, Int32Array | null>;
  cameFrom: Int32Array;
  gScore: Float32Array;
  stamp: Int32Array;
  stampId: number;
}

function buildGraph(world: World): Graph {
  const size = world.size;
  const speed = new Float32Array(size * size);
  const interchanges: number[] = [];
  for (let i = 0; i < size * size; i++) {
    const kind = decodeRoad(world.road[i] ?? NONE);
    if (kind) speed[i] = ROAD_SPECS[kind].speed;
  }
  for (const point of world.highwayRoute) {
    if (
      isPlayerRoad(world, point.x + 1, point.y) ||
      isPlayerRoad(world, point.x - 1, point.y) ||
      isPlayerRoad(world, point.x, point.y + 1) ||
      isPlayerRoad(world, point.x, point.y - 1)
    ) {
      interchanges.push(point.y * size + point.x);
    }
  }
  return {
    size,
    speed,
    interchanges,
    cache: new Map(),
    cameFrom: new Int32Array(size * size),
    gScore: new Float32Array(size * size),
    stamp: new Int32Array(size * size),
    stampId: 0,
  };
}

function isPlayerRoad(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  const i = y * world.size + x;
  return (world.road[i] ?? NONE) !== NONE && (world.highway[i] ?? 0) === 0;
}

/**
 * A* over the road graph, diagonal moves allowed, edge cost weighted by the
 * destination tier's speed so a boulevard really is a shortcut and a dirt path
 * really is a last resort. Results are cached per ordered pair; paths that
 * died under the bulldozer are caught when a vehicle fails to advance.
 */
function findPath(g: Graph, from: number, to: number): Int32Array | null {
  if (from === to) return null;
  if ((g.speed[from] ?? 0) <= 0 || (g.speed[to] ?? 0) <= 0) return null;
  const key = from * 65536 + to;
  const cached = g.cache.get(key);
  if (cached !== undefined) return cached;

  g.stampId++;
  const stamp = g.stamp;
  const sid = g.stampId;
  const size = g.size;
  const tx = to % size;
  const ty = Math.floor(to / size);

  // Binary heap of f-scores with their tile indices, kept as parallel arrays.
  const heapF: number[] = [];
  const heapI: number[] = [];
  const swap = (a: number, b: number): void => {
    const tf = heapF[a] as number;
    heapF[a] = heapF[b] as number;
    heapF[b] = tf;
    const ti = heapI[a] as number;
    heapI[a] = heapI[b] as number;
    heapI[b] = ti;
  };
  const push = (f: number, i: number): void => {
    heapF.push(f);
    heapI.push(i);
    let c = heapF.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if ((heapF[p] as number) <= (heapF[c] as number)) break;
      swap(c, p);
      c = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0] as number;
    const lastF = heapF.pop() as number;
    const lastI = heapI.pop() as number;
    if (heapF.length > 0) {
      heapF[0] = lastF;
      heapI[0] = lastI;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < heapF.length && (heapF[l] as number) < (heapF[m] as number)) m = l;
        if (r < heapF.length && (heapF[r] as number) < (heapF[m] as number)) m = r;
        if (m === p) break;
        swap(m, p);
        p = m;
      }
    }
    return top;
  };

  const heuristic = (i: number): number => {
    const dx = Math.abs((i % size) - tx);
    const dy = Math.abs(Math.floor(i / size) - ty);
    // Octile distance × the cheapest per-tile cost (a motorway at speed 4).
    return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * 0.25;
  };

  g.cameFrom[from] = -1;
  g.gScore[from] = 0;
  stamp[from] = sid;
  push(heuristic(from), from);
  let expanded = 0;
  let found = false;

  while (heapI.length > 0 && expanded < EXPANSION_LIMIT) {
    const current = pop();
    if (current === to) {
      found = true;
      break;
    }
    expanded++;
    const cx = current % size;
    const cy = Math.floor(current / size);
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d]!;
      const ny = cy + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      const tierSpeed = g.speed[ni] ?? 0;
      if (tierSpeed <= 0) continue;
      const step = (d >= 4 ? 1.4142 : 1) / tierSpeed;
      const tentative = (g.gScore[current] ?? 0) + step;
      if (stamp[ni] === sid && tentative >= (g.gScore[ni] ?? Infinity)) continue;
      stamp[ni] = sid;
      g.gScore[ni] = tentative;
      g.cameFrom[ni] = current;
      push(tentative + heuristic(ni), ni);
    }
  }

  let result: Int32Array | null = null;
  if (found) {
    const reversed: number[] = [];
    let cursor = to;
    while (cursor >= 0) {
      reversed.push(cursor);
      cursor = g.cameFrom[cursor] ?? -1;
    }
    result = new Int32Array(reversed.length);
    for (let i = 0; i < reversed.length; i++) result[i] = reversed[reversed.length - 1 - i] as number;
  }
  if (g.cache.size > 4_000) g.cache.clear();
  g.cache.set(key, result);
  return result;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Road index nearest to a tile, spiralling out a few tiles; -1 when none. */
function nearestRoadIndex(g: Graph, x: number, y: number): number {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.size || ny >= g.size) continue;
        const i = ny * g.size + nx;
        if ((g.speed[i] ?? 0) > 0) return i;
      }
    }
  }
  return -1;
}

/** The motorway run from a junction tile to the nearer map edge. */
function highwayExit(world: World, junction: number): Int32Array {
  const route = world.highwayRoute;
  const size = world.size;
  const jx = junction % size;
  const jy = Math.floor(junction / size);
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < route.length; i++) {
    const point = route[i] as { x: number; y: number };
    const d = Math.abs(point.x - jx) + Math.abs(point.y - jy);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  if (best < 0) return new Int32Array(0);
  const toStart = best;
  const toEnd = route.length - 1 - best;
  const count = Math.min(toStart, toEnd);
  if (count === 0) return new Int32Array(0);
  const forward = toEnd <= toStart;
  const out = new Int32Array(count);
  for (let k = 0; k < count; k++) {
    const i = forward ? best + 1 + k : best - 1 - k;
    const point = route[i] as { x: number; y: number };
    out[k] = point.y * size + point.x;
  }
  return out;
}

// --- Driving -------------------------------------------------------------------

/**
 * Moves one vehicle along its path. Returns false when the trip is done or
 * the road ahead is no longer road — the caller hands out the next trip.
 */
function advance(v: Vehicle, deltaSeconds: number, g: Graph, load: Float32Array): boolean {
  if (v.at >= v.path.length) return false;
  const next = v.path[v.at] as number;
  const tierSpeed = g.speed[next] ?? 0;
  if (tierSpeed <= 0) return false; // demolished from under the wheels
  const jam = 1 - 0.6 * Math.min(1, load[next] ?? 0);
  v.t += deltaSeconds * v.speedScale * tierSpeed * 1.1 * jam;
  while (v.t >= 1) {
    v.t -= 1;
    const reached = v.path[v.at] as number;
    v.x = reached % g.size;
    v.z = Math.floor(reached / g.size);
    v.at++;
    if (v.at >= v.path.length) return false; // arrived
    if ((g.speed[v.path[v.at] as number] ?? 0) <= 0) return false;
  }
  return true;
}

interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** World position between path tiles, with a right-hand lane offset. */
function poseOf(v: Vehicle, g: Graph): Pose {
  const size = g.size;
  const at = Math.max(1, Math.min(v.at, v.path.length - 1));
  const prevIndex = v.path[at - 1] as number;
  const nextIndex = v.path[at] as number;
  const px = prevIndex % size;
  const pz = Math.floor(prevIndex / size);
  const nx = nextIndex % size;
  const nz = Math.floor(nextIndex / size);
  const heading = Math.atan2(nx - px, nz - pz);
  const x = (px + (nx - px) * v.t) * TILE + Math.cos(heading) * LANE_OFFSET * TILE;
  const z = (pz + (nz - pz) * v.t) * TILE - Math.sin(heading) * LANE_OFFSET * TILE;
  return { x, z, heading };
}

function placeAtStart(v: Vehicle, g: Graph, path: Int32Array): void {
  const first = path[0] as number;
  v.x = first % g.size;
  v.z = Math.floor(first / g.size);
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3(1, 1, 1);
const scratchEuler = new THREE.Euler();

function composeMatrix(
  pose: Pose,
  v: Vehicle,
  world: World,
  flying: boolean,
  seconds: number,
): THREE.Matrix4 {
  // Tile space, like every other layer: the terrain, the buildings and the
  // roads all render at raw tile coordinates. (A centered offset here once put
  // the whole fleet half a map away from its own streets — "cars exist but
  // never reach my city".)
  const wx = pose.x;
  const wz = pose.z;
  const ground = Math.max(sampleHeight(world, pose.x, pose.z), SEA_Y);
  // The space age: from 2050 the fleet rides above the road, not on it — a
  // gentle bob per vehicle so the sky lane reads as traffic, not a glitch.
  const lift = flying ? 1.5 + 0.3 * Math.sin(seconds * 1.8 + v.seed * 40) : 0;
  scratchPosition.set(wx, ground + ROAD_LIFT + CAR_Y + lift, wz);
  scratchEuler.set(0, pose.heading, flying ? Math.sin(seconds * 2.2 + v.seed * 30) * 0.04 : 0);
  scratchQuaternion.setFromEuler(scratchEuler);
  const squash = v.truck ? 1.25 : 0.9 + v.seed * 0.2;
  scratchScale.set(squash, 1, squash);
  return scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
}

/** Haulage-firm colours for cabs; the trailer stays cargo-dark either way. */
const TRUCK_PAINTS = [0xeceded, 0x2e4053, 0xca6f1e, 0x1d8348, 0xb03a2e];
const scratchColor = new THREE.Color();

/**
 * Body colour, from the age the city is in.
 *
 * Trucks keep their haulage palette throughout: a firm's livery is a firm's
 * livery, and a black-only fleet of lorries reads as a rendering fault rather
 * than as 1925.
 */
function vehicleColor(v: Vehicle, age: VehicleAge): THREE.Color {
  const palette = v.truck ? TRUCK_PAINTS : age.paints;
  return scratchColor.setHex(palette[Math.floor(v.seed * 997) % palette.length] as number);
}

// --- Appearance ----------------------------------------------------------------

const PAINT_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.35,
  metalness: 0.25,
});
const TRIM_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x2c3e50,
  roughness: 0.55,
  metalness: 0.15,
});
const TRIM_MATERIALS = [PAINT_MATERIAL, TRIM_MATERIAL];

/**
 * A car with a bonnet, a cabin, glass and wheels — a long way from the old
 * two-box lozenge, still one draw call for the whole fleet. Group 0 takes the
 * per-instance paint; group 1 is the shared trim (glass, tyres).
 */
function buildCarGeometry(): THREE.BufferGeometry {
  return mergeBoxes([
    { box: [-0.34, 0.05, -0.36, 0.34, 0.19, 0.36], paint: true }, // body
    { box: [-0.28, 0.19, -0.08, 0.28, 0.32, 0.24], paint: true }, // cabin
    { box: [-0.29, 0.2, -0.06, 0.29, 0.29, 0.22], paint: false }, // glass band
    { box: [-0.37, 0.0, -0.36, -0.23, 0.14, -0.16], paint: false }, // wheels
    { box: [0.23, 0.0, -0.36, 0.37, 0.14, -0.16], paint: false },
    { box: [-0.37, 0.0, 0.16, -0.23, 0.14, 0.36], paint: false },
    { box: [0.23, 0.0, 0.16, 0.37, 0.14, 0.36], paint: false },
  ]);
}

/**
 * A cart: bed, two big wheels, and the animal in front as one dark block. No
 * cabin and no glass, which is most of what makes it read as pre-motor at a
 * glance.
 */
function buildCartGeometry(): THREE.BufferGeometry {
  return mergeBoxes([
    { box: [-0.3, 0.12, -0.14, 0.3, 0.28, 0.3], paint: true }, // bed
    { box: [-0.26, 0.28, -0.1, 0.26, 0.34, 0.26], paint: true }, // load
    { box: [-0.33, 0.0, 0.04, -0.21, 0.24, 0.16], paint: false }, // wheels
    { box: [0.21, 0.0, 0.04, 0.33, 0.24, 0.16], paint: false },
    { box: [-0.28, 0.0, -0.16, -0.19, 0.16, -0.07], paint: false },
    { box: [0.19, 0.0, -0.16, 0.28, 0.16, -0.07], paint: false },
    { box: [-0.16, 0.1, -0.5, 0.16, 0.36, -0.18], paint: false }, // the horse
  ]);
}

/**
 * An early motor car: tall, narrow, upright cabin, wheels that stand proud of
 * the body. The silhouette is the period, not the paint.
 */
function buildEarlyCarGeometry(): THREE.BufferGeometry {
  return mergeBoxes([
    { box: [-0.26, 0.08, -0.34, 0.26, 0.22, 0.3], paint: true }, // body
    { box: [-0.22, 0.22, -0.02, 0.22, 0.42, 0.24], paint: true }, // upright cabin
    { box: [-0.23, 0.26, 0.0, 0.23, 0.38, 0.21], paint: false }, // glass
    { box: [-0.33, 0.0, -0.34, -0.19, 0.2, -0.14], paint: false }, // proud wheels
    { box: [0.19, 0.0, -0.34, 0.33, 0.2, -0.14], paint: false },
    { box: [-0.33, 0.0, 0.1, -0.19, 0.2, 0.3], paint: false },
    { box: [0.19, 0.0, 0.1, 0.33, 0.2, 0.3], paint: false },
  ]);
}

/** Cab, box trailer, six wheels: freight reads as freight at any zoom. */
function buildTruckGeometry(): THREE.BufferGeometry {
  return mergeBoxes([
    { box: [-0.36, 0.06, 0.16, 0.36, 0.34, 0.44], paint: true }, // cab
    { box: [-0.3, 0.26, 0.34, 0.3, 0.34, 0.45], paint: false }, // windshield
    { box: [-0.38, 0.1, -0.48, 0.38, 0.44, 0.1], paint: false }, // trailer
    { box: [-0.41, 0.0, 0.24, -0.27, 0.16, 0.42], paint: false }, // wheels
    { box: [0.27, 0.0, 0.24, 0.41, 0.16, 0.42], paint: false },
    { box: [-0.41, 0.0, -0.08, -0.27, 0.16, 0.08], paint: false },
    { box: [0.27, 0.0, -0.08, 0.41, 0.16, 0.08], paint: false },
    { box: [-0.41, 0.0, -0.44, -0.27, 0.16, -0.28], paint: false },
    { box: [0.27, 0.0, -0.44, 0.41, 0.16, -0.28], paint: false },
  ]);
}

/** Merges painted and trim boxes into one two-group geometry. */
function mergeBoxes(
  parts: { box: [number, number, number, number, number, number]; paint: boolean }[],
): THREE.BufferGeometry {
  const boxes = parts.map((part) => {
    const [x0, y0, z0, x1, y1, z1] = part.box;
    const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return { geometry, paint: part.paint };
  });
  const merged = mergeGeometries(boxes.map((b) => b.geometry));
  let cursor = 0;
  for (const b of boxes) {
    const count = b.geometry.getAttribute('position').count;
    merged.addGroup(cursor, count, b.paint ? 0 : 1);
    cursor += count;
  }
  return merged;
}

/** Minimal merge of positions/normals/uvs, enough for identical box parts. */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.getAttribute('position').count;
    indexCount += g.getIndex()?.count ?? 0;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  let vertexCursor = 0;
  let indexCursor = 0;
  for (const g of geometries) {
    const position = g.getAttribute('position') as THREE.BufferAttribute;
    const normal = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    positions.set(position.array as Float32Array, vertexCursor * 3);
    normals.set(normal.array as Float32Array, vertexCursor * 3);
    uvs.set(uv.array as Float32Array, vertexCursor * 2);
    const index = g.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) {
        indices[indexCursor + i] = index.getX(i) + vertexCursor;
      }
      indexCursor += index.count;
    }
    vertexCursor += position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}
