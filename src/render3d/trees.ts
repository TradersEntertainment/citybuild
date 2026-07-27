import * as THREE from 'three';
import { decodeTerrain, NONE } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { sampleHeight } from './terrain';

/**
 * Woodland as geometry. A forest painted on the ground reads as a green stain
 * from any angle a 3D camera can take, so the trees have to be objects — and
 * because a wooded map has tens of thousands of them, they have to be one
 * instanced draw call.
 *
 * Trees are placed from a tile hash rather than a random sequence, so the same
 * map always grows the same wood and a rebuild after an edit does not shuffle
 * the untouched forest.
 */
const TRUNK_COLOUR = '#4A3A2A';

export interface TreeLayer {
  readonly group: THREE.Group;
  /** Re-places trees; call when terrain or road/zone occupancy changes. */
  rebuild(): void;
  /**
   * Recolours the foliage for the time of year (sim/seasons.ts).
   *
   * A multiply on the shared material rather than a rebuild of the instances:
   * the crowns are the same geometry in February and August, only a different
   * colour, and rebuilding forty thousand trees four times a year to say so
   * would be the most expensive way imaginable to change a hue.
   */
  setSeasonTint(tint: THREE.Color): void;
  dispose(): void;
}

/**
 * The most triangles in the game, and the cheapest to give up.
 *
 * Measured in a browser on a 30-lane city: 1.6 million triangles in the frame,
 * and the woods were most of them — three trees per forest tile with no ceiling,
 * on a map of sixty-five thousand tiles. Our own JavaScript was 11.7 ms of that
 * frame; the rest was rasterisation, and half of it was foliage drawn twice
 * because every tree cast a shadow.
 *
 * A tree's shadow is a few pixels at the height this game is played at, and the
 * cap thins the wood evenly by hash rather than cutting it off at a map edge —
 * so a forest still reads as a forest, and the bill for it stops growing with
 * the size of the map.
 */
const MAX_TREES = 9_000;

export function createTrees(world: World): TreeLayer {
  const group = new THREE.Group();
  group.name = 'trees';

  // Two crown tones, drawn as two instanced meshes, so a wood is not one flat
  // colour. Cheaper than a per-instance colour attribute and reads the same.
  const crownGeometry = buildCrownGeometry();
  const trunkGeometry = new THREE.CylinderGeometry(0.028, 0.038, 0.22, 5);
  trunkGeometry.translate(0, 0.11, 0);

  const crownMaterials = [
    new THREE.MeshStandardMaterial({ color: '#33512A', roughness: 0.92, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#42632F', roughness: 0.92, flatShading: true }),
  ];
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: TRUNK_COLOUR,
    roughness: 1,
  });

  const crownBase = crownMaterials.map((material) => material.color.clone());
  const setSeasonTint = (tint: THREE.Color): void => {
    for (let i = 0; i < crownMaterials.length; i++) {
      const material = crownMaterials[i] as THREE.MeshStandardMaterial;
      const base = crownBase[i] as THREE.Color;
      material.color.setRGB(base.r * tint.r, base.g * tint.g, base.b * tint.b);
    }
  };

  let crowns: THREE.InstancedMesh[] = [];
  let trunks: THREE.InstancedMesh | null = null;

  const clear = (): void => {
    for (const mesh of crowns) {
      group.remove(mesh);
      mesh.dispose();
    }
    crowns = [];
    if (trunks) {
      group.remove(trunks);
      trunks.dispose();
      trunks = null;
    }
  };

  const rebuild = (): void => {
    clear();
    const spots = thin(collectTreeSpots(world));
    if (spots.length === 0) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);

    const half = Math.ceil(spots.length / 2);
    const buckets = [spots.slice(0, half), spots.slice(half)];

    trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, spots.length);
    // Foliage does not cast. It is the single biggest saving available: the
    // shadow pass rasterises the whole wood a second time for an effect that is
    // a few pixels wide from the map camera and invisible from the street.
    trunks.castShadow = false;
    trunks.receiveShadow = false;
    trunks.frustumCulled = false;

    let trunkIndex = 0;
    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b] as TreeSpot[];
      const mesh = new THREE.InstancedMesh(
        crownGeometry,
        crownMaterials[b] as THREE.Material,
        Math.max(1, bucket.length),
      );
      mesh.castShadow = false;
      // Kept: a wood standing in a tower's shadow should be dark, and that costs
      // a lookup rather than a whole extra pass over every leaf.
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;

      for (let i = 0; i < bucket.length; i++) {
        const spot = bucket[i] as TreeSpot;
        position.set(spot.x, spot.y, spot.z);
        quaternion.setFromAxisAngle(axis, spot.spin);
        scale.set(spot.scale, spot.scale * spot.stretch, spot.scale);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);

        // The trunk sits under the same crown, scaled to match.
        scale.set(spot.scale, spot.scale * spot.stretch, spot.scale);
        matrix.compose(position, quaternion, scale);
        trunks.setMatrixAt(trunkIndex++, matrix);
      }
      mesh.count = bucket.length;
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      crowns.push(mesh);
    }

    trunks.count = trunkIndex;
    trunks.instanceMatrix.needsUpdate = true;
    group.add(trunks);
  };

  rebuild();

  return {
    group,
    rebuild,
    setSeasonTint,
    dispose: () => {
      clear();
      crownGeometry.dispose();
      trunkGeometry.dispose();
      for (const material of crownMaterials) material.dispose();
      trunkMaterial.dispose();
      group.clear();
    },
  };
}

