import type { GroupId } from '../sim/groups';
import { eraReached, type Era } from '../sim/tiles';

/**
 * The lobbies (§24) — what somebody else wants the city to do.
 *
 * Every other decision in this game starts with the player: they pick up a tool
 * and act on the map. A lobby arrives uninvited, names a price, and puts a
 * deadline on the answer — which is the shape of governing that building a city
 * never asks for.
 *
 * The design contract, and the one the tests hold this table to:
 *
 * - **A deal is a term, not a purchase.** Everything here expires. A permanent
 *   effect bought once would be an investment (data/investments.ts), and the
 *   entire point of a lobby is that the mayor who signs it is still there when
 *   it comes due.
 * - **The money and the effect point opposite ways.** Where the signing fee is
 *   positive — they pay the city — the standing effect costs it something real.
 *   Where the city pays, it is buying something the city cannot build. Neither
 *   half is ever free, so "take the money" is a decision rather than a reflex.
 * - **Every deal splits the room.** Each one names the factions it pleases and
 *   the factions it angers (sim/groups.ts), so signing is visible at the ballot
 *   box and not only in the ledger. A lobby nobody minded would be a vending
 *   machine.
 * - **Refusing costs nothing but the offer.** There is no penalty for saying no
 *   and no dice deciding whether the offer returns — the calendar decides, the
 *   way it decides elections. A player who wants to run a city nobody bought
 *   can, and the game never punishes them for it.
 */
export type LobbyId = 'builder' | 'oil' | 'tourism' | 'university' | 'ngo' | 'union';

export interface LobbySpec {
  id: LobbyId;
  /** Era from which this lobby has any interest in the city. */
  unlockedAt: Era;
  /**
   * One-off, at signing. Positive: they pay the city. Negative: the city pays.
   *
   * Scaled by nothing — a flat figure, like every other price in the game, so
   * the same offer is a fortune to a town and pocket change to a metropolis.
   * That is deliberate: a lobby that scaled with the city would never stop
   * being worth taking.
   */
  signing: number;
  /** ₺ per minute while the deal runs. Positive: they pay. Negative: the city. */
  stipend: number;
  /** How long the deal stands, in seconds of played time. */
  termS: number;
  /** Factions that back it, and factions that will remember it (sim/groups.ts). */
  pleases: readonly GroupId[];
  angers: readonly GroupId[];
}

/**
 * A term is two and a half election terms at the shortest and five at the
 * longest, measured against TERM_YEARS × SECONDS_PER_YEAR. So a deal signed
 * today is still standing at the next vote — which is the whole mechanic. A
 * lobby that expired before the ballot would be free money.
 */
export const LOBBY_SPECS: Readonly<Record<LobbyId, LobbySpec>> = {
  // They pay handsomely to build fast and cheap. The city gets the towers and
  // the bill for what cheap towers do to a street.
  builder: {
    id: 'builder',
    unlockedAt: 'town',
    signing: 40_000,
    stipend: 0,
    termS: 500,
    pleases: ['industrialists', 'young'],
    angers: ['greens', 'families'],
  },
  // The biggest cheque in the game, and the only effect that reaches every
  // tile of the map.
  oil: {
    id: 'oil',
    unlockedAt: 'city',
    signing: 120_000,
    stipend: 900,
    termS: 600,
    pleases: ['industrialists', 'drivers'],
    angers: ['greens', 'elders', 'families'],
  },
  // Visitors, and the crowds that come with them.
  tourism: {
    id: 'tourism',
    unlockedAt: 'town',
    signing: 30_000,
    stipend: 240,
    termS: 500,
    pleases: ['shopkeepers', 'young'],
    angers: ['elders'],
  },
  // The honest inverse: the city pays, and gets back the one thing it cannot
  // buy anywhere else — a schooled generation, sooner.
  university: {
    id: 'university',
    unlockedAt: 'city',
    signing: -90_000,
    stipend: -320,
    termS: 700,
    pleases: ['young', 'greens', 'families'],
    angers: ['industrialists'],
  },
  // Cleaner air for a standing bill, and the goodwill of everybody who has to
  // breathe it.
  ngo: {
    id: 'ngo',
    unlockedAt: 'town',
    signing: -25_000,
    stipend: -180,
    termS: 600,
    pleases: ['greens', 'families', 'elders'],
    angers: ['industrialists'],
  },
  // Wages up. The city is happier and the workshops are slower, which is the
  // oldest trade there is.
  union: {
    id: 'union',
    unlockedAt: 'city',
    signing: -40_000,
    stipend: -450,
    termS: 600,
    pleases: ['young', 'families', 'elders'],
    angers: ['industrialists', 'shopkeepers'],
  },
};

/**
 * APPEND-ONLY. The index is what the save file stores, so inserting into the
 * middle would silently turn every signed oil deal in every existing city into
 * something else.
 */
export const LOBBY_ORDER: readonly LobbyId[] = [
  'builder',
  'oil',
  'tourism',
  'university',
  'ngo',
  'union',
];

/**
 * What each deal does while it stands.
 *
 * Here rather than in balance.ts for the same reason the ordinance effects are
 * in data/policies.ts: what a deal *does* has to be readable beside what it
 * costs, or the table becomes six prices with the consequences filed elsewhere.
 * Every one of these is a multiplier applied by a guarded hook that answers
 * exactly 1 when no deal is running.
 */
export const LOBBY_EFFECTS = {
  /** Builder: buildings grow faster… */
  BUILDER_GROWTH: 1.45,
  /** …on land worth less, everywhere. */
  BUILDER_VALUE: 0.85,
  /** Oil: workshops earn more… */
  OIL_OUTPUT: 1.3,
  /** …and every chimney in the city smokes harder. */
  OIL_POLLUTION: 1.4,
  /** Tourism: more visitors pull off the motorway… */
  TOURISM_PULL: 1.3,
  /** …and leave more behind them than they carried in. */
  TOURISM_RUBBISH: 1.25,
  /** University: schools reach further, and research runs faster. */
  UNIVERSITY_SCHOOLING: 1.3,
  UNIVERSITY_RESEARCH: 1.4,
  /** NGO: a share of every tile's pollution load, absorbed. */
  NGO_POLLUTION: 0.75,
  /** Union: wages lift the mood, and slow the line. */
  UNION_HAPPINESS: 5,
  UNION_OUTPUT: 0.88,
} as const;

export function isLobbyUnlocked(id: LobbyId, era: Era): boolean {
  return eraReached(era, LOBBY_SPECS[id].unlockedAt);
}
