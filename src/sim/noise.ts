import { createRng } from './rng';

/**
 * Seeded value noise (§4). Value noise rather than Perlin/simplex: it is
 * cheaper, and its softer, blobbier output suits a hand-drawn cadastral map
 * better than gradient noise's ridges.
 *
 * Pure and deterministic — the same seed rebuilds the same coastline.
 */
export type NoiseField = (x: number, y: number) => number;

const LATTICE = 256;
const LATTICE_MASK = LATTICE - 1;

/** Smoothstep: removes the visible lattice creases bilinear alone leaves. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Builds one octave of value noise over a wrapping 256×256 lattice. */
export function createValueNoise(seed: number): NoiseField {
  const rng = createRng(seed);
  const values = new Float32Array(LATTICE * LATTICE);
  for (let i = 0; i < values.length; i++) values[i] = rng.next();

  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = fade(x - xi);
    const ty = fade(y - yi);

    const x0 = xi & LATTICE_MASK;
    const y0 = yi & LATTICE_MASK;
    const x1 = (x0 + 1) & LATTICE_MASK;
    const y1 = (y0 + 1) & LATTICE_MASK;

    const v00 = values[y0 * LATTICE + x0] ?? 0;
    const v10 = values[y0 * LATTICE + x1] ?? 0;
    const v01 = values[y1 * LATTICE + x0] ?? 0;
    const v11 = values[y1 * LATTICE + x1] ?? 0;

    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
  };
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  /** Tiles per lattice cell at the first octave; larger means broader shapes. */
  scale?: number;
}

/**
 * Fractal sum of a noise field, normalised to 0..1 so callers can compare
 * against absolute thresholds like the sea level.
 */
export function createFbm(seed: number, options: FbmOptions = {}): NoiseField {
  const octaves = options.octaves ?? 5;
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;
  const scale = options.scale ?? 64;

  // One field per octave, each with its own seed: reusing a single field at
  // different frequencies correlates the octaves and produces visible echoes.
  const fields: NoiseField[] = [];
  for (let o = 0; o < octaves; o++) fields.push(createValueNoise(seed + o * 7919));

  let totalAmplitude = 0;
  let amplitude = 1;
  for (let o = 0; o < octaves; o++) {
    totalAmplitude += amplitude;
    amplitude *= gain;
  }

  return (x: number, y: number): number => {
    let sum = 0;
    let amp = 1;
    let frequency = 1 / scale;
    for (let o = 0; o < octaves; o++) {
      sum += (fields[o] ?? (() => 0))(x * frequency, y * frequency) * amp;
      amp *= gain;
      frequency *= lacunarity;
    }
    return sum / totalAmplitude;
  };
}
