import {
  EPIDEMIC_DRAIN_PER_SEC,
  EPIDEMIC_DURATION_S,
  EPIDEMIC_MIN_POP,
  EPIDEMIC_PER_SEC,
  FIRE_BURNOUT_S,
  FIRE_COVERED_IGNITION_MULT,
  FIRE_IGNITION_PER_SEC,
  FIRE_LEVEL_IGNITION_STEP,
  FIRE_RESPONSE_S,
  FIRE_SPREAD_CHANCE,
  FIRE_SPREAD_RADIUS,
  FIRE_SPREAD_S,
} from '../data/balance';
import { demolish, type Building } from './buildings';
import { drainPopulation } from './population';
import { eraReached, SERVICE } from './tiles';
import type { GameState } from './state';
import { index } from './world';

/**
 * The chaos a city has to answer (§13).
 *
 * Services were, until now, a happiness tax you paid to keep a score up — a
 * duty, not a drama. Hazards make them the thing standing between the city and
 * the evening news: fires catch, spread and take buildings with them unless a
 * fire station can reach the street; epidemics arrive unannounced and empty
 * homes unless a hospital stands between the sickness and the town. Both are
 * rolled per second against the whole city, so a bigger city is a bigger
 * target — growth is what you insure against, not what protects you.
 *
 * Randomness is injected: the scheduler passes dice seeded from the world seed
 * and the step count, the tests pass a script — no Math.random under src/sim.
 * Nothing here is saved — a fire is a moment, and a city saved mid-blaze
 * reloads to find the moment passed, which is kinder and keeps the save schema
 * exactly as it was.
 */
export interface Fire {
  id: number;
  x: number;
  y: number;
  buildingId: number;
  age: number;
  /** A fire station covers this street: the blaze is being fought. */
  covered: boolean;
  /** Age at which the last spread attempt was rolled. */
  lastSpread: number;
}

export interface Epidemic {
  age: number;
  duration: number;
  /** 0..1: how hard it bites; hospital coverage pulls this down. */
  severity: number;
  /** Share of residents living on health-covered ground when it started. */
  coveredShare: number;
  /** People the sickness has taken so far. */
  toll: number;
}

export type HazardEventKind =
  | 'fireStart'
  | 'fireOut'
  | 'fireLost'
  | 'fireRaging'
  | 'epidemicStart'
  | 'epidemicEndMild'
  | 'epidemicEndSevere';

export interface HazardEvent {
  kind: HazardEventKind;
  x?: number;
  y?: number;
}

/** Above this many simultaneous fires the city is, by any measure, burning. */
const RAGING_FIRES = 3;
/** A covered epidemic is a scare; worse than this share lost is a catastrophe. */
const SEVERE_TOLL_SHARE = 0.06;

/**
 * Advances fires and epidemics by `dt` seconds. Returns what happened, so the
 * caller can tell the player — the sim itself stays quiet and deterministic.
 */
export function stepHazards(
  state: GameState,
  dt: number,
  rand: () => number,
): HazardEvent[] {
  const events: HazardEvent[] = [];
  stepFires(state, dt, rand, events);
  stepEpidemic(state, dt, rand, events);
  return events;
}

// --- Fire -------------------------------------------------------------------

function stepFires(
  state: GameState,
  dt: number,
  rand: () => number,
  events: HazardEvent[],
): void {
  const wasRaging = state.fires.size >= RAGING_FIRES;

  // Ignition: every standing building is a small per-second risk, taller ones
  // a little more so, and a fire station on the street cuts both the chance
  // and — separately — the damage.
  if (eraReached(state.era, 'village')) {
    for (const building of state.buildings.values()) {
      if (burningAt(state, building.id)) continue;
      const covered = coveredBy(state, building, SERVICE.fire);
      let chance = FIRE_IGNITION_PER_SEC * dt;
      chance *= 1 + (building.level - 1) * FIRE_LEVEL_IGNITION_STEP;
      if (covered) chance *= FIRE_COVERED_IGNITION_MULT;
      if (rand() < chance) ignite(state, building, covered, events);
    }
  }

  // Burning: fought fires go out, unfought ones spread and then take the house.
  for (const fire of [...state.fires.values()]) {
    fire.age += dt;
    const building = state.buildings.get(fire.buildingId);
    if (!building) {
      state.fires.delete(fire.id);
      continue;
    }

    if (fire.covered) {
      if (fire.age >= FIRE_RESPONSE_S) {
        state.fires.delete(fire.id);
        events.push({ kind: 'fireOut', x: fire.x, y: fire.y });
      }
      continue;
    }

    if (fire.age - fire.lastSpread >= FIRE_SPREAD_S) {
      fire.lastSpread = fire.age;
      if (rand() < FIRE_SPREAD_CHANCE) spread(state, fire, rand, events);
    }

    if (fire.age >= FIRE_BURNOUT_S) {
      demolish(state, building);
      state.fires.delete(fire.id);
      events.push({ kind: 'fireLost', x: fire.x, y: fire.y });
    }
  }

  if (!wasRaging && state.fires.size >= RAGING_FIRES) {
    events.push({ kind: 'fireRaging' });
  }
}

