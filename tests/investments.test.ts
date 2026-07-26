import { describe, expect, it } from 'vitest';
import { NIGHT_TRADE_LOSS } from '../src/data/balance';
import { PROGRAMME_ORDER, tiersOf, type ProgrammeId } from '../src/data/investments';
import { dayFraction, MEAN_NIGHT, nightAmount } from '../src/sim/daytime';
import { SECONDS_PER_YEAR, START_YEAR } from '../src/data/timeline';
import { computeLedger } from '../src/sim/economy';
import { createFields } from '../src/sim/fields';
import {
  buyInvestment,
  canBuyInvestment,
  DAY_TRADE_UPLIFT,
  festivalBoost,
  greeningAbsorption,
  investmentLevel,
  investmentUpkeep,
  lightingShare,
  nightHappiness,
  tradeByHour,
  tradeNow,
} from '../src/sim/investments';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';

/**
 * What a rich city buys, and what it buys back.
 *
 * Two complaints answered at once: nothing costs enough to matter past the first
 * hour, and the night — a third of every year — did nothing but be dark. The
 * money now buys the night.
 *
 * The load-bearing property is in the first block: an unlit city must earn
 * exactly what it earned before the night meant anything. Get that wrong and the
 * feature is a nerf wearing a shop front.
 */

function freshGame(): GameState {
  const game = createGameState(hashSeed('investments'), 0);
  game.era = 'metro';
  game.money = 5_000_000;
  return game;
}

describe('the night is not a nerf', () => {
  it('averages out to exactly what a day used to earn, unlit', () => {
    // The whole calibration. Sampled over a full day at lighting zero: the loss
    // after dark is paid back by the uplift in daylight, so the mean is 1.
    const samples = 2_000;
    let total = 0;
    for (let i = 0; i < samples; i++) {
      total += tradeByHour(nightAmount((i + 0.5) / samples), 0);
    }
    expect(total / samples).toBeCloseTo(1, 3);
  });

  it('derives the uplift from the day curve rather than a written-down number', () => {
    // If the length of the night ever changes, this has to follow it — which it
    // does only because MEAN_NIGHT is sampled from nightAmount itself.
    expect(DAY_TRADE_UPLIFT).toBeCloseTo(1 + NIGHT_TRADE_LOSS * MEAN_NIGHT, 9);
    expect(MEAN_NIGHT).toBeGreaterThan(0.2);
    expect(MEAN_NIGHT).toBeLessThan(0.45);
  });

  it('pays more by day than by night when the streets are dark', () => {
    const noon = tradeByHour(0, 0);
    const midnight = tradeByHour(1, 0);
    expect(noon).toBeGreaterThan(midnight);
    expect(midnight).toBeCloseTo(DAY_TRADE_UPLIFT - NIGHT_TRADE_LOSS, 9);
  });

  it('pays the same at every hour once the city is fully lit', () => {
    for (const night of [0, 0.3, 0.7, 1]) {
      expect(tradeByHour(night, 1)).toBeCloseTo(DAY_TRADE_UPLIFT, 9);
    }
  });

  it('lifts the daily average above one when lighting is paid for', () => {
    const samples = 2_000;
    let total = 0;
    for (let i = 0; i < samples; i++) {
      total += tradeByHour(nightAmount((i + 0.5) / samples), 1);
    }
    // A fully lit city trades through the night, so it earns more than a dark
    // one over a whole year — which is the return on the purchase.
    expect(total / samples).toBeGreaterThan(1.1);
  });

  it('clamps nonsense rather than propagating it', () => {
    expect(tradeByHour(-1, 0)).toBeCloseTo(DAY_TRADE_UPLIFT, 9);
    expect(tradeByHour(2, 0)).toBeCloseTo(DAY_TRADE_UPLIFT - NIGHT_TRADE_LOSS, 9);
    expect(tradeByHour(1, 5)).toBeCloseTo(DAY_TRADE_UPLIFT, 9);
  });
});

