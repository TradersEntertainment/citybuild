import { WEATHER_CLEAR_WEIGHT, WEATHER_SPAN_S } from '../data/balance';
import { createRng } from './rng';
import type { GameState } from './state';

/**
 * Weather (Paket 2 §6).
 *
 * Weather earns its place by pressing on systems the player already argues
 * with. Rain makes a fire hard to spread and a farm productive; a storm keeps
 * the engines in the shed; heat makes everything catch. So a spell of weather
 * is a reason to look at the city rather than a filter over it, and the fire
 * station the player built pays off differently in August than in November.
 *
 * Deterministic, like the hazards beside it: the dice come from the seed and
 * the spell number, so two players on the same map get the same summer and a
 * reload does not re-roll the sky. Nothing here is saved — the current spell is
 * a function of how long the city has been played.
 *
 * It does not touch happiness. A player cannot build their way out of rain, and
 * a mood penalty for something they cannot act on is a penalty for existing.
 */
export type WeatherKind = 'clear' | 'rain' | 'storm' | 'heat' | 'fog';

export interface Weather {
  kind: WeatherKind;
  /** Which spell this is since the city was founded; also the dice seed. */
  spell: number;
  /** 0..1 through the current spell, for a renderer that wants to fade it in. */
  progress: number;
}

/**
 * What the weather does to the rest of the simulation.
 *
 * Multipliers rather than rules, for the same reason the timeline uses them:
 * a system that has to know about weather is a system weather can break, and a
 * factor of one is a spell that has no opinion.
 */
export interface WeatherEffects {
  /** Chance a building catches at all. */
  ignitionMult: number;
  /** Chance a fire jumps to its neighbour. */
  spreadMult: number;
  /** How fast the brigade gets there; below one is slower. */
  responseMult: number;
  /** Farm output. */
  farmMult: number;
}

export const FAIR_EFFECTS: WeatherEffects = {
  ignitionMult: 1,
  spreadMult: 1,
  responseMult: 1,
  farmMult: 1,
};

/**
 * Each kind and what it does. Weights are relative; clear weather is weighted
 * separately and heavily, because weather that is always happening is not
 * weather, it is a setting.
 */
interface Spell {
  kind: WeatherKind;
  weight: number;
  effects: Partial<WeatherEffects>;
}

const SPELLS: readonly Spell[] = [
  { kind: 'rain', weight: 4, effects: { spreadMult: 0.4, ignitionMult: 0.6, farmMult: 1.2 } },
  // A storm is rain that also keeps the engines in the shed.
  { kind: 'storm', weight: 2, effects: { spreadMult: 0.5, responseMult: 0.7, farmMult: 1.1 } },
  { kind: 'heat', weight: 3, effects: { ignitionMult: 1.6, spreadMult: 1.3, farmMult: 0.85 } },
  // Fog is the one that is only weather. Not everything has to be a mechanic.
  { kind: 'fog', weight: 2, effects: {} },
];

/** Which spell the city is in, from played time alone. */
export function weatherAt(state: GameState): Weather {
  const seconds = Math.max(0, state.playedMs) / 1000;
  const spell = Math.floor(seconds / WEATHER_SPAN_S);
  const progress = (seconds % WEATHER_SPAN_S) / WEATHER_SPAN_S;

  // The spell number is the whole state: the same city at the same moment is
  // always in the same weather, on any device, after any reload.
  const rng = createRng(state.seed ^ Math.imul(spell + 1, 0x9e3779b1));
  return { kind: pick(rng.next()), spell, progress };
}

/**
 * Rolls a kind from the weights, with clear weather carrying most of the mass.
 */
function pick(roll: number): WeatherKind {
  const total = WEATHER_CLEAR_WEIGHT + SPELLS.reduce((sum, s) => sum + s.weight, 0);
  let cursor = roll * total;
  if (cursor < WEATHER_CLEAR_WEIGHT) return 'clear';
  cursor -= WEATHER_CLEAR_WEIGHT;
  for (const spell of SPELLS) {
    if (cursor < spell.weight) return spell.kind;
    cursor -= spell.weight;
  }
  return 'clear';
}

/** What the current weather is doing to the sim. */
export function weatherEffects(kind: WeatherKind): WeatherEffects {
  const spell = SPELLS.find((s) => s.kind === kind);
  if (!spell) return FAIR_EFFECTS;
  return { ...FAIR_EFFECTS, ...spell.effects };
}

/**
 * A spell has to last long enough to be noticed and short enough to change.
 * Exported so a test can state the range rather than trust the constants.
 */
export const SPELL_SECONDS = WEATHER_SPAN_S;

export function isWeatherWorthAnnouncing(kind: WeatherKind): boolean {
  return kind !== 'clear';
}

/** Every kind there is, for a UI that wants to name them all. */
export const WEATHER_KINDS: readonly WeatherKind[] = [
  'clear',
  ...SPELLS.map((s) => s.kind),
];
