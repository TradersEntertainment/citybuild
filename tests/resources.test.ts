import { describe, expect, it } from 'vitest';
import { RESOURCE_DEPLETION_PER_MIN, RESOURCE_OUTPUT } from '../src/data/balance';
import { STR } from '../src/data/strings.tr';
import type { Level } from '../src/data/buildings';
import type { Building } from '../src/sim/buildings';
import { computeParkValue, createFields } from '../src/sim/fields';
import {
  FULLY_MINED,
  resourceAt,
  resourceFactor,
  seamLeft,
  seamsRemaining,
  stepResources,
} from '../src/sim/resources';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { RESOURCE_ORDER, encodeZone } from '../src/sim/tiles';
import { index } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * The ground the city stands on (§25), and the green it stands beside (§9).
 *
 * Both were already half-built and connected to nothing. Twenty-six seams of
 * coal, iron, stone and clay have been generated into every map since the first
 * phase and read by nothing but the tile inspector; parks were the dearest thing
 * the zone brush painted and their whole return was cleaner air.
 *
 * The load-bearing property for the seams is that they run out. A permanent
 * multiplier for standing on coal is a free lunch that makes one district
 * strictly better forever; a stock that depletes is a decision with a horizon.
 */

function workshop(game: GameState, x: number, y: number, w = 1, h = 1): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w,
    h,
    zone: 'ind',
    level: 2 as Level,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: 0,
    jobs: 8,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  game.buildings.set(id, building);
  game.world.building[index(game.world, x, y)] = id;
  return building;
}

function seam(game: GameState, x: number, y: number, kind: 'coal' | 'iron'): void {
  game.world.resource[index(game.world, x, y)] = RESOURCE_ORDER.indexOf(kind);
}

function freshGame(): GameState {
  const game = createGameState(hashSeed('resources'), 0);
  game.era = 'town';
  // The generated seams would make every assertion below depend on where the
  // worldgen happened to put them.
  game.world.resource.fill(0);
  return game;
}

describe('what is under the ground', () => {
  it('is worth nothing where there is nothing', () => {
    const game = freshGame();
    expect(resourceAt(game.world, 150, 150)).toBe('none');
    expect(resourceFactor(game.world, 150, 150)).toBe(1);
    expect(seamLeft(game.world, 150, 150)).toBe(0);
  });

  it('pays a workshop standing on a seam', () => {
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    expect(resourceFactor(game.world, 150, 150)).toBeCloseTo(RESOURCE_OUTPUT.coal, 6);
  });

  it('pays iron better than clay, and stone in between', () => {
    // The table is the whole design; if it ever flattens, the map stops being a
    // reason to put the industry anywhere in particular.
    expect(RESOURCE_OUTPUT.iron).toBeGreaterThan(RESOURCE_OUTPUT.coal);
    expect(RESOURCE_OUTPUT.coal).toBeGreaterThan(RESOURCE_OUTPUT.stone);
    expect(RESOURCE_OUTPUT.stone).toBeGreaterThan(RESOURCE_OUTPUT.clay);
    expect(RESOURCE_OUTPUT.clay).toBeGreaterThan(RESOURCE_OUTPUT.none);
  });

  it('names every kind it can generate', () => {
    for (const kind of RESOURCE_ORDER) expect(STR.resource[kind].length).toBeGreaterThan(0);
  });
});

