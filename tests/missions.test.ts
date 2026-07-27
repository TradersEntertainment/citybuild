import { beforeEach, describe, expect, it } from 'vitest';
import { MISSIONS, MISSIONS_SHOWN, missionById } from '../src/data/missions';
import type { TilePoint } from '../src/input/pathGeometry';
import { totalBuildings } from '../src/sim/buildings';
import { activeMissions, measureGoal, settleMissions } from '../src/sim/missions';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { NONE, eraReached } from '../src/sim/tiles';
import { index, startingCentre, type World } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';
import { describeGoal } from '../src/ui/missionText';

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
 * Goals are a reading of progress, not a second game. The property that matters
 * is that nothing can complete one except building the city that completes it —
 * which is also what lets an absence settle them.
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

beforeEach(() => {
  game = createGameState(hashSeed('missions'), 0);
  stripHighway(game.world);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 12, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
  game.money = 100_000;
  systems = new Systems(game.world.size);
});

describe('the chain itself', () => {
  it('has no duplicate ids, which would double-pay one goal', () => {
    const ids = new Set(MISSIONS.map((m) => m.id));
    expect(ids.size).toBe(MISSIONS.length);
  });

  it('offers something from the very first era', () => {
    const opening = MISSIONS.filter((m) => m.from === 'founding');
    expect(opening.length).toBeGreaterThanOrEqual(MISSIONS_SHOWN);
  });

  it('never asks for less than it asked for before, within one ladder', () => {
    // A later goal that is easier than an earlier one completes out of order and
    // makes the chain read as random.
    //
    // Keyed by measure *and* dimension since the mandates arrived (§27): the six
    // cardDimension goals share a measure and are not a ladder — they are six
    // parallel asks, one per column of the report card. Two goals naming the
    // same dimension would still have to escalate, which is what this guards.
    const seen = new Map<string, number>();
    for (const mission of MISSIONS) {
      const key =
        mission.goal.measure === 'cardDimension'
          ? `cardDimension:${mission.goal.dimension}`
          : mission.goal.measure;
      const previous = seen.get(key);
      if (previous !== undefined) expect(mission.goal.target).toBeGreaterThan(previous);
      seen.set(key, mission.goal.target);
    }
  });

  it('pays more for later goals, along the chain that pays in money', () => {
    // The mandates are excluded because they pay in legacy instead, and pinning
    // that they pay no money at all is tests/mandates.test.ts's job. Escalating
    // rewards remain the rule for the building chain, which is the part a
    // player works through in order.
    const paid = MISSIONS.filter((m) => (m.legacy ?? 0) === 0);
    for (let i = 1; i < paid.length; i++) {
      const before = paid[i - 1]!;
      const after = paid[i]!;
      if (before.from === after.from) continue;
      expect(after.reward).toBeGreaterThan(before.reward);
    }
  });

  it('gives every goal exactly one kind of reward', () => {
    // A goal paying both would be two promises for one act, and the panel shows
    // only one line.
    for (const mission of MISSIONS) {
      const money = mission.reward > 0;
      const legacy = (mission.legacy ?? 0) > 0;
      expect(money !== legacy).toBe(true);
    }
  });

  it('can say every goal in words', () => {
    for (const mission of MISSIONS) {
      const said = describeGoal(mission.goal);
      expect(said.length).toBeGreaterThan(0);
      expect(said).not.toContain('undefined');
    }
  });

  it('finds a goal by its id, and does not invent one', () => {
    expect(missionById('firstRoad')).toBeDefined();
    expect(missionById('nothingLikeThis')).toBeUndefined();
  });
});

describe('measuring a goal', () => {
  it('reads road tiles off the column the player drew', () => {
    const totals = totalBuildings(game);
    expect(measureGoal(game, totals, { measure: 'roadTiles', target: 1 })).toBe(0);
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    expect(measureGoal(game, totals, { measure: 'roadTiles', target: 1 })).toBe(24);
  });

  it('counts buildings at or above a level, not exactly at it', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    systems.invalidateFields();
    for (let s = 0; s < 180; s++) systems.step(game, 1);

    const totals = totalBuildings(game);
    const atTwo = measureGoal(game, totals, { measure: 'atLevel', level: 2, target: 1 });
    const atThree = measureGoal(game, totals, { measure: 'atLevel', level: 3, target: 1 });
    expect(atTwo).toBeGreaterThan(0);
    // Every level-3 block is also a block of at least level 2.
    expect(atTwo).toBeGreaterThanOrEqual(atThree);
  });

  it('counts the starting parcel the player was given', () => {
    expect(measureGoal(game, totalBuildings(game), { measure: 'parcels', target: 1 })).toBe(1);
  });
});

