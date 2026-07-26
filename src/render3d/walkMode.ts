import * as THREE from 'three';
import { SEA_Y, CAMERA_NEAR } from './constants';
import type { HeightSampler } from './cameraRig';
import {
  moveVector,
  nearestWalkable,
  slide,
  WALK_EYE,
  WALK_SPEED,
  WALK_SPRINT,
  type WalkBlocker,
} from './walkPhysics';

/**
 * The street-level visit (§15). The same scene the map shows, seen from eye
 * height: the walker is dropped where the map camera was looking, steered by
 * keys or a virtual joystick, and turned by dragging. The sim keeps running —
 * the city does not pause because its mayor went for a walk.
 *
 * This class owns only the pose and the camera transform while active. What
 * blocks movement is injected, what the HUD shows is elsewhere, and the orbit
 * rig is told nothing — on exit the map camera simply resumes from where it
 * hovered, which is exactly where the walk began.
 */

/** The walker's own keys/stick, gathered per frame by the shell. */
export interface WalkInput {
  /** −1..1 along the view direction (W/S or stick vertical). */
  forward: number;
  /** −1..1 across the view direction (A/D or stick horizontal). */
  strafe: number;
  sprint: boolean;
}

export interface WalkModeDeps {
  camera: THREE.PerspectiveCamera;
  blocked: WalkBlocker;
  sampleHeight: HeightSampler;
  /** Where the map camera was looking when the walk began — the drop point. */
  startAt(): { x: number; y: number };
  onExit(): void;
}

/** Radians of turn per pixel of look drag. */
const LOOK_SPEED = 0.0042;
/** How far past vertical the walker may crane. */
const PITCH_LIMIT = Math.PI * 0.44;
/** The map's near plane clips walls at arm's length; the walk's does not. */
const WALK_NEAR = 0.04;

export class WalkMode {
  private yaw = 0;
  private pitch = 0;
  private x = 0;
  private y = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly forwardVec = new THREE.Vector3();
  active = false;

  constructor(private readonly deps: WalkModeDeps) {}

  enter(): void {
    if (this.active) return;
    const camera = this.deps.camera;

    // Keep the gaze the map had: stepping down should feel like zooming the
    // rest of the way in, not like being spun around.
    camera.getWorldDirection(this.forwardVec);
    this.yaw = Math.atan2(-this.forwardVec.x, -this.forwardVec.z);
    this.pitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(this.forwardVec.y, -1, 1)),
      -0.2,
      0.2,
    );

    const at = this.deps.startAt();
    const start = nearestWalkable(this.deps.blocked, at.x, at.y);
    this.x = start.x;
    this.y = start.y;

    this.active = true;
    camera.near = WALK_NEAR;
    camera.updateProjectionMatrix();
    this.apply();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    const camera = this.deps.camera;
    camera.near = CAMERA_NEAR;
    camera.updateProjectionMatrix();
    this.deps.onExit();
  }

  /** Drag-to-look, from the canvas stroke the shell reroutes while walking. */
  lookBy(dx: number, dy: number): void {
    if (!this.active) return;
    this.yaw -= dx * LOOK_SPEED;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** One frame of movement and the camera transform that follows it. */
  update(deltaMs: number, input: WalkInput): void {
    if (!this.active) return;
    const seconds = deltaMs / 1000;
    const speed = input.sprint ? WALK_SPRINT : WALK_SPEED;
    const move = moveVector(input.forward, input.strafe, this.yaw);
    const length = Math.hypot(move.dx, move.dy);
    if (length > 1e-6) {
      // Analog for the stick (length < 1), normalised for key chords (√2).
      const step = (speed * seconds * Math.min(1, length)) / Math.max(1, length);
      const next = slide(this.deps.blocked, this.x, this.y, move.dx * step, move.dy * step);
      this.x = next.x;
      this.y = next.y;
    }
    this.apply();
  }

  private apply(): void {
    const camera = this.deps.camera;
    // The street is under the sea's level on flooded tiles only, and the
    // blocker already keeps the walker out of those.
    const ground = Math.max(SEA_Y, this.deps.sampleHeight(this.x, this.y));
    camera.position.set(this.x, ground + WALK_EYE, this.y);
    this.euler.set(this.pitch, this.yaw, 0);
    camera.quaternion.setFromEuler(this.euler);
    camera.updateMatrixWorld();
  }
}
