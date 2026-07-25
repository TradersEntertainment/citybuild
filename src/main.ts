import './style.css';
import { bindAudioUnlock } from './audio/context';
import { INK_DRY_MS } from './data/balance';
import { STR } from './data/strings.tr';
import type { TilePoint } from './input/pathGeometry';
import { bindPointerInput, bindWheelZoom } from './input/pointer';
import { ToolController } from './input/tools';
import { registerServiceWorker } from './pwa/registerSW';
import { Camera } from './render/camera';
import type { InkDryEffect } from './render/layers/roads';
import { Renderer } from './render/renderer';
import { Clock } from './sim/clock';
import { creditAwayTime } from './sim/offline';
import { hashSeed } from './sim/rng';
import { createGameState } from './sim/state';
import { Systems } from './sim/systems';
import { UndoStack } from './sim/undo';
import { startingCentre } from './sim/world';
import { uiStore } from './state/store';
import { mountCostLabel } from './ui/costLabel';
import * as haptics from './ui/haptics';
import { mountToolDock } from './ui/toolDock';
import { mountHint, mountTopBar } from './ui/topBar';

/**
 * Bootstrap and frame loop. This file wires modules together and owns nothing
 * except the ink-drying effect list, which is presentation state with no place
 * in the sim.
 */
const canvas = document.querySelector<HTMLCanvasElement>('#map');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('Game shell missing from index.html');

const game = createGameState(hashSeed('kadastro'), Date.now());
const camera = new Camera();
const renderer = new Renderer(canvas, camera);
const clock = new Clock();
const undo = new UndoStack();
const systems = new Systems(game.world.size);

const home = startingCentre(game.world);
camera.centreOn(home.x, home.y);
camera.setBounds({ minX: 0, minY: 0, maxX: game.world.size, maxY: game.world.size });

const inkDry: InkDryEffect[] = [];

const tools = new ToolController(game, camera, undo, {
  onBuilt: (tiles: readonly TilePoint[]) => {
    inkDry.push({ tiles: [...tiles], startedAt: performance.now() });
    haptics.confirm();
    uiStore.getState().hideHint();
  },
  // Road access, and therefore land value, is derived from the road column.
  onRoadsChanged: () => systems.invalidateFields(),
  onChanged: () => syncUi(),
});

const updateCostLabel = mountCostLabel(ui);
mountTopBar(ui);
mountHint(ui);
const dock = mountToolDock(ui, {
  tools,
  era: () => game.era,
  onUndo: () => {
    if (!tools.undoLast()) return;
    haptics.tap();
  },
});

const input = bindPointerInput(canvas, {
  onCameraPan: (dx, dy) => {
    dock.closeSheet();
    camera.panByScreen(dx, dy);
  },
  onCameraZoom: (anchorX, anchorY, factor) => camera.zoomAt(anchorX, anchorY, factor),
  onStrokeStart: (sample) => {
    // The invitation copy sits mid-screen; get it out of the way of the ink
    // the moment the player starts drawing, not once the road is paid for.
    uiStore.getState().hideHint();
    dock.closeSheet();
    tools.strokeStart(sample.x, sample.y);
  },
  onStrokeMove: (sample) => tools.strokeMove(sample.x, sample.y),
  onStrokeEnd: () => tools.strokeEnd(),
  onStrokeCancel: () => tools.cancelStroke(),
  onTap: () => dock.closeSheet(),
});
bindWheelZoom(canvas, (x, y, factor) => camera.zoomAt(x, y, factor));
bindAudioUnlock(canvas);
registerServiceWorker();

// --- Viewport plumbing -------------------------------------------------------
// Safari fires resize during the address-bar animation with stale metrics, so
// the visualViewport events matter as much as window resize here.
const handleResize = (): void => renderer.resize();
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);
window.visualViewport?.addEventListener('resize', handleResize);
window.visualViewport?.addEventListener('scroll', handleResize);
renderer.resize();

// --- Away-time bookkeeping ---------------------------------------------------
// rAF stops when the tab backgrounds, so the gap is measured on visibility
// rather than counted in frames, and handed to the offline system (§11).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    game.lastSeen = Date.now();
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
      // A new era unlocks tools and changes how the map is drawn; both are read
      // from state, so the dock just needs to re-render its rows.
      dock.refresh();
      renderer.invalidateTerrain();
    }
  }
  if (budget.economyTicks > 0) {
    systems.stepEconomy(game, (budget.economyTicks * clock.economyStepMs) / 1000);
  }
  game.playedMs = clock.playedMs;

  tools.update();
  pruneInkDry(now);

  renderer.render({ state: game, draft: tools.draft, inkDry, now }, deltaMs);

  updateCostLabel(tools.isDrawing ? tools.summary : null);
  publishReadout();

  requestAnimationFrame(frame);
}

function pruneInkDry(now: number): void {
  // Splice from the front: effects are pushed in time order, so the expired
  // ones are always the earliest.
  while (inkDry.length > 0 && now - (inkDry[0] as InkDryEffect).startedAt > INK_DRY_MS) {
    inkDry.shift();
  }
}

function syncUi(): void {
  uiStore.getState().syncFromSim({
    era: game.era,
    money: game.money,
    population: game.population,
    happiness: game.happiness,
    taxRate: game.taxRate,
    demand: { ...game.demand },
    net: game.ledger.net,
  });
}

function publishReadout(): void {
  // Store writes drive DOM updates; twice a second is plenty for a city whose
  // numbers move on a one-second tick.
  readoutAccumulator += 1;
  if (readoutAccumulator < 15) return;
  readoutAccumulator = 0;
  syncUi();
  const state = uiStore.getState();
  state.setCameraReadout(STR.camera.readout(camera.x, camera.y, camera.zoom));
  state.setFps(renderer.stats.fps);
}

syncUi();
requestAnimationFrame(frame);
