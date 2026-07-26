import { STR } from '../data/strings.tr';

/**
 * On-screen camera controls.
 *
 * Pinch and twist are the natural way to do this and they stay — but they only
 * work when two fingers reach the canvas, and that is not something the game
 * can guarantee. A mouse has one pointer. An embedded page can claim a pinch
 * for its own zoom before the canvas ever sees it. When that happens the player
 * is stuck at one zoom level facing one direction, which is not a degraded
 * experience so much as a broken one.
 *
 * So the same three moves also exist as buttons. They sit up the right-hand
 * edge, out of the thumb's path to the tool dock.
 */
export interface ViewControlDeps {
  onZoom(factor: number): void;
  onRotate(radians: number): void;
  /** Current sound setting, and the switch for it. */
  soundOn(): boolean;
  onToggleSound(): void;
  /** Drops the camera to street level for a walk through the city. */
  onWalk(): void;
  /** Opens the city's history log. */
  onHistory(): void;
}

export interface ViewControlsHandle {
  dispose(): void;
}

/** One press is a comfortable fraction of the zoom range, not a nudge. */
const ZOOM_STEP = 1.35;
const ROTATE_STEP = Math.PI / 6;

export function mountViewControls(
  root: HTMLElement,
  deps: ViewControlDeps,
): ViewControlsHandle {
  const column = document.createElement('div');
  column.className = 'view-controls';

  const make = (label: string, aria: string, onPress: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'view-button';
    button.textContent = label;
    button.setAttribute('aria-label', aria);
    // Pointerdown rather than click: the canvas captures the pointer on any
    // press that reaches it, and waiting for a full click loses the first tap
    // often enough to feel unreliable.
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPress();
    });
    return button;
  };

  // The mute switch lives here rather than behind a settings screen the game
  // does not have. It is the one control a player reaches for in a hurry.
  const sound = make('', STR.view.sound, () => {
    deps.onToggleSound();
    paintSound();
  });
  const paintSound = (): void => {
    const on = deps.soundOn();
    sound.textContent = on ? '♪' : '⃠';
    sound.dataset['off'] = String(!on);
    sound.setAttribute('aria-pressed', String(on));
  };
  paintSound();

  column.append(
    make('+', STR.view.zoomIn, () => deps.onZoom(ZOOM_STEP)),
    make('−', STR.view.zoomOut, () => deps.onZoom(1 / ZOOM_STEP)),
    make('⟲', STR.view.rotate, () => deps.onRotate(ROTATE_STEP)),
    make('🚶', STR.view.walk, () => deps.onWalk()),
    make('📜', STR.view.history, () => deps.onHistory()),
    sound,
  );
  root.append(column);

  return { dispose: () => column.remove() };
}
