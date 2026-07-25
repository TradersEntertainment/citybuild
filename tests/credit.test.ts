import { beforeEach, describe, expect, it } from 'vitest';
import { LOAN_INTEREST, LOAN_INTEREST_STACKED, LOAN_TERM_MINUTES } from '../src/data/balance';
import { borrow, debtService, loanOffer, MAX_LOANS, repayLoans } from '../src/sim/credit';
import { createFields } from '../src/sim/fields';
import { stepEconomy } from '../src/sim/economy';
import { hashSeed } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState, type GameState } from '../src/sim/state';

/**
 * The balance floors at zero, so a city that overspends does not fail — it
 * stops, with nothing to decide. The loan exists to turn that dead end into a
 * choice, which means the tests that matter are the ones about who can borrow
 * and what it costs them.
 */
let game: GameState;

/** A city earning this much a minute, without building one. */
function earning(perMinute: number): void {
  game.ledger.taxIncome = perMinute;
}

beforeEach(() => {
  game = createGameState(hashSeed('credit'), 0);
  game.money = 0;
});

describe('what the bank will lend', () => {
  it('nothing to a city with no income', () => {
    earning(0);
    const offer = loanOffer(game);
    expect(offer.principal).toBe(0);
    expect(offer.reason).toBe('tooPoor');
  });

  it('lends against income rather than against savings', () => {
    earning(400);
    const broke = loanOffer(game).principal;
    game.money = 500_000;
    // The same city, now rich: the offer is about what it earns, not what it
    // has — lending against savings would offer most to whoever needs it least.
    expect(loanOffer(game).principal).toBe(broke);
  });

  it('offers more to a bigger city', () => {
    earning(200);
    const small = loanOffer(game).principal;
    earning(2_000);
    expect(loanOffer(game).principal).toBeGreaterThan(small);
  });

  it('charges nearly double on a second loan', () => {
    earning(1_000);
    expect(loanOffer(game).rate).toBe(LOAN_INTEREST);
    borrow(game);
    expect(loanOffer(game).rate).toBe(LOAN_INTEREST_STACKED);
    expect(LOAN_INTEREST_STACKED).toBeGreaterThan(LOAN_INTEREST);
  });

  it('stops at two, where the rate has stopped being the deterrent', () => {
    earning(1_000);
    for (let i = 0; i < MAX_LOANS; i++) expect(borrow(game)).not.toBeNull();
    expect(borrow(game)).toBeNull();
    expect(loanOffer(game).reason).toBe('tooManyLoans');
    expect(game.loans).toHaveLength(MAX_LOANS);
  });
});

describe('taking one', () => {
  it('puts the money in the balance', () => {
    earning(1_000);
    const offer = loanOffer(game);
    borrow(game);
    expect(game.money).toBe(offer.principal);
  });

  it('owes back more than it lent', () => {
    earning(1_000);
    const loan = borrow(game);
    expect(loan!.outstanding).toBeGreaterThan(loan!.principal);
  });

  it('records the debt where the UI can read it', () => {
    earning(1_000);
    const loan = borrow(game);
    expect(game.debt).toBe(loan!.outstanding);
  });
});

describe('paying it back', () => {
  it('clears over the term', () => {
    earning(1_000);
    borrow(game);
    game.money = 1_000_000;
    // The term, a minute at a time.
    for (let m = 0; m < LOAN_TERM_MINUTES + 1; m++) repayLoans(game, 60);
    expect(game.loans).toHaveLength(0);
    expect(game.debt).toBe(0);
  });

  it('takes the instalment out of the balance', () => {
    earning(1_000);
    borrow(game);
    const before = game.money;
    repayLoans(game, 60);
    expect(game.money).toBeLessThan(before);
  });

  it('waits rather than repossessing when the city cannot pay', () => {
    earning(1_000);
    const loan = borrow(game);
    game.money = 0;
    const owed = loan!.outstanding;
    repayLoans(game, 60);
    // Nothing paid, nothing seized: the loan existed to get the player out of
    // exactly this, so punishing them for it would be the wrong way round.
    expect(game.money).toBe(0);
    expect(game.loans[0]?.outstanding).toBe(owed);
  });

  it('says so once, when a loan closes', () => {
    earning(1_000);
    borrow(game);
    game.money = 1_000_000;
    for (let m = 0; m < LOAN_TERM_MINUTES + 1; m++) repayLoans(game, 60);
    expect(game.loansClosed).toBe(1);
    game.loansClosed = 0;
    repayLoans(game, 60);
    expect(game.loansClosed).toBe(0);
  });
});

describe('what the ledger says about it', () => {
  it('counts the instalment as an outgoing', () => {
    const fields = createFields(game.world.size);
    earning(1_000);
    borrow(game);
    const ledger = stepEconomy(game, fields, 1);
    expect(ledger.debtService).toBeCloseTo(debtService(game), 6);
    expect(ledger.debtService).toBeGreaterThan(0);
  });

  it('leaves the net lower than the same city without a loan', () => {
    const fields = createFields(game.world.size);
    const clean = stepEconomy(game, fields, 1).net;
    earning(1_000);
    borrow(game);
    expect(stepEconomy(game, fields, 1).net).toBeLessThan(clean + 1_000);
  });

  it('does not charge the instalment twice', () => {
    const fields = createFields(game.world.size);
    earning(0);
    game.money = 100_000;
    game.ledger.taxIncome = 1_000;
    borrow(game);
    const owed = game.loans[0]!.outstanding;
    const before = game.money;
    stepEconomy(game, fields, 60);
    const paid = before - game.money;
    // One minute, one instalment: the economy step must not take it out of the
    // balance and again through `net`.
    expect(paid).toBeCloseTo(owed - game.loans[0]!.outstanding, 4);
  });
});

describe('across a save', () => {
  it('carries the loan and what is left on it', () => {
    earning(1_000);
    const loan = borrow(game);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    expect(loaded).not.toBeNull();
    expect(loaded!.loans).toHaveLength(1);
    expect(loaded!.loans[0]?.outstanding).toBeCloseTo(loan!.outstanding, 2);
    expect(loaded!.debt).toBeCloseTo(loan!.outstanding, 2);
  });

  it('loads a file written before the bank existed', () => {
    const data = JSON.parse(JSON.stringify(serialize(game))) as Record<string, unknown>;
    delete data['loans'];
    const loaded = deserialize(data);
    expect(loaded).not.toBeNull();
    expect(loaded!.loans).toEqual([]);
    expect(loaded!.debt).toBe(0);
  });
});
