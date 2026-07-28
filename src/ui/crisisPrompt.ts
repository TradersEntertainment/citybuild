import { STR } from '../data/strings.tr';

/**
 * The card that comes up when the mayor loses (§29).
 *
 * Three answers, and unlike every other prompt in this game none of them is the
 * safe one. The bank offer has a right answer most of the time; the repair bill
 * has a right answer almost always, and the card exists to make sure the player
 * sees it in time. This one does not, and the layout has to say so: three
 * buttons of equal weight, each with its cost written under it in the same
 * type as its offer.
 *
 * No "later". A lost election is not a thing that can be deferred — the city
 * has voted and somebody is going to be governing tomorrow — and a dismissable
 * card would leave the game in a state with no answer to "who is in charge".
 * That is the one prompt in the game with no way out, and it is the right one
 * to have it.
 */
export interface CrisisPromptHandle {
  /** Shows the fork. Does nothing if it is already up. */
  offer(approvalShare: string): void;
  readonly open: boolean;
  dispose(): void;
}

export type CrisisChoice = 'handOver' | 'refuse' | 'seize';

export interface CrisisPromptDeps {
  onChoose(choice: CrisisChoice): void;
}

export function mountCrisisPrompt(
  root: HTMLElement,
  deps: CrisisPromptDeps,
): CrisisPromptHandle {
  const panel = document.createElement('div');
  panel.className = 'parcel-prompt bank-prompt';
  panel.dataset['shown'] = 'false';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', STR.crisis.title);

  const title = document.createElement('div');
  title.className = 'parcel-title';
  title.textContent = `${STR.crisis.icon} ${STR.crisis.title}`;

  const lead = document.createElement('div');
  lead.className = 'parcel-detail';

  const actions = document.createElement('div');
  actions.className = 'parcel-actions';
  actions.style.flexDirection = 'column';

  let open = false;

  const dismiss = (): void => {
    open = false;
    panel.dataset['shown'] = 'false';
  };

  /**
   * One answer: the button, and the price of taking it directly underneath.
   *
   * The note is not a tooltip. A consequence a player has to hover to discover
   * is a consequence the game hid, and this is the one decision in Kadastro
   * that cannot be undone by doing the opposite next minute.
   */
  const choice = (
    label: string,
    note: string,
    kind: CrisisChoice,
    primary: boolean,
  ): void => {
    const wrap = document.createElement('div');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'parcel-button primary' : 'parcel-button';
    button.textContent = label;
    button.style.width = '100%';
    button.addEventListener('click', () => {
      dismiss();
      deps.onChoose(kind);
    });

    const detail = document.createElement('div');
    detail.className = 'bank-terms';
    detail.textContent = note;

    wrap.append(button, detail);
    actions.append(wrap);
  };

  // Handing over is listed first and styled as the primary, which is a claim
  // rather than a nudge: it is what a mayor is supposed to do, and the game is
  // allowed to say so as long as the other two remain fully available and
  // honestly described.
  choice(STR.crisis.handOver, STR.crisis.handOverNote, 'handOver', true);
  choice(STR.crisis.refuse, STR.crisis.refuseNote, 'refuse', false);
  choice(STR.crisis.seize, STR.crisis.seizeNote, 'seize', false);

  panel.append(title, lead, actions);
  root.append(panel);

  return {
    offer: (approvalShare: string) => {
      if (open) return;
      lead.textContent = STR.crisis.lead(approvalShare);
      panel.dataset['shown'] = 'true';
      open = true;
    },
    get open() {
      return open;
    },
    dispose: () => panel.remove(),
  };
}
