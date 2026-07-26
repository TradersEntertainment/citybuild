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
 * Each one is attached to a system the player has already met and can already
 * feel going wrong — smoke, jams, upkeep, land prices, fires, robberies, the
 * grid. A tech for a system the player has no complaint about is a line of text.
 *
 * That rule is also what decides when a tech is *allowed* to exist. Every entry
 * below has exactly one consumer somewhere in sim/, reached through techFactor,
 * and the era it opens at is the era where the thing it fixes starts hurting.
 */
export type TechId =
  | 'sanitation'
  | 'transit'
  | 'codes'
  | 'registry'
  | 'administration'
  | 'agronomy'
  | 'fireproofing'
  | 'forensics'
  | 'medicine'
  | 'turbines'
  | 'hydrology'
  | 'coldChain'
  | 'hospitality';

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
  // The first fire arrives in a village, and it is the first thing that takes
  // something away rather than merely failing to give it.
  { id: 'fireproofing', cost: 90, from: 'village', factor: 0.6 },
  // Land runs out at about the same time this becomes affordable.
  { id: 'registry', cost: 120, from: 'town', factor: 0.75 },
  // By a town there is enough on the map to be worth robbing, and a karakol on
  // every street is dearer than learning to catch people (sim/crime.ts).
  { id: 'forensics', cost: 130, from: 'town', factor: 0.55 },
  // Farms are a whole zone that pays too little to be worth painting.
  { id: 'agronomy', cost: 150, from: 'town', factor: 1.6 },
  // An outbreak is the one hazard the player cannot answer with a tap; the only
  // lever is how hard it bites (sim/hazards.ts).
  { id: 'medicine', cost: 180, from: 'town', factor: 0.6 },
  // A fishing fleet's catch is the first thing the coast pays for, and it is
  // held back by what a boat can land before it spoils (sim/ports.ts).
  { id: 'coldChain', cost: 200, from: 'town', factor: 1.45 },
  // Upkeep is what turns a growing city's ledger negative.
  { id: 'administration', cost: 240, from: 'city', factor: 0.72 },
  // The city era is where the grid stops being a formality and starts being a
  // line in the ledger; a better turbine is cheaper than another station.
  { id: 'turbines', cost: 260, from: 'city', factor: 1.3 },
  // By the metro era one road is carrying a district.
  { id: 'transit', cost: 320, from: 'city', factor: 1.5 },
  // Waterworks are the dearest thing a city runs before the reactor.
  { id: 'hydrology', cost: 340, from: 'city', factor: 1.35 },
  // Passing traffic is money the city already has coming in; the question is
  // how much of it stops (sim/visitors.ts).
  { id: 'hospitality', cost: 420, from: 'metro', factor: 1.4 },
];

export const TECH_ORDER: readonly TechId[] = TECHS.map((tech) => tech.id);

export function techById(id: string): Tech | undefined {
  return TECHS.find((tech) => tech.id === id);
}
