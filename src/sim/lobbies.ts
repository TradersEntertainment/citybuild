import { LOBBY_OFFER_INTERVAL_S, LOBBY_OFFER_WINDOW_S } from '../data/balance';
import {
  isLobbyUnlocked,
  LOBBY_EFFECTS,
  LOBBY_ORDER,
  LOBBY_SPECS,
  type LobbyId,
} from '../data/lobbies';
import { createRng, hashSeed } from './rng';
import type { GameState } from './state';

/**
 * Lobbies in play (§24): who is offering, what it does, and when it lapses.
 *
 * Two halves, and the interesting one is the first.
 *
 * **The offer is derived, not rolled.** Which lobby is at the door right now is
 * a pure function of the seed and how long the city has been played — the same
 * construction the elections use, for the same reason. A rolled offer would be
 * re-rolled by every reload, which turns "should I take this" into "should I
 * reload until a better one arrives"; a derived one is the same offer whenever
 * the player comes back to it, and the window closes on the city's clock rather
 * than on their attention. There is no dice anywhere in this file.
 *
 * **A signed deal is a term.** It is stored with the played-time it expires at,
 * so it survives a reload and lapses correctly across an offline absence — an
 * hour away is an hour of the term gone, not an hour of it saved up. Every
 * effect below reads the standing deals and answers exactly 1 (or 0, for the
 * mood) when none is running, which is the same contract sim/policies.ts holds
 * and for the same reason: the hooks multiply unconditionally.
 */
export interface LobbyDeal {
  id: LobbyId;
  /** Played milliseconds at which the deal lapses. */
  until: number;
}

/** Which offer window the city is in. Counts from the founding, like a term. */
export function offerIndex(playedMs: number): number {
  return Math.floor(playedMs / 1000 / LOBBY_OFFER_INTERVAL_S);
}

/** Seconds the current offer has been on the table. */
function intoWindow(playedMs: number): number {
  return (playedMs / 1000) % LOBBY_OFFER_INTERVAL_S;
}

/**
 * Who is at the door, or null.
 *
 * Null in three cases, all of them meaningful rather than incidental: the
 * window has closed for this stretch, the city is too young for anybody to be
 * interested, or the only lobbies interested are already signed. A city that
 * has taken every deal on offer is not offered them twice.
 */
export function currentOffer(state: GameState): LobbyId | null {
  if (state.playedMs <= 0) return null;
  if (intoWindow(state.playedMs) > LOBBY_OFFER_WINDOW_S) return null;
  const index = offerIndex(state.playedMs);
  if (index <= 0) return null;

  const available = LOBBY_ORDER.filter(
    (id) => isLobbyUnlocked(id, state.era) && !hasDeal(state, id),
  );
  if (available.length === 0) return null;

  // Deterministic in the seed and the window, so the same offer is waiting
  // however many times the player reloads to look at it again.
  const rng = createRng((state.seed ^ hashSeed(`lobby:${index}`)) >>> 0);
  return available[rng.int(0, available.length - 1)] ?? null;
}

/** Whether this lobby's deal is standing right now. */
export function hasDeal(state: GameState, id: LobbyId): boolean {
  for (const deal of state.lobbies) {
    if (deal.id === id) return true;
  }
  return false;
}

/** Seconds left on a standing deal, or 0. For the panel to count down. */
export function dealRemaining(state: GameState, id: LobbyId): number {
  for (const deal of state.lobbies) {
    if (deal.id === id) return Math.max(0, (deal.until - state.playedMs) / 1000);
  }
  return 0;
}

export type SignResult = 'signed' | 'locked' | 'alreadySigned' | 'tooDear' | 'noOffer';

/**
 * Takes the deal on the table.
 *
 * The signing fee is paid or received immediately; the term starts now. A city
 * that cannot cover a fee it owes is refused rather than pushed into debt: the
 * bank (sim/credit.ts) is where borrowing lives, and a lobby quietly overdrawing
 * the treasury would be the one purchase in the game that could.
 */
