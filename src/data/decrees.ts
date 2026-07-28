import type { GroupId } from '../sim/groups';
import type { Era } from '../sim/tiles';

/**
 * Decrees (§32) — what ruling by force actually offers.
 *
 * Everything else in this game asks the player to earn: build the school, win
 * the vote, keep the promise. A decree is the other door, and it was always in
 * the fantasy the constitution describes — the mayor who raises taxes on a whim,
 * drafts the young, cuts the internet, and finds out what the city will bear.
 *
 * The design is three sentences:
 *
 * - **Every decree pays now and angers always.** The benefit is immediate and
 *   legible ("gelir artar"); the anger accrues as *fury* for as long as the
 *   decree stands ("halk kızar"). Nothing is hidden about the trade itself —
 *   the row in the panel states both halves in plain words.
 * - **What is hidden is the city's temper.** Each city has a seed-derived
 *   tolerance for fury, and a seed-derived *sensitivity to each decree* — this
 *   city shrugs at conscription and riots over curfews, the next one the
 *   reverse. The player discovers their city's temper the only way a ruler
 *   ever has: by testing it. Every playthrough the thresholds differ.
 * - **The snap is never unexplained.** Fury telegraphs through staged warnings
 *   (murmurs, then protests) before it breaks into revolt, so the doctrine
 *   holds — a defeat is a warning that was ignored. The one exception is the
 *   player's own doing: censorship and the internet cut silence exactly those
 *   warnings. A ruler who blinds the press blinds themselves, and the game
 *   lets them.
 *
 * A revolt is not an ending. It dumps into the §29 unrest machinery — mood,
 * migration, crime, the factions — which is severe and fully recoverable,
 * because nothing in this game is a locked door. And each revolt names the
 * decree the city hated most, so even the riot is information: the player pays
 * for the knowledge in smoke.
 */
export type DecreeId = 'conscription' | 'censorship' | 'curfew' | 'propaganda' | 'internetCut';

export interface DecreeSpec {
  id: DecreeId;
  /** Era from which the state has the machinery for this. */
  unlockedAt: Era;
  /** Also gated by the calendar; the internet cannot be cut before it exists. */
  fromYear?: number;
  /**
   * Base fury per second while in force, before this city's sensitivity
   * multiplies it. Balance numbers live here rather than balance.ts because a
   * decree's rate is inseparable from what it does — the same rule the lobby
   * effects follow.
   */
  furyPerS: number;
  /** ₺ per minute it pays the treasury (or costs it, negative). */
  stipendPerMinute: number;
  /** Factions with a particular grievance while it stands (sim/groups.ts). */
  angers: readonly GroupId[];
  /** Whether it suppresses how fast fury *accrues* — and silences warnings. */
  muffles: boolean;
}

export const DECREE_SPECS: Readonly<Record<DecreeId, DecreeSpec>> = {
  // The draft: the treasury is paid a levy, the workshops lose their hands,
  // and the young remember who sent them.
  conscription: {
    id: 'conscription',
    unlockedAt: 'town',
    furyPerS: 1 / 900,
    stipendPerMinute: 260,
    angers: ['young', 'families'],
    muffles: false,
  },
  // The censor: fury organises more slowly — and the warnings that would have
  // told the player how close the edge is stop arriving. Both effects, one
  // switch; that is the whole bargain.
  censorship: {
    id: 'censorship',
    unlockedAt: 'town',
    furyPerS: 1 / 2400,
    stipendPerMinute: 0,
    angers: ['greens'],
    muffles: true,
  },
  // The curfew: the streets are safe and dead. Crime halves; the tills and the
  // night take the hit; the young and the shopkeepers seethe.
  curfew: {
    id: 'curfew',
    unlockedAt: 'city',
    furyPerS: 1 / 600,
    stipendPerMinute: 0,
    angers: ['young', 'shopkeepers'],
    muffles: false,
  },
  // The ministry of truth: every faction warms a little, the treasury pays for
  // the posters, and the city itself gets nothing at all. The one lever that
  // moves votes without moving a single real number — the report card ignores
  // it completely, which is the point.
  propaganda: {
    id: 'propaganda',
    unlockedAt: 'city',
    furyPerS: 1 / 3000,
    stipendPerMinute: -180,
    angers: [],
    muffles: false,
  },
  // The kill switch. Organisation collapses — fury accrues far slower and, like
  // censorship, the warnings go dark. So do the offices and the research, which
  // is what a modern economy is made of.
  internetCut: {
    id: 'internetCut',
    unlockedAt: 'town',
    fromYear: 2000,
    furyPerS: 1 / 700,
    stipendPerMinute: 0,
    angers: ['young'],
    muffles: true,
  },
};

/**
 * APPEND-ONLY: ids are stored in the save file by name, but the panel draws in
 * this order and the chronicle reads it back.
 */
export const DECREE_ORDER: readonly DecreeId[] = [
  'conscription',
  'censorship',
  'curfew',
  'propaganda',
  'internetCut',
];

/**
 * What each decree does to the systems it touches, beside the spec it belongs
 * to — the same table pattern as LOBBY_EFFECTS, for the same reason.
 */
export const DECREE_EFFECTS = {
  /** Conscription: the workshops, short-handed. */
  CONSCRIPTION_INDUSTRY: 0.92,
  /** Curfew: crime under the boot… */
  CURFEW_CRIME: 0.5,
  /** …and the shopfronts behind shutters. */
  CURFEW_COMMERCE: 0.9,
  /** Censorship: fury organises at three quarters speed. */
  CENSORSHIP_MUFFLE: 0.75,
  /** The internet cut: organisation at sixty percent… */
  INTERNET_MUFFLE: 0.6,
  /** …and the office floors idle with it. */
  INTERNET_OFFICE: 0.8,
  /** …and the city stops learning. */
  INTERNET_RESEARCH: 0.5,
  /** Propaganda: every pet score, warmed by this much. */
  PROPAGANDA_SWAY: 0.06,
} as const;
