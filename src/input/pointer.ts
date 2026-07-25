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
