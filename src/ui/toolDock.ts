import { BRUSH_SIZES, ZONE_COST } from '../data/balance';
import { ZONE_TINTS } from '../data/buildings';
import { ROAD_SPECS, ROAD_TIERS, isRoadUnlocked } from '../data/roads';
import { PORT_ORDER, PORT_SPECS, isPortUnlocked, type PortKind } from '../data/ports';
import { SERVICE_ORDER, SERVICE_SPECS, isServiceUnlocked, type ServiceKind } from '../data/services';
import {
  UTILITY_ORDER,
  UTILITY_SPECS,
  isUtilityUnlocked,
  type UtilityKind,
  type UtilitySpec,
} from '../data/utilities';
import { STR } from '../data/strings.tr';
import type { TechId } from '../data/tech';
import type { TechOffer } from '../sim/tech';
import type { FacilitySelection, ToolController, ToolId } from '../input/tools';
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
/**
 * Sheets are not quite tools. Research has options to choose between but
 * nothing to point at on the map, so it raises a sheet without ever becoming
 * the active tool — leaving the player holding an instrument that does nothing
 * when they touch the city is the shape of the bug that made the map
 * unpannable.
 */
type SheetId = ToolId | 'tech';

export interface DockDeps {
  tools: ToolController;
  era: () => Era;
  onUndo: () => void;
  /** Whether the city is big enough to run a bus line yet (sim/transit.ts). */
  transitUnlocked: () => boolean;
  /** Research points in hand, and what they will buy. */
  research: () => number;
  /**
   * Share of buildings a school reaches, and the points that earns per minute.
   *
   * Shown rather than described. The sheet used to say only that schools help,
   * which a player who builds one and watches nothing move is entitled to read
   * as a rumour — these two numbers are what the next school changes.
   */
  schooling: () => { coverage: number; perMinute: number };
  techOffers: () => TechOffer[];
  /** Returns whether the tech was actually researched. */
  onResearch: (id: TechId) => boolean;
}

export interface DockHandle {
  /** Closes the sheet; the map calls this when the player starts drawing. */
  closeSheet(): void;
  /** True while a tool's options are showing — the coach waits on this. */
  readonly isSheetOpen: boolean;
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
  // "Browse" comes first and is the resting state: with no tool selected, one
  // finger drags the map. Without it a player who picks a tool has no way back
  // to simply looking at their city.
  const panButton = toolButton(STR.tools.pan);
  const roadButton = toolButton();
  const zoneButton = toolButton();
  const serviceButton = toolButton();
  const eraseButton = toolButton(STR.tools.erase);
  const transitButton = toolButton(STR.tools.transit);
  const techButton = toolButton(STR.tools.tech);
  const undoButton = toolButton(STR.tools.undo);
  dock.append(
    panButton,
    roadButton,
    zoneButton,
    serviceButton,
    transitButton,
    eraseButton,
    techButton,
    spacer(),
    undoButton,
  );

  let openSheetFor: SheetId | null = null;

  const closeSheet = (): void => {
    sheet.dataset['open'] = 'false';
    sheet.setAttribute('aria-hidden', 'true');
    openSheetFor = null;
  };

  const refresh = (): void => {
    const tool = deps.tools.activeTool;
    panButton.dataset['active'] = String(tool === 'none');
    roadButton.dataset['active'] = String(tool === 'road');
    zoneButton.dataset['active'] = String(tool === 'zone');
    serviceButton.dataset['active'] = String(tool === 'service');
    eraseButton.dataset['active'] = String(tool === 'erase');
    // Locked until the city is big enough for a line to be worth the fares
    // (sim/transit.ts). Shown rather than hidden, with what opens it, like every
    // other lock in the game.
    const canRide = deps.transitUnlocked();
    transitButton.dataset['active'] = String(tool === 'transit');
    transitButton.dataset['locked'] = String(!canRide);
    transitButton.disabled = !canRide;
    setButtonLabel(roadButton, STR.tools.road, STR.road[deps.tools.activeRoadKind]);
    setButtonLabel(zoneButton, STR.tools.zone, STR.zone[deps.tools.activeZoneKind]);
    setButtonLabel(serviceButton, STR.tools.service, facilityName(deps.tools.activeFacility));
    if (openSheetFor === 'road') fillRoadSheet();
    if (openSheetFor === 'zone') fillZoneSheet();
    if (openSheetFor === 'service') fillServiceSheet();
    if (openSheetFor === 'erase') fillEraseSheet();
    if (openSheetFor === 'tech') fillTechSheet();
  };

  const openSheet = (tool: SheetId): void => {
    openSheetFor = tool;
    if (tool === 'road') fillRoadSheet();
    else if (tool === 'service') fillServiceSheet();
    else if (tool === 'erase') fillEraseSheet();
    else if (tool === 'tech') fillTechSheet();
    else fillZoneSheet();
    sheet.dataset['open'] = 'true';
    sheet.setAttribute('aria-hidden', 'false');
  };