interface TreeSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
  stretch: number;
  spin: number;
}

/**
 * One to three trees per forest tile, skipping anything the player has built
 * on. Roads and buildings clear their own ground — a tree standing in the
 * carriageway is the single most obvious way for a generated forest to look
 * generated.
 */
/**
 * Thins a wood down to the ceiling, evenly.
 *
 * Every nth tree rather than the first N: taking a prefix would leave the top of
 * the map wooded and the bottom bare, because the spots are collected in row
 * order. Deterministic, so the same map always grows the same wood.
 */
function thin(spots: TreeSpot[]): TreeSpot[] {
  if (spots.length <= MAX_TREES) return spots;
  const keep: TreeSpot[] = [];
  const stride = spots.length / MAX_TREES;
  for (let i = 0; i < MAX_TREES; i++) keep.push(spots[Math.floor(i * stride)] as TreeSpot);
  return keep;
}

function collectTreeSpots(world: World): TreeSpot[] {
  const spots: TreeSpot[] = [];
  for (let ty = 0; ty < world.size; ty++) {
    for (let tx = 0; tx < world.size; tx++) {
      const i = index(world, tx, ty);
      if (decodeTerrain(world.terrain[i] ?? 0) !== 'forest') continue;
      if ((world.road[i] ?? NONE) !== NONE) continue;
      if ((world.building[i] ?? 0) !== 0) continue;
      // Zoned land is being cleared for development, so it thins out.
      const zoned = (world.zone[i] ?? NONE) !== NONE;

      const density = hashUnit(tx, ty, 3);
      const count = zoned ? (density > 0.8 ? 1 : 0) : density > 0.66 ? 3 : density > 0.28 ? 2 : 1;

      for (let n = 0; n < count; n++) {
        const ox = 0.18 + hashUnit(tx + n * 13, ty, 11) * 0.64;
        const oz = 0.18 + hashUnit(tx, ty + n * 17, 23) * 0.64;
        const x = tx + ox;
        const z = ty + oz;
        spots.push({
          x,
          y: sampleHeight(world, x, z),
          z,
          scale: 0.72 + hashUnit(tx + n, ty + n, 31) * 0.66,
          stretch: 0.85 + hashUnit(tx, ty + n, 37) * 0.5,
          spin: hashUnit(tx + n, ty, 41) * Math.PI * 2,
        });
      }
    }
  }
  return spots;
}

/**
 * A conifer as two stacked cones. Flat-shaded and five-sided: at the scale a
 * tree occupies on screen, more geometry buys nothing a silhouette does not
 * already give.
 */
function buildCrownGeometry(): THREE.BufferGeometry {
  const lower = new THREE.ConeGeometry(0.24, 0.42, 6);
  lower.translate(0, 0.34, 0);
  const upper = new THREE.ConeGeometry(0.17, 0.36, 6);
  upper.translate(0, 0.6, 0);

  const merged = mergePositions([lower, upper]);
  lower.dispose();
  upper.dispose();
  return merged;
}

/** Minimal geometry merge: positions and normals only, which is all a tree needs. */
function mergePositions(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const part of parts) {
    const nonIndexed = part.index ? part.toNonIndexed() : part;
    const attribute = nonIndexed.getAttribute('position');
    for (let i = 0; i < attribute.count; i++) {
      positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
    }
    if (nonIndexed !== part) nonIndexed.dispose();
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
