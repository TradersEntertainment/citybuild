import { BUILDING_EVAL_S, FIELD_DIFFUSION_S, TRAFFIC_REFRESH_S } from '../data/balance';
import { evaluateBuildings, totalBuildings } from './buildings';
import { computeConnectivity } from './connectivity';
import { createDiffusionScratch, diffuseFields, type DiffusionScratch } from './diffusion';
import { stepEconomy } from './economy';
import {
  computeLandValue,
  computeParkValue,
  computeRoadDistance,
  createFields,
  type Fields,
} from './fields';
import { stepCohorts, type CohortEvent } from './cohorts';
import { stepCrime, type CrimeEvent } from './crime';
import { stepResources, type ResourceEvent } from './resources';
import { markUncollected, stepRubbish, type RubbishEvent } from './rubbish';
import { stepHazards, type HazardEvent } from './hazards';
import { stepHighwayWear, type HighwayWearEvent } from './highwayWear';
import type { Mission } from '../data/missions';
import { settleMissions } from './missions';
import { settlePetitions, type PetitionChanges, type PetitionKind } from './petitions';
import { refreshSeaGates } from './ports';
import { drainRituals, type RitualToday } from './rituals';
import { stepPopulation } from './population';
import { createRng } from './rng';
import { stepTimeline, type TimelineFired } from './timeline';
import { stepResearch } from './tech';
import { computeServiceCoverage } from './services';
import { computeTraffic, createTrafficField, type TrafficField } from './traffic';
import { computeVisitors, createVisitorField, type VisitorField } from './visitors';
import { computeUtilityCoverage } from './utilities';
import { stepProgression } from './progression';
import type { GameState } from './state';
import type { Era } from './tiles';

