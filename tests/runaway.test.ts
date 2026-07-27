import { describe, expect, it } from 'vitest';
import {
  CRIME_ESCAPE_HAPPINESS,
  CRIME_HAPPINESS_CAP,
  FIRE_BURNOUT_S,
  FIRE_SPREAD_CHANCE,
  FIRE_SPREAD_S,
} from '../src/data/balance';
import { burialHappiness, burialTolerance } from '../src/sim/cohorts';
import { crimeHappiness } from '../src/sim/crime';
import { placeService } from '../src/sim/services';
import { migrationPerMinute } from '../src/sim/population';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { rubbishHappiness, rubbishStrain, rubbishTolerance, stepRubbish } from '../src/sim/rubbish';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE } from '../src/sim/tiles';
import { index, startingCentre } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * The loops that ran away, and the traps that could not be escaped.
 *
 * Every case here was found by playing a city for an hour rather than by reading
 * the code, and every one of them looked reasonable in isolation. They are kept
 * as tests because that is the only kind of bug this codebase has left: not a
 * wrong line, but a set of individually sensible rules that compound into a city
 * the player cannot save.
 *
 * The shared property is **recoverability**. A neglected city is supposed to be a
 * hard problem. It is never supposed to be a dead one.
 */

function flatten(game: GameState, radius: number): { x: number; y: number } {
  const world = game.world;
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);

  const centre = startingCentre(world);
  const cx = Math.floor(centre.x);
  const cy = Math.floor(centre.y);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(world, x, y);
      world.height[i] = 0.5;
      world.fertility[i] = 0.3;
      world.terrain[i] = 2;
    }
  }
  return { x: cx - 20, y: cy };
}

/** A few streets of housing, shops and workshops, and nothing else at all. */
function neglectedCity(seed: string): { game: GameState; systems: Systems } {
  const game = createGameState(hashSeed(seed), 0);
  const origin = flatten(game, 22);
  game.money = 5_000_000;
  const systems = new Systems(game.world.size);
  for (let k = 0; k < 5; k++) {
    const lane = Array.from({ length: 40 }, (_, i) => ({ x: origin.x + i, y: origin.y + k * 5 }));
    buildRoad(game.world, lane, 'asphalt', 1e9);
    paintZone(game.world, lane.map((t) => ({ ...t, y: t.y + 1 })), k % 3 === 0 ? 'com' : 'res', 1e9);
    paintZone(game.world, lane.map((t) => ({ ...t, y: t.y - 1 })), k % 4 === 0 ? 'ind' : 'res', 1e9);
  }
  systems.invalidateFields();
  return { game, systems };
}

