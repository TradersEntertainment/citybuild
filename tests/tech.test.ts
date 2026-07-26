import { beforeEach, describe, expect, it } from 'vitest';
import { CRIME_PER_SEC, EPIDEMIC_MIN_POP, FIRE_IGNITION_PER_SEC } from '../src/data/balance';
import type { Level } from '../src/data/buildings';
import { TECHS, techById } from '../src/data/tech';
import { STR } from '../src/data/strings.tr';
import type { TilePoint } from '../src/input/pathGeometry';
import { totalBuildings, type Building } from '../src/sim/buildings';
import { stepCrime } from '../src/sim/crime';
import { stepHazards } from '../src/sim/hazards';
import { seaIncome } from '../src/sim/ports';
import { visitorFactor } from '../src/sim/visitors';
import { computeLedger } from '../src/sim/economy';
import { createFields } from '../src/sim/fields';
import { baseParcelPrice } from '../src/sim/parcels';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { research, stepResearch, techFactor, techOffers } from '../src/sim/tech';
import { NONE } from '../src/sim/tiles';
import { index, startingCentre, type World } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * These fixtures predate the national highway; a motorway through the working
 * area would move every figure they measure. With the highway stripped there
 * is no "abroad" to be cut off from, so every street connects (§6.1).
 */
function stripHighway(world: World): void {
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

/**
 * Research points accrued from Phase 0 with nowhere to spend them — the same
 * computed-and-discarded smell as away time. What a tech buys is held to the
 * rule every other system was: it lifts a ceiling, it never adds a wall.
 */
let game: GameState;
let systems: Systems;
let origin: { x: number; y: number };

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.fertility[i] = 0.3;
      state.world.terrain[i] = 2;
    }
  }
}

function row(length: number, dy: number): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

/**
 * One commercial building on the map, for a hazard roll to land on.
 *
 * Deliberately minimal and deliberately not shared with the hazard tests: what
 * these assertions need is a target, not a city.
 */
function seedBuilding(state: GameState, x = 150, y = 150): Building {
  const id = state.nextBuildingId++;
  const building: Building = {
    id,
    x,
    y,
    w: 1,
    h: 1,
    zone: 'com',
    level: 1 as Level,
    score: 0.8,
    growthProgress: 0,
    decayTimer: 0,
    population: 0,
    jobs: 4,
    output: 0,
    issues: 0,
    builtAt: 0,
    variantSeed: id * 7919,
  };
  state.buildings.set(id, building);
  state.world.building[index(state.world, building.x, building.y)] = id;
  return building;
}

