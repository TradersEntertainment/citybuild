import './style.css';
import { bindAudioUnlock } from './audio/context';
import { createSfx } from './audio/sfx';
import { AUTOSAVE_INTERVAL_S, PARCEL_SIZE } from './data/balance';
import type { Mission } from './data/missions';
import { ROAD_SPECS, ROAD_TIERS } from './data/roads';
import { STR } from './data/strings.tr';
import { bindPointerInput, bindWheelZoom } from './input/pointer';
import { ToolController } from './input/tools';
import { registerServiceWorker } from './pwa/registerSW';
import { periodOf } from './render3d/archetypes';
import { CameraRig } from './render3d/cameraRig';
import { Renderer } from './render3d/renderer';
import { totalBuildings } from './sim/buildings';
import { findDistricts } from './sim/districts';
import { Clock } from './sim/clock';
import { borrow, loanOffer } from './sim/credit';
import { connectedRoadTiles } from './sim/connectivity';
import { highwayInterchanges } from './sim/highway';
import { yearOf } from './sim/timeline';
import { applyOfflineProgress, cityAtAGlance, creditAwayTime } from './sim/offline';
import { activeMissions, missionsCompleted, missionsTotal } from './sim/missions';
import { buyParcel, offerFor, parcelOffers } from './sim/parcels';
import { placeService, utilitiesExpected } from './sim/services';
import { research, techOffers } from './sim/tech';
import { placePlant, utilityBalance } from './sim/utilities';
import { canRetire, legacyOpeningBalance, legacyValue } from './sim/legacy';
import { createGameState } from './sim/state';
import { Systems } from './sim/systems';
import { NONE, type Era } from './sim/tiles';
import { UndoStack } from './sim/undo';
import { parcelOfTile, startingCentre } from './sim/world';
import { Autosave, loadCity, loadLegacy, nextSeed, retireCity } from './state/persistence';
import { uiStore } from './state/store';
import { mountChronicle } from './ui/chronicle';
import { mountBankPrompt } from './ui/bankPrompt';
import { mountCityPanel } from './ui/cityPanel';
import { mountCoach, type CoachFacts } from './ui/coach';
import { mountCostLabel } from './ui/costLabel';
import { mountDistrictLabels } from './ui/districtLabels';
import { describeGoal } from './ui/missionText';
import { mountParcelPrompt } from './ui/parcelPrompt';
import { mountRetirePrompt } from './ui/retirePrompt';
import { guidanceFor } from './ui/guidance';
import { mountIntro } from './ui/intro';
import * as haptics from './ui/haptics';
import { mountEventFeed } from './ui/eventFeed';
import { mountToast } from './ui/toast';
import { mountViewControls } from './ui/viewControls';
import { mountToolDock } from './ui/toolDock';
import { mountHint, mountTopBar } from './ui/topBar';

/**
 * Bootstrap and frame loop. This file wires modules together and owns nothing
 * itself — the sim owns the city, the renderer owns the scene, and the tool
 * controller owns the stroke in progress.
 */
const canvas = document.querySelector<HTMLCanvasElement>('#map');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('Game shell missing from index.html');

// A returning player gets their city back; a new one gets their own map rather
// than the single hard-coded island everybody used to share.
const game = loadCity() ?? createGameState(nextSeed(), Date.now(), loadLegacy());
const autosave = new Autosave(AUTOSAVE_INTERVAL_S);
const camera = new CameraRig();
const renderer = new Renderer(canvas, camera, game);
const clock = new Clock();
const undo = new UndoStack();
const systems = new Systems(game.world.size);
const sfx = createSfx();

// Derived fields — road distance, land value — are not saved, so a loaded city
// has to recompute them before its first tick.
systems.invalidateFields();

const home = startingCentre(game.world);
camera.centreOn(home.x, home.y);
camera.setBounds({ minX: 0, minY: 0, maxX: game.world.size, maxY: game.world.size });

