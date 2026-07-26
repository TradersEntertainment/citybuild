import * as THREE from 'three';
import type { World } from '../sim/world';
import { buildBridgeGeometry } from './bridgeGeometry';
import { buildRoadGeometry } from './roadGeometry';

/**
 * Road surfaces as geometry laid over the ground. A road tile becomes a quad
 * that takes its four heights from the terrain beneath it, so a road climbing a
 * hill climbs with it instead of hovering — the reason the surface is built
 * from the height field rather than dropped on a plane.
 *
 * Everything is merged into one geometry per pass and rebuilt when the road
 * column changes, which is rare and already has a hook (§18). Per-tile meshes
 * would be thousands of draw calls for a city that is mostly one flat colour.
 */
export interface RoadMesh {
  readonly group: THREE.Group;
  rebuild(): void;
  dispose(): void;
}

export function createRoads(world: World): RoadMesh {
  const group = new THREE.Group();
  group.name = 'roads';

  const surfaceMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02,
  });
  // Markings are unlit-ish and never shadowed: worn paint that still reads at
  // dusk, rather than a stripe that vanishes under a tower's shadow.
  const markingMaterial = new THREE.MeshStandardMaterial({
    color: '#D8D3C4',
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  // The structure under a water crossing: slab, parapets, piers. Its own
  // material because it is the one part of a road that is not a flat surface —
  // it needs shadows both ways and no polygon offset.
  const bridgeMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.04,
  });

  const surface = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial);
  surface.receiveShadow = true;
  surface.castShadow = false;
  const markings = new THREE.Mesh(new THREE.BufferGeometry(), markingMaterial);
  markings.receiveShadow = false;
  const bridges = new THREE.Mesh(new THREE.BufferGeometry(), bridgeMaterial);
  bridges.castShadow = true;
  bridges.receiveShadow = true;
  bridges.visible = false;
  group.add(surface, markings, bridges);

  const rebuild = (): void => {
    surface.geometry.dispose();
    markings.geometry.dispose();
    bridges.geometry.dispose();
    const built = buildRoadGeometry(world);
    surface.geometry = built.surface;
    markings.geometry = built.markings;
    // The deck the road surface was actually built on, so the piers reach the
    // underside of the tarmac rather than to a height computed twice.
    const built3d = buildBridgeGeometry(world, built.deck);
    bridges.geometry = built3d.geometry;
    // Most maps have a crossing somewhere; the ones that do not skip the mesh
    // entirely rather than drawing an empty buffer every frame.
    bridges.visible = built3d.tiles > 0;
  };

  rebuild();

  return {
    group,
    rebuild,
    dispose: () => {
      surface.geometry.dispose();
      markings.geometry.dispose();
      bridges.geometry.dispose();
      surfaceMaterial.dispose();
      markingMaterial.dispose();
      bridgeMaterial.dispose();
      group.clear();
    },
  };
}
