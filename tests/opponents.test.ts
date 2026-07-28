import { describe, expect, it } from 'vitest';
import { OPPONENT_PULL } from '../src/data/balance';
import { OPPONENTS } from '../src/data/opponents';
import { standingNow, stepElections, termOf } from '../src/sim/elections';
import { GROUP_ORDER, readGroups } from '../src/sim/groups';
import { contestedVote, courts, opponentFor, poachedShare } from '../src/sim/opponents';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { ISSUE, NONE } from '../src/sim/tiles';
import { seizePower } from '../src/sim/unrest';
import { index, startingCentre } from '../src/sim/world';

const TERM_MS = 5 * 40 * 1000;

function city(seed = 'opponents'): GameState {
  const state = createGameState(hashSeed(seed), 0);
  for (let i = 0; i < state.world.road.length; i++) {
    if ((state.world.highway[i] ?? 0) === 1) state.world.road[i] = NONE;
  }
  state.world.highway.fill(0);
  state.world.highwayRoute = [];
  state.era = 'city';
  state.population = 6_000;
  state.happiness = 70;
  return state;
}

/**
 * Fills the city *and* runs it briefly, so the cohort bands — and therefore the
 * faction weights the contest is computed from — are actually populated. A
 * fixture that only sets `population` leaves every weight at zero, which is a
 * different code path.
 */
function fill(state: GameState, issues = 0): void {
  const centre = startingCentre(state.world);
  const x0 = Math.floor(centre.x) - 15;
  const y = Math.floor(centre.y);
  for (let n = 0; n < 30; n++) {
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x: x0 + n, y, zone: 'res', level: 3, score: 0.6, growthProgress: 0,
      decayTimer: 0, population: 20, jobs: 12, issues, output: 0, builtAt: 0,
      variantSeed: n,
    } as never);
    state.world.landValue[index(state.world, x0 + n, y)] = 50;
  }
  const systems = new Systems(state.world.size);
  for (let i = 0; i < 40; i++) {
    state.playedMs += 1000;
    systems.step(state, 1);
  }
}

describe('who is standing', () => {
  it('is nobody at the founding', () => {
    expect(opponentFor(city(), 0)).toBeNull();
  });

  it('is the same candidate however many times it is asked', () => {
    // Derived, never rolled: otherwise a player facing an awkward candidate
    // would reload until they got an easier one.
    const state = city();
    const first = opponentFor(state, 3);
    expect(first).not.toBeNull();
    for (let i = 0; i < 20; i++) expect(opponentFor(state, 3)).toEqual(first);
  });

  it('is a different candidate in a different term', () => {
    const state = city();
    const names = new Set(
      Array.from({ length: 12 }, (_, i) => {
        const rival = opponentFor(state, i + 1);
        return rival ? `${rival.archetype.id}/${rival.name}` : 'none';
      }),
    );
    // A city that faced the same person every term would not be a sequence of
    // contests.
    expect(names.size).toBeGreaterThan(1);
  });

  it('courts two real factions, and names a real archetype', () => {
    const state = city();
    for (let term = 1; term <= 30; term++) {
      const rival = opponentFor(state, term);
      if (!rival) continue;
      expect(OPPONENTS).toContain(rival.archetype);
      expect(rival.archetype.courts).toHaveLength(2);
      for (const group of rival.archetype.courts) expect(GROUP_ORDER).toContain(group);
      expect(rival.name.length).toBeGreaterThan(0);
    }
  });

  it('is nobody once the voting has been ended (§29)', () => {
    const state = city();
    seizePower(state);
    expect(opponentFor(state, 4)).toBeNull();
  });
});