describe('settling', () => {
  it('pays a goal once the city has met it', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    const before = game.money;
    const done = settleMissions(game);

    const firstRoad = done.find((m) => m.id === 'firstRoad');
    expect(firstRoad).toBeDefined();
    expect(game.money).toBe(before + done.reduce((sum, m) => sum + m.reward, 0));
  });

  it('pays it exactly once, however often it is asked', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    settleMissions(game);
    const afterFirst = game.money;
    expect(settleMissions(game)).toHaveLength(0);
    expect(game.money).toBe(afterFirst);
  });

  it('holds back a goal the era has not reached', () => {
    // The city has one parcel and no stations, but the village goals should not
    // even be considered while it is still a founding settlement.
    game.services.set(1, { id: 1, kind: 'fire', x: origin.x, y: origin.y });
    expect(game.era).toBe('founding');
    expect(settleMissions(game).some((m) => m.id === 'station')).toBe(false);

    game.era = 'village';
    expect(settleMissions(game).some((m) => m.id === 'station')).toBe(true);
  });

  it('settles on the simulation clock, so a running city claims its own goals', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    paintZone(game.world, row(24, 1), 'res', 1_000_000);
    systems.invalidateFields();
    for (let s = 0; s < 60; s++) systems.step(game, 1);

    expect(game.missionsDone).toContain('firstRoad');
    expect(systems.drainCompletedMissions().length).toBeGreaterThan(0);
  });

  it('drains, so the same completion is never announced twice', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    systems.invalidateFields();
    systems.step(game, 1);
    expect(systems.drainCompletedMissions().length).toBeGreaterThan(0);
    expect(systems.drainCompletedMissions()).toHaveLength(0);
  });
});

describe('what the panel is shown', () => {
  it('offers no more than the limit', () => {
    expect(activeMissions(game).length).toBeLessThanOrEqual(MISSIONS_SHOWN);
  });

  it('puts the goal nearest completion first', () => {
    buildRoad(game.world, row(20, 0), 'path', 1_000_000);
    const shown = activeMissions(game);
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i - 1]!.fraction).toBeGreaterThanOrEqual(shown[i]!.fraction);
    }
    // Twenty of the twenty-four tiles asked for: this one is nearly there.
    expect(shown[0]?.mission.id).toBe('firstRoad');
  });

  it('never shows a goal already claimed', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    settleMissions(game);
    expect(activeMissions(game).some((v) => v.mission.id === 'firstRoad')).toBe(false);
  });

  it('never offers one the era has not unlocked', () => {
    for (const view of activeMissions(game, 50)) {
      expect(eraReached(game.era, view.mission.from)).toBe(true);
    }
  });

  it('caps the bar at full rather than running past it', () => {
    buildRoad(game.world, row(60, 0), 'path', 1_000_000);
    for (const view of activeMissions(game, 50)) {
      expect(view.fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('across a save', () => {
  it('remembers what was claimed, so a reload does not pay twice', () => {
    buildRoad(game.world, row(24, 0), 'path', 1_000_000);
    settleMissions(game);
    expect(game.missionsDone).toContain('firstRoad');

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    expect(loaded).not.toBeNull();
    expect(loaded!.missionsDone).toContain('firstRoad');

    const money = loaded!.money;
    settleMissions(loaded!);
    expect(loaded!.money).toBe(money);
  });

  it('loads a file written before goals existed', () => {
    const data = JSON.parse(JSON.stringify(serialize(game))) as Record<string, unknown>;
    delete data['missionsDone'];
    const loaded = deserialize(data);
    expect(loaded).not.toBeNull();
    expect(loaded!.missionsDone).toEqual([]);
  });

  it('drops an id this build no longer has, rather than carrying it forever', () => {
    const data = JSON.parse(JSON.stringify(serialize(game))) as Record<string, unknown>;
    data['missionsDone'] = ['firstRoad', 'aGoalFromSomeOtherBuild'];
    const loaded = deserialize(data);
    expect(loaded!.missionsDone).toEqual(['firstRoad']);
  });
});
