import { beforeEach, describe, expect, it } from 'vitest';
import {
  OFFICE_SCHOOLING_GATE,
  OFFICE_TAX,
  OFFICE_TURNOVER,
  COMMERCIAL_TAX,
  COMMERCIAL_TURNOVER,
  ZONE_COST,
} from '../src/data/balance';
import { capacityOf, isZoneUnlocked, ZONE_UNLOCK } from '../src/data/buildings';
import type { TilePoint } from '../src/input/pathGeometry';
import { totalBuildings } from '../src/sim/buildings';
import { computeLedger } from '../src/sim/economy';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE, ZONE_ORDER, decodeZone, encodeZone } from '../src/sim/tiles';
import { index, startingCentre, type World } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * Offices (§19): what the schools were for.
 *
 * The education system could always be built and always did something — a small
 * multiplier on everything the city earned — but nothing in the game *was*
 * education. Offices are the end of that chain: ground that pays more than any
 * other, needs no goods delivered and makes no pollution, and will not rise
 * above its ground floor until a real share of the workforce has been to
 * school. A school built today is an office district two cohort bands from now,
 * which is the longest cause and effect in the game.
 *
 * The dangerous part of a fourth zone is not the sim, it is the save: the zone
 * code is an array index, so the first test here is that adding one did not
 * silently relabel every tile in every city that already exists.
 */

let game: GameState;
let origin: { x: number; y: number };

function stripHighway(world: World): void {
  for (let i = 0; i < world.road.length; i++) {
    if ((world.highway[i] ?? 0) === 1) world.road[i] = NONE;
  }
  world.highway.fill(0);
  world.highwayRoute = [];
  world.connected.fill(0);
}

function row(length: number, dy = 0): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

