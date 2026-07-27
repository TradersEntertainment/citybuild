import { STR } from '../data/strings.tr';
import type { InspectReport } from '../sim/inspect';

/**
 * The building card (§14): tap a building, get told what it is and — the part
 * that matters — why it is not more.
 *
 * Every gate in the growth loop is invisible by design, and this game keeps
 * adding gates: a suburb's level cap, a downtown's service bill, an office's
 * schooling bar. Each one says "not yet" by doing nothing, and a player
 * staring at a three-storey block has no way to hear which "not yet" it is.
 * This card is the hearing. The sim half (sim/inspect.ts) names the blockers;
 * this file only turns them into sentences and keeps them out of the way.
 *
 * Modelled on the parcel prompt: same slot above the dock, same dismissal
 * rules — a stroke, a tool, or the close button all clear it, because a card
 * that lingers over the map becomes furniture.
 */
export interface InspectorHandle {
  /** Shows (or refreshes) the card for a building. */
  show(buildingId: number, report: InspectReport): void;
  /** The building on display, or 0 — the shell polls this to refresh. */
  readonly openId: number;
  hide(): void;
  dispose(): void;
}

export function mountInspector(root: HTMLElement): InspectorHandle {
  const panel = document.createElement('div');
  panel.className = 'inspector-card';
  panel.dataset['shown'] = 'false';

  const title = document.createElement('div');
  title.className = 'inspector-title';
  const facts = document.createElement('div');
  facts.className = 'inspector-facts mono';
  const why = document.createElement('div');
  why.className = 'inspector-why';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'inspector-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', STR.inspector.close);

  panel.append(close, title, facts, why);
  root.append(panel);

  let openId = 0;

  const hide = (): void => {
    openId = 0;
    panel.dataset['shown'] = 'false';
  };
  close.addEventListener('click', hide);

  const show = (buildingId: number, report: InspectReport): void => {
    openId = buildingId;
    title.textContent = `${STR.zone[report.zone]} · ${STR.inspector.level(report.level, report.cap)}`;

    const lines: string[] = [
      report.zone === 'res'
        ? STR.inspector.residents(report.occupants, report.capacity)
        : STR.inspector.jobs(report.occupants, report.capacity),
    ];
    if (report.outputPerMinute > 0) lines.push(STR.inspector.output(report.outputPerMinute));
    facts.textContent = lines.join(' · ');

    // One sentence, not a diagnosis screen: the first blocker is the wall the
    // growth pass actually hits first, so it is the one worth acting on.
    const blocker = report.blockers[0];
    why.textContent = report.maxed
      ? STR.inspector.maxed
      : blocker
        ? STR.inspector.blocker[blocker]
        : STR.inspector.growing;
    why.dataset['tone'] = report.maxed ? 'done' : blocker ? 'blocked' : 'growing';

    panel.dataset['shown'] = 'true';
  };

  return {
    show,
    get openId() {
      return openId;
    },
    hide,
    dispose: () => panel.remove(),
  };
}
