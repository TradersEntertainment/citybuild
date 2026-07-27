import { describe, expect, it } from 'vitest';
import { BUDGET_LEVELS, BUDGET_MAX, BUDGET_MIN } from '../src/data/balance';
import { SERVICE_ORDER, SERVICE_SPECS } from '../src/data/services';
import { STR } from '../src/data/strings.tr';
import { budgetOf, createBudgets, nudgeBudget, readBudgets, setBudget } from '../src/sim/budgets';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { fundedRadius, serviceUpkeep } from '../src/sim/services';
import { createGameState, type GameState } from '../src/sim/state';

/**
 * Department budgets (§3, §33).
 *
 * The load-bearing property is the last block: a budget must buy exactly what it
 * costs. Cheaper than it buys and every player maxes every slider on sight;
 * dearer and nobody ever raises one above the minimum. Equal is what makes the
 * control a question about priorities rather than a puzzle with an answer.
 */

function city(): GameState {
  const game = createGameState(hashSeed('budgets'), 0);
  game.era = 'city';
  return game;
}

describe('the slider', () => {
  it('starts every department at normal', () => {
    const game = city();
    for (const kind of SERVICE_ORDER) expect(budgetOf(game, kind)).toBe(1);
  });

  it('moves a notch at a time, in both directions', () => {
    const game = city();
    const step = (BUDGET_MAX - BUDGET_MIN) / (BUDGET_LEVELS - 1);
    expect(nudgeBudget(game, 'police', 1)).toBeCloseTo(1 + step, 6);
    expect(nudgeBudget(game, 'police', -1)).toBeCloseTo(1, 6);
    expect(nudgeBudget(game, 'police', -1)).toBeCloseTo(1 - step, 6);
  });

  it('stops at both ends rather than running off', () => {
    const game = city();
    for (let n = 0; n < 20; n++) nudgeBudget(game, 'fire', 1);
    expect(budgetOf(game, 'fire')).toBe(BUDGET_MAX);
    for (let n = 0; n < 40; n++) nudgeBudget(game, 'fire', -1);
    expect(budgetOf(game, 'fire')).toBe(BUDGET_MIN);
  });

  it('reaches every notch the range promises', () => {
    const game = city();
    setBudget(game, 'health', BUDGET_MIN);
    const seen = new Set<number>([budgetOf(game, 'health')]);
    for (let n = 0; n < BUDGET_LEVELS; n++) {
      seen.add(nudgeBudget(game, 'health', 1));
    }
    expect(seen.size).toBe(BUDGET_LEVELS);
  });

  it('moves one department without touching the others', () => {
    const game = city();
    nudgeBudget(game, 'police', 1);
    expect(budgetOf(game, 'fire')).toBe(1);
    expect(budgetOf(game, 'education')).toBe(1);
  });

  it('names every department it offers', () => {
    for (const kind of SERVICE_ORDER) expect(STR.service[kind].length).toBeGreaterThan(0);
    expect(STR.budget.title.length).toBeGreaterThan(0);
  });
});

describe('what it costs', () => {
  it('bills nothing extra for a city with no stations', () => {
    const game = city();
    setBudget(game, 'fire', BUDGET_MAX);
    expect(serviceUpkeep(game)).toBe(0);
  });

  it('scales a station bill straight with its department', () => {
    const game = city();
    game.services.set(1, { id: 1, kind: 'fire', x: 150, y: 150 });
    expect(serviceUpkeep(game)).toBeCloseTo(SERVICE_SPECS.fire.upkeep, 6);
    setBudget(game, 'fire', 1.5);
    expect(serviceUpkeep(game)).toBeCloseTo(SERVICE_SPECS.fire.upkeep * 1.5, 6);
    setBudget(game, 'fire', BUDGET_MIN);
    expect(serviceUpkeep(game)).toBeCloseTo(SERVICE_SPECS.fire.upkeep * BUDGET_MIN, 6);
  });

  it('bills each department at its own level', () => {
    const game = city();
    game.services.set(1, { id: 1, kind: 'fire', x: 150, y: 150 });
    game.services.set(2, { id: 2, kind: 'police', x: 152, y: 150 });
    setBudget(game, 'fire', BUDGET_MAX);
    setBudget(game, 'police', BUDGET_MIN);
    expect(serviceUpkeep(game)).toBeCloseTo(
      SERVICE_SPECS.fire.upkeep * BUDGET_MAX + SERVICE_SPECS.police.upkeep * BUDGET_MIN,
      6,
    );
  });
});

describe('what it buys', () => {
  it('grows the coverage of a funded station', () => {
    const game = city();
    expect(fundedRadius(game, 'fire')).toBeCloseTo(SERVICE_SPECS.fire.radius, 6);
    setBudget(game, 'fire', BUDGET_MAX);
    expect(fundedRadius(game, 'fire')).toBeGreaterThan(SERVICE_SPECS.fire.radius);
    setBudget(game, 'fire', BUDGET_MIN);
    expect(fundedRadius(game, 'fire')).toBeLessThan(SERVICE_SPECS.fire.radius);
  });

  /**
   * The whole design, in one assertion.
   *
   * The radius scales by the *root* of the budget precisely so that the area —
   * the ground actually served, which is what the money is buying — grows in
   * step with the bill. Scaling the radius straight would make the area grow
   * with the square of the money, a free upgrade every player would max out on
   * sight and never think about again.
   */
  it('buys exactly what it costs, measured as ground served', () => {
    const game = city();
    const area = (): number => Math.PI * fundedRadius(game, 'fire') ** 2;
    const normal = area();
    for (const level of [BUDGET_MIN, 0.75, 1.25, BUDGET_MAX]) {
      setBudget(game, 'fire', level);
      expect(area() / normal).toBeCloseTo(level, 6);
    }
  });
});

describe('across a save', () => {
  it('comes back at the level it was set to', () => {
    const game = city();
    setBudget(game, 'police', BUDGET_MAX);
    setBudget(game, 'depot', BUDGET_MIN);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(budgetOf(loaded, 'police')).toBe(BUDGET_MAX);
    expect(budgetOf(loaded, 'depot')).toBe(BUDGET_MIN);
    expect(budgetOf(loaded, 'fire')).toBe(1);
  });

  it('opens a file written before departments had budgets', () => {
    const game = city();
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['budgets'];
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    // A city funding everything normally, which is what the absence means.
    for (const kind of SERVICE_ORDER) expect(budgetOf(loaded, kind)).toBe(1);
  });

  it('clamps a level this build has no notch for', () => {
    // A save from a build with a wider range must not hand a city an effect no
    // slider in this one can explain.
    const budgets = readBudgets({ police: 99, fire: -4, health: 'lots' });
    expect(budgets.police).toBe(BUDGET_MAX);
    expect(budgets.fire).toBe(BUDGET_MIN);
    expect(budgets.health).toBe(1);
  });

  it('ignores rubbish where a table should be', () => {
    expect(readBudgets(null)).toEqual(createBudgets());
    expect(readBudgets('half')).toEqual(createBudgets());
  });
});
