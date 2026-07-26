import {
  DIFFUSION_ITERATIONS,
  NOISE_DECAY,
  NOISE_PER_COMMERCIAL_JOB,
  NOISE_PER_INDUSTRIAL_JOB,
  PARK_ABSORPTION,
  POLLUTION_DECAY,
  POLLUTION_PER_INDUSTRIAL_JOB,
  TREE_ABSORPTION,
} from '../data/balance';
import { PORT_SPECS } from '../data/ports';
import { ROAD_SPECS } from '../data/roads';
import type { GameState } from './state';
import { techFactor } from './tech';
import { plantPollution } from './utilities';
import { decodeRoad, decodeTerrain, decodeZone, NONE } from './tiles';
import { index, isTileOwned, type World } from './world';

/**
 * Pollution and noise (§10).
 *
 * Both are the same shape of problem — something emits, it spreads, it fades —
 * so both run through one solver. What the fields are *for* is spatial
 * consequence: a factory beside houses is not merely disliked by the
 * neighbour-fit term, it makes a measurable stain that reaches four or five
 * tiles and drags every plot it touches below the threshold to grow.
 *
 * The solver relaxes towards a steady state rather than simulating a plume:
 * each pass blurs what is already there, fades it, and re-adds the sources. A
 * dozen passes of that converges to a smooth falloff around every emitter, and
 * it is stable — the same city always produces the same field, so a save that
 * reloads does not shift.
 */
export interface DiffusionScratch {
  pollutionSource: Float32Array;
  noiseSource: Float32Array;
  buffer: Float32Array;
  absorption: Float32Array;
}

export function createDiffusionScratch(size: number): DiffusionScratch {
  const cells = size * size;
  return {
    pollutionSource: new Float32Array(cells),
    noiseSource: new Float32Array(cells),
    buffer: new Float32Array(cells),
    absorption: new Float32Array(cells),
  };
}

/**
 * Recomputes both fields from scratch. Wholesale rather than incremental for
 * the same reason the other fields are: a 256² sweep is cheap, and incremental
 * updates are where stale-state bugs hide.
 */
export function diffuseFields(state: GameState, scratch: DiffusionScratch): void {
  const window = collectSources(state, scratch);
  relax(state.world, scratch.pollutionSource, state.world.pollution, scratch, POLLUTION_DECAY, window);
  relax(state.world, scratch.noiseSource, state.world.noise, scratch, NOISE_DECAY, window);
}

/**
 * The rectangle worth solving in.
 *
 * Nothing can emit outside the city, and the solver's reach is bounded by its
 * pass count, so everything beyond the emitters plus that reach is provably
 * zero. Sweeping the whole 256² grid instead costs about 10 ms — a visible
 * stutter every ten seconds on a 16 ms frame budget — for arithmetic on empty
 * wilderness.
 */
export interface Window {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  empty: boolean;
}

/**
 * Emitters and absorbers. Industry pollutes and is loud; commerce is only loud;
 * roads are loud in proportion to their tier. Parks and standing woodland take
 * pollution back out, which is what makes a green belt a decision rather than
 * decoration.
 */
