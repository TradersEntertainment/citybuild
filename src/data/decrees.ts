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
 *   lets them — unless they also pay for informants, who whisper what the
 *   silenced papers cannot print.
 *
 * A revolt is not an ending. It dumps into the §29 unrest machinery — mood,
 * migration, crime, the factions — which is severe and fully recoverable,
 * because nothing in this game is a locked door. And each revolt names the
 * decree the city hated most, so even the riot is information: the player pays
 * for the knowledge in smoke.
 *
 * ## Why the effects live on the spec
 *
 * Every multiplier a decree applies is a field on its own row, and the sim
 * computes plain products over the active set. Thirteen decrees with bespoke
 * effect constants and bespoke hook functions would mean every new decree
 * touches four files; this way a new decree is one entry here and two strings,
 * and nothing else in the game learns its name.
 */
export type DecreeId =
  | 'conscription'
  | 'censorship'
  | 'corvee'
  | 'grainLevy'
  | 'curfew'
  | 'propaganda'
  | 'strikeBan'
  | 'informants'
  | 'surcharge'
  | 'martialLaw'
  | 'borderClosure'
  | 'internetCut'
  | 'socialMediaBan';

export interface DecreeSpec {
  id: DecreeId;
  /** Era from which the state has the machinery for this. */
  unlockedAt: Era;
  /** Also gated by the calendar; the internet cannot be cut before it exists. */
  fromYear?: number;
  /**
   * Base fury per second while in force, before this city's sensitivity
   * multiplies it.
   */
  furyPerS: number;
  /** ₺ per minute it pays the treasury (or costs it, negative). */
  stipendPerMinute: number;
  /** Factions with a particular grievance while it stands (sim/groups.ts). */
  angers: readonly GroupId[];
  /** Factions it flatters — at half the weight, because imposed favour is thin. */
  pleases?: readonly GroupId[];

  // --- What it does while it stands. Absent means "does not touch it". -------
  /** Multiplier on how fast fury *organises* (accrues). Below 1 = suppression. */
  muffle?: number;
  /** Silences the murmur/protest warnings — the ruler blinds their own press. */
  blinds?: boolean;
  /** Informants: warnings arrive even when the press is blinded. */
  reveals?: boolean;
  /** Workshop output. */
  industry?: number;
  /** Shop output. */
  commerce?: number;
  /** Office output. */
  office?: number;
  /** Crime rate. */
  crime?: number;
  /** Research rate. */
  research?: number;
  /** The whole tax take — a surcharge decree taxes the tax. */
  taxFactor?: number;
  /** What the harvest sells for — a levy takes the farmer's margin. */
  farmFactor?: number;
  /** What the roads cost the treasury — corvée makes the people carry it. */
  roadUpkeepFactor?: number;
  /** Emigration. Below 1 = the border is closed and people cannot leave. */
  emigrationFactor?: number;
  /** How fast §29 unrest is suppressed. Above 1 = troops on the streets. */
  unrestQuiet?: number;
}

