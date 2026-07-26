import { PARCEL_PRICE_BASE, PARCEL_PRICE_GROWTH, SEA_LEVEL } from '../data/balance';
import type { GameState } from './state';
import { techFactor } from './tech';
import {
  claimParcel,
  index,
  isParcelOwned,
  ownedParcelCount,
  parcelBounds,
  parcelSide,
  type World,
} from './world';

/**
 * Buying land (§4).
 *
 * The grid was always divided into parcels and everything already refused to
 * build outside the ones the player owns — but nothing could ever be bought, so
 * the whole game happened inside one 48×48 square. That square cannot hold the
 * population the later eras ask for, which put three of the seven eras out of
 * reach by arithmetic rather than by design.
 *
 * Expansion is deliberately directional: only parcels touching land the player
 * already owns can be bought, so the city grows outward as a shape somebody
 * chose rather than as scattered claims.
 */
export interface ParcelOffer {
  px: number;
  py: number;
  price: number;
  /** 0..1 of the parcel that is above water — what the price is scaled by. */
  buildableFraction: number;
  affordable: boolean;
}

/** Even an all-water parcel costs something; it still extends the map. */
const MIN_LAND_FRACTION = 0.25;

/**
 * Price of the next parcel, before land quality. Each one bought makes the next
 * dearer, so expansion is a decision with a cost rather than a formality.
 *
 * Takes the whole state rather than the world because the land registry tech
 * discounts it. Threading the discount as an optional argument would make it
 * something a call site can forget; taking the state makes it something the
 * function always knows.
 */
export function baseParcelPrice(state: GameState): number {
  const owned = Math.max(1, ownedParcelCount(state.world));
  const growth = PARCEL_PRICE_BASE * Math.pow(PARCEL_PRICE_GROWTH, owned - 1);
  return growth * techFactor(state, 'registry');
}

/**
 * Share of a parcel that is dry land. Charging full price for open sea would
 * make the map a minefield of purchases the player cannot see the value of
 * until after they have paid.
 */
export function buildableFraction(world: World, px: number, py: number): number {
  const b = parcelBounds(px, py);
  let land = 0;
  let total = 0;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (x >= world.size || y >= world.size) continue;
      total++;
      if ((world.height[index(world, x, y)] ?? 0) >= SEA_LEVEL) land++;
    }
  }
  return total > 0 ? land / total : 0;
}

export function parcelPrice(state: GameState, px: number, py: number): number {
  const fraction = Math.max(MIN_LAND_FRACTION, buildableFraction(state.world, px, py));
  return Math.round(baseParcelPrice(state) * fraction);
}

/** A parcel is on offer when it is unowned and touches something owned. */
export function isBuyable(world: World, px: number, py: number): boolean {
  const side = parcelSide(world);
  if (px < 0 || py < 0 || px >= side || py >= side) return false;
  if (isParcelOwned(world, px, py)) return false;
  return (
    isParcelOwned(world, px - 1, py) ||
    isParcelOwned(world, px + 1, py) ||
    isParcelOwned(world, px, py - 1) ||
    isParcelOwned(world, px, py + 1)
  );
}

/** Every parcel the player could buy right now, cheapest first. */
export function parcelOffers(state: GameState): ParcelOffer[] {
  const world = state.world;
  const side = parcelSide(world);
  const offers: ParcelOffer[] = [];

  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      if (!isBuyable(world, px, py)) continue;
      const price = parcelPrice(state, px, py);
      offers.push({
        px,
        py,
        price,
        buildableFraction: buildableFraction(world, px, py),
        affordable: state.money >= price,
      });
    }
  }
  offers.sort((a, b) => a.price - b.price);
  return offers;
}

/** The offer for one parcel, or null if it is not on the market. */
export function offerFor(state: GameState, px: number, py: number): ParcelOffer | null {
  if (!isBuyable(state.world, px, py)) return null;
  const price = parcelPrice(state, px, py);
  return {
    px,
    py,
    price,
    buildableFraction: buildableFraction(state.world, px, py),
    affordable: state.money >= price,
  };
}

/**
 * Buys a parcel, or returns false and changes nothing. Unlike a road stroke,
 * this is not truncated to what the player can afford — half a parcel is not a
 * thing — so it either happens or it does not.
 */
export function buyParcel(state: GameState, px: number, py: number): boolean {
  const offer = offerFor(state, px, py);
  if (!offer || !offer.affordable) return false;

  state.money -= offer.price;
  claimParcel(state.world, px, py);
  return true;
}
