import { STR } from '../data/strings.tr';
import type { OfflineReport } from '../sim/offline';
import { splitDuration } from '../sim/offline';

/**
 * The returning card (§11): what the city did while nobody was watching.
 *
 * This is the only moment an idle game gets to reward the player for coming
 * back, and it is the one the numbers are read most carefully in — which is why
 * the absence is genuinely simulated rather than paid out from a formula. The
 * card only reports; it does not decide anything.
 *
 * It stays out of the way of a glance at another tab: an absence shorter than
 * the reporting floor produces no card at all, because being told that nothing
 * happened is worse than being told nothing.
 */
export interface ChronicleHandle {
  /** Shows the card, or does nothing when the absence was not worth reporting. */
  show(report: OfflineReport): void;
  dismiss(): void;
  readonly open: boolean;
  dispose(): void;
}

export interface ChronicleDeps {
  /** Jobs and homes as they now stand, for the closing line. */
  glance(): { jobs: number; housing: number };
  onDismiss?(): void;
}

export function mountChronicle(root: HTMLElement, deps: ChronicleDeps): ChronicleHandle {
  let overlay: HTMLElement | null = null;

  const dismiss = (): void => {
    const current = overlay;
    if (!current) return;
    overlay = null;
    current.dataset['closing'] = 'true';
    window.setTimeout(() => current.remove(), 260);
    deps.onDismiss?.();
  };

  const show = (report: OfflineReport): void => {
    if (!report.worthReporting) return;
    dismiss();

    const element = document.createElement('div');
    element.className = 'intro chronicle';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-label', STR.chronicle.title);

    const card = document.createElement('div');
    card.className = 'intro-card';

    const title = document.createElement('h1');
    title.className = 'intro-title';
    title.textContent = STR.chronicle.title;

    const away = splitDuration(report.away.rawMs);
    const lede = document.createElement('p');
    lede.className = 'intro-lede';
    lede.textContent = STR.chronicle.away(away.hours, away.minutes);

    card.append(title, lede);

    // Only what actually moved. A row of zeroes reads as a broken feature, and
    // a city that was already full genuinely does nothing but take the rent.
    const rows = document.createElement('dl');
    rows.className = 'chronicle-rows';
    const add = (label: string, value: string): void => {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.className = 'mono';
      detail.textContent = value;
      rows.append(term, detail);
    };

    if (Math.round(report.moneyEarned) !== 0) {
      add(STR.chronicle.earned, STR.chronicle.money(report.moneyEarned));
    }
    if (Math.round(report.populationGained) !== 0) {
      add(STR.chronicle.moved, STR.chronicle.people(report.populationGained));
    }
    if (report.buildingsBuilt !== 0) {
      add(STR.chronicle.built, STR.chronicle.buildings(report.buildingsBuilt));
    }
    const glance = deps.glance();
    add(STR.chronicle.city, STR.chronicle.glance(glance.housing, glance.jobs));
    card.append(rows);

    // An era passed while they were away is the headline, not a row.
    if (report.eraReached) {
      const era = document.createElement('p');
      era.className = 'chronicle-era';
      era.textContent = STR.era.reached(STR.eraName[report.eraReached]);
      card.append(era);
    }

    // The efficiency bands are visible rather than silent: a player who works
    // out that the fourteenth hour paid less than the first should find the
    // game already told them.
    const note = document.createElement('p');
    note.className = 'intro-camera';
    note.textContent = STR.chronicle.efficiency(Math.round(report.away.efficiency * 100));
    card.append(note);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'intro-start';
    button.textContent = STR.chronicle.resume;
    button.addEventListener('click', dismiss);
    card.append(button);

    element.append(card);
    element.addEventListener('click', (event) => {
      if (event.target === element) dismiss();
    });
    root.append(element);
    overlay = element;
    window.setTimeout(() => button.focus(), 60);
  };

  return {
    show,
    dismiss,
    get open() {
      return overlay !== null;
    },
    dispose: () => {
      overlay?.remove();
      overlay = null;
    },
  };
}
