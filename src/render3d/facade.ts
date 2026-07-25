import * as THREE from 'three';

/**
 * Facade textures, drawn to a canvas at load rather than shipped as images —
 * the project's "everything is generated" rule (§0.5) survives the move to 3D.
 *
 * Windows are what separate a tower from a coloured box, and they have to be a
 * texture rather than geometry: a level-5 block has hundreds of them, and a
 * hundred such buildings would be millions of triangles for detail that is four
 * pixels wide. One 256² canvas per archetype costs nothing and reads correctly
 * at every distance the camera can reach.
 */
export interface FacadeOptions {
  /** Wall colour behind the glazing. */
  wall: string;
  /** Glass colour when unlit. */
  glass: string;
  /** Windows across one texture tile. */
  columns: number;
  /** Window rows per storey band. */
  rows: number;
  /** 0..1 fraction of windows that are lit. */
  lit: number;
  /** Colour of a lit window. */
  litColour: string;
  /** Draw floor slabs between window bands — reads as a modern curtain wall. */
  banded: boolean;
}

/**
 * Deterministic per-cell value. The same building always lights the same
 * windows, so a facade does not flicker as textures are regenerated.
 */
function hash(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

export function createFacadeTexture(options: FacadeOptions, salt: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for facade generation');

  ctx.fillStyle = options.wall;
  ctx.fillRect(0, 0, size, size);

  // Subtle vertical grain so a large flat wall is not a single dead colour.
  for (let i = 0; i < 60; i++) {
    const x = hash(i, 0, salt) * size;
    ctx.fillStyle = `rgba(0,0,0,${0.02 + hash(i, 1, salt) * 0.03})`;
    ctx.fillRect(x, 0, 1 + hash(i, 2, salt) * 2, size);
  }

  const cellW = size / options.columns;
  const cellH = size / options.rows;
  const winW = cellW * 0.62;
  const winH = cellH * (options.banded ? 0.54 : 0.46);

  for (let r = 0; r < options.rows; r++) {
    for (let c = 0; c < options.columns; c++) {
      const isLit = hash(c, r, salt) < options.lit;
      ctx.fillStyle = isLit ? options.litColour : options.glass;
      const x = c * cellW + (cellW - winW) / 2;
      const y = r * cellH + (cellH - winH) / 2;
      ctx.fillRect(x, y, winW, winH);

      // A darker head and sill give the opening depth without a normal map.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y, winW, Math.max(1, winH * 0.14));
    }
    if (options.banded) {
      // Floor slab: the horizontal line that makes a curtain wall legible.
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(0, r * cellH, size, Math.max(1, cellH * 0.08));
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Emissive twin of a facade: black except where a window is lit, so the same
 * building can glow at dusk without a second material or a shader patch.
 */
export function createEmissiveTexture(options: FacadeOptions, salt: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for facade generation');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const cellW = size / options.columns;
  const cellH = size / options.rows;
  const winW = cellW * 0.62;
  const winH = cellH * (options.banded ? 0.54 : 0.46);

  for (let r = 0; r < options.rows; r++) {
    for (let c = 0; c < options.columns; c++) {
      if (hash(c, r, salt) >= options.lit) continue;
      ctx.fillStyle = options.litColour;
      ctx.fillRect(
        c * cellW + (cellW - winW) / 2,
        r * cellH + (cellH - winH) / 2,
        winW,
        winH,
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
