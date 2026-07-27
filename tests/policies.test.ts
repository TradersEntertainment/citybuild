import { beforeEach, describe, expect, it } from 'vitest';
import { POLICY_EFFECTS, POLICY_ORDER } from '../src/data/policies';
import {
  commerceFactor,
  epidemicSeverityFactor,
  fareFactor,
  industryFactor,
  industryNoiseFactor,
  policyHappiness,
  policyUpkeep,
  rubbishFactor,
  schoolingFactor,
  togglePolicy,
  touristTaxIncome,
  touristTaxPull,
  transitCapacityFactor,
} from '../src/sim/policies';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';

/**
 * Ordinances (§22).
 *
 * Two contracts. First: every factor answers exactly 1 (and every mood exactly
 * 0) while its policy is off, because the hooks multiply unconditionally — a
 * default that drifted off 1 would silently retune six systems at once.
 * Second: every policy is a trade; the table is checked for it, so nobody can
 * slip in a pure buff and turn the council into a checkbox.
 */
let game: GameState;

beforeEach(() => {
  game = createGameState(hashSeed('policy'), 0);
  game.era = 'city';
});

describe('the off state is exactly nothing', () => {
  it('every factor is 1 and every mood is 0 with no policies in force', () => {
    expect(fareFactor(game)).toBe(1);
    expect(transitCapacityFactor(game)).toBe(1);
    expect(industryFactor(game)).toBe(1);
    expect(industryNoiseFactor(game)).toBe(1);
    expect(commerceFactor(game)).toBe(1);
    expect(schoolingFactor(game)).toBe(1);
    expect(rubbishFactor(game)).toBe(1);
    expect(epidemicSeverityFactor(game)).toBe(1);
    expect(touristTaxIncome(game)).toBe(1);
    expect(touristTaxPull(game)).toBe(1);
    expect(policyHappiness(game)).toBe(0);
    expect(policyUpkeep(game)).toBe(0);
  });
});

describe('what each ordinance moves', () => {
  it('free transit: empty fare box, roomier network', () => {
    togglePolicy(game, 'freeTransit');
    expect(fareFactor(game)).toBe(0);
    expect(transitCapacityFactor(game)).toBe(POLICY_EFFECTS.FREE_TRANSIT_CAPACITY);
  });

  it('night shift: more output, more noise, tireder city', () => {
    togglePolicy(game, 'nightShift');
    expect(industryFactor(game)).toBeGreaterThan(1);
    expect(industryNoiseFactor(game)).toBeGreaterThan(1);
    expect(policyHappiness(game)).toBeLessThan(0);
  });

  it('recycling: lighter bins, a drag on the workshops, a standing bill', () => {
    togglePolicy(game, 'recycling');
    expect(rubbishFactor(game)).toBeLessThan(1);
    expect(industryFactor(game)).toBeLessThan(1);
    expect(policyUpkeep(game)).toBeGreaterThan(0);
  });

  it('smoke ban: milder outbreaks, softer tills, fresher air', () => {
    togglePolicy(game, 'smokeBan');
    expect(epidemicSeverityFactor(game)).toBeLessThan(1);
    expect(commerceFactor(game)).toBeLessThan(1);
    expect(policyHappiness(game)).toBeGreaterThan(0);
  });

  it('tourist tax: richer hotels, fewer strangers', () => {
    togglePolicy(game, 'touristTax');
    expect(touristTaxIncome(game)).toBeGreaterThan(1);
    expect(touristTaxPull(game)).toBeLessThan(1);
  });

  it('school buses: further reach, by the minute', () => {
    togglePolicy(game, 'schoolBuses');
    expect(schoolingFactor(game)).toBeGreaterThan(1);
    expect(policyUpkeep(game)).toBeGreaterThan(0);
  });
});

describe('the switch itself', () => {
  it('toggles, and honours the era lock', () => {
    expect(togglePolicy(game, 'freeTransit')).toBe('on');
    expect(togglePolicy(game, 'freeTransit')).toBe('off');
    game.era = 'founding';
    expect(togglePolicy(game, 'recycling')).toBe('locked');
    expect(game.policies.has('recycling')).toBe(false);
  });

  it('every policy costs something, somewhere', () => {
    // The design contract: no pure buffs. Each ordinance must carry either a
    // standing bill or a factor pointing the wrong way for somebody.
    for (const id of POLICY_ORDER) {
      game.policies.clear();
      game.policies.add(id);
      const costsMoney = policyUpkeep(game) > 0 || fareFactor(game) < 1;
      const costsSomething =
        costsMoney ||
        industryFactor(game) < 1 ||
        commerceFactor(game) < 1 ||
        industryNoiseFactor(game) > 1 ||
        touristTaxPull(game) < 1 ||
        policyHappiness(game) < 0;
      expect(costsSomething, `${id} is a free lunch`).toBe(true);
    }
  });

  it('survives a save, and lapses cleanly when a policy stops existing', () => {
    togglePolicy(game, 'nightShift');
    togglePolicy(game, 'smokeBan');
    const back = deserialize(serialize(game));
    expect(back).not.toBeNull();
    expect(back!.policies.has('nightShift')).toBe(true);
    expect(back!.policies.has('smokeBan')).toBe(true);

    const file = serialize(game);
    file.policies.push('prohibitionOfFun');
    const tolerant = deserialize(file);
    expect(tolerant).not.toBeNull();
    expect(tolerant!.policies.size).toBe(2);
  });
});