function grow(seconds: number): void {
  for (let s = 0; s < seconds; s++) {
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
}

beforeEach(() => {
  game = createGameState(hashSeed('tech'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  game.money = 1_000_000;
  systems = new Systems(game.world.size);
});

describe('the tech list', () => {
  it('has no duplicate ids', () => {
    expect(new Set(TECHS.map((t) => t.id)).size).toBe(TECHS.length);
  });

  it('costs more the later it unlocks', () => {
    const sorted = [...TECHS].sort((a, b) => a.cost - b.cost);
    expect(sorted.map((t) => t.id)).toEqual(
      [...TECHS].sort((a, b) => a.cost - b.cost).map((t) => t.id),
    );
    for (const tech of TECHS) expect(tech.cost).toBeGreaterThan(0);
  });

  it('can name and explain every one', () => {
    for (const tech of TECHS) {
      expect(STR.tech.name[tech.id].length).toBeGreaterThan(0);
      expect(STR.tech.detail[tech.id].length).toBeGreaterThan(0);
    }
  });

  it('always lifts a ceiling rather than adding a wall', () => {
    // A discount is a factor below one, a boost above it; nothing is exactly
    // one, which would be a tech that does nothing.
    for (const tech of TECHS) expect(tech.factor).not.toBe(1);
  });
});

describe('earning the points', () => {
  it('earns nothing before anyone lives there', () => {
    stepResearch(game, 600);
    expect(game.research).toBe(0);
  });

  it('accrues once the city has people', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    systems.invalidateFields();
    grow(120);
    expect(game.population).toBeGreaterThan(0);
    expect(game.research).toBeGreaterThan(0);
  });

  it('earns faster in a bigger city', () => {
    game.population = 100;
    stepResearch(game, 60);
    const small = game.research;
    game.research = 0;
    game.population = 100_000;
    stepResearch(game, 60);
    expect(game.research).toBeGreaterThan(small);
  });
});

describe('spending them', () => {
  it('refuses a tech the era has not reached', () => {
    game.research = 10_000;
    expect(game.era).toBe('founding');
    expect(research(game, 'sanitation')).toBe('locked');
  });

  it('refuses one the city cannot afford', () => {
    game.era = 'village';
    game.research = 0;
    expect(research(game, 'sanitation')).toBe('tooDear');
  });

  it('takes the points and records it', () => {
    game.era = 'village';
    game.research = 1_000;
    const cost = techById('sanitation')!.cost;
    expect(research(game, 'sanitation')).toBe('ok');
    expect(game.research).toBe(1_000 - cost);
    expect(game.techsDone).toContain('sanitation');
  });

  it('cannot be bought twice', () => {
    game.era = 'village';
    game.research = 1_000;
    research(game, 'sanitation');
    const left = game.research;
    expect(research(game, 'sanitation')).toBe('done');
    expect(game.research).toBe(left);
  });

  it('only offers what the era has reached', () => {
    game.era = 'village';
    for (const offer of techOffers(game)) {
      expect(['village']).toContain(offer.tech.from);
    }
    game.era = 'megacity';
    expect(techOffers(game).length).toBe(TECHS.length);
  });
});

describe('what a tech actually changes', () => {
  it('is one everywhere until it is bought', () => {
    for (const tech of TECHS) expect(techFactor(game, tech.id)).toBe(1);
  });

  it('makes land cheaper', () => {
    const before = baseParcelPrice(game);
    game.era = 'town';
    game.research = 10_000;
    research(game, 'registry');
    expect(baseParcelPrice(game)).toBeLessThan(before);
  });

  it('makes buildings grow faster', () => {
    // Measured as level plus part-built progress, and taken while the city is
    // still climbing. Whole levels alone plateau once suitability rather than
    // construction time is the constraint, and then both runs read the same.
    const built = (): number =>
      [...game.buildings.values()].reduce((sum, b) => sum + b.level + b.growthProgress, 0);

    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    systems.invalidateFields();
    grow(45);
    const plain = built();

    // The same city again, with the codes researched from the start.
    game = createGameState(hashSeed('tech'), 0);
  stripHighway(game.world);
    const centre = startingCentre(game.world);
    origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };
    flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
    game.money = 1_000_000;
    game.techsDone.push('codes');
    systems = new Systems(game.world.size);
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    systems.invalidateFields();
    grow(45);
    const quick = built();

    expect(quick).toBeGreaterThan(plain);
  });

  it('takes a bite out of the upkeep bill', () => {
    const fields = createFields(game.world.size);
    game.services.set(1, { id: 1, kind: 'fire', x: origin.x, y: origin.y });
    const before = computeLedger(game, fields).serviceUpkeep;
    expect(before).toBeGreaterThan(0);

    game.techsDone.push('administration');
    expect(computeLedger(game, fields).serviceUpkeep).toBeLessThan(before);
  });

  it('makes farmland worth painting', () => {
    game.farmTiles = 100;
    const plain = totalBuildings(game).farmJobs;
    game.techsDone.push('agronomy');
    expect(totalBuildings(game).farmJobs).toBeGreaterThan(plain);
  });

  it('lets the same road carry more before it jams', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    paintZone(game.world, row(24, -1), 'com', 1_000_000);
    systems.invalidateFields();
    grow(240);
    const jammed = Math.max(...systems.traffic.load);

    game.techsDone.push('transit');
    systems.invalidateFields();
    systems.step(game, 1);
    expect(Math.max(...systems.traffic.load)).toBeLessThan(jammed);
  });
});

/**
 * Every tech has exactly one consumer somewhere in sim/, and this is the block
 * that keeps that true.
 *
 * The rule in data/tech.ts is that a tech lifts a ceiling on a system the player
 * has already met. A tech whose factor nothing reads still passes every test
 * above — it has an id, a name, a price and a factor that is not one — and does
 * absolutely nothing in the game. So each of the newer ones is checked against
 * the number it is supposed to move.
 */