  function fillRoadSheet(): void {
    sheet.textContent = '';
    sheet.append(sheetTitle(STR.tools.roadSheetTitle));
    for (const kind of ROAD_TIERS) sheet.append(roadRow(kind));
    // Under the tiers, because it modifies whichever one is held rather than
    // being a tier of its own.
    sheet.append(sheetTitle(STR.tools.oneWayTitle));
    sheet.append(sheetNote(STR.tools.oneWayNote));
    sheet.append(oneWayRow());
  }

  /**
   * The one-way switch: two states, and the direction comes from the stroke.
   *
   * Shaped like the brush row rather than as a checkbox, because on a phone a
   * pair of wide buttons is a target and a checkbox is a dare.
   */
  function oneWayRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'brush-row';
    for (const on of [false, true]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'brush-button';
      button.textContent = on ? STR.tools.oneWayOn : STR.tools.oneWayOff;
      button.dataset['selected'] = String(deps.tools.oneWayArmed === on);
      button.addEventListener('click', () => {
        deps.tools.setOneWay(on);
        haptics.tap();
        refresh();
        fillRoadSheet();
      });
      row.append(button);
    }
    return row;
  }

  function fillZoneSheet(): void {
    sheet.textContent = '';
    sheet.append(sheetTitle(STR.tools.zoneSheetTitle));
    for (const kind of ZONE_ORDER) sheet.append(zoneRow(kind));
    sheet.append(sheetTitle(STR.tools.brushTitle), brushRow());
  }

  /**
   * The eraser shares the zone brush, because it is undoing zone-sized
   * mistakes. It also says what it takes: a player who reads "sil" as "sil yol"
   * will not reach for it when a district is painted wrong.
   */
  function fillEraseSheet(): void {
    sheet.textContent = '';
    sheet.append(sheetTitle(STR.tools.eraseSheetTitle));
    sheet.append(sheetNote(STR.tools.eraseNote));
    sheet.append(sheetTitle(STR.tools.brushTitle), brushRow());
  }

  /**
   * Research. It opens its own sheet and never becomes the active tool: there
   * is nothing to point at on the map, and leaving the player holding a tool
   * that does nothing when they tap the city is how the pan bug started.
   */
  function fillTechSheet(): void {
    sheet.textContent = '';
    const title = sheetTitle(STR.tech.title);
    const points = document.createElement('span');
    points.className = 'panel-heading-count mono';
    points.textContent = STR.tech.points(deps.research());
    title.append(points);
    sheet.append(title);

    const school = deps.schooling();
    sheet.append(
      sheetNote(
        school.coverage > 0
          ? STR.tech.rate(school.coverage, school.perMinute)
          : STR.tech.rateHint,
      ),
    );

    const offers = deps.techOffers();
    if (offers.length === 0) {
      sheet.append(sheetNote(STR.tech.none));
      return;
    }
    for (const offer of offers) sheet.append(techRow(offer));
  }

  function techRow(offer: TechOffer): HTMLElement {
    const row = sheetRow(
      STR.tech.name[offer.tech.id],
      offer.done ? STR.tech.done : STR.tech.cost(offer.tech.cost),
    );
    row.dataset['locked'] = String(offer.done || !offer.affordable);
    row.dataset['selected'] = String(offer.done);
    row.disabled = offer.done;
    // The effect is the whole reason to buy it, so it is on the row rather than
    // behind a tap the player has to make before they can decide.
    const detail = document.createElement('span');
    detail.className = 'sheet-row-note';
    detail.textContent = STR.tech.detail[offer.tech.id];
    row.append(detail);
    row.addEventListener('click', () => {
      if (!deps.onResearch(offer.tech.id)) return;
      haptics.tap();
      fillTechSheet();
      refresh();
    });
    return row;
  }

  function fillServiceSheet(): void {
    sheet.textContent = '';
    sheet.append(sheetTitle(STR.tools.serviceSheetTitle));
    for (const kind of SERVICE_ORDER) sheet.append(serviceRow(kind));
    // Plants sit under the same heading because they are placed the same way;
    // separating them into their own tool would double the dock to say so.
    sheet.append(sheetTitle(STR.tools.utilitySheetTitle));
    for (const kind of UTILITY_ORDER) sheet.append(utilityRow(kind));
    // And the waterfront, under the same tool for the same reason: it is placed
    // with a tap on owned ground, so it belongs to the same verb.
    sheet.append(sheetTitle(STR.portSheetTitle));
    sheet.append(sheetNote(STR.portNote));
    for (const kind of PORT_ORDER) sheet.append(portRow(kind));
  }

  function portRow(kind: PortKind): HTMLElement {
    const spec = PORT_SPECS[kind];
    const unlocked = isPortUnlocked(kind, deps.era());
    const row = sheetRow(
      STR.port[kind],
      unlocked
        ? STR.serviceCost(spec.cost, spec.upkeep)
        : STR.lockedAt(STR.eraName[spec.unlockedAt]),
    );
    row.dataset['locked'] = String(!unlocked);
    row.disabled = !unlocked;
    const active = deps.tools.activeFacility;
    row.dataset['selected'] = String(active.type === 'port' && active.kind === kind);
    row.addEventListener('click', () => {
      if (!deps.tools.setFacility({ type: 'port', kind })) return;
      haptics.tap();
      refresh();
      closeSheet();
    });
    return row;
  }

  function utilityRow(kind: UtilityKind): HTMLElement {
    const spec = UTILITY_SPECS[kind];
    const unlocked = isUtilityUnlocked(kind, deps.era());
    const row = sheetRow(
      STR.utility[kind],
      unlocked ? plantDetail(spec) : STR.lockedAt(STR.eraName[spec.unlockedAt]),
    );
    row.dataset['locked'] = String(!unlocked);
    row.disabled = !unlocked;
    const active = deps.tools.activeFacility;
    row.dataset['selected'] = String(active.type === 'utility' && active.kind === kind);
    row.addEventListener('click', () => {
      if (!deps.tools.setFacility({ type: 'utility', kind })) return;
      haptics.tap();
      refresh();
      closeSheet();
    });
    return row;
  }

  function serviceRow(kind: ServiceKind): HTMLElement {
    const spec = SERVICE_SPECS[kind];
    const unlocked = isServiceUnlocked(kind, deps.era());
    // Upkeep is on the row beside the price: a station is a standing cost, and
    // finding that out after building four of them is not a fair surprise.
    const row = sheetRow(
      STR.service[kind],
      unlocked
        ? STR.serviceCost(spec.cost, spec.upkeep)
        : STR.lockedAt(STR.eraName[spec.unlockedAt]),
    );
    row.dataset['locked'] = String(!unlocked);
    row.disabled = !unlocked;
    const active = deps.tools.activeFacility;
    row.dataset['selected'] = String(active.type === 'service' && active.kind === kind);
    row.addEventListener('click', () => {
      if (!deps.tools.setFacility({ type: 'service', kind })) return;
      haptics.tap();
      refresh();
      closeSheet();
    });
    return row;
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
      // Second tap on the active tool toggles its sheet; a third puts the tool
      // down, which is the escape hatch from painting everything you touch.
      if (openSheetFor === tool) {
        closeSheet();
        deps.tools.setTool('none');
        refresh();
        return;
      }
      openSheet(tool);
      return;
    }
    deps.tools.setTool(tool);
    if (withSheet) openSheet(tool);
    else closeSheet();
    refresh();
  };

  panButton.addEventListener('click', () => selectTool('none', false));
  roadButton.addEventListener('click', () => selectTool('road', true));
  zoneButton.addEventListener('click', () => selectTool('zone', true));
  serviceButton.addEventListener('click', () => selectTool('service', true));
  eraseButton.addEventListener('click', () => selectTool('erase', true));
  // No sheet: a line has no options to pick, only a shape to draw.
  transitButton.addEventListener('click', () => selectTool('transit', false));
  techButton.addEventListener('click', () => {
    haptics.tap();
    if (openSheetFor === 'tech') {
      closeSheet();
      return;
    }
    openSheet('tech');
  });
  undoButton.addEventListener('click', () => {
    haptics.tap();
    deps.onUndo();
  });

  refresh();
  return {
    closeSheet,
    get isSheetOpen() {
      return openSheetFor !== null;
    },
    refresh,
    dispose: () => {
      dock.textContent = '';
      sheet.textContent = '';
    },
  };
}

