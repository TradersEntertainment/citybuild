import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBuildings, type FacadeSkins } from '../src/render3d/buildings';
import { createLens } from '../src/render3d/lens';
import { createStations } from '../src/render3d/stations';
import type { Building } from '../src/sim/buildings';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';

/**
 * What the instanced layers hold on the GPU, and the leak that killed the tab.
 *
 * A playtester's browser died with "Out of Memory" repeatedly. The cause was
 * here: an InstancedMesh whose capacity fills up is replaced by one of twice
 * the size, and the replacement used to rebuild the entire archetype with it —
 * two generated CanvasTextures, two materials and a geometry per doubling —
 * while disposing only the mesh. WebGL resources are not garbage collected, and
 * the leaked ones were pushed onto arrays that are drained only at teardown, so
 * nothing could reclaim them either. Measured in a browser before the fix: a
 * city growing to five hundred buildings drove the texture count from 3 to 29
 * and it never fell. A long game climbs until the tab is killed.
 *
 * The generated facades need a `<canvas>` and this runner has none, so the two
 * texture factories are injected. That seam exists for this test: a leak that
 * only a five-minute browser session can see is a leak that comes back.
 */

/** Stand-ins for the generated canvases, counted rather than drawn. */
function countingSkins(): FacadeSkins & { made: number } {
  const state = {
    made: 0,
    facade(): THREE.Texture {
      state.made++;
      return new THREE.Texture();
    },
    emissive(): THREE.Texture {
      state.made++;
      return new THREE.Texture();
    },
  };
  return state;
}

/**
 * A city of `count` identical houses, which all land in one bucket.
 *
 * `playedMs` is well past the rise animation on purpose. Buildings still coming
 * out of the ground are skipped before they are counted, so a fixture at time
 * zero fills no bucket, doubles nothing, and passes a leak test by never
 * exercising the leak — which is exactly what the first draft of this file did.
 */
function cityOf(count: number): GameState {
  const game = createGameState(hashSeed('meshes'), 0);
  game.playedMs = 60_000;
  for (let i = 0; i < count; i++) {
    const building: Building = {
      id: i + 1,
      x: 20 + (i % 200),
      y: 20 + Math.floor(i / 200),
      w: 1,
      h: 1,
      zone: 'res',
      level: 1,
      score: 0.8,
      growthProgress: 0,
      decayTimer: 0,
      population: 4,
      jobs: 0,
      output: 0,
      issues: 0,
      builtAt: 0,
      variantSeed: i * 7919,
    };
    game.buildings.set(building.id, building);
  }
  return game;
}

describe('the city layer does not leak as the city grows', () => {
  it('generates each archetype once, however many times its bucket doubles', () => {
    const skins = countingSkins();
    const layer = createBuildings(skins);

    // One bucket, past its initial capacity of 256 and through four doublings.
    layer.sync(cityOf(1), 0);
    const afterFirst = skins.made;
    expect(afterFirst).toBe(2); // one facade, one emissive

    layer.sync(cityOf(4_000), 0);
    // Before the fix this was 2 per doubling on top of the first pair. The
    // archetype does not depend on how many of it there are, so neither should
    // the number of textures standing behind it.
    expect(skins.made).toBe(afterFirst);
    layer.dispose();
  });

  it('keeps one mesh per archetype rather than one per doubling', () => {
    const layer = createBuildings(countingSkins());
    layer.sync(cityOf(4_000), 0);
    // The grown mesh replaces the old one in the group; it does not join it.
    // A group that accumulates dead meshes is the same bug wearing a hat: they
    // are still bound, still uploaded, and still holding their buffers.
    expect(layer.group.children.length).toBe(1);
    layer.dispose();
  });

  it('draws every building it was given', () => {
    // The guard on the fix: sharing the kit must not lose instances. A silent
    // regrow that dropped the overflow would pass both tests above.
    const layer = createBuildings(countingSkins());
    layer.sync(cityOf(1_000), 0);
    const mesh = layer.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(1_000);
    expect(mesh.instanceMatrix.count).toBeGreaterThanOrEqual(1_000);
    layer.dispose();
  });

  it('carries the per-plot tint across a regrow, not just the positions', () => {
    // The colour buffer is allocated lazily by setColorAt, so the naive carry
    // copies the matrices and leaves every instance written before the doubling
    // flat white — a district that turns pale for a frame instead of vanishing
    // for one, which is not an improvement.
    const layer = createBuildings(countingSkins());
    layer.sync(cityOf(1_000), 0);
    const mesh = layer.group.children[0] as THREE.InstancedMesh;
    const tint = new THREE.Color();
    mesh.getColorAt(0, tint);
    expect(tint.equals(new THREE.Color(1, 1, 1))).toBe(false);
    layer.dispose();
  });

  it('still lights the windows of a bucket that grew after dusk', () => {
    // The night factor lives on the materials, and the materials are now shared
    // rather than rebuilt — so a bucket that doubles at midnight has to come
    // back already lit instead of arriving dark.
    const layer = createBuildings(countingSkins());
    layer.sync(cityOf(1), 0);
    layer.setNightFactor(1);
    layer.sync(cityOf(4_000), 0);
    const mesh = layer.group.children[0] as THREE.InstancedMesh;
    const facade = (mesh.material as THREE.MeshStandardMaterial[])[0]!;
    expect(facade.emissiveIntensity).toBe(1);
    layer.dispose();
  });
});