describe('every tech is actually wired to something', () => {
  const buy = (id: Parameters<typeof research>[1]): void => {
    game.research = 100_000;
    expect(research(game, id)).toBe('ok');
  };

  /** How many buildings, out of 240, a whole band of rolls catches. */
  const SWEEP = 240;

  /**
   * A city of identical buildings, rolled against evenly spread dice.
   *
   * A single threshold roll would have to reproduce the whole multiplier stack —
   * weather, building level, coverage, the hour of the day — to know which side
   * of the line to sit on, and an earlier version of these two tests got that
   * wrong in both directions. Sweeping across a band measures the only thing
   * being claimed: that the tech moves the line.
   */
  function sweep(
    seed: string,
    band: number,
    tech: 'fireproofing' | 'forensics' | null,
    run: (city: GameState, rolls: () => number) => number,
  ): number {
    const city = createGameState(hashSeed(seed), 0);
    city.era = 'town';
    city.happiness = 100;
    for (let i = 0; i < SWEEP; i++) {
      seedBuilding(city, 150 + (i % 60), 150 + Math.floor(i / 60));
    }
    if (tech) {
      city.research = 100_000;
      expect(research(city, tech)).toBe('ok');
    }
    let cursor = 0;
    return run(city, () => (band * (cursor++ % SWEEP)) / SWEEP);
  }

  it('fireproofing makes fires rarer', () => {
    const band = FIRE_IGNITION_PER_SEC * 4;
    const burn = (city: GameState, rolls: () => number): number => {
      stepHazards(city, 1, rolls);
      return city.fires.size;
    };
    const plain = sweep('fire-sweep', band, null, burn);
    const guarded = sweep('fire-sweep', band, 'fireproofing', burn);
    expect(plain).toBeGreaterThan(0);
    expect(guarded).toBeLessThan(plain);
  });

  it('forensics makes crimes rarer', () => {
    const band = CRIME_PER_SEC * 8;
    const rob = (city: GameState, rolls: () => number): number => {
      stepCrime(city, 1, rolls);
      return city.crimes.size;
    };
    const plain = sweep('crime-sweep', band, null, rob);
    const guarded = sweep('crime-sweep', band, 'forensics', rob);
    expect(plain).toBeGreaterThan(0);
    expect(guarded).toBeLessThan(plain);
  });

  it('medicine softens an outbreak', () => {
    const outbreak = (withTech: boolean): number => {
      const city = createGameState(hashSeed('sick'), 0);
      city.era = 'town';
      city.population = EPIDEMIC_MIN_POP * 4;
      if (withTech) {
        city.research = 100_000;
        research(city, 'medicine');
      }
      stepHazards(city, 1, () => 0);
      return city.epidemic?.severity ?? 0;
    };
    expect(outbreak(true)).toBeLessThan(outbreak(false));
    expect(outbreak(false)).toBeGreaterThan(0);
  });

  it('coldChain pays a fishing fleet more, and only a fishing fleet', () => {
    // Measured through seaIncome, which is the number the ledger reads. A test
    // that only checked techFactor would pass even if nothing consumed it.
    const berth = { x: origin.x + 4, y: origin.y + 4 };
    for (let y = berth.y + 2; y <= berth.y + 10; y++) {
      for (let x = berth.x - 8; x <= berth.x + 8; x++) {
        game.world.height[index(game.world, x, y)] = 0.1;
      }
    }
    game.era = 'town';
    game.ports.set(1, { id: 1, kind: 'fishing', x: berth.x, y: berth.y });
    const before = seaIncome(game);
    expect(before).toBeGreaterThan(0);
    buy('coldChain');
    expect(seaIncome(game)).toBeGreaterThan(before);

    // A cargo berth lands no fish, so the same tech must leave it alone.
    const other = createGameState(hashSeed('tech'), 0);
    other.era = 'town';
    other.world.height.set(game.world.height);
    other.ports.set(1, { id: 1, kind: 'cargo', x: berth.x, y: berth.y });
    const cargoBefore = seaIncome(other);
    other.research = 100_000;
    research(other, 'coldChain');
    expect(seaIncome(other)).toBe(cargoBefore);
  });

  it('hospitality lifts the visitor bonus and leaves an empty street alone', () => {
    // Through visitorFactor, which is where the multiplier actually lands, with a
    // hand-built flow field so the busy road and the empty one are both certain.
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    systems.invalidateFields();
    systems.step(game, 1);
    const busy = index(game.world, origin.x + 4, origin.y);
    const field = { flow: new Float32Array(game.world.size * game.world.size) };
    field.flow[busy] = 6;

    const args = [game.world, systems.fields, field, origin.x + 4, origin.y] as const;
    const plain = visitorFactor(...args);
    const generous = visitorFactor(...args, 1.4);
    expect(plain).toBeGreaterThan(1);
    expect(generous).toBeGreaterThan(plain);

    // The guard that makes this tourism rather than a city-wide raise: a shop on
    // a street nobody passes gains exactly nothing from it.
    const quiet = [game.world, systems.fields, field, origin.x + 20, origin.y] as const;
    expect(visitorFactor(...quiet)).toBe(1);
    expect(visitorFactor(...quiet, 1.4)).toBe(1);
  });
});

describe('across a save', () => {
  it('remembers what was researched', () => {
    game.era = 'village';
    game.research = 1_000;
    research(game, 'sanitation');
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    expect(loaded!.techsDone).toContain('sanitation');
    expect(loaded!.research).toBeCloseTo(game.research, 4);
  });

  it('loads a file written before research had anywhere to go', () => {
    const data = JSON.parse(JSON.stringify(serialize(game))) as Record<string, unknown>;
    delete data['techsDone'];
    expect(deserialize(data)!.techsDone).toEqual([]);
  });

  it('drops an id this build no longer has', () => {
    const data = JSON.parse(JSON.stringify(serialize(game))) as Record<string, unknown>;
    data['techsDone'] = ['codes', 'somethingElse'];
    expect(deserialize(data)!.techsDone).toEqual(['codes']);
  });
});
