import { BRUSH_SIZES, ZONE_COST } from '../data/balance';
import { ZONE_TINTS } from '../data/buildings';
import { ROAD_SPECS, ROAD_TIERS, isRoadUnlocked } from '../data/roads';
import { STR } from '../data/strings.tr';
import type { ToolController, ToolId } from '../input/tools';
import { ZONE_ORDER, type Era, type RoadKind, type ZoneKind } from '../sim/tiles';
import * as haptics from './haptics';

/**
 * Bottom tool bar and its sheet (§14.4). Tapping a tool raises a bottom sheet
 * with that tool's options; a full-screen menu never opens. Every control sits
 * in the thumb zone and clears the 44 px minimum touch target.
 *
 * Locked road tiers are shown, not hidden — the brief wants the player to see
 * what is coming and what unlocks it (§1).
 */
export interface DockDeps {
  tools: ToolController;
  era: () => Era;
  onUndo: () => void;
}

export interface DockHandle {
  /** Closes the sheet; the map calls this when the player starts drawing. */
  closeSheet(): void;
  /** Re-reads tool state, e.g. after an era unlocked something. */
  refresh(): void;
  dispose(): void;
}

export function mountToolDock(root: HTMLElement, deps: DockDeps): DockHandle {
  const dockElement = root.querySelector<HTMLElement>('#tool-dock');
  const sheetElement = root.querySelector<HTMLElement>('#tool-sheet');
  if (!dockElement || !sheetElement) throw new Error('Tool dock markup missing');
  // Bound after the check so the hoisted helpers below see non-null types.
  const dock: HTMLElement = dockElement;
  const sheet: HTMLElement = sheetElement;

  dock.textContent = '';
  const roadButton = toolButton();
  const zoneButton = toolButton();
  const eraseButton = toolButton(STR.tools.erase);
  const undoButton = toolButton(STR.tools.undo);
  dock.append(roadButton, zoneButton, eraseButton, spacer(), undoButton);

  let openSheetFor: ToolId | null = null;

  const closeSheet = (): void => {
    sheet.dataset['open'] = 'false';
    sheet.setAttribute('aria-hidden', 'true');
    openSheetFor = null;
  };

  const refresh = (): void => {
    const tool = deps.tools.activeTool;
    roadButton.dataset['active'] = String(tool === 'road');
    zoneButton.dataset['active'] = String(tool === 'zone');
    eraseButton.dataset['active'] = String(tool === 'erase');
    setButtonLabel(roadButton, STR.tools.road, STR.road[deps.tools.activeRoadKind]);
    setButtonLabel(zoneButton, STR.tools.zone, STR.zone[deps.tools.activeZoneKind]);
    if (openSheetFor === 'road') fillRoadSheet();
    if (openSheetFor === 'zone') fillZoneSheet();
  };

  const openSheet = (tool: ToolId): void => {
    openSheetFor = tool;
    if (tool === 'road') fillRoadSheet();
    else fillZoneSheet();
    sheet.dataset['open'] = 'true';
    sheet.setAttribute('aria-hidden', 'false');
  };

  function fillRoadSheet(): void {
    sheet.textContent = '';
    sheet.append(sheetTitle(STR.tools.roadSheetTitle));
    for (const kind of ROAD_TIERS) sheet.append(roadRow(kind));
  }

  function fillZoneSheet(): void {
    sheet.textContent = '';
    sheet.append(sheetTitle(STR.tools.zoneSheetTitle));
    for (const kind of ZONE_ORDER) sheet.append(zoneRow(kind));
    sheet.append(sheetTitle(STR.tools.brushTitle), brushRow());
  }

  function roadRow(kind: RoadKind): HTMLElement {
    const spec = ROAD_SPECS[kind];
    const unlocked = isRoadUnlocked(kind, deps.era());
    const row = sheetRow(STR.road[kind], unlocked
      ? `${STR.format.money(spec.cost)}/kare`
      : STR.lockedAt(STR.eraName[spec.unlockedAt]));
    row.dataset['locked'] = String(!unlocked);
    row.disabled = !unlocked;
    row.dataset['selected'] = String(deps.tools.activeRoadKind === kind);
    row.addEventListener('click', () => {
      if (!deps.tools.setRoadKind(kind)) return;
      haptics.tap();
      refresh();
      closeSheet();
    });
    return row;
  }

  function zoneRow(kind: ZoneKind): HTMLElement {
    const row = sheetRow(STR.zone[kind], `${STR.format.money(zoneCost(kind))}/kare`);
    row.dataset['selected'] = String(deps.tools.activeZoneKind === kind);
    row.prepend(swatch(ZONE_TINTS[kind]));
    row.addEventListener('click', () => {
      deps.tools.setZoneKind(kind);
      haptics.tap();
      refresh();
      closeSheet();
    });
    return row;
  }

  function brushRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'brush-row';
    for (const size of BRUSH_SIZES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'brush-button';
      button.textContent = STR.tools.brushSize(size);
      button.dataset['selected'] = String(deps.tools.brushSize === size);
      button.addEventListener('click', () => {
        deps.tools.setBrush(size);
        haptics.tap();
        refresh();
      });
      row.append(button);
    }
    return row;
  }

  const selectTool = (tool: ToolId, withSheet: boolean): void => {
    haptics.tap();
    if (withSheet && deps.tools.activeTool === tool) {
      // Second tap on the active tool toggles its sheet.
      if (openSheetFor === tool) closeSheet();
      else openSheet(tool);
      return;
    }
    deps.tools.setTool(tool);
    if (withSheet) openSheet(tool);
    else closeSheet();
    refresh();
  };

  roadButton.addEventListener('click', () => selectTool('road', true));
  zoneButton.addEventListener('click', () => selectTool('zone', true));
  eraseButton.addEventListener('click', () => selectTool('erase', false));
  undoButton.addEventListener('click', () => {
    haptics.tap();
    deps.onUndo();
  });

  refresh();
  return {
    closeSheet,
    refresh,
    dispose: () => {
      dock.textContent = '';
      sheet.textContent = '';
    },
  };
}

function zoneCost(kind: ZoneKind): number {
  return ZONE_COST[kind];
}

function sheetRow(name: string, meta: string): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'sheet-row';

  const label = document.createElement('span');
  label.className = 'sheet-row-name';
  label.textContent = name;

  const detail = document.createElement('span');
  detail.className = 'sheet-row-meta mono';
  detail.textContent = meta;

  row.append(label, detail);
  return row;
}

function swatch(colour: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'swatch';
  element.style.background = colour;
  return element;
}

function toolButton(label = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-button';
  if (label) button.textContent = label;
  return button;
}

/**
 * A tool button carries its current option on a second line. Putting both on
 * one line wraps on a 390 px screen, and a dock that changes height as the
 * player switches tools moves the map under their thumb.
 */
function setButtonLabel(button: HTMLButtonElement, name: string, option: string): void {
  button.textContent = '';
  const title = document.createElement('span');
  title.className = 'tool-name';
  title.textContent = name;
  const detail = document.createElement('span');
  detail.className = 'tool-option';
  detail.textContent = option;
  button.append(title, detail);
}

function spacer(): HTMLElement {
  const element = document.createElement('span');
  element.className = 'dock-spacer';
  return element;
}

function sheetTitle(text: string): HTMLElement {
  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = text;
  return title;
}