describe('the station layer does not leak as the city builds', () => {
  it('keeps one geometry and one material per kind, however many stations stand', () => {
    // The same bug as the city layer, in the same shape: growing a bucket used
    // to rebuild the box, the cone and both materials, disposing only the two
    // meshes. Nothing here needs a canvas, so this one can be checked by
    // identity — the grown mesh must be drawing the *same* geometry object.
    const layer = createStations();
    const game = createGameState(hashSeed('stations'), 0);
    place(game, 1);
    layer.rebuild(game);
    const before = layer.group.children.length;
    // By count, not by index: every kind gets a mesh up front, and children[0]
    // is whichever kind happens to come first in FACILITY_ORDER — comparing a
    // fire station's geometry to a karakol's would fail for the wrong reason.
    const first = layer.group.children.find(
      (c) => (c as THREE.InstancedMesh).count === 1,
    ) as THREE.InstancedMesh;
    const geometry = first.geometry;
    const material = first.material;

    // Past the initial capacity of 32, through two doublings.
    place(game, 100);
    layer.rebuild(game);
    const grown = layer.group.children.find(
      (c) => (c as THREE.InstancedMesh).count === 100,
    ) as THREE.InstancedMesh;
    expect(grown).toBeDefined();
    expect(grown.geometry).toBe(geometry);
    expect(grown.material).toBe(material);
    // And the group holds the same meshes, not the old ones plus the new.
    expect(layer.group.children.length).toBe(before);
    layer.dispose();
  });

  it('places every station it was given after a regrow', () => {
    const layer = createStations();
    const game = createGameState(hashSeed('stations2'), 0);
    place(game, 100);
    layer.rebuild(game);
    const mesh = layer.group.children.find(
      (c) => (c as THREE.InstancedMesh).count > 0,
    ) as THREE.InstancedMesh;
    expect(mesh.count).toBe(100);
    // The carried instances have to be real placements, not the identity
    // matrix every fresh buffer starts at — which would stack the first sixty
    // odd stations on tile zero.
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).not.toBe(0);
    layer.dispose();
  });
});

/** `count` police stations in a row, which all land in one bucket. */
function place(game: GameState, count: number): void {
  game.services.clear();
  for (let i = 1; i <= count; i++) {
    game.services.set(i, { id: i, kind: 'police', x: 20 + (i % 100), y: 20 + Math.floor(i / 100) });
  }
}

describe('the lens layer does not leak as the player flips through it', () => {
  it('replaces its geometry rather than accumulating them', () => {
    // The same failure class held down three times already in this file's
    // history: a mesh whose geometry is swapped without disposing the old one
    // keeps the old buffers on the GPU forever. The lens swaps on every
    // refresh, which a curious player triggers dozens of times a session.
    const game = createGameState(hashSeed('lens-leak'), 0);
    const layer = createLens(game.world);
    game.world.landValue[100] = 90;

    layer.set(game, 'value');
    const mesh = layer.group.children[0] as THREE.Mesh;
    const first = mesh.geometry;
    expect(first.getAttribute('position').count).toBeGreaterThan(0);

    let disposed = 0;
    first.addEventListener('dispose', () => disposed++);
    layer.refresh(game);
    expect(disposed).toBe(1);
    expect(mesh.geometry).not.toBe(first);

    // Clearing frees the buffers too — an invisible 65k-tile mesh would hold
    // its memory for a feature that is switched off.
    const second = mesh.geometry;
    let secondDisposed = 0;
    second.addEventListener('dispose', () => secondDisposed++);
    layer.set(game, null);
    expect(secondDisposed).toBe(1);
    expect(mesh.visible).toBe(false);
    layer.dispose();
  });

  it('draws nothing while no lens is up', () => {
    const game = createGameState(hashSeed('lens-idle'), 0);
    const layer = createLens(game.world);
    const mesh = layer.group.children[0] as THREE.Mesh;
    expect(mesh.visible).toBe(false);
    // refresh with nothing up must stay a no-op, because the renderer calls it
    // on a timer and an idle feature has to cost nothing.
    layer.refresh(game);
    expect(mesh.visible).toBe(false);
    expect(mesh.geometry.getAttribute('position')).toBeUndefined();
    layer.dispose();
  });
});