beforeEach(() => {
  game = createGameState(hashSeed('office'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 10, y: Math.floor(centre.y) };
  for (let y = origin.y - 12; y <= origin.y + 12; y++) {
    for (let x = origin.x - 4; x <= origin.x + 30; x++) {
      const i = index(game.world, x, y);
      game.world.height[i] = 0.5;
      game.world.terrain[i] = 2;
    }
  }
  game.money = 5_000_000;
  game.era = 'city';
});

describe('adding a zone kind did not move the ones already saved', () => {
  it('keeps every existing zone on the code it was written with', () => {
    // The zone column stores `ZONE_ORDER.indexOf(kind) + 1`. Inserting `office`
    // anywhere but the end would reload a saved city's industry as parkland —
    // silently, with no error and no way back. These are the codes as they have
    // always been written.
    expect(encodeZone('res')).toBe(1);
    expect(encodeZone('com')).toBe(2);
    expect(encodeZone('ind')).toBe(3);
    expect(encodeZone('farm')).toBe(4);
    expect(encodeZone('park')).toBe(5);
    expect(encodeZone('office')).toBe(6);
    expect(ZONE_ORDER[ZONE_ORDER.length - 1]).toBe('office');
    expect(decodeZone(3)).toBe('ind');
  });

  it('round-trips an office through a save', () => {
    buildRoad(game.world, row(10), 'asphalt', 1e9);
    paintZone(game.world, row(10, 1), 'office', 1e9);
    const back = deserialize(serialize(game));
    expect(back).not.toBeNull();
    expect(decodeZone(back!.world.zone[index(back!.world, origin.x, origin.y + 1)] ?? NONE)).toBe(
      'office',
    );
  });

  it('reads a file written before offices existed without poisoning its demand', () => {
    // The demand object gained a key. A file with three of them spread straight
    // over state leaves `demand.office` undefined, and undefined goes into the
    // suitability sum as NaN — which would spread to every score in the city
    // within a tick, quietly, with nothing on screen to say why.
    const file = serialize(game) as unknown as Record<string, unknown>;
    file['demand'] = { res: 0.4, com: 0.3, ind: 0.2 };
    const back = deserialize(file as unknown as ReturnType<typeof serialize>);
    expect(back).not.toBeNull();
    expect(back!.demand.office).toBe(0);
    expect(Number.isFinite(back!.demand.office)).toBe(true);
    expect(back!.demand.res).toBe(0.4);
  });
});

describe('what an office is worth, and what it costs', () => {
  it('opens after education rather than beside it', () => {
    // A school takes a whole cohort band to reach the workforce, so handing the
    // player both at once would be handing them a district that cannot grow for
    // reasons nothing on screen explains.
    expect(isZoneUnlocked('office', 'town')).toBe(false);
    expect(isZoneUnlocked('office', 'city')).toBe(true);
    expect(ZONE_UNLOCK.office).toBe('city');
    // And nothing else moved.
    for (const kind of ['res', 'com', 'ind', 'farm', 'park'] as const) {
      expect(isZoneUnlocked(kind, 'founding')).toBe(true);
    }
  });

  it('is the dearest ground in the city and pays the most per desk', () => {
    expect(ZONE_COST.office).toBeGreaterThan(ZONE_COST.com);
    // Per job per minute, before any multiplier: this is the trade the zone
    // exists to offer, and if it inverts the zone is a trap.
    expect(OFFICE_TURNOVER * OFFICE_TAX).toBeGreaterThan(COMMERCIAL_TURNOVER * COMMERCIAL_TAX);
  });

  it('holds more desks than a shop holds tills, and the gap widens with height', () => {
    // A shop is a shopfront however tall it is; an office is offices all the way
    // up. So the curve has to be steeper, not merely higher — otherwise there is
    // no reason to zone a business district dense rather than spread it out.
    const low = capacityOf('office', 1) / capacityOf('com', 1);
    const high = capacityOf('office', 5) / capacityOf('com', 5);
    expect(high).toBeGreaterThan(low);
  });
});

describe('a desk needs somebody who can sit at it', () => {
  function district(schooled: number): Systems {
    buildRoad(game.world, row(20), 'asphalt', 1e9);
    paintZone(game.world, row(20, 1), 'office', 1e9, true);
    // Housing on the other side of the street, because the schooled share is a
    // share *of the working-age population* — a district with no residents has
    // no workforce, so it reads as unschooled however the bands are set. Which
    // is correct, and cost this fixture a first draft.
    paintZone(game.world, row(20, -1), 'res', 1e9, true);
    const systems = new Systems(game.world.size);
    systems.invalidateFields();
    game.demand.office = 1;
    game.demand.res = 1;
    game.world.serviceMask.fill(0xff);
    setSchooled(schooled);
    return systems;
  }

  /**
   * Forces the schooled share, which normally takes a whole cohort band to
   * move. Re-applied every tick below, because the cohort pass rewrites it.
   */
  function setSchooled(share: number): void {
    const { people, schooled } = game.cohorts;
    for (let i = 0; i < people.length; i++) schooled[i] = (people[i] ?? 0) * share;
  }

  function grow(systems: Systems, schooled: number, seconds: number): void {
    for (let s = 0; s < seconds; s++) {
      game.playedMs += 1000;
      systems.step(game, 1, false);
      game.world.serviceMask.fill(0xff);
      game.demand.office = 1;
      game.demand.res = 1;
      setSchooled(schooled);
    }
  }

  /** The tallest office, specifically — the housing beside it is not the point. */
  function tallest(): number {
    let top = 0;
    for (const b of game.buildings.values()) {
      if (b.zone === 'office' && b.level > top) top = b.level;
    }
    return top;
  }

  it('opens its ground floor in an unschooled city and stops there', () => {
    // Not "builds nothing" — the same measured rule as the density gate. A zone
    // that silently produces an empty lot reads as broken; one that produces a
    // squat block reads as not ready, which is the truth.
    const systems = district(0);
    grow(systems, 0, 1_200);
    expect([...game.buildings.values()].filter((b) => b.zone === 'office').length).toBeGreaterThan(5);
    expect(tallest()).toBe(1);
  });

  it('climbs once the workforce has been to school', () => {
    const systems = district(1);
    grow(systems, 1, 1_200);
    expect(tallest()).toBeGreaterThan(1);
    expect(totalBuildings(game).officeJobs).toBeGreaterThan(0);
  });

  it('turns on somewhere between the two, not at either end', () => {
    // A gate at zero is no gate; a gate at one is unreachable. Both ends have
    // shipped in this codebase before and both were bugs.
    expect(OFFICE_SCHOOLING_GATE).toBeGreaterThan(0);
    expect(OFFICE_SCHOOLING_GATE).toBeLessThan(1);
  });
});

describe('an office earns differently from a shop', () => {
  it('is not taxed as a factory', () => {
    // The ledger used to be `res` / `com` / everything-else, and everything-else
    // was industry — so before it had a branch of its own an office was taxed
    // at the industrial rate, sold to passing lorries, and had its output cut
    // by the goods market it does not trade in.
    buildRoad(game.world, row(10), 'asphalt', 1e9);
    paintZone(game.world, row(10, 1), 'office', 1e9);
    const systems = new Systems(game.world.size);
    systems.invalidateFields();
    game.demand.office = 1;
    for (let s = 0; s < 60; s++) systems.step(game, 1, false);

    const offices = [...game.buildings.values()].filter((b) => b.zone === 'office');
    expect(offices.length).toBeGreaterThan(0);
    computeLedger(game, systems.fields);
    for (const office of offices) {
      // Output is jobs × turnover × skill², and skill is 1 in an unschooled
      // city — so this is the office rate exactly, not the industrial one.
      expect(office.output).toBeCloseTo(office.jobs * OFFICE_TURNOVER, 4);
    }
  });

  it('counts its desks as employment, so a business district can absorb a workforce', () => {
    buildRoad(game.world, row(10), 'asphalt', 1e9);
    paintZone(game.world, row(10, 1), 'office', 1e9);
    const systems = new Systems(game.world.size);
    systems.invalidateFields();
    game.demand.office = 1;
    for (let s = 0; s < 60; s++) systems.step(game, 1, false);
    expect(totalBuildings(game).officeJobs).toBeGreaterThan(0);
    // And they are not being double-counted as shops.
    expect(totalBuildings(game).commercialJobs).toBe(0);
  });
});
