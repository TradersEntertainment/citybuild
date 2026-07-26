import { STR } from '../data/strings.tr';
import type { HazardEvent, HazardEventKind } from '../sim/hazards';

/**
 * The city's police blotter (§13): a short stack of what just happened, pinned
 * to the edge of the map.
 *
 * The toast announces one thing and is gone; chaos arrives in bunches — a fire,
 * its spread, the brigade's answer, all inside a minute — and a single slot
 * would show only the loudest. So events queue here, a few at a time, oldest
 * fading out first. Like the toast it never takes pointer events: it appears
 * while the player is mid-gesture and must not swallow the pen.
 */
export interface EventFeedHandle {
  push(events: readonly HazardEvent[]): void;
  /** Anything else with something to say: history uses the same blotter. */
  pushCustom(entries: readonly CustomEntry[]): void;
  dispose(): void;
}

export interface CustomEntry {
  icon: string;
  tone: 'alarm' | 'calm' | 'warn';
  text: string;
}

interface FeedStyle {
  icon: string;
  tone: 'alarm' | 'calm' | 'warn';
  text(): string;
}

const STYLES: Record<HazardEventKind, FeedStyle> = {
  fireStart: { icon: '🔥', tone: 'warn', text: () => STR.hazard.fireStart },
  fireOut: { icon: '🚒', tone: 'calm', text: () => STR.hazard.fireOut },
  fireLost: { icon: '🔥', tone: 'alarm', text: () => STR.hazard.fireLost },
  fireRaging: { icon: '🔥', tone: 'alarm', text: () => STR.hazard.fireRaging },
  epidemicStart: { icon: '🦠', tone: 'warn', text: () => STR.hazard.epidemicStart },
  epidemicEndMild: { icon: '🏥', tone: 'calm', text: () => STR.hazard.epidemicEndMild },
  epidemicEndSevere: { icon: '🦠', tone: 'alarm', text: () => STR.hazard.epidemicEndSevere },
};

const MAX_ENTRIES = 4;
const LIFETIME_MS = 9000;

export function mountEventFeed(root: HTMLElement): EventFeedHandle {
  const element = document.createElement('div');
  element.className = 'event-feed';
  element.setAttribute('aria-live', 'polite');
  root.append(element);

  const timers = new Map<HTMLElement, number>();

  const drop = (entry: HTMLElement): void => {
    const timer = timers.get(entry);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(entry);
    entry.dataset['leaving'] = 'true';
    window.setTimeout(() => entry.remove(), 300);
  };

  const add = (iconText: string, tone: CustomEntry['tone'], line: string): void => {
    const entry = document.createElement('div');
    entry.className = 'event-entry';
    entry.dataset['tone'] = tone;
    const icon = document.createElement('span');
    icon.className = 'event-icon';
    icon.textContent = iconText;
    const text = document.createElement('span');
    text.textContent = line;
    entry.append(icon, text);
    element.append(entry);
    timers.set(entry, window.setTimeout(() => drop(entry), LIFETIME_MS));

    while (element.childElementCount > MAX_ENTRIES) {
      const oldest = element.firstElementChild;
      if (!(oldest instanceof HTMLElement)) break;
      drop(oldest);
    }
  };

  return {
    push: (events) => {
      for (const event of events) {
        const style = STYLES[event.kind];
        add(style.icon, style.tone, style.text());
      }
    },
    pushCustom: (entries) => {
      for (const entry of entries) add(entry.icon, entry.tone, entry.text);
    },
    dispose: () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      element.remove();
    },
  };
}
