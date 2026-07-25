import { LONG_PRESS_MS, TAP_SLOP_PX } from '../data/balance';

/**
 * Gesture state machine (§5.1). The rule with no exceptions: one finger drives
 * the active tool, two fingers are always the camera. The moment a second
 * pointer lands, any in-flight stroke is cancelled rather than finished — a
 * pinch must never leave a half-drawn road behind.
 *
 * Pure logic: it consumes normalised pointer samples and calls handlers. No DOM
 * access, so pinch maths and the cancel rule can be unit-tested.
 */
export interface PointerSample {
  id: number;
  x: number;
  y: number;
  /** Milliseconds, monotonic. Injected so tests control time. */
  time: number;
}

export interface GestureHandlers {
  onStrokeStart?(sample: PointerSample): void;
  onStrokeMove?(sample: PointerSample): void;
  onStrokeEnd?(sample: PointerSample): void;
  /** Stroke aborted by a second finger or a cancelled pointer; refund/undo. */
  onStrokeCancel?(): void;
  onTap?(sample: PointerSample): void;
  onLongPressStart?(sample: PointerSample): void;
  onLongPressMove?(sample: PointerSample): void;
  onLongPressEnd?(): void;
  onCameraPan?(dx: number, dy: number): void;
  onCameraZoom?(anchorX: number, anchorY: number, factor: number): void;
}

type Mode = 'idle' | 'pending' | 'stroke' | 'longPress' | 'camera';

interface ActivePointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

export class GestureRecognizer {
  private readonly pointers = new Map<number, ActivePointer>();
  private mode: Mode = 'idle';
  private pinchDistance = 0;
  private pinchCentre = { x: 0, y: 0 };

  constructor(private readonly handlers: GestureHandlers) {}

  get activePointerCount(): number {
    return this.pointers.size;
  }

  get currentMode(): Mode {
    return this.mode;
  }

  down(sample: PointerSample): void {
    this.pointers.set(sample.id, {
      id: sample.id,
      x: sample.x,
      y: sample.y,
      startX: sample.x,
      startY: sample.y,
      startTime: sample.time,
    });

    if (this.pointers.size === 1) {
      this.mode = 'pending';
      return;
    }

    // Second finger down: the camera takes over, unconditionally.
    if (this.mode === 'stroke') this.handlers.onStrokeCancel?.();
    if (this.mode === 'longPress') this.handlers.onLongPressEnd?.();
    if (this.pointers.size === 2) {
      this.mode = 'camera';
      this.capturePinchState();
    }
  }

  move(sample: PointerSample): void {
    const pointer = this.pointers.get(sample.id);
    if (!pointer) return;
    pointer.x = sample.x;
    pointer.y = sample.y;

    if (this.mode === 'camera') {
      this.updateCamera();
      return;
    }

    if (this.mode === 'pending') {
      const moved = distance(pointer.startX, pointer.startY, pointer.x, pointer.y);
      if (moved > TAP_SLOP_PX) {
        this.mode = 'stroke';
        this.handlers.onStrokeStart?.({
          id: pointer.id,
          x: pointer.startX,
          y: pointer.startY,
          time: pointer.startTime,
        });
        this.handlers.onStrokeMove?.(sample);
      }
      return;
    }

    if (this.mode === 'stroke') {
      this.handlers.onStrokeMove?.(sample);
      return;
    }

    if (this.mode === 'longPress') {
      this.handlers.onLongPressMove?.(sample);
    }
  }

  up(sample: PointerSample): void {
    const pointer = this.pointers.get(sample.id);
    if (!pointer) return;
    this.pointers.delete(sample.id);

    if (this.mode === 'camera') {
      // Dropping to one finger does not resume drawing — the remaining finger
      // keeps panning until it lifts, so a sloppy pinch release draws nothing.
      if (this.pointers.size >= 2) this.capturePinchState();
      else if (this.pointers.size === 1) this.captureSinglePanState();
      else this.mode = 'idle';
      return;
    }

    if (this.mode === 'stroke') {
      this.handlers.onStrokeEnd?.(sample);
    } else if (this.mode === 'longPress') {
      this.handlers.onLongPressEnd?.();
    } else if (this.mode === 'pending') {
      this.handlers.onTap?.(sample);
    }

    if (this.pointers.size === 0) this.mode = 'idle';
  }

  cancel(id: number): void {
    if (!this.pointers.has(id)) return;
    this.pointers.delete(id);
    if (this.mode === 'stroke') this.handlers.onStrokeCancel?.();
    if (this.mode === 'longPress') this.handlers.onLongPressEnd?.();
    if (this.pointers.size === 0) this.mode = 'idle';
    else if (this.pointers.size >= 2) this.capturePinchState();
  }

  /**
   * Drives the long-press timer. Called each frame with the current time so it
   * shares the render loop's clock instead of owning a setTimeout.
   */
  tick(now: number): void {
    if (this.mode !== 'pending' || this.pointers.size !== 1) return;
    const pointer = this.pointers.values().next().value;
    if (!pointer) return;
    const held = now - pointer.startTime;
    const moved = distance(pointer.startX, pointer.startY, pointer.x, pointer.y);
    if (held >= LONG_PRESS_MS && moved <= TAP_SLOP_PX) {
      this.mode = 'longPress';
      this.handlers.onLongPressStart?.({
        id: pointer.id,
        x: pointer.x,
        y: pointer.y,
        time: now,
      });
    }
  }

  private capturePinchState(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchDistance = distance(a.x, a.y, b.x, b.y);
    this.pinchCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private captureSinglePanState(): void {
    const pointer = this.pointers.values().next().value;
    if (!pointer) return;
    this.pinchDistance = 0;
    this.pinchCentre = { x: pointer.x, y: pointer.y };
  }

  private updateCamera(): void {
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = distance(a.x, a.y, b.x, b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      this.handlers.onCameraPan?.(centre.x - this.pinchCentre.x, centre.y - this.pinchCentre.y);
      if (this.pinchDistance > 0 && dist > 0) {
        this.handlers.onCameraZoom?.(centre.x, centre.y, dist / this.pinchDistance);
      }
      this.pinchDistance = dist;
      this.pinchCentre = centre;
      return;
    }

    const pointer = this.pointers.values().next().value;
    if (!pointer) return;
    this.handlers.onCameraPan?.(pointer.x - this.pinchCentre.x, pointer.y - this.pinchCentre.y);
    this.pinchCentre = { x: pointer.x, y: pointer.y };
  }
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}