describe('what the opposition takes', () => {
  it('takes nothing from a faction that is fully behind the mayor', () => {
    expect(poachedShare(1)).toBe(0);
  });

  it('takes most of what is available from one that is not', () => {
    expect(poachedShare(0)).toBeCloseTo(OPPONENT_PULL, 6);
    expect(poachedShare(0.5)).toBeCloseTo(OPPONENT_PULL * 0.5, 6);
  });

  it('rises as approval falls, never the other way', () => {
    let last = -1;
    for (const approval of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
      const taken = poachedShare(approval);
      expect(taken).toBeGreaterThanOrEqual(last);
      last = taken;
    }
  });

  it('takes nothing at all when nobody is standing', () => {
    const state = city();
    fill(state);
    const uncontested = contestedVote(state, null);
    expect(uncontested.lost).toBe(0);
  });

  it('only ever touches the factions the candidate is working', () => {
    const state = city();
    fill(state);
    const rival = opponentFor(state, 3)!;
    for (const group of GROUP_ORDER) {
      if (rival.archetype.courts.includes(group)) {
        expect(courts(rival, group)).toBe(true);
      } else {
        expect(courts(rival, group)).toBe(false);
      }
    }
  });

  it('costs a mayor less than the uncontested count, never more', () => {
    const state = city();
    fill(state);
    const rival = opponentFor(state, 3);
    const contested = contestedVote(state, rival);
    const alone = contestedVote(state, null);
    expect(contested.share).toBeLessThanOrEqual(alone.share);
  });

  it('hurts more where the mayor has failed than where they have not', () => {
    // The whole design: the opposition wins where you have failed. Same
    // candidate, same city size — one has looked after its people, one has not.
    const looked = city();
    fill(looked, 0);
    looked.happiness = 92;
    const neglected = city();
    fill(neglected, ISSUE.traffic | ISSUE.pollution | ISSUE.noService);
    neglected.happiness = 30;

    const rival = opponentFor(looked, 3);
    expect(contestedVote(neglected, rival).lost).toBeGreaterThan(
      contestedVote(looked, rival).lost,
    );
  });

  it('keeps the share inside 0..1 for any city', () => {
    for (const issues of [0, ISSUE.traffic | ISSUE.pollution | ISSUE.noService]) {
      const state = city();
      fill(state, issues);
      for (let term = 1; term <= 8; term++) {
        const { share, lost } = contestedVote(state, opponentFor(state, term));
        expect(Number.isFinite(share)).toBe(true);
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
        expect(lost).toBeGreaterThanOrEqual(0);
        expect(lost).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has nothing to take from a faction that was giving nothing', () => {
    // A faction at zero approval contributes zero to the count, so there is no
    // slice to poach — the arithmetic must not invent one.
    const state = city();
    state.population = 0;
    const { lost } = contestedVote(state, opponentFor(state, 3));
    expect(lost).toBe(0);
  });
});

describe('what the panel is told', () => {
  it('quotes the same contested share the election will count', () => {
    // The failure this prevents: a panel promising 55% and an election
    // delivering 48%, with the difference invisible.
    const state = city();
    fill(state);
    state.playedMs = TERM_MS * 2 + 100;
    const standing = standingNow(state);
    const rival = opponentFor(state, termOf(state.playedMs) + 1);
    expect(standing.opponent).toEqual(rival);
    expect(standing.share).toBeCloseTo(contestedVote(state, rival).share, 10);
  });

  it('looks forward to the vote the player can still act on', () => {
    const state = city();
    fill(state);
    state.playedMs = TERM_MS * 2 + 100;
    // Term 2 is settled; the one worth campaigning for is term 3.
    expect(standingNow(state).opponent?.term).toBe(3);
  });

  it('names nobody after a coup', () => {
    const state = city();
    fill(state);
    seizePower(state);
    expect(standingNow(state).opponent).toBeNull();
  });

  it('still reports a share for a city with no measurable factions', () => {
    // Zero here would read as "nobody supports me", which is not what an
    // unmeasurable city means.
    const state = city();
    state.population = 0;
    const standing = standingNow(state);
    expect(Number.isFinite(standing.share)).toBe(true);
    expect(standing.lost).toBe(0);
  });
});

describe('the vote itself', () => {
  it('reports who stood, and what they took', () => {
    const state = city();
    fill(state);
    state.happiness = 95;
    state.playedMs = TERM_MS + 100;
    const [event] = stepElections(state, 1);
    expect(event?.opponent).not.toBeNull();
    expect(event?.opponent?.term).toBe(1);
    expect(event?.lostToOpponent).toBeGreaterThanOrEqual(0);
  });

  it('can turn a win into a defeat where the mayor was already weak', () => {
    // A vote that no candidate could ever swing would make the opposition
    // scenery. Walk the seeds until one produces a contest that flips it.
    let flipped = false;
    for (let seed = 0; seed < 60 && !flipped; seed++) {
      const state = city(`flip-${seed}`);
      fill(state, ISSUE.traffic | ISSUE.pollution);
      state.happiness = 52;
      state.playedMs = TERM_MS + 100;
      const rival = opponentFor(state, 1);
      const alone = contestedVote(state, null).share;
      const contested = contestedVote(state, rival).share;
      if (alone >= 0.5 && contested < 0.5) flipped = true;
    }
    expect(flipped).toBe(true);
  });

  it('reports nobody standing after a coup, because no vote is held', () => {
    const state = city();
    fill(state);
    seizePower(state);
    state.playedMs = TERM_MS * 3 + 100;
    expect(stepElections(state, 1)).toHaveLength(0);
  });

  it('leaves every faction reading inside 0..1 through a contested vote', () => {
    const state = city();
    fill(state, ISSUE.traffic);
    state.playedMs = TERM_MS + 100;
    stepElections(state, 1);
    for (const group of readGroups(state)) {
      expect(group.approval).toBeGreaterThanOrEqual(0);
      expect(group.approval).toBeLessThanOrEqual(1);
    }
  });
});
