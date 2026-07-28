import {
  BREAD_CAP,
  BREAD_PER_CITIZEN,
  BREAD_RELIEF,
  CONFISCATION_CAP,
  CONFISCATION_FURY,
  CONFISCATION_PER_CITIZEN,
  DECREE_GROUP_SWAY,
  FURY_DECAY_PER_S,
  REVOLT_UNREST_JUMP,
  REVOLT_VENT_SHARE,
  TAX_FURY_PER_S,
  TAX_RATE_MAX,
  TAX_RATE_MIN,
} from '../data/balance';
import { DECREE_ORDER, DECREE_SPECS, type DecreeId, type DecreeSpec } from '../data/decrees';
import { yearOf } from './timeline';
import type { GroupId } from './groups';
import { createRng, hashSeed } from './rng';
import type { GameState } from './state';
import { eraReached } from './tiles';

/**
 * Fury, and the city's hidden temper (§32).
 *
 * data/decrees.ts explains the design. This is the machinery, and its one
 * genuinely novel piece is the *temper*: three families of hidden numbers,
 * every one derived from the seed and none of them ever shown.
 *
 * - **Tolerance** — how much accumulated fury this city bears before it
 *   revolts. One city breaks at half what another shrugs off.
 * - **Sensitivity, per decree** — how much this particular city minds this
 *   particular decree. The city that barely notices conscription may riot over
 *   a curfew, and the next seed reverses it. "Bu halk şuna sinirleniyor" is a
 *   fact about *this* city, learnable only by governing it.
 * - **Tax comfort** — the rate above which taxation starts reading as
 *   plunder. Below it the ordinary machinery (mood, the civic base) is the
 *   whole cost; above it, fury.
 *
 * Derived rather than rolled or stored, like every offer and every opponent:
 * a reload changes nothing, a new seed changes everything, and the save file
 * never has to carry a secret — the secret *is* the seed.
 *
 * ## Why hidden numbers are allowed here
 *
 * This codebase's doctrine is legibility — zero is information, locks name
 * their keys. A hidden threshold looks like a violation. It is not, for two
 * reasons. First, the *trade* is fully stated: every decree row says what it
 * pays and that it angers, and the fury meter itself is visible. What is
 * hidden is only where the edge lies — and the staged warnings (murmurs at
 * roughly half, protests near the brink, both positions jittered per city)
 * mean the edge always announces itself twice before it arrives. A revolt is
 * still a warning that was ignored. Second, the player can silence those
 * warnings — but only by their own decree, and the panel says so in the same
 * breath. Blindness is never something the game does to them.
 */

// --- The hidden temper ----------------------------------------------------------

/** How much fury this city bears before it revolts. Hidden; seed-derived. */
export function tolerance(state: GameState): number {
  const rng = createRng((state.seed ^ hashSeed('temper:tolerance')) >>> 0);
  return rng.range(0.55, 1.15);
}

/**
 * How much this city minds this decree, as a multiplier on its fury rate.
 * The spread is wide on purpose: at 0.6 a decree is background noise, at 1.8
 * it is the thing this city will riot about first.
 */
export function sensitivity(
  state: GameState,
  id: DecreeId | 'tax' | 'confiscation' | 'bread',
): number {
  const rng = createRng((state.seed ^ hashSeed(`temper:sense:${id}`)) >>> 0);
  return rng.range(0.6, 1.8);
}

/** The tax rate above which fury starts. Hidden; seed-derived. */
export function taxComfort(state: GameState): number {
  const rng = createRng((state.seed ^ hashSeed('temper:taxComfort')) >>> 0);
  return rng.range(0.1, 0.15);
}

/**
 * Where the two warnings fire, as fractions of tolerance — jittered per city so
 * even the warning positions cannot be memorised across playthroughs.
 */
function warningFractions(state: GameState): { murmur: number; protest: number } {
  const rng = createRng((state.seed ^ hashSeed('temper:warnings')) >>> 0);
  return { murmur: rng.range(0.42, 0.58), protest: rng.range(0.74, 0.86) };
}

