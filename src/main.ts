import './style.css';
import { bindAudioUnlock } from './audio/context';
import { createAmbient } from './audio/ambient';
import { createMusic } from './audio/music';
import { createSfx } from './audio/sfx';
import {
  AUTOSAVE_INTERVAL_S,
  HIGHWAY_BILL_REMINDER_S,
  PARCEL_SIZE,
  researchPerMinute,
} from './data/balance';
import type { Mission } from './data/missions';
import { ROAD_SPECS, ROAD_TIERS } from './data/roads';
import { STR } from './data/strings.tr';
import { bindMouseCamera, bindPointerInput, bindWheelZoom } from './input/pointer';
import { bindKeyboardCamera, isTyping } from './input/keyboardCamera';
import { ToolController, type FacilitySelection } from './input/tools';
import { registerServiceWorker } from './pwa/registerSW';
import { periodOf } from './render3d/archetypes';
import { CameraRig } from './render3d/cameraRig';
import { Renderer } from './render3d/renderer';
import { SEA_Y } from './render3d/constants';
import { sampleHeight } from './render3d/terrain';
import { WalkMode } from './render3d/walkMode';
import { totalBuildings } from './sim/buildings';
import { findDistricts } from './sim/districts';
import { Clock } from './sim/clock';
import { bandCount, schooledShare, workingShare } from './sim/cohorts';
import { crimeNear, dispatchPolice } from './sim/crime';
import { isWeatherWorthAnnouncing, weatherAt } from './sim/weather';
import { dayFraction, nightAmount } from './sim/daytime';
import { borrow, loanOffer } from './sim/credit';
import { connectedRoadTiles } from './sim/connectivity';
import { highwayInterchanges } from './sim/highway';
import { blockedSections, repairCost, repairHighway } from './sim/highwayWear';
import { yearOf } from './sim/timeline';
import { applyOfflineProgress, cityAtAGlance, creditAwayTime } from './sim/offline';
import { activeMissions, missionsCompleted, missionsTotal } from './sim/missions';
import { buyParcel, offerFor, parcelOffers } from './sim/parcels';
import { buyInvestment } from './sim/investments';
import { hasSeaGate, placePort } from './sim/ports';
import { placeService, utilitiesExpected } from './sim/services';
import { educationCoverage, research, techOffers } from './sim/tech';
import { placePlant, utilityBalance } from './sim/utilities';
import { canRetire, legacyOpeningBalance, legacyValue } from './sim/legacy';
import { createGameState } from './sim/state';
import { Systems } from './sim/systems';
import { NONE, type Era } from './sim/tiles';
import { UndoStack } from './sim/undo';
import { index, parcelOfTile, startingCentre } from './sim/world';
import { appendHistory, clearHistory } from './state/history';
import { Autosave, loadCity, loadLegacy, nextSeed, retireCity } from './state/persistence';
import { uiStore } from './state/store';
import { mountChronicle } from './ui/chronicle';
import { mountBankPrompt } from './ui/bankPrompt';
import { mountRoadRepairPrompt } from './ui/roadRepairPrompt';
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
import { mountEventFeed, type CustomEntry } from './ui/eventFeed';
import { mountToast } from './ui/toast';
import { mountViewControls } from './ui/viewControls';
import { mountToolDock } from './ui/toolDock';
import { mountHint, mountTopBar } from './ui/topBar';
import { mountHistoryPanel } from './ui/historyPanel';
import { mountWalkHud } from './ui/walkHud';

/**
 * Bootstrap and frame loop. This file wires modules together and owns nothing
 * itself — the sim owns the city, the renderer owns the scene, and the tool
 * controller owns the stroke in progress.
 */
const canvas = document.querySelector<HTMLCanvasElement>('#map');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('Game shell missing from index.html');

