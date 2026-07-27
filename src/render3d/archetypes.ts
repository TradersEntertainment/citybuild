import type { BuiltZone } from '../data/buildings';
import type { Era } from '../sim/tiles';
import type { FacadeOptions } from './facade';

/**
 * What a building looks like: three architectural periods, each with fifteen
 * archetypes (three zones × five levels).
 *
 * The city restyles wholesale when it changes era rather than each building
 * keeping the look of the year it went up. That is not how a real city ages,
 * and it is the better game: reaching an era is the biggest thing that happens
 * in a session, and having the whole skyline grow up — pitched tile roofs to
 * brick parapets to glass — is a reward the player watches happen rather than
 * reads in a toast. It also keeps the period out of the save entirely, since it
 * is derived from the era at draw time.
 *
 * Three periods rather than seven, because seven would be six distinctions
 * nobody could name, and because every period costs instanced meshes and two
 * generated textures per archetype. The buckets are made on demand, so a
 * village pays for the village.
 */
export type Period = 'early' | 'industrial' | 'modern';

export function periodOf(era: Era): Period {
  if (era === 'founding' || era === 'village') return 'early';
  if (era === 'town' || era === 'city') return 'industrial';
  return 'modern';
}

export interface Archetype {
  /** Footprint side as a fraction of a tile. */
  footprint: number;
  /** Wall height in world units; one unit is one tile width. */
  height: number;
  /**
   * Ridge height above the wall top. Zero is a flat roof with a parapet — the
   * difference between a cottage and an office block is the roofline far more
   * than it is the colour, so this is geometry rather than texture.
   */
  roofPitch: number;
  roof: string;
  facade: FacadeOptions;
}

function arch(
  footprint: number,
  height: number,
  roofPitch: number,
  roof: string,
  facade: FacadeOptions,
): Archetype {
  return { footprint, height, roofPitch, roof, facade };
}

function wall(
  wallColour: string,
  glass: string,
  columns: number,
  rows: number,
  lit: number,
  banded: boolean,
): FacadeOptions {
  return { wall: wallColour, glass, columns, rows, lit, litColour: '#FFE9BC', banded };
}

/**
 * Founding and village: timber frame and lime plaster, deep pitched roofs in
 * tile and slate, small punched windows, and almost nothing lit — a settlement
 * this size goes to bed.
 */
const EARLY: Record<BuiltZone, readonly Archetype[]> = {
  res: [
    arch(0.42, 0.20, 0.16, '#8A4B33', wall('#E4D8C0', '#4A4034', 2, 1, 0.10, false)),
    arch(0.50, 0.30, 0.20, '#864A34', wall('#DFD2B8', '#463C31', 3, 2, 0.13, false)),
    arch(0.58, 0.46, 0.22, '#7E4633', wall('#D8CAAF', '#423930', 3, 3, 0.16, false)),
    arch(0.66, 0.62, 0.24, '#764434', wall('#D0C2A6', '#3E362D', 4, 4, 0.18, false)),
    arch(0.72, 0.82, 0.26, '#6E4234', wall('#C8BA9E', '#3A332B', 4, 5, 0.20, false)),
  ],
  com: [
    arch(0.44, 0.24, 0.14, '#7A5638', wall('#E8DCC2', '#54452F', 3, 1, 0.20, false)),
    arch(0.54, 0.36, 0.17, '#745237', wall('#E1D4B9', '#4E402C', 3, 2, 0.24, false)),
    arch(0.62, 0.52, 0.19, '#6E4E36', wall('#D9CBAF', '#493C2A', 4, 3, 0.28, false)),
    arch(0.70, 0.70, 0.21, '#684A35', wall('#D1C3A6', '#443827', 5, 4, 0.31, false)),
    arch(0.78, 0.92, 0.23, '#624634', wall('#C9BB9D', '#3F3425', 5, 5, 0.34, false)),
  ],
  ind: [
    arch(0.46, 0.24, 0.10, '#6E5A44', wall('#C4B79C', '#4A4436', 2, 1, 0.08, false)),
    arch(0.56, 0.34, 0.12, '#68553F', wall('#BCAF94', '#453F32', 3, 2, 0.10, false)),
    arch(0.66, 0.46, 0.13, '#62503C', wall('#B4A78D', '#403B2F', 3, 2, 0.11, false)),
    arch(0.74, 0.58, 0.14, '#5C4C39', wall('#AC9F86', '#3C372C', 4, 3, 0.12, false)),
    arch(0.82, 0.72, 0.15, '#564836', wall('#A4977F', '#383429', 4, 3, 0.13, false)),
  ],
  /**
   * A settlement has no offices, and this table exists only because a save
   * loaded mid-session can be in any period. Counting houses in a back room
   * over the shop: the same shapes as commerce, one storey lower.
   */
  office: [
    arch(0.42, 0.22, 0.15, '#7A5638', wall('#E4DBC6', '#4E4636', 3, 1, 0.22, false)),
    arch(0.50, 0.32, 0.18, '#745237', wall('#DDD3BC', '#494233', 3, 2, 0.26, false)),
    arch(0.58, 0.46, 0.20, '#6E4E36', wall('#D5CBB2', '#443E31', 4, 3, 0.30, false)),
    arch(0.66, 0.62, 0.22, '#684A35', wall('#CDC3A9', '#3F3A2E', 4, 4, 0.33, false)),
    arch(0.74, 0.82, 0.24, '#624634', wall('#C5BBA0', '#3A362B', 5, 5, 0.36, false)),
  ],
};

