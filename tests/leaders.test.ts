import { describe, expect, it } from 'vitest';
import { LEADER_ORDER, LEADER_SPECS, NEUTRAL_LEADER } from '../src/data/leaders';
import { scoreOpening } from '../src/sim/elections';
import { GROUP_ORDER, readGroups } from '../src/sim/groups';
import { leaderBaseSway, leaderFuryResist, leaderGrantBonus, leaderStartMoney } from '../src/sim/leaders';
import { deserialize, serialize } from '../src/sim/save';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';

function city(): GameState {
  const state = createGameState(hashSeed('leaders'), 0);
  state.era = 'city';
  state.population = 4_000;
  return state;
}

describe('the chosen leader', () => {
  it('defaults to neutral — no lean, no edge, no silent faction warmth', () => {
    const state = city();
    expect(state.leader).toBe(NEUTRAL_LEADER);
    for (const g of GROUP_ORDER) expect(leaderBaseSway(state, g)).toBe(0);
    expect(leaderFuryResist(state)).toBe(1);
    expect(leaderGrantBonus(state)).toBe(1);
  });

  it('is never offered neutral in the picker', () => {
    expect(LEADER_ORDER).not.toContain(NEUTRAL_LEADER);
    expect(LEADER_ORDER.length).toBe(5);
  });

  it('warms exactly the base it was elected on', () => {
    const state = city();
    state.leader = 'reformer';
    const base = LEADER_SPECS.reformer.base;
    for (const g of GROUP_ORDER) {
      if (base.includes(g)) expect(leaderBaseSway(state, g)).toBeGreaterThan(0);
      else expect(leaderBaseSway(state, g)).toBe(0);
    }
  });

  it('lifts its base at the ballot box', () => {
    const neutral = city();
    const reformer = city();
    reformer.leader = 'reformer';
    const before = new Map(readGroups(neutral).map((r) => [r.id, r.approval]));
    const after = new Map(readGroups(reformer).map((r) => [r.id, r.approval]));
    expect(after.get('greens') ?? 0).toBeGreaterThan(before.get('greens') ?? 0);
  });

  it('gives the strongman a feared, slower-organising city', () => {
    const state = city();
    state.leader = 'strongman';
    expect(leaderFuryResist(state)).toBeLessThan(1);
  });

  it('opens the treasuries and the grants it should', () => {
    expect(leaderStartMoney('technocrat')).toBeGreaterThan(0);
    expect(leaderStartMoney('strongman')).toBe(0);
    const patron = city();
    patron.leader = 'patron';
    expect(leaderGrantBonus(patron)).toBeGreaterThan(1);
  });
});

describe('the opening election', () => {
  it('cannot be won on a base alone — you must promise somebody something', () => {
    const state = city();
    for (const id of LEADER_ORDER) {
      expect(scoreOpening(state, id, [])).toBeLessThan(0.5);
    }
  });

  it('climbs with every promise, and a full slate wins', () => {
    const state = city();
    const none = scoreOpening(state, 'populist', []);
    const some = scoreOpening(state, 'populist', ['noJams']);
    const more = scoreOpening(state, 'populist', ['noJams', 'cleanAir', 'schools']);
    expect(some).toBeGreaterThan(none);
    expect(more).toBeGreaterThan(some);
    expect(more).toBeGreaterThanOrEqual(0.5);
  });

  it('does not mutate the state it scores', () => {
    const state = city();
    const leaderBefore = state.leader;
    const promisesBefore = [...state.promises];
    scoreOpening(state, 'reformer', ['cleanAir']);
    expect(state.leader).toBe(leaderBefore);
    expect(state.promises).toEqual(promisesBefore);
  });
});

describe('the save', () => {
  it('carries the leader', () => {
    const state = city();
    state.leader = 'patron';
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded.leader).toBe('patron');
  });

  it('loads an old save, or an unknown leader, as neutral', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    delete data['leader'];
    expect((deserialize(data as never) as GameState).leader).toBe(NEUTRAL_LEADER);
    data['leader'] = 'emperor';
    expect((deserialize(data as never) as GameState).leader).toBe(NEUTRAL_LEADER);
  });
});
