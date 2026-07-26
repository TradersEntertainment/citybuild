import type { Era } from '../sim/tiles';

/**
 * Research (§12.2).
 *
 * Points have accrued in `research` since Phase 0 with nowhere to spend them.
 * What they buy here follows the rule every other system was held to: a tech
 * lifts a ceiling, it never adds a wall. Nothing below is required to keep
 * playing, nothing below gates content behind a grind, and a city that never
 * researches anything is a city that is merely leaving something on the table.
 *
 * Six of them, each attached to a system the player has already met and can
 * already feel going wrong — smoke, jams, upkeep, land prices. A tech for a
 * system the player has no complaint about is a line of text.
 */
export type TechId =
  | 'sanitation'
  | 'transit'
  | 'codes'
  | 'registry'
  | 'administration'
  | 'agronomy';

export interface Tech {
  id: TechId;
  cost: number;
  /** Not offered before this era, so the ceiling it lifts is one already met. */
  from: Era;
  /** What it multiplies. Read through techFactor; never applied twice. */
  factor: number;
}

export const TECHS: readonly Tech[] = [
  // Smoke is the first system that punishes a player for where they put things.
  { id: 'sanitation', cost: 40, from: 'village', factor: 0.62 },
  // Growth speed: the most directly felt thing in the game.
  { id: 'codes', cost: 70, from: 'village', factor: 1.3 },
  // Land runs out at about the same time this becomes affordable.
  { id: 'registry', cost: 120, from: 'town', factor: 0.75 },
  // Farms are a whole zone that pays too little to be worth painting.
  { id: 'agronomy', cost: 150, from: 'town', factor: 1.6 },
  // Upkeep is what turns a growing city's ledger negative.
  { id: 'administration', cost: 240, from: 'city', factor: 0.72 },
  // By the metro era one road is carrying a district.
  { id: 'transit', cost: 320, from: 'city', factor: 1.5 },
];

export const TECH_ORDER: readonly TechId[] = TECHS.map((tech) => tech.id);

export function techById(id: string): Tech | undefined {
  return TECHS.find((tech) => tech.id === id);
}