const tools = new ToolController(game, camera, undo, {
  onBuilt: () => {
    haptics.confirm();
    sfx.play(tools.activeTool === 'erase' ? 'erase' : 'build');
    renderer.invalidateZones();
  },
  // Road access, and therefore land value, is derived from the road column.
  onRoadsChanged: () => {
    systems.invalidateFields();
    renderer.invalidateRoads();
  },
  // A demolished station stops covering ground the moment it goes, and the mask
  // is what the next building pass scores against.
  onFacilitiesChanged: () => {
    systems.invalidateFields();
    renderer.invalidateServices();
    autosave.flush(game);
  },
  onChanged: () => syncUi(),
});

const districtLabels = mountDistrictLabels(ui, camera);
/**
 * Retiring reloads rather than rebuilding the world in place.
 *
 * Every layer here holds a reference to this city — the renderer's meshes, the
 * camera bounds, the systems' fields, the coach's memory of what the player has
 * done. Reassembling all of that correctly is a great deal of code whose only
 * job is to reproduce what the page already does on load, and any corner of it
 * missed leaves a new city wearing an old one's state.
 */
const retirePrompt = mountRetirePrompt(ui, {
  onConfirm: () => {
    const earned = legacyValue(game);
    autosave.stop();
    retireCity(earned);
    window.location.reload();
  },
});
const updateCostLabel = mountCostLabel(ui);
mountTopBar(ui);
mountCityPanel(ui, {
  onRetire: () => {
    // What the next city opens with, including the legacy already banked from
    // cities before this one — the card has to quote the balance the player
    // will actually see.
    const earned = legacyValue(game);
    retirePrompt.show(earned, legacyOpeningBalance(loadLegacy() + earned));
  },
});
mountHint(ui);
const toast = mountToast(ui);
const eventFeed = mountEventFeed(ui);

const parcelPrompt = mountParcelPrompt(ui, {
  onBuy: (offer) => {
    if (!buyParcel(game, offer.px, offer.py)) return false;
    haptics.confirm();
    sfx.play('coin');
    // New ground changes what may be built, what the map looks like, and where
    // trees stand — and it is worth writing down immediately.
    systems.invalidateFields();
    renderer.invalidateTerrain();
    renderer.invalidateZones();
    syncUi();
    autosave.flush(game);
    toast.show(STR.parcel.bought, STR.parcel.boughtDetail(PARCEL_SIZE * PARCEL_SIZE));
    return true;
  },
});
const dock = mountToolDock(ui, {
  tools,
  era: () => game.era,
  onUndo: () => {
    if (!tools.undoLast()) return;
    haptics.tap();
    sfx.play('erase');
    renderer.invalidateRoads();
  },
  research: () => game.research,
  techOffers: () => techOffers(game),
  onResearch: (id) => {
    const result = research(game, id);
    if (result !== 'ok') {
      if (result === 'tooDear') toast.show(STR.tech.title, STR.tech.tooDear);
      return false;
    }
    haptics.confirm();
    sfx.play('goal');
    // Several systems read their factor at the moment they need it, and the
    // fields that already answered are now answering the old question.
    systems.invalidateFields();
    syncUi();
    autosave.flush(game);
    toast.show(STR.tech.researched, STR.tech.name[id]);
    return true;
  },
});

const chronicle = mountChronicle(ui, { glance: () => cityAtAGlance(game) });

const bank = mountBankPrompt(ui, {
  onBorrow: () => {
    const loan = borrow(game);
    if (!loan) return false;
    haptics.confirm();
    sfx.play('coin');
    syncUi();
    autosave.flush(game);
    toast.show(STR.bank.taken, STR.bank.instalment(loan.instalment));
    return true;
  },
});

/**
 * Offers the bank when the city has run dry, and says so when a loan closes.
 *
 * Offered once per dry spell rather than whenever the balance is low: a prompt
 * that returns every few seconds while the money sits at zero is nagging a
 * player who has already declined it. The latch clears once the city is solvent
 * again, so a second bad patch gets a second offer.
 */
let offeredWhileBroke = false;
function checkBank(): void {
  if (game.loansClosed > 0) {
    game.loansClosed = 0;
    toast.show(STR.bank.cleared);
    sfx.play('coin');
  }

  if (game.money > BANK_PROMPT_FLOOR) {
    offeredWhileBroke = false;
    return;
  }
  if (offeredWhileBroke || bank.open) return;
  const offer = loanOffer(game);
  if (offer.principal <= 0) return;
  offeredWhileBroke = true;
  bank.offer(offer);
}

