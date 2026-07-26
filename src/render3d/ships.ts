import * as THREE from 'three';
import { PORT_SPECS, type PortKind } from '../data/ports';
import type { GameState } from '../sim/state';
import { inBounds, index } from '../sim/world';
import { isWater } from '../sim/worldgen';
import { pushColouredBox, pushTriangle, toMeshGeometry } from './boxMesh';
import { LOD_TRAFFIC_DISTANCE, SEA_Y } from './constants';

/**
 * Ships.
 *
 * The berths are the investment; this is the proof it was worth making. A cargo
 * port with nothing on the water in front of it reads as a warehouse that
 * happens to be near a lake, and the whole point of the sea branch is that the
 * coast is *busy* — so every working berth gets traffic, and the traffic is
 * visible from the map height the game is actually played at.
 *
 * Presentation only, like every other layer in here: a ship never earns the city
 * a lira. It follows an outbound lane found once per berth by walking away from
 * the shore across open water, and then runs up and down it forever. That is
 * enough — nobody is going to audit a freighter's schedule, and a real
 * pathfinder over water would be a second traffic system for no gameplay.
 */
export interface ShipLayer {
  readonly group: THREE.Group;
  /** The berths changed: re-find the lanes. */
  rebuild(state: GameState): void;
  update(deltaSeconds: number, state: GameState, cameraDistance: number): void;
  dispose(): void;
}

/** Ships per working berth, by what the berth is for. */
const FLEET_SIZE: Readonly<Record<PortKind, number>> = {
  fishing: 3,
  cargo: 2,
  shipyard: 1,
  marina: 4,
};

/** Tiles a second. A freighter is slow; that is most of what makes it read big. */
const SPEED: Readonly<Record<PortKind, number>> = {
  fishing: 1.6,
  cargo: 0.9,
  shipyard: 0.5,
  marina: 2.1,
};

const MAX_SHIPS = 90;
/** How far out to sea a lane is allowed to reach before it gives up. */
const LANE_MAX = 40;

interface Ship {
  kind: PortKind;
  /** Lane start, at the berth. */
  x0: number;
  z0: number;
  /** Lane end, out to sea. */
  x1: number;
  z1: number;
  /** 0..1 along the lane. */
  t: number;
  /** +1 outbound, −1 coming home. */
  way: 1 | -1;
  speed: number;
  bob: number;
}

