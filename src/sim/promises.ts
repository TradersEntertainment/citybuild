import {
  PROMISE_BETRAYAL_DECAY_PER_S,
  PROMISE_BETRAYAL_STEP,
  PROMISE_BETRAYAL_SWAY,
  PROMISE_KEPT_SWAY,
  PROMISE_MADE_SWAY,
} from '../data/balance';
import {
  isPromiseUnlocked,
  PROMISE_LIMIT,
  PROMISE_ORDER,
  PROMISE_SPECS,
  type PromiseId,
} from '../data/promises';
import { workingShare } from './cohorts';
import { GROUP_ORDER, type GroupId } from './groups';
import { SERVICE_SPECS } from '../data/services';
import type { GameState } from './state';
import { educationCoverage } from './tech';
import { ISSUE } from './tiles';
import { index } from './world';

/**
 * Promises made and promises kept (§30).
 *
 * data/promises.ts explains what this is for. This is the machinery, and it has
 * exactly three moving parts: what saying it buys, whether the city met it, and
 * how long the room remembers being lied to.
 *
 * ## The asymmetry is the design
 *
 * Making a promise buys a faction's warmth immediately and for free. Keeping it
 * converts that into something slightly larger and lasting. **Breaking it costs
 * more than making it ever bought, and for longer.**
 *
 * That gap is not a moral judgement dressed as a number — it is what makes the
 * mechanic a decision rather than a free action. If breaking a promise cost the
 * same as making it earned, promising everything would be strictly correct and
 * there would be nothing to weigh. The player should be able to win an election
 * on promises they cannot keep, and should find out what that costs at the
 * following one.
 *
 * ## Why betrayal decays
 *
 * It fades, slowly, rather than sticking forever. A permanent mark would mean a
 * single broken promise in an early term quietly capping a city's politics for
 * the rest of its life — a spiral rather than a game, and the same reason
 * sim/elections.ts fades its verdict memory. A mayor who breaks faith with the
 * greens can win them back; it takes terms, not minutes.
 */

/**
 * Makes sure the grudge array has a slot for every faction.
 *
 * `state.betrayed` starts empty and is indexed by GROUP_ORDER, so writing to
 * the greens' slot on a fresh city would leave holes at every index before it —
 * a *sparse* array. Iterating one yields `undefined` for the holes, and
 * `total += undefined` is NaN, which is this save format's documented worst
 * case and would have reached the panel as a grudge meter reading "NaN". Called
 * before every write, so the array is dense from the first betrayal onward.
 */
function ensureBetrayed(state: GameState): void {
  if (state.betrayed.length === GROUP_ORDER.length) return;
  const dense = GROUP_ORDER.map((_, i) => {
    const memory = state.betrayed[i];
    return typeof memory === 'number' && Number.isFinite(memory) ? memory : 0;
  });
  state.betrayed = dense;
}

/** Whether a promise is currently outstanding. */
export function hasPromised(state: GameState, id: PromiseId): boolean {
  return state.promises.includes(id);
}

export type PromiseResult = 'made' | 'already' | 'locked' | 'full';

/**
 * Says it out loud.
 *
 * Free, and that is the point. The only limits are the era and the cap: a mayor
 * cannot promise the same thing twice, and cannot promise the whole city at
 * once, but nothing else stands between them and a warm room.
 */
export function makePromise(state: GameState, id: PromiseId): PromiseResult {
  if (!isPromiseUnlocked(id, state.era)) return 'locked';
  if (hasPromised(state, id)) return 'already';
  if (state.promises.length >= PROMISE_LIMIT) return 'full';
  state.promises.push(id);
  return 'made';
}

/**
 * Where the city stands against a promise, 0..1 on the promise's own scale.
 *
 * Every one is read off state that was already being kept, so a promise cannot
 * be met any way other than by governing toward it — and the player can watch
 * the figure move while they work, which is what makes the deadline fair.
 */
export function promiseProgress(state: GameState, id: PromiseId): number {
  const total = state.buildings.size;

  switch (id) {
    case 'noJams':
      return total === 0 ? 1 : 1 - shareWith(state, ISSUE.traffic);
    case 'cleanAir':
      return total === 0 ? 1 : 1 - shareWith(state, ISSUE.pollution);
    case 'schools':
      return educationCoverage(state);
    case 'lowTax':
      // Inverted so every promise reads "higher is closer": the bar is a
      // ceiling on the rate, and this turns it into a floor like the rest.
      return state.taxRate <= PROMISE_SPECS.lowTax.target ? 1 : 0;
    case 'work': {
      let jobs = 0;
      for (const building of state.buildings.values()) jobs += building.jobs;
      const workers = workingShare(state) * state.population;
      return workers <= 0 ? 1 : Math.min(1, jobs / workers);
    }
    case 'care':
      return serviceCoverage(state, 'health');
  }
}

