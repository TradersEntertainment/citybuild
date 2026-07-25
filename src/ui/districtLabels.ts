import { STR } from '../data/strings.tr';
import type { CameraRig } from '../render3d/cameraRig';
import type { District } from '../sim/districts';

/**
 * Neighbourhood names, floating over the city.
 *
 * DOM rather than sprites in the scene: text is the one thing a browser draws
 * better than a canvas-generated texture, and a label has to stay legible at
 * every zoom the camera reaches, which a textured quad cannot do without a
 * separate mipmap chain per name.
 *
 * They are meant to be noticed and then ignored, so they are quiet, they fade
 * out as the camera comes down to street level — where the buildings are the
 * subject — and they disappear entirely while a stroke is being drawn.
 */
export interface DistrictLabelsHandle {
  /** Replaces the set of names; called on a slow timer, not per frame. */
  setDistricts(districts: readonly District[]): void;
  /** Repositions what is on screen; called every frame. */
  reposition(): void;
  setHidden(hidden: boolean): void;
  dispose(): void;
}

/**
 * Below this the player is looking at buildings, not at districts, and the
 * names would be sitting on the roofs they describe. Above it there is no fade
 * at all: the furthest the camera goes is the map view, which is precisely
 * where knowing what a part of the city is called is worth most.
 */
const NEAR_FADE = 26;
const NEAR_SPAN = 16;
/** No more than this many on screen; a wall of names is a wall. */
const MAX_LABELS = 12;
/**
 * Zoomed far enough out that the whole city is in frame, twelve names are
 * twelve names on top of each other. Only the biggest neighbourhoods survive
 * that far away, which is also what a real map does.
 */
const CROWDED_DISTANCE = 96;
const CROWDED_LABELS = 5;
/** Screen height reserved for the dock and the collapsed panel. */
const DOCK_CLEARANCE = 118;

export function mountDistrictLabels(root: HTMLElement, camera: CameraRig): DistrictLabelsHandle {
  const layer = document.createElement('div');
  layer.className = 'district-labels';
  layer.setAttribute('aria-hidden', 'true');
  root.append(layer);

  let districts: readonly District[] = [];
  const elements: HTMLElement[] = [];
  let hidden = false;

  const elementAt = (i: number): HTMLElement => {
    let element = elements[i];
    if (!element) {
      element = document.createElement('div');
      element.className = 'district-label';
      const name = document.createElement('span');
      name.className = 'district-name';
      const detail = document.createElement('span');
      detail.className = 'district-detail mono';
      element.append(name, detail);
      layer.append(element);
      elements[i] = element;
    }
    return element;
  };

  const setDistricts = (next: readonly District[]): void => {
    districts = next.slice(0, MAX_LABELS);
    for (let i = 0; i < districts.length; i++) {
      const district = districts[i] as District;
      const element = elementAt(i);
      const name = element.firstElementChild as HTMLElement;
      const detail = element.lastElementChild as HTMLElement;
      const text = district.name;
      if (name.textContent !== text) name.textContent = text;
      const reading = STR.district.detail(district.population, district.buildings);
      if (detail.textContent !== reading) detail.textContent = reading;
      element.dataset['character'] = district.character;
    }
    // Extra elements from a larger city are kept and parked rather than
    // destroyed: districts come and go as the player builds, and churning the
    // DOM for it would be work every second for no visible difference.
    for (let i = districts.length; i < elements.length; i++) {
      (elements[i] as HTMLElement).style.opacity = '0';
    }
  };

  const reposition = (): void => {
    if (hidden) {
      layer.dataset['hidden'] = 'true';
      return;
    }
    layer.dataset['hidden'] = 'false';

    // One fade for the whole layer by distance, so names do not pop in one at a
    // time as the camera drifts.
    const distance = camera.distance;
    const layerOpacity = Math.min(1, Math.max(0, (distance - NEAR_FADE) / NEAR_SPAN));
    // Districts arrive sorted biggest first, so thinning is a cut, not a search.
    const shown = distance > CROWDED_DISTANCE ? CROWDED_LABELS : districts.length;

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      const district = i < shown ? districts[i] : undefined;
      if (!district || layerOpacity <= 0.02) {
        element.style.opacity = '0';
        continue;
      }
      const placed = camera.placeOnScreen(district.x + 0.5, district.y + 0.5);
      if (placed.behind) {
        element.style.opacity = '0';
        continue;
      }
      // A margin rather than the exact viewport, so a name does not vanish the
      // instant its anchor crosses the edge while the label is still visible.
      // The bottom is different: the dock and the panel live there, and a
      // neighbourhood name printed across the tool buttons is just noise.
      const margin = 120;
      if (
        placed.x < -margin ||
        placed.y < -margin ||
        placed.x > camera.viewportWidth + margin ||
        placed.y > camera.viewportHeight - DOCK_CLEARANCE
      ) {
        element.style.opacity = '0';
        continue;
      }
      element.style.transform = `translate(${Math.round(placed.x)}px, ${Math.round(placed.y)}px) translate(-50%, -100%)`;
      element.style.opacity = String(layerOpacity);
    }
  };

  return {
    setDistricts,
    reposition,
    setHidden: (value: boolean) => {
      hidden = value;
    },
    dispose: () => layer.remove(),
  };
}
