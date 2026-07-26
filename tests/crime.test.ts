import { describe, expect, it } from 'vitest';
import {
  CRIME_ARREST_S,
  CRIME_CAR_SPEED,
  CRIME_COVERED_MULT,
  CRIME_ESCAPE_MEMORY_S,
  CRIME_ESCAPE_S,
  CRIME_NIGHT_MULT,
  CRIME_PER_SEC,
} from '../src/data/balance';
import { SECONDS_PER_DAY } from '../src/data/balance';
import { SECONDS_PER_YEAR } from '../src/data/timeline';
import type { Level } from '../src/data/buildings';
import type { Building } from '../src/sim/buildings';
import {
  awaitingPlayer,
  carArrived,
  crimeHappiness,
  crimeNear,
  dispatchPolice,
  lootOf,
  stepCrime,
  TAP_RADIUS,
  type CrimeEvent,
} from '../src/sim/crime';
import { buyInvestment } from '../src/sim/investments';
import { buildRoad } from '../src/sim/roads';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE, SERVICE } from '../src/sim/tiles';
import { index } from '../src/sim/world';

/**
 * Crime, and the finger that answers it (§13b).
 *
 * The three cases the design rests on, and each has a test below:
 *
 * - a covered street sends a car by itself,
 * - an uncovered street waits for the player's tap,
 * - a city with no karakol can only watch it happen.
 *
 * Get the second one wrong and the feature is a notification. Get the first one
 * wrong and a big city is an endless tapping chore.
 */

/** An rng that plays a script, then settles to a harmless high value. */
function scripted(values: number[], fallback = 0.99): () => number {
  let cursor = 0;
  return () => (cursor < values.length ? (values[cursor++] as number) : fallback);
}

/** Never rolls a crime. For stepping a city forward without new incidents. */
const calm = (): number => 0.99;

function addBuilding(
  game: GameState,
  x: number,
  y: number,
  zone: 'res' | 'com' | 'ind',
  level: Level = 1,
): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone,
    level,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: zone === 'res' ? 6 : 0,
    jobs: zone === 'res' ? 0 : 4,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  return building;
}

/** Noon of an ordinary day: no holiday, and the night multiplier is off. */
const NOON_MS = 0.46 * SECONDS_PER_YEAR * 1000;

function freshGame(era: GameState['era'] = 'village'): GameState {
  const game = createGameState(hashSeed('crime'), 0);
  game.era = era;
  game.playedMs = NOON_MS;
  game.happiness = 100; // isolate the roll from the misery multiplier
  return game;
}

/** The motorway is a road, and a road is a route: take it out of the fixtures. */
function stripHighway(game: GameState): void {
  const { highway, road } = game.world;
  for (let i = 0; i < road.length; i++) {
    if ((highway[i] ?? 0) === 1) road[i] = NONE;
  }
}

/** A street from the station's door to the target's, and both buildings on it. */
function streetWithStation(game: GameState): Building {
  stripHighway(game);
  const lane: { x: number; y: number }[] = [];
  for (let x = 148; x <= 158; x++) lane.push({ x, y: 148 });
  buildRoad(game.world, lane, 'path', 100_000);
  const shop = addBuilding(game, 158, 149, 'com');
  game.services.set(1, { id: 1, kind: 'police', x: 148, y: 149 });
  return shop;
}

function kinds(events: readonly CrimeEvent[]): string[] {
  return events.map((event) => event.kind);
}

