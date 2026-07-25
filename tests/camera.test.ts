import { describe, expect, it } from 'vitest';
import { TILE_PX, ZOOM_MAX, ZOOM_MIN } from '../src/data/balance';
import { Camera } from '../src/render/camera';

function camera(): Camera {
  const cam = new Camera();
  cam.setViewport(400, 800);
  cam.centreOn(100, 100);
  return cam;
}

describe('Camera', () => {
  it('round-trips screen and world coordinates', () => {
    const cam = camera();
    cam.setZoom(1.7);
    const world = cam.screenToWorld(137, 511);
    const screen = cam.worldToScreen(world.x, world.y);
    expect(screen.x).toBeCloseTo(137, 6);
    expect(screen.y).toBeCloseTo(511, 6);
  });

  it('puts the camera centre at the viewport centre', () => {
    const cam = camera();
    const screen = cam.worldToScreen(100, 100);
    expect(screen.x).toBeCloseTo(200, 6);
    expect(screen.y).toBeCloseTo(400, 6);
  });

  it('pans by exact tile counts for a given screen delta', () => {
    const cam = camera();
    cam.setZoom(1);
    cam.panByScreen(-TILE_PX * 3, 0);
    expect(cam.x).toBeCloseTo(103, 6);
  });

  it('clamps zoom to the 0.35×–3.0× range', () => {
    const cam = camera();
    cam.setZoom(99);
    expect(cam.zoom).toBe(ZOOM_MAX);
    cam.setZoom(0.001);
    expect(cam.zoom).toBe(ZOOM_MIN);
  });

  it('keeps the pinch anchor pinned to the same world point', () => {
    const cam = camera();
    const anchorX = 320;
    const anchorY = 610;
    const before = cam.screenToWorld(anchorX, anchorY);
    cam.zoomAt(anchorX, anchorY, 1.85);
    const after = cam.screenToWorld(anchorX, anchorY);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('does not drift the anchor when the zoom clamps', () => {
    const cam = camera();
    cam.setZoom(ZOOM_MAX);
    const before = cam.screenToWorld(50, 50);
    cam.zoomAt(50, 50, 4);
    const after = cam.screenToWorld(50, 50);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('holds the centre inside world bounds', () => {
    const cam = camera();
    cam.setBounds({ minX: 0, minY: 0, maxX: 256, maxY: 256 });
    cam.panByScreen(100_000, 100_000);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    cam.panByScreen(-100_000, -100_000);
    expect(cam.x).toBe(256);
    expect(cam.y).toBe(256);
  });

  it('reports a visible rectangle that covers the viewport', () => {
    const cam = camera();
    cam.setZoom(1);
    const rect = cam.visibleTileRect();
    const widthInTiles = 400 / TILE_PX;
    expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(widthInTiles);
  });
});
