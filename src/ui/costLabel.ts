import { STR } from '../data/strings.tr';
import type { DraftSummary } from '../input/tools';

/**
 * The live cost tag that rides above the finger while a road is being drawn
 * (§5.1). It sits 40 px up so the reading is never under the thumb, and it
 * updates every frame the stroke changes — a delayed price is worse than none,
 * because the player commits before they see it.
 */
export function mountCostLabel(root: HTMLElement): (summary: DraftSummary | null) => void {
  const label = root.querySelector<HTMLElement>('#cost-label');
  if (!label) throw new Error('#cost-label missing');

  let visible = false;

  return (summary: DraftSummary | null): void => {
    if (!summary) {
      if (visible) {
        label.dataset['hidden'] = 'true';
        visible = false;
      }
      return;
    }

    label.textContent =
      summary.mode === 'erase'
        ? STR.draft.erase(summary.tiles)
        : STR.draft.cost(summary.cost, summary.tiles);
    label.dataset['truncated'] = String(summary.truncated);
    label.style.transform = `translate(${summary.labelX}px, ${summary.labelY}px) translate(-50%, -100%)`;
    if (!visible) {
      label.dataset['hidden'] = 'false';
      visible = true;
    }
  };
}
