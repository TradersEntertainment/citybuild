import { STR } from '../data/strings.tr';

/**
 * The street-level HUD (§15): an exit button, a crosshair, a hint line, and —
 * on touch devices — a virtual joystick for the left thumb. Looking around is
 * a drag on the canvas itself, which the shell reroutes to the walk mode, so
 * the HUD only has to provide what a drag cannot.
 *
 * Everything here is created hidden and toggled with the mode; mounting costs
 * the map view nothing.
 */
export interface WalkHudHandle {
  /** Show/hide the HUD with the mode. */
  setActive(active: boolean): void;
  /** The stick's current −1..1 vector, read once per frame. */
  stick(): { x: number; y: number };
  /** True on coarse-pointer devices, where the stick is shown. */
  readonly touchLayout: boolean;
  dispose(): void;
}

export interface WalkHudDeps {
  onExit(): void;
}

export function mountWalkHud(root: HTMLElement, deps: WalkHudDeps): WalkHudHandle {
  const touchLayout = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  const hud = document.createElement('div');
  hud.className = 'walk-hud';
  hud.dataset['active'] = 'false';

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'walk-exit';
  exit.textContent = `✕ ${STR.walk.exit}`;
  exit.addEventListener('click', () => deps.onExit());

  const crosshair = document.createElement('div');
  crosshair.className = 'walk-crosshair';

  const hint = document.createElement('p');
  hint.className = 'walk-hint';
  hint.textContent = touchLayout ? STR.walk.hintTouch : STR.walk.hintKeys;

  hud.append(exit, crosshair, hint);

  // --- Joystick --------------------------------------------------------------
  // The stick reports a vector; the walk mode turns it into steps. It lives
  // on its own element rather than the canvas so a walking thumb never starts
  // a look-drag.
  const stickState = { x: 0, y: 0 };
  let stick: HTMLElement | null = null;
  if (touchLayout) {
    stick = document.createElement('div');
    stick.className = 'walk-stick';
    const nub = document.createElement('div');
    nub.className = 'walk-stick-nub';
    stick.append(nub);
    hud.append(stick);

    let pointerId: number | null = null;
    const setFromEvent = (event: PointerEvent): void => {
      const base = stick as HTMLElement;
      const rect = base.getBoundingClientRect();
      const radius = rect.width / 2;
      const dx = (event.clientX - (rect.left + radius)) / radius;
      const dy = (event.clientY - (rect.top + radius)) / radius;
      const length = Math.hypot(dx, dy);
      const clamped = length > 1 ? 1 / length : 1;
      stickState.x = dx * clamped;
      stickState.y = dy * clamped;
      nub.style.transform = `translate(${stickState.x * radius * 0.55}px, ${stickState.y * radius * 0.55}px)`;
    };
    const release = (): void => {
      pointerId = null;
      stickState.x = 0;
      stickState.y = 0;
      nub.style.transform = 'translate(0px, 0px)';
    };
    stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      pointerId = event.pointerId;
      (stick as HTMLElement).setPointerCapture(event.pointerId);
      setFromEvent(event);
    });
    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      setFromEvent(event);
    });
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
  }

  root.append(hud);

  return {
    setActive: (active) => {
      hud.dataset['active'] = String(active);
      // The hint earns its place once; a returning walker does not need it again.
      if (!active) hint.dataset['seen'] = 'true';
    },
    stick: () => ({ ...stickState }),
    touchLayout,
    dispose: () => hud.remove(),
  };
}
