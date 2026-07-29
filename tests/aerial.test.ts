import { describe, expect, it } from 'vitest';
import { archetypeFor, PERIOD_ORDER } from '../src/render3d/archetypes';
import {
  computeAtmosphere,
  createAtmosphereLook,
  WATER_HAZE_WEIGHT,
} from '../src/render3d/atmosphere';
import {
  CAMERA_BASE_DISTANCE,
  CAMERA_DEFAULT_POLAR,
  CAMERA_FOV,
} from '../src/render3d/constants';
import { ZOOM_MAX, ZOOM_MIN } from '../src/data/balance';
import { WEATHER_KINDS } from '../src/sim/weather';
import type { BuiltZone } from '../src/data/buildings';

/**
 * How much of the city the air is allowed to take, and how dark a roof is
 * allowed to be.
 *
 * These are the two faults that made a set of before/after screenshots
 * unshippable, and both of them are arithmetic — which is the only kind of
 * rendering fault this repository can hold down, because the environment it
 * ships from has no GPU and cannot measure a frame or read a pixel back at any
 * speed worth having. So the shape of the check is the same one
 * tests/quality.test.ts strikes: assert the pure function the shader is a
 * transcription of, at the camera geometry the game is actually played in.
 *
 * The geometry below is the real one and is worth stating once. The camera
 * orbits at CAMERA_BASE_DISTANCE / zoom and looks down at CAMERA_DEFAULT_POLAR
 * with a 45° vertical field, so the ground it can see runs from
 * `height / cos(polar - fov/2)` at the bottom of the frame to
 * `height / cos(polar + fov/2)` at the top. At zoom 1 that is 25 world units to
 * 71 — a district — and every number in this file is measured across that span.
 */
const HALF_FOV = (CAMERA_FOV * Math.PI) / 360;

interface Band {
  near: number;
  mid: number;
  far: number;
  linearDensity: number;
  nearOffset: number;
}

/**
 * What the air does to the three depth bands of one frame.
 *
 * `groundY` is the height of the ground under the camera's target; the terrain
 * runs from sea level at 10.9 to about 26, and 12.5 is ordinary inhabited land.
 */
function frame(zoom: number, weather: (typeof WEATHER_KINDS)[number], groundY = 12.5): Band {
  const look = createAtmosphereLook();
  const distance = CAMERA_BASE_DISTANCE / zoom;
  const height = distance * Math.cos(CAMERA_DEFAULT_POLAR);
  computeAtmosphere(
    {
      dayFraction: 0.46,
      weather,
      // Mid-spell, so the weather is at its full strength rather than fading
      // in — the worst case is the one worth bounding.
      weatherProgress: 0.5,
      lighting: 0,
      cameraAltitude: groundY + height,
    },
    look,
  );
  const haze = (angle: number): number => {
    const path = Math.max(0, height / Math.cos(angle) - look.nearOffset);
    return 1 - Math.exp(-Math.min(8, look.linearDensity * path));
  };
  return {
    near: haze(CAMERA_DEFAULT_POLAR - HALF_FOV),
    mid: haze(CAMERA_DEFAULT_POLAR),
    far: haze(CAMERA_DEFAULT_POLAR + HALF_FOV),
    linearDensity: look.linearDensity,
    nearOffset: look.nearOffset,
  };
}

const PLAYED_ZOOMS = [ZOOM_MAX, 1.5, 1, 0.5, ZOOM_MIN];

