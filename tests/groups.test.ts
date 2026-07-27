import { beforeEach, describe, expect, it } from 'vitest';
import { GROUP_ISSUE_WEIGHT } from '../src/data/balance';
import { POLICY_ORDER } from '../src/data/policies';
import { STR } from '../src/data/strings.tr';
import {
  civicBase,
  electorateApproval,
  GROUP_ORDER,
  readGroups,
  type GroupId,
} from '../src/sim/groups';
import { approval } from '../src/sim/elections';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { ISSUE } from '../src/sim/tiles';
import type { Building } from '../src/sim/buildings';

/**
 * The electorate (§23).
 *
 * The properties that make factions worth having: the weights really are a
 * distribution, a grievance really moves the group that owns it and not the
 * ones that don't, every ordinance really splits the room, and the ballot box
 * really counts the weighted sum. And the two-newspaper rule: every story the
 * game can print has both voices written, because one voice is a narrator.
 */
let game: GameState;

function addBuilding(
  zone: 'res' | 'com' | 'ind',
  issues = 0,
  jobs = 0,
  population = 0,
): Building {
  const id = game.nextBuildingId++;
  const building: Building = {
    id,
    x: 10 + (id % 40),
    y: 10 + Math.floor(id / 40),
    w: 1,
    h: 1,
    zone,
    level: 1,
    score: 0.5,
    growthProgress: 0,
    decayTimer: 0,
    population,
    jobs,
    output: 0,
    issues,
    builtAt: 0,
    variantSeed: 1,
  };
  game.buildings.set(id, building);
  return building;
}

/** A city with all four bands filled, so every faction has somebody in it. */
function populate(): void {
  game.population = 1_000;
  game.cohorts.people = [150, 200, 450, 200];
  game.cohorts.schooled = [100, 120, 200, 50];
  game.happiness = 70;
  game.taxRate = 0.09;
  addBuilding('res', 0, 0, 40);
  addBuilding('com', 0, 30);
  addBuilding('ind', 0, 30);
}

beforeEach(() => {
  game = createGameState(hashSeed('groups'), 0);
  game.era = 'city';
});