// --- Enacting and repealing ------------------------------------------------------

export function isDecreeActive(state: GameState, id: DecreeId): boolean {
  return state.decrees.includes(id);
}

export type DecreeGate = 'open' | 'era' | 'year';

/** Why a decree is locked, or 'open'. A lock always shows what opens it. */
export function decreeGate(state: GameState, id: DecreeId): DecreeGate {
  const spec = DECREE_SPECS[id];
  if (!eraReached(state.era, spec.unlockedAt)) return 'era';
  if (spec.fromYear !== undefined && yearOf(state.playedMs) < spec.fromYear) return 'year';
  return 'open';
}

export type DecreeResult = 'enacted' | 'repealed' | 'locked';

/** Flips a decree. Free in money, never free in fury. */
export function toggleDecree(state: GameState, id: DecreeId): DecreeResult {
  if (decreeGate(state, id) !== 'open') return 'locked';
  if (isDecreeActive(state, id)) {
    state.decrees = state.decrees.filter((active) => active !== id);
    return 'repealed';
  }
  state.decrees.push(id);
  return 'enacted';
}

/** Sets the tax rate, clamped. The oldest lever there is, finally attached. */
export function setTaxRate(state: GameState, rate: number): void {
  if (!Number.isFinite(rate)) return;
  state.taxRate = Math.min(TAX_RATE_MAX, Math.max(TAX_RATE_MIN, rate));
}

export interface ConfiscationResult {
  seized: number;
}

/**
 * The one-shot: seize wealth now, eat a chunk of fury now.
 *
 * No cooldown, deliberately — fury itself is the brake, and finding out how
 * many times this city will stand for it is exactly the experiment the player
 * is being invited to run. The chunk scales with this city's sensitivity, so
 * the answer differs every seed.
 */
export function confiscate(state: GameState): ConfiscationResult {
  const seized = Math.min(CONFISCATION_CAP, Math.round(state.population * CONFISCATION_PER_CITIZEN));
  state.money += seized;
  state.fury = clampFury(state.fury + CONFISCATION_FURY * sensitivity(state, 'confiscation'));
  return { seized };
}

export type BreadResult = { fed: true; cost: number; relief: number } | { fed: false };

/**
 * The other one-shot: bread, handed out on the square.
 *
 * The release valve every autocrat reaches for — pay now, and some of the
 * banked fury goes home fed. How *much* goes home is this city's own secret,
 * inverted: a touchy city is also a hard one to buy off, so the same hidden
 * sensitivity that makes decrees expensive here makes bread cheap-looking and
 * weak. "Bu halk ekmekle yatışmıyor" is a discovery, and it costs a granary
 * to make.
 *
 * Refused outright when the treasury cannot cover it: a dole the city cannot
 * pay for is not a dole, and the bank is where borrowing lives.
 */
export function handOutBread(state: GameState): BreadResult {
  const cost = Math.min(BREAD_CAP, Math.max(500, Math.round(state.population * BREAD_PER_CITIZEN)));
  if (state.money < cost) return { fed: false };
  state.money -= cost;
  const relief = BREAD_RELIEF / sensitivity(state, 'bread');
  state.fury = clampFury(state.fury - relief);
  // The street can visibly settle a stage; the told-stage follows downward so
  // the next escalation is announced fresh rather than swallowed.
  if (furyStage(state) < state.furyToldStage) state.furyToldStage = furyStage(state);
  return { fed: true, cost, relief };
}

// --- The meter -------------------------------------------------------------------

/** 0 calm · 1 murmurs · 2 protests. Derived from fury against the hidden marks. */
export function furyStage(state: GameState): number {
  const marks = warningFractions(state);
  const limit = tolerance(state);
  if (state.fury >= limit * marks.protest) return 2;
  if (state.fury >= limit * marks.murmur) return 1;
  return 0;
}

/**
 * Whether the player's own decrees have blinded the early warnings.
 *
 * Any blinding decree silences them — unless an informant network is also on
 * the payroll, in which case the street's mood reaches the palace however
 * quiet the papers are. Paying to see what your own censorship hides is the
 * oldest line-item in the autocrat's budget, and it works here too.
 */
