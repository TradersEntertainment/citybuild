import { BUDGET_LEVELS, BUDGET_MAX, BUDGET_MIN } from '../data/balance';
import { SERVICE_ORDER, type ServiceKind } from '../data/services';
import type { GameState } from './state';

/**
 * What each department is funded at (§3, §33).
 *
 * Until now a station was a switch: build it and it works, at exactly one level,
 * forever, for exactly one price. The only lever a struggling city had was to
 * knock something down — which loses the coverage *and* the building, and is a
 * decision nobody wants to have to make twice.
 *
 * A budget is the lever in between. Every department runs from half funding to
 * half again, and the multiplier does two things at once: it scales what the
 * department *costs* and what it *achieves*. So the choice is real in both
 * directions — a city short of money can run its brigade thin and accept more
 * fires, and a city plagued by crime can throw money at the karakols it already
 * has instead of building more.
 *
 * Deliberately linear in both. A budget that bought more than it cost would be a
 * free upgrade every player would immediately max out, and one that bought less
 * would be a tax nobody would ever raise. Equal means the slider is genuinely a
 * question about priorities rather than a puzzle with an answer.
 *
 * Saved, because it is a decision. Pure and deterministic.
 */
export type Budgets = Record<ServiceKind, number>;

export function createBudgets(): Budgets {
  const budgets = {} as Budgets;
  for (const kind of SERVICE_ORDER) budgets[kind] = 1;
  return budgets;
}

/** What a department is funded at, clamped to the range the slider offers. */
export function budgetOf(state: GameState, kind: ServiceKind): number {
  return clamp(state.budgets[kind] ?? 1);
}

/**
 * Moves a department one notch.
 *
 * Notched rather than continuous because this is a phone: a slider fine enough
 * to land on 1.03 is a slider nobody can land on at all, and the difference
 * between 1.0 and 1.03 is not a decision worth offering.
 */
export function nudgeBudget(state: GameState, kind: ServiceKind, direction: number): number {
  const at = budgetOf(state, kind);
  const step = (BUDGET_MAX - BUDGET_MIN) / (BUDGET_LEVELS - 1);
  const next = clamp(Math.round((at + step * Math.sign(direction)) / step) * step);
  state.budgets[kind] = next;
  return next;
}

export function setBudget(state: GameState, kind: ServiceKind, value: number): void {
  state.budgets[kind] = clamp(value);
}

/**
 * Reads a saved budget table defensively.
 *
 * A file written before budgets existed is a city funding everything normally,
 * not a corrupt one — and a value from a build with a wider range is clamped
 * rather than trusted, so a save cannot hand a city an effect no slider can
 * explain.
 */
export function readBudgets(raw: unknown): Budgets {
  const budgets = createBudgets();
  if (typeof raw !== 'object' || raw === null) return budgets;
  const table = raw as Record<string, unknown>;
  for (const kind of SERVICE_ORDER) {
    const value = table[kind];
    if (typeof value === 'number' && Number.isFinite(value)) budgets[kind] = clamp(value);
  }
  return budgets;
}

function clamp(value: number): number {
  return value < BUDGET_MIN ? BUDGET_MIN : value > BUDGET_MAX ? BUDGET_MAX : value;
}
