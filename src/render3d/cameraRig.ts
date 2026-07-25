import * as THREE from 'three';
import { ZOOM_MAX, ZOOM_MIN } from '../data/balance';
import {
  CAMERA_BASE_DISTANCE,
  CAMERA_DEFAULT_POLAR,
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_MAX_POLAR,
  CAMERA_MIN_POLAR,
  CAMERA_NEAR,
  HEIGHT_SCALE,
  SEA_Y,
} from './constants';

/**
 * Orbit rig over the city, presented through the same interface the flat map's
 * camera had (§3). The tool layer only ever asked a camera to turn a screen
 * point into a tile and back, so keeping those two methods honest is what lets
 * road drawing, zone painting and the cost label survive the move to 3D
 * untouched — the perspective divide and the terrain raycast are this class's
 * problem, not theirs.
 *
 * Tile (x, y) maps to scene (x, height, y): only the vertical axis is new.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Terrain height in scene units at a (fractional) tile coordinate. */
export type HeightSampler = (tileX: number, tileY: number) => number;

export class CameraRig {
  /** Tile coordinate the rig orbits — the city point held at screen centre. */
  x = 0;
  y = 0;
  zoom = 1;
  /** Rotation around the vertical axis, radians. */
  azimuth = Math.PI * 0.25;
  polar = CAMERA_DEFAULT_POLAR;
  viewportWidth = 1;
  viewportHeight = 1;

  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);

  private bounds: CameraBounds | null = null;
  private sampleHeight: HeightSampler = () => 0;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly targetVec = new THREE.Vector3();

  setHeightSampler(sampler: HeightSampler): void {
    this.sampleHeight = sampler;
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.camera.aspect = this.viewportWidth / this.viewportHeight;
    this.camera.updateProjectionMatrix();
    this.clampToBounds();
  }

  setBounds(bounds: CameraBounds | null): void {
    this.bounds = bounds;
    this.clampToBounds();
  }

  centreOn(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clampToBounds();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  }

  /** Distance from the orbit target, derived from zoom. */
  get distance(): number {
    return CAMERA_BASE_DISTANCE / this.zoom;
  }

  /**
   * Ground height under the orbit target, so the rig rides over hills instead
   * of burying itself in one.
   */
  private targetY(): number {
    return Math.max(SEA_Y, this.sampleHeight(this.x, this.y));
  }

  /** Recomputes the three.js camera transform. Call once per frame. */
  update(): void {
    const targetY = this.targetY();
    const d = this.distance;
    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.x + d * sinPolar * Math.sin(this.azimuth),
      targetY + d * Math.cos(this.polar),
      this.y + d * sinPolar * Math.cos(this.azimuth),
    );
    this.targetVec.set(this.x, targetY, this.y);
    this.camera.lookAt(this.targetVec);
    this.camera.updateMatrixWorld();
  }

  /** Turn the view by a twist gesture, radians. */
  orbitByAngle(radians: number): void {
    this.azimuth += radians;
  }

  /** Orbit by a screen-space drag (two-finger twist or right-drag). */
  orbitByScreen(dx: number, dy: number): void {
    this.azimuth -= (dx / this.viewportWidth) * Math.PI * 2;
    this.polar = clamp(
      this.polar - (dy / this.viewportHeight) * Math.PI,
      CAMERA_MIN_POLAR,
      CAMERA_MAX_POLAR,
    );
  }

  /**
   * Drag the city under the finger. The screen delta is converted through the
   * camera's own ground-plane basis, so a drag moves the map the way it looks
   * like it should however the rig is rotated.
   */
  panByScreen(dx: number, dy: number): void {
    // World units covered by one screen pixel at the target's depth.
    const unitsPerPixel =
      (2 * this.distance * Math.tan((CAMERA_FOV * Math.PI) / 360)) / this.viewportHeight;
    const sin = Math.sin(this.azimuth);
    const cos = Math.cos(this.azimuth);
    // Screen right and screen "up" projected onto the ground plane. The vertical
    // drag is divided by cos(polar) so the ground keeps pace with the finger as
    // the view flattens towards the horizon.
    const forwardScale = unitsPerPixel / Math.max(0.25, Math.cos(this.polar));
    this.x -= dx * unitsPerPixel * cos - dy * forwardScale * sin;
    this.y += dx * unitsPerPixel * sin + dy * forwardScale * cos;
    this.clampToBounds();
  }

  /**
   * Zoom while keeping the ground point under the anchor pinned to it — the
   * behaviour a pinch has to have to feel physical (§3).
   */
  zoomAt(anchorScreenX: number, anchorScreenY: number, factor: number): void {
    const before = this.screenToWorld(anchorScreenX, anchorScreenY);
    this.setZoom(this.zoom * factor);
    this.update();
    const after = this.screenToWorld(anchorScreenX, anchorScreenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToBounds();
  }

  /**
   * Screen point to tile coordinate, by marching the view ray against the
   * height field. A plane intersection would be cheaper but would place the
   * cursor wrongly on any slope, and the whole game is drawing lines on ground.
   */
  screenToWorld(screenX: number, screenY: number): Vec2 {
    this.ndc.set(
      (screenX / this.viewportWidth) * 2 - 1,
      -((screenY / this.viewportHeight) * 2 - 1),
    );
    this.ray.setFromCamera(this.ndc, this.camera);
    const origin = this.ray.ray.origin;
    const dir = this.ray.ray.direction;

    // A ray that never descends can only meet the ground behind the camera.
    if (dir.y >= -1e-4) return { x: this.x, y: this.y };

    // Start where the ray drops below the highest possible ground, and give up
    // once it is under the sea floor — outside that band there is nothing to hit.
    const enter = Math.max(0, (origin.y - HEIGHT_SCALE) / -dir.y);
    const exit = (origin.y - 0) / -dir.y;
    const span = exit - enter;
    if (span <= 0) return { x: this.x, y: this.y };

    const steps = 96;
    const stepSize = span / steps;
    let prevT = enter;
    let prevGap = origin.y + dir.y * enter - this.groundAt(origin, dir, enter);

    for (let i = 1; i <= steps; i++) {
      const t = enter + stepSize * i;
      const gap = origin.y + dir.y * t - this.groundAt(origin, dir, t);
      if (gap <= 0) {
        // Crossed the surface between prevT and t; interpolate, then refine.
        const span2 = prevGap - gap;
        const hitT = span2 > 1e-6 ? prevT + (t - prevT) * (prevGap / span2) : t;
        return this.refine(origin, dir, prevT, t, hitT);
      }
      prevT = t;
      prevGap = gap;
    }
    // No crossing: fall back to the water plane, which is where a ray aimed at
    // open sea or off the map's shoulder should land.
    const seaT = (origin.y - SEA_Y) / -dir.y;
    return { x: origin.x + dir.x * seaT, y: origin.z + dir.z * seaT };
  }

  /** Bisection cleanup so a 96-step march still lands on the right tile. */
  private refine(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    lo: number,
    hi: number,
    seed: number,
  ): Vec2 {
    let low = lo;
    let high = hi;
    let t = seed;
    for (let i = 0; i < 8; i++) {
      t = (low + high) / 2;
      const gap = origin.y + dir.y * t - this.groundAt(origin, dir, t);
      if (gap > 0) low = t;
      else high = t;
    }
    return { x: origin.x + dir.x * t, y: origin.z + dir.z * t };
  }

  private groundAt(origin: THREE.Vector3, dir: THREE.Vector3, t: number): number {
    return this.sampleHeight(origin.x + dir.x * t, origin.z + dir.z * t);
  }

  /**
   * Tile coordinate to screen position, for the cost label and any DOM marker
   * that has to sit over a place in the world.
   */
  worldToScreen(worldX: number, worldY: number): Vec2 {
    const placed = this.placeOnScreen(worldX, worldY);
    return { x: placed.x, y: placed.y };
  }

  /**
   * The same projection, with the one fact a floating label needs and a cost
   * tag does not: whether the point is behind the camera. Perspective division
   * flips a point that is, so it lands on screen mirrored through the centre —
   * a neighbourhood behind your shoulder labelled in front of you.
   */
  placeOnScreen(worldX: number, worldY: number): Vec2 & { behind: boolean } {
    this.targetVec.set(worldX, this.sampleHeight(worldX, worldY), worldY);
    this.targetVec.project(this.camera);
    return {
      x: ((this.targetVec.x + 1) / 2) * this.viewportWidth,
      y: ((1 - this.targetVec.y) / 2) * this.viewportHeight,
      behind: this.targetVec.z > 1,
    };
  }

  /**
   * Conservative tile rectangle covering the view, for the layers that still
   * iterate the grid. Perspective makes the true footprint a trapezium, so this
   * takes the bounding box of the four screen corners' ground hits and pads it.
   */
  visibleTileRect(): { x0: number; y0: number; x1: number; y1: number } {
    const w = this.viewportWidth;
    const h = this.viewportHeight;
    const corners = [
      this.screenToWorld(0, 0),
      this.screenToWorld(w, 0),
      this.screenToWorld(0, h),
      this.screenToWorld(w, h),
    ];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of corners) {
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
    // A ray towards the horizon lands far away or not at all; clamping keeps the
    // grid loops bounded regardless.
    const pad = 2;
    return {
      x0: Math.floor(x0) - pad,
      y0: Math.floor(y0) - pad,
      x1: Math.ceil(x1) + pad,
      y1: Math.ceil(y1) + pad,
    };
  }

  private clampToBounds(): void {
    if (!this.bounds) return;
    const { minX, minY, maxX, maxY } = this.bounds;
    this.x = Math.min(maxX, Math.max(minX, this.x));
    this.y = Math.min(maxY, Math.max(minY, this.y));
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
