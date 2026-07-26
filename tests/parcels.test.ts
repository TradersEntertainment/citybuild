import { beforeEach, describe, expect, it } from 'vitest';
import { PARCEL_PRICE_BASE, PARCEL_PRICE_GROWTH, SEA_LEVEL } from '../src/data/balance';
import {
  baseParcelPrice,
  buildableFraction,
  buyParcel,
  isBuyable,
  offerFor,
  parcelOffers,
  parcelPrice,
} from '../src/sim/parcels';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { index, isParcelOwned, ownedParcelCount, parcelBounds, parcelSide } from '../src/sim/world';

/**
 * Buying land is what lifts the map off its 48×48 starting square, and with it
 * the population ceiling that put three of the seven eras out of reach.
 */
let game: GameState;
let centre: number;

/** Forces every tile of a parcel above or below the waterline. */
function setParcelHeight(state: GameState, px: number, py: number, height: number): void {
  const b = parcelBounds(px, py);
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (x >= state.world.size || y >= state.world.size) continue;
      state.world.height[index(state.world, x, y)] = height;
    }
  }
}

beforeEach(() => {
  game = createGameState(hashSeed('parcels'), 0);
  centre = Math.floor(parcelSide(game.world) / 2);
});

describe('what is on offer', () => {
  it('starts with exactly one parcel owned', () => {
    expect(ownedParcelCount(game.world)).toBe(1);
    expect(isParcelOwned(game.world, centre, centre)).toBe(true);
  });

  it('offers only the four parcels touching the city', () => {
    const offers = parcelOffers(game);
    const keys = offers.map((o) => `${o.px},${o.py}`).sort();
    expect(keys).toEqual(
      [
        `${centre - 1},${centre}`,
        `${centre + 1},${centre}`,
        `${centre},${centre - 1}`,
        `${centre},${centre + 1}`,
      ].sort(),
    );
  });

  it('does not offer land the player already owns', () => {
    expect(isBuyable(game.world, centre, centre)).toBe(false);
    expect(offerFor(game, centre, centre)).toBeNull();
  });

  it('does not offer a parcel that touches the city only at a corner', () => {
    expect(isBuyable(game.world, centre + 1, centre + 1)).toBe(false);
  });

  it('does not offer anything off the edge of the map', () => {
    expect(isBuyable(game.world, -1, centre)).toBe(false);
    expect(isBuyable(game.world, parcelSide(game.world), centre)).toBe(false);
  });
});

describe('what land costs', () => {
  it('charges the base price for the first expansion', () => {
    expect(baseParcelPrice(game)).toBeCloseTo(PARCEL_PRICE_BASE, 6);
  });

  it('charges more for each parcel already owned', () => {
    game.money = 10_000_000;
    const first = baseParcelPrice(game);
    buyParcel(game, centre + 1, centre);
    const second = baseParcelPrice(game);
    expect(second).toBeCloseTo(first * PARCEL_PRICE_GROWTH, 4);
  });

  it('discounts a parcel that is mostly water', () => {
    setParcelHeight(game, centre + 1, centre, SEA_LEVEL + 0.2); // all land
    setParcelHeight(game, centre - 1, centre, SEA_LEVEL - 0.2); // all sea

    expect(buildableFraction(game.world, centre + 1, centre)).toBeCloseTo(1, 3);
    expect(buildableFraction(game.world, centre - 1, centre)).toBeCloseTo(0, 3);
    // Open sea is cheap because it is nearly useless, not free — it still
    // extends the map. Charging full price for it would be a trap the player
    // cannot see before paying.
    expect(parcelPrice(game, centre - 1, centre)).toBeLessThan(
      parcelPrice(game, centre + 1, centre),
    );
    expect(parcelPrice(game, centre - 1, centre)).toBeGreaterThan(0);
  });

  it('sorts offers cheapest first', () => {
    const prices = parcelOffers(game).map((o) => o.price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });
});

describe('buying', () => {
  it('takes the money and hands over the land', () => {
    setParcelHeight(game, centre + 1, centre, SEA_LEVEL + 0.2);
    const price = parcelPrice(game, centre + 1, centre);
    game.money = price + 500;

    expect(buyParcel(game, centre + 1, centre)).toBe(true);
    expect(game.money).toBeCloseTo(500, 6);
    expect(isParcelOwned(game.world, centre + 1, centre)).toBe(true);
    expect(ownedParcelCount(game.world)).toBe(2);
  });

  it('refuses and changes nothing when the money is short', () => {
    const price = parcelPrice(game, centre + 1, centre);
    game.money = price - 1;

    expect(buyParcel(game, centre + 1, centre)).toBe(false);
    expect(game.money).toBeCloseTo(price - 1, 6);
    expect(isParcelOwned(game.world, centre + 1, centre)).toBe(false);
  });

  it('refuses land that does not touch the city, however rich the player is', () => {
    game.money = 100_000_000;
    expect(buyParcel(game, centre + 1, centre + 1)).toBe(false);
    expect(isParcelOwned(game.world, centre + 1, centre + 1)).toBe(false);
  });

  it('opens up the next ring once a parcel is bought', () => {
    game.money = 10_000_000;
    expect(isBuyable(game.world, centre + 2, centre)).toBe(false);
    buyParcel(game, centre + 1, centre);
    expect(isBuyable(game.world, centre + 2, centre)).toBe(true);
  });

  it('lifts the buildable area beyond the starting square', () => {
    game.money = 10_000_000;
    const before = ownedParcelCount(game.world);
    buyParcel(game, centre + 1, centre);
    buyParcel(game, centre, centre + 1);
    expect(ownedParcelCount(game.world)).toBe(before + 2);
  });
});