/** Shared empty result, so the common no-goals-finished frame allocates nothing. */
const EMPTY_MISSIONS: readonly Mission[] = [];
const EMPTY_HAZARDS: readonly HazardEvent[] = [];
const EMPTY_CRIMES: readonly CrimeEvent[] = [];
const EMPTY_COHORTS: readonly CohortEvent[] = [];
const EMPTY_RESOURCES: readonly ResourceEvent[] = [];
const EMPTY_RUBBISH: readonly RubbishEvent[] = [];
const EMPTY_ROAD: readonly HighwayWearEvent[] = [];
const EMPTY_TIMELINE: readonly TimelineFired[] = [];
const EMPTY_RITUALS: readonly RitualToday[] = [];

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
  /**
   * Where the country's traffic gets to inside the city (sim/visitors.ts).
   * Recomputed with the traffic it answers to, because a jam is what turns a
   * visitor round.
   */
  readonly visitors: VisitorField;
  private buildingTimer = 0;
  private diffusionTimer = FIELD_DIFFUSION_S; // solve once on the first step
  private trafficTimer = TRAFFIC_REFRESH_S;
  private fieldsDirty = true;
  private readonly completedMissions: Mission[] = [];
  /**
   * Petitions the city is currently making. Not saved: a reload re-raises
   * whatever is still wrong within a tick, which is the same city for less
   * machinery than a save-schema change.
   */
  private readonly standingPetitions = new Set<PetitionKind>();
  private readonly petitionChanges: PetitionChanges = { raised: [], resolved: [] };
  private readonly hazardEvents: HazardEvent[] = [];
  private readonly crimeEvents: CrimeEvent[] = [];
  private readonly cohortEvents: CohortEvent[] = [];
  private readonly resourceEvents: ResourceEvent[] = [];
  private readonly rubbishEvents: RubbishEvent[] = [];
  private readonly roadEvents: HighwayWearEvent[] = [];
  private readonly timelineFired: TimelineFired[] = [];
  /**
   * Holidays already read out, keyed by ritual and year. Not saved, like the
   * petitions: a reload during a fireworks display costs one extra line in the
   * feed, and the mood bonus is derived from the date rather than granted, so
   * nothing can be farmed by reloading.
   */
  private readonly announcedRituals = new Set<string>();
  private readonly ritualsFired: RitualToday[] = [];
  private readonly diffusion: DiffusionScratch;
  /** Steps so far; seeds the hazard dice, so a seed plus a count reproduces a blaze. */
  private hazardTick = 0;

  constructor(size: number) {
    this.fields = createFields(size);
    this.diffusion = createDiffusionScratch(size);
    this.traffic = createTrafficField(size);
    this.visitors = createVisitorField(size);
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
      // it has to be settled before road access is measured from them — and a
      // working harbour is one of the two ways to reach it (sim/ports.ts), so
      // the gate column is written first.
      refreshSeaGates(state);
      computeConnectivity(state.world);
      computeRoadDistance(state.world, this.fields.roadDistance);
      // Parks move only when the brush moves, so this rides the same invalidation
      // as the roads rather than the traffic clock.
      computeParkValue(state.world, this.fields.parkValue);
      computeTraffic(state, this.fields, this.traffic);
      this.refreshVisitors(state);
      computeLandValue(state.world, this.fields, this.traffic);
      // Coverage is gated on road access, so it is only valid once the road
      // distance field beside it has been rebuilt.
      computeServiceCoverage(state, this.fields);
      // After the civic services, because it clears only the two bits it owns
      // and would otherwise be wiped by the wholesale rebuild above.
      computeUtilityCoverage(state, this.fields);
      // Reads the depot bit the civic pass just wrote, so it runs after it.
      markUncollected(state);
      this.fieldsDirty = false;
    }

    // Traffic before the fields that read it: land value answers to congestion,
    // and a plot beside a jam should be scored as one.
    this.trafficTimer += dt;
    if (this.trafficTimer >= TRAFFIC_REFRESH_S) {
      computeTraffic(state, this.fields, this.traffic);
      this.refreshVisitors(state);
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
      // Crime draws from the same stream, after the fires. Sharing it keeps one
      // seed answerable for everything that goes wrong in a step; drawing from a
      // separate one would mean two counters to keep in step across a save.
      this.crimeEvents.push(...stepCrime(state, dt, () => dice.next()));

      // The convoys wear the motorway down, and peace slowly patches it. Live
      // only, and for the same reason as the fires: coming back from a night
      // away to find the road out of the city barricaded would be a punishment
      // for not playing. It also has to run after the timeline, which is what
      // says whether there is a war on at all.
      // The calendar's own dates, which come round every year rather than once.
      this.ritualsFired.push(...drainRituals(state, this.announcedRituals));

      // The seams under the city's workshops, worked down (sim/resources.ts).
      // Live only, and for the same reason as the fires: coming back from a night
      // away to find the coalfield gone is a punishment for not playing.
      this.resourceEvents.push(...stepResources(state, dt));

      const road = stepHighwayWear(state, dt);
      if (road.length > 0) {
        this.roadEvents.push(...road);
        // A stretch that shut or reopened changes which streets reach the
        // country, and that is the whole point of it.
        if (road.some((event) => event.kind !== 'damaged')) this.invalidateFields();
      }
    }

    const totals = totalBuildings(state);
    stepPopulation(state, totals, dt);
    // After the migration that fills the bands, so a cohort is aged in the same
    // step it arrived in rather than a tick late (sim/cohorts.ts).
    this.cohortEvents.push(...stepCohorts(state, dt, hazardsLive));
    // The bins fill whether or not anybody is watching; only the pile-up waits
    // for a player, which is the same rule the fires and the burials keep.
    this.rubbishEvents.push(...stepRubbish(state, dt, hazardsLive));
    stepResearch(state, dt);
    const era = stepProgression(state);

    // Goals settle on the simulation's clock rather than the frame loop's, so
    // the offline catch-up completes them exactly as a live session would — the
    // city really did the work while nobody was watching. The caller drains the
    // list; nothing here waits on it.
    this.completedMissions.push(...settleMissions(state));
    // Petitions read the issue flags the building pass has just written, so
    // they run after it and see this tick's city rather than last tick's.
    const petitions = settlePetitions(state, this.standingPetitions);
    this.petitionChanges.raised.push(...petitions.raised);
    this.petitionChanges.resolved.push(...petitions.resolved);
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

  /** The city falling behind on its burials, or catching up (sim/cohorts.ts). */
  drainCohortEvents(): readonly CohortEvent[] {
    if (this.cohortEvents.length === 0) return EMPTY_COHORTS;
    return this.cohortEvents.splice(0, this.cohortEvents.length);
  }

  /** The bins overflowing, or being caught up with (sim/rubbish.ts). */
  drainRubbishEvents(): readonly RubbishEvent[] {
    if (this.rubbishEvents.length === 0) return EMPTY_RUBBISH;
    return this.rubbishEvents.splice(0, this.rubbishEvents.length);
  }

  /** Seams worked out since the last drain (sim/resources.ts). */
  drainResourceEvents(): readonly ResourceEvent[] {
    if (this.resourceEvents.length === 0) return EMPTY_RESOURCES;
    return this.resourceEvents.splice(0, this.resourceEvents.length);
  }

  /** Crimes started, solved or lost since the last drain. */
  drainCrimeEvents(): readonly CrimeEvent[] {
    if (this.crimeEvents.length === 0) return EMPTY_CRIMES;
    return this.crimeEvents.splice(0, this.crimeEvents.length);
  }

  /** Motorway stretches damaged, shut or reopened since the last drain. */
  drainRoadEvents(): readonly HighwayWearEvent[] {
    if (this.roadEvents.length === 0) return EMPTY_ROAD;
    return this.roadEvents.splice(0, this.roadEvents.length);
  }

  /** Holidays that began since the last drain, for the UI to announce. */
  drainRituals(): readonly RitualToday[] {
    if (this.ritualsFired.length === 0) return EMPTY_RITUALS;
    return this.ritualsFired.splice(0, this.ritualsFired.length);
  }

  /** History that arrived since the last drain, for the UI to announce. */
  drainTimelineEvents(): readonly TimelineFired[] {
    if (this.timelineFired.length === 0) return EMPTY_TIMELINE;
    return this.timelineFired.splice(0, this.timelineFired.length);
  }

  /** Petitions raised and settled since the last drain, for the UI to announce. */
  drainPetitions(): PetitionChanges {
    const drained = {
      raised: this.petitionChanges.raised.splice(0, this.petitionChanges.raised.length),
      resolved: this.petitionChanges.resolved.splice(0, this.petitionChanges.resolved.length),
    };
    return drained;
  }

  /** Called at the economy cadence (1 Hz), separately from the sim step. */
  stepEconomy(state: GameState, dt: number): void {
    stepEconomy(state, this.fields, dt, this.visitors);
  }

  /**
   * Re-spreads the visitors. Runs with the traffic rather than on its own clock:
   * the flow it produces is thinned by congestion, so computing it against a
   * stale load field would pay shops for a jam that has already cleared.
   */
  private refreshVisitors(state: GameState): void {
    let shopJobs = 0;
    for (const building of state.buildings.values()) {
      if (building.zone === 'com') shopJobs += building.jobs;
    }
    computeVisitors(state, this.visitors, this.traffic.load, shopJobs);
  }
}
