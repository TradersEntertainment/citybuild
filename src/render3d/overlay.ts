import * as THREE from 'three';
import { PARCEL_SIZE } from '../data/balance';
import { ZONE_TINTS } from '../data/buildings';
import type { DraftRender } from '../input/draft';
import { decodeZone, NONE } from '../sim/tiles';
import { index, type World } from '../sim/world';
import { sampleHeight } from './terrain';

/**
 * Ground overlays: the zones a player has marked but nothing has grown on yet,
 * and the stroke currently under their finger.
 *
 * Both are painted on the terrain rather than floated above it, because they
 * describe *land*. The draft is rebuilt every frame — it is at most a few
 * hundred tiles and it has to track the finger exactly — while the zone layer
 * is rebuilt only when zoning changes.
 */
const ZONE_LIFT = 0.09;
const DRAFT_LIFT = 0.22;
const FOR_SALE_LIFT = 0.3;
/** Boundary strip width, in tiles. */
const FOR_SALE_WIDTH = 0.7;

export interface OverlayLayer {
  readonly group: THREE.Group;
  /** Rebuilds the marked-zone layer from the world. */
  rebuildZones(): void;
  /** Redraws the live stroke; pass null when nothing is being drawn. */
  setDraft(draft: DraftRender | null): void;
  /** Outlines the parcels currently for sale. */
  setForSale(parcels: readonly { px: number; py: number }[]): void;
  dispose(): void;
}

export function createOverlay(world: World): OverlayLayer {
  const group = new THREE.Group();
  group.name = 'overlay';

  const zoneMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const draftMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  const zones = new THREE.Mesh(new THREE.BufferGeometry(), zoneMaterial);
  zones.renderOrder = 2;
  const draft = new THREE.Mesh(new THREE.BufferGeometry(), draftMaterial);
  draft.renderOrder = 3;

  // Land for sale is marked by its boundary rather than a wash over the whole
  // parcel: 48×48 tiles of tint would bury the terrain the player is being
  // asked to judge, and a surveyor's line is what the game is about anyway.
  const forSaleMaterial = new THREE.MeshBasicMaterial({
    color: '#E4C15C',
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const forSale = new THREE.Mesh(new THREE.BufferGeometry(), forSaleMaterial);
  forSale.renderOrder = 4;
  group.add(zones, draft, forSale);

  const rebuildZones = (): void => {
    const positions: number[] = [];
    const colours: number[] = [];
    const colour = new THREE.Color();

    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        const i = index(world, x, y);
        const zone = decodeZone(world.zone[i] ?? NONE);
        if (!zone) continue;
        // A tile that has grown something is described by the building on it.
        if ((world.building[i] ?? 0) !== 0) continue;

        colour.set(ZONE_TINTS[zone]);
        pushTile(positions, world, x, y, ZONE_LIFT);
        for (let v = 0; v < 6; v++) colours.push(colour.r, colour.g, colour.b);
      }
    }
    zones.geometry.dispose();
    zones.geometry = toGeometry(positions, colours);
  };

  const setDraft = (current: DraftRender | null): void => {
    const positions: number[] = [];
    const colours: number[] = [];
    if (current) {
      const affordable = new THREE.Color(current.mode === 'road' ? '#F2EAD4' : '#EADF9C');
      // The unaffordable tail is shown as part of the same stroke, so the player
      // sees the wall before they hit it rather than being told about it (§5.1).
      const denied = new THREE.Color('#C4463A');
      for (let i = 0; i < current.tiles.length; i++) {
        const tile = current.tiles[i];
        if (!tile) continue;
        const colour = i < current.affordableTiles ? affordable : denied;
        pushTile(positions, world, tile.x, tile.y, DRAFT_LIFT);
        for (let v = 0; v < 6; v++) colours.push(colour.r, colour.g, colour.b);
      }
    }
    draft.geometry.dispose();
    draft.geometry = toGeometry(positions, colours);
  };

  const setForSale = (parcels: readonly { px: number; py: number }[]): void => {
    const positions: number[] = [];
    const colours: number[] = [];
    const colour = new THREE.Color('#E4C15C');

    for (const { px, py } of parcels) {
      const x0 = px * PARCEL_SIZE;
      const y0 = py * PARCEL_SIZE;
      const x1 = Math.min(world.size, x0 + PARCEL_SIZE);
      const y1 = Math.min(world.size, y0 + PARCEL_SIZE);
      const w = FOR_SALE_WIDTH;

      // Four strips, drawn just inside the parcel so two adjacent offers each
      // keep their own edge instead of sharing one ambiguous line.
      pushStrip(positions, colours, colour, world, x0, y0, x1, y0 + w);
      pushStrip(positions, colours, colour, world, x0, y1 - w, x1, y1);
      pushStrip(positions, colours, colour, world, x0, y0 + w, x0 + w, y1 - w);
      pushStrip(positions, colours, colour, world, x1 - w, y0 + w, x1, y1 - w);
    }

    forSale.geometry.dispose();
    forSale.geometry = toGeometry(positions, colours);
  };

  rebuildZones();

  return {
    group,
    rebuildZones,
    setDraft,
    setForSale,
    dispose: () => {
      zones.geometry.dispose();
      draft.geometry.dispose();
      forSale.geometry.dispose();
      zoneMaterial.dispose();
      draftMaterial.dispose();
      forSaleMaterial.dispose();
      group.clear();
    },
  };
}

/**
 * A boundary strip laid on the terrain. Long edges are split along their length
 * so the strip follows the ground it crosses rather than cutting through a hill
 * as one flat quad.
 */
function pushStrip(
  positions: number[],
  colours: number[],
  colour: THREE.Color,
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const horizontal = x1 - x0 >= y1 - y0;
  const steps = Math.max(1, Math.ceil(horizontal ? x1 - x0 : y1 - y0));
  for (let i = 0; i < steps; i++) {
    const a = horizontal ? x0 + i : y0 + i;
    const b = a + 1;
    if (horizontal) pushQuad(positions, world, a, y0, Math.min(b, x1), y1, FOR_SALE_LIFT);
    else pushQuad(positions, world, x0, a, x1, Math.min(b, y1), FOR_SALE_LIFT);
    for (let v = 0; v < 6; v++) colours.push(colour.r, colour.g, colour.b);
  }
}

function pushQuad(
  out: number[],
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lift: number,
): void {
  const a = sampleHeight(world, x0, y0) + lift;
  const b = sampleHeight(world, x1, y0) + lift;
  const c = sampleHeight(world, x0, y1) + lift;
  const d = sampleHeight(world, x1, y1) + lift;
  out.push(x0, a, y0, x0, c, y1, x1, b, y0, x1, b, y0, x0, c, y1, x1, d, y1);
}

function pushTile(out: number[], world: World, x: number, y: number, lift: number): void {
  const h00 = sampleHeight(world, x, y) + lift;
  const h10 = sampleHeight(world, x + 1, y) + lift;
  const h01 = sampleHeight(world, x, y + 1) + lift;
  const h11 = sampleHeight(world, x + 1, y + 1) + lift;
  out.push(
    x, h00, y, x, h01, y + 1, x + 1, h10, y,
    x + 1, h10, y, x, h01, y + 1, x + 1, h11, y + 1,
  );
}

function toGeometry(positions: number[], colours: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
