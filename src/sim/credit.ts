import {
  LOAN_INSTALMENT_MIN,
  LOAN_INTEREST,
  LOAN_INTEREST_STACKED,
  LOAN_TERM_MINUTES,
  LOAN_TO_INCOME,
  LOAN_MIN_PRINCIPAL,
} from '../data/balance';
import type { GameState } from './state';

/**
 * Borrowing (§7).
 *
 * The balance floors at zero, so a city that overspends does not fail — it
 * stops. Nothing is demolished, nothing is lost, the player simply waits for
 * the tax to trickle back in with no decision to make. That is the worst thing
 * a city builder's economy can do: the moment it becomes interesting is exactly
 * the moment it takes the controls away.
 *
 * A loan turns that into a choice. The bank lends against what the city earns
 * rather than what it has, so the offer scales with the city and a struggling
 * one cannot borrow its way into a hole it will never climb out of. A second
 * loan on top of a first costs nearly double the interest, which is the whole
 * lesson: credit is a bridge, not an income.
 */
export interface Loan {
  id: number;
  /** What was borrowed. */
  principal: number;
  /** What is still owed, interest included. */
  outstanding: number;
  /** Repaid per minute, taken out of the ledger before anything else. */
  instalment: number;
  rate: number;
}

export interface LoanOffer {
  /** What the bank will lend right now. Zero when it will not. */
  principal: number;
  rate: number;
  instalment: number;
  /** Why not, when principal is zero. */
  reason?: 'tooPoor' | 'tooManyLoans';
}

/** Loans a city may carry at once. Past this the rate stops being the deterrent. */
export const MAX_LOANS = 2;

/**
 * What the bank will lend.
 *
 * Against income, not against the balance: lending against savings would offer
 * most to the player who needs it least, and nothing to the one stuck at zero —
 * which is the entire case this exists for.
 */
export function loanOffer(state: GameState): LoanOffer {
  const rate = state.loans.length === 0 ? LOAN_INTEREST : LOAN_INTEREST_STACKED;
  if (state.loans.length >= MAX_LOANS) {
    return { principal: 0, rate, instalment: 0, reason: 'tooManyLoans' };
  }

  // Gross income rather than net: a city whose upkeep is currently eating
  // everything is precisely the one with a reason to borrow.
  const perMinute = Math.max(0, state.ledger.taxIncome);
  const principal = Math.round(perMinute * LOAN_TO_INCOME);
  if (principal < LOAN_MIN_PRINCIPAL) {
    return { principal: 0, rate, instalment: 0, reason: 'tooPoor' };
  }

  return { principal, rate, instalment: instalmentFor(principal, rate) };
}

/** Repayment per minute over the fixed term, never below the floor. */
export function instalmentFor(principal: number, rate: number): number {
  const total = principal * (1 + rate);
  return Math.max(LOAN_INSTALMENT_MIN, total / LOAN_TERM_MINUTES);
}

/** Takes the offer. Returns the loan, or null if the bank had none to give. */
export function borrow(state: GameState): Loan | null {
  const offer = loanOffer(state);
  if (offer.principal <= 0) return null;

  const loan: Loan = {
    id: state.nextLoanId++,
    principal: offer.principal,
    outstanding: Math.round(offer.principal * (1 + offer.rate)),
    instalment: offer.instalment,
    rate: offer.rate,
  };
  state.loans.push(loan);
  state.money += loan.principal;
  state.debt = totalDebt(state);
  return loan;
}

/**
 * One economy tick of repayment.
 *
 * Instalments come out of the balance and a loan closes itself when it is
 * settled. A city that cannot cover its instalment pays what it can and the
 * rest simply waits — a repossession system would be punishing a player for the
 * exact situation the loan was meant to get them out of.
 */
export function repayLoans(state: GameState, dt: number): number {
  if (state.loans.length === 0) {
    state.debt = 0;
    return 0;
  }

  let paid = 0;
  for (const loan of state.loans) {
    const due = Math.min(loan.outstanding, (loan.instalment * dt) / 60);
    const affordable = Math.min(due, state.money - paid);
    if (affordable <= 0) continue;
    loan.outstanding -= affordable;
    paid += affordable;
  }

  state.money -= paid;
  const before = state.loans.length;
  state.loans = state.loans.filter((loan) => loan.outstanding > 0.5);
  state.debt = totalDebt(state);
  // Told rather than inferred: the caller announces a loan that just closed.
  state.loansClosed += before - state.loans.length;
  return paid;
}

export function totalDebt(state: GameState): number {
  let total = 0;
  for (const loan of state.loans) total += loan.outstanding;
  return total;
}

/** Repayment per minute across every loan, for the ledger. */
export function debtService(state: GameState): number {
  let total = 0;
  for (const loan of state.loans) total += loan.instalment;
  return total;
}
