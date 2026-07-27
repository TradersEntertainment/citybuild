import {
  isPolicyUnlocked,
  POLICY_EFFECTS,
  POLICY_SPECS,
  type PolicyId,
} from '../data/policies';
import type { GameState } from './state';

/**
 * Policies in force (§22).
 *
 * A deliberately thin file: the table of what each ordinance does lives in
 * data/policies.ts, and this is only the switch and the read. Every factor
 * function answers 1 (or 0 mood) when its policy is off, so the call sites
 * multiply unconditionally and stay readable — the hook never has to know the
 * policy exists, only that there is a number to ask for.
 *
 * Saved as a list of ids and read defensively: a file carrying a policy this
 * build no longer has simply drops it, the same rule as goals and techs.
 */
export function policyActive(state: GameState, id: PolicyId): boolean {
  return state.policies.has(id);
}

export type PolicyToggle = 'on' | 'off' | 'locked';

/** Flips a policy, honouring the era lock. Returns what happened. */
export function togglePolicy(state: GameState, id: PolicyId): PolicyToggle {
  if (!isPolicyUnlocked(id, state.era)) return 'locked';
  if (state.policies.has(id)) {
    state.policies.delete(id);
    return 'off';
  }
  state.policies.add(id);
  return 'on';
}

/** ₺ per minute the active ordinances cost to run, for the ledger. */
export function policyUpkeep(state: GameState): number {
  let total = 0;
  for (const id of state.policies) total += POLICY_SPECS[id]?.upkeep ?? 0;
  return total;
}

/** Flat mood from the ordinances: the night shift tires, the clean air lifts. */
export function policyHappiness(state: GameState): number {
  let total = 0;
  if (policyActive(state, 'nightShift')) total += POLICY_EFFECTS.NIGHT_SHIFT_HAPPINESS;
  if (policyActive(state, 'smokeBan')) total += POLICY_EFFECTS.SMOKE_BAN_HAPPINESS;
  return total;
}

/** How much the transit network carries before it strains (sim/transit.ts). */
export function transitCapacityFactor(state: GameState): number {
  return policyActive(state, 'freeTransit') ? POLICY_EFFECTS.FREE_TRANSIT_CAPACITY : 1;
}

/** The fare box: free transit collects nothing, by definition. */
export function fareFactor(state: GameState): number {
  return policyActive(state, 'freeTransit') ? 0 : 1;
}

/** Workshop output, under the night shift and the recycling line's drag. */
export function industryFactor(state: GameState): number {
  let factor = 1;
  if (policyActive(state, 'nightShift')) factor *= POLICY_EFFECTS.NIGHT_SHIFT_OUTPUT;
  if (policyActive(state, 'recycling')) factor *= POLICY_EFFECTS.RECYCLING_OUTPUT;
  return factor;
}

/** What the workshops' neighbours hear (sim/diffusion.ts). */
export function industryNoiseFactor(state: GameState): number {
  return policyActive(state, 'nightShift') ? POLICY_EFFECTS.NIGHT_SHIFT_NOISE : 1;
}

/** Shop takings under the smoking ban. */
export function commerceFactor(state: GameState): number {
  return policyActive(state, 'smokeBan') ? POLICY_EFFECTS.SMOKE_BAN_COMMERCE : 1;
}

/** How far the school run reaches (sim/cohorts.ts). Capped at 1 by the caller. */
export function schoolingFactor(state: GameState): number {
  return policyActive(state, 'schoolBuses') ? POLICY_EFFECTS.SCHOOL_BUS_COVERAGE : 1;
}

/** What actually reaches the tip (sim/rubbish.ts). */
export function rubbishFactor(state: GameState): number {
  return policyActive(state, 'recycling') ? POLICY_EFFECTS.RECYCLING_RUBBISH : 1;
}

/** How hard an outbreak bites (sim/hazards.ts). */
export function epidemicSeverityFactor(state: GameState): number {
  return policyActive(state, 'smokeBan') ? POLICY_EFFECTS.SMOKE_BAN_SEVERITY : 1;
}

/** The levy on every hotel bill (sim/attractions.ts). */
export function touristTaxIncome(state: GameState): number {
  return policyActive(state, 'touristTax') ? POLICY_EFFECTS.TOURIST_TAX_INCOME : 1;
}

/** …and the strangers it turns away at the junction (sim/visitors.ts). */
export function touristTaxPull(state: GameState): number {
  return policyActive(state, 'touristTax') ? POLICY_EFFECTS.TOURIST_TAX_PULL : 1;
}
