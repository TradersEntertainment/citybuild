import { STR } from '../data/strings.tr';

/**
 * The guided opening.
 *
 * A card that explains the game once is not enough — a new player closes it and
 * is back to four unlabelled buttons. The coach instead points at the control
 * they need *now*, waits until they have actually used it, and only then moves
 * on. It teaches by making them do the thing.
 *
 * It reads progress from the city rather than from clicks. Tapping the zone
 * button is not the lesson; having zoned land is. That way a player who works
 * it out for themselves is never told to do what they have already done, and a
 * player who taps at random still cannot get out of step.
 */
export interface CoachFacts {
  roadTiles: number;
  zonedTiles: number;
  buildings: number;
  jobs: number;
  population: number;
  activeTool: string;
  sheetOpen: boolean;
}

interface Step {
  id: string;
  /** Element to point at, or null to point at the map itself. */
  target: string | null;
  text: string;
  /** True once the player has done this, whatever route they took. */
  done(facts: CoachFacts): boolean;
  /** Shown only when this holds; lets a step wait for the sheet to be open. */
  when?(facts: CoachFacts): boolean;
}

const STEPS: readonly Step[] = [
  {
    id: 'road',
    target: null,
    text: STR.coach.road,
    done: (f) => f.roadTiles > 0,
  },
  {
    id: 'zoneTool',
    target: '#tool-dock .tool-button:nth-of-type(3)',
    text: STR.coach.zoneTool,
    done: (f) => f.zonedTiles > 0 || f.activeTool === 'zone',
  },
  {
    id: 'zonePick',
    target: '#tool-sheet .sheet-row:nth-of-type(1)',
    text: STR.coach.zonePick,
    when: (f) => f.sheetOpen,
    done: (f) => f.zonedTiles > 0,
  },
  {
    id: 'zonePaint',
    target: null,
    text: STR.coach.zonePaint,
    done: (f) => f.zonedTiles > 0,
  },
  {
    id: 'wait',
    target: null,
    text: STR.coach.wait,
    done: (f) => f.buildings > 0,
  },
  {
    id: 'jobs',
    target: '#tool-dock .tool-button:nth-of-type(3)',
    text: STR.coach.jobs,
    done: (f) => f.jobs > 0,
  },
  {
    id: 'grow',
    target: null,
    text: STR.coach.grow,
    done: (f) => f.population >= 150,
  },
];

const DONE_KEY = 'kadastro.coachDone';

export interface CoachHandle {
  /** Begins coaching. The intro screen calls this as it closes. */
  start(facts: CoachFacts): void;
  /** Re-reads the city and moves the pointer. Call when the game changes. */
  update(facts: CoachFacts): void;
  /** Called each frame; keeps the ring on a control that moved. */
  reposition(): void;
  dismiss(): void;
  dispose(): void;
}

function finished(): boolean {
  try {
    return window.localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

function markFinished(): void {
  try {
    window.localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* one more run of the tutorial is not a failure worth handling */
  }
}

export function mountCoach(root: HTMLElement, startImmediately: boolean): CoachHandle {
  if (finished()) {
    return {
      start: () => {},
      update: () => {},
      reposition: () => {},
      dismiss: () => {},
      dispose: () => {},
    };
  }

  const ring = document.createElement('div');
  ring.className = 'coach-ring';
  ring.dataset['shown'] = 'false';

  const bubble = document.createElement('div');
  bubble.className = 'coach-bubble';
  bubble.dataset['shown'] = 'false';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');

  const text = document.createElement('span');
  text.className = 'coach-text';

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'coach-skip';
  skip.textContent = STR.coach.skip;

  bubble.append(text, skip);
  root.append(ring, bubble);

  let active = startImmediately;
  let stepIndex = 0;
  let currentTarget: Element | null = null;

  const hide = (): void => {
    ring.dataset['shown'] = 'false';
    bubble.dataset['shown'] = 'false';
    currentTarget = null;
  };

  const dismiss = (): void => {
    active = false;
    markFinished();
    hide();
  };
  skip.addEventListener('click', dismiss);

  const update = (facts: CoachFacts): void => {
    if (!active) return;

    // Advance past everything already true, so a player who ran ahead is not
    // told to do what they have done.
    while (stepIndex < STEPS.length && (STEPS[stepIndex] as Step).done(facts)) stepIndex++;
    if (stepIndex >= STEPS.length) {
      dismiss();
      return;
    }

    const step = STEPS[stepIndex] as Step;
    if (step.when && !step.when(facts)) {
      // Waiting on something else — say nothing rather than point at a control
      // that is not on screen.
      hide();
      return;
    }

    text.textContent = step.text;
    currentTarget = step.target ? document.querySelector(step.target) : null;
    bubble.dataset['shown'] = 'true';
    bubble.dataset['anchored'] = String(currentTarget !== null);
    reposition();
  };

  /**
   * Puts the ring over whatever the step points at. Recomputed rather than
   * cached: the dock relabels itself as tools change, and a ring left on stale
   * coordinates is worse than none.
   */
  const reposition = (): void => {
    if (!active || !currentTarget) {
      ring.dataset['shown'] = 'false';
      return;
    }
    const rect = currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      ring.dataset['shown'] = 'false';
      return;
    }
    const pad = 6;
    ring.style.left = `${rect.left - pad}px`;
    ring.style.top = `${rect.top - pad}px`;
    ring.style.width = `${rect.width + pad * 2}px`;
    ring.style.height = `${rect.height + pad * 2}px`;
    ring.dataset['shown'] = 'true';

    // The bubble sits above the ring when there is room, below when there is not.
    const above = rect.top > 140;
    bubble.style.top = above ? `${rect.top - 16}px` : `${rect.bottom + 16}px`;
    bubble.dataset['above'] = String(above);
  };

  return {
    start: (facts) => {
      active = true;
      update(facts);
    },
    update,
    reposition,
    dismiss,
    dispose: () => {
      ring.remove();
      bubble.remove();
    },
  };
}
