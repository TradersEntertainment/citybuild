import { STR } from '../data/strings.tr';
import type { LoanOffer } from '../sim/credit';

/**
 * The bank, offered when the city runs out of money.
 *
 * It comes to the player rather than sitting behind a menu, because the moment
 * it is useful is a moment they are already stuck and unlikely to go looking.
 * It offers once per dry spell and then stays quiet: a prompt that reappears
 * every few seconds while the balance sits at zero would be nagging a player
 * who has already said no.
 *
 * Shaped like the parcel offer, and for the same reason — the map stays visible,
 * because this is a decision about the city.
 */
export interface BankPromptHandle {
  /** Offers the loan. Does nothing if the panel is already up. */
  offer(loan: LoanOffer): void;
  dismiss(): void;
  readonly open: boolean;
  dispose(): void;
}

export interface BankPromptDeps {
  /** Called on confirm; returns whether the loan was actually granted. */
  onBorrow(): boolean;
}

export function mountBankPrompt(root: HTMLElement, deps: BankPromptDeps): BankPromptHandle {
  const panel = document.createElement('div');
  panel.className = 'parcel-prompt bank-prompt';
  panel.dataset['shown'] = 'false';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', STR.bank.title);

  const title = document.createElement('div');
  title.className = 'parcel-title';
  title.textContent = STR.bank.title;

  const headline = document.createElement('div');
  headline.className = 'parcel-detail mono';

  const terms = document.createElement('div');
  terms.className = 'bank-terms';

  const actions = document.createElement('div');
  actions.className = 'parcel-actions';

  const decline = document.createElement('button');
  decline.type = 'button';
  decline.className = 'parcel-button';
  decline.textContent = STR.bank.decline;

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'parcel-button primary';
  confirm.textContent = STR.bank.take;

  actions.append(decline, confirm);
  panel.append(title, headline, terms, actions);
  root.append(panel);

  let open = false;

  const dismiss = (): void => {
    open = false;
    panel.dataset['shown'] = 'false';
  };

  const offer = (loan: LoanOffer): void => {
    if (open || loan.principal <= 0) return;
    headline.textContent = STR.bank.offer(loan.principal, loan.rate);
    terms.textContent = STR.bank.instalment(loan.instalment);
    panel.dataset['shown'] = 'true';
    open = true;
  };

  decline.addEventListener('click', dismiss);
  confirm.addEventListener('click', () => {
    // Closes only on a loan that was actually granted; if the offer went stale
    // between opening and confirming, the panel stays rather than silently
    // doing nothing.
    if (deps.onBorrow()) dismiss();
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
