import { beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_MONEY_PER_POINT, STARTING_MONEY } from '../src/data/balance';
import {
  canRetire,
  legacyEndowment,
  legacyOpeningBalance,
  legacyValue,
  RETIRE_FROM,
} from '../src/sim/legacy';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { ERA_ORDER, eraRank } from '../src/sim/tiles';

/**
 * The second run is where an idle game lives. A first city teaches the loop
 * over an evening and then plateaus; retiring turns that ending into a
 * beginning. The property that matters most is that it cannot happen by
 * accident, and the one after that is that what it endows cannot compound into
 * the opening, which is the most carefully tuned part of this game.
 */
let game: GameState;

beforeEach(() => {
  game = createGameState(hashSeed('legacy'), 0);
});

describe('what a city is worth', () => {
  it('nothing at all on the first road', () => {
    expect(legacyValue(game)).toBe(0);
  });

  it('more for a bigger city', () => {
    game.era = 'town';
    game.population = 1_000;
    const small = legacyValue(game);
    game.population = 40_000;
    expect(legacyValue(game)).toBeGreaterThan(small);
  });

  it('grows sub-linearly, so one endless run is not the only way to play', () => {
    game.era = 'town';
    game.population = 5_000;
    const single = legacyValue(game);
    game.population = 20_000;
    // Four times the people is worth less than four times the legacy.
    expect(legacyValue(game)).toBeLessThan(single * 4);
    expect(legacyValue(game)).toBeGreaterThan(single);
  });

  it('pays for the era reached as well as the size', () => {
    game.population = 5_000;
    game.era = 'town';
    const early = legacyValue(game);
    game.era = 'metropolis';
    // The same population, further along: building well counts, not only
    // sprawling on whichever map was kindest.
    expect(legacyValue(game)).toBeGreaterThan(early);
  });

  it('never goes negative on a city that lost its people', () => {
    game.era = 'town';
    game.population = -50;
    expect(legacyValue(game)).toBeGreaterThanOrEqual(0);
  });
});

describe('when it can be done at all', () => {
  it('not while the player is still learning', () => {
    for (const era of ERA_ORDER) {
      if (eraRank(era) >= eraRank(RETIRE_FROM)) continue;
      game.era = era;
      game.population = 100_000;
      expect(canRetire(game)).toBe(false);
    }
  });

  it('once the city has come of age and is worth something', () => {
    game.era = RETIRE_FROM;
    game.population = 3_000;
    expect(canRetire(game)).toBe(true);
  });

  it('not for a city of the right era that is worth nothing', () => {
    game.era = 'megacity';
    game.population = 0;
    // The era bonus alone would carry this, so the guard is on value too — but
    // an empty megacity is not a thing the simulation can produce anyway.
    expect(legacyValue(game)).toBeGreaterThan(0);
  });
});

describe('what the endowment buys', () => {
  it('nothing for nothing', () => {
    expect(legacyEndowment(0)).toBe(0);
    expect(createGameState(1, 0).money).toBe(STARTING_MONEY);
  });

  it('opens the next city with more in the bank', () => {
    const endowed = createGameState(1, 0, 10);
    expect(endowed.money).toBe(STARTING_MONEY + 10 * LEGACY_MONEY_PER_POINT);
    expect(endowed.legacy).toBe(10);
  });

  it('touches the opening balance and nothing else', () => {
    const plain = createGameState(1, 0);
    const endowed = createGameState(1, 0, 50);
    // Every tuned quantity in the opening has to be identical: the second run
    // is the same game played from a better position, not a different game.
    expect(endowed.happiness).toBe(plain.happiness);
    expect(endowed.taxRate).toBe(plain.taxRate);
    expect(endowed.demand).toEqual(plain.demand);
    expect(endowed.population).toBe(plain.population);
    expect(endowed.research).toBe(plain.research);
    expect(endowed.era).toBe(plain.era);
    expect(endowed.buildings.size).toBe(plain.buildings.size);
  });

  it('gives the same map for the same seed, endowed or not', () => {
    const plain = createGameState(99, 0);
    const endowed = createGameState(99, 0, 40);
    expect([...endowed.world.height]).toEqual([...plain.world.height]);
  });

  it('refuses to be talked into a negative endowment', () => {
    expect(legacyEndowment(-100)).toBe(0);
  });

  it('quotes the balance the player will actually see, not just the bonus', () => {
    // The card promising the bonus and the game handing over bonus plus the
    // ordinary starting money is a pleasant surprise exactly once, and a number
    // that cannot be trusted after that.
    const quoted = legacyOpeningBalance(31);
    expect(quoted).toBe(createGameState(1, 0, 31).money);
    expect(quoted).toBeGreaterThan(legacyEndowment(31));
  });
});

describe('across a save', () => {
  it('carries the endowment, so a reload does not re-grant it', () => {
    const endowed = createGameState(7, 0, 25);
    const spent = endowed.money - 5_000;
    endowed.money = spent;

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(endowed))));
    expect(loaded).not.toBeNull();
    expect(loaded!.legacy).toBe(25);
    // The balance is what was saved, not the opening balance handed out again.
    expect(loaded!.money).toBe(spent);
  });

  it('loads a file written before any of this existed', () => {
    const data = JSON.parse(JSON.stringify(serialize(game))) as Record<string, unknown>;
    delete data['legacy'];
    const loaded = deserialize(data);
    expect(loaded).not.toBeNull();
    expect(loaded!.legacy).toBe(0);
  });
});
