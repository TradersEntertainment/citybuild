import { STR } from '../data/strings.tr';

/**
 * The state's repair bill for the national highway.
 *
 * It comes to the player rather than waiting in a menu, for the same reason
 * the bank offer does: the moment it matters is a moment they are about to be
 * hurt by not knowing. Shaped like the bank prompt, because it is the same kind
 * of decision — an amount, a consequence, and two answers.
 *
 * The urgent line is the difference between the two moments it appears in. A
 * bill on a road that still works is a choice; a bill on a road that has been
 * barricaded is a rescue, and the card says so rather than repeating itself.
 */
export interface RoadRepairPromptHandle {
  /** Shows the bill. Does nothing if it is already up, or if there is none. */
  offer(cost: number, blocked: boolean): void;
  dismiss(): void;
  readonly open: boolean;
  dispose(): void;
}

export interface RoadRepairPromptDeps {
  /** Called on confirm; returns whether the repair was actually paid for. */
  onPay(): boolean;
  /** Told when the city could not cover the bill, so it can say why. */
  onTooPoor(): void;
}

export function mountRoadRepairPrompt(
  root: HTMLElement,
  deps: RoadRepairPromptDeps,
): RoadRepairPromptHandle {
  const panel = document.createElement('div');
  panel.className = 'parcel-prompt bank-prompt';
  panel.dataset['shown'] = 'false';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', STR.roadRepair.title);

  const title = document.createElement('div');
  title.className = 'parcel-title';
  title.textContent = `${STR.roadRepair.icon} ${STR.roadRepair.title}`;

  const headline = document.createElement('div');
  headline.className = 'parcel-detail mono';

  const warning = document.createElement('div');
  warning.className = 'bank-terms';

  const actions = document.createElement('div');
  actions.className = 'parcel-actions';

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'parcel-button';
  later.textContent = STR.roadRepair.later;

  const pay = document.createElement('button');
  pay.type = 'button';
  pay.className = 'parcel-button primary';
  pay.textContent = STR.roadRepair.pay;

  actions.append(later, pay);
  panel.append(title, headline, warning, actions);
  root.append(panel);

  let open = false;

  const dismiss = (): void => {
    open = false;
    panel.dataset['shown'] = 'false';
  };

  const offer = (cost: number, blocked: boolean): void => {
    if (open || cost <= 0) return;
    headline.textContent = STR.roadRepair.bill(cost);
    warning.textContent = blocked ? STR.roadRepair.urgent : STR.roadRepair.warning;
    panel.dataset['shown'] = 'true';
    open = true;
  };

  later.addEventListener('click', dismiss);
  pay.addEventListener('click', () => {
    // Stays up if the money was not there: closing on a payment that did not
    // happen would tell the player the road is fixed when it is not.
    if (deps.onPay()) dismiss();
    else deps.onTooPoor();
  });

  return {
    offer,
    dismiss,
    get open() {
      return open;
    },
    dispose: () => panel.remove(),
  };
}