// A returning player gets their city back; a new one gets their own map rather
// than the single hard-coded island everybody used to share — and a blank
// page in the history log: the diary belongs to the city, not the device.
const savedCity = loadCity();
if (!savedCity) clearHistory();
const game = savedCity ?? createGameState(nextSeed(), Date.now(), loadLegacy());
const autosave = new Autosave(AUTOSAVE_INTERVAL_S);
const camera = new CameraRig();
const renderer = new Renderer(canvas, camera, game);
const clock = new Clock();
const undo = new UndoStack();
const systems = new Systems(game.world.size);
const sfx = createSfx();
const ambient = createAmbient();
const music = createMusic();

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
  /**
   * Buys the next tier of a civic programme.
   *
   * The lighting programme gets a line of its own the first time it lands,
   * because it is the one purchase whose effect the player is about to watch
   * happen across the whole city and it deserves to be pointed at.
   */
  onInvest: (id) => {
    const before = game.investments[id];
    const result = buyInvestment(game, id);
    if (result !== 'ok') {
      sfx.play('blocked');
      if (result === 'tooDear') toast.show(STR.invest.name[id], STR.invest.tooDear);
      return;
    }
    haptics.confirm();
    sfx.play('coin');
    // Greening changes what the diffusion absorbs, and lighting changes where the
    // lamps stand; both are read from state, so only the fields need redoing.
    systems.invalidateFields();
    syncUi();
    autosave.flush(game);
    const firstLights = id === 'lighting' && before === 0;
    toast.show(firstLights ? STR.invest.lightsOn : STR.invest.bought, STR.invest.name[id]);
    appendHistory([
      {
        year: yearOf(game.playedMs),
        icon: '🏛️',
        title: `${STR.invest.name[id]} — ${STR.invest.level(game.investments[id], 4)}`,
        detail: STR.invest.detail[id],
      },
    ]);
  },
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
  schooling: () => {
    const coverage = educationCoverage(game);
    return { coverage, perMinute: researchPerMinute(game.population, coverage * 100) };
  },
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