/**
 * Runs the city forward across an absence and shows what it did.
 *
 * Both ways back into the game come through here: opening the app after a day
 * away, and switching back to a tab left running. Only the length of the gap
 * differs, and the efficiency bands already take care of that.
 */
function catchUp(): void {
  const away = creditAwayTime(game.lastSeen, Date.now());
  if (away.effectiveMs <= 0) return;
  const report = applyOfflineProgress(game, systems, away);
  renderer.onBuildingsChanged();
  syncUi();
  autosave.flush(game);
  if (report.eraReached) dock.refresh();
  if (report.worthReporting) {
    chronicle.show(report);
    return;
  }
  // Too short for a card, but the goals were still drained off the queue — so
  // they are announced the ordinary way rather than disappearing.
  announceMissions(report.missionsDone);
}

// Mounted after the dock, because the coach points at its buttons and reads
// whether its sheet is open.
const returning = game.buildings.size > 0 || playerRoadTiles() > 0;
const coach = mountCoach(ui, false);
const intro = mountIntro(ui, {
  skip: returning,
  onDismiss: () => coach.start(coachFacts()),
});
if (returning) coach.dismiss();
// The card is shown once and remembered, so a player on their second run gets
// no card — and the coach has to start itself rather than wait for a dismissal
// that will never come.
else if (!intro.open) coach.start(coachFacts());

/**
 * One-finger panning, used when no tool is selected.
 *
 * The original scheme was one finger for the tool and two for the camera, which
 * assumes two fingers are always available and always reach the canvas. Neither
 * holds: a mouse has one pointer, and an embedded page can swallow a pinch
 * before it arrives. Leaving a player unable to move the map — or to stop
 * painting — is worse than any purity about gestures, so "no tool" is now a
 * real mode and one finger drags the city in it.
 */
let panFrom: { x: number; y: number } | null = null;

const input = bindPointerInput(canvas, {
  onCameraPan: (dx, dy) => {
    dock.closeSheet();
    camera.panByScreen(dx, dy);
  },
  onCameraZoom: (anchorX, anchorY, factor) => camera.zoomAt(anchorX, anchorY, factor),
  onCameraTwist: (radians) => camera.orbitByAngle(radians),
  onCameraOrbit: (dx, dy) => camera.orbitByScreen(dx, dy),
  onStrokeStart: (sample) => {
    // The advice sits mid-screen; get it out of the way of the ink the moment
    // the player starts drawing, not once the road is paid for.
    uiStore.getState().hideHint();
    dock.closeSheet();
    if (tools.activeTool === 'none') {
      panFrom = { x: sample.x, y: sample.y };
      return;
    }
    tools.strokeStart(sample.x, sample.y);
  },
  onStrokeMove: (sample) => {
    if (panFrom) {
      camera.panByScreen(sample.x - panFrom.x, sample.y - panFrom.y);
      panFrom = { x: sample.x, y: sample.y };
      return;
    }
    tools.strokeMove(sample.x, sample.y);
  },
  onStrokeEnd: () => {
    panFrom = null;
    tools.strokeEnd();
    uiStore.getState().showHint();
  },
  onStrokeCancel: () => {
    panFrom = null;
    tools.cancelStroke();
    uiStore.getState().showHint();
  },
  onTap: (sample) => {
    dock.closeSheet();
    const world = camera.screenToWorld(sample.x, sample.y);
    const tileX = Math.floor(world.x);
    const tileY = Math.floor(world.y);

    // With the service tool up, a tap builds. Otherwise it is the only way to
    // buy land: free to try, and tapping their own city just dismisses.
    if (tools.activeTool === 'service') {
      buildStation(tileX, tileY);
      return;
    }
    const { px, py } = parcelOfTile(tileX, tileY);
    parcelPrompt.show(offerFor(game, px, py));
  },
});
bindWheelZoom(canvas, (x, y, factor) => camera.zoomAt(x, y, factor));
mountViewControls(ui, {
  // Anchored on the middle of the screen, which is what the player is looking
  // at when they reach for a button rather than a finger.
  onZoom: (factor) => camera.zoomAt(camera.viewportWidth / 2, camera.viewportHeight / 2, factor),
  onRotate: (radians) => camera.orbitByAngle(radians),
  soundOn: () => sfx.enabled,
  onToggleSound: () => sfx.setEnabled(!sfx.enabled),
});
bindAudioUnlock(canvas);
registerServiceWorker();

