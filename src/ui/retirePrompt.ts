import { STR } from '../data/strings.tr';

/**
 * Signing a city off.
 *
 * The one irreversible action in the game, so it is the only one that states
 * plainly what it destroys before it asks. It shows what the city is worth and
 * what that buys next time on the same card as the warning — a player deciding
 * whether to give up an evening's work should not have to remember the number
 * from a different screen.
 *
 * The destructive button is the primary one because that is what the player
 * came here to do, but the card is only ever opened deliberately, from a row
 * that does not exist until the city is old enough to be worth retiring.
 */
export interface RetirePromptHandle {
  show(points: number, endowment: number, grade: string, factor: number): void;
  dismiss(): void;
  readonly open: boolean;
  dispose(): void;
}

export interface RetirePromptDeps {
  onConfirm(): void;
}

export function mountRetirePrompt(
  root: HTMLElement,
  deps: RetirePromptDeps,
): RetirePromptHandle {
  const overlay = document.createElement('div');
  overlay.className = 'intro retire';
  overlay.dataset['shown'] = 'false';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', STR.legacy.title);

  const card = document.createElement('div');
  card.className = 'intro-card';

  const title = document.createElement('h1');
  title.className = 'intro-title';
  title.textContent = STR.legacy.title;

  const worth = document.createElement('p');
  worth.className = 'intro-lede';

  const endowment = document.createElement('p');
  endowment.className = 'retire-endowment';

  const warning = document.createElement('p');
  warning.className = 'retire-warning';
  warning.textContent = STR.legacy.warning;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'intro-start ghost';
  cancel.textContent = STR.legacy.cancel;

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'intro-start';
  confirm.textContent = STR.legacy.confirm;

  card.append(title, worth, endowment, warning, confirm, cancel);
  const graded = document.createElement('div');
  graded.className = 'bank-terms';
  card.append(graded);

  overlay.append(card);
  root.append(overlay);

  let open = false;

  const dismiss = (): void => {
    open = false;
    overlay.dataset['shown'] = 'false';
  };

  const show = (points: number, money: number, grade: string, factor: number): void => {
    worth.textContent = STR.legacy.worth(points);
    endowment.textContent = STR.legacy.endowment(money);
    // Why the figure is what it is. Without this the card quotes a number the
    // report card silently scaled, and a player who ran a careful city would
    // have no way to know that was what earned it — which is the difference
    // between a reward and a number that moved on its own (§1).
    graded.textContent = STR.legacy.graded(grade, STR.format.percent(factor));
    overlay.dataset['shown'] = 'true';
    open = true;
    // Focus lands on cancel, not on the button that deletes the city.
    window.setTimeout(() => cancel.focus(), 60);
  };

  cancel.addEventListener('click', dismiss);
  confirm.addEventListener('click', () => {
    dismiss();
    deps.onConfirm();
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });

  return {
    show,
    dismiss,
    get open() {
      return open;
    },
    dispose: () => overlay.remove(),
  };
}
