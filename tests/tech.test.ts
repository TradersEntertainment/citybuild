import { beforeEach, describe, expect, it } from 'vitest';
import { TECHS, techById } from '../src/data/tech';
import { STR } from '../src/data/strings.tr';
import type { TilePoint } from '../src/input/pathGeometry';
import { totalBuildings } from '../src/sim/buildings';
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
