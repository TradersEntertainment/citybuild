import type { GroupId } from '../sim/groups';
import { eraReached, type Era } from '../sim/tiles';

/**
 * Campaign promises (§30) — populism, as a verb.
 *
 * The constitution names one dilemma as the design itself: *popülizm bazen iyi
 * planlamadan çok oy getirir*. Everything built so far **measures** that. The
 * report card (§25) scores what the electorate does not; the mandates (§27) pay
 * for it; the crisis (§29) asks what a mayor does when the two disagree. Not one
 * of them lets the player actually *be* a populist — there has never been a
 * button that says "tell them what they want to hear".
 *
 * This is that button, and its whole design is the gap between two moments.
 *
 * - **Making a promise costs nothing and works immediately.** The faction it
 *   names warms to you the instant you say it, for free, before anything has
 *   been built. That is not a bug being modelled sympathetically; it is the
 *   mechanic. If promising were expensive or slow, populism would be a trap and
 *   the game would have taken a side.
 * - **The bill arrives at the next election.** The promise is checked against
 *   the city, once, off state that was already being kept. Kept, and the warmth
 *   becomes trust that outlasts the term. Broken, and that faction turns — hard,
 *   and for longer than the promise ever bought.
 *
 * So a promise is a loan against the next vote, and the interesting play is
 * exactly the one the constitution describes: promise everything, win now, and
 * find out whether you can deliver before the city finds out you cannot.
 *
 * ## What can be promised
 *
 * Only things the game already measures. A promise the player could not verify
 * — or worse, could not have kept — would make the whole mechanic feel arbitrary
 * rather than earned. Each names one faction, so the room can be worked one
 * constituency at a time, and each is a threshold the city is either over or
 * under on election day.
 */
export type PromiseId = 'noJams' | 'cleanAir' | 'schools' | 'lowTax' | 'work' | 'care';

export interface PromiseSpec {
  id: PromiseId;
  /** Whose vote it is courting. */
  courts: GroupId;
  /**
   * The bar, on the promise's own scale (see sim/promises.ts for each).
   *
   * Set where a mayor who governs *toward* the promise clears it and one who
   * merely hopes does not. A promise nobody could break would be a free vote,
   * and one nobody could keep would be a trap.
   */
  target: number;
  /** Not offered before this era: a village has no factions worth courting. */
  from: Era;
}

export const PROMISE_SPECS: Readonly<Record<PromiseId, PromiseSpec>> = {
  // Share of buildings *not* complaining about traffic, 0..1.
  noJams: { id: 'noJams', courts: 'drivers', target: 0.82, from: 'town' },
  // Share not complaining about smoke.
  cleanAir: { id: 'cleanAir', courts: 'greens', target: 0.85, from: 'town' },
  // Share of built ground within reach of a school.
  schools: { id: 'schools', courts: 'families', target: 0.7, from: 'town' },
  // The tax rate itself — the one promise measured on a lever rather than on
  // the city, and the only one a mayor can keep by doing nothing at all. It is
  // here precisely because it is the cheapest thing to promise and the most
  // expensive thing to live with.
  lowTax: { id: 'lowTax', courts: 'shopkeepers', target: 0.11, from: 'town' },
  // Jobs against the working-age population.
  work: { id: 'work', courts: 'young', target: 0.85, from: 'city' },
  // Share within reach of a clinic.
  care: { id: 'care', courts: 'elders', target: 0.7, from: 'city' },
};

/**
 * APPEND-ONLY. The index is what the save file stores, so inserting into the
 * middle would turn every promise in every saved city into a different one.
 */
export const PROMISE_ORDER: readonly PromiseId[] = [
  'noJams',
  'cleanAir',
  'schools',
  'lowTax',
  'work',
  'care',
];

export function isPromiseUnlocked(id: PromiseId, era: Era): boolean {
  return eraReached(era, PROMISE_SPECS[id].from);
}

/**
 * How many may be outstanding at once.
 *
 * Three, so the player has to choose which parts of the room to work rather
 * than promising the city entire. A cap of six would make the decision "say
 * everything", which is not a decision.
 */
export const PROMISE_LIMIT = 3;