/**
 * What a plant gives and what it costs, on one line.
 *
 * Six ways to make power are only a choice if the trade is visible at the moment
 * of choosing. Without the capacity and the smoke on the row, the sheet is eight
 * prices and the player picks the cheapest one every time.
 */
function plantDetail(spec: UtilitySpec): string {
  const tags: string[] = [];
  if (spec.provides === 'power') {
    tags.push(
      spec.pollution === 0
        ? STR.plantTag.clean
        : spec.pollution <= 15
          ? STR.plantTag.someSmoke
          : spec.pollution <= 35
            ? STR.plantTag.smoke
            : STR.plantTag.heavySmoke,
    );
  }
  if (spec.waterNeeded > 0) tags.push(STR.plantTag.needsWater);
  return STR.plantDetail(
    spec.capacity,
    STR.plantUnit[spec.provides],
    spec.cost,
    spec.upkeep,
    tags,
  );
}

/** Label for whichever facility the tool is holding. */
function facilityName(selection: FacilitySelection): string {
  if (selection.type === 'service') return STR.service[selection.kind];
  if (selection.type === 'utility') return STR.utility[selection.kind];
  return STR.port[selection.kind];
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

/** A line of prose in a sheet, for a tool whose rule is not a list of options. */
function sheetNote(text: string): HTMLElement {
  const note = document.createElement('p');
  note.className = 'sheet-note';
  note.textContent = text;
  return note;
}
