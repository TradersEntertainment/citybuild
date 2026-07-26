import { describe, expect, it } from 'vitest';
import { KEY_MAX_FRAME_S, KEY_PAN_SPEED, KEY_SPRINT } from '../src/data/balance';
import { claimsKey, KeyboardCamera } from '../src/input/keyboardCamera';

/**
 * Moving the map with the keyboard.
 *
 * The camera used to have one way to be moved — drag it — which is fine on a
 * phone and quietly awful on a desktop holding a drawing tool. These pin the
 * behaviour a player expects without being told: both layouts, no diagonal
 * speed bonus, no drift when a key never comes up, and nothing stolen from the
 * browser's own shortcuts.
 */

function held(...codes: string[]): KeyboardCamera {
  const keys = new KeyboardCamera();
  for (const code of codes) keys.down(code, false);
  return keys;
}

describe('which keys it takes', () => {
  it('answers to both layouts', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) expect(claimsKey(code)).toBe(true);
    for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
      expect(claimsKey(code)).toBe(true);
    }
    expect(claimsKey('KeyQ')).toBe(true);
    expect(claimsKey('KeyE')).toBe(true);
  });

  it('leaves everything else alone', () => {
    // Undo, save and the tool shortcuts are not the camera's to swallow.
    for (const code of ['KeyZ', 'KeyC', 'Space', 'Escape', 'Enter', 'Tab']) {
      expect(claimsKey(code)).toBe(false);
    }
    expect(new KeyboardCamera().down('KeyZ', false)).toBe(false);
  });
});

describe('what a frame of holding is worth', () => {
  it('does nothing at all when nothing is held', () => {
    const keys = new KeyboardCamera();
    expect(keys.anyHeld).toBe(false);
    expect(keys.nudge(1)).toMatchObject({ panX: 0, panY: 0, rotate: 0, zoom: 1, active: false });
  });

  it('pans the map the way the key points', () => {
    // Pressing "right" moves the camera right, which means dragging the map
    // left — the negation every map application has and nobody notices until
    // it is missing.
    expect(held('KeyD').nudge(1 / 60).panX).toBeLessThan(0);
    expect(held('KeyA').nudge(1 / 60).panX).toBeGreaterThan(0);
    expect(held('KeyW').nudge(1 / 60).panY).toBeGreaterThan(0);
    expect(held('KeyS').nudge(1 / 60).panY).toBeLessThan(0);
  });

  it('covers the stated distance per second of holding', () => {
    const frame = 1 / 60;
    expect(Math.abs(held('KeyD').nudge(frame).panX)).toBeCloseTo(KEY_PAN_SPEED * frame, 5);
  });

  it('does not make a diagonal faster than a straight line', () => {
    const straight = held('KeyD').nudge(1 / 60);
    const diagonal = held('KeyD', 'KeyW').nudge(1 / 60);
    const speedOf = (n: { panX: number; panY: number }): number => Math.hypot(n.panX, n.panY);
    expect(speedOf(diagonal)).toBeCloseTo(speedOf(straight), 5);
  });

  it('cancels opposite keys instead of picking one', () => {
    const nudge = held('KeyA', 'KeyD').nudge(1 / 60);
    expect(nudge.panX).toBe(0);
    expect(nudge.panY).toBe(0);
  });

  it('hurries with shift', () => {
    const keys = new KeyboardCamera();
    keys.down('KeyD', true);
    const frame = 1 / 60;
    expect(Math.abs(keys.nudge(frame).panX)).toBeCloseTo(KEY_PAN_SPEED * KEY_SPRINT * frame, 5);
  });

  it('scales with the frame, and refuses to fling on a long one', () => {
    const fast = Math.abs(held('KeyD').nudge(1 / 60).panX);
    const slow = Math.abs(held('KeyD').nudge(1 / 30).panX);
    expect(slow).toBeCloseTo(fast * 2, 5);

    // The cheap-phone case, and the reason the cap is loose: a ten-frame-a-
    // second device must still pan at the full rate, not a clipped one.
    const crawling = Math.abs(held('KeyD').nudge(0.1).panX);
    expect(crawling).toBeCloseTo(KEY_PAN_SPEED * 0.1, 5);

    // A tab coming back after a minute must not throw the camera off the map.
    const stalled = Math.abs(held('KeyD').nudge(60).panX);
    expect(stalled).toBeCloseTo(KEY_PAN_SPEED * KEY_MAX_FRAME_S, 5);
  });

  it('turns and zooms on their own keys, without panning', () => {
    const turn = held('KeyE').nudge(1 / 60);
    expect(turn.rotate).toBeGreaterThan(0);
    expect(turn.panX).toBe(0);
    expect(turn.panY).toBe(0);
    expect(held('KeyQ').nudge(1 / 60).rotate).toBeLessThan(0);

    expect(held('KeyR').nudge(1 / 60).zoom).toBeGreaterThan(1);
    expect(held('KeyF').nudge(1 / 60).zoom).toBeLessThan(1);
  });
});

describe('letting go', () => {
  it('stops when the key comes up', () => {
    const keys = held('KeyD');
    keys.up('KeyD', false);
    expect(keys.anyHeld).toBe(false);
    expect(keys.nudge(1 / 60).panX).toBe(0);
  });

  it('drops everything when the window loses focus', () => {
    // Alt-tabbing away while holding a key never delivers the keyup, and the
    // camera would slide across the map for as long as the tab stayed open.
    const keys = held('KeyD', 'KeyW');
    keys.releaseAll();
    expect(keys.anyHeld).toBe(false);
    expect(keys.nudge(1 / 60).active).toBe(false);
  });
});
