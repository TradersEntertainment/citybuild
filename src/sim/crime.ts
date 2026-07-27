import {
  CRIME_ARREST_S,
  CRIME_CAR_SPEED,
  CRIME_COMMERCIAL_MULT,
  CRIME_COVERED_MULT,
  CRIME_ESCAPE_HAPPINESS,
  CRIME_ESCAPE_MEMORY_S,
  CRIME_ESCAPE_S,
  CRIME_HAPPINESS_CAP,
  CRIME_HAPPINESS_HIT,
  CRIME_LOOT_BASE,
  CRIME_LOOT_PER_LEVEL,
  CRIME_MISERY_MULT,
  CRIME_NIGHT_MULT,
  CRIME_PER_SEC,
} from '../data/balance';
import type { Building } from './buildings';
import { dayFraction, nightAmount } from './daytime';
import { dispatchFrom, runArrived, runFinished, type TruckRun } from './dispatch';
import { budgetOf } from './budgets';
import { schoolingCrimeFactor } from './cohorts';
import { lightingShare } from './investments';
import { techFactor } from './tech';
import { eraReached, SERVICE } from './tiles';
import type { GameState } from './state';
import { index } from './world';

/**
 * Crime, and the finger that answers it (§13b).
 *
 * Every other hazard in the game happens *to* the player: a fire catches and
 * you either built the station in time or you did not. Crime is the one the
 * player answers by hand — a marker appears over a building, you tap it, and a
 * car leaves the nearest karakol to make the arrest. That is the whole reason it
 * exists: the city needed something to do in the minutes between decisions, and
 * a verb the player performs beats another number that goes up.
 *
 * The three cases, which are the design:
 *
 * - **A covered street reports itself.** A karakol whose radius reaches the
 *   building dispatches without being asked. This is what coverage buys, and it
 *   is why a big city is not an endless tapping chore — you grow out of the verb
 *   by paying for it.
 * - **An uncovered street waits for the player.** The marker sits there; tapping
 *   it sends a car from the nearest station, which is further away and therefore
 *   slower. Attention substitutes for money, which is the trade the early game
 *   is made of.
 * - **A city with no karakol at all can only watch.** Tapping says so rather
 *   than doing nothing, because a tap that neither works nor explains itself
 *   reads as a broken game.
 *
 * Night matters: crime roughly doubles after dark and the lighting programme
 * scales that back (data/balance.ts, CRIME_NIGHT_MULT). That is deliberate — it
 * gives the flagship purchase a third effect, in the direction a player already
 * expects lamps to work.
 *
 * Dice are injected and nothing here is saved, for the same reasons as the rest
 * of sim/hazards.ts: a crime is a moment, and a city reloaded finds the moment
 * passed.
 */
export interface Crime {
  id: number;
  x: number;
  y: number;
  buildingId: number;
  /** Seconds since it started. */
  age: number;
  /**
   * The car on its way, once one has been sent. Null means nobody is coming yet
   * — either the player has not tapped, or the city has no station to send from.
   */
  car: TruckRun | null;
  /** True when a karakol covering the street sent the car by itself. */
  automatic: boolean;
}

export type CrimeEventKind = 'crimeStart' | 'crimeSolved' | 'crimeEscaped';

export interface CrimeEvent {
  kind: CrimeEventKind;
  x?: number;
  y?: number;
  /** Money taken, on an escape. */
  loot?: number;
  /**
   * Whether the karakol handled this one without the player: a car sent the
   * moment it started, and an arrest made off the player's radar.
   *
   * The announcer needs it in both directions. On a start, a line telling the
   * player to tap a marker that was never drawn is worse than no line. On an
   * arrest, it is the difference between the payoff for a tap and a running
   * commentary on work the player paid to stop thinking about.
   */
  automatic?: boolean;
}

/** True once the car has reached the street and the officers are out of it. */
export function carArrived(crime: Crime): boolean {
  return crime.car !== null && runArrived(crime.car);
}