describe('working a seam out', () => {
  it('takes nothing where no industry stands', () => {
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    stepResources(game, 600);
    expect(seamLeft(game.world, 150, 150)).toBe(1);
  });

  it('takes nothing from under a house', () => {
    // Only industry mines. A home on coal is a home on coal.
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    const home = workshop(game, 150, 150);
    home.zone = 'res';
    stepResources(game, 600);
    expect(seamLeft(game.world, 150, 150)).toBe(1);
  });

  it('takes nothing from under a workshop with nobody in it', () => {
    // A stalled city must not quietly exhaust its own map while it waits.
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    workshop(game, 150, 150).jobs = 0;
    stepResources(game, 600);
    expect(seamLeft(game.world, 150, 150)).toBe(1);
  });

  it('works it down while the workshop runs', () => {
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    workshop(game, 150, 150);
    stepResources(game, 60);
    expect(seamLeft(game.world, 150, 150)).toBeCloseTo(1 - RESOURCE_DEPLETION_PER_MIN, 2);
  });

  it('fades the bonus rather than dropping it off a cliff', () => {
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    workshop(game, 150, 150);
    const full = resourceFactor(game.world, 150, 150);
    stepResources(game, 60 * 25);
    const half = resourceFactor(game.world, 150, 150);
    expect(half).toBeLessThan(full);
    expect(half).toBeGreaterThan(1);
  });

  it('stops at nothing left, and says so once', () => {
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    workshop(game, 150, 150);
    const minutes = Math.ceil(1 / RESOURCE_DEPLETION_PER_MIN) + 2;

    let announced = 0;
    for (let m = 0; m < minutes; m++) {
      announced += stepResources(game, 60).filter((e) => e.kind === 'seamExhausted').length;
    }
    expect(announced).toBe(1);
    expect(seamLeft(game.world, 150, 150)).toBe(0);
    expect(resourceFactor(game.world, 150, 150)).toBe(1);
    // Still reads as a coal field on the map — what changed is that it is empty.
    expect(resourceAt(game.world, 150, 150)).toBe('coal');

    // And it stays quiet from then on.
    expect(stepResources(game, 600)).toEqual([]);
  });

  it('works every tile a big workshop stands on', () => {
    const game = freshGame();
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) seam(game, 150 + dx, 150 + dy, 'iron');
    workshop(game, 150, 150, 2, 2);
    stepResources(game, 60);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(seamLeft(game.world, 150 + dx, 150 + dy)).toBeLessThan(1);
      }
    }
  });

  it('counts what the city has left', () => {
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    seam(game, 151, 150, 'coal');
    expect(seamsRemaining(game.world)).toBe(2);
    game.world.depleted[index(game.world, 150, 150)] = FULLY_MINED;
    expect(seamsRemaining(game.world)).toBe(1);
  });
});

describe('a seam across a save', () => {
  it('stays worked out, because closing the tab is not a mine', () => {
    const game = freshGame();
    seam(game, 150, 150, 'coal');
    workshop(game, 150, 150);
    stepResources(game, 600);
    const left = seamLeft(game.world, 150, 150);
    expect(left).toBeLessThan(1);

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.world.depleted[index(loaded.world, 150, 150)]).toBe(
      game.world.depleted[index(game.world, 150, 150)],
    );
  });

  it('opens a file written before the ground could be mined', () => {
    const game = freshGame();
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['depleted'];
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    // A city whose ground has never been touched, which is what the absence means.
    expect(loaded.world.depleted.some((n) => n !== 0)).toBe(false);
  });
});

describe('a park is worth living beside', () => {
  it('is worth nothing where there are none', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    computeParkValue(game.world, fields.parkValue);
    expect(fields.parkValue[index(game.world, 150, 150)]).toBe(0);
  });

  it('is worth most on the park and less further off', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    game.world.zone[index(game.world, 150, 150)] = encodeZone('park');
    computeParkValue(game.world, fields.parkValue);

    const on = fields.parkValue[index(game.world, 150, 150)] ?? 0;
    const near = fields.parkValue[index(game.world, 152, 150)] ?? 0;
    const far = fields.parkValue[index(game.world, 155, 150)] ?? 0;
    const beyond = fields.parkValue[index(game.world, 157, 150)] ?? 0;
    expect(on).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    // The falloff is soft at the rim rather than stepping to zero at it — the edge
    // of a park's neighbourhood should not be a line on the ground — so the plain
    // zero is only outside the reach entirely.
    expect(far).toBeGreaterThan(0);
    expect(beyond).toBe(0);
  });

  it('does not stack three squares into a gold mine', () => {
    // The best park wins rather than the parks adding up: a row of squares should
    // be a nice neighbourhood, not an exploit.
    const game = freshGame();
    const fields = createFields(game.world.size);
    game.world.zone[index(game.world, 150, 150)] = encodeZone('park');
    computeParkValue(game.world, fields.parkValue);
    const alone = fields.parkValue[index(game.world, 150, 150)] ?? 0;

    for (let x = 148; x <= 152; x++) game.world.zone[index(game.world, x, 150)] = encodeZone('park');
    computeParkValue(game.world, fields.parkValue);
    expect(fields.parkValue[index(game.world, 150, 150)]).toBe(alone);
  });

  it('reaches the plots a painted park actually covers', () => {
    const game = freshGame();
    const fields = createFields(game.world.size);
    paintZone(
      game.world,
      Array.from({ length: 4 }, (_, i) => ({ x: 150 + i, y: 150 })),
      'park',
      1_000_000,
    );
    computeParkValue(game.world, fields.parkValue);
    expect(fields.parkValue[index(game.world, 151, 152)]).toBeGreaterThan(0);
  });
});