describe('when a crime starts', () => {
  it('does not happen in a founding settlement', () => {
    const game = freshGame('founding');
    addBuilding(game, 150, 150, 'res');
    // Rolling a zero would start one at any era that allows them at all.
    stepCrime(game, 1, scripted([0]));
    expect(game.crimes.size).toBe(0);
  });

  it('starts on a building once the village is standing', () => {
    const game = freshGame();
    const home = addBuilding(game, 150, 150, 'res');
    const events = stepCrime(game, 1, scripted([0]));
    expect(kinds(events)).toEqual(['crimeStart']);
    const crime = [...game.crimes.values()][0]!;
    expect(crime.buildingId).toBe(home.id);
    expect(crime.x).toBe(150);
    expect(crime.y).toBe(150);
  });

  it('never puts two on the same building at once', () => {
    const game = freshGame();
    addBuilding(game, 150, 150, 'res');
    stepCrime(game, 1, scripted([0]));
    stepCrime(game, 1, scripted([0]));
    expect(game.crimes.size).toBe(1);
  });

  it('leaves the building alone when the roll misses', () => {
    const game = freshGame();
    addBuilding(game, 150, 150, 'res');
    stepCrime(game, 1, scripted([0.5]));
    expect(game.crimes.size).toBe(0);
  });

  it('watches a covered street more closely than an uncovered one', () => {
    // The whole return on a karakol, expressed as a threshold: a roll that lands
    // between the covered and uncovered chance starts a crime on the unwatched
    // street and not on the watched one.
    const game = freshGame();
    addBuilding(game, 150, 150, 'res');
    const uncovered = CRIME_PER_SEC;
    const between = uncovered * CRIME_COVERED_MULT * 1.5;
    expect(between).toBeLessThan(uncovered);

    stepCrime(game, 1, scripted([between]));
    expect(game.crimes.size).toBe(1);

    const watched = freshGame();
    addBuilding(watched, 150, 150, 'res');
    watched.world.serviceMask[index(watched.world, 150, 150)] = SERVICE.police;
    stepCrime(watched, 1, scripted([between]));
    expect(watched.crimes.size).toBe(0);
  });

  it('robs a shop sooner than a house', () => {
    // Same roll, same everything else: the till is the difference.
    const between = CRIME_PER_SEC * 1.5;
    const house = freshGame();
    addBuilding(house, 150, 150, 'res');
    stepCrime(house, 1, scripted([between]));
    expect(house.crimes.size).toBe(0);

    const shop = freshGame();
    addBuilding(shop, 150, 150, 'com');
    stepCrime(shop, 1, scripted([between]));
    expect(shop.crimes.size).toBe(1);
  });
});

describe('crime after dark', () => {
  /** Midnight of the same ordinary day. */
  const midnight = (game: GameState): void => {
    game.playedMs = NOON_MS + SECONDS_PER_DAY * 500;
  };

  it('is likelier at night than at noon', () => {
    const between = CRIME_PER_SEC * (1 + (CRIME_NIGHT_MULT - 1) * 0.5);
    const day = freshGame();
    addBuilding(day, 150, 150, 'res');
    stepCrime(day, 1, scripted([between]));
    expect(day.crimes.size).toBe(0);

    const night = freshGame();
    addBuilding(night, 150, 150, 'res');
    midnight(night);
    stepCrime(night, 1, scripted([between]));
    expect(night.crimes.size).toBe(1);
  });

  it('is pushed back towards the daytime figure by street lighting', () => {
    // The third thing the lighting programme buys, and the reason it is the
    // flagship purchase: the lamps make the night quieter, not just brighter.
    const lit = freshGame('metropolis');
    lit.money = 5_000_000;
    for (let n = 0; n < 4; n++) buyInvestment(lit, 'lighting');
    addBuilding(lit, 150, 150, 'res');
    midnight(lit);

    const dark = freshGame('metropolis');
    addBuilding(dark, 150, 150, 'res');
    midnight(dark);

    // A roll that a dark midnight lets through and a lit one does not.
    const between = CRIME_PER_SEC * (1 + (CRIME_NIGHT_MULT - 1) * 0.5);
    stepCrime(dark, 1, scripted([between]));
    stepCrime(lit, 1, scripted([between]));
    expect(dark.crimes.size).toBe(1);
    expect(lit.crimes.size).toBe(0);
  });
});

