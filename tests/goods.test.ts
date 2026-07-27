import { describe, expect, it } from 'vitest';
import {
  GOODS_GLUT_FLOOR,
  GOODS_PER_COMMERCIAL_JOB,
  GOODS_PER_INDUSTRIAL_JOB,
  GOODS_SHORTAGE_FLOOR,
} from '../src/data/balance';
import type { Level } from '../src/data/buildings';
import type { Building } from '../src/sim/buildings';
import { computeConnectivity } from '../src/sim/connectivity';
import { computeLedger } from '../src/sim/economy';
import { computeRoadDistance, createFields, type Fields } from '../src/sim/fields';
import {
  computeGoods,
  createGoodsField,
  exportCapacity,
  exportIncome,
  goodsProduced,
  goodsWanted,
  marketFactor,
  stockFactor,
  type GoodsField,
} from '../src/sim/goods';
import { buildRoad } from '../src/sim/roads';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { NONE } from '../src/sim/tiles';
import { createTrafficField } from '../src/sim/traffic';
import { index, startingCentre } from '../src/sim/world';

/**
 * Crates (§16, §17).
 *
 * Industry and commerce have never had anything to do with each other: a
 * workshop made money out of thin air and so did a shop. The property that makes
 * this worth having is the first one in "distance costs" — a shop at the far end
 * of the map must sell measurably less than one beside the factories, or the
 * chain is a number that goes up and down for no reason the player can point at.
 */

let origin = { x: 0, y: 0 };

function strip(state: GameState): void {
  const world = state.world;
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

function put(
  game: GameState,
  x: number,
  y: number,
  zone: 'com' | 'ind',
  jobs: number,
): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone,
    level: 3 as Level,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: 0,
    jobs,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  return building;
}

/**
 * A straight street to place things along, inside the owned starting parcel.
 *
 * Twenty tiles either side of the centre, not thirty: a parcel is forty-eight
 * wide, and `buildRoad` silently skips the tiles beyond it — which is how an
 * earlier version of this fixture measured a supply chain with no road under it.
 */
function road(length = 40): { game: GameState; fields: Fields; goods: GoodsField } {
  const game = createGameState(hashSeed('goods'), 0);
  strip(game);
  game.era = 'city';
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 20, y: Math.floor(centre.y) };
  buildRoad(
    game.world,
    Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y })),
    'asphalt',
    10_000_000,
  );
  const fields = createFields(game.world.size);
  computeConnectivity(game.world);
  computeRoadDistance(game.world, fields.roadDistance);
  return { game, fields, goods: createGoodsField(game.world.size) };
}

function spread(game: GameState, fields: Fields, goods: GoodsField): void {
  const traffic = createTrafficField(game.world.size);
  computeGoods(game, fields, goods, traffic.load);
}

describe('what the city makes and wants', () => {
  it('counts nothing in an empty city', () => {
    const { game } = road();
    expect(goodsProduced(game)).toBe(0);
    expect(goodsWanted(game)).toBe(0);
  });

  it('counts workshops as makers and shops as wanters, and not the other way', () => {
    const { game } = road();
    put(game, origin.x, origin.y + 1, 'ind', 20);
    put(game, origin.x + 1, origin.y + 1, 'com', 10);
    expect(goodsProduced(game)).toBeCloseTo(20 * GOODS_PER_INDUSTRIAL_JOB, 6);
    expect(goodsWanted(game)).toBeCloseTo(10 * GOODS_PER_COMMERCIAL_JOB, 6);
  });

  it('ignores a workshop nobody staffs', () => {
    const { game } = road();
    put(game, origin.x, origin.y + 1, 'ind', 0);
    expect(goodsProduced(game)).toBe(0);
  });
});

