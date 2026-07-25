import type { Era, RoadKind } from '../sim/tiles';

/**
 * Road table, §5.2 verbatim. Order matters: a later entry is a strict upgrade
 * of an earlier one, and drawing a higher tier over a lower one pays the
 * difference (§5.2).
 */
export interface RoadSpec {
  kind: RoadKind;
  /** Era that unlocks it; shown while still locked (§1: no hidden locks). */
  unlockedAt: Era;
  /** ₺ per tile, before slope and bridge multipliers. */
  cost: number;
  /** ₺ per minute of upkeep, per tile. */
  upkeep: number;
  /** Vehicles per minute. */
  capacity: number;
  speed: number;
  /** Width in tiles — the boulevard is a two-tile road with a median. */
  width: number;
  /** Carries water and power along its length (§9). */
  carriesUtilities: boolean;
  /** Buildings may not front onto it; junction access only. */
  junctionOnly: boolean;
  /** Added to land value on adjacent tiles. */
  landValueBonus: number;
  /** Added to noise on adjacent tiles. */
  noise: number;
  /** Runs underground: ignores terrain, unaffected by land value. */
  underground: boolean;
}

export const ROAD_SPECS: Readonly<Record<RoadKind, RoadSpec>> = {
  path: {
    kind: 'path',
    unlockedAt: 'founding',
    cost: 25,
    upkeep: 0.2,
    capacity: 20,
    speed: 1.0,
    width: 1,
    carriesUtilities: false,
    junctionOnly: false,
    landValueBonus: 0,
    noise: 0,
    underground: false,
  },
  stone: {
    kind: 'stone',
    unlockedAt: 'village',
    cost: 80,
    upkeep: 0.6,
    capacity: 55,
    speed: 1.4,
    width: 1,
    carriesUtilities: false,
    junctionOnly: false,
    landValueBonus: 0,
    noise: 0,
    underground: false,
  },
  asphalt: {
    kind: 'asphalt',
    unlockedAt: 'town',
    cost: 220,
    upkeep: 1.8,
    capacity: 130,
    speed: 2.0,
    width: 1,
    carriesUtilities: true,
    junctionOnly: false,
    landValueBonus: 0,
    noise: 0,
    underground: false,
  },
  boulevard: {
    kind: 'boulevard',
    unlockedAt: 'city',
    cost: 640,
    upkeep: 5,
    capacity: 320,
    speed: 2.4,
    width: 2,
    carriesUtilities: true,
    junctionOnly: false,
    landValueBonus: 8,
    noise: 0,
    underground: false,
  },
  highway: {
    kind: 'highway',
    unlockedAt: 'metro',
    cost: 1_900,
    upkeep: 16,
    capacity: 900,
    speed: 4.0,
    width: 1,
    carriesUtilities: false,
    junctionOnly: true,
    landValueBonus: 0,
    noise: 30,
    underground: false,
  },
  metro: {
    kind: 'metro',
    unlockedAt: 'metropolis',
    cost: 4_500,
    upkeep: 40,
    capacity: 2_400,
    speed: 5.0,
    width: 1,
    carriesUtilities: false,
    junctionOnly: true,
    landValueBonus: 0,
    noise: 0,
    underground: true,
  },
};

/** Tier order — index doubles as the upgrade ladder. */
export const ROAD_TIERS: readonly RoadKind[] = [
  'path',
  'stone',
  'asphalt',
  'boulevard',
  'highway',
  'metro',
];

const ERA_ORDER: readonly Era[] = [
  'founding',
  'village',
  'town',
  'city',
  'metro',
  'metropolis',
  'megacity',
];

export function tierOf(kind: RoadKind): number {
  return ROAD_TIERS.indexOf(kind);
}

export function isRoadUnlocked(kind: RoadKind, era: Era): boolean {
  return ERA_ORDER.indexOf(era) >= ERA_ORDER.indexOf(ROAD_SPECS[kind].unlockedAt);
}
