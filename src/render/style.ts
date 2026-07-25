import type { Era } from '../sim/tiles';

/**
 * The signature system (§14.1): the map's *drawing technique* changes with the
 * era. Every layer asks this module how to draw rather than hard-coding
 * strokes, so adding an era means adding a row here.
 *
 * Phase 0 defines the palette and the founding/village hand-drawn style; the
 * later eras and the 3-second cross-fade land with Phase 4.
 */
export const PALETTE = {
  ink: '#16232E',
  parchment: '#E6DAC2',
  cobalt: '#2C6E8C',
  brass: '#C08A2E',
  moss: '#56784A',
  brick: '#A34C38',
  fog: '#97A2A6',
} as const;

export interface DrawStyle {
  /** Base sheet the map is drawn on. */
  paper: string;
  /** Colour of grid/cadastral lines. */
  rule: string;
  ruleWidth: number;
  ruleAlpha: number;
  /** Heavier line for parcel edges. */
  parcelRule: string;
  parcelWidth: number;
  /** How far a line may wobble off true, in CSS px, at zoom 1. */
  jitter: number;
  /** Ink texture density; 0 disables the grain pass. */
  grain: number;
}

const HAND_DRAWN: DrawStyle = {
  paper: PALETTE.parchment,
  rule: PALETTE.ink,
  ruleWidth: 1,
  ruleAlpha: 0.1,
  parcelRule: PALETTE.ink,
  parcelWidth: 1.6,
  jitter: 0.9,
  grain: 0.05,
};

const PRINTED: DrawStyle = {
  ...HAND_DRAWN,
  ruleAlpha: 0.13,
  jitter: 0.25,
  grain: 0.03,
};

const TECHNICAL: DrawStyle = {
  ...HAND_DRAWN,
  rule: PALETTE.cobalt,
  parcelRule: PALETTE.cobalt,
  ruleAlpha: 0.18,
  jitter: 0,
  grain: 0.015,
};

const ORTHOPHOTO: DrawStyle = {
  ...TECHNICAL,
  paper: '#1F2A26',
  rule: PALETTE.fog,
  parcelRule: PALETTE.fog,
  ruleAlpha: 0.12,
  grain: 0,
};

const BY_ERA: Record<Era, DrawStyle> = {
  founding: HAND_DRAWN,
  village: HAND_DRAWN,
  town: PRINTED,
  city: PRINTED,
  metro: TECHNICAL,
  metropolis: TECHNICAL,
  megacity: ORTHOPHOTO,
};

export function styleForEra(era: Era): DrawStyle {
  return BY_ERA[era];
}

/**
 * Deterministic per-cell wobble. Same tile always wobbles the same way, so the
 * map looks hand-drawn while staying rock steady when the camera moves — a
 * random() here would make the whole sheet shimmer.
 */
export function wobble(x: number, y: number, amount: number): number {
  if (amount === 0) return 0;
  return (hashUnit(x, y, 0) - 0.5) * 2 * amount;
}

/**
 * Deterministic 0..1 value per (tile, salt). Different salts give independent
 * streams, so a tile can pick a tree count, a tree size and a lean without the
 * three correlating into a visible pattern.
 */
export function hashUnit(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
