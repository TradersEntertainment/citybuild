import { BUILDING_EVAL_S, FIELD_DIFFUSION_S, TRAFFIC_REFRESH_S } from '../data/balance';
import { evaluateBuildings, totalBuildings } from './buildings';
import { computeConnectivity } from './connectivity';
import { createDiffusionScratch, diffuseFields, type DiffusionScratch } from './diffusion';
import { stepEconomy } from './economy';
import { computeLandValue, computeRoadDistance, createFields, type Fields } from './fields';
import { stepHazards, type HazardEvent } from './hazards';
import type { Mission } from '../data/missions';
import { settleMissions } from './missions';
import { stepPopulation } from './population';
import { createRng } from './rng';
import { stepTimeline, type TimelineFired } from './timeline';
import { stepResearch } from './tech';
import { computeServiceCoverage } from './services';
import { computeTraffic, createTrafficField, type TrafficField } from './traffic';
import { computeUtilityCoverage } from './utilities';
import { stepProgression } from './progression';
import type { GameState } from './state';
import type { Era } from './tiles';

/** Shared empty result, so the common no-goals-finished frame allocates nothing. */
const EMPTY_MISSIONS: readonly Mission[] = [];
const EMPTY_HAZARDS: readonly HazardEvent[] = [];
const EMPTY_TIMELINE: readonly TimelineFired[] = [];

/**
 * Runs the simulation's systems at their own cadences (§11). Heavy passes are
 * deliberately slow and staggered; the frame loop only tells this module how
 * much time has gone by.
 *
 * Pure with respect to the platform: it takes seconds, not timestamps, so the
 * offline path in Phase 4 can drive exactly the same code.
 */
export class Systems {
  readonly fields: Fields;
  readonly traffic: TrafficField;
  private buildingTimer = 0;
  private diffusionTimer = FIELD_DIFFUSION_S; // solve once on the first step
  private trafficTimer = TRAFFIC_REFRESH_S;
  private fieldsDirty = true;
  private readonly completedMissions: Mission[] = [];
  private readonly hazardEvents: HazardEvent[] = [];
  private readonly timelineFired: TimelineFired[] = [];
  private readonly diffusion: DiffusionScratch;
  /** Steps so far; seeds the hazard dice, so a seed plus a count reproduces a blaze. */
  private hazardTick = 0;

  constructor(size: number) {
    this.fields = createFields(size);
    this.diffusion = createDiffusionScratch(size);
    this.traffic = createTrafficField(size);
  }

  /** Called when roads or parcels change; the derived fields must be redone. */
  invalidateFields(): void {
    this.fieldsDirty = true;
  }

  /**
   * Advances the world by `dt` seconds. Returns the era if one was reached, so
   * the caller can react without polling.
   *
   * Hazards only strike while somebody is watching (`hazardsLive`): a fire is
   * a drama you answer, and a city that burned down during an eight-hour
   * absence is a punishment for not playing, which is the one thing an idle
   * game must never do. Away time stays calm — see offline.ts.
   */
  step(state: GameState, dt: number, hazardsLive = true): Era | null {
    if (this.fieldsDirty) {
      // Which streets reach the country decides which streets count at all;
      // it has to be settled before road access is measured from them.
      computeConnectivity(state.world);
      computeRoadDistance(state.world, this.fields.roadDistance);
      computeTraffic(state, this.fields, this.traffic);
      computeLandValue(state.world, this.fields, this.traffic);
      // Coverage is gated on road access, so it is only valid once the road
      // distance field beside it has been rebuilt.
      computeServiceCoverage(state, this.fields);
      // After the civic services, because it clears only the two bits it owns
      // and would otherwise be wiped by the wholesale rebuild above.
      computeUtilityCoverage(state, this.fields);
      this.fieldsDirty = false;
    }

    // Traffic before the fields that read it: land value answers to congestion,
    // and a plot beside a jam should be scored as one.
    this.trafficTimer += dt;
    if (this.trafficTimer >= TRAFFIC_REFRESH_S) {
      computeTraffic(state, this.fields, this.traffic);
      computeLandValue(state.world, this.fields, this.traffic);
      this.trafficTimer = 0;
    }

    // Pollution and noise before the building pass, so a factory that appeared
    // last tick is already staining its neighbours when they are scored.
    this.diffusionTimer += dt;
    if (this.diffusionTimer >= FIELD_DIFFUSION_S) {
      diffuseFields(state, this.diffusion);
      this.diffusionTimer = 0;
    }

    this.buildingTimer += dt;
    if (this.buildingTimer >= BUILDING_EVAL_S) {
      evaluateBuildings(state, this.fields, this.buildingTimer, this.traffic);
      this.buildingTimer = 0;
    }

    // History and chaos keep the same rule: they only happen to a watching
    // city. Away time passes in years, but the events wait for somebody to
    // happen to.
    if (hazardsLive) {
      this.timelineFired.push(...stepTimeline(state, dt));

      // Chaos on its own clock: a fire does not wait for the building pass.
      // The dice come from the seed and the step count — no Math.random under
      // src/sim, so a test can replay a blaze exactly.
      const dice = createRng(state.seed ^ Math.imul(this.hazardTick + 1, 0x9e3779b1));
      this.hazardTick++;
      this.hazardEvents.push(...stepHazards(state, dt, () => dice.next()));
    }

    const totals = totalBuildings(state);
    stepPopulation(state, totals, dt);
    stepResearch(state, dt);
    const era = stepProgression(state);

    // Goals settle on the simulation's clock rather than the frame loop's, so
    // the offline catch-up completes them exactly as a live session would — the
    // city really did the work while nobody was watching. The caller drains the
    // list; nothing here waits on it.
    this.completedMissions.push(...settleMissions(state));
    return era;
  }

  /** Goals finished since the last drain, for the UI to announce. */
  drainCompletedMissions(): readonly Mission[] {
    if (this.completedMissions.length === 0) return EMPTY_MISSIONS;
    return this.completedMissions.splice(0, this.completedMissions.length);
  }

  /** Fires and outbreaks since the last drain, for the UI to announce. */
  drainHazardEvents(): readonly HazardEvent[] {
    if (this.hazardEvents.length === 0) return EMPTY_HAZARDS;
    return this.hazardEvents.splice(0, this.hazardEvents.length);
  }

  /** History that arrived since the last drain, for the UI to announce. */
  drainTimelineEvents(): readonly TimelineFired[] {
    if (this.timelineFired.length === 0) return EMPTY_TIMELINE;
    return this.timelineFired.splice(0, this.timelineFired.length);
  }

  /** Called at the economy cadence (1 Hz), separately from the sim step. */
  stepEconomy(state: GameState, dt: number): void {
    stepEconomy(state, this.fields, dt);
  }
}