describe('buying a programme', () => {
  it('starts with nothing bought', () => {
    const game = freshGame();
    for (const id of PROGRAMME_ORDER) expect(investmentLevel(game, id)).toBe(0);
    expect(investmentUpkeep(game)).toBe(0);
    expect(lightingShare(game)).toBe(0);
  });

  it('takes the money and raises the level', () => {
    const game = freshGame();
    const cost = tiersOf('lighting')[0]?.cost ?? 0;
    const before = game.money;
    expect(buyInvestment(game, 'lighting')).toBe('ok');
    expect(game.money).toBe(before - cost);
    expect(investmentLevel(game, 'lighting')).toBe(1);
  });

  it('bills upkeep for every tier standing, not just the last', () => {
    const game = freshGame();
    buyInvestment(game, 'lighting');
    buyInvestment(game, 'lighting');
    const tiers = tiersOf('lighting');
    expect(investmentUpkeep(game)).toBe((tiers[0]?.upkeep ?? 0) + (tiers[1]?.upkeep ?? 0));
  });

  it('refuses a tier the city cannot afford, and takes nothing', () => {
    const game = freshGame();
    game.money = (tiersOf('lighting')[0]?.cost ?? 0) - 1;
    const before = game.money;
    expect(canBuyInvestment(game, 'lighting')).toBe('tooDear');
    expect(buyInvestment(game, 'lighting')).toBe('tooDear');
    expect(game.money).toBe(before);
    expect(investmentLevel(game, 'lighting')).toBe(0);
  });

  it('keeps each tier behind its own era', () => {
    const game = freshGame();
    game.era = 'village';
    expect(canBuyInvestment(game, 'lighting')).toBe('locked');
    game.era = 'town';
    expect(canBuyInvestment(game, 'lighting')).toBe('ok');
    buyInvestment(game, 'lighting');
    // The second tier wants a city — see the table's own note on why the eras
    // matter more than the prices.
    expect(canBuyInvestment(game, 'lighting')).toBe('locked');
  });

  it('opens nothing before a town, because nothing would pay back', () => {
    // A village has almost no trade to protect. Measured: full lighting returns
    // about a tenth of a lira a minute per resident, so a hundred and fifty
    // people cannot cover any standing cost worth charging. Selling it to them
    // anyway is how a panel loses a player's trust.
    const game = freshGame();
    game.era = 'village';
    for (const id of PROGRAMME_ORDER) {
      expect(canBuyInvestment(game, id)).toBe('locked');
    }
  });

  it('stops when the programme is finished', () => {
    const game = freshGame();
    const tiers = tiersOf('greening').length;
    for (let n = 0; n < tiers; n++) expect(buyInvestment(game, 'greening')).toBe('ok');
    expect(canBuyInvestment(game, 'greening')).toBe('finished');
    expect(buyInvestment(game, 'greening')).toBe('finished');
    expect(investmentLevel(game, 'greening')).toBe(tiers);
  });

  it('prices every tier above the one before it', () => {
    // A sink that stops being a decision is not a sink.
    for (const id of PROGRAMME_ORDER) {
      const tiers = tiersOf(id);
      for (let n = 1; n < tiers.length; n++) {
        expect(tiers[n]?.cost).toBeGreaterThan(tiers[n - 1]?.cost ?? 0);
        expect(tiers[n]?.upkeep).toBeGreaterThan(tiers[n - 1]?.upkeep ?? 0);
      }
    }
  });
});