const roadRepair = mountRoadRepairPrompt(ui, {
  onPay: () => {
    if (!repairHighway(game)) return false;
    // The barricades come down: which streets reach the country has changed,
    // and so has how the motorway is drawn.
    systems.invalidateFields();
    renderer.invalidateRoads();
    haptics.confirm();
    sfx.play('coin');
    syncUi();
    autosave.flush(game);
    toast.show(STR.roadRepair.paid);
    return true;
  },
  onTooPoor: () => toast.show(STR.roadRepair.tooPoor),
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
/**
 * The hand tool, latched.
 *
 * "No tool" already pans with one finger, but reaching it means opening the
 * dock and putting down whatever you were drawing with, which is the opposite
 * of what somebody who just wants to look at the other side of their city
 * wants. This latch pans without disturbing the tool in hand.
 */
let panLocked = false;

const input = bindPointerInput(canvas, {
  onCameraPan: (dx, dy) => {
    if (walk.active) return;
    dock.closeSheet();
    camera.panByScreen(dx, dy);
  },
  onCameraZoom: (anchorX, anchorY, factor) => {
    if (walk.active) return;
    camera.zoomAt(anchorX, anchorY, factor);
  },
  onCameraTwist: (radians) => {
    if (walk.active) return;
    camera.orbitByAngle(radians);
  },
  onCameraOrbit: (dx, dy) => {
    if (walk.active) return;
    camera.orbitByScreen(dx, dy);
  },
  onStrokeStart: (sample) => {
    // A walk turns every drag into a look-around; nothing else reaches the map.
    if (walk.active) {
      walkLook = { x: sample.x, y: sample.y };
      return;
    }
    // The advice sits mid-screen; get it out of the way of the ink the moment
    // the player starts drawing, not once the road is paid for.
    uiStore.getState().hideHint();
    dock.closeSheet();
    if (panLocked || tools.activeTool === 'none') {
      panFrom = { x: sample.x, y: sample.y };
      return;
    }
    tools.strokeStart(sample.x, sample.y);
  },
  onStrokeMove: (sample) => {
    if (walk.active) {
      if (walkLook) {
        walk.lookBy(sample.x - walkLook.x, sample.y - walkLook.y);
        walkLook = { x: sample.x, y: sample.y };
      }
      return;
    }
    if (panFrom) {
      camera.panByScreen(sample.x - panFrom.x, sample.y - panFrom.y);
      panFrom = { x: sample.x, y: sample.y };
      return;
    }
    tools.strokeMove(sample.x, sample.y);
  },
  onStrokeEnd: () => {
    if (walk.active) {
      walkLook = null;
      return;
    }
    panFrom = null;
    tools.strokeEnd();
    uiStore.getState().showHint();
  },
  onStrokeCancel: () => {
    if (walk.active) {
      walkLook = null;
      return;
    }
    panFrom = null;
    tools.cancelStroke();
    uiStore.getState().showHint();
  },
  onTap: (sample) => {
    if (walk.active) return;
    dock.closeSheet();
    const world = camera.screenToWorld(sample.x, sample.y);
    const tileX = Math.floor(world.x);
    const tileY = Math.floor(world.y);

    // With the service tool up, a tap builds. Otherwise it is the only way to
    // buy land: free to try, and tapping their own city just dismisses. With
    // the hand latched the finger is the camera, so a tap that did not quite
    // move must not put a fire station down.
    if (tools.activeTool === 'service' && !panLocked) {
      buildStation(tileX, tileY);
      return;
    }
    // A crime marker beats the land prompt. It is the only thing on the map with
    // a clock on it, and being asked whether you would like to buy a parcel
    // while a robbery is in progress on it is the wrong answer to a finger.
    if (sendPolice(tileX, tileY)) return;
    const { px, py } = parcelOfTile(tileX, tileY);
    parcelPrompt.show(offerFor(game, px, py));
  },
});
bindWheelZoom(canvas, (x, y, factor) => {
  if (walk.active) return;
  camera.zoomAt(x, y, factor);
});
// A mouse has one pointer, so the two-finger camera rule leaves a desktop
// player who is holding a tool with no way to move. Middle drags, right turns.
bindMouseCamera(canvas, {
  onPan: (dx, dy) => {
    dock.closeSheet();
    camera.panByScreen(dx, dy);
  },
  onOrbit: (dx, dy) => camera.orbitByScreen(dx, dy),
  isBlocked: () => walk.active,
});
// And the keys, which are what a desktop player actually reaches for. The walk
// mode owns WASD while it is running, so it is asked rather than told.
const keyboard = bindKeyboardCamera(() => walk.active);
announceKeyboard();

/**
 * Tells a desktop player once that the keys work.
 *
 * A control nobody knows about is a control that does not exist, and this one
 * is the answer to the single most common complaint about the game. Said once
 * ever, remembered in localStorage beside the intro's own flag, and never said
 * at all on a touch device where it would be a lie.
 */
function announceKeyboard(): void {
  if (window.matchMedia('(pointer: coarse)').matches) return;
  try {
    if (window.localStorage.getItem('kadastro.keyboardHint') === '1') return;
    window.localStorage.setItem('kadastro.keyboardHint', '1');
  } catch {
    // Private browsing: say it this once rather than not at all.
  }
  window.setTimeout(() => toast.show(STR.view.keyboardHint), 2600);
}

// --- Street-level visits (§15) -------------------------------------------------
// The same city, seen from eye height. The walk borrows the rig's camera, the
// shell reroutes every gesture to it, and the sim runs on regardless — the
// city does not pause because its mayor went for a stroll.
const walkHud = mountWalkHud(ui, { onExit: () => exitWalk() });
const walk = new WalkMode({
  camera: camera.camera,
  blocked: (tileX, tileY) => {
    const world = game.world;
    if (tileX < 0 || tileY < 0 || tileX >= world.size || tileY >= world.size) return true;
    if ((world.building[index(world, tileX, tileY)] ?? 0) !== 0) return true;
    if (sampleHeight(world, tileX + 0.5, tileY + 0.5) < SEA_Y - 0.4) return true;
    for (const service of game.services.values()) {
      if (service.x === tileX && service.y === tileY) return true;
    }
    for (const plant of game.utilities.values()) {
      if (plant.x === tileX && plant.y === tileY) return true;
    }
    return false;
  },
  sampleHeight: (x, y) => sampleHeight(game.world, x, y),
  startAt: () => ({ x: camera.x, y: camera.y }),
  onExit: () => {},
});

/** A drag on the canvas is a look-around while the walk owns the camera. */
let walkLook: { x: number; y: number } | null = null;
const walkKeys = { forward: 0, strafe: 0, sprint: false };
const heldKeys = new Set<string>();
const WALK_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

function refreshWalkKeys(): void {
  walkKeys.forward =
    (heldKeys.has('KeyW') || heldKeys.has('ArrowUp') ? 1 : 0) -
    (heldKeys.has('KeyS') || heldKeys.has('ArrowDown') ? 1 : 0);
  walkKeys.strafe =
    (heldKeys.has('KeyD') || heldKeys.has('ArrowRight') ? 1 : 0) -
    (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft') ? 1 : 0);
  walkKeys.sprint = heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight');
}

window.addEventListener('keydown', (event) => {
  // Space stops and starts the clock, from anywhere. It is the one key every
  // game with a pause has used, and it is deliberately outside the walk guard:
  // a player who wants the city to hold still wants that on foot too.
  if (event.code === 'Space' && !event.repeat && !isTyping(event.target)) {
    event.preventDefault();
    clock.setSpeed(clock.currentSpeed === 0 ? 1 : 0);
    haptics.tap();
    if (clock.currentSpeed === 0) toast.show(STR.view.paused);
    viewControls.refresh();
    return;
  }
  if (!walk.active) return;
  if (event.code === 'Escape') {
    exitWalk();
    return;
  }
  if (WALK_KEY_CODES.has(event.code)) {
    event.preventDefault();
    heldKeys.add(event.code);
    refreshWalkKeys();
  }
});
window.addEventListener('keyup', (event) => {
  heldKeys.delete(event.code);
  refreshWalkKeys();
});

function enterWalk(): void {
  if (walk.active) return;
  dock.closeSheet();
  historyPanel.close();
  walk.enter();
  renderer.externalCameraControl = true;
  ui!.dataset['walking'] = 'true';
  walkHud.setActive(true);
  haptics.tap();
}

function exitWalk(): void {
  if (!walk.active) return;
  walk.exit();
  heldKeys.clear();
  refreshWalkKeys();
  renderer.externalCameraControl = false;
  ui!.dataset['walking'] = 'false';
  walkHud.setActive(false);
  haptics.tap();
}

const historyPanel = mountHistoryPanel(ui);

/**
 * Steps the clock to its next speed and says what happened.
 *
 * Announced rather than silent: at 2× the label on the button is the only clue,
 * and a player who paused by accident and cannot see why the city stopped will
 * assume the game broke rather than that they pressed something.
 */
function cycleSpeed(): void {
  clock.setSpeed(clock.nextSpeed());
  haptics.tap();
  const speed = clock.currentSpeed;
  toast.show(speed === 0 ? STR.view.paused : `${STR.view.speed}: ${speed}×`);
}

const viewControls = mountViewControls(ui, {
  // Anchored on the middle of the screen, which is what the player is looking
  // at when they reach for a button rather than a finger.
  onZoom: (factor) => camera.zoomAt(camera.viewportWidth / 2, camera.viewportHeight / 2, factor),
  onRotate: (radians) => camera.orbitByAngle(radians),
  speed: () => clock.currentSpeed,
  onCycleSpeed: () => cycleSpeed(),
  panLocked: () => panLocked,
  onTogglePanLock: () => {
    panLocked = !panLocked;
    // Whatever was mid-stroke when the hand went down is abandoned rather than
    // finished: the player has just said they meant to move the map.
    tools.cancelStroke();
    panFrom = null;
    haptics.tap();
    toast.show(panLocked ? STR.view.panOn : STR.view.panOff);
  },
  soundOn: () => sfx.enabled,
  onToggleSound: () => {
    sfx.setEnabled(!sfx.enabled);
    // Muting means the game, not the button that happened to be pressed. The
    // bed is torn down rather than turned to zero so a muted session is not
    // holding an audio graph open for nothing.
    if (!sfx.enabled) {
      ambient.stop();
      music.stop();
    }
  },
  onWalk: () => enterWalk(),
  onHistory: () => historyPanel.toggle(),
});
bindAudioUnlock(canvas);
registerServiceWorker();

/**
 * Answers a crime marker, if the tap was on one.
 *
 * Returns whether the tap was spent here, so the caller knows not to also open
 * the land prompt. Every outcome is spoken: a tap on a marker that cannot be
 * answered because there is no karakol has to say *that*, or the player learns
 * the marker is decoration.
 */
function sendPolice(tileX: number, tileY: number): boolean {
  if (crimeNear(game, tileX, tileY) === null) return false;
  const result = dispatchPolice(game, tileX, tileY);
  if (result === 'sent') {
    toast.show(STR.crime.dispatched);
    haptics.confirm();
    sfx.play('alarm');
  } else if (result === 'noStation') {
    toast.show(STR.crime.noStation);
  }
  // A marker was there, so the tap belonged to it however it turned out —
  // falling through to the parcel prompt would put a land offer over a robbery.
  return true;
}

/**
 * Places a station, or says why it could not. Refusals are spoken rather than
 * silent: a tap that does nothing and explains nothing reads as a broken game.
 */
function buildStation(tileX: number, tileY: number): void {
  const facility = tools.activeFacility;
  const name =
    facility.type === 'service'
      ? STR.service[facility.kind]
      : facility.type === 'utility'
        ? STR.utility[facility.kind]
        : STR.port[facility.kind];
  const result =
    facility.type === 'service'
      ? placeService(game, systems.fields, facility.kind, tileX, tileY)
      : facility.type === 'utility'
        ? placePlant(game, systems.fields, facility.kind, tileX, tileY)
        : placePort(game, systems.fields, facility.kind, tileX, tileY);

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
  toast.show(placedHeadline(facility), name);
}

/**
 * What to say when a facility goes down.
 *
 * Three cases earn their own line. The first working harbour changes what the
 * city fundamentally is — it now has a second way out of the country. A school
 * reports the research rate it just raised, because "okul koymak bir şeye sebep
 * olmalı": a building whose entire effect is a number nobody is shown may as
 * well not have an effect. Everything else gets the plain confirmation — which
 * until now said *Deniz tesisi kuruldu* for every fire station in the game.
 */
function placedHeadline(facility: FacilitySelection): string {
  if (facility.type === 'port') {
    return facility.kind === 'cargo' && hasSeaGate(game) ? STR.seaGateOpen : STR.portBuilt;
  }
  if (facility.type === 'service' && facility.kind === 'education') {
    // Coverage was invalidated a moment ago but the mask is still last tick's,
    // so this is measured from the school just placed rather than recomputed:
    // one more covered building than the field currently knows about.
    const coverage = educationCoverage(game);
    return STR.tech.schoolBuilt(researchPerMinute(game.population, coverage * 100));
  }
  return STR.serviceBuilt;
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
 * The spell the player has already been told about.
 *
 * Announced on change rather than polled into a badge: weather is an event that
 * happens to the city, and a permanent readout of "it is clear" is a line of
 * furniture. Starts at the spell the session opened in, so a returning player is
 * not greeted by news of weather that has been going on for an hour.
 */
let announcedSpell = weatherAt(game).spell;
/** Seconds since the repair bill was last put in front of the player. */
let roadRepairReminder = 0;
let lastAnnouncedKind = weatherAt(game).kind;
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
  // The keys move the map through the same drag maths the finger uses, so a
  // held key and a dragged finger agree however the view is turned.
  if (!walk.active && keyboard.keys.anyHeld) {
    const nudge = keyboard.keys.nudge(deltaMs / 1000);
    if (nudge.panX !== 0 || nudge.panY !== 0) {
      dock.closeSheet();
      camera.panByScreen(nudge.panX, nudge.panY);
    }
    if (nudge.rotate !== 0) camera.orbitByAngle(nudge.rotate);
    if (nudge.zoom !== 1) {
      camera.zoomAt(camera.viewportWidth / 2, camera.viewportHeight / 2, nudge.zoom);
    }
  }
  // The music runs on the audio clock; this only keeps its lookahead topped up.
  if (sfx.enabled) music.tick(deltaMs / 1000);
  if (walk.active) {
    const stick = walkHud.stick();
    walk.update(deltaMs, {
      forward: walkKeys.forward + (walkHud.touchLayout ? -stick.y : 0),
      strafe: walkKeys.strafe + (walkHud.touchLayout ? stick.x : 0),
      sprint: walkKeys.sprint,
    });
  }
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
      appendHistory([
        {
          year: yearOf(game.playedMs),
          icon: '🏙️',
          title: STR.era.reached(STR.eraName[era]),
          detail: unlockedBy(era, before),
        },
      ]);
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
    announceCrime();
    announceCohorts();
    announceTimeline();
    announceWeather();
    announcePetitions();
    announceRoadDamage(seconds);
    announceRituals();
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
  // Names get out of the way of the ink, the same as the hint does — and out
  // of a walk entirely: street level has no use for floating district names.
  districtLabels.setHidden(tools.isDrawing || walk.active);
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
 * Crime, announced — and mostly not announced.
 *
 * Measured before this was written: a metropolis with four streets in five
 * covered still produces about seventeen crime events a minute, and the feed
 * holds four lines for nine seconds. Reporting all of them would leave no room
 * in the blotter for anything else in the game.
 *
 * So the marker on the map is the notification, and the feed carries only what
 * the player cannot see for themselves:
 *
 * - a robbery that got away, always — money left the treasury and the marker
 *   they may not have been looking at is gone,
 * - an arrest the player's own tap paid for, as the payoff for the verb,
 * - and nothing at all for a crime the karakol started and finished by itself.
 *   Silence is precisely what the station was bought for.
 *
 * The first unanswered crime of a session also takes the toast, because it is
 * the only hazard in the game with an instruction attached — tap the marker —
 * and a line scrolling past in the blotter is not how a verb gets taught.
 */
function announceCrime(): void {
  const events = systems.drainCrimeEvents();
  if (events.length === 0) return;
  const lines: CustomEntry[] = [];
  for (const event of events) {
    if (event.kind === 'crimeEscaped') {
      lines.push({
        icon: '💸',
        tone: 'alarm',
        text: STR.crime.escaped(STR.format.money(event.loot ?? 0)),
      });
      sfx.play('blocked');
    } else if (event.kind === 'crimeSolved' && !event.automatic) {
      lines.push({ icon: '🚔', tone: 'calm', text: STR.crime.solved });
    } else if (event.kind === 'crimeStart' && !event.automatic && !taughtCrime) {
      taughtCrime = true;
      toast.show(STR.crime.started);
      sfx.play('alarm');
    }
  }
  if (lines.length > 0) eventFeed.pushCustom(lines);
}

/** Whether the player has been told what a crime marker is for. */
let taughtCrime = false;

/**
 * The city falling behind on its burials, and catching up again (sim/cohorts.ts).
 *
 * Announced on the crossing in both directions. A death wave is a mood drop with
 * no visible cause otherwise — nothing on the map changes when a generation dies —
 * so this is the only way the player can connect the drop to the answer.
 */
function announceCohorts(): void {
  const events = systems.drainCohortEvents();
  if (events.length === 0) return;
  for (const event of events) {
    const behind = event.kind === 'burialBacklog';
    toast.show(behind ? STR.cohort.backlog : STR.cohort.cleared);
    eventFeed.pushCustom([
      {
        icon: behind ? '⚰️' : '🕊️',
        tone: behind ? 'alarm' : 'calm',
        text: behind ? STR.cohort.waiting(event.waiting) : STR.cohort.cleared,
      },
    ]);
    if (behind) sfx.play('alarm');
  }
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
  // The feed announces and forgets; the diary remembers the city's century.
  appendHistory(
    fired.map(({ event }) => ({
      year: event.year,
      icon: event.icon,
      title: event.title,
      detail: event.detail,
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

/**
 * Reads out what the city has filed and what it has withdrawn.
 *
 * The feed rather than a toast: a petition is the city's opinion, not an
 * interruption, and the same blotter already carries the fires and the history.
 */
function announcePetitions(): void {
  const changes = systems.drainPetitions();
  if (changes.raised.length === 0 && changes.resolved.length === 0) return;

  eventFeed.pushCustom([
    ...changes.raised.map((kind) => ({
      icon: STR.petition.icon,
      tone: 'warn' as const,
      text: STR.petition.raised[kind],
    })),
    ...changes.resolved.map((kind) => ({
      icon: STR.petition.icon,
      tone: 'calm' as const,
      text: STR.petition.resolved[kind],
    })),
  ]);
}

/**
 * The days that come round every year (sim/rituals.ts).
 *
 * Straight to the feed and to the diary, with no toast: a holiday is not an
 * interruption, it is a thing the city is doing while the player gets on with
 * whatever they were doing. The mood bonus is applied in the sim, not here — it
 * is a fact about the city on that date, whether or not anybody read the line.
 */
function announceRituals(): void {
  const today = systems.drainRituals();
  if (today.length === 0) return;

  eventFeed.pushCustom(
    today.map(({ ritual }) => ({
      icon: ritual.icon,
      tone: 'calm' as const,
      text: ritual.title,
    })),
  );
  appendHistory(
    today.map(({ ritual, year }) => ({
      year,
      icon: ritual.icon,
      title: ritual.title,
      detail: ritual.detail,
    })),
  );
  sfx.play('coin');
}

/**
 * The war's bill for the road.
 *
 * Two things happen here that the petitions do not need. The map is rebuilt,
 * because a stretch shutting changes which streets reach the country and every
 * one of them is drawn differently for it; and the bill is put in front of the
 * player as a card rather than a line in the feed, because unlike a petition it
 * is a decision with a price and a deadline.
 *
 * The reminder is the safety net. A player who taps "sonra" on a barricade and
 * then forgets would otherwise watch their city empty with no way back on
 * screen, so while anything is outstanding the card comes back — not often
 * enough to nag, often enough that the way out is never more than a minute
 * away.
 */
function announceRoadDamage(seconds: number): void {
  const events = systems.drainRoadEvents();
  const blocked = blockedSections(game);

  if (events.length > 0) {
    eventFeed.pushCustom(
      events.map((event) => ({
        icon: STR.roadRepair.icon,
        tone: event.kind === 'reopened' ? ('calm' as const) : ('alarm' as const),
        text: STR.roadRepair[event.kind](event.sections),
      })),
    );
    appendHistory(
      events.map((event) => ({
        year: yearOf(game.playedMs),
        icon: STR.roadRepair.icon,
        title: STR.roadRepair[event.kind](event.sections),
        detail:
          event.kind === 'blocked'
            ? STR.roadRepair.chronicleBlocked
            : event.kind === 'reopened'
              ? STR.roadRepair.chronicleReopened
              : STR.roadRepair.chronicleDamaged,
      })),
    );
    // A barricade going up or coming down changes the surface, the markings and
    // every faded street behind it.
    renderer.invalidateRoads();
    if (events.some((event) => event.kind === 'blocked')) {
      toast.show(STR.roadRepair.blocked(blocked));
      sfx.play('alarm');
    }
  }

  const cost = repairCost(game);
  if (cost <= 0) {
    roadRepairReminder = 0;
    return;
  }
  roadRepairReminder += seconds;
  const asked = events.some((event) => event.kind !== 'reopened');
  if (!asked && roadRepairReminder < HIGHWAY_BILL_REMINDER_S) return;
  roadRepairReminder = 0;
  roadRepair.offer(cost, blocked > 0);
}

/**
 * Says so when the sky changes, once per spell.
 *
 * Clear weather is announced too, but only as the end of something: "hava açtı"
 * after a storm is information, whereas the same words out of nowhere are noise.
 */
function announceWeather(): void {
  const now = weatherAt(game);
  if (now.spell === announcedSpell) return;
  const previous = announcedSpell;
  announcedSpell = now.spell;

  const wasEventful = previous >= 0 && isWeatherWorthAnnouncing(lastAnnouncedKind);
  lastAnnouncedKind = now.kind;
  if (!isWeatherWorthAnnouncing(now.kind) && !wasEventful) return;

  eventFeed.pushCustom([
    {
      icon: STR.weather.icon[now.kind],
      tone: now.kind === 'heat' || now.kind === 'storm' ? 'warn' : 'calm',
      text: STR.weather[now.kind],
    },
  ]);
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
      seaIncome: game.ledger.seaIncome,
      visitorIncome: game.ledger.visitorIncome,
      programmeUpkeep: game.ledger.programmeUpkeep,
    },
    investments: {
      lighting: { level: game.investments.lighting },
      greening: { level: game.investments.greening },
      festivals: { level: game.investments.festivals },
    },
    totals: {
      housing: totals.housing,
      residents: totals.residents,
      commercialJobs: totals.commercialJobs,
      industrialJobs: totals.industrialJobs,
      farmJobs: totals.farmJobs,
    },
    demography: {
      child: bandCount(game, 'child'),
      young: bandCount(game, 'young'),
      adult: bandCount(game, 'adult'),
      elder: bandCount(game, 'elder'),
      working: workingShare(game),
      schooled: schooledShare(game),
      awaitingBurial: game.cohorts.awaitingBurial,
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
  // The bed follows the city on the same throttle as the readout: it ramps over
  // a second and a half, so telling it more often than twice a second would be
  // scheduling changes it has not finished making.
  if (sfx.enabled) {
    const night = nightAmount(dayFraction(game.playedMs));
    ambient.setScene({
      population: game.population,
      night,
      cameraDistance: camera.distance,
    });
    music.setScene({ year: yearOf(game.playedMs), night });
  }
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
// A handle for the curious and for automated checks: reading is safe, writing
// is your own adventure.
(window as unknown as Record<string, unknown>)['__kadastro'] = {
  game,
  camera,
  walk,
  enterWalk,
  exitWalk,
};
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