describe('the air, across every zoom the game can be played at', () => {
  /**
   * The foreground keeps its colour.
   *
   * This is the one that was broken, and it is the whole of aerial perspective:
   * depth is read from the *difference* between the near thing and the far
   * thing, so haze on the nearest geometry in frame buys nothing and costs the
   * comparison. The measured failure was 38% on the closest asphalt in a city
   * frame, in weather nobody watching could identify as fog.
   */
  it('leaves the nearest ground in frame under a tenth hazed, in any weather', () => {
    for (const zoom of PLAYED_ZOOMS) {
      for (const weather of WEATHER_KINDS) {
        expect(frame(zoom, weather).near, `${weather} at zoom ${zoom}`).toBeLessThan(0.1);
      }
    }
  });

  /** And in clear air it should be barely measurable at all. */
  it('leaves the nearest ground in clear air under a sixteenth hazed', () => {
    for (const zoom of PLAYED_ZOOMS) {
      expect(frame(zoom, 'clear').near, `clear at zoom ${zoom}`).toBeLessThan(0.06);
    }
  });

  /**
   * The far field still recedes. A near plane that also flattened the distance
   * would have replaced one fault with the opposite one.
   */
  it('still separates the far band from the near one by a readable margin', () => {
    for (const zoom of PLAYED_ZOOMS) {
      const band = frame(zoom, 'clear');
      // Two tests, because the absolute gap and the ratio fail in opposite
      // directions: zoomed all the way in there are only twenty-four units of
      // ground from the bottom of the frame to the top, so the gap is small and
      // the ratio is large; zoomed all the way out it is the other way round.
      expect(band.far - band.near, `gap, clear at zoom ${zoom}`).toBeGreaterThan(0.06);
      expect(band.far / band.near, `ratio, clear at zoom ${zoom}`).toBeGreaterThan(2);
      expect(band.far).toBeGreaterThan(band.mid);
      expect(band.mid).toBeGreaterThan(band.near);
    }
  });

  /**
   * Nothing in the visible frame ever dissolves. Half is well inside the hard
   * clamp in the shader (HAZE_MAX_EXTINCTION, 0.62) and is what the density and
   * the weather ceiling produce on their own.
   */
  it('never takes more than half of the farthest ground in frame', () => {
    for (const zoom of PLAYED_ZOOMS) {
      for (const weather of WEATHER_KINDS) {
        expect(frame(zoom, weather).far, `${weather} at zoom ${zoom}`).toBeLessThan(0.5);
      }
    }
  });

  /**
   * The weather ceiling. Every spell is bounded against clear air rather than
   * against an absolute, because that is the ratio that goes wrong when
   * somebody retunes one row of the table.
   */
  it('lets no weather more than double the air', () => {
    const clear = frame(1, 'clear').linearDensity;
    for (const weather of WEATHER_KINDS) {
      expect(frame(1, weather).linearDensity / clear, weather).toBeLessThanOrEqual(2.0001);
    }
  });

  /**
   * The clear-air lead-in widens with the zoom, which is the reason it is
   * derived from the camera's own height rather than fixed in world units: a
   * fixed one would cover the whole frame zoomed in and nothing zoomed out.
   */
  it('widens the clear-air lead-in as the camera pulls back', () => {
    const close = frame(ZOOM_MAX, 'clear').nearOffset;
    const wide = frame(ZOOM_MIN, 'clear').nearOffset;
    expect(wide).toBeGreaterThan(close * 4);
  });

  /**
   * The sea takes less, for the framing reason set out at WATER_HAZE_WEIGHT:
   * it is the one surface with no horizon above it in frame to fade into.
   */
  it('gives the sea a strictly smaller share than the land', () => {
    expect(WATER_HAZE_WEIGHT).toBeGreaterThan(0);
    expect(WATER_HAZE_WEIGHT).toBeLessThan(1);
  });
});

/** Rec. 709 relative luminance of an sRGB hex string, in linear light. */
function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const channel = (byte: number): number => {
    const unit = byte / 255;
    return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

const ZONES: readonly BuiltZone[] = ['res', 'com', 'ind', 'office'];

describe('roofs under a midday sun', () => {
  /**
   * A roof faces the sun. Several were authored at a reflectance no roofing
   * material has — the tallest modern office was 0.028, about the reflectance
   * of coal — which put the top of a tower at the same brightness as its own
   * shaded side and made a block of them read as flat slabs.
   *
   * The threshold is the floor in archetypes.ts, restated here so that moving
   * it is a decision somebody makes twice.
   */
  it('are never darker than the low end of real roofing', () => {
    for (const period of PERIOD_ORDER) {
      for (const zone of ZONES) {
        for (let level = 1; level <= 5; level++) {
          const roof = archetypeFor(period, zone, level).roof;
          expect(luminance(roof), `${period}/${zone}/${level} ${roof}`).toBeGreaterThan(0.115);
        }
      }
    }
  });

  /**
   * The property the floor exists to buy, stated as the picture rather than as
   * the number: with the sun high, a flat roof must not be as dark as the
   * *shaded* side of the wall under it. That was the measured fault — a city
   * tower whose roof, lit wall and shaded wall read 56 / 111 / 51, so the one
   * horizontal plane in the building was tied with the one plane the sun never
   * touches, and the tower read as a slab.
   *
   * The light is the rig's own (render3d/sky.ts): a key of 2.75 from 70° up and
   * a hemisphere fill of 1.15 between a sky of #BFD8EE and a ground of #6E6A5A,
   * which three resolves as mix(ground, sky, N.y * 0.5 + 0.5). An up-facing
   * plane therefore collects 2.59 + 0.58 and a vertical one in shade 0.37.
   *
   * The margin is deliberately modest, because the tight cases are not faults.
   * A modern shopfront is cream render under a slate roof: seven times the
   * albedo on the wall against a seventh of the light, which lands the two
   * within a quarter of each other and is exactly what that building looks like
   * on a bright day. The towers — dark curtain wall, same roof — clear four.
   * Asking for more here would mean roofs paler than the walls they sit on,
   * which inverts the read rather than fixing it.
   */
  it('are never as dark as the shaded wall below them', () => {
    const SUN_ELEVATION = (70 * Math.PI) / 180;
    const KEY = 2.75;
    const FILL = 1.15;
    const SKY = luminance('#BFD8EE');
    const BOUNCE = luminance('#6E6A5A');
    const upFacing = KEY * Math.sin(SUN_ELEVATION) + FILL * SKY;
    const shadedVertical = FILL * ((SKY + BOUNCE) / 2);
    for (const period of PERIOD_ORDER) {
      for (const zone of ZONES) {
        for (let level = 1; level <= 5; level++) {
          const spec = archetypeFor(period, zone, level);
          if (spec.roofPitch > 0) continue; // a pitched roof is not an up-facing plane
          const roof = luminance(spec.roof) * upFacing;
          const wall = luminance(spec.facade.wall) * shadedVertical;
          expect(roof / wall, `${period}/${zone}/${level}`).toBeGreaterThan(1.15);
        }
      }
    }
  });
});