/**
 * Places a station, or says why it could not. Refusals are spoken rather than
 * silent: a tap that does nothing and explains nothing reads as a broken game.
 */
function buildStation(tileX: number, tileY: number): void {
  const facility = tools.activeFacility;
  const name =
    facility.type === 'service' ? STR.service[facility.kind] : STR.utility[facility.kind];
  const result =
    facility.type === 'service'
      ? placeService(game, systems.fields, facility.kind, tileX, tileY)
      : placePlant(game, systems.fields, facility.kind, tileX, tileY);

  if (!result.ok) {
    sfx.play('blocked');
    toast.show(name, STR.serviceBlocked[result.reason ?? 'occupied']);
    return;
  }
  haptics.confirm();
  sfx.play('build');
  // Coverage is derived from the list of facilities and from road access, so it
  // has to be redone before the next building pass scores anything.
  systems.invalidateFields();
  renderer.invalidateServices();
  syncUi();
  autosave.flush(game);
  toast.show(STR.serviceBuilt, name);
}

// --- Viewport plumbing -------------------------------------------------------
// Safari fires resize during the address-bar animation with stale metrics, so
// the visualViewport events matter as much as window resize here.
const handleResize = (): void => renderer.resize();
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);
window.visualViewport?.addEventListener('resize', handleResize);
window.visualViewport?.addEventListener('scroll', handleResize);
renderer.resize();

// iOS very often never fires unload, and may not fire visibilitychange either
// when the app is swiped away; pagehide is the one that can be relied on.
window.addEventListener('pagehide', () => {
  game.lastSeen = Date.now();
  autosave.flush(game);
});

// --- Away-time bookkeeping ---------------------------------------------------
// rAF stops when the tab backgrounds, so the gap is measured on visibility
// rather than counted in frames, and handed to the offline system (§11).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    game.lastSeen = Date.now();
    // A backgrounded tab can be killed without warning, so this is the last
    // reliable moment to write the city down.
    autosave.flush(game);
    return;
  }
  catchUp();
  game.lastSeen = Date.now();
  clock.resetAccumulators();
  lastFrame = performance.now();
  renderer.resize();
});

// --- Loop --------------------------------------------------------------------
let lastFrame = performance.now();
let readoutAccumulator = 0;
/**
 * Balance below which the bank speaks up. Not zero: by the time the city is
 * actually at nothing the player has already spent a while unable to act, and
 * the point of the offer is to reach them before that.
 */
const BANK_PROMPT_FLOOR = 400;
/** Readout ticks between district sweeps — roughly every four seconds. */
const DISTRICT_SWEEPS = 8;
let districtSweep = DISTRICT_SWEEPS;
let previousBuildingCount = game.buildings.size;

function frame(now: number): void {
  const deltaMs = now - lastFrame;
  lastFrame = now;

  input.tick(now);
  const budget = clock.advance(deltaMs);

  if (budget.simTicks > 0) {
    game.tick += budget.simTicks;
    const seconds = (budget.simTicks * clock.simStepMs) / 1000;
    const before = game.era;
    const era = systems.step(game, seconds);
    if (era) {
      // A new era unlocks tools and changes how the city is built; both are read
      // from state, so the dock just needs to re-render its rows.
      dock.refresh();
      renderer.invalidateTerrain();
      // The biggest moment in the early game used to pass in total silence.
      toast.show(STR.era.reached(STR.eraName[era]), unlockedBy(era, before));
      haptics.confirm();
      sfx.play('era');
      autosave.flush(game);
    }
    // A spawn or a demolition changes which tiles still show bare zoning.
    if (game.buildings.size !== previousBuildingCount) {
      if (game.buildings.size > previousBuildingCount) sfx.play('spawn');
      previousBuildingCount = game.buildings.size;
      renderer.onBuildingsChanged();
    }
    announceGoals();
    announceHazards();
    announceTimeline();
    checkBank();
  }
  if (budget.economyTicks > 0) {
    systems.stepEconomy(game, (budget.economyTicks * clock.economyStepMs) / 1000);
  }
  game.playedMs = clock.playedMs;
  autosave.tick(game, deltaMs);

  tools.update();
  // Which land is on the market only changes when a parcel is bought, so this
  // is driven by a flag rather than recomputed every frame.
  if (renderer.needsForSaleRefresh) renderer.setForSale(parcelOffers(game));
  renderer.render(
    { state: game, draft: tools.draft, now, trafficLoad: systems.traffic.load },
    deltaMs,
  );

  updateCostLabel(tools.isDrawing ? tools.summary : null);
  // Names get out of the way of the ink, the same as the hint does.
  districtLabels.setHidden(tools.isDrawing);
  districtLabels.reposition();
  // The dock relabels itself as tools change, so the ring is re-measured rather
  // than cached against coordinates that may have moved.
  coach.reposition();
  publishReadout();

  requestAnimationFrame(frame);
}