/** Whether the player still has to do something about this one. */
export function awaitingPlayer(crime: Crime): boolean {
  return crime.car === null;
}

/**
 * Advances crime by `dt` seconds.
 *
 * Ordered start-then-resolve like the fire pass, so a crime cannot begin and be
 * arrested inside one step: the player must get at least one frame's chance to
 * see the marker, or an automatic dispatch would make the manual verb invisible.
 */
export function stepCrime(state: GameState, dt: number, rand: () => number): CrimeEvent[] {
  const events: CrimeEvent[] = [];
  resolveCrimes(state, dt, events);
  startCrimes(state, dt, rand, events);
  if (state.crimeSting > 0) state.crimeSting = Math.max(0, state.crimeSting - dt);
  return events;
}

function startCrimes(
  state: GameState,
  dt: number,
  rand: () => number,
  events: CrimeEvent[],
): void {
  // A hamlet of six houses has no crime worth a marker; from a village on, it
  // does. Same gate as fire, for the same reason: the opening was tuned without
  // hazards in it and stays that way.
  if (!eraReached(state.era, 'village')) return;

  // Read the night once per step rather than per building — it cannot change
  // inside a tick, and the lighting share certainly cannot.
  const dark = nightAmount(dayFraction(state.playedMs)) * (1 - lightingShare(state));
  const nightMult = 1 + (CRIME_NIGHT_MULT - 1) * dark;
  // Misery breeds it, but bounded: crime lowers mood and low mood raises crime,
  // so the loop has to be a gentle slope rather than a spiral.
  const miseryMult = 1 + (CRIME_MISERY_MULT - 1) * (1 - state.happiness / 100);
  // A karakol on every street is dearer than learning to catch people, which is
  // what this tech is for (data/tech.ts, forensics).
  const forensics = techFactor(state, 'forensics');
  // And what the schools bought, a band late (sim/cohorts.ts). This is the pay-off
  // a player waits for: children schooled now are the workforce that does not rob
  // the place later, which is the longest-horizon decision in the game.
  const schooling = schoolingCrimeFactor(state);

  for (const building of state.buildings.values()) {
    if (crimeAt(state, building.id) !== null) continue;
    let chance = CRIME_PER_SEC * dt * nightMult * miseryMult * forensics * schooling;
    if (building.zone === 'com') chance *= CRIME_COMMERCIAL_MULT;
    const covered = coveredByPolice(state, building);
    // A watched street is watched harder or thinner depending on what the
    // karakols are funded at (sim/budgets.ts).
    if (covered) chance *= CRIME_COVERED_MULT / budgetOf(state, 'police');
    if (rand() >= chance) continue;

    const id = state.nextCrimeId++;
    // A covered street reports itself. An uncovered one waits for a finger —
    // and if there is no station anywhere, the car is null either way and the
    // crime simply runs, which is what having no police means.
    const car = covered ? dispatchFrom(state, 'police', building.x, building.y) : null;
    state.crimes.set(id, {
      id,
      x: building.x,
      y: building.y,
      buildingId: building.id,
      age: 0,
      car,
      automatic: car !== null,
    });
    events.push({ kind: 'crimeStart', x: building.x, y: building.y, automatic: car !== null });
  }
}

