import { STR } from '../data/strings.tr';
import type { ParcelOffer } from '../sim/parcels';

/**
 * The offer panel for a piece of land the player has tapped.
 *
 * It is a panel rather than a dialog on purpose: buying land is the one moment
 * the game asks for a decision, and a modal would cover the very thing being
 * decided about. The map stays visible and the panel stays out of the thumb's
 * way of the tool dock.
 */
export interface ParcelPromptHandle {
  /** Shows the offer, or hides the panel when passed null. */
  show(offer: ParcelOffer | null): void;
  dispose(): void;
}

export interface ParcelPromptDeps {
  /** Called when the player confirms; returns whether the purchase happened. */
  onBuy(offer: ParcelOffer): boolean;
}

export function mountParcelPrompt(
  root: HTMLElement,
  deps: ParcelPromptDeps,
): ParcelPromptHandle {
  const panel = document.createElement('div');
  panel.className = 'parcel-prompt';
  panel.dataset['shown'] = 'false';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', STR.parcel.title);

  const title = document.createElement('div');
  title.className = 'parcel-title';
  title.textContent = STR.parcel.title;

  const detail = document.createElement('div');
  detail.className = 'parcel-detail mono';

  const actions = document.createElement('div');
  actions.className = 'parcel-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'parcel-button';
  cancel.textContent = STR.parcel.cancel;

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'parcel-button primary';

  actions.append(cancel, confirm);
  panel.append(title, detail, actions);
  root.append(panel);

  let current: ParcelOffer | null = null;

  const hide = (): void => {
    current = null;
    panel.dataset['shown'] = 'false';
  };

  const show = (offer: ParcelOffer | null): void => {
    current = offer;
    if (!offer) {
      hide();
      return;
    }
    detail.textContent = STR.parcel.detail(offer.price, offer.buildableFraction);
    confirm.textContent = offer.affordable ? STR.parcel.buy : STR.parcel.tooDear;
    confirm.disabled = !offer.affordable;
    panel.dataset['shown'] = 'true';
  };

  cancel.addEventListener('click', hide);
  confirm.addEventListener('click', () => {
    if (!current) return;
    // The panel closes only on a purchase that actually happened; if the money
    // went elsewhere between opening and confirming, the player should see the
    // offer still standing rather than a silent no-op.
    if (deps.onBuy(current)) hide();
  });

  return {
    show,
    dispose: () => panel.remove(),
  };
}
