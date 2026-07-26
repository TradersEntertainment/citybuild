import * as THREE from 'three';

/**
 * Axis-aligned boxes as raw triangles.
 *
 * Three layers arrived within a week of each other that each needed the same
 * thing — bridge slabs and piers, scaffold poles and crane jibs, ship
 * deckhouses — and each grew its own copy of the same twelve triangles wound
 * outward. Three copies of a box emitter is three chances to wind one of them
 * inside-out, which is a bug that is invisible from outside and black from
 * within, and exactly the one the archetype roofs already shipped once.
 *
 * `BoxGeometry` plus `translate` plus a merge would do the same job, and would
 * allocate a geometry object per box — several hundred of them on every road
 * edit. These push straight into flat arrays instead.
 */

/** One box, twelve triangles, every face wound anticlockwise seen from outside. */
export function pushBox(
  positions: number[],
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): number {
  // Never inside-out, whatever order the caller passed the corners in.
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  const az = Math.min(z0, z1);
  const bz = Math.max(z0, z1);
  // A box with no thickness has no normals worth computing; skipping it beats
  // emitting degenerate triangles that light as black slivers.
  if (bx - ax < 1e-5 || by - ay < 1e-5 || bz - az < 1e-5) return 0;

  const before = positions.length;
  for (const face of FACES) {
    for (const [cx, cy, cz] of face) {
      positions.push(cx ? bx : ax, cy ? by : ay, cz ? bz : az);
    }
  }
  return (positions.length - before) / 3;
}

/** The same, also writing one colour per vertex added. */
export function pushColouredBox(
  positions: number[],
  colours: number[],
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  colour: THREE.Color,
): void {
  const added = pushBox(positions, x0, y0, z0, x1, y1, z1);
  for (let v = 0; v < added; v++) colours.push(colour.r, colour.g, colour.b);
}

/** One triangle with a flat colour. For the shapes a box cannot make. */
export function pushTriangle(
  positions: number[],
  colours: number[] | null,
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  r = 1,
  g = 1,
  bl = 1,
): void {
  positions.push(a[0] as number, a[1] as number, a[2] as number);
  positions.push(b[0] as number, b[1] as number, b[2] as number);
  positions.push(c[0] as number, c[1] as number, c[2] as number);
  if (colours) for (let v = 0; v < 3; v++) colours.push(r, g, bl);
}

export function toMeshGeometry(
  positions: number[],
  colours: number[] | null,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colours) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type Corner = readonly [0 | 1, 0 | 1, 0 | 1];

const FACES: readonly (readonly Corner[])[] = [
  // −z, +z
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
    [0, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
  ],
  // −x, +x
  [
    [0, 0, 0],
    [0, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
    [0, 1, 1],
    [0, 0, 1],
  ],
  [
    [1, 0, 0],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 1],
    [1, 1, 0],
  ],
  // −y, +y
  [
    [0, 0, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 0, 0],
    [1, 0, 1],
    [1, 0, 0],
  ],
  [
    [0, 1, 0],
    [1, 1, 0],
    [1, 1, 1],
    [0, 1, 0],
    [1, 1, 1],
    [0, 1, 1],
  ],
];
