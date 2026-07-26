import { describe, expect, it } from 'vitest';
import {
  HIGHWAY_HEAL_PER_S,
  HIGHWAY_REPAIR_BASE,
  HIGHWAY_SECTION_TILES,
  HIGHWAY_WEAR_BILL,
  HIGHWAY_WEAR_PER_S,
  STARTING_MONEY,
} from '../src/data/balance';
import { SECONDS_PER_YEAR, START_YEAR } from '../src/data/timeline';
import { computeConnectivity, hasConnection } from '../src/sim/connectivity';
import { highwayInterchanges, isNationalHighway, transitIncome } from '../src/sim/highway';
import {
  billedSections,
  blockedSections,
  ensureSections,
  isHighwayBlocked,
  readSections,
  refreshHighwayDamage,
  repairCost,
  repairHighway,
  sectionCount,
  stepHighwayWear,
} from '../src/sim/highwayWear';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { computeTimelineEffects } from '../src/sim/timeline';
import { claimParcel, index, parcelOfTile, parcelSide } from '../src/sim/world';

/**
 * The war on the road (savaş ve yol bakımı).
 *
 * The motorway is the city's one link to the rest of the country, so damaging
 * it is the sharpest thing the century can do short of an earthquake. These
 * pin the whole bargain: only the city's own stretch wears, wear stops at the
 * invoice line without a war behind it, an unpaid stretch shuts, a shut stretch
 * takes the country away with it, and paying puts everything back.
 */

function freshGame(): GameState {
  return createGameState(hashSeed('road-wear'), 0);
}

/** Marks every parcel the route crosses as the player's, so it all wears. */
function ownWholeRoute(game: GameState): void {
  for (const point of game.world.highwayRoute) {
    const { px, py } = parcelOfTile(point.x, point.y);
    claimParcel(game.world, px, py);
  }
}

function atWar(game: GameState): void {
  // 1915: the Great War and Çanakkale both run, which is as warlike as the
  // calendar gets.
  game.timelineEffects = computeTimelineEffects(1915);
}

function atPeace(game: GameState): void {
  game.timelineEffects = computeTimelineEffects(1960);
}

/** Runs the wear system for `seconds` in one-second steps. */
function live(game: GameState, seconds: number): number {
  let events = 0;
  for (let i = 0; i < seconds; i++) events += stepHighwayWear(game, 1).length;
  return events;
}

/** Draws a player street touching the motorway, and says where. */
function connectCity(game: GameState): { x: number; y: number } {
  for (const point of game.world.highwayRoute) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const a = { x: point.x + dx, y: point.y + dy };
      const b = { x: point.x + 2 * dx, y: point.y + 2 * dy };
      if (isNationalHighway(game.world, a.x, a.y)) continue;
      if (isNationalHighway(game.world, b.x, b.y)) continue;
      const result = buildRoad(game.world, [b, a], 'path', STARTING_MONEY);
      if (result.changes.length > 0) return point;
    }
  }
  throw new Error('could not connect the city to the motorway');
}

describe('highway sections', () => {
  it('splits the route into stretches that cover it exactly once', () => {
    const game = freshGame();
    const route = game.world.highwayRoute;
    expect(route.length).toBeGreaterThan(HIGHWAY_SECTION_TILES);
    expect(sectionCount(game.world)).toBe(Math.ceil(route.length / HIGHWAY_SECTION_TILES));

    const sections = readSections(game);
    const covered = sections.reduce((sum, s) => sum + s.tiles, 0);
    expect(covered).toBe(route.length);
    expect(game.highwayWear).toHaveLength(sections.length);
  });

  it('sizes the wear array to the route without inventing wear', () => {
    const game = freshGame();
    game.highwayWear = [0.9];
    ensureSections(game);
    expect(game.highwayWear).toHaveLength(sectionCount(game.world));
    expect(game.highwayWear[0]).toBe(0.9);
    expect(game.highwayWear[1]).toBe(0);
  });
});

