import { STR } from '../data/strings.tr';

/**
 * The opening screen.
 *
 * Without it a new player lands on a map with four unlabelled verbs and taps
 * around until something happens — which is exactly what they will tell you
 * they did. Three lines and a button is enough: what the game is, what the one
 * gesture does, and how to move the camera. Everything else the guidance chain
 * teaches in place, when it is relevant.
 *
 * It is shown once. A player who has already built something does not need to
 * be told what a road is, so a loaded city skips it — being greeted by a
 * tutorial you finished last week is its own kind of broken.
 */
const SEEN_KEY = 'kadastro.introSeen';

export interface IntroHandle {
  /** True when the screen is up and the map should stay untouched. */
  readonly open: boolean;
  dismiss(): void;
  dispose(): void;
}

export interface IntroDeps {
  /** Skip the screen entirely — a returning city does not need introducing. */
  skip: boolean;
  onDismiss(): void;
}

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Private browsing: show it, which is the safe way to be wrong.
    return false;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Not being able to remember costs one extra screen, not the game.
  }
}

export function mountIntro(root: HTMLElement, deps: IntroDeps): IntroHandle {
  if (deps.skip || alreadySeen()) {
    return { open: false, dismiss: () => {}, dispose: () => {} };
  }

  const overlay = document.createElement('div');
  overlay.className = 'intro';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', STR.intro.title);

  const card = document.createElement('div');
  card.className = 'intro-card';

  const title = document.createElement('h1');
  title.className = 'intro-title';
  title.textContent = STR.intro.title;

  const lede = document.createElement('p');
  lede.className = 'intro-lede';
  lede.textContent = STR.intro.lede;

  const steps = document.createElement('ol');
  steps.className = 'intro-steps';
  // Numbered because they genuinely are a sequence: nothing grows until the
  // road exists, and nothing is zoned until there is a road to zone beside.
  for (const step of STR.intro.steps) {
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = step.verb;
    const rest = document.createElement('span');
    rest.textContent = ` ${step.text}`;
    item.append(strong, rest);
    steps.append(item);
  }

  const camera = document.createElement('p');
  camera.className = 'intro-camera';
  camera.textContent = STR.intro.camera;

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'intro-start';
  start.textContent = STR.intro.start;

  card.append(title, lede, steps, camera, start);
  overlay.append(card);
  root.append(overlay);

  let open = true;
  const dismiss = (): void => {
    if (!open) return;
    open = false;
    remember();
    overlay.dataset['closing'] = 'true';
    // Removed after the fade so the map is not left with a dead layer over it.
    window.setTimeout(() => overlay.remove(), 260);
    deps.onDismiss();
  };

  start.addEventListener('click', dismiss);
  // Anywhere on the sheet works too: the button is the affordance, not the rule.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });

  // Focus lands on the one control, so a keyboard or switch user starts here.
  window.setTimeout(() => start.focus(), 60);

  return {
    get open() {
      return open;
    },
    dismiss,
    dispose: () => overlay.remove(),
  };
}
