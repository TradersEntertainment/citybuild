import { STR } from '../data/strings.tr';
import { nextEraGap } from '../sim/progression';
import { uiStore } from '../state/store';

/**
 * The thin top strip (§14.4). Money counts up or down over 250 ms rather than
 * snapping, and flashes brass on a gain, brick on a loss (§14.5) — the only
 * feedback the player gets that a road actually cost something.
 *
 * Everything else is written straight, and only when the text changed: a DOM
 * write per frame would spend the budget on numbers nobody is reading.
 */
const COUNTER_MS = 250;

export function mountTopBar(root: HTMLElement): () => void {
  const moneyElement = required(root, '#hud-money');
  const netElement = required(root, '#hud-net');
  const populationElement = required(root, '#hud-population');
  const readout = required(root, '#hud-camera');
  const demandBars = {
    res: required(root, '#demand-res'),
    com: required(root, '#demand-com'),
    ind: required(root, '#demand-ind'),
  };

  let shown = uiStore.getState().money;
  let target = shown;
  let from = shown;
  let startedAt = 0;
  let animating = false;
  const last = { readout: '', population: '', net: '' };

  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const step = (now: number): void => {
    const t = Math.min(1, (now - startedAt) / COUNTER_MS);
    const eased = 1 - (1 - t) ** 3; // ease-out cubic
    shown = from + (target - from) * eased;
    moneyElement.textContent = STR.format.money(shown);
    if (t < 1) requestAnimationFrame(step);
    else animating = false;
  };

  const paint = (): void => {
    const state = uiStore.getState();

    if (state.money !== target) {
      const gained = state.money > target;
      from = shown;
      target = state.money;
      moneyElement.dataset['delta'] = gained ? 'gain' : 'loss';
      // Let the flash clear itself; a permanent tint would read as a warning.
      window.setTimeout(() => delete moneyElement.dataset['delta'], COUNTER_MS * 2);

      if (reducedMotion) {
        shown = target;
        moneyElement.textContent = STR.format.money(shown);
      } else if (!animating) {
        animating = true;
        startedAt = performance.now();
        requestAnimationFrame(step);
      } else {
        startedAt = performance.now();
      }
    }

    write(netElement, last, 'net', STR.hud.net(state.net));
    netElement.dataset['sign'] = state.net >= 0 ? 'positive' : 'negative';

    // The population figure doubles as the progress readout: what the city is
    // working toward is always on screen (§1, no hidden locks).
    const gap = nextEraGap(state.population);
    const populationText = gap
      ? `${STR.hud.population(state.population)} · ${STR.era.next(STR.eraName[gap.era], gap.remaining)}`
      : STR.hud.population(state.population);
    write(populationElement, last, 'population', populationText);

    demandBars.res.style.height = `${Math.round(state.demand.res * 100)}%`;
    demandBars.com.style.height = `${Math.round(state.demand.com * 100)}%`;
    demandBars.ind.style.height = `${Math.round(state.demand.ind * 100)}%`;

    const readoutText =
      state.fps > 0 ? `${state.cameraReadout} · ${state.fps.toFixed(0)} fps` : state.cameraReadout;
    write(readout, last, 'readout', readoutText);
  };

  moneyElement.textContent = STR.format.money(shown);
  paint();
  return uiStore.subscribe(paint);
}

/** The invitation copy fades out as soon as the player draws something. */
export function mountHint(root: HTMLElement): () => void {
  const hint = required(root, '#hint');
  hint.textContent = STR.empty.noRoads;

  return uiStore.subscribe(() => {
    hint.dataset['hidden'] = uiStore.getState().hintVisible ? 'false' : 'true';
  });
}

function write(
  element: HTMLElement,
  cache: Record<string, string>,
  key: string,
  text: string,
): void {
  if (cache[key] === text) return;
  cache[key] = text;
  element.textContent = text;
}

function required(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`${selector} missing`);
  return element;
}