describe('a covered street answers itself', () => {
  it('sends a car without being asked', () => {
    const game = freshGame();
    const shop = streetWithStation(game);
    game.world.serviceMask[index(game.world, shop.x, shop.y)] = SERVICE.police;

    stepCrime(game, 0.1, scripted([0]));
    const crime = [...game.crimes.values()][0]!;
    expect(crime.automatic).toBe(true);
    expect(crime.car).not.toBeNull();
    expect(awaitingPlayer(crime)).toBe(false);
    // Station door to shop door along the lane.
    expect(crime.car!.path[0]).toEqual({ x: 148, y: 148 });
    expect(crime.car!.path.at(-1)).toEqual({ x: 157, y: 148 });
  });

  it('drives over, makes the arrest, and clears the marker', () => {
    const game = freshGame();
    const shop = streetWithStation(game);
    game.world.serviceMask[index(game.world, shop.x, shop.y)] = SERVICE.police;
    stepCrime(game, 0.1, scripted([0]));
    const crime = [...game.crimes.values()][0]!;
    const travel = (crime.car!.path.length - 1) / CRIME_CAR_SPEED;

    // Mid-run: still coming, and not yet "at work".
    expect(carArrived(crime)).toBe(false);

    const events: CrimeEvent[] = [];
    for (let s = 0; s < Math.ceil(travel + CRIME_ARREST_S) + 2; s++) {
      events.push(...stepCrime(game, 1, calm));
    }
    expect(kinds(events)).toContain('crimeSolved');
    expect(game.crimes.size).toBe(0);
    // The building is untouched — a crime is not a fire.
    expect(game.buildings.has(shop.id)).toBe(true);
  });

  it('is not beaten by the escape clock while the car is on the road', () => {
    // A long drive must not be a guaranteed loss, or dispatching would be
    // pointless on any map bigger than a few streets.
    const game = freshGame();
    const shop = streetWithStation(game);
    game.world.serviceMask[index(game.world, shop.x, shop.y)] = SERVICE.police;
    stepCrime(game, 0.1, scripted([0]));
    const crime = [...game.crimes.values()][0]!;
    // Freeze the car just short of arrival and run well past the escape timer.
    const events: CrimeEvent[] = [];
    for (let s = 0; s < CRIME_ESCAPE_S + 10; s++) {
      crime.car!.progress = 0;
      events.push(...stepCrime(game, 1, calm));
    }
    expect(kinds(events)).not.toContain('crimeEscaped');
    expect(game.crimes.size).toBe(1);
  });
});