function ignite(
  state: GameState,
  building: Building,
  covered: boolean,
  events: HazardEvent[],
): void {
  const id = state.nextFireId++;
  state.fires.set(id, {
    id,
    x: building.x,
    y: building.y,
    buildingId: building.id,
    age: 0,
    covered,
    lastSpread: 0,
  });
  // Everyone gets out at the first alarm; whether there is a home to come back
  // to is what the next minute decides.
  building.population = 0;
  events.push({ kind: 'fireStart', x: building.x, y: building.y });
}

/** The fire jumps to a neighbour: one random building within reach. */
function spread(
  state: GameState,
  fire: Fire,
  rand: () => number,
  events: HazardEvent[],
): void {
  const candidates: Building[] = [];
  for (const building of state.buildings.values()) {
    if (building.id === fire.buildingId) continue;
    if (burningAt(state, building.id)) continue;
    const dx = Math.abs(building.x - fire.x);
    const dy = Math.abs(building.y - fire.y);
    if (dx + dy > FIRE_SPREAD_RADIUS) continue;
    candidates.push(building);
  }
  if (candidates.length === 0) return;
  const target = candidates[Math.floor(rand() * candidates.length)];
  if (!target) return;
  ignite(state, target, coveredBy(state, target, SERVICE.fire), events);
}

function burningAt(state: GameState, buildingId: number): boolean {
  for (const fire of state.fires.values()) {
    if (fire.buildingId === buildingId) return true;
  }
  return false;
}

// --- Epidemic ---------------------------------------------------------------

function stepEpidemic(
  state: GameState,
  dt: number,
  rand: () => number,
  events: HazardEvent[],
): void {
  if (!state.epidemic) {
    // A settlement too small to sneeze in unison is spared; from town life
    // onwards the chance is a steady per-second roll, so an outbreak arrives
    // every several minutes of city time and no city is ever simply done
    // with them.
    if (state.population < EPIDEMIC_MIN_POP) return;
    if (rand() >= EPIDEMIC_PER_SEC * dt) return;

    const coveredShare = healthCoveredShare(state);
    state.epidemic = {
      age: 0,
      duration: EPIDEMIC_DURATION_S * (1 - coveredShare * 0.55),
      severity: clamp(1 - coveredShare * 0.8, 0.12, 1),
      coveredShare,
      toll: 0,
    };
    events.push({ kind: 'epidemicStart' });
    return;
  }

  const epidemic = state.epidemic;
  epidemic.age += dt;

  // The sick either queue at a hospital or queue to leave: a per-second drain
  // on the whole population, scaled by how badly covered the city is.
  const loss = state.population * EPIDEMIC_DRAIN_PER_SEC * epidemic.severity * dt;
  if (loss > 0) {
    drainPopulation(state, loss);
    epidemic.toll += loss;
    refreshPopulation(state);
  }

  if (epidemic.age >= epidemic.duration) {
    const severe = epidemic.toll > Math.max(6, state.population * SEVERE_TOLL_SHARE);
    state.epidemic = null;
    events.push({ kind: severe ? 'epidemicEndSevere' : 'epidemicEndMild' });
  }
}

/** Share of residents whose homes a hospital or clinic actually reaches. */
export function healthCoveredShare(state: GameState): number {
  let residents = 0;
  let covered = 0;
  for (const building of state.buildings.values()) {
    if (building.zone !== 'res') continue;
    residents += building.population;
    if (coveredBy(state, building, SERVICE.health)) covered += building.population;
  }
  return residents > 0 ? covered / residents : 0;
}

function coveredBy(state: GameState, building: Building, bit: number): boolean {
  const mask = state.world.serviceMask[index(state.world, building.x, building.y)] ?? 0;
  return (mask & bit) !== 0;
}

/** The drain emptied homes; the headline figure has to say so at once. */
export function refreshPopulation(state: GameState): void {
  let total = 0;
  for (const building of state.buildings.values()) {
    if (building.zone === 'res') total += building.population;
  }
  state.population = total;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