/**
 * Fires and outbreaks, drained like the goals: every event goes to the feed,
 * and the two genuine catastrophes also take the toast — a city burning down
 * is allowed to interrupt.
 */
function announceHazards(): void {
  const events = systems.drainHazardEvents();
  if (events.length === 0) return;
  eventFeed.push(events);
  for (const event of events) {
    if (event.kind === 'fireRaging') {
      toast.show(STR.hazard.fireRaging);
      sfx.play('alarm');
    } else if (event.kind === 'epidemicEndSevere') {
      toast.show(STR.hazard.epidemicEndSevere);
      sfx.play('alarm');
    }
  }
  // A building lost to fire changes what the zoning layer has left to show.
  if (events.some((event) => event.kind === 'fireLost')) renderer.onBuildingsChanged();
}

/**
 * History, announced as it happens: every dated event goes to the feed with
 * its icon, and the violent ones also take the toast and the siren — the year
 * the fault line lets go is allowed to interrupt.
 */
function announceTimeline(): void {
  const fired = systems.drainTimelineEvents();
  if (fired.length === 0) return;
  eventFeed.pushCustom(
    fired.map(({ event }) => ({
      icon: event.icon,
      tone: event.disaster || event.kind === 'war' || event.kind === 'crisis' ? 'alarm'
        : event.kind === 'celebration' || event.kind === 'boom' || event.kind === 'progress' ? 'calm'
        : 'warn',
      text: event.title,
    })),
  );
  for (const { event } of fired) {
    if (event.disaster) {
      toast.show(event.title);
      sfx.play('alarm');
    }
  }
  // An earthquake knocks buildings down; the zoning layer has less left to show.
  if (fired.some(({ event }) => event.disaster === 'earthquake')) {
    renderer.onBuildingsChanged();
  }
}

/**
 * Says so when a goal lands, and banks the reward it already paid.
 *
 * Drained rather than polled: the simulation settles goals on its own clock, so
 * this is the same list whether the city crossed the line this second or during
 * an eight-hour absence.
 */
function announceGoals(): void {
  announceMissions(systems.drainCompletedMissions());
}

function announceMissions(finished: readonly Mission[]): void {
  if (finished.length === 0) return;
  for (const mission of finished) {
    toast.show(
      STR.mission.complete,
      `${describeGoal(mission.goal)} · ${STR.mission.reward(mission.reward)}`,
    );
  }
  haptics.confirm();
  sfx.play('goal');
  syncUi();
  autosave.flush(game);
}

/** What the coach reads to decide which control to point at. */
function coachFacts(): CoachFacts {
  const totals = totalBuildings(game);
  return {
    roadTiles: playerRoadTiles(),
    zonedTiles: countColumn(game.world.zone),
    buildings: game.buildings.size,
    jobs: totals.commercialJobs + totals.industrialJobs,
    population: game.population,
    activeTool: tools.activeTool,
    sheetOpen: dock.isSheetOpen,
  };
}

