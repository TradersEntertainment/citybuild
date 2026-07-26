import {
  KEY_MAX_FRAME_S,
  KEY_PAN_SPEED,
  KEY_ROTATE_SPEED,
  KEY_SPRINT,
  KEY_ZOOM_SPEED,
} from '../data/balance';

/**
 * Moving the map with the keyboard.
 *
 * The camera had exactly one way to be moved: drag it. That is fine on a phone
 * and quietly awful on a desktop, where the drag either fights the drawing tool
 * for the same button or needs two fingers on a trackpad that may not have
 * them. Crossing a 256-tile map by repeatedly picking it up and putting it down
 * is the sort of thing a player does twice before deciding the game is fiddly.
 *
 * So: WASD and the arrow keys pan, Q/E turn, R/F zoom, Shift hurries. It is the
 * layout every map in every game has used for twenty years, which is the reason
 * to use it — nobody has to be told.
 *
 * Pure state, no DOM: it records which keys are down and reports the movement
 * one frame's worth of that is worth. The binding lives beside it, and the
 * walk-mode handler can take the same keys away from it without either knowing
 * about the other.
 */
export interface CameraNudge {
  /** Screen-space pan, in pixels, to hand to the rig's own drag maths. */
  panX: number;
  panY: number;
  /** Radians to turn. */
  rotate: number;
  /** Multiplier on the current zoom. 1 means leave it alone. */
  zoom: number;
  /** Whether anything at all is being held. */
  active: boolean;
}

const IDLE: CameraNudge = { panX: 0, panY: 0, rotate: 0, zoom: 1, active: false };

/** Which key does what. Both layouts at once; nobody has to guess. */
const PAN_LEFT = new Set(['KeyA', 'ArrowLeft']);
const PAN_RIGHT = new Set(['KeyD', 'ArrowRight']);
const PAN_UP = new Set(['KeyW', 'ArrowUp']);
const PAN_DOWN = new Set(['KeyS', 'ArrowDown']);
const TURN_LEFT = new Set(['KeyQ']);
const TURN_RIGHT = new Set(['KeyE']);
const ZOOM_IN = new Set(['KeyR', 'Equal', 'NumpadAdd']);
const ZOOM_OUT = new Set(['KeyF', 'Minus', 'NumpadSubtract']);

/** Every key this claims, so the binding knows what to swallow. */
const CLAIMED: ReadonlySet<string> = new Set([
  ...PAN_LEFT,
  ...PAN_RIGHT,
  ...PAN_UP,
  ...PAN_DOWN,
  ...TURN_LEFT,
  ...TURN_RIGHT,
  ...ZOOM_IN,
  ...ZOOM_OUT,
]);

export function claimsKey(code: string): boolean {
  return CLAIMED.has(code);
}

export class KeyboardCamera {
  private readonly held = new Set<string>();
  private sprinting = false;

  /** Returns true when the key was one of ours, so the caller can swallow it. */
  down(code: string, shift: boolean): boolean {
    this.sprinting = shift;
    if (!CLAIMED.has(code)) return false;
    this.held.add(code);
    return true;
  }

  up(code: string, shift: boolean): void {
    this.sprinting = shift;
    this.held.delete(code);
  }

  /** Called when the window loses focus: a held key that never comes up drifts. */
  releaseAll(): void {
    this.held.clear();
    this.sprinting = false;
  }

  get anyHeld(): boolean {
    return this.held.size > 0;
  }

  /**
   * One frame's movement.
   *
   * Pan is in screen pixels rather than tiles so it goes through the rig's own
   * drag maths — the same conversion the finger uses, which means the keys move
   * the map exactly the way dragging it does however the view is rotated, and
   * there is only one place where that conversion can be wrong.
   */
  nudge(deltaSeconds: number): CameraNudge {
    if (this.held.size === 0) return IDLE;
    // A frame that took a second — a tab coming back, a long rebuild — must not
    // fling the camera across the map. The cap is generous on purpose: set
    // tight, it silently slows panning on exactly the cheap phones that need it
    // most, because a 10 fps frame would be clipped every time.
    const dt = Math.min(KEY_MAX_FRAME_S, Math.max(0, deltaSeconds));
    const hurry = this.sprinting ? KEY_SPRINT : 1;

    const x = this.axis(PAN_RIGHT, PAN_LEFT);
    const y = this.axis(PAN_DOWN, PAN_UP);
    const turn = this.axis(TURN_RIGHT, TURN_LEFT);
    const zoom = this.axis(ZOOM_IN, ZOOM_OUT);

    // Diagonals normalised, or holding two keys would move you 41% faster than
    // holding one — the classic bug, and it is felt even when it is not seen.
    const length = Math.hypot(x, y) || 1;
    const speed = (KEY_PAN_SPEED * hurry * dt) / length;

    return {
      // Negated: pressing "right" moves the camera right, which means dragging
      // the map left. Zeroed explicitly rather than left as -0, which compares
      // unequal to 0 under Object.is and is the sort of thing that only ever
      // shows up in somebody else's assertion.
      panX: x === 0 ? 0 : -x * speed,
      panY: y === 0 ? 0 : -y * speed,
      rotate: turn === 0 ? 0 : turn * KEY_ROTATE_SPEED * dt,
      zoom: zoom === 0 ? 1 : Math.pow(KEY_ZOOM_SPEED, zoom * dt),
      active: true,
    };
  }

  private axis(positive: ReadonlySet<string>, negative: ReadonlySet<string>): number {
    let value = 0;
    for (const code of this.held) {
      if (positive.has(code)) value += 1;
      else if (negative.has(code)) value -= 1;
    }
    return Math.max(-1, Math.min(1, value));
  }
}

export interface KeyboardCameraBinding {
  readonly keys: KeyboardCamera;
  dispose(): void;
}

/**
 * Wires the keys to the window.
 *
 * `isBlocked` is how the walk mode and the text fields keep their keys: it is
 * asked on every press rather than latched, so leaving a walk hands the keys
 * back with nothing to reset.
 */
export function bindKeyboardCamera(isBlocked: () => boolean): KeyboardCameraBinding {
  const keys = new KeyboardCamera();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    // A modifier means the browser's shortcut, not ours: Ctrl+A is select-all
    // everywhere in the world and must stay that way.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTyping(event.target) || isBlocked()) return;
    if (keys.down(event.code, event.shiftKey)) event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    keys.up(event.code, event.shiftKey);
  };

  const onBlur = (): void => keys.releaseAll();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    keys,
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}

/**
 * Whether a key press belongs to a text field rather than to the game.
 *
 * Shared, because every global shortcut needs the same answer and a second copy
 * of it would be one edit away from disagreeing with this one.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