export function warningsSilenced(state: GameState): boolean {
  let blinded = false;
  let revealed = false;
  for (const id of state.decrees) {
    if (DECREE_SPECS[id].blinds) blinded = true;
    if (DECREE_SPECS[id].reveals) revealed = true;
  }
  return blinded && !revealed;
}

/** Fury added per second by everything currently in force, temper included. */
export function furyPressure(state: GameState): number {
  let pressure = 0;
  for (const id of state.decrees) {
    pressure += DECREE_SPECS[id].furyPerS * sensitivity(state, id);
  }
  const excess = state.taxRate - taxComfort(state);
  if (excess > 0) {
    // Per 5% over the comfort line, one full unit of the base rate — so the
    // last few points of the tax slider are far dearer than the first.
    pressure += TAX_FURY_PER_S * (excess / 0.05) * sensitivity(state, 'tax');
  }
  // The muffles: every suppressing decree slows how fast anger organises, and
  // they multiply — a ruler who reaches for all of them gets a city that is
  // very quiet and, if they blinded the press too, very unreadable.
  for (const id of state.decrees) pressure *= DECREE_SPECS[id].muffle ?? 1;
  return pressure;
}

export type DecreeEventKind = 'murmurs' | 'protests' | 'calm' | 'revolt';

export interface DecreeEvent {
  kind: DecreeEventKind;
  /** For a revolt: the decree the city hated most, or 'tax'. Paid-for knowledge. */
  worst?: DecreeId | 'tax' | null;
}

/**
 * Advances the meter, and reports what the player is allowed to hear.
 *
 * `live` keeps the offline mercy the bins established: while nobody watches,
 * fury only falls. A player who leaves a curfew running overnight comes back
 * to the city they left, not to three revolts they never saw — the same rule
 * as every hazard in the game.
 *
 * The warning bookkeeping runs off `furyToldStage`, the one piece of
 * transient state: the stage the player has been *told about*. When warnings
 * are silenced the meter still moves but the told-stage freezes, so the tick
 * after the last muffling decree is repealed, the backlog announces itself —
 * lifting censorship and immediately learning the streets are at the brink is
 * the whole payoff of that design.
 */
export function stepDecrees(state: GameState, dt: number, live = true): readonly DecreeEvent[] {
  const limit = tolerance(state);
  const pressure = live ? furyPressure(state) : 0;
  state.fury = clampFury(state.fury + (pressure - FURY_DECAY_PER_S) * dt);

  const events: DecreeEvent[] = [];

  // The snap. Announced even under censorship — you can silence a newspaper,
  // not a burning square.
  if (state.fury >= limit) {
    state.unrest = Math.min(1, state.unrest + REVOLT_UNREST_JUMP);
    // The riot vents most of what it was made of; the grievance survives it.
    state.fury = limit * REVOLT_VENT_SHARE;
    state.furyToldStage = furyStage(state);
    events.push({ kind: 'revolt', worst: worstGrievance(state) });
    return events;
  }

  const stage = furyStage(state);
  if (!warningsSilenced(state)) {
    if (stage > state.furyToldStage) {
      // Announce every step climbed, in order — a jump from calm straight to
      // protests (after censorship lifts) is two pieces of news, not one.
      for (let told = state.furyToldStage + 1; told <= stage; told++) {
        events.push({ kind: told === 1 ? 'murmurs' : 'protests' });
      }
      state.furyToldStage = stage;
    } else if (stage === 0 && state.furyToldStage > 0) {
      events.push({ kind: 'calm' });
      state.furyToldStage = 0;
    } else {
      state.furyToldStage = stage;
    }
  }

  return events;
}