export const DECREE_SPECS: Readonly<Record<DecreeId, DecreeSpec>> = {
  // --- The village strongman ------------------------------------------------
  // The oldest tax there is: the harvest passes through the state's scales and
  // the margin stays there. The countryside remembers.
  grainLevy: {
    id: 'grainLevy',
    unlockedAt: 'village',
    furyPerS: 1 / 1000,
    stipendPerMinute: 0,
    farmFactor: 1.4,
    angers: ['elders', 'families'],
  },
  // Unpaid labour on the roads. The treasury saves; the people who carry the
  // stones are the same people who vote.
  corvee: {
    id: 'corvee',
    unlockedAt: 'town',
    furyPerS: 1 / 850,
    stipendPerMinute: 0,
    roadUpkeepFactor: 0.6,
    angers: ['families', 'young'],
  },
  // The draft: the treasury is paid a levy, the workshops lose their hands,
  // and the young remember who sent them.
  conscription: {
    id: 'conscription',
    unlockedAt: 'town',
    furyPerS: 1 / 900,
    stipendPerMinute: 260,
    industry: 0.92,
    angers: ['young', 'families'],
  },
  // The censor: fury organises more slowly — and the warnings that would have
  // told the player how close the edge is stop arriving. Both effects, one
  // switch; that is the whole bargain.
  censorship: {
    id: 'censorship',
    unlockedAt: 'town',
    furyPerS: 1 / 2400,
    stipendPerMinute: 0,
    muffle: 0.75,
    blinds: true,
    angers: ['greens'],
  },

  // --- The city-era apparatus ------------------------------------------------
  // The curfew: the streets are safe and dead. Crime halves; the tills and the
  // night take the hit; the young and the shopkeepers seethe.
  curfew: {
    id: 'curfew',
    unlockedAt: 'city',
    furyPerS: 1 / 600,
    stipendPerMinute: 0,
    crime: 0.5,
    commerce: 0.9,
    angers: ['young', 'shopkeepers'],
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
    pleases: ['young', 'elders', 'families', 'shopkeepers', 'industrialists', 'greens', 'drivers'],
  },
  // The strike ban: the lines run and the floor cannot answer. The owners are
  // delighted, which is exactly who a decree like this is for.
  strikeBan: {
    id: 'strikeBan',
    unlockedAt: 'city',
    furyPerS: 1 / 800,
    stipendPerMinute: 0,
    industry: 1.1,
    angers: ['young', 'families'],
    pleases: ['industrialists'],
  },
  // The informant network: paid ears in every stairwell. Crime falls, and the
  // street's mood reaches the palace even when the papers cannot print it —
  // the classic pairing with censorship, priced as one.
  informants: {
    id: 'informants',
    unlockedAt: 'city',
    furyPerS: 1 / 1500,
    stipendPerMinute: -120,
    crime: 0.75,
    reveals: true,
    angers: ['families', 'elders'],
  },

  // --- The metro-era state ---------------------------------------------------
  // The surcharge: a decree that taxes the tax. Every till and every payslip,
  // fifteen percent heavier — the whole commercial class at once.
  surcharge: {
    id: 'surcharge',
    unlockedAt: 'metro',
    furyPerS: 1 / 700,
    stipendPerMinute: 0,
    taxFactor: 1.15,
    angers: ['shopkeepers', 'industrialists', 'elders'],
  },
  // Martial law: the nuclear option. Troops suppress crime and §29 unrest
  // alike, commerce dies behind the checkpoints, and every faction reads it
  // the same way — the fastest fury in the table, by design.
  martialLaw: {
    id: 'martialLaw',
    unlockedAt: 'metro',
    furyPerS: 1 / 450,
    stipendPerMinute: 0,
    crime: 0.4,
    commerce: 0.85,
    unrestQuiet: 2,
    angers: ['young', 'elders', 'families', 'shopkeepers', 'industrialists', 'greens', 'drivers'],
  },
  // The closed border: the one decree aimed at the consequence of all the
  // others. Unrest pushes people toward the door; this locks it. They stay,
  // and they stay angry.
  borderClosure: {
    id: 'borderClosure',
    unlockedAt: 'metro',
    furyPerS: 1 / 650,
    stipendPerMinute: 0,
    emigrationFactor: 0.25,
    angers: ['young', 'greens'],
  },

  // --- The modern kill switches ----------------------------------------------
  // The full cut. Organisation collapses — fury accrues far slower and, like
  // censorship, the warnings go dark. So do the offices and the research,
  // which is what a modern economy is made of.
  internetCut: {
    id: 'internetCut',
    unlockedAt: 'town',
    fromYear: 2000,
    furyPerS: 1 / 700,
    stipendPerMinute: 0,
    muffle: 0.6,
    blinds: true,
    office: 0.8,
    research: 0.5,
    angers: ['young'],
  },
  // The cut's younger sibling: the platforms go dark but the wire stays up.
  // Milder on both sides — some organisation lost, a sliver of the office
  // day with it — and it does NOT blind the warnings: people still talk,
  // just more slowly.
  socialMediaBan: {
    id: 'socialMediaBan',
    unlockedAt: 'town',
    fromYear: 2010,
    furyPerS: 1 / 1600,
    stipendPerMinute: 0,
    muffle: 0.8,
    office: 0.95,
    angers: ['young'],
  },
};

/**
 * APPEND-ONLY: ids are stored in the save file by name, but the panel draws in
 * this order and the chronicle reads it back. Grouped by the era they arrive
 * in, so the menu reads as the state's toolkit growing.
 */
export const DECREE_ORDER: readonly DecreeId[] = [
  'grainLevy',
  'corvee',
  'conscription',
  'censorship',
  'curfew',
  'propaganda',
  'strikeBan',
  'informants',
  'surcharge',
  'martialLaw',
  'borderClosure',
  'internetCut',
  'socialMediaBan',
];
