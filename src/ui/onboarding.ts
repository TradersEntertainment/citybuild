import { LEADER_ORDER, LEADER_SPECS, type LeaderId } from '../data/leaders';
import { PROMISE_ORDER, PROMISE_SPECS } from '../data/promises';
import { STR } from '../data/strings.tr';

/**
 * The opening flow (§33): choose a dictator, then win the first term.
 *
 * This replaces the old "here is what a road is" card for a fresh game, because
 * a politics game should not open on a map — it should open on a *choice about
 * who you are*, and then make you buy an election. The road tutorial still
 * happens; it just happens after, taught in place by the coach, once the player
 * is the elected leader with a city to run.
 *
 * Two screens:
 *
 * 1. **Pick your dictator.** Five leaders, each a lean rather than a class — a
 *    base of two constituencies and one concrete edge, both stated plainly.
 * 2. **Win your first term.** The factions your base already warms are shown,
 *    and a short list of promises to make. A live approval figure moves as you
 *    add promises; clear the threshold and the "start" button lights.
 *
 * The whole thing hands back one object — the chosen leader and the promises
 * made — and the caller writes them into the fresh game state. Nothing here
 * touches the sim; it is a form, and a form that teaches the two verbs the rest
 * of the game is built on.
 */
export interface OnboardingChoice {
  leader: LeaderId;
  promises: string[];
}

export interface OnboardingDeps {
  /**
   * Scores a hypothetical opening: given a leader and a set of promises, what
   * would the vote be? Lives in the caller because it reads the sim's own
   * faction machinery — the onboarding must never invent its own numbers.
   */
  scoreOpening(leader: LeaderId, promises: readonly string[]): number;
  /** The winning threshold, so the copy and the gate agree. */
  threshold: number;
  onComplete(choice: OnboardingChoice): void;
}

/** The promises offered at the opening: the town-era set, which every era has. */
const OPENING_PROMISES = PROMISE_ORDER.filter((id) => PROMISE_SPECS[id].from === 'town');
/** How many an opening candidate may make — the ordinary campaign cap. */
const OPENING_LIMIT = 3;

export interface OnboardingHandle {
  readonly open: boolean;
  dispose(): void;
}

export function mountOnboarding(root: HTMLElement, deps: OnboardingDeps): OnboardingHandle {
  const overlay = document.createElement('div');
  overlay.className = 'intro onboarding';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', STR.onboarding.pickTitle);

  const card = document.createElement('div');
  card.className = 'intro-card onboarding-card';
  overlay.append(card);
  root.append(overlay);

  let open = true;
  let chosen: LeaderId | null = null;
  const promises = new Set<string>();

  const close = (): void => {
    open = false;
    overlay.dataset['closing'] = 'true';
    window.setTimeout(() => overlay.remove(), 260);
  };

  // --- Screen 1: pick a leader ---------------------------------------------------

  const showPick = (): void => {
    card.replaceChildren();

    const title = document.createElement('h1');
    title.className = 'intro-title';
    title.textContent = STR.onboarding.pickTitle;

    const lede = document.createElement('p');
    lede.className = 'intro-lede';
    lede.textContent = STR.onboarding.pickLede;
    card.append(title, lede);

    const grid = document.createElement('div');
    grid.className = 'leader-grid';
    for (const id of LEADER_ORDER) {
      const spec = LEADER_SPECS[id];
      const copy = STR.onboarding.leaders[id as keyof typeof STR.onboarding.leaders];

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'leader-card';

      const name = document.createElement('div');
      name.className = 'leader-name';
      name.textContent = copy.name;

      const base = document.createElement('div');
      base.className = 'leader-base';
      base.textContent = `${STR.onboarding.base}: ${spec.base.map((g) => STR.groups.name[g] ?? g).join(', ')}`;

      const edge = document.createElement('div');
      edge.className = 'leader-edge';
      edge.textContent = copy.edge;

      cell.append(name, base, edge);
      cell.addEventListener('click', () => {
        chosen = id;
        showVote();
      });
      grid.append(cell);
    }
    card.append(grid);
  };

  // --- Screen 2: win the first term ---------------------------------------------

  const showVote = (): void => {
    if (!chosen) return;
    card.replaceChildren();
    promises.clear();

    const title = document.createElement('h1');
    title.className = 'intro-title';
    title.textContent = STR.onboarding.voteTitle;

    const lede = document.createElement('p');
    lede.className = 'intro-lede';
    lede.textContent = STR.onboarding.voteLede;

    // The base you start with, named — the room already on your side.
    const baseLine = document.createElement('p');
    baseLine.className = 'intro-camera';
    const baseNames = LEADER_SPECS[chosen].base.map((g) => STR.groups.name[g] ?? g).join(', ');
    baseLine.textContent = `${STR.onboarding.yourBase} ${baseNames}`;
    card.append(title, lede, baseLine);

    // The live tally and the promise list.
    const tally = document.createElement('div');
    tally.className = 'vote-tally';
    const approvalLabel = document.createElement('span');
    const approvalValue = document.createElement('span');
    approvalValue.className = 'mono';
    tally.append(approvalLabel, approvalValue);

    const bar = document.createElement('div');
    bar.className = 'panel-group-track vote-bar';
    const fill = document.createElement('div');
    fill.className = 'panel-group-bar';
    bar.append(fill);

    const list = document.createElement('div');
    list.className = 'promise-picks';

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'intro-start';

    const refresh = (): void => {
      const share = deps.scoreOpening(chosen as LeaderId, [...promises]);
      const won = share >= deps.threshold;
      approvalLabel.textContent = STR.onboarding.approval;
      approvalValue.textContent = STR.format.percent(share);
      fill.style.width = `${Math.round(Math.min(1, share) * 100)}%`;
      tally.dataset['won'] = String(won);
      start.disabled = !won;
      start.textContent = won ? STR.onboarding.win : STR.onboarding.losing;
    };

    for (const id of OPENING_PROMISES) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'panel-policy promise-pick';
      const key = id as keyof typeof STR.promise.names;
      const label = document.createElement('span');
      label.textContent = `${STR.promise.names[key]} — ${STR.promise.courts[key]}`;
      row.append(label);
      row.addEventListener('click', () => {
        if (promises.has(id)) promises.delete(id);
        else if (promises.size < OPENING_LIMIT) promises.add(id);
        row.dataset['selected'] = String(promises.has(id));
        refresh();
      });
      list.append(row);
    }

    start.addEventListener('click', () => {
      if (start.disabled) return;
      close();
      deps.onComplete({ leader: chosen as LeaderId, promises: [...promises] });
    });

    card.append(tally, bar, list, start);
    refresh();
  };

  showPick();
  return {
    get open() {
      return open;
    },
    dispose: () => overlay.remove(),
  };
}
