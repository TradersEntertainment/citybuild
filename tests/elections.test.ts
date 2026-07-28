import { describe, expect, it } from 'vitest';
import {
  ELECTION_THRESHOLD,
  MANDATE_CARD_FLOOR,
  MANDATE_CARD_SPAN,
  MANDATE_PER_CITIZEN,
  TAX_RATE_MAX,
  TERM_YEARS,
  VERDICT_MEMORY_S,
} from '../src/data/balance';
import { SECONDS_PER_YEAR } from '../src/data/timeline';
import {
  approval,
  secondsToElection,
  stepElections,
  termOf,
  verdictHappiness,
  type ElectionEvent,
} from '../src/sim/elections';
import { readReport } from '../src/sim/report';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';
import { ISSUE } from '../src/sim/tiles';
import { index, startingCentre } from '../src/sim/world';

/**
 * The vote (§30).
 *
 * Two properties carry the whole design. It is **not a lose condition** — a
 * beaten mayor keeps their city, their money and their map, because a city
 * builder that takes the city away has misunderstood what the player was
 * building. And a defeat is **never a surprise**: every term in the approval
 * score is a number already on a panel with a tool attached to it, and there are
 * no dice in the file at all.
 */

const TERM_MS = TERM_YEARS * SECONDS_PER_YEAR * 1000;

function city(people = 2_000): GameState {
  const game = createGameState(hashSeed('elections'), 0);
  game.era = 'city';
  game.population = people;
  game.happiness = 70;
  game.taxRate = 0.09;
  return game;
}

/** Runs the city to just past the end of term `n`. */
function toTerm(game: GameState, n: number): readonly ElectionEvent[] {
  game.playedMs = TERM_MS * n + 100;
  return stepElections(game, 1);
}

describe('the calendar', () => {
  it('counts terms from the founding', () => {
    expect(termOf(0)).toBe(0);
    expect(termOf(TERM_MS - 1)).toBe(0);
    expect(termOf(TERM_MS)).toBe(1);
    expect(termOf(TERM_MS * 4)).toBe(4);
  });

  it('counts down to the next one', () => {
    expect(secondsToElection(0)).toBeCloseTo(TERM_YEARS * SECONDS_PER_YEAR, 6);
    const half = TERM_MS / 2;
    expect(secondsToElection(half)).toBeCloseTo((TERM_YEARS * SECONDS_PER_YEAR) / 2, 6);
  });
});

describe('holding one', () => {
  it('holds nothing in the founding term', () => {
    const game = city();
    expect(stepElections(game, 1)).toEqual([]);
  });

  it('holds one when the calendar reaches it', () => {
    const game = city();
    const events = toTerm(game, 1);
    expect(events.map((e) => e.kind)).toEqual(['election']);
  });

  it('holds it once, not every step from then on', () => {
    const game = city();
    toTerm(game, 1);
    expect(stepElections(game, 1)).toEqual([]);
    expect(stepElections(game, 1)).toEqual([]);
  });

  it('holds every term that went past while nobody was watching', () => {
    // A player who leaves for an hour comes back to the votes that happened, in
    // order, rather than to one enormous one.
    const game = city();
    let held = 0;
    for (let term = 1; term <= 4; term++) held += toTerm(game, term).length;
    expect(held).toBe(4);
    expect(game.lastTermSettled).toBe(4);
  });

  it('settles every term an absence went past, not just the last', () => {
    // The offline path advances playedMs by the whole absence before it steps, so
    // several terms arrive here as one jump. Settling only the latest would dock
    // a player several mandates for having been away — the punishment-for-not-
    // playing that sim/offline.ts exists to refuse.
    const game = city();
    game.happiness = 90;
    const before = game.money;
    game.playedMs = TERM_MS * 4 + 100;
    const [event] = stepElections(game, 1);

    expect(event?.terms).toBe(4);
    expect(event?.grant).toBe(expectedGrant(game) * 4);
    expect(game.money).toBe(before + (event?.grant ?? 0));
    expect(game.lastTermSettled).toBe(4);
  });

  it('reports an absence as one line rather than five', () => {
    // Five toasts at once is not five pieces of news.
    const game = city();
    game.playedMs = TERM_MS * 5 + 100;
    expect(stepElections(game, 1)).toHaveLength(1);
  });

  it('skips a vote a settlement was too small to hold', () => {
    // Losing an election a city had nobody to hold is not a lesson.
    const game = city(0);
    expect(toTerm(game, 1)).toEqual([]);
  });
});

