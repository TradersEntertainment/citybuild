/**
 * Neighbourhood names (§14.6).
 *
 * Composed rather than drawn from a list, for the same reason the facades are
 * drawn rather than shipped: a list long enough to never repeat is a list
 * nobody wants to write, and the two-part shape is how Turkish neighbourhoods
 * are actually named — a describing word and a settlement word. Yeşiltepe,
 * Akyaka, Gümüşpınar.
 *
 * The parts are chosen so that any pair reads plausibly, which is what keeps
 * this from producing the tell-tale nonsense of a generator. Nothing here is
 * stored: the name comes from the block's own coordinates and the map seed, so
 * a district is called the same thing every time the city is opened.
 */
const PREFIX: readonly string[] = [
  'Yeşil',
  'Ak',
  'Kara',
  'Gül',
  'Yeni',
  'Eski',
  'Güzel',
  'Çamlı',
  'Söğüt',
  'Taş',
  'Demir',
  'Gümüş',
  'Sarı',
  'Kızıl',
  'Deniz',
  'Yıldız',
  'Meşe',
  'Fındık',
  'Ceviz',
  'Alaca',
  'Kavak',
  'Bağ',
  'Ulu',
  'Şirin',
  'Kuzey',
  'Güney',
  'Beyaz',
  'Mavi',
  'Zeytin',
  'Kiraz',
];

const SUFFIX: readonly string[] = [
  'tepe',
  'yaka',
  'kent',
  'köy',
  'bahçe',
  'pınar',
  'ova',
  'burun',
  'dere',
  'bağ',
  'çeşme',
  'yurt',
];

/**
 * A name from a number. The two parts are pulled from different bits of the
 * hash so that neighbouring blocks — whose hashes are close — do not all end up
 * sharing a suffix.
 */
export function districtName(hash: number): string {
  const h = hash >>> 0;
  const prefix = PREFIX[h % PREFIX.length] as string;
  const suffix = SUFFIX[Math.floor(h / PREFIX.length) % SUFFIX.length] as string;
  return `${prefix}${suffix}`;
}

export const NAME_COMBINATIONS = PREFIX.length * SUFFIX.length;
