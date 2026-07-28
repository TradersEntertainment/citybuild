import { describe, expect, it } from 'vitest';
import { MAX_DPR, MAX_DRAWING_PIXELS } from '../src/data/balance';
import { pixelRatioFor } from '../src/render3d/renderer';

/**
 * The framebuffer budget (§35).
 *
 * The bug this guards is a tab that dies with "Out of Memory" on a large or
 * high-DPI window. The drawing buffer is allocated at colour and depth and
 * multiplied again by the antialiasing sample count, so its size is the single
 * largest allocation the app makes — and before this it was bounded only by the
 * device pixel ratio, which says nothing about how big the window is.
 */
describe('the drawing buffer budget', () => {
  /** Windows worth naming, as [label, css width, css height, device ratio]. */
  const WINDOWS: readonly [string, number, number, number][] = [
    ['phone', 390, 780, 3],
    ['phone landscape', 780, 390, 3],
    ['tablet', 820, 1180, 2],
    ['1080p laptop', 1920, 1080, 1],
    ['1440p monitor', 2560, 1440, 1],
    ['1080p at retina', 1920, 1080, 2],
    ['4K desktop', 3840, 2160, 1],
    ['4K at retina', 3840, 2160, 2],
    ['ultrawide', 3440, 1440, 1],
  ];

  it('never asks for more pixels than the budget allows', () => {
    for (const [label, width, height, dpr] of WINDOWS) {
      const ratio = pixelRatioFor(width, height, dpr);
      const pixels = width * height * ratio * ratio;
      // A hair of slack for floating point on the exactly-at-budget cases.
      expect(pixels, label).toBeLessThanOrEqual(MAX_DRAWING_PIXELS * 1.001);
    }
  });

  it('never draws sharper than the display or the ratio cap', () => {
    for (const [label, width, height, dpr] of WINDOWS) {
      const ratio = pixelRatioFor(width, height, dpr);
      expect(ratio, label).toBeLessThanOrEqual(Math.min(MAX_DPR, dpr));
      expect(ratio, label).toBeGreaterThan(0);
    }
  });

  /**
   * The whole point of a budget rather than a lower cap: the devices that were
   * never in trouble must not be softened to protect the one that was.
   */
  it('leaves phones and ordinary desktops exactly as they were', () => {
    expect(pixelRatioFor(390, 780, 3)).toBe(MAX_DPR);
    expect(pixelRatioFor(1920, 1080, 1)).toBe(1);
    expect(pixelRatioFor(2560, 1440, 1)).toBe(1);
  });

  it('scales a big high-DPI window down rather than letting it ask for the display', () => {
    const ratio = pixelRatioFor(1920, 1080, 2);
    expect(ratio).toBeLessThan(2);
    expect(ratio).toBeGreaterThan(1);
    // Halved against what it used to allocate, which is the saving that matters.
    const before = 1920 * 1080 * 2 * 2;
    const after = 1920 * 1080 * ratio * ratio;
    expect(after).toBeLessThan(before * 0.55);
  });

  it('degrades rather than collapsing on an absurd window', () => {
    const ratio = pixelRatioFor(15_360, 8640, 2);
    expect(ratio).toBeGreaterThanOrEqual(0.25);
    expect(Number.isFinite(ratio)).toBe(true);
  });

  it('survives a zero-sized window without dividing by nothing', () => {
    const ratio = pixelRatioFor(0, 0, 2);
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(MAX_DPR);
  });

  it('defaults to a ratio of one when the browser does not report one', () => {
    expect(pixelRatioFor(1280, 720)).toBe(1);
    expect(pixelRatioFor(1280, 720, 0)).toBe(1);
  });
});
