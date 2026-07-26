import { beforeEach, describe, expect, it } from 'vitest';
import { PETITION_CLEAR_SHARE, PETITION_RAISE_SHARE } from '../src/data/balance';
import { STR } from '../src/data/strings.tr';
import type { Building } from '../src/sim/buildings';
import {
  activePetitions,
  isStillStanding,
  PETITION_KINDS,
  settlePetitions,
  type PetitionKind,
} from '../src/sim/petitions';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { ISSUE } from '../src/sim/tiles';

/**
 * Every building already carried a bitfield saying what was wrong with where it
 * stood, and it only ever became a mark over a roof. A mark says one building is
 * unhappy; a petition says a fifth of the city is unhappy about the same thing,
 * which is the difference between noise and a problem worth crossing the map for.
 */
let game: GameState;

/** A city of `count` buildings, `complaining` of them raising `issue`. */
function populate(count: number, complaining: number, issue: number): void {
  game.buildings.clear();
  for (let i = 0; i < count; i++) {
    const building: Building = {
      id: i + 1,
      x: 10 + (i % 20),
      y: 10 + Math.floor(i / 20),
      w: 1,
      h: 1,
      zone: 'res',
      level: 1,
      score: 0.5,
      growthProgress: 0,
      decayTimer: 0,
      population: 4,
      jobs: 0,
      output: 0,
      issues: i < complaining ? issue : 0,
      builtAt: 0,
      variantSeed: i,
    };
    game.buildings.set(building.id, building);
  }
}

beforeEach(() => {
  game = createGameState(hashSeed('petitions'), 0);
});

describe('when the city speaks up', () => {
  it('says nothing about an empty map', () => {
    expect(activePetitions(game)).toEqual([]);
  });

  it('says nothing about one unlucky building', () => {
    populate(100, 1, ISSUE.traffic);
    expect(activePetitions(game)).toEqual([]);
  });

  it('files once a district is complaining', () => {
    populate(100, 30, ISSUE.traffic);
    const raised = activePetitions(game);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.kind).toBe('traffic');
    expect(raised[0]!.share).toBeCloseTo(0.3, 6);
  });

  it('holds its tongue exactly at the line, and speaks just over it', () => {
    populate(100, Math.floor(PETITION_RAISE_SHARE * 100) - 1, ISSUE.pollution);
    expect(activePetitions(game)).toHaveLength(0);
    populate(100, Math.ceil(PETITION_RAISE_SHARE * 100) + 1, ISSUE.pollution);
    expect(activePetitions(game)).toHaveLength(1);
  });

  it('puts the loudest complaint first', () => {
    game.buildings.clear();
    populate(100, 100, ISSUE.noise);
    // Half of them also have a traffic problem; noise is the louder one.
    let i = 0;
    for (const building of game.buildings.values()) {
      if (i++ < 40) building.issues |= ISSUE.traffic;
    }
    const raised = activePetitions(game);
    expect(raised[0]!.kind).toBe('noise');
    expect(raised.map((p) => p.kind)).toContain('traffic');
  });

  it('can name every complaint it is able to raise', () => {
    for (const kind of PETITION_KINDS) {
      expect(STR.petition.raised[kind].length).toBeGreaterThan(0);
      expect(STR.petition.resolved[kind].length).toBeGreaterThan(0);
    }
  });
});

describe('raising and settling', () => {
  it('raises a petition once, not every tick', () => {
    populate(100, 30, ISSUE.traffic);
    const standing = new Set<PetitionKind>();
    expect(settlePetitions(game, standing).raised).toEqual(['traffic']);
    expect(settlePetitions(game, standing).raised).toEqual([]);
  });

  it('settles it when the city stops complaining, and pays for it', () => {
    populate(100, 30, ISSUE.traffic);
    const standing = new Set<PetitionKind>();
    settlePetitions(game, standing);

    game.happiness = 50;
    populate(100, 2, ISSUE.traffic);
    const changes = settlePetitions(game, standing);
    expect(changes.resolved).toEqual(['traffic']);
    expect(game.happiness).toBeGreaterThan(50);
    expect(standing.size).toBe(0);
  });

  it('does not settle a petition that is merely a bit quieter', () => {
    populate(100, 30, ISSUE.traffic);
    const standing = new Set<PetitionKind>();
    settlePetitions(game, standing);

    // Below the raising bar but above the clearing one: still standing, or a
    // district hovering at the boundary would file and withdraw all afternoon.
    const between = Math.floor(((PETITION_RAISE_SHARE + PETITION_CLEAR_SHARE) / 2) * 100);
    populate(100, between, ISSUE.traffic);
    expect(settlePetitions(game, standing).resolved).toEqual([]);
    expect(isStillStanding(game, 'traffic')).toBe(true);
  });

  it('cannot make a city more than content, however many it answers', () => {
    game.happiness = 99;
    const standing = new Set<PetitionKind>();
    for (const kind of [ISSUE.traffic, ISSUE.noise, ISSUE.pollution]) {
      populate(100, 40, kind);
      settlePetitions(game, standing);
    }
    populate(100, 0, 0);
    settlePetitions(game, standing);
    expect(game.happiness).toBeLessThanOrEqual(100);
  });

  it('re-raises what is still wrong after a reload, since nothing is saved', () => {
    populate(100, 30, ISSUE.traffic);
    const before = new Set<PetitionKind>();
    settlePetitions(game, before);
    // A fresh session starts with an empty set and finds the same city.
    const after = new Set<PetitionKind>();
    expect(settlePetitions(game, after).raised).toEqual(['traffic']);
  });
});