function resolveCrimes(state: GameState, dt: number, events: CrimeEvent[]): void {
  for (const crime of [...state.crimes.values()]) {
    crime.age += dt;
    const building = state.buildings.get(crime.buildingId);
    if (!building) {
      // The building went — burnt down, bulldozed. Nothing left to rob.
      state.crimes.delete(crime.id);
      continue;
    }

    if (crime.car) {
      crime.car.progress += CRIME_CAR_SPEED * budgetOf(state, 'police') * dt;
      if (runFinished(crime.car, CRIME_ARREST_S)) {
        state.crimes.delete(crime.id);
        events.push({
          kind: 'crimeSolved',
          x: crime.x,
          y: crime.y,
          automatic: crime.automatic,
        });
      }
      // A car already on the road beats the clock: an arrest in progress is not
      // interrupted by the escape timer, or a long drive would be a guaranteed
      // loss and dispatching would feel pointless.
      continue;
    }

    if (crime.age >= CRIME_ESCAPE_S) {
      const loot = lootOf(building);
      state.money -= loot;
      state.crimeSting = CRIME_ESCAPE_MEMORY_S;
      state.crimes.delete(crime.id);
      events.push({ kind: 'crimeEscaped', x: crime.x, y: crime.y, loot });
    }
  }
}

/**
 * The player tapped a building. Sends a car if there is one to send.
 *
 * Returns what to tell them: an arrest under way, no station in the city, or
 * nothing there at all. The caller turns that into a sentence — this stays pure.
 *
 * There is no "already sent" answer, because `crimeNear` does not offer an
 * answered crime: a second tap on the same spot finds the next unanswered one or
 * nothing, which is what makes tapping through a cluster work.
 */
export type DispatchResult = 'sent' | 'noStation' | 'noCrime';

export function dispatchPolice(state: GameState, tileX: number, tileY: number): DispatchResult {
  const crime = crimeNear(state, tileX, tileY);
  if (!crime) return 'noCrime';
  const car = dispatchFrom(state, 'police', crime.x, crime.y);
  if (!car) return 'noStation';
  crime.car = car;
  return 'sent';
}

/**
 * The crime a tap at this tile meant.
 *
 * A one-tile hit box is too mean on a phone — the marker floats above the
 * building and a finger lands where it looks, not where the tile boundary is —
 * so this takes the nearest unanswered crime within a small radius, preferring
 * the closest. Answered ones are skipped so a second tap falls through to the
 * crime behind rather than re-reporting the one already handled.
 */
export function crimeNear(state: GameState, tileX: number, tileY: number): Crime | null {
  let found: Crime | null = null;
  let best = Infinity;
  for (const crime of state.crimes.values()) {
    if (crime.car) continue;
    const d = Math.abs(crime.x - tileX) + Math.abs(crime.y - tileY);
    if (d > TAP_RADIUS || d >= best) continue;
    best = d;
    found = crime;
  }
  return found;
}

/** How far from a tap a crime still counts as tapped, in tiles. */
export const TAP_RADIUS = 2;

/** Mood cost of the crimes standing right now, plus the memory of the last one. */
export function crimeHappiness(state: GameState): number {
  let unanswered = 0;
  for (const crime of state.crimes.values()) if (!crime.car) unanswered++;
  const standing = Math.min(CRIME_HAPPINESS_CAP, unanswered * CRIME_HAPPINESS_HIT);
  // The sting fades rather than vanishing with the marker: a robbery the city
  // remembers for a minute is why the player bothers next time.
  const sting = state.crimeSting > 0 ? CRIME_ESCAPE_HAPPINESS : 0;
  const total = standing + sting;
  // Negated only when there is something to negate: −0 compares unequal to 0
  // under Object.is, and a quiet city should report a plain zero.
  return total === 0 ? 0 : -total;
}

/** What a successful robbery is worth to whoever ran off with it. */
export function lootOf(building: Building): number {
  const base = CRIME_LOOT_BASE + (building.level - 1) * CRIME_LOOT_PER_LEVEL;
  // A till holds more than a hallway.
  return Math.round(base * (building.zone === 'com' ? 1.6 : 1));
}

function crimeAt(state: GameState, buildingId: number): Crime | null {
  for (const crime of state.crimes.values()) {
    if (crime.buildingId === buildingId) return crime;
  }
  return null;
}

function coveredByPolice(state: GameState, building: Building): boolean {
  const mask = state.world.serviceMask[index(state.world, building.x, building.y)] ?? 0;
  return (mask & SERVICE.police) !== 0;
}