/** Whether the city is over the bar right now. */
export function isPromiseKept(state: GameState, id: PromiseId): boolean {
  return promiseProgress(state, id) >= PROMISE_SPECS[id].target;
}

export interface PromiseVerdict {
  id: PromiseId;
  kept: boolean;
}

/**
 * Settles every outstanding promise, at the election.
 *
 * Called from the election settlement rather than on a clock, because that is
 * the moment a promise is *for* — a promise checked continuously would be a
 * target, and the whole mechanic is the gap between saying and delivering.
 *
 * The list is cleared either way: a new term is a new set of promises, and
 * carrying an unmet one forward would let a player make it once and be judged
 * on it every election until it happened to be true.
 */
export function settlePromises(state: GameState): readonly PromiseVerdict[] {
  if (state.promises.length === 0) return NO_VERDICTS;

  const verdicts: PromiseVerdict[] = [];
  for (const id of state.promises) {
    const kept = isPromiseKept(state, id);
    verdicts.push({ id, kept });
    if (kept) continue;
    // The room remembers. Stacked rather than replaced, so a mayor who breaks
    // faith twice with the same faction is worse off than one who did it once —
    // and clamped, so there is a floor to how badly it can go.
    ensureBetrayed(state);
    const at = GROUP_ORDER.indexOf(PROMISE_SPECS[id].courts);
    if (at >= 0) {
      state.betrayed[at] = clamp01((state.betrayed[at] ?? 0) + PROMISE_BETRAYAL_STEP);
    }
  }

  state.promises = [];
  return verdicts;
}

const NO_VERDICTS: readonly PromiseVerdict[] = [];

/** Fades what the room remembers. Slow: terms, not minutes. */
export function stepPromises(state: GameState, dt: number): void {
  for (let i = 0; i < state.betrayed.length; i++) {
    const memory = state.betrayed[i] ?? 0;
    if (memory <= 0) continue;
    state.betrayed[i] = Math.max(0, memory - PROMISE_BETRAYAL_DECAY_PER_S * dt);
  }
}

/**
 * What promises are doing to one faction's vote right now.
 *
 * Three terms, and the sign of the sum is the whole story: an outstanding
 * promise is warmth on credit, a promise this faction has seen kept is trust,
 * and a promise broken is a debt being paid down slowly.
 *
 * Read by sim/groups.ts, and answering exactly 0 for a city that has never
 * promised anything — which is every city until the player uses the verb.
 */
export function promiseSway(state: GameState, id: GroupId): number {
  let sway = 0;

  for (const promised of state.promises) {
    if (PROMISE_SPECS[promised].courts !== id) continue;
    // Saying it warms the room now. Saying it *and* being visibly on track
    // warms it further — a promise the city can see coming true is worth more
    // than one it has only heard.
    sway += PROMISE_MADE_SWAY;
    if (isPromiseKept(state, promised)) sway += PROMISE_KEPT_SWAY;
  }

  const at = GROUP_ORDER.indexOf(id);
  if (at >= 0) sway -= PROMISE_BETRAYAL_SWAY * (state.betrayed[at] ?? 0);

  return sway;
}

/** Every promise the era has opened, for the panel to offer. */
export function offeredPromises(state: GameState): PromiseId[] {
  return PROMISE_ORDER.filter((id) => isPromiseUnlocked(id, state.era));
}

/** How much of the room is holding a grudge, for the panel's heading. */
export function betrayalTotal(state: GameState): number {
  let total = 0;
  // Indexed rather than iterated, and defaulted: a sparse array from an older
  // save must not turn a panel figure into NaN.
  for (let i = 0; i < state.betrayed.length; i++) total += state.betrayed[i] ?? 0;
  return total;
}

function shareWith(state: GameState, flag: number): number {
  const total = state.buildings.size;
  if (total === 0) return 0;
  let count = 0;
  for (const building of state.buildings.values()) {
    if ((building.issues & flag) !== 0) count++;
  }
  return count / total;
}

function serviceCoverage(state: GameState, kind: 'health'): number {
  const total = state.buildings.size;
  if (total === 0) return 0;
  const bit = SERVICE_SPECS[kind].bit;
  let covered = 0;
  for (const building of state.buildings.values()) {
    const mask = state.world.serviceMask[index(state.world, building.x, building.y)] ?? 0;
    if ((mask & bit) !== 0) covered++;
  }
  return covered / total;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