function collectSources(state: GameState, scratch: DiffusionScratch): Window {
  const world = state.world;
  const { pollutionSource, noiseSource, absorption } = scratch;
  pollutionSource.fill(0);
  noiseSource.fill(0);
  absorption.fill(0);

  // Sanitation is applied at the chimney rather than to the solver: the tech is
  // a scrubber, not faster wind, and cutting emission leaves the falloff — which
  // was measured and tuned — exactly as it was.
  const sanitation = techFactor(state, 'sanitation');

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const note = (x: number, y: number): void => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };

  for (const building of state.buildings.values()) {
    const i = index(world, building.x, building.y);
    if (building.zone === 'ind') {
      pollutionSource[i] =
        (pollutionSource[i] ?? 0) + building.jobs * POLLUTION_PER_INDUSTRIAL_JOB * sanitation;
      noiseSource[i] = (noiseSource[i] ?? 0) + building.jobs * NOISE_PER_INDUSTRIAL_JOB * sanitation;
      note(building.x, building.y);
    } else if (building.zone === 'com') {
      noiseSource[i] = (noiseSource[i] ?? 0) + building.jobs * NOISE_PER_COMMERCIAL_JOB;
      note(building.x, building.y);
    }
  }

  // Cheap power is cheap because somebody downwind pays the rest of the price.
  for (const plant of state.utilities.values()) {
    const emission = plantPollution(plant);
    if (emission <= 0) continue;
    const i = index(world, plant.x, plant.y);
    pollutionSource[i] = (pollutionSource[i] ?? 0) + emission;
    note(plant.x, plant.y);
  }

  // A shipyard is heavy industry with a hull in front of it, and smells like it.
  for (const port of state.ports.values()) {
    const emission = (PORT_SPECS[port.kind].pollution ?? 0) * sanitation;
    if (emission <= 0) continue;
    const i = index(world, port.x, port.y);
    pollutionSource[i] = (pollutionSource[i] ?? 0) + emission;
    note(port.x, port.y);
  }

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = index(world, x, y);

      const road = decodeRoad(world.road[i] ?? NONE);
      if (road) {
        const spec = ROAD_SPECS[road];
        // A tunnel is quiet at the surface whatever runs through it.
        //
        // The national highway is the exception worth the check: it crosses
        // the whole map, and counting every tile of it would stretch the
        // solver window edge to edge — ten idle milliseconds a pass — to
        // compute noise on wilderness nobody lives in. Where the player owns
        // no land, its roar is a rumour; where they do, it is very real.
        const national = (world.highway[i] ?? 0) === 1;
        if (!spec.underground && spec.noise > 0 && (!national || isTileOwned(world, x, y))) {
          noiseSource[i] = (noiseSource[i] ?? 0) + spec.noise;
          note(x, y);
        }
      }

      if (decodeZone(world.zone[i] ?? NONE) === 'park') {
        absorption[i] = PARK_ABSORPTION;
      } else if (decodeTerrain(world.terrain[i] ?? 0) === 'forest') {
        absorption[i] = TREE_ABSORPTION;
      }
    }
  }

  if (x1 < x0) return { x0: 0, y0: 0, x1: -1, y1: -1, empty: true };

  // One tile of margin per pass, which is as far as the solver can carry a
  // value, plus one so the window's own edge is a true zero rather than a wall.
  const reach = DIFFUSION_ITERATIONS + 1;
  return {
    x0: Math.max(0, x0 - reach),
    y0: Math.max(0, y0 - reach),
    x1: Math.min(world.size - 1, x1 + reach),
    y1: Math.min(world.size - 1, y1 + reach),
    empty: false,
  };
}

/**
 * Relaxation towards steady state: blur, fade, re-add the sources, repeat.
 *
 * The blur is a four-neighbour average rather than a full 3×3 — it is a third
 * of the memory traffic and, after a dozen passes, the difference between the
 * two is invisible on a tile grid.
 */
function relax(
  world: World,
  source: Float32Array,
  out: Float32Array,
  scratch: DiffusionScratch,
  decay: number,
  window: Window,
): void {
  // Everything outside the window is zero by construction, and the previous
  // solve may have left values there — a demolished factory has to stop
  // staining the ground it stood on.
  out.fill(0);
  if (window.empty) return;

  const size = world.size;
  const { buffer, absorption } = scratch;
  const { x0, y0, x1, y1 } = window;

  for (let y = y0; y <= y1; y++) {
    const rowStart = y * size;
    for (let x = x0; x <= x1; x++) out[rowStart + x] = source[rowStart + x] ?? 0;
  }

  for (let pass = 0; pass < DIFFUSION_ITERATIONS; pass++) {
    for (let y = y0; y <= y1; y++) {
      const rowStart = y * size;
      for (let x = x0; x <= x1; x++) {
        const i = rowStart + x;
        // Outside the window reads as zero, which is what it is — so the window
        // edge behaves like open ground rather than a reflecting wall.
        const west = x > x0 ? (out[i - 1] ?? 0) : 0;
        const east = x < x1 ? (out[i + 1] ?? 0) : 0;
        const north = y > y0 ? (out[i - size] ?? 0) : 0;
        const south = y < y1 ? (out[i + size] ?? 0) : 0;
        const spread = (west + east + north + south) / 4;
        // Fade, then put the emitters back: without re-adding, the whole field
        // would simply flatten to nothing.
        const value = spread * (1 - decay) + (source[i] ?? 0);
        buffer[i] = value - value * (absorption[i] ?? 0);
      }
    }
    for (let y = y0; y <= y1; y++) {
      const rowStart = y * size;
      for (let x = x0; x <= x1; x++) out[rowStart + x] = buffer[rowStart + x] ?? 0;
    }
  }

  for (let y = y0; y <= y1; y++) {
    const rowStart = y * size;
    for (let x = x0; x <= x1; x++) {
      const i = rowStart + x;
      const value = out[i] ?? 0;
      out[i] = value < 0 ? 0 : value > 100 ? 100 : value;
    }
  }
}