describe('what each programme does', () => {
  it('lighting lifts the mood after dark and not before it', () => {
    const game = freshGame();
    expect(nightHappiness(game, 1)).toBe(0);
    buyInvestment(game, 'lighting');
    expect(nightHappiness(game, 1)).toBeGreaterThan(0);
    // Only at night: nothing is owed to a lit street at noon.
    expect(nightHappiness(game, 0)).toBe(0);
  });

  it('lighting never marks an unlit city down', () => {
    // A pure bonus. Punishing a player for not buying something they have not
    // been shown teaches resentment, not planning.
    const game = freshGame();
    for (const night of [0, 0.5, 1]) expect(nightHappiness(game, night)).toBe(0);
  });

  it('greening absorbs more with each tier', () => {
    const game = freshGame();
    expect(greeningAbsorption(game)).toBe(0);
    buyInvestment(game, 'greening');
    const one = greeningAbsorption(game);
    buyInvestment(game, 'greening');
    expect(greeningAbsorption(game)).toBeGreaterThan(one);
  });

  it('festivals multiply a holiday rather than inventing one', () => {
    const game = freshGame();
    expect(festivalBoost(game)).toBe(1);
    buyInvestment(game, 'festivals');
    expect(festivalBoost(game)).toBeGreaterThan(1);
  });
});

describe('the ledger', () => {
  it('bills the programmes and shows them on their own line', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    expect(computeLedger(game, fields).programmeUpkeep).toBe(0);
    buyInvestment(game, 'lighting');
    const ledger = computeLedger(game, fields);
    expect(ledger.programmeUpkeep).toBeGreaterThan(0);
  });

  it('takes the upkeep out of the net', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    const before = computeLedger(game, fields).net;
    buyInvestment(game, 'lighting');
    const after = computeLedger(game, fields);
    // No shops yet, so lighting is pure cost here — which is the honest reading:
    // a programme is only worth it once there is trade to protect.
    expect(after.net).toBeLessThan(before);
    expect(before - after.net).toBeCloseTo(after.programmeUpkeep, 5);
  });

  it('reads the same clock the renderer does', () => {
    // What the player sees after dark and what they earn after dark must come
    // from one number, or the lamps are a lie.
    const game = freshGame();
    game.playedMs = (0.5 - START_YEAR * 0) * SECONDS_PER_YEAR * 1000;
    const night = nightAmount(dayFraction(game.playedMs));
    expect(tradeNow(game, night)).toBeCloseTo(tradeByHour(night, lightingShare(game)), 9);
  });
});

describe('programmes across a save', () => {
  it('come back at the level they were bought to', () => {
    const game = freshGame();
    buyInvestment(game, 'lighting');
    buyInvestment(game, 'greening');
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.investments).toEqual(game.investments);
  });

  it('opens a save that predates them with nothing bought', () => {
    const game = freshGame();
    buyInvestment(game, 'lighting');
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['investments'];
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    for (const id of PROGRAMME_ORDER) expect(loaded.investments[id]).toBe(0);
  });

  it('clamps a level this build has no tier for', () => {
    // A save from a build with more tiers must not leave a city with an effect
    // nothing in the table can explain.
    const game = freshGame();
    const data = serialize(game) as unknown as Record<string, unknown>;
    data['investments'] = { lighting: 99, greening: -4, festivals: 'yes' };
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.investments.lighting).toBe(tiersOf('lighting').length);
    expect(loaded.investments.greening).toBe(0);
    expect(loaded.investments.festivals).toBe(0);
  });
});

describe('the table itself', () => {
  it('names and prices every tier', () => {
    for (const id of PROGRAMME_ORDER as ProgrammeId[]) {
      const tiers = tiersOf(id);
      expect(tiers.length).toBeGreaterThan(0);
      for (const tier of tiers) {
        expect(tier.name.length).toBeGreaterThan(0);
        expect(tier.cost).toBeGreaterThan(0);
        expect(tier.upkeep).toBeGreaterThan(0);
      }
    }
  });

  it('costs more than anything else in the game, at the top', () => {
    // The complaint being answered is that nothing was expensive enough. The
    // last lighting tier should be a genuine project.
    const top = tiersOf('lighting').at(-1);
    expect(top?.cost).toBeGreaterThan(500_000);
  });
});
