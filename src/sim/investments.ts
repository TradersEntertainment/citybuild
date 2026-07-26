import {
  FESTIVAL_PER_LEVEL,
  GREENING_PER_LEVEL,
  NIGHT_HAPPINESS_PER_LEVEL,
  NIGHT_TRADE_LOSS,
} from '../data/balance';
import {
  isTierUnlocked,
  PROGRAMME_ORDER,
  tierAt,
  tiersOf,
  type ProgrammeId,
} from '../data/investments';
import { MEAN_NIGHT } from './daytime';
import type { GameState } from './state';

/**
 * What the city's money buys (belediye yatırımları).
 *
 * The rules for the programmes in data/investments.ts. All of them are the same
 * shape — a level per programme, bought one tier at a time, never sold — so this
 * is mostly one function repeated with different effects hanging off it.
 *
 * The interesting part is the night trade, below.
 */

export function investmentLevel(state: GameState, id: ProgrammeId): number {
  return Math.max(0, Math.min(tiersOf(id).length, state.investments[id] ?? 0));
}

/** 0..1 across the whole programme, which is what the effects are scaled by. */
export function investmentShare(state: GameState, id: ProgrammeId): number {
  return investmentLevel(state, id) / tiersOf(id).length;
}

export type BuyResult = 'ok' | 'finished' | 'locked' | 'tooDear';

export function canBuyInvestment(state: GameState, id: ProgrammeId): BuyResult {
  const level = investmentLevel(state, id);
  const tier = tierAt(id, level);
  if (!tier) return 'finished';
  if (!isTierUnlocked(id, level, state.era)) return 'locked';
  if (state.money < tier.cost) return 'tooDear';
  return 'ok';
}

export function buyInvestment(state: GameState, id: ProgrammeId): BuyResult {
  const check = canBuyInvestment(state, id);
  if (check !== 'ok') return check;
  const level = investmentLevel(state, id);
  const tier = tierAt(id, level);
  if (!tier) return 'finished';
  state.money -= tier.cost;
  state.investments[id] = level + 1;
  return 'ok';
}

/** What every programme the city runs costs it per minute. */
export function investmentUpkeep(state: GameState): number {
  let total = 0;
  for (const id of PROGRAMME_ORDER) {
    const level = investmentLevel(state, id);
    for (let n = 0; n < level; n++) total += tiersOf(id)[n]?.upkeep ?? 0;
  }
  return total;
}

/**
 * How well lit the city is, 0..1. Read by the renderer as well as the rules, so
 * what the player sees and what they earn cannot disagree.
 */
export function lightingShare(state: GameState): number {
  return investmentShare(state, 'lighting');
}

/**
 * The uplift a daytime hour gets so that an unlit city's *daily average* is
 * exactly 1.
 *
 * This is the whole calibration, and it is derived rather than tuned. Making the
 * night worth less than a day would otherwise be a straight nerf to every city
 * already built: the same shops, the same streets, less money. Instead the loss
 * at night is paid back over the day, so a dark city earns exactly what it
 * earned before the night meant anything — and lighting is then a real gain
 * rather than the removal of a penalty.
 *
 * Divided out of `MEAN_NIGHT`, which is sampled from the day curve itself, so
 * this stays correct if the length of the night ever changes.
 */
export const DAY_TRADE_UPLIFT = 1 + NIGHT_TRADE_LOSS * MEAN_NIGHT;

/**
 * The trade multiplier for a moment of the day.
 *
 * `night` is 0..1 from the day cycle. Shops shut in the dark and nobody pulls
 * off a motorway into an unlit town; lamps buy that back, hour by hour, and at
 * full lighting the city trades through the night as well as it does at noon.
 */
export function tradeByHour(night: number, lighting: number): number {
  const dark = clamp01(night) * (1 - clamp01(lighting));
  return DAY_TRADE_UPLIFT - NIGHT_TRADE_LOSS * dark;
}

/** The same, for a state and a moment — the form every caller actually wants. */
export function tradeNow(state: GameState, night: number): number {
  return tradeByHour(night, lightingShare(state));
}

/**
 * Mood the lamps are worth after dark.
 *
 * A pure bonus, and only at night: an unlit city is not marked down for being
 * unlit, because punishing a player for not having bought something they have
 * not been shown is how a game teaches resentment. Lighting is a gift the city
 * gives back, which is what a purchase should feel like.
 */
export function nightHappiness(state: GameState, night: number): number {
  return investmentLevel(state, 'lighting') * NIGHT_HAPPINESS_PER_LEVEL * clamp01(night);
}

/**
 * Extra pollution the city's own trees soak up, per level.
 *
 * Applied as a share of every tile's load in the diffusion pass, so it is the one
 * purchase that helps most exactly where industry is worst.
 */
export function greeningAbsorption(state: GameState): number {
  return investmentLevel(state, 'greening') * GREENING_PER_LEVEL;
}

/** Multiplier on what a holiday is worth, from the festival budget. */
export function festivalBoost(state: GameState): number {
  return 1 + investmentLevel(state, 'festivals') * FESTIVAL_PER_LEVEL;
}

/** Every programme's level, for the save and the panel. */
export function investmentLevels(state: GameState): Record<ProgrammeId, number> {
  return {
    lighting: investmentLevel(state, 'lighting'),
    greening: investmentLevel(state, 'greening'),
    festivals: investmentLevel(state, 'festivals'),
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
