/**
 * Momentary announcements — the city reaching a new era, and anything else the
 * player should not have to be looking at the right corner to notice.
 *
 * Reaching an era is the biggest thing that happens in the first ten minutes
 * and it used to happen in complete silence: the tool dock quietly gained a
 * row and that was all. A moment the player worked for has to be marked.
 */
export interface ToastHandle {
  show(text: string, detail?: string): void;
  dispose(): void;
}

const VISIBLE_MS = 3200;

export function mountToast(root: HTMLElement): ToastHandle {
  const element = document.createElement('div');
  element.className = 'toast';
  element.dataset['shown'] = 'false';
  element.setAttribute('role', 'status');
  // Announced politely: this is good news, not an error, and it must not
  // interrupt whatever the player is doing.
  element.setAttribute('aria-live', 'polite');

  const title = document.createElement('div');
  title.className = 'toast-title';
  const detail = document.createElement('div');
  detail.className = 'toast-detail';
  element.append(title, detail);
  root.append(element);

  let timer: number | undefined;

  return {
    show: (text, detailText) => {
      title.textContent = text;
      detail.textContent = detailText ?? '';
      detail.dataset['hidden'] = detailText ? 'false' : 'true';
      element.dataset['shown'] = 'true';

      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        element.dataset['shown'] = 'false';
      }, VISIBLE_MS);
    },
    dispose: () => {
      if (timer !== undefined) window.clearTimeout(timer);
      element.remove();
    },
  };
}