export function createShips(): ShipLayer {
  const group = new THREE.Group();
  group.name = 'ships';

  // Two silhouettes: a hull for working boats and a hull with a sail for the
  // marina. Anything more would be a boat museum nobody zooms in far enough
  // to visit.
  const hullGeometry = buildHullGeometry();
  const sailGeometry = buildSailGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.08,
  });
  const hulls = new THREE.InstancedMesh(hullGeometry, material, MAX_SHIPS);
  const sails = new THREE.InstancedMesh(sailGeometry, material, MAX_SHIPS);
  for (const mesh of [hulls, sails]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.count = 0;
    group.add(mesh);
  }

  const ships: Ship[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const scratch = new THREE.Color();
  let clock = 0;

  const rebuild = (state: GameState): void => {
    ships.length = 0;
    for (const port of state.ports.values()) {
      const spec = PORT_SPECS[port.kind];
      const lane = findLane(state, port.x, port.y);
      if (!lane) continue;
      const fleet = FLEET_SIZE[port.kind];
      for (let n = 0; n < fleet && ships.length < MAX_SHIPS; n++) {
        ships.push({
          kind: port.kind,
          x0: port.x + 0.5,
          z0: port.y + 0.5,
          x1: lane.x + 0.5,
          z1: lane.y + 0.5,
          // Spread along the lane rather than stacked at the jetty, or a berth
          // would appear to launch its whole fleet in formation.
          t: (n + 0.5) / fleet,
          way: n % 2 === 0 ? 1 : -1,
          speed: SPEED[port.kind] / Math.max(1, lane.length),
          bob: n * 1.7 + spec.reach,
        });
      }
    }
  };

  const update = (deltaSeconds: number, state: GameState, cameraDistance: number): void => {
    clock += deltaSeconds;
    if (cameraDistance > LOD_TRAFFIC_DISTANCE || ships.length === 0) {
      hulls.count = 0;
      sails.count = 0;
      return;
    }

    let hullCount = 0;
    let sailCount = 0;
    for (const ship of ships) {
      ship.t += ship.way * ship.speed * deltaSeconds;
      if (ship.t > 1) {
        ship.t = 1;
        ship.way = -1;
      } else if (ship.t < 0) {
        ship.t = 0;
        ship.way = 1;
      }

      const x = ship.x0 + (ship.x1 - ship.x0) * ship.t;
      const z = ship.z0 + (ship.z1 - ship.z0) * ship.t;
      // Riding the surface, not the bed: a hull sits in the water by definition,
      // and the seabed under it is nobody's business.
      const roll = Math.sin(clock * 1.1 + ship.bob) * 0.03;
      position.set(x, SEA_Y + 0.04 + Math.sin(clock * 0.8 + ship.bob) * 0.02, z);
      const heading = Math.atan2(
        (ship.x1 - ship.x0) * ship.way,
        (ship.z1 - ship.z0) * ship.way,
      );
      quaternion.setFromAxisAngle(axis, heading);
      matrix.compose(position, quaternion, SCALE[ship.kind] as THREE.Vector3);
      // Rolling is a rotation about the hull's own long axis, which composing
      // from a single quaternion cannot express — so it is folded into the
      // matrix afterwards, which is cheap and only ever a few degrees.
      matrix.multiply(rollMatrix(roll));

      scratch.setHex(PAINTS[ship.kind] as number);
      if (ship.kind === 'marina') {
        if (sailCount >= MAX_SHIPS) continue;
        sails.setMatrixAt(sailCount, matrix);
        sails.setColorAt(sailCount, scratch);
        sailCount++;
      } else {
        if (hullCount >= MAX_SHIPS) continue;
        hulls.setMatrixAt(hullCount, matrix);
        hulls.setColorAt(hullCount, scratch);
        hullCount++;
      }
    }

    hulls.count = hullCount;
    sails.count = sailCount;
    if (hullCount > 0) {
      hulls.instanceMatrix.needsUpdate = true;
      if (hulls.instanceColor) hulls.instanceColor.needsUpdate = true;
    }
    if (sailCount > 0) {
      sails.instanceMatrix.needsUpdate = true;
      if (sails.instanceColor) sails.instanceColor.needsUpdate = true;
    }
    void state;
  };

  return {
    group,
    rebuild,
    update,
    dispose: () => {
      group.remove(hulls, sails);
      hulls.dispose();
      sails.dispose();
      hullGeometry.dispose();
      sailGeometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}

const PAINTS: Readonly<Record<PortKind, number>> = {
  fishing: 0x2f6e8c,
  cargo: 0x8a3b2c,
  shipyard: 0x53585c,
  marina: 0xf2f0e8,
};

/** A freighter is not a fishing boat, and length is how an eye tells them apart. */
const SCALE: Readonly<Record<PortKind, THREE.Vector3>> = {
  fishing: new THREE.Vector3(0.8, 0.8, 0.9),
  cargo: new THREE.Vector3(1.5, 1.2, 2.6),
  shipyard: new THREE.Vector3(1.7, 1.3, 3),
  marina: new THREE.Vector3(0.6, 0.9, 0.8),
};

/**
 * Finds where a berth's ships go: the furthest open-water tile reachable by
 * walking away from the shore.
 *
 * A flood fill over water from the berth, keeping whichever tile ends up
 * furthest away. That is the open sea by construction — the fill cannot leave
 * the water, so the far end of it is the far end of the water — and it costs one
 * bounded search per berth, at the moment the berths change.
 */
function findLane(
  state: GameState,
  fromX: number,
  fromY: number,
): { x: number; y: number; length: number } | null {
  const world = state.world;
  const seen = new Set<number>();
  let frontier: { x: number; y: number }[] = [];

  for (let d = 0; d < 4; d++) {
    const nx = fromX + DX[d]!;
    const ny = fromY + DY[d]!;
    if (!inBounds(world, nx, ny) || !isWater(world, nx, ny)) continue;
    seen.add(index(world, nx, ny));
    frontier.push({ x: nx, y: ny });
  }
  if (frontier.length === 0) return null;

  let best = frontier[0] as { x: number; y: number };
  let distance = 1;
  for (let step = 0; step < LANE_MAX && frontier.length > 0; step++) {
    const next: { x: number; y: number }[] = [];
    for (const at of frontier) {
      for (let d = 0; d < 4; d++) {
        const nx = at.x + DX[d]!;
        const ny = at.y + DY[d]!;
        if (!inBounds(world, nx, ny) || !isWater(world, nx, ny)) continue;
        const i = index(world, nx, ny);
        if (seen.has(i)) continue;
        seen.add(i);
        next.push({ x: nx, y: ny });
      }
    }
    if (next.length === 0) break;
    frontier = next;
    best = frontier[Math.floor(frontier.length / 2)] as { x: number; y: number };
    distance = step + 2;
  }

  // A puddle is not a shipping lane; a boat that never left the jetty would look
  // broken rather than idle.
  if (distance < 3) return null;
  return { x: best.x, y: best.y, length: distance };
}

const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;

const roll = new THREE.Matrix4();
function rollMatrix(radians: number): THREE.Matrix4 {
  return roll.makeRotationZ(radians);
}

/**
 * Shades for the parts that are not the hull. These multiply the per-instance
 * paint, so a deckhouse is always a little darker than whatever colour the boat
 * turns out to be and a sail is always near white.
 */
const DECK = new THREE.Color(0.82, 0.82, 0.8);
const MAST = new THREE.Color(0.4, 0.36, 0.32);
const CANVAS = new THREE.Color(0.98, 0.98, 0.95);

/** A hull: pointed bow, flat stern, low deckhouse. Colour on the hull only. */
function buildHullGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  // The hull as a wedge, so the bow reads as a bow at any zoom.
  wedge(positions, colours, 0.22, 0.12, 0.55, 1, 1, 1);
  pushColouredBox(positions, colours, -0.11, 0.12, -0.16, 0.11, 0.26, 0.1, DECK);
  return toMeshGeometry(positions, colours);
}

/** The same hull with a sail: the only thing on the water that is not working. */
function buildSailGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  wedge(positions, colours, 0.18, 0.1, 0.46, 1, 1, 1);
  // Mast and sail as one thin upright slab; a triangle would need its own winding.
  pushColouredBox(positions, colours, -0.015, 0.1, -0.1, 0.015, 0.62, 0.1, MAST);
  pushColouredBox(positions, colours, -0.008, 0.16, -0.06, 0.008, 0.58, 0.24, CANVAS);
  return toMeshGeometry(positions, colours);
}

