import { GestureRecognizer, type GestureHandlers, type PointerSample } from './gestures';

/**
 * Binds Pointer Events to the gesture recogniser (§3). Pointer Events only —
 * one code path covers mouse, finger and Apple Pencil. setPointerCapture keeps
 * a drag alive when the finger leaves the canvas, and every default that would
 * hand the gesture to Safari (scroll, callout menu, double-tap zoom) is
 * suppressed here rather than in scattered CSS.
 */
export interface PointerBinding {
  recognizer: GestureRecognizer;
  /** Call once per frame so long-press can fire off the render clock. */
  tick(now: number): void;
  dispose(): void;
}

export function bindPointerInput(
  element: HTMLElement,
  handlers: GestureHandlers,
): PointerBinding {
  const recognizer = new GestureRecognizer(handlers);

  const sampleOf = (event: PointerEvent): PointerSample => {
    const rect = element.getBoundingClientRect();
    return {
      id: event.pointerId,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      time: event.timeStamp,
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    recognizer.down(sampleOf(event));
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (recognizer.activePointerCount === 0) return;
    event.preventDefault();
    // Coalesced events give the true finger path between frames, which is what
    // road smoothing needs; without them fast drags come out as long chords.
    const events =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    for (const coalesced of events.length > 0 ? events : [event]) {
      recognizer.move(sampleOf(coalesced));
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    event.preventDefault();
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    recognizer.up(sampleOf(event));
  };

  const onPointerCancel = (event: PointerEvent): void => {
    recognizer.cancel(event.pointerId);
  };

  const onContextMenu = (event: Event): void => {
    // Long press is our inspector; iOS must not open copy/share instead.
    event.preventDefault();
  };

  const onGesture = (event: Event): void => {
    // Safari-only gesturestart/change: kills double-tap and trackpad zoom.
    event.preventDefault();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('contextmenu', onContextMenu);
  element.addEventListener('gesturestart', onGesture);
  element.addEventListener('gesturechange', onGesture);
  element.addEventListener('dragstart', onGesture);

  return {
    recognizer,
    tick: (now: number) => recognizer.tick(now),
    dispose: () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('gesturestart', onGesture);
      element.removeEventListener('gesturechange', onGesture);
      element.removeEventListener('dragstart', onGesture);
    },
  };
}

/**
 * Desktop convenience: the middle button drags the map and the right button
 * turns it, whatever tool is selected.
 *
 * A mouse has one pointer, so the two-finger rule that gives touch a camera has
 * nothing to work with: with a tool in hand, a desktop player could draw and
 * could not move. These two buttons are the answer every map application on
 * every desktop already uses, and neither can be pressed by accident while
 * drawing, because drawing is the left one.
 *
 * Deliberately outside the gesture recogniser. It is a state machine about
 * fingers and tools, and this is neither.
 */
export interface MouseCameraHandlers {
  onPan(dx: number, dy: number): void;
  onOrbit(dx: number, dy: number): void;
  /** Asked before every drag; a walk owns the mouse for looking around. */
  isBlocked?(): boolean;
}

const MIDDLE = 1;
const RIGHT = 2;

export function bindMouseCamera(
  element: HTMLElement,
  handlers: MouseCameraHandlers,
): () => void {
  let dragging: { id: number; button: number; x: number; y: number } | null = null;

  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    if (event.button !== MIDDLE && event.button !== RIGHT) return;
    if (handlers.isBlocked?.()) return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    dragging = { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY };
  };

  const onMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragging.id) return;
    event.preventDefault();
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    if (dragging.button === MIDDLE) handlers.onPan(dx, dy);
    else handlers.onOrbit(dx, dy);
  };

  const onUp = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragging.id) return;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    dragging = null;
  };

  // Capture phase, so this runs before the stroke binding claims the event and
  // before the browser starts an autoscroll on the middle button.
  element.addEventListener('pointerdown', onDown, { capture: true });
  element.addEventListener('pointermove', onMove, { capture: true });
  element.addEventListener('pointerup', onUp, { capture: true });
  element.addEventListener('pointercancel', onUp, { capture: true });
  element.addEventListener('auxclick', preventDefault);

  return () => {
    element.removeEventListener('pointerdown', onDown, { capture: true });
    element.removeEventListener('pointermove', onMove, { capture: true });
    element.removeEventListener('pointerup', onUp, { capture: true });
    element.removeEventListener('pointercancel', onUp, { capture: true });
    element.removeEventListener('auxclick', preventDefault);
  };
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

/**
 * Desktop convenience: wheel zooms around the cursor. Never a game mechanic —
 * everything here has a touch equivalent (§0.7).
 */
export function bindWheelZoom(
  element: HTMLElement,
  onZoom: (anchorX: number, anchorY: number, factor: number) => void,
): () => void {
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0015);
    onZoom(event.clientX - rect.left, event.clientY - rect.top, factor);
  };
  element.addEventListener('wheel', onWheel, { passive: false });
  return () => element.removeEventListener('wheel', onWheel);
}