describe('an uncovered street waits for the player', () => {
  it('starts with nobody coming', () => {
    const game = freshGame();
    streetWithStation(game); // station exists, but its radius is not painted here
    stepCrime(game, 0.1, scripted([0]));
    const crime = [...game.crimes.values()][0]!;
    expect(crime.automatic).toBe(false);
    expect(awaitingPlayer(crime)).toBe(true);
  });

  it('sends a car when the player taps it', () => {
    const game = freshGame();
    const shop = streetWithStation(game);
    stepCrime(game, 0.1, scripted([0]));
    expect(dispatchPolice(game, shop.x, shop.y)).toBe('sent');
    const crime = [...game.crimes.values()][0]!;
    expect(crime.car).not.toBeNull();
    // Tapped, not automatic — the distinction the renderer and the feed read.
    expect(crime.automatic).toBe(false);
  });

  it('takes a tap that landed near the marker rather than exactly on it', () => {
    // The marker floats above the building and a finger lands where it looks.
    const game = freshGame();
    const shop = streetWithStation(game);
    stepCrime(game, 0.1, scripted([0]));
    expect(crimeNear(game, shop.x + TAP_RADIUS, shop.y)).not.toBeNull();
    expect(crimeNear(game, shop.x + TAP_RADIUS + 1, shop.y)).toBeNull();
  });

  it('says so rather than doing nothing when there is no karakol', () => {
    const game = freshGame();
    stripHighway(game);
    const shop = addBuilding(game, 150, 150, 'com');
    stepCrime(game, 0.1, scripted([0]));
    expect(dispatchPolice(game, shop.x, shop.y)).toBe('noStation');
    expect([...game.crimes.values()][0]!.car).toBeNull();
  });

  it('does not offer a crime that already has a car coming', () => {
    // A second tap on the same spot must not send a second car, and must not be
    // treated as a hit either: with nothing unanswered nearby the tap belongs to
    // whatever is under it, which is how tapping through a cluster works.
    const game = freshGame();
    const shop = streetWithStation(game);
    stepCrime(game, 0.1, scripted([0]));
    expect(dispatchPolice(game, shop.x, shop.y)).toBe('sent');
    expect(crimeNear(game, shop.x, shop.y)).toBeNull();
    expect(dispatchPolice(game, shop.x, shop.y)).toBe('noCrime');
    expect(game.crimes.size).toBe(1);
  });

  it('reports an empty tile as nothing there', () => {
    const game = freshGame();
    streetWithStation(game);
    expect(dispatchPolice(game, 10, 10)).toBe('noCrime');
  });

  it('falls through to the crime behind an answered one', () => {
    // Two markers close together: the second tap must reach the second crime
    // rather than re-reporting the one already handled.
    const game = freshGame();
    stripHighway(game);
    const a = addBuilding(game, 150, 150, 'com');
    const b = addBuilding(game, 151, 150, 'com');
    game.services.set(1, { id: 1, kind: 'police', x: 148, y: 149 });
    const lane: { x: number; y: number }[] = [];
    for (let x = 148; x <= 152; x++) lane.push({ x, y: 149 });
    buildRoad(game.world, lane, 'path', 100_000);

    stepCrime(game, 0.1, scripted([0, 0]));
    expect(game.crimes.size).toBe(2);
    expect(dispatchPolice(game, a.x, a.y)).toBe('sent');
    const second = crimeNear(game, b.x, b.y);
    expect(second).not.toBeNull();
    expect(second!.buildingId).toBe(b.id);
  });
});

describe('a crime that gets away', () => {
  it('takes money out of the treasury', () => {
    const game = freshGame();
    stripHighway(game);
    const shop = addBuilding(game, 150, 150, 'com');
    stepCrime(game, 0.1, scripted([0]));
    const before = game.money;

    const events: CrimeEvent[] = [];
    for (let s = 0; s < CRIME_ESCAPE_S + 1; s++) events.push(...stepCrime(game, 1, calm));
    expect(kinds(events)).toContain('crimeEscaped');
    const escape = events.find((event) => event.kind === 'crimeEscaped');
    expect(escape?.loot).toBe(lootOf(shop));
    expect(game.money).toBe(before - lootOf(shop));
    expect(game.crimes.size).toBe(0);
  });

  it('is worth more from a bigger building', () => {
    const small = freshGame();
    const big = freshGame();
    expect(lootOf(addBuilding(big, 150, 150, 'com', 4))).toBeGreaterThan(
      lootOf(addBuilding(small, 150, 150, 'com', 1)),
    );
  });

  it('is remembered for a while after the marker goes', () => {
    const game = freshGame();
    stripHighway(game);
    addBuilding(game, 150, 150, 'com');
    stepCrime(game, 0.1, scripted([0]));
    for (let s = 0; s < CRIME_ESCAPE_S + 1; s++) stepCrime(game, 1, calm);
    expect(game.crimes.size).toBe(0);
    // The mood is still down even though nothing is on the map.
    expect(crimeHappiness(game)).toBeLessThan(0);
    expect(game.crimeSting).toBeGreaterThan(0);

    for (let s = 0; s < CRIME_ESCAPE_MEMORY_S + 1; s++) stepCrime(game, 1, calm);
    expect(game.crimeSting).toBe(0);
    expect(crimeHappiness(game)).toBe(0);
  });

  it('cannot be robbed of a building that is no longer there', () => {
    const game = freshGame();
    stripHighway(game);
    const shop = addBuilding(game, 150, 150, 'com');
    stepCrime(game, 0.1, scripted([0]));
    game.buildings.delete(shop.id);
    const before = game.money;
    for (let s = 0; s < CRIME_ESCAPE_S + 1; s++) stepCrime(game, 1, calm);
    expect(game.crimes.size).toBe(0);
    expect(game.money).toBe(before);
  });
});

