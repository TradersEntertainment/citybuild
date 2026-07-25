import { BUILDING_EVAL_S } from '../data/balance';
import { evaluateBuildings, totalBuildings } from './buildings';
import { stepEconomy } from './economy';
import { computeLandValue, computeRoadDistance, createFields, type Fields } from './fields';
import { stepPopulation } from './population';
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
  private buildingTimer = 0;
  private fieldsDirty = true;

  constructor(size: number) {
    this.fields = createFields(size);
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
      computeLandValue(state.world, this.fields);
      this.fieldsDirty = false;
    }

    this.buildingTimer += dt;
    if (this.buildingTimer >= BUILDING_EVAL_S) {
      evaluateBuildings(state, this.fields, this.buildingTimer);
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