/** What lit the fuse: the standing pressure the city minds most right now. */
function worstGrievance(state: GameState): DecreeId | 'tax' | null {
  let worst: DecreeId | 'tax' | null = null;
  let heat = 0;
  for (const id of state.decrees) {
    const contribution = DECREE_SPECS[id].furyPerS * sensitivity(state, id);
    if (contribution > heat) {
      heat = contribution;
      worst = id;
    }
  }
  const excess = state.taxRate - taxComfort(state);
  if (excess > 0 && TAX_FURY_PER_S * (excess / 0.05) * sensitivity(state, 'tax') > heat) {
    worst = 'tax';
  }
  return worst;
}

function clampFury(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 2 ? 2 : value;
}

// --- The hooks. Every one answers exactly 1 (or 0) with nothing decreed. --------

/** Conscription's stipend less propaganda's bill, ₺ a minute. */
export function decreeStipend(state: GameState): number {
  let total = 0;
  for (const id of state.decrees) total += DECREE_SPECS[id].stipendPerMinute;
  return total;
}

/**
 * The product of one effect field over every decree in force.
 *
 * All the standing multipliers go through here, so adding a decree is one row
 * in the table and nothing else — the curfew and martial law both dim the
 * shops, and a city under both gets both, multiplied, without either knowing
 * the other exists.
 */
function productOf(state: GameState, key: keyof DecreeSpec): number {
  let factor = 1;
  for (const id of state.decrees) {
    const value = DECREE_SPECS[id][key];
    if (typeof value === 'number') factor *= value;
  }
  return factor;
}

/** Conscription and the strike ban, pulling opposite ways on the same floor. */
export function decreeIndustryFactor(state: GameState): number {
  return productOf(state, 'industry');
}

/** Curfew and martial law: shutters at dusk, checkpoints at noon. */
export function decreeCommerceFactor(state: GameState): number {
  return productOf(state, 'commerce');
}

/** Curfew, informants and martial law — three grips on the same streets. */
export function decreeCrimeFactor(state: GameState): number {
  return productOf(state, 'crime');
}

/** The cuts: office floors with nothing to trade on. */
export function decreeOfficeFactor(state: GameState): number {
  return productOf(state, 'office');
}

/** The cut: a city that stops learning. */
export function decreeResearchFactor(state: GameState): number {
  return productOf(state, 'research');
}

/** The surcharge: a decree that taxes the tax. */
export function decreeTaxFactor(state: GameState): number {
  return productOf(state, 'taxFactor');
}

/** The grain levy: the harvest's margin, kept at the scales. */
export function decreeFarmFactor(state: GameState): number {
  return productOf(state, 'farmFactor');
}

/** Corvée: the people carry the roads, the treasury does not. */
export function decreeRoadUpkeepFactor(state: GameState): number {
  return productOf(state, 'roadUpkeepFactor');
}

/**
 * The closed border: how much of the outflow actually gets out.
 *
 * Read by the migration step (sim/population.ts) on the leaving side only —
 * a closed border has never stopped anyone arriving.
 */
export function decreeEmigrationFactor(state: GameState): number {
  return productOf(state, 'emigrationFactor');
}

/**
 * Martial law: how much faster §29 unrest is put down while troops hold the
 * squares. Read by sim/unrest.ts on its decay terms — suppression, not
 * forgiveness, which is why it does nothing about the fury underneath.
 */
export function decreeUnrestQuiet(state: GameState): number {
  return productOf(state, 'unrestQuiet');
}

/**
 * What the decrees do to one faction's vote: each named grievance at full
 * weight, each flattery at half — imposed favour is thin, imposed harm is not
 * (sim/groups.ts).
 */
export function decreeSway(state: GameState, id: GroupId): number {
  let sway = 0;
  for (const active of state.decrees) {
    const spec = DECREE_SPECS[active];
    if (spec.angers.includes(id)) sway -= DECREE_GROUP_SWAY;
    if (spec.pleases?.includes(id)) sway += DECREE_GROUP_SWAY / 2;
  }
  return sway;
}

/** Every decree, with its gate, for the panel. */
export function decreeStates(
  state: GameState,
): { id: DecreeId; active: boolean; gate: DecreeGate }[] {
  return DECREE_ORDER.map((id) => ({
    id,
    active: isDecreeActive(state, id),
    gate: decreeGate(state, id),
  }));
}