describe('wear in wartime', () => {
  it('leaves the road alone in peacetime', () => {
    const game = freshGame();
    ownWholeRoute(game);
    atPeace(game);
    live(game, 120);
    expect(Math.max(...game.highwayWear)).toBe(0);
  });

  it('wears the stretches the city owns, and only those', () => {
    const game = freshGame();
    atWar(game);
    live(game, 60);

    const sections = readSections(game);
    const owned = sections.filter((s) => s.owned);
    const foreign = sections.filter((s) => !s.owned);
    // A fresh city owns one parcel, so the route crosses both kinds.
    expect(owned.length).toBeGreaterThan(0);
    expect(foreign.length).toBeGreaterThan(0);
    for (const section of owned) expect(section.wear).toBeGreaterThan(0);
    for (const section of foreign) expect(section.wear).toBe(0);
  });

  it('wears an untouched stretch from new to shut over its stated span', () => {
    const game = freshGame();
    ownWholeRoute(game);
    atWar(game);
    // No player roads anywhere, so no interchange weighting: the plain rate.
    live(game, Math.ceil(1 / HIGHWAY_WEAR_PER_S));
    expect(blockedSections(game)).toBe(readSections(game).filter((s) => s.owned).length);
  });

  it('wears a stretch the city plugs into faster than one it merely passes', () => {
    const game = freshGame();
    ownWholeRoute(game);
    const junction = connectCity(game);
    atWar(game);
    live(game, 60);

    const sections = readSections(game);
    const busy = sections.find((s) => s.interchanges > 0);
    const quiet = sections.find((s) => s.interchanges === 0 && s.owned);
    expect(busy).toBeDefined();
    expect(quiet).toBeDefined();
    expect(busy?.wear).toBeGreaterThan(quiet?.wear ?? 1);
    // The junction really is on the route the test thinks it is.
    expect(isNationalHighway(game.world, junction.x, junction.y)).toBe(true);
  });

  it('announces the bill once, then the barricade once', () => {
    const game = freshGame();
    ownWholeRoute(game);
    atWar(game);

    const kinds: string[] = [];
    for (let i = 0; i < 260; i++) {
      for (const event of stepHighwayWear(game, 1)) kinds.push(event.kind);
    }
    expect(kinds.filter((k) => k === 'damaged')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'blocked')).toHaveLength(1);
    expect(kinds.indexOf('damaged')).toBeLessThan(kinds.indexOf('blocked'));
  });
});

describe('repair in peacetime', () => {
  it('patches potholes on its own, but not once it has sent a bill', () => {
    const game = freshGame();
    ensureSections(game);
    atPeace(game);

    game.highwayWear[0] = HIGHWAY_WEAR_BILL - 0.05;
    game.highwayWear[1] = HIGHWAY_WEAR_BILL + 0.05;
    // Both stretches have to be the city's, or neither is touched at all.
    ownWholeRoute(game);

    const before = [...game.highwayWear];
    live(game, 60);
    const cheapHealed = (before[0] as number) - (game.highwayWear[0] as number);
    const billedHealed = (before[1] as number) - (game.highwayWear[1] as number);
    expect(cheapHealed).toBeCloseTo(HIGHWAY_HEAL_PER_S * 60, 5);
    expect(billedHealed).toBeGreaterThan(0);
    expect(billedHealed).toBeLessThan(cheapHealed);
  });

  it('reopens a barricade eventually, so a broke city is never locked out', () => {
    const game = freshGame();
    ownWholeRoute(game);
    ensureSections(game);
    atPeace(game);
    game.highwayWear.fill(1);
    refreshHighwayDamage(game);
    expect(blockedSections(game)).toBeGreaterThan(0);

    const kinds: string[] = [];
    for (let i = 0; i < 3600; i++) {
      for (const event of stepHighwayWear(game, 1)) kinds.push(event.kind);
    }
    expect(kinds).toContain('reopened');
    expect(blockedSections(game)).toBe(0);
  });
});

describe('the bill', () => {
  it('asks for nothing until a stretch crosses the line', () => {
    const game = freshGame();
    ensureSections(game);
    game.highwayWear[0] = HIGHWAY_WEAR_BILL - 0.01;
    expect(billedSections(game)).toBe(0);
    expect(repairCost(game)).toBe(0);
    expect(repairHighway(game)).toBe(false);
  });

  it('grows with the city', () => {
    const game = freshGame();
    ensureSections(game);
    game.highwayWear[0] = 1;

    game.population = 0;
    const village = repairCost(game);
    game.population = 20_000;
    const metropolis = repairCost(game);

    expect(village).toBe(HIGHWAY_REPAIR_BASE);
    expect(metropolis).toBeGreaterThan(village * 4);
    // Square root, not linear: a city a hundred times the size pays nothing
    // like a hundred times the bill.
    expect(metropolis).toBeLessThan(village * 30);
  });

  it('is refused when the city cannot cover it, and takes nothing', () => {
    const game = freshGame();
    ensureSections(game);
    game.highwayWear[0] = 1;
    refreshHighwayDamage(game);
    game.money = repairCost(game) - 1;

    const before = game.money;
    expect(repairHighway(game)).toBe(false);
    expect(game.money).toBe(before);
    expect(blockedSections(game)).toBe(1);
  });

  it('clears every billed stretch when it is paid', () => {
    const game = freshGame();
    ensureSections(game);
    game.highwayWear[0] = 1;
    game.highwayWear[1] = HIGHWAY_WEAR_BILL + 0.1;
    game.highwayWear[2] = 0.2;
    refreshHighwayDamage(game);

    const cost = repairCost(game);
    game.money = cost;
    expect(repairHighway(game)).toBe(true);
    expect(game.money).toBe(0);
    expect(game.highwayWear[0]).toBe(0);
    expect(game.highwayWear[1]).toBe(0);
    // A stretch the state never billed for is not repaired at the city's cost.
    expect(game.highwayWear[2]).toBe(0.2);
    expect(blockedSections(game)).toBe(0);
  });
});

