import { STR } from '../data/strings.tr';
import { loadHistory, type HistoryEntry } from '../state/history';

/**
 * The history log, opened from the view controls: every dated event the city
 * has lived through, newest first, with the chronicle's longer telling under
 * each headline. The feed announces; this panel is where a player goes to
 * read their city's century back.
 */
export interface HistoryPanelHandle {
  readonly open: boolean;
  toggle(): void;
  close(): void;
  dispose(): void;
}

export function mountHistoryPanel(root: HTMLElement): HistoryPanelHandle {
  const panel = document.createElement('aside');
  panel.className = 'history-panel';
  panel.dataset['open'] = 'false';
  panel.setAttribute('aria-label', STR.history.title);

  const head = document.createElement('header');
  head.className = 'history-head';
  const title = document.createElement('h2');
  title.className = 'history-title';
  title.textContent = STR.history.title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'history-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', STR.walk.exit);
  head.append(title, close);

  const list = document.createElement('div');
  list.className = 'history-list';

  panel.append(head, list);
  root.append(panel);

  let isOpen = false;

  const entryNode = (entry: HistoryEntry): HTMLElement => {
    const item = document.createElement('article');
    item.className = 'history-entry';
    const year = document.createElement('span');
    year.className = 'history-year mono';
    year.textContent = String(entry.year);
    const body = document.createElement('div');
    body.className = 'history-body';
    const headline = document.createElement('p');
    headline.className = 'history-headline';
    headline.textContent = `${entry.icon} ${entry.title}`;
    body.append(headline);
    if (entry.detail) {
      const detail = document.createElement('p');
      detail.className = 'history-detail';
      detail.textContent = entry.detail;
      body.append(detail);
    }
    item.append(year, body);
    return item;
  };

  const paint = (): void => {
    list.replaceChildren();
    const entries = loadHistory();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = STR.history.empty;
      list.append(empty);
      return;
    }
    // Newest first: the player's own recent history is the page they came for.
    for (let i = entries.length - 1; i >= 0; i--) {
      list.append(entryNode(entries[i] as HistoryEntry));
    }
  };

  const setOpen = (next: boolean): void => {
    isOpen = next;
    panel.dataset['open'] = String(next);
    if (next) paint();
  };

  close.addEventListener('click', () => setOpen(false));

  return {
    get open() {
      return isOpen;
    },
    toggle: () => setOpen(!isOpen),
    close: () => setOpen(false),
    dispose: () => panel.remove(),
  };
}
