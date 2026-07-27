import type { LobbyId } from '../data/lobbies';
import { STR } from '../data/strings.tr';

/**
 * The card a lobby arrives on (§24).
 *
 * Shaped like the bank and the road-repair prompts, because it is the same kind
 * of moment: an amount, a consequence, and two answers. What is different is
 * that both answers are real. The repair bill has a right answer and the card
 * only exists to make sure the player sees it in time; this one does not, and
 * the layout says so — the price and the cost sit in the same card, at the same
 * weight, and "Reddet" is a plain button rather than a way out.
 *
 * The cost line is never softened. A player who signs the oil contract has to
 * have been told, on the card they tapped, that the chimneys will smoke harder;
 * otherwise the pollution that arrives two minutes later is the game cheating,
 * and the whole term reads as a trap rather than as something they chose.
 */
export interface LobbyPromptHandle {
  /** Shows an offer. Does nothing if a card is already up. */
  offer(id: LobbyId, signing: number, stipend: number, termS: number): void;
  dismiss(): void;
  readonly open: boolean;
  /** Which offer is on screen, so the caller can avoid re-raising it. */
  readonly showing: LobbyId | null;
  dispose(): void;
}

export interface LobbyPromptDeps {
  /** Called on signing; returns whether it went through. */
  onSign(id: LobbyId): boolean;
  onDecline(id: LobbyId): void;
  /** Told when the city could not cover a fee it owed, so it can say why. */
  onTooPoor(): void;
}

export function mountLobbyPrompt(root: HTMLElement, deps: LobbyPromptDeps): LobbyPromptHandle {
  const panel = document.createElement('div');
  panel.className = 'parcel-prompt bank-prompt';
  panel.dataset['shown'] = 'false';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', STR.lobby.title);

  const title = document.createElement('div');
  title.className = 'parcel-title';

  const pitch = document.createElement('div');
  pitch.className = 'parcel-detail';

  const terms = document.createElement('div');
  terms.className = 'parcel-detail mono';

  // The cost, in the warning slot the road bill uses for its consequence. Same
  // styling, same position, on purpose: the player has already learned that
  // this line is the one that tells them what goes wrong.
  const cost = document.createElement('div');
  cost.className = 'bank-terms';

  const actions = document.createElement('div');
  actions.className = 'parcel-actions';

  const decline = document.createElement('button');
  decline.type = 'button';
  decline.className = 'parcel-button';
  decline.textContent = STR.lobby.decline;

  const sign = document.createElement('button');
  sign.type = 'button';
  sign.className = 'parcel-button primary';
  sign.textContent = STR.lobby.accept;

  actions.append(decline, sign);
  panel.append(title, pitch, terms, cost, actions);
  root.append(panel);

  let open = false;
  let showing: LobbyId | null = null;

  const dismiss = (): void => {
    open = false;
    showing = null;
    panel.dataset['shown'] = 'false';
  };

  const offer = (id: LobbyId, signing: number, stipend: number, termS: number): void => {
    if (open) return;
    showing = id;
    title.textContent = `${STR.lobby.icon} ${STR.lobby.names[id]}`;
    pitch.textContent = STR.lobby.pitch[id];

    // Both money lines, each in whichever direction it actually runs — a deal
    // the city pays for says so in the same place a deal that pays says it.
    const lines = [
      signing >= 0 ? STR.lobby.signingPaid(signing) : STR.lobby.signingCost(-signing),
    ];
    if (stipend !== 0) {
      lines.push(stipend > 0 ? STR.lobby.stipendPaid(stipend) : STR.lobby.stipendCost(-stipend));
    }
    lines.push(STR.lobby.term(termS));
    terms.textContent = lines.join(' · ');

    cost.textContent = STR.lobby.cost[id];
    panel.dataset['shown'] = 'true';
    open = true;
  };

  decline.addEventListener('click', () => {
    const id = showing;
    dismiss();
    if (id) deps.onDecline(id);
  });

  sign.addEventListener('click', () => {
    const id = showing;
    if (!id) return;
    // Stays up if the money was not there, the same rule the repair bill keeps:
    // closing on a signature that did not happen would tell the player they had
    // a deal they do not have.
    if (deps.onSign(id)) dismiss();
    else deps.onTooPoor();
  });

  return {
    offer,
    dismiss,
    get open() {
      return open;
    },
    get showing() {
      return showing;
    },
    dispose: () => panel.remove(),
  };
}
