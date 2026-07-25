import { BUILDING_EVAL_S, FIELD_DIFFUSION_S, TRAFFIC_REFRESH_S } from '../data/balance';
import { evaluateBuildings, totalBuildings } from './buildings';
import { createDiffusionScratch, diffuseFields, type DiffusionScratch } from './diffusion';
import { stepEconomy } from './economy';
import { computeLandValue, computeRoadDistance, createFields, type Fields } from './fields';
import { stepPopulation } from './population';
import { computeServiceCoverage } from './services';
import { computeTraffic, createTrafficField, type TrafficField } from './traffic';
import { computeUtilityCoverage } from './utilities';
import { stepProgression } from './progression';
import type { GameState } from './state';
import type { Era } from './tiles';

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
  private readonly diffusion: DiffusionScratch;

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
   */
  step(state: GameState, dt: number): Era | null {
    if (this.fieldsDirty) {
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

    const totals = totalBuildings(state);
    stepPopulation(state, totals, dt);
    return stepProgression(state);
  }

  /** Called at the economy cadence (1 Hz), separately from the sim step. */
  stepEconomy(state: GameState, dt: number): void {
    stepEconomy(state, this.fields, dt);
  }
}
