import { CRIME_COMMERCIAL_MULT, CRIME_COVERED_MULT } from '../data/balance';
import { serviceCoverageAt } from './services';
import type { GameState } from './state';
import { decodeRoad, decodeZone, NONE, SERVICE } from './tiles';
import { index } from './world';

/**
 * Data lenses (§14): the map, coloured by one thing the city knows.
 *
 * The simulation has been computing land value, pollution, noise, traffic,
 * coverage and crime risk for a long time, and showing the player none of it —
 * every one of those numbers lived in a Float32Array and reached the screen
 * only through its consequences. A player watching a district refuse to grow
 * had to guess which invisible field was the reason. A lens ends the guessing:
 * one tap and the map *is* the pollution field.
 *
 * This file is the pure half. A lens is a function from the sim to one
 * intensity per tile; what colour that intensity becomes is the renderer's
 * business (render3d/lens.ts), the same split as everywhere else.
 *
 * The convention: **-1 means "no reading here — draw nothing"**, and everything
 * else is 0..1. The distinction matters because zero is information ("this
 * street is fully covered", "no pollution reaches this garden") while silence
 * is not, and a wash of zeros over the empty three quarters of the map would
 * bury the city the player is trying to read.
 */
export type LensKind =
  | 'value'
  | 'pollution'
  | 'noise'
  | 'traffic'
  | 'coverage'
  | 'crime'
  | 'density';

/** The order the lens button walks through. */
export const LENS_ORDER: readonly LensKind[] = [
  'value',
  'pollution',
  'noise',
  'traffic',
  'coverage',
  'crime',
  'density',
];

/** Tiles with no reading carry this; the renderer skips them. */
export const NO_READING = -1;

/**
 * One intensity per tile for the asked-for lens, 0..1 or NO_READING.
 *
 * Allocates its result: a lens is rebuilt on a slow timer while it is up and
 * never while it is not, so churn is a few arrays a minute at worst — not
 * worth threading a scratch buffer through every caller for.
 */
export function lensField(
  state: GameState,
  kind: LensKind,
  traffic?: Float32Array,
): Float32Array {
  const world = state.world;
  const out = new Float32Array(world.size * world.size).fill(NO_READING);

  switch (kind) {
    case 'value': {
      // Worth showing everywhere on land the player owns: where value pools is
      // exactly the question when deciding what to zone next.
      for (let i = 0; i < out.length; i++) {
        const value = world.landValue[i] ?? 0;
        if (value <= 1) continue;
        out[i] = clamp01(value / 100);
      }
      return out;
    }
    case 'pollution': {
      for (let i = 0; i < out.length; i++) {
        const level = world.pollution[i] ?? 0;
        if (level < 2) continue;
        out[i] = clamp01(level / 100);
      }
      return out;
    }
    case 'noise': {
      for (let i = 0; i < out.length; i++) {
        const level = world.noise[i] ?? 0;
        if (level < 2) continue;
        out[i] = clamp01(level / 100);
      }
      return out;
    }
    case 'traffic': {
      // Roads only. Load elsewhere is always zero and painting it would turn
      // the lens into a road map, which the player already has.
      if (!traffic) return out;
      for (let i = 0; i < out.length; i++) {
        if (!decodeRoad(world.road[i] ?? NONE)) continue;
        out[i] = clamp01(traffic[i] ?? 0);
      }
      return out;
    }
    case 'coverage': {
      // Only ground that could care: a mountain nobody zoned is not
      // "unserved", it is wilderness. Zero is the loud reading here — a zoned
      // street no station reaches — so the mask is what makes the lens honest.
      for (let i = 0; i < out.length; i++) {
        const zoned = decodeZone(world.zone[i] ?? NONE) !== null;
        if (!zoned && (world.building[i] ?? 0) === 0) continue;
        out[i] = clamp01(serviceCoverageAt(world, state.era, i));
      }
      return out;
    }
    case 'crime': {
      // Relative risk, from the same facts the crime roll uses (sim/crime.ts):
      // a till is worth more than a hallway, and a watched street is robbed
      // less. Night and mood multiply everything equally, so they cancel out
      // of a relative picture and the lens reads the same at noon as at four.
      for (const building of state.buildings.values()) {
        const i = index(world, building.x, building.y);
        let risk = 1;
        if (building.zone === 'com') risk *= CRIME_COMMERCIAL_MULT;
        if (((world.serviceMask[i] ?? 0) & SERVICE.police) !== 0) risk *= CRIME_COVERED_MULT;
        out[i] = clamp01(risk / CRIME_COMMERCIAL_MULT);
      }
      return out;
    }
    case 'density': {
      // What the zoning permits, not what stands: bright where the player paid
      // for height, dim where ordinary zoning holds it to a suburb.
      for (let i = 0; i < out.length; i++) {
        const zone = decodeZone(world.zone[i] ?? NONE);
        if (zone !== 'res' && zone !== 'com' && zone !== 'ind' && zone !== 'office') continue;
        out[i] = (world.density[i] ?? 0) === 1 ? 1 : 0.25;
      }
      return out;
    }
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