describe('distance costs', () => {
  it('delivers more to a shop beside the factory than to one down the road', () => {
    // The property the whole system exists for.
    const { game, fields, goods } = road();
    put(game, origin.x, origin.y + 1, 'ind', 40);
    spread(game, fields, goods);

    const wanted = 20 * GOODS_PER_COMMERCIAL_JOB;
    const near = stockFactor(game.world, fields, goods, origin.x + 2, origin.y + 1, wanted);
    const far = stockFactor(game.world, fields, goods, origin.x + 18, origin.y + 1, wanted);
    expect(near).toBeGreaterThan(far);
    expect(near).toBe(1);
  });

  it('never takes a shop below the floor, however far it is', () => {
    // A shop nobody delivers to still sells what it has. A cliff would empty a
    // district while the player was looking somewhere else.
    const { game, fields, goods } = road();
    put(game, origin.x, origin.y + 1, 'ind', 40);
    spread(game, fields, goods);
    const stranded = stockFactor(
      game.world,
      fields,
      goods,
      origin.x + 38,
      origin.y + 1,
      400,
    );
    expect(stranded).toBeGreaterThanOrEqual(GOODS_SHORTAGE_FLOOR);
  });

  it('never rewards a shop for a lorry queue outside the door', () => {
    const { game, fields, goods } = road();
    for (let i = 0; i < 10; i++) put(game, origin.x + i, origin.y + 1, 'ind', 60);
    spread(game, fields, goods);
    const swimming = stockFactor(
      game.world,
      fields,
      goods,
      origin.x + 5,
      origin.y + 1,
      20 * GOODS_PER_COMMERCIAL_JOB,
    );
    expect(swimming).toBe(1);
  });

  it('gives a shop with no road at all the floor rather than a crash', () => {
    const { game, fields, goods } = road();
    put(game, origin.x, origin.y + 1, 'ind', 40);
    spread(game, fields, goods);
    expect(stockFactor(game.world, fields, goods, 10, 10, 20 * GOODS_PER_COMMERCIAL_JOB)).toBe(
      GOODS_SHORTAGE_FLOOR,
    );
  });
});

describe('somewhere to send the crates', () => {
  it('leaves a balanced city alone', () => {
    const { game } = road();
    put(game, origin.x, origin.y + 1, 'ind', 20);
    put(game, origin.x + 2, origin.y + 1, 'com', 40);
    expect(goodsWanted(game)).toBeGreaterThan(goodsProduced(game));
    expect(marketFactor(game)).toBe(1);
  });

  it('marks down an industrial city with nowhere to sell', () => {
    const { game } = road();
    for (let i = 0; i < 10; i++) put(game, origin.x + i, origin.y + 1, 'ind', 40);
    const factor = marketFactor(game);
    expect(factor).toBeLessThan(1);
    expect(factor).toBeGreaterThanOrEqual(GOODS_GLUT_FLOOR);
  });

  it('leaves an empty city alone rather than dividing by nothing', () => {
    expect(marketFactor(road().game)).toBe(1);
  });
});

describe('shipping the surplus out', () => {
  it('ships nothing without a working harbour', () => {
    const { game } = road();
    for (let i = 0; i < 10; i++) put(game, origin.x + i, origin.y + 1, 'ind', 40);
    expect(exportIncome(game)).toBe(0);
  });

  it('rates a container terminal above a fishing shelter', () => {
    // A city that wants to export its way out of a glut has to have built
    // somewhere to export from.
    const { game } = road();
    game.ports.set(1, { id: 1, kind: 'fishing', x: 10, y: 10 });
    const shelter = exportCapacity(game);
    game.ports.clear();
    game.ports.set(1, { id: 1, kind: 'cargo', x: 10, y: 10 });
    expect(exportCapacity(game)).toBeGreaterThan(shelter);
  });

  it('ships nothing when the city sells everything it makes', () => {
    const { game } = road();
    put(game, origin.x, origin.y + 1, 'ind', 10);
    put(game, origin.x + 2, origin.y + 1, 'com', 40);
    game.ports.set(1, { id: 1, kind: 'cargo', x: 10, y: 10 });
    expect(exportIncome(game)).toBe(0);
  });
});

describe('the ledger', () => {
  it('leaves a city with no goods field exactly as it was', () => {
    // The field is optional throughout, because the offline path and half the
    // tests call computeLedger without one — and a system that quietly changed
    // every figure when its argument was missing would be untestable.
    const { game, fields } = road();
    put(game, origin.x, origin.y + 1, 'com', 40);
    const plain = computeLedger(game, fields);
    expect(plain.taxIncome).toBeGreaterThan(0);
  });

  it('sells a stranded shop short of one beside the factories', () => {
    const near = road();
    put(near.game, origin.x, origin.y + 1, 'ind', 40);
    put(near.game, origin.x + 2, origin.y + 1, 'com', 20);
    spread(near.game, near.fields, near.goods);
    const closeBy = computeLedger(near.game, near.fields, undefined, 0, near.goods);

    const far = road();
    put(far.game, origin.x, origin.y + 1, 'ind', 40);
    put(far.game, origin.x + 18, origin.y + 1, 'com', 20);
    spread(far.game, far.fields, far.goods);
    const wayOut = computeLedger(far.game, far.fields, undefined, 0, far.goods);

    expect(wayOut.taxIncome).toBeLessThan(closeBy.taxIncome);
  });
});