/**
 * A hull-shaped solid: a box whose bow end is pinched to a point.
 *
 * Written by hand rather than lathed or extruded, because it is eight vertices
 * and the alternative pulls in geometry utilities for one shape.
 */
function wedge(
  positions: number[],
  colours: number[],
  halfWidth: number,
  height: number,
  halfLength: number,
  r: number,
  g: number,
  b: number,
): void {
  const bow = halfLength;
  const stern = -halfLength;
  const w = halfWidth;
  // Deck corners, bow pinched.
  const deck: [number, number][] = [
    [0, bow],
    [w, bow - halfLength * 0.55],
    [w, stern],
    [-w, stern],
    [-w, bow - halfLength * 0.55],
  ];

  // Deck, as a fan from the bow.
  for (let i = 1; i + 1 < deck.length; i++) {
    pushTriangle(
      positions,
      colours,
      [deck[0]![0], height, deck[0]![1]],
      [deck[i]![0], height, deck[i]![1]],
      [deck[i + 1]![0], height, deck[i + 1]![1]],
      r,
      g,
      b,
    );
  }
  // Hull sides, and the flat bottom as the same fan wound the other way.
  for (let i = 0; i < deck.length; i++) {
    const a = deck[i] as [number, number];
    const c = deck[(i + 1) % deck.length] as [number, number];
    pushTriangle(positions, colours, [a[0], 0, a[1]], [a[0], height, a[1]], [c[0], height, c[1]], r * 0.8, g * 0.8, b * 0.8);
    pushTriangle(positions, colours, [a[0], 0, a[1]], [c[0], height, c[1]], [c[0], 0, c[1]], r * 0.8, g * 0.8, b * 0.8);
  }
  for (let i = 1; i + 1 < deck.length; i++) {
    pushTriangle(
      positions,
      colours,
      [deck[0]![0], 0, deck[0]![1]],
      [deck[i + 1]![0], 0, deck[i + 1]![1]],
      [deck[i]![0], 0, deck[i]![1]],
      r * 0.6,
      g * 0.6,
      b * 0.6,
    );
  }
}