describe('what a barricade costs the city', () => {
  it('takes the country away with it', () => {
    const game = freshGame();
    const junction = connectCity(game);
    computeConnectivity(game.world);
    expect(hasConnection(game.world)).toBe(true);
    expect(highwayInterchanges(game.world)).toBeGreaterThan(0);
    game.population = 400;
    expect(transitIncome(game)).toBeGreaterThan(0);

    // Shut every stretch. The city's street is still there; it now leads
    // nowhere, which is the entire punishment.
    ensureSections(game);
    game.highwayWear.fill(1);
    refreshHighwayDamage(game);
    computeConnectivity(game.world);

    expect(isHighwayBlocked(game.world, junction.x, junction.y)).toBe(true);
    expect(hasConnection(game.world)).toBe(false);
    expect(highwayInterchanges(game.world)).toBe(0);
    expect(transitIncome(game)).toBe(0);
  });

  it('marks only the motorway, never the player’s own pavement', () => {
    const game = freshGame();
    connectCity(game);
    ensureSections(game);
    game.highwayWear.fill(1);
    refreshHighwayDamage(game);

    for (let i = 0; i < game.world.highwayBlocked.length; i++) {
      if ((game.world.highwayBlocked[i] ?? 0) === 0) continue;
      expect(game.world.highway[i]).toBe(1);
    }
  });
});

describe('wear across a save', () => {
  it('survives a reload, so closing the tab is not free road repair', () => {
    const game = freshGame();
    ownWholeRoute(game);
    game.playedMs = (1915 - START_YEAR) * SECONDS_PER_YEAR * 1000;
    atWar(game);
    live(game, 150);
    const wear = [...game.highwayWear];
    expect(Math.max(...wear)).toBeGreaterThan(0);

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    expect(loaded).not.toBeNull();
    const after = loaded as GameState;
    expect(after.highwayWear).toHaveLength(wear.length);
    for (let i = 0; i < wear.length; i++) {
      // Stored as whole percent, so half a point of drift is the contract.
      expect(after.highwayWear[i] as number).toBeCloseTo(wear[i] as number, 2);
    }
  });

  it('reloads a barricade as a barricade', () => {
    const game = freshGame();
    connectCity(game);
    ensureSections(game);
    game.highwayWear.fill(1);
    refreshHighwayDamage(game);

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    computeConnectivity(loaded.world);
    expect(blockedSections(loaded)).toBe(sectionCount(loaded.world));
    expect(hasConnection(loaded.world)).toBe(false);
  });

  it('opens a save that predates road wear on a road in good repair', () => {
    const game = freshGame();
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['highwayWear'];

    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.highwayWear).toHaveLength(sectionCount(loaded.world));
    expect(Math.max(...loaded.highwayWear)).toBe(0);
    computeConnectivity(loaded.world);
    expect(loaded.world.highwayBlocked.some((v) => v === 1)).toBe(false);
  });
});

describe('the map the player reads', () => {
  it('darkens exactly the stretch that is worn', () => {
    const game = freshGame();
    ensureSections(game);
    game.highwayWear[0] = 0.5;
    refreshHighwayDamage(game);

    const route = game.world.highwayRoute;
    const first = route[0] as { x: number; y: number };
    const later = route[HIGHWAY_SECTION_TILES] as { x: number; y: number };
    expect(game.world.highwayDamage[index(game.world, first.x, first.y)]).toBe(128);
    expect(game.world.highwayDamage[index(game.world, later.x, later.y)]).toBe(0);
  });

  it('never wears a map with no motorway on it', () => {
    const game = freshGame();
    game.world.highwayRoute = [];
    game.highwayWear = [];
    atWar(game);
    expect(stepHighwayWear(game, 60)).toEqual([]);
    expect(sectionCount(game.world)).toBe(0);
  });

  it('starts wearing a stretch the moment the player buys the land under it', () => {
    const game = freshGame();
    atWar(game);
    live(game, 30);
    const before = readSections(game);
    const foreign = before.find((s) => !s.owned);
    expect(foreign).toBeDefined();
    expect(foreign?.wear).toBe(0);

    const side = parcelSide(game.world);
    for (let py = 0; py < side; py++) {
      for (let px = 0; px < side; px++) claimParcel(game.world, px, py);
    }
    live(game, 30);
    expect(readSections(game)[foreign?.index ?? 0]?.wear).toBeGreaterThan(0);
  });
});