describe('what crime does to the mood', () => {
  it('costs nothing in a city with none', () => {
    expect(crimeHappiness(freshGame())).toBe(0);
  });

  it('counts the unanswered ones and not the answered ones', () => {
    const game = freshGame();
    const shop = streetWithStation(game);
    stepCrime(game, 0.1, scripted([0]));
    const waiting = crimeHappiness(game);
    expect(waiting).toBeLessThan(0);

    dispatchPolice(game, shop.x, shop.y);
    // A car on its way is the city working, not the city failing.
    expect(crimeHappiness(game)).toBe(0);
  });

  it('is capped, so a bad night stays on the same scale as everything else', () => {
    const game = freshGame();
    stripHighway(game);
    for (let n = 0; n < 40; n++) addBuilding(game, 150 + n, 150, 'com');
    stepCrime(game, 1, () => 0);
    expect(game.crimes.size).toBe(40);
    expect(crimeHappiness(game)).toBeGreaterThan(-30);
  });
});

describe('what the events tell the announcer', () => {
  /**
   * The feed holds four lines for nine seconds. A well-covered metropolis makes
   * about seventeen crime events a minute, so the announcer has to be able to
   * throw most of them away — and the only thing that lets it is the `automatic`
   * flag on every event. If that flag stops being set, the blotter fills with
   * arrests the player never asked for and nothing else in the game gets a line.
   */
  it('flags a start the karakol answered by itself', () => {
    const game = freshGame();
    const shop = streetWithStation(game);
    game.world.serviceMask[index(game.world, shop.x, shop.y)] = SERVICE.police;
    const events = stepCrime(game, 0.1, scripted([0]));
    expect(events[0]?.kind).toBe('crimeStart');
    expect(events[0]?.automatic).toBe(true);
  });

  it('flags a start that is waiting for the player', () => {
    const game = freshGame();
    streetWithStation(game);
    const events = stepCrime(game, 0.1, scripted([0]));
    expect(events[0]?.automatic).toBe(false);
  });

  it('carries the flag through to the arrest', () => {
    const game = freshGame();
    const shop = streetWithStation(game);
    stepCrime(game, 0.1, scripted([0]));
    dispatchPolice(game, shop.x, shop.y);
    const events: CrimeEvent[] = [];
    for (let s = 0; s < 20; s++) events.push(...stepCrime(game, 1, calm));
    const solved = events.find((event) => event.kind === 'crimeSolved');
    // The player sent this car, so the arrest is theirs to be told about.
    expect(solved?.automatic).toBe(false);
  });

  it('reports the loot so the line can name a figure', () => {
    const game = freshGame();
    stripHighway(game);
    const shop = addBuilding(game, 150, 150, 'com');
    stepCrime(game, 0.1, scripted([0]));
    const events: CrimeEvent[] = [];
    for (let s = 0; s < CRIME_ESCAPE_S + 1; s++) events.push(...stepCrime(game, 1, calm));
    expect(events.find((event) => event.kind === 'crimeEscaped')?.loot).toBe(lootOf(shop));
  });
});

describe('crime across a save', () => {
  it('is not saved, because a marker asking for a tap cannot survive a reload', () => {
    const game = freshGame();
    stripHighway(game);
    addBuilding(game, 150, 150, 'com');
    stepCrime(game, 0.1, scripted([0]));
    expect(game.crimes.size).toBe(1);

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.crimes.size).toBe(0);
    expect(loaded.crimeSting).toBe(0);
  });
});
