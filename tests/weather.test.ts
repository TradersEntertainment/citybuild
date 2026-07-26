import { beforeEach, describe, expect, it } from 'vitest';
import { WEATHER_SPAN_S } from '../src/data/balance';
import { computeLedger } from '../src/sim/economy';
import { createFields } from '../src/sim/fields';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { startingCentre } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';
import {
  FAIR_EFFECTS,
  isWeatherWorthAnnouncing,
  weatherAt,
  weatherEffects,
  WEATHER_KINDS,
  type WeatherKind,
} from '../src/sim/weather';

/**
 * Weather has to be two things at once: unpredictable to the player and
 * completely predictable to the machine. The first is what makes a wet decade
 * worth noticing; the second is why two players on one map get the same summer
 * and a reload does not re-roll the sky.
 */
let game: GameState;

function at(seconds: number): WeatherKind {
  game.playedMs = seconds * 1000;
  return weatherAt(game).kind;
}

/** Every spell in the first `count`, which is the sample most tests want. */
function spells(count: number): WeatherKind[] {
  return Array.from({ length: count }, (_, i) => at(i * WEATHER_SPAN_S + 1));
}

beforeEach(() => {
  game = createGameState(hashSeed('weather'), 0);
});

describe('the sky is a function of the clock', () => {
  it('gives the same answer twice for the same moment', () => {
    game.playedMs = 987_654;
    const first = weatherAt(game);
    const second = weatherAt(game);
    expect(second).toEqual(first);
  });

  it('holds one spell for its whole length', () => {
    const start = at(WEATHER_SPAN_S * 3 + 1);
    expect(at(WEATHER_SPAN_S * 3 + WEATHER_SPAN_S - 1)).toBe(start);
  });

  it('numbers the spells in order and reports progress through them', () => {
    game.playedMs = (WEATHER_SPAN_S * 2 + WEATHER_SPAN_S / 2) * 1000;
    const now = weatherAt(game);
    expect(now.spell).toBe(2);
    expect(now.progress).toBeCloseTo(0.5, 3);
  });

  it('gives two cities on different seeds different weather', () => {
    const mine = spells(40).join('');
    game = createGameState(hashSeed('somewhere else'), 0);
    expect(spells(40).join('')).not.toBe(mine);
  });

  it('gives the same city the same weather however it is reached', () => {
    const first = spells(30).join('');
    game = createGameState(hashSeed('weather'), 0);
    expect(spells(30).join('')).toBe(first);
  });

  it('treats a clock that ran backwards as the first spell', () => {
    game.playedMs = -50_000;
    expect(weatherAt(game).spell).toBe(0);
  });
});

describe('how often it does anything', () => {
  it('is mostly clear, because weather that never stops is a setting', () => {
    const sample = spells(400);
    const clear = sample.filter((k) => k === 'clear').length / sample.length;
    expect(clear).toBeGreaterThan(0.5);
  });

  it('still produces every kind, given a century', () => {
    const seen = new Set(spells(600));
    for (const kind of WEATHER_KINDS) expect(seen).toContain(kind);
  });

  it('only announces the kinds worth announcing', () => {
    expect(isWeatherWorthAnnouncing('clear')).toBe(false);
    expect(isWeatherWorthAnnouncing('rain')).toBe(true);
    expect(isWeatherWorthAnnouncing('storm')).toBe(true);
  });
});

describe('what a spell does to the city', () => {
  it('leaves everything alone when it is clear', () => {
    expect(weatherEffects('clear')).toEqual(FAIR_EFFECTS);
  });

  it('makes rain smother a fire and feed a farm', () => {
    const rain = weatherEffects('rain');
    expect(rain.spreadMult).toBeLessThan(1);
    expect(rain.ignitionMult).toBeLessThan(1);
    expect(rain.farmMult).toBeGreaterThan(1);
  });

  it('makes heat the opposite of rain', () => {
    const heat = weatherEffects('heat');
    expect(heat.ignitionMult).toBeGreaterThan(1);
    expect(heat.spreadMult).toBeGreaterThan(1);
    expect(heat.farmMult).toBeLessThan(1);
  });

  it('keeps the engines in the shed during a storm', () => {
    expect(weatherEffects('storm').responseMult).toBeLessThan(1);
  });

  it('lets fog be only weather', () => {
    // Not everything has to be a mechanic; a spell that changes nothing is
    // allowed as long as it is honest about it.
    expect(weatherEffects('fog')).toEqual(FAIR_EFFECTS);
  });

  it('never returns a multiplier that would silence a system entirely', () => {
    for (const kind of WEATHER_KINDS) {
      const effects = weatherEffects(kind);
      for (const value of Object.values(effects)) {
        expect(value).toBeGreaterThan(0);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('what the ledger sees', () => {
  it('pays a farm more in the rain than in a hot spell', () => {
    const fields = createFields(game.world.size);
    // The ledger counts farmland off the zone column, not off state.farmTiles —
    // so the land has to actually be painted.
    const centre = startingCentre(game.world);
    paintZone(
      game.world,
      Array.from({ length: 40 }, (_, i) => ({
        x: Math.floor(centre.x) - 20 + i,
        y: Math.floor(centre.y),
      })),
      'farm',
      1_000_000,
    );

    // Walk the spells until a wet one and a hot one have both been seen: the
    // point is that the ledger moves with the sky, not which decade is which.
    let wet = -1;
    let hot = -1;
    for (let spell = 0; spell < 400 && (wet < 0 || hot < 0); spell++) {
      game.playedMs = (spell * WEATHER_SPAN_S + 1) * 1000;
      const kind = weatherAt(game).kind;
      if (kind === 'rain' && wet < 0) wet = spell;
      if (kind === 'heat' && hot < 0) hot = spell;
    }
    expect(wet).toBeGreaterThanOrEqual(0);
    expect(hot).toBeGreaterThanOrEqual(0);

    game.playedMs = (wet * WEATHER_SPAN_S + 1) * 1000;
    const wetYield = computeLedger(game, fields).farmYield;
    game.playedMs = (hot * WEATHER_SPAN_S + 1) * 1000;
    const hotYield = computeLedger(game, fields).farmYield;

    expect(wetYield).toBeGreaterThan(hotYield);
  });

  it('does not touch a city with no farmland', () => {
    const fields = createFields(game.world.size);
    for (const spell of [0, 5, 11, 23]) {
      game.playedMs = (spell * WEATHER_SPAN_S + 1) * 1000;
      expect(computeLedger(game, fields).farmYield).toBe(0);
    }
  });
});
