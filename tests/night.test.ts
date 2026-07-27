import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { dayPhase, sunHeight } from '../src/sim/daytime';
import { createSky, updateSky } from '../src/render3d/sky';

/**
 * Whether the city can be seen after dark.
 *
 * A playtester's whole report on the night was "the screen doesn't show
 * anything at night", and they were right: measured against noon, the night was
 * **0.4%** of the daylight total. The directional light was switched off the
 * moment the sun touched the horizon and the only thing left was a 0.34
 * hemisphere light tinted near-navy — no key light, so no shadows, no lit
 * faces, no silhouettes. The one remedy, the lighting programme, unlocks at
 * town, so the opening of every game was played blind.
 *
 * None of that is visible to a test runner with no GPU, but all of it is
 * arithmetic, and the arithmetic is what was wrong. `createSky` builds a plain
 * three.js object graph — lights, a mesh, a material — and none of that needs a
 * canvas, so the light rig can be stepped through a day and read off directly.
 * That is the closest thing to looking at the screen this project has, and it
 * would have caught this.
 *
 * The property is one sentence: **legibility is a baseline, not a reward.**
 */

/** What the scene is lit by, in one number: both lights, weighted by colour. */
function brightness(rig: ReturnType<typeof createSky>): number {
  const luma = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return rig.key.intensity * luma(rig.key.color) + rig.ambient.intensity * luma(rig.ambient.color);
}

function sweep(rig: ReturnType<typeof createSky>, samples = 240): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    rig.setDayFraction(i / samples);
    out.push(brightness(rig));
  }
  return out;
}

describe('the night is dark, not blank', () => {
  it('never falls below a sixth of noon anywhere in the cycle', () => {
    const rig = createSky(new THREE.Scene());
    rig.setDayFraction(0.5);
    const noon = brightness(rig);
    const darkest = Math.min(...sweep(rig));
    // Measured before the fix: 0.4% of noon. The floor is not a taste — below
    // roughly a tenth the tone mapping has nothing left to lift and the city is
    // a black rectangle.
    expect(darkest / noon).toBeGreaterThan(1 / 6);
    rig.dispose();
  });

  it('is still unmistakably night', () => {
    // The other half of the property. A night that reads at 80% of noon is not
    // a fix, it is the removal of the day.
    const rig = createSky(new THREE.Scene());
    rig.setDayFraction(0.5);
    const noon = brightness(rig);
    rig.setDayFraction(0);
    expect(dayPhase(0)).toBe('night');
    expect(brightness(rig) / noon).toBeLessThan(0.45);
    rig.dispose();
  });

  it('keeps a key light burning after dark, so shapes still read', () => {
    // The specific regression: `sun.intensity = SUN_INTENSITY * daylight` is
    // exactly zero all night, and a scene lit only by a hemisphere light has no
    // shadows and no shaded faces — every building is a flat card.
    const rig = createSky(new THREE.Scene());
    rig.setDayFraction(0);
    expect(rig.key.intensity).toBeGreaterThan(0.3);
    rig.dispose();
  });

  it('lights the city from above at every hour, never from underneath', () => {
    // The moon is the anti-sun, so the key direction flips through the horizon
    // at dusk. Get that wrong — or read the shader's sun uniform, which goes on
    // pointing at the sun under the map — and every roof is lit from below.
    const rig = createSky(new THREE.Scene());
    for (let i = 0; i < 240; i++) {
      const f = i / 240;
      rig.setDayFraction(f);
      expect(rig.keyDirection.y).toBeGreaterThanOrEqual(0);
      updateSky(rig, new THREE.PerspectiveCamera(), 100, 5, 100);
      expect(rig.key.position.y).toBeGreaterThanOrEqual(5);
    }
    rig.dispose();
  });

  it('does not have its darkest moment in the middle of the evening', () => {
    // Sunset used to be darker than midnight, because the daylight and night
    // ramps that were added together are not complements: daylight is already
    // zero at the horizon while night is only four tenths of the way in, so
    // their sum dipped exactly where the sun went down. A city that gets darker
    // and then lighter reads as the lights failing.
    const rig = createSky(new THREE.Scene());
    rig.setDayFraction(0);
    const midnight = brightness(rig);
    const darkest = Math.min(...sweep(rig));
    // Not equality: the horizon crossings are genuinely the dimmest minutes of
    // the day and are allowed to be, just not by half.
    expect(darkest).toBeGreaterThan(midnight * 0.7);
    rig.dispose();
  });

  it('makes a funded night brighter without making it the only lit one', () => {
    const rig = createSky(new THREE.Scene());
    rig.setDayFraction(0);
    const unfunded = brightness(rig);
    rig.setLighting(1);
    const funded = brightness(rig);
    expect(funded).toBeGreaterThan(unfunded * 1.1);

    // And it buys nothing at noon, where there is nothing to buy.
    rig.setDayFraction(0.5);
    const litNoon = brightness(rig);
    rig.setLighting(0);
    expect(brightness(rig)).toBeCloseTo(litNoon, 6);
    rig.dispose();
  });

  it('puts the moon opposite the sun, so it rises as the sun sets', () => {
    const rig = createSky(new THREE.Scene());
    // Just after dusk: the sun is below the horizon and the key light is the
    // moon, which must be on the other side of the sky from where the sun set.
    let dusk = 0.5;
    for (let i = 0; i < 240; i++) {
      const f = 0.5 + i / 480;
      if (sunHeight(f) < -0.2) {
        dusk = f;
        break;
      }
    }
    rig.setDayFraction(dusk);
    const moon = rig.keyDirection.clone();
    rig.setDayFraction(1 - dusk); // the mirror hour, before dawn
    const dawn = rig.keyDirection;
    // Opposite sides of the sky, or the moon tracks the sun and the shadows
    // never move all night.
    expect(Math.sign(moon.x)).not.toBe(Math.sign(dawn.x));
    rig.dispose();
  });
});
