import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN } from '../src/data/balance';
import { CameraRig } from '../src/render3d/cameraRig';

/**
 * The rig is the seam between a finger and a tile: every road the player draws
 * is a screen point this class has to turn into ground. These tests pin that
 * contract on flat terrain, where the right answer is knowable exactly.
 */
/**
 * Ground is placed above SEA_Y, because the rig deliberately refuses to aim
 * below the waterline — over open sea it holds the water surface rather than
 * diving to the sea bed.
 */
function rig(groundHeight = 14): CameraRig {
  const cam = new CameraRig();
  cam.setHeightSampler(() => groundHeight);
  cam.setViewport(400, 800);
  cam.centreOn(100, 100);
  cam.update();
  return cam;
}

describe('CameraRig', () => {
  it('round-trips screen and world coordinates', () => {
    const cam = rig();
    cam.setZoom(1.7);
    cam.update();
    const world = cam.screenToWorld(137, 511);
    const screen = cam.worldToScreen(world.x, world.y);
    expect(screen.x).toBeCloseTo(137, 1);
    expect(screen.y).toBeCloseTo(511, 1);
  });

  it('puts the orbit target at the viewport centre', () => {
    const cam = rig();
    const screen = cam.worldToScreen(100, 100);
    expect(screen.x).toBeCloseTo(200, 1);
    expect(screen.y).toBeCloseTo(400, 1);
  });

  it('picks the ground under the centre of the screen', () => {
    const cam = rig();
    const world = cam.screenToWorld(200, 400);
    expect(world.x).toBeCloseTo(100, 1);
    expect(world.y).toBeCloseTo(100, 1);
  });

  it('follows the terrain: higher ground is picked closer to the camera', () => {
    const flat = rig(14).screenToWorld(200, 300);
    const raised = rig(22).screenToWorld(200, 300);
    // Higher ground intercepts the downward ray sooner, so the hit lands nearer
    // the camera — which sits south of the target at the default azimuth.
    expect(raised.y).toBeGreaterThan(flat.y);
  });

  it('clamps zoom to the 0.35×–3.0× range', () => {
    const cam = rig();
    cam.setZoom(99);
    expect(cam.zoom).toBe(ZOOM_MAX);
    cam.setZoom(0.001);
    expect(cam.zoom).toBe(ZOOM_MIN);
  });

  it('moves the city the way the finger drags it', () => {
    const cam = rig();
    cam.azimuth = 0; // look straight down -Z so screen axes map to world axes
    cam.update();
    const before = { x: cam.x, y: cam.y };
    cam.panByScreen(40, 0);
    expect(cam.x).toBeLessThan(before.x);
    expect(cam.y).toBeCloseTo(before.y, 6);
  });

  it('keeps the pinch anchor pinned to the same world point', () => {
    const cam = rig();
    const anchorX = 320;
    const anchorY = 610;
    const before = cam.screenToWorld(anchorX, anchorY);
    cam.zoomAt(anchorX, anchorY, 1.85);
    cam.update();
    const after = cam.screenToWorld(anchorX, anchorY);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it('holds the target inside world bounds', () => {
    const cam = rig();
    cam.setBounds({ minX: 0, minY: 0, maxX: 256, maxY: 256 });
    cam.panByScreen(100_000, 100_000);
    expect(cam.x).toBeGreaterThanOrEqual(0);
    expect(cam.y).toBeGreaterThanOrEqual(0);
    cam.panByScreen(-100_000, -100_000);
    expect(cam.x).toBeLessThanOrEqual(256);
    expect(cam.y).toBeLessThanOrEqual(256);
  });

  it('turns the view without moving the target', () => {
    const cam = rig();
    const before = { x: cam.x, y: cam.y };
    cam.orbitByAngle(Math.PI / 3);
    cam.update();
    expect(cam.x).toBeCloseTo(before.x, 6);
    expect(cam.y).toBeCloseTo(before.y, 6);
    expect(cam.azimuth).toBeCloseTo(Math.PI * 0.25 + Math.PI / 3, 6);
  });

  it('keeps tilt inside the clamped band however far it is dragged', () => {
    const cam = rig();
    cam.orbitByScreen(0, 100_000);
    expect(cam.polar).toBeGreaterThan(0.17);
    cam.orbitByScreen(0, -100_000);
    expect(cam.polar).toBeLessThan(1.29);
  });

  it('reports a visible rectangle that contains the orbit target', () => {
    const cam = rig();
    const rect = cam.visibleTileRect();
    expect(rect.x0).toBeLessThan(100);
    expect(rect.x1).toBeGreaterThan(100);
    expect(rect.y0).toBeLessThan(100);
    expect(rect.y1).toBeGreaterThan(100);
  });
});