function live(game: GameState, systems: Systems, seconds: number): void {
  for (let s = 0; s < seconds; s++) {
    // The frame loop owns the clock; systems.step does not. Without this every
    // calendar-reading system sits frozen and the run measures nothing.
    game.playedMs += 1000;
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
}

describe('fire does not become the weather', () => {
  it('spreads to fewer than one neighbour on average', () => {
    // The number that decides whether a fire is an incident or a climate. An
    // unfought fire lives FIRE_BURNOUT_S and rolls every FIRE_SPREAD_S, so it
    // gets that many attempts; above one child per fire, the first blaze in an
    // uncovered district never stops.
    //
    // Measured before this was a test: at the old 0.3 the reproduction number was
    // 1.8, and an hour in a city with no fire station left three hundred of four
    // hundred buildings permanently alight with the population pinned at zero.
    const rolls = Math.floor(FIRE_BURNOUT_S / FIRE_SPREAD_S);
    expect(rolls * FIRE_SPREAD_CHANCE).toBeLessThan(1);
  });

  it('leaves a brigade-less city with a handful of fires, not hundreds', () => {
    const { game, systems } = neglectedCity('runaway-fire');
    live(game, systems, 1_500);
    expect(game.buildings.size).toBeGreaterThan(50);
    // A district's worth at a time. Hundreds means the chain never breaks.
    expect(game.fires.size).toBeLessThan(30);
  });
});

describe('an exodus feeds on people, not on empty rooms', () => {
  it('does not go faster because the city is already empty', () => {
    // Reading the brief's arrivals formula in both directions made the emptiest
    // cities evacuate fastest — a loop that fed on what it produced.
    const crowded = migrationPerMinute(10, 0, 150);
    const hollow = migrationPerMinute(10, 5_000, 150);
    expect(hollow).toBe(crowded);
  });

  it('slows as the city shrinks, so a collapse bottoms out', () => {
    const big = migrationPerMinute(10, 0, 800);
    const small = migrationPerMinute(10, 0, 40);
    expect(small).toBeGreaterThan(big);
    expect(small).toBeLessThan(0);
  });

  it('still lets a content city fill its empty homes', () => {
    expect(migrationPerMinute(80, 400, 100)).toBeGreaterThan(0);
    // And nowhere to put anybody is nobody arriving, however happy they are.
    expect(migrationPerMinute(80, 0, 100)).toBe(0);
  });
});

describe('a backlog stays answerable', () => {
  it('caps the rubbish where its penalty already stops getting worse', () => {
    // Past saturation another crate is not modelling anything, and all it does is
    // put recovery beyond any session: measured at twenty-four thousand against a
    // tolerance of thirty, which no number of depots clears.
    const game = createGameState(hashSeed('runaway-bins'), 0);
    game.era = 'city';
    game.rubbish = 0;
    // A city that produces something, so the tolerance is not the floor.
    game.buildings.set(1, {
      id: 1,
      x: 150,
      y: 150,
      w: 1,
      h: 1,
      zone: 'com',
      level: 3,
      score: 0.8,
      growthProgress: 0,
      decayTimer: 0,
      population: 0,
      jobs: 200,
      output: 0,
      issues: 0,
      builtAt: 0,
      variantSeed: 7,
    });
    for (let m = 0; m < 400; m++) stepRubbish(game, 60);
    expect(rubbishStrain(game)).toBe(1);
    expect(game.rubbish).toBeLessThanOrEqual(rubbishTolerance(game) * 4 + 1);
  });

  it('caps the burials the same way', () => {
    const game = createGameState(hashSeed('runaway-graves'), 0);
    game.era = 'city';
    game.population = 40;
    game.cohorts.awaitingBurial = 100_000;
    // The tolerance shrinks with the city, so an uncapped backlog bites hardest
    // exactly on the city least able to clear it.
    expect(burialHappiness(game)).toBeLessThan(0);
    expect(burialTolerance(game)).toBeGreaterThan(0);
  });
});

describe('nothing is charged for before it can be answered', () => {
  it('asks a village nothing about its bins', () => {
    // A depot opens at town. A village putting its bins out has no answer to
    // offer, and marking it down for that teaches resentment rather than planning
    // — the same rule the lighting programme is held to.
    const game = createGameState(hashSeed('runaway-village'), 0);
    game.era = 'village';
    game.rubbish = 1_000_000;
    expect(rubbishStrain(game)).toBe(0);
    expect(rubbishHappiness(game)).toBe(0);

    game.era = 'town';
    expect(rubbishHappiness(game)).toBeLessThan(0);
  });

  it('asks a village nothing about its dead', () => {
    const game = createGameState(hashSeed('runaway-graves2'), 0);
    game.era = 'village';
    game.population = 200;
    game.cohorts.awaitingBurial = 100_000;
    expect(burialHappiness(game)).toBe(0);

    game.era = 'town';
    expect(burialHappiness(game)).toBeLessThan(0);
  });
});

/**
 * A grid rather than the parallel lanes above: crime needs cars to be able to
 * drive from a karakol to the scene, and lanes that never meet make every
 * dispatch fail for a reason the fixture invented rather than the game.
 */
function griddedCity(seed: string): { game: GameState; systems: Systems; origin: Origin } {
  const game = createGameState(hashSeed(seed), 0);
  const origin = flatten(game, 24);
  game.money = 5_000_000;
  const systems = new Systems(game.world.size);
  for (let k = 0; k < 6; k++) {
    const lane = Array.from({ length: 40 }, (_, i) => ({ x: origin.x + i, y: origin.y + k * 5 }));
    buildRoad(game.world, lane, 'asphalt', 1e9);
    paintZone(game.world, lane.map((t) => ({ ...t, y: t.y + 1 })), k % 3 === 0 ? 'com' : 'res', 1e9);
    paintZone(game.world, lane.map((t) => ({ ...t, y: t.y - 1 })), k % 4 === 0 ? 'ind' : 'res', 1e9);
  }
  for (let x = 0; x < 40; x += 6) {
    const cross = Array.from({ length: 26 }, (_, i) => ({ x: origin.x + x, y: origin.y + i }));
    buildRoad(game.world, cross, 'asphalt', 1e9);
  }
  systems.invalidateFields();
  return { game, systems, origin };
}

type Origin = { x: number; y: number };

/** Runs the city and totals what crime took out of it. */
function measureCrime(
  game: GameState,
  systems: Systems,
  seconds: number,
): { loot: number; started: number; net: number } {
  const before = game.money;
  let loot = 0;
  let started = 0;
  for (let s = 0; s < seconds; s++) {
    game.playedMs += 1000;
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
    for (const event of systems.drainCrimeEvents()) {
      if (event.kind === 'crimeStart') started++;
      if (event.kind === 'crimeEscaped') loot += event.loot ?? 0;
    }
  }
  const mins = seconds / 60;
  return { loot: loot / mins, started: started / mins, net: (game.money - before) / mins };
}

describe('crime is a bill the city can pay', () => {
  it('takes a slice of the income rather than more than all of it', () => {
    // The playtest report was "there is too much theft, I cannot get anywhere",
    // and the measurement agreed: an uncovered town of 273 buildings lost
    // 1 382₺ a minute to robberies against 625₺ of income — 221% of everything
    // it earned, so its balance only ever went down and the 5 400₺ karakol that
    // would have stopped it was permanently out of reach. That is the shape of
    // every bug in this file: a rule that is reasonable until it is measured.
    const { game, systems } = griddedCity('crime-drain');
    measureCrime(game, systems, 900);
    const m = measureCrime(game, systems, 600);
    const gross = m.net + m.loot;
    expect(gross).toBeGreaterThan(0);
    // Half is a ceiling, not a target — measured at 31% in a city with no
    // services of any kind, which is the worst case a player can construct.
    expect(m.loot).toBeLessThan(gross * 0.5);
    // And the city has to actually be accumulating money, or it cannot buy the
    // answer to its own problem.
    expect(m.net).toBeGreaterThan(0);
  }, 120_000);

  it('stays an errand rather than becoming a chore', () => {
    // A marker every ten seconds is not a mechanic the player performs, it is
    // a queue. Measured at 4.6/min before the retune, ~1.4/min after.
    const { game, systems } = griddedCity('crime-rate');
    measureCrime(game, systems, 900);
    const m = measureCrime(game, systems, 600);
    expect(game.buildings.size).toBeGreaterThan(150);
    expect(m.started).toBeLessThan(2.5);
  }, 120_000);

  it('pays the player back for building a karakol', () => {
    // The other half: cutting the rate is only correct if coverage still
    // visibly buys something. It has to be measured on the same city, because
    // the crime rate depends on the mood, which depends on everything.
    const { game, systems, origin } = griddedCity('crime-karakol');
    measureCrime(game, systems, 900);
    const before = measureCrime(game, systems, 900);
    for (const dx of [7, 25]) {
      placeService(game, systems.fields, 'police', origin.x + dx, origin.y + 23);
    }
    systems.invalidateFields();
    const after = measureCrime(game, systems, 900);
    expect(after.loot).toBeLessThan(before.loot);
  }, 180_000);

  it('cannot let crime alone own a fifth of the mood', () => {
    const game = createGameState(hashSeed('crime-mood'), 0);
    for (let i = 0; i < 200; i++) {
      game.crimes.set(i, { id: i, x: 10, y: 10, buildingId: i, age: 0, car: null, automatic: false });
    }
    game.crimeSting = 60;
    // Capped, and the cap is what bounds the loop between crime and misery:
    // crime lowers the mood, a low mood raises crime, and this is the number
    // that decides whether that is a slope or a spiral. Exact rather than a
    // bound, because a magic slack figure here would hide the cap moving.
    expect(crimeHappiness(game)).toBe(-(CRIME_HAPPINESS_CAP + CRIME_ESCAPE_HAPPINESS));
    // A fifth of the whole happiness scale is more than one hazard may own.
    expect(CRIME_HAPPINESS_CAP).toBeLessThan(20);
  });
});

describe('a neglected city is a hard problem, not a dead one', () => {
  it('comes back once the player answers', () => {
    // The property every fix in this file exists to protect, and the only one
    // that can be checked end to end. Twenty minutes of neglect, then the
    // stations that answer it — and the city has to actually return.
    const { game, systems } = neglectedCity('runaway-recovery');
    live(game, systems, 1_200);
    const bottom = { population: game.population, happiness: game.happiness };
    expect(bottom.happiness).toBeLessThan(30);

    let id = 1;
    for (const kind of ['fire', 'health', 'police', 'depot', 'cemetery'] as const) {
      for (let n = 0; n < 6; n++) {
        const centre = startingCentre(game.world);
        game.services.set(id, {
          id,
          kind,
          x: Math.floor(centre.x) - 16 + n * 6,
          y: Math.floor(centre.y) + (id % 3) * 6,
        });
        id++;
      }
    }
    game.taxRate = 0.05;
    systems.invalidateFields();
    live(game, systems, 2_400);

    expect(game.happiness).toBeGreaterThan(bottom.happiness + 20);
    expect(game.population).toBeGreaterThan(Math.max(200, bottom.population * 3));
  }, 180_000);
});