/**
 * Town and city: brick and dressed stone, sash windows in a regular grid, low
 * parapets over a shallow pitch. Taller than the settlement it replaced and
 * still nothing like a tower — this is the period the city stops being a
 * village and starts being a place with streets.
 */
const INDUSTRIAL: Record<BuiltZone, readonly Archetype[]> = {
  res: [
    arch(0.46, 0.32, 0.12, '#7C4436', wall('#D8CDBA', '#5C6E78', 3, 2, 0.20, false)),
    arch(0.56, 0.54, 0.13, '#7A4A3A', wall('#CBBBA4', '#576975', 4, 4, 0.25, false)),
    arch(0.66, 0.92, 0.10, '#6E6A62', wall('#B98D74', '#4E6472', 5, 6, 0.29, false)),
    arch(0.76, 1.45, 0.00, '#65625C', wall('#AE8168', '#46606F', 6, 10, 0.33, false)),
    arch(0.84, 2.15, 0.00, '#5C5A56', wall('#A2775F', '#3E5C6E', 7, 15, 0.36, false)),
  ],
  com: [
    arch(0.46, 0.36, 0.11, '#5A5240', wall('#E0D9C8', '#3E6E86', 3, 2, 0.36, false)),
    arch(0.56, 0.66, 0.10, '#544C3C', wall('#CFC2A8', '#37687F', 4, 5, 0.42, false)),
    arch(0.68, 1.20, 0.00, '#4C4638', wall('#BEA88C', '#2E6079', 5, 9, 0.47, false)),
    arch(0.78, 2.05, 0.00, '#454034', wall('#B29B80', '#275872', 6, 15, 0.52, false)),
    arch(0.86, 3.20, 0.00, '#3E3A30', wall('#A68F76', '#1F5069', 7, 23, 0.56, false)),
  ],
  ind: [
    arch(0.50, 0.34, 0.08, '#6B5347', wall('#A98570', '#3E443C', 3, 2, 0.14, false)),
    arch(0.62, 0.52, 0.09, '#63503F', wall('#9F7C68', '#3A403A', 4, 3, 0.16, false)),
    arch(0.74, 0.78, 0.08, '#5C5750', wall('#957461', '#363C36', 5, 4, 0.18, false)),
    arch(0.84, 1.10, 0.00, '#55534E', wall('#8B6C5A', '#333833', 6, 6, 0.20, false)),
    arch(0.92, 1.50, 0.00, '#4E4D4A', wall('#816453', '#2F3430', 7, 8, 0.22, false)),
  ],
  /**
   * The counting house becomes a chambers, and then a block. Taller than
   * commerce at every level and far more glass: an office is windows in a way a
   * shop is not, and at map height that is the only thing telling them apart.
   */
  office: [
    arch(0.44, 0.42, 0.09, '#57616A', wall('#D5D2C6', '#40708A', 4, 3, 0.42, false)),
    arch(0.54, 0.82, 0.00, '#4F5962', wall('#C6C4B8', '#396B83', 5, 6, 0.48, true)),
    arch(0.64, 1.55, 0.00, '#48525B', wall('#B4B4AC', '#31637C', 6, 12, 0.54, true)),
    arch(0.74, 2.60, 0.00, '#414A53', wall('#A6A8A2', '#2A5B74', 7, 19, 0.59, true)),
    arch(0.82, 3.90, 0.00, '#3A434B', wall('#98A09E', '#22536C', 8, 28, 0.64, true)),
  ],
};