export function signLobby(state: GameState, id: LobbyId): SignResult {
  if (!isLobbyUnlocked(id, state.era)) return 'locked';
  if (hasDeal(state, id)) return 'alreadySigned';
  if (currentOffer(state) !== id) return 'noOffer';
  const spec = LOBBY_SPECS[id];
  if (spec.signing < 0 && state.money < -spec.signing) return 'tooDear';

  state.money += spec.signing;
  state.lobbies.push({ id, until: state.playedMs + spec.termS * 1000 });
  return 'signed';
}

export interface LobbyLapse {
  id: LobbyId;
}

/**
 * Retires the deals whose term is up.
 *
 * Called from the step, and correct at any step size — including the offline
 * catch-up, which arrives here with playedMs already advanced across the whole
 * absence. Several deals lapsing at once is several lapses, reported together.
 */
export function stepLobbies(state: GameState): readonly LobbyLapse[] {
  if (state.lobbies.length === 0) return NO_LAPSES;
  const lapsed: LobbyLapse[] = [];
  const standing: LobbyDeal[] = [];
  for (const deal of state.lobbies) {
    if (deal.until <= state.playedMs) lapsed.push({ id: deal.id });
    else standing.push(deal);
  }
  if (lapsed.length === 0) return NO_LAPSES;
  state.lobbies = standing;
  return lapsed;
}

const NO_LAPSES: readonly LobbyLapse[] = [];

/** ₺ a minute the standing deals pay the city, net of what they cost it. */
export function lobbyStipend(state: GameState): number {
  let total = 0;
  for (const deal of state.lobbies) total += LOBBY_SPECS[deal.id].stipend;
  return total;
}

// --- The hooks. Every one answers exactly 1 (or 0) with nothing signed. -------

/** Builder: how much faster a building climbs its levels. */
export function lobbyGrowthFactor(state: GameState): number {
  return hasDeal(state, 'builder') ? LOBBY_EFFECTS.BUILDER_GROWTH : 1;
}

/** Builder: what cheap building does to what the ground is worth. */
export function lobbyValueFactor(state: GameState): number {
  return hasDeal(state, 'builder') ? LOBBY_EFFECTS.BUILDER_VALUE : 1;
}

/** Oil and the union, pulling opposite ways on the same number. */
export function lobbyOutputFactor(state: GameState): number {
  let factor = 1;
  if (hasDeal(state, 'oil')) factor *= LOBBY_EFFECTS.OIL_OUTPUT;
  if (hasDeal(state, 'union')) factor *= LOBBY_EFFECTS.UNION_OUTPUT;
  return factor;
}

/** Oil and the NGO, likewise — the smokestack and the tree planted beside it. */
export function lobbyPollutionFactor(state: GameState): number {
  let factor = 1;
  if (hasDeal(state, 'oil')) factor *= LOBBY_EFFECTS.OIL_POLLUTION;
  if (hasDeal(state, 'ngo')) factor *= LOBBY_EFFECTS.NGO_POLLUTION;
  return factor;
}

/** Tourism: the pull on the visitor flow, on top of the landmarks' own. */
export function lobbyPullFactor(state: GameState): number {
  return hasDeal(state, 'tourism') ? LOBBY_EFFECTS.TOURISM_PULL : 1;
}

/** Tourism: what the crowds leave behind. */
export function lobbyRubbishFactor(state: GameState): number {
  return hasDeal(state, 'tourism') ? LOBBY_EFFECTS.TOURISM_RUBBISH : 1;
}

/** University: how far the same schools reach. */
export function lobbySchoolingFactor(state: GameState): number {
  return hasDeal(state, 'university') ? LOBBY_EFFECTS.UNIVERSITY_SCHOOLING : 1;
}

/** University: how fast the city learns. */
export function lobbyResearchFactor(state: GameState): number {
  return hasDeal(state, 'university') ? LOBBY_EFFECTS.UNIVERSITY_RESEARCH : 1;
}

/** Union: what a wage settlement is worth to the mood. */
export function lobbyHappiness(state: GameState): number {
  return hasDeal(state, 'union') ? LOBBY_EFFECTS.UNION_HAPPINESS : 0;
}
