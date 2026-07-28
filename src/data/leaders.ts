import type { GroupId } from '../sim/groups';

/**
 * The dictator you choose to be (§33).
 *
 * Until now a game began on a blank map with four unlabelled verbs. For a game
 * whose whole subject is *governing*, that is starting the story on the wrong
 * page. It should begin the way a political life begins: with who you are, and
 * with an election you have to win by telling people what they want to hear.
 *
 * A leader is a *lean*, not a class. Each starts with a base — one or two
 * constituencies who are with you before you have done anything, because that
 * is where you came from — and one concrete edge that colours the early game
 * without deciding it. The base is a permanent, mild pet-score bonus, read by
 * sim/groups.ts exactly like a standing promise; the edge is a single number
 * the relevant system already knows how to read.
 *
 * Nothing here is a power fantasy with no downside. A base warms two rooms and
 * says nothing about the other five; the technocrat's treasury does not make
 * the greens like them; the strongman's feared city still riots, just later.
 * The choice sets the opening tension, and the game takes it from there.
 */
export type LeaderId =
  | 'neutral'
  | 'populist'
  | 'technocrat'
  | 'strongman'
  | 'patron'
  | 'reformer';

export interface LeaderSpec {
  id: LeaderId;
  /** The constituencies you start with — your base, warm from turn zero. */
  base: readonly GroupId[];
  /**
   * The one concrete edge, at most one field set:
   *  - startMoney: a fuller treasury to open with.
   *  - furyResist: a multiplier (<1) on how fast decrees bank fury — a city
   *    that fears you organises against you more slowly.
   *  - grantBonus: a multiplier (>1) on every election grant — a machine that
   *    turns votes into money more efficiently.
   */
  startMoney?: number;
  furyResist?: number;
  grantBonus?: number;
}

export const LEADER_SPECS: Readonly<Record<LeaderId, LeaderSpec>> = {
  // No lean and no edge. Never offered in the picker — it is what a fresh
  // `createGameState` holds before the opening, and what an old save (written
  // before leaders existed) loads as. A game that never chose a dictator has
  // no base, which is exactly right: it must not silently warm two factions.
  neutral: {
    id: 'neutral',
    base: [],
  },
  // The people's voice. Broad and shallow — the two largest everyday
  // grievances are with you — but you begin with nothing but goodwill.
  populist: {
    id: 'populist',
    base: ['young', 'families'],
  },
  // The engineer-king. You open with a fuller treasury and the shopkeepers'
  // confidence; the street is another matter.
  technocrat: {
    id: 'technocrat',
    base: ['shopkeepers', 'industrialists'],
    startMoney: 45_000,
  },
  // The iron fist. The city fears you, so fury organises a third slower — but
  // fear is not love, and your base is thin.
  strongman: {
    id: 'strongman',
    base: ['drivers'],
    furyResist: 0.66,
  },
  // The patron. Old money and older families; every election you win pays out
  // heavier, because the machine knows how to turn a vote into a favour.
  patron: {
    id: 'patron',
    base: ['elders', 'industrialists'],
    grantBonus: 1.25,
  },
  // The reformer. The greens and the young came out for you; the treasury did
  // not, and neither did the boardrooms.
  reformer: {
    id: 'reformer',
    base: ['greens', 'young'],
  },
};

/**
 * APPEND-ONLY: the id is stored in the save by name, and the picker draws in
 * this order.
 */
// The picker's five — 'neutral' is deliberately absent, it is a default not a
// choice.
export const LEADER_ORDER: readonly LeaderId[] = [
  'populist',
  'technocrat',
  'strongman',
  'patron',
  'reformer',
];

/** The default for a save written before leaders existed: no lean, no edge. */
export const NEUTRAL_LEADER: LeaderId = 'neutral';