describe('the weights', () => {
  it('sum to one once anybody lives here, and to nothing before', () => {
    const empty = readGroups(game);
    expect(empty.every((g) => g.weight === 0)).toBe(true);

    populate();
    const groups = readGroups(game);
    const total = groups.reduce((sum, g) => sum + g.weight, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(groups.map((g) => g.id)).toEqual([...GROUP_ORDER]);
  });

  it('gives a faction no seat until its people exist', () => {
    populate();
    game.cohorts.schooled = [0, 0, 0, 0];
    const noGreens = readGroups(game).find((g) => g.id === 'greens');
    expect(noGreens?.weight).toBe(0);

    for (const building of [...game.buildings.values()]) {
      if (building.zone === 'ind') game.buildings.delete(building.id);
    }
    const noIndustry = readGroups(game).find((g) => g.id === 'industrialists');
    expect(noIndustry?.weight).toBe(0);
  });
});

describe('grievances land on their owners', () => {
  it('noise through bedroom windows angers the retired, not the drivers', () => {
    populate();
    const calm = readGroups(game);
    for (let i = 0; i < 6; i++) addBuilding('res', ISSUE.noise, 0, 10);
    const noisy = readGroups(game);
    const by = (rows: typeof calm, id: GroupId) => rows.find((g) => g.id === id)!;
    expect(by(noisy, 'elders').approval).toBeLessThan(by(calm, 'elders').approval);
    expect(by(noisy, 'drivers').approval).toBeCloseTo(by(calm, 'drivers').approval, 3);
  });

  it('jammed streets anger the drivers and the shopkeepers', () => {
    populate();
    const flowing = readGroups(game);
    for (let i = 0; i < 6; i++) addBuilding('com', ISSUE.traffic, 20);
    const jammed = readGroups(game);
    const by = (rows: typeof flowing, id: GroupId) => rows.find((g) => g.id === id)!;
    expect(by(jammed, 'drivers').approval).toBeLessThan(by(flowing, 'drivers').approval);
    expect(by(jammed, 'shopkeepers').approval).toBeLessThan(by(flowing, 'shopkeepers').approval);
  });

  it('smokestacks anger the greens', () => {
    populate();
    const clean = readGroups(game).find((g) => g.id === 'greens')!;
    for (let i = 0; i < 6; i++) addBuilding('ind', ISSUE.pollution, 10);
    const smoky = readGroups(game).find((g) => g.id === 'greens')!;
    expect(smoky.approval).toBeLessThan(clean.approval);
  });
});

describe('every ordinance splits the room', () => {
  it('each policy pleases at least one faction and costs at least one other', () => {
    populate();
    for (const id of POLICY_ORDER) {
      game.policies.clear();
      const before = readGroups(game);
      game.policies.add(id);
      const after = readGroups(game);
      game.policies.delete(id);

      let pleased = 0;
      let angered = 0;
      for (let i = 0; i < before.length; i++) {
        const delta = (after[i]?.approval ?? 0) - (before[i]?.approval ?? 0);
        if (delta > 0.001) pleased++;
        if (delta < -0.001) angered++;
      }
      // The free-transit fare hole and the school-bus bill land on the ledger
      // rather than on a faction, so "costs somebody" there means the till.
      const billed = id === 'freeTransit' || id === 'schoolBuses';
      expect(pleased, `${id} pleased nobody`).toBeGreaterThan(0);
      if (!billed) expect(angered, `${id} angered nobody`).toBeGreaterThan(0);
    }
  });

  it('the night shift is the argument: industry up, pensioners and greens down', () => {
    populate();
    const before = readGroups(game);
    game.policies.add('nightShift');
    const after = readGroups(game);
    const by = (rows: typeof before, id: GroupId) => rows.find((g) => g.id === id)!;
    expect(by(after, 'industrialists').approval).toBeGreaterThan(
      by(before, 'industrialists').approval,
    );
    expect(by(after, 'elders').approval).toBeLessThan(by(before, 'elders').approval);
    expect(by(after, 'greens').approval).toBeLessThan(by(before, 'greens').approval);
  });
});

describe('the ballot box', () => {
  it('counts the weighted sum of the factions', () => {
    populate();
    const groups = readGroups(game);
    const weighted = groups.reduce((sum, g) => sum + g.weight * g.approval, 0);
    expect(electorateApproval(game)).toBeCloseTo(weighted, 9);
    expect(approval(game)).toBeCloseTo(weighted, 9);
  });

  it('judges a factionless city as one household, bins included', () => {
    // The pre-§23 contract: rubbish costs votes in every city, fixture cities
    // with no cohorts included.
    const clean = electorateApproval(game);
    game.rubbish = 1_000_000;
    const filthy = electorateApproval(game);
    expect(filthy).toBeLessThan(clean);
    expect(clean).toBeLessThanOrEqual(civicBase(game) + GROUP_ISSUE_WEIGHT);
  });

  it('stays inside nought and one at both extremes', () => {
    populate();
    game.happiness = 0;
    game.taxRate = 0.2;
    for (let i = 0; i < 12; i++) {
      addBuilding('res', ISSUE.noise | ISSUE.pollution | ISSUE.noService, 0, 10);
    }
    for (const g of readGroups(game)) {
      expect(g.approval).toBeGreaterThanOrEqual(0);
      expect(g.approval).toBeLessThanOrEqual(1);
    }
  });
});

describe('the papers', () => {
  it('write both voices for every story the game can print', () => {
    for (const id of POLICY_ORDER) {
      expect(STR.media.policyOn[id]?.post, `policyOn.${id}.post`).toBeTruthy();
      expect(STR.media.policyOn[id]?.gazette, `policyOn.${id}.gazette`).toBeTruthy();
      expect(STR.media.policyOff[id]?.post, `policyOff.${id}.post`).toBeTruthy();
      expect(STR.media.policyOff[id]?.gazette, `policyOff.${id}.gazette`).toBeTruthy();
    }
    for (const kind of ['hotel', 'clockTower', 'opera', 'stadium', 'tvTower', 'airport']) {
      expect(STR.media.attractionBuilt[kind]?.post, `${kind}.post`).toBeTruthy();
      expect(STR.media.attractionBuilt[kind]?.gazette, `${kind}.gazette`).toBeTruthy();
    }
    expect(STR.media.electionWon.post).toBeTruthy();
    expect(STR.media.electionLost.gazette).toBeTruthy();
  });

  it('names every faction', () => {
    for (const id of GROUP_ORDER) {
      expect(STR.groups.name[id], `name for ${id}`).toBeTruthy();
    }
  });
});