/** Puts a row of buildings on the map, so the report card has something to read. */
function fill(state: GameState, opts: { issues: number; level: number }): void {
  const centre = startingCentre(state.world);
  const x0 = Math.floor(centre.x) - 15;
  const y = Math.floor(centre.y);
  for (let n = 0; n < 30; n++) {
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x: x0 + n, y, zone: 'res', level: opts.level, score: 0.6,
      growthProgress: 0, decayTimer: 0, population: 20, jobs: 0,
      issues: opts.issues, output: 0, builtAt: 0, variantSeed: n,
    } as never);
    state.world.landValue[index(state.world, x0 + n, y)] = opts.issues === 0 ? 55 : 6;
  }
}

/**
 * What a term is worth for this city, as the sim computes it.
 *
 * Derived rather than hard-coded since §25: the grant answers to the report
 * card as well as to the population, so a fixture asserting the bare
 * population product would be pinning a formula the game no longer uses.
 */
function expectedGrant(state: GameState): number {
  const standard = MANDATE_CARD_FLOOR + MANDATE_CARD_SPAN * readReport(state).overall;
  return Math.round(state.population * MANDATE_PER_CITIZEN * standard);
}

describe('what the city is judging', () => {
  it('reads the mood above everything else', () => {
    const glum = city();
    glum.happiness = 10;
    const cheerful = city();
    cheerful.happiness = 95;
    expect(approval(cheerful)).toBeGreaterThan(approval(glum) + 0.4);
  });

  it('marks a mayor down for the tax rate', () => {
    const light = city();
    light.taxRate = 0;
    const heavy = city();
    heavy.taxRate = TAX_RATE_MAX;
    expect(approval(light)).toBeGreaterThan(approval(heavy));
  });

  it('marks one down for a city going backwards', () => {
    const solvent = city();
    solvent.ledger.net = 500;
    const sinking = city();
    sinking.ledger.net = -500;
    expect(approval(solvent)).toBeGreaterThan(approval(sinking));
  });

  it('marks one down for the bins', () => {
    const clean = city();
    const filthy = city();
    filthy.rubbish = 100_000;
    expect(approval(clean)).toBeGreaterThan(approval(filthy));
  });

  it('stays inside nought and one however bad it gets', () => {
    const ruined = city();
    ruined.happiness = 0;
    ruined.taxRate = TAX_RATE_MAX;
    ruined.ledger.net = -9_999;
    ruined.rubbish = 1_000_000;
    ruined.cohorts.awaitingBurial = 1_000_000;
    expect(approval(ruined)).toBeGreaterThanOrEqual(0);

    const perfect = city();
    perfect.happiness = 100;
    perfect.taxRate = 0;
    perfect.ledger.net = 9_999;
    expect(approval(perfect)).toBeLessThanOrEqual(1);
  });

  it('is reachable — a well-run city actually wins', () => {
    // A threshold nothing can clear is a scripted defeat wearing a score.
    const good = city();
    good.happiness = 80;
    good.taxRate = 0.08;
    good.ledger.net = 400;
    expect(approval(good)).toBeGreaterThan(ELECTION_THRESHOLD);
  });
});

