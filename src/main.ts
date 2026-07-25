import './style.css';
import { bindAudioUnlock } from './audio/context';
import { AUTOSAVE_INTERVAL_S, PARCEL_SIZE } from './data/balance';
import { ROAD_SPECS, ROAD_TIERS } from './data/roads';
import { STR } from './data/strings.tr';
import { bindPointerInput, bindWheelZoom } from './input/pointer';
import { ToolController } from './input/tools';
import { registerServiceWorker } from './pwa/registerSW';
import { CameraRig } from './render3d/cameraRig';
import { Renderer } from './render3d/renderer';
import { totalBuildings } from './sim/buildings';
import { Clock } from './sim/clock';
import { creditAwayTime } from './sim/offline';
import { buyParcel, offerFor, parcelOffers } from './sim/parcels';
import { placeService } from './sim/services';
import { createGameState } from './sim/state';
import { Systems } from './sim/systems';
import { NONE, type Era } from './sim/tiles';
import { UndoStack } from './sim/undo';
import { parcelOfTile, startingCentre } from './sim/world';
import { Autosave, loadCity, nextSeed } from './state/persistence';
import { uiStore } from './state/store';
import { mountCityPanel } from './ui/cityPanel';
import { mountCoach, type CoachFacts } from './ui/coach';
import { mountCostLabel } from './ui/costLabel';
import { mountParcelPrompt } from './ui/parcelPrompt';
import { guidanceFor } from './ui/guidance';
import { mountIntro } from './ui/intro';
import * as haptics from './ui/haptics';
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
const game = loadCity() ?? createGameState(nextSeed(), Date.now());
const autosave = new Autosave(AUTOSAVE_INTERVAL_S);
const camera = new CameraRig();
const renderer = new Renderer(canvas, camera, game);
const clock = new Clock();
const undo = new UndoStack();
const systems = new Systems(game.world.size);

// Derived fields — road distance, land value — are not saved, so a loaded city
// has to recompute them before its first tick.
systems.invalidateFields();

const home = startingCentre(game.world);
camera.centreOn(home.x, home.y);
camera.setBounds({ minX: 0, minY: 0, maxX: game.world.size, maxY: game.world.size });

const tools = new ToolController(game, camera, undo, {
  onBuilt: () => {
    haptics.confirm();
    renderer.invalidateZones();
  },
  // Road access, and therefore land value, is derived from the road column.
  onRoadsChanged: () => {
    systems.invalidateFields();
    renderer.invalidateRoads();
  },
  onChanged: () => syncUi(),
});

const updateCostLabel = mountCostLabel(ui);
mountTopBar(ui);
mountCityPanel(ui);
mountHint(ui);
const toast = mountToast(ui);

const parcelPrompt = mountParcelPrompt(ui, {
  onBuy: (offer) => {
    if (!buyParcel(game, offer.px, offer.py)) return false;
    haptics.confirm();
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
    renderer.invalidateRoads();
  },
});

// Mounted after the dock, because the coach points at its buttons and reads
// whether its sheet is open.
const returning = game.buildings.size > 0 || countColumn(game.world.road) > 0;
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
});
bindAudioUnlock(canvas);
registerServiceWorker();

/**
 * Places a station, or says why it could not. Refusals are spoken rather than
 * silent: a tap that does nothing and explains nothing reads as a broken game.
 */
function buildStation(tileX: number, tileY: number): void {
  const kind = tools.activeServiceKind;
  const result = placeService(game, systems.fields, kind, tileX, tileY);
  if (!result.ok) {
    toast.show(STR.service[kind], STR.serviceBlocked[result.reason ?? 'occupied']);
    return;
  }
  haptics.confirm();
  // Coverage is derived from the station list and road access, so it has to be
  // redone before the next building pass scores anything.
  systems.invalidateFields();
  renderer.invalidateServices();
  syncUi();
  autosave.flush(game);
  toast.show(STR.serviceBuilt, STR.service[kind]);
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
  const away = creditAwayTime(game.lastSeen, Date.now());
  if (away.rawMs > 1_000) {
    // Phase 4 turns this into the City Chronicle; for now the measurement is
    // simply kept honest.
    game.playedMs += away.effectiveMs;
  }
  game.lastSeen = Date.now();
  clock.resetAccumulators();
  lastFrame = performance.now();
  renderer.resize();
});

// --- Loop --------------------------------------------------------------------
let lastFrame = performance.now();
let readoutAccumulator = 0;
let previousBuildingCount = game.buildings.size;

function frame(now: number): void {
  const deltaMs = now - lastFrame;
  lastFrame = now;

  input.tick(now);
  const budget = clock.advance(deltaMs);

  if (budget.simTicks > 0) {
    game.tick += budget.simTicks;
    const seconds = (budget.simTicks * clock.simStepMs) / 1000;
    const era = systems.step(game, seconds);
    if (era) {
      // A new era unlocks tools and changes how the city is built; both are read
      // from state, so the dock just needs to re-render its rows.
      dock.refresh();
      renderer.invalidateTerrain();
      // The biggest moment in the early game used to pass in total silence.
      toast.show(STR.era.reached(STR.eraName[era]), unlockedBy(era));
      haptics.confirm();
      autosave.flush(game);
    }
    // A spawn or a demolition changes which tiles still show bare zoning.
    if (game.buildings.size !== previousBuildingCount) {
      previousBuildingCount = game.buildings.size;
      renderer.onBuildingsChanged();
    }
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
  renderer.render({ state: game, draft: tools.draft, now }, deltaMs);

  updateCostLabel(tools.isDrawing ? tools.summary : null);
  // The dock relabels itself as tools change, so the ring is re-measured rather
  // than cached against coordinates that may have moved.
  coach.reposition();
  publishReadout();

  requestAnimationFrame(frame);
}

/** What the coach reads to decide which control to point at. */
function coachFacts(): CoachFacts {
  const totals = totalBuildings(game);
  return {
    roadTiles: countColumn(game.world.road),
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
    money: game.money,
    population: game.population,
    happiness: game.happiness,
    taxRate: game.taxRate,
    demand: { ...game.demand },
    net: game.ledger.net,
    ledger: {
      taxIncome: game.ledger.taxIncome,
      roadUpkeep: game.ledger.roadUpkeep,
      serviceUpkeep: game.ledger.serviceUpkeep,
      farmYield: game.ledger.farmYield,
    },
    totals: {
      housing: totals.housing,
      residents: totals.residents,
      commercialJobs: totals.commercialJobs,
      industrialJobs: totals.industrialJobs,
      farmJobs: totals.farmJobs,
    },
  });
  coach.update(coachFacts());
  store.setGuidance(
    guidanceFor({
      roadTiles: countColumn(game.world.road),
      zonedTiles: countColumn(game.world.zone),
      buildings: game.buildings.size,
      population: game.population,
      totals: totalBuildings(game),
    }),
  );
}

/**
 * What an era just handed the player, as the toast's second line. An
 * announcement that only names the era tells them they achieved something;
 * naming the road it unlocked tells them what to go and do with it.
 */
function unlockedBy(era: Era): string | undefined {
  const unlocked = ROAD_TIERS.filter((kind) => ROAD_SPECS[kind].unlockedAt === era);
  if (unlocked.length === 0) return undefined;
  return STR.unlocked(unlocked.map((kind) => STR.road[kind]).join(', '));
}

/** Non-zero entries in a grid column — how much road or zoning exists at all. */
function countColumn(column: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < column.length; i++) {
    if (column[i] !== NONE) count++;
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
}

syncUi();
requestAnimationFrame(frame);