/**
 * Metro and beyond: concrete frames and curtain wall, flat roofs, banded
 * glazing, and enough lit windows at dusk for the city to read as one thing
 * rather than a field of separate buildings.
 */
const MODERN: Record<BuiltZone, readonly Archetype[]> = {
  res: [
    arch(0.46, 0.34, 0.10, '#7C4436', wall('#D8CDBA', '#5C6E78', 3, 2, 0.22, false)),
    arch(0.56, 0.55, 0.00, '#6F6C64', wall('#D2C4AC', '#576975', 4, 3, 0.26, true)),
    arch(0.68, 1.15, 0.00, '#6E6A62', wall('#C6BCAC', '#4E6472', 5, 7, 0.30, true)),
    arch(0.78, 2.10, 0.00, '#65625C', wall('#B9B4AA', '#46606F', 6, 13, 0.34, true)),
    arch(0.86, 3.60, 0.00, '#5C5A56', wall('#A9AEB2', '#3E5C6E', 7, 22, 0.38, true)),
  ],
  com: [
    arch(0.44, 0.36, 0.00, '#4A5A62', wall('#E0D9C8', '#3E6E86', 3, 2, 0.40, false)),
    arch(0.56, 0.72, 0.00, '#44545E', wall('#D2CFC4', '#37687F', 4, 4, 0.44, true)),
    arch(0.68, 1.70, 0.00, '#3C4C57', wall('#9FB0BA', '#2E6079', 6, 10, 0.50, true)),
    arch(0.80, 3.20, 0.00, '#36454F', wall('#8FA6B4', '#275872', 7, 20, 0.55, true)),
    arch(0.88, 5.40, 0.00, '#2F3E48', wall('#7E9BAD', '#1F5069', 8, 34, 0.60, true)),
  ],
  ind: [
    arch(0.48, 0.40, 0.06, '#6B5347', wall('#B9A992', '#5A6258', 3, 2, 0.14, false)),
    arch(0.60, 0.62, 0.00, '#63503F', wall('#AD9E88', '#555E54', 4, 3, 0.16, false)),
    arch(0.72, 0.95, 0.00, '#5C5750', wall('#9E9B88', '#4F584F', 5, 4, 0.18, false)),
    arch(0.84, 1.35, 0.00, '#55534E', wall('#96938A', '#4A534B', 6, 6, 0.20, false)),
    arch(0.92, 1.80, 0.00, '#4E4D4A', wall('#8D8B84', '#455049', 7, 8, 0.22, false)),
  ],
  /**
   * Curtain wall from the ground up and the tallest thing in the city — six
   * units against a tower block's three and a half. This is what the whole
   * education chain is eventually for, so it is allowed to look like it.
   */
  office: [
    arch(0.44, 0.44, 0.00, '#3E4A54', wall('#CFD6DA', '#3E7EA0', 4, 3, 0.52, true)),
    arch(0.54, 0.95, 0.00, '#38434D', wall('#BCC8D0', '#3778A0', 5, 7, 0.58, true)),
    arch(0.66, 2.10, 0.00, '#323C46', wall('#A6BAC6', '#2E70A0', 6, 14, 0.64, true)),
    arch(0.78, 4.00, 0.00, '#2C3640', wall('#93AEBE', '#2769A0', 8, 26, 0.70, true)),
    arch(0.86, 6.20, 0.00, '#26303A', wall('#82A3B6', '#1F61A0', 9, 42, 0.76, true)),
  ],
};

const PERIODS: Record<Period, Record<BuiltZone, readonly Archetype[]>> = {
  early: EARLY,
  industrial: INDUSTRIAL,
  modern: MODERN,
};

export const PERIOD_ORDER: readonly Period[] = ['early', 'industrial', 'modern'];

export function archetypeFor(period: Period, zone: BuiltZone, level: number): Archetype {
  const table = PERIODS[period][zone];
  return (table[level - 1] ?? table[table.length - 1]) as Archetype;
}