describe('winning and losing', () => {
  it('pays a mandate scaled to the city', () => {
    const game = city();
    game.happiness = 90;
    const before = game.money;
    const [event] = toTerm(game, 1);
    expect(event?.verdict).toBe('won');
    expect(event?.terms).toBe(1);
    expect(event?.grant).toBe(expectedGrant(game));
    expect(game.money).toBe(before + (event?.grant ?? 0));
  });

  it('pays more for a better-run city of the same size (§25)', () => {
    // The grant is by a wide margin the largest sum in the game and used to
    // look only at population, so a mayor was paid for size alone. Same
    // population, same era, same everything — only the card differs.
    // The fixture sets a population without placing anything, and the card is
    // read off buildings — so both cities need a real street before the two can
    // differ on anything but size.
    const neglected = city();
    neglected.happiness = 90;
    fill(neglected, { issues: ISSUE.traffic | ISSUE.pollution | ISSUE.noService, level: 1 });
    const cared = city();
    cared.happiness = 90;
    fill(cared, { issues: 0, level: 5 });

    expect(cared.population).toBe(neglected.population);
    const [good] = toTerm(cared, 1);
    const [bad] = toTerm(neglected, 1);
    expect(good?.grant ?? 0).toBeGreaterThan(bad?.grant ?? 0);
  });

  it('never pays nothing for a won term, however badly the city scores', () => {
    // The floor is what stops this being a second lose condition: winning a
    // vote always pays something, even in a city that scores zero.
    const game = city();
    game.happiness = 90;
    fill(game, { issues: ISSUE.traffic | ISSUE.pollution | ISSUE.noService, level: 1 });
    const [event] = toTerm(game, 1);
    expect(event?.verdict).toBe('won');
    expect(event?.grant ?? 0).toBeGreaterThan(0);
  });

  it('takes nothing away on a defeat', () => {
    // Not a lose condition. A beaten mayor keeps their city, their money and
    // their map; what they lose is the grant.
    const game = city();
    game.happiness = 5;
    game.taxRate = TAX_RATE_MAX;
    const before = { money: game.money, population: game.population, buildings: game.buildings.size };
    const [event] = toTerm(game, 1);
    expect(event?.verdict).toBe('lost');
    expect(event?.grant).toBe(0);
    expect(game.money).toBe(before.money);
    expect(game.population).toBe(before.population);
    expect(game.buildings.size).toBe(before.buildings);
  });

  it('lifts the mood after a win and dents it after a defeat', () => {
    const won = city();
    won.happiness = 90;
    toTerm(won, 1);
    expect(verdictHappiness(won)).toBeGreaterThan(0);

    const lost = city();
    lost.happiness = 5;
    lost.taxRate = TAX_RATE_MAX;
    toTerm(lost, 1);
    expect(verdictHappiness(lost)).toBeLessThan(0);
  });

  it('forgets either one inside the next term', () => {
    // A permanent mark would make one bad vote compound into every one after it,
    // which is a spiral rather than a game.
    const game = city();
    game.happiness = 5;
    game.taxRate = TAX_RATE_MAX;
    toTerm(game, 1);
    expect(verdictHappiness(game)).toBeLessThan(0);
    for (let s = 0; s < VERDICT_MEMORY_S + 2; s++) stepElections(game, 1);
    expect(verdictHappiness(game)).toBe(0);
  });

  it('counts nothing before the first vote', () => {
    expect(verdictHappiness(city())).toBe(0);
  });
});

describe('across a save', () => {
  it('does not re-run a vote already held', () => {
    const game = city();
    toTerm(game, 2);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game)))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.lastTermSettled).toBe(2);
    loaded.playedMs = game.playedMs;
    expect(stepElections(loaded, 1)).toEqual([]);
  });

  it('opens a file written before the city held votes', () => {
    const game = city();
    const data = serialize(game) as unknown as Record<string, unknown>;
    delete data['lastTermSettled'];
    const loaded = deserialize(JSON.parse(JSON.stringify(data))) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.lastTermSettled).toBe(0);
  });

  it('ignores rubbish where a term number should be', () => {
    const game = city();
    const data = serialize(game) as unknown as Record<string, unknown>;
    data['lastTermSettled'] = 'ages ago';
    expect((deserialize(JSON.parse(JSON.stringify(data))) as GameState).lastTermSettled).toBe(0);
  });
});