function syncUi(): void {
  const store = uiStore.getState();
  const totals = totalBuildings(game);
  store.syncFromSim({
    era: game.era,
    year: yearOf(game.playedMs),
    money: game.money,
    debt: game.debt,
    legacy: game.legacy,
    canRetire: canRetire(game),
    population: game.population,
    happiness: game.happiness,
    taxRate: game.taxRate,
    demand: { ...game.demand },
    net: game.ledger.net,
    ledger: {
      taxIncome: game.ledger.taxIncome,
      roadUpkeep: game.ledger.roadUpkeep,
      serviceUpkeep: game.ledger.serviceUpkeep,
      utilityUpkeep: game.ledger.utilityUpkeep,
      debtService: game.ledger.debtService,
      farmYield: game.ledger.farmYield,
      farmIncome: game.ledger.farmIncome,
      transitIncome: game.ledger.transitIncome,
    },
    totals: {
      housing: totals.housing,
      residents: totals.residents,
      commercialJobs: totals.commercialJobs,
      industrialJobs: totals.industrialJobs,
      farmJobs: totals.farmJobs,
    },
    grid: { ...utilityBalance(game), expected: utilitiesExpected(game.era) },
  });
  store.setMissions(
    activeMissions(game).map((view) => ({
      id: view.mission.id,
      goal: view.mission.goal,
      reward: view.mission.reward,
      have: view.have,
      want: view.want,
      fraction: view.fraction,
    })),
    missionsCompleted(game),
    missionsTotal(),
  );
  coach.update(coachFacts());
  store.setGuidance(
    guidanceFor({
      roadTiles: playerRoadTiles(),
      zonedTiles: countColumn(game.world.zone),
      buildings: game.buildings.size,
      population: game.population,
      totals: totalBuildings(game),
      interchanges: highwayInterchanges(game.world),
      connectedRoadTiles: connectedRoadTiles(game.world),
    }),
  );
}

/**
 * What an era just handed the player, as the toast's second line. An
 * announcement that only names the era tells them they achieved something;
 * naming the road it unlocked tells them what to go and do with it.
 */
function unlockedBy(era: Era, previous: Era): string | undefined {
  const lines: string[] = [];
  const unlocked = ROAD_TIERS.filter((kind) => ROAD_SPECS[kind].unlockedAt === era);
  if (unlocked.length > 0) lines.push(STR.unlocked(unlocked.map((k) => STR.road[k]).join(', ')));
  // The city rebuilding itself in a new style is the most visible thing an era
  // does, and it would otherwise happen without a word.
  if (periodOf(era) !== periodOf(previous)) lines.push(STR.era.rebuilt);
  return lines.length > 0 ? lines.join(' · ') : undefined;
}

/** Non-zero entries in a grid column — how much road or zoning exists at all. */
function countColumn(column: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < column.length; i++) {
    if (column[i] !== NONE) count++;
  }
  return count;
}

/**
 * Pavement the player laid, which is the only pavement that counts as playing:
 * the national highway is in the same column and would otherwise make a
 * brand-new city read as a returning one.
 */
function playerRoadTiles(): number {
  const { road, highway } = game.world;
  let count = 0;
  for (let i = 0; i < road.length; i++) {
    if ((road[i] ?? NONE) !== NONE && (highway[i] ?? 0) === 0) count++;
  }
  return count;
}

function publishReadout(): void {
  // Store writes drive DOM updates; twice a second is plenty for a city whose
  // numbers move on a one-second tick.
  readoutAccumulator += 1;
  if (readoutAccumulator < 15) return;
  readoutAccumulator = 0;
  syncUi();
  uiStore.getState().setFps(renderer.stats.fps);

  // Clustering walks every building, so it runs on this timer rather than per
  // frame; only the positions are refreshed with the camera.
  districtSweep += 1;
  if (districtSweep >= DISTRICT_SWEEPS) {
    districtSweep = 0;
    districtLabels.setDistricts(findDistricts(game));
  }
}

syncUi();
// Named on the first frame rather than on the sweep timer: a returning player
// opens a city that already has neighbourhoods, and waiting a beat for them to
// appear reads as the game noticing them rather than knowing them.
districtLabels.setDistricts(findDistricts(game));
// The other way back in: the app was closed rather than backgrounded, and the
// gap is whatever the save last wrote down. A new city's lastSeen is now, so
// this costs it nothing.
catchUp();
game.lastSeen = Date.now();
requestAnimationFrame(frame);
