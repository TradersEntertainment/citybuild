import { describe, expect, it, vi, type Mock } from 'vitest';
import { LONG_PRESS_MS, TAP_SLOP_PX } from '../src/data/balance';
import { GestureRecognizer, type GestureHandlers } from '../src/input/gestures';

/** Every handler is a spy, so assertions can read call counts and arguments. */
type SpiedHandlers = {
  [K in keyof Required<GestureHandlers>]: Mock<Required<GestureHandlers>[K]>;
};

function harness(): { recognizer: GestureRecognizer; handlers: SpiedHandlers } {
  const handlers: SpiedHandlers = {
    onStrokeStart: vi.fn(),
    onStrokeMove: vi.fn(),
    onStrokeEnd: vi.fn(),
    onStrokeCancel: vi.fn(),
    onTap: vi.fn(),
    onLongPressStart: vi.fn(),
    onLongPressMove: vi.fn(),
    onLongPressEnd: vi.fn(),
    onCameraPan: vi.fn(),
    onCameraZoom: vi.fn(),
  };
  return { recognizer: new GestureRecognizer(handlers), handlers };
}

describe('GestureRecognizer', () => {
  it('treats a one-finger drag as a tool stroke', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 10, y: 10, time: 0 });
    recognizer.move({ id: 1, x: 10 + TAP_SLOP_PX + 5, y: 10, time: 16 });
    recognizer.move({ id: 1, x: 60, y: 30, time: 32 });
    recognizer.up({ id: 1, x: 60, y: 30, time: 48 });

    expect(handlers.onStrokeStart).toHaveBeenCalledTimes(1);
    // The promoting move emits start + move, so both moves are reported.
    expect(handlers.onStrokeMove).toHaveBeenCalledTimes(2);
    expect(handlers.onStrokeEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onCameraPan).not.toHaveBeenCalled();
  });

  it('never draws with two fingers — the camera always wins', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 10, y: 10, time: 0 });
    recognizer.move({ id: 1, x: 80, y: 10, time: 16 });
    recognizer.down({ id: 2, x: 200, y: 200, time: 20 });
    recognizer.move({ id: 1, x: 120, y: 40, time: 32 });

    expect(handlers.onStrokeCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onStrokeMove).toHaveBeenCalledTimes(1); // only the pre-pinch one
    expect(handlers.onCameraPan).toHaveBeenCalled();
  });

  it('reports a zoom factor equal to the change in finger distance', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 100, y: 100, time: 0 });
    recognizer.down({ id: 2, x: 200, y: 100, time: 4 }); // distance 100
    recognizer.move({ id: 2, x: 300, y: 100, time: 20 }); // distance 200

    expect(handlers.onCameraZoom).toHaveBeenCalledTimes(1);
    const call = handlers.onCameraZoom.mock.calls[0];
    expect(call?.[2]).toBeCloseTo(2, 6);
  });

  it('does not resume drawing when a pinch drops back to one finger', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 100, y: 100, time: 0 });
    recognizer.down({ id: 2, x: 200, y: 100, time: 4 });
    recognizer.up({ id: 2, x: 200, y: 100, time: 40 });
    recognizer.move({ id: 1, x: 160, y: 140, time: 56 });

    expect(handlers.onStrokeStart).not.toHaveBeenCalled();
    expect(handlers.onCameraPan).toHaveBeenCalled();
  });

  it('reads a still, short touch as a tap', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 40, y: 40, time: 0 });
    recognizer.move({ id: 1, x: 42, y: 41, time: 10 });
    recognizer.up({ id: 1, x: 42, y: 41, time: 20 });

    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onStrokeStart).not.toHaveBeenCalled();
  });

  it('opens the inspector after a still long press', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 40, y: 40, time: 0 });
    recognizer.tick(LONG_PRESS_MS - 1);
    expect(handlers.onLongPressStart).not.toHaveBeenCalled();

    recognizer.tick(LONG_PRESS_MS + 1);
    expect(handlers.onLongPressStart).toHaveBeenCalledTimes(1);

    recognizer.up({ id: 1, x: 40, y: 40, time: LONG_PRESS_MS + 20 });
    expect(handlers.onLongPressEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it('does not long-press once the finger has moved past the slop', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 40, y: 40, time: 0 });
    recognizer.move({ id: 1, x: 40 + TAP_SLOP_PX + 2, y: 40, time: 30 });
    recognizer.tick(LONG_PRESS_MS + 100);
    expect(handlers.onLongPressStart).not.toHaveBeenCalled();
  });

  it('cancels the stroke when the pointer is cancelled', () => {
    const { recognizer, handlers } = harness();
    recognizer.down({ id: 1, x: 10, y: 10, time: 0 });
    recognizer.move({ id: 1, x: 90, y: 10, time: 16 });
    recognizer.cancel(1);

    expect(handlers.onStrokeCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onStrokeEnd).not.toHaveBeenCalled();
    expect(recognizer.activePointerCount).toBe(0);
  });
});
