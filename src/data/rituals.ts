/**
 * The days that come round every year (Paket 3 §11).
 *
 * The timeline is a century of things that happen once: a war, a crash, a
 * republic declared. A city also has the other kind of date — the ones that
 * arrive every single year, that nobody announces because everybody already
 * knows, and that are most of what makes a place feel lived in rather than
 * simulated.
 *
 * Kept apart from `TIMELINE` on purpose. Those entries are dated facts with a
 * year on them; these have no year at all, only a position in one, and the
 * machinery for "has this fired yet" is completely different — a war fires once
 * ever, a national holiday fires once *per year*, forever.
 *
 * `from` is what stops 1901 celebrating a republic that arrives in 1923. A
 * ritual with no `from` is as old as the city.
 */
export type RitualKind = 'national' | 'religious' | 'newYear' | 'harvest';

export interface Ritual {
  id: string;
  /** Where in the year it falls, 0..1 from January. */
  at: number;
  kind: RitualKind;
  icon: string;
  /** Feed line, in Turkish. Present tense: this is happening now. */
  title: string;
  /** The chronicle's telling of it. */
  detail: string;
  /** First year it is observed. */
  from?: number;
  /** Mood it is worth, for the days around it. */
  happiness: number;
}

/**
 * Positions are the real dates as a fraction of the year, so a player who
 * knows the calendar can anticipate them: 1 January is 0, 23 April is 112/365,
 * 29 October is 302/365.
 */
export const RITUALS: readonly Ritual[] = [
  {
    id: 'new-year',
    at: 0,
    kind: 'newYear',
    icon: '🎆',
    title: 'Yılbaşı — meydanda havai fişek.',
    detail:
      'Gece yarısı meydan doldu. Havai fişekler çatıların üstünde açtı, kimse ' +
      'sabaha kadar eve gitmedi. Yeni yıl için tutulan dilekler hep aynıydı: bu ' +
      'sene daha iyi olsun.',
    happiness: 3,
  },
  {
    id: 'childrens-day',
    at: 112 / 365,
    kind: 'national',
    icon: '🎈',
    title: '23 Nisan — okullar bayrak astı, çocuklar meydanda.',
    detail:
      'Sabah töreninde en küçükler en öne dizildi. Bayraklar balkonlardan sarktı, ' +
      'bandonun peşinden bütün mahalle yürüdü. Bir günlük de olsa şehri çocuklar ' +
      'yönetti.',
    from: 1920,
    happiness: 4,
  },
  {
    id: 'harvest',
    at: 250 / 365,
    kind: 'harvest',
    icon: '🌾',
    title: 'Hasat vakti — harman yerinde şenlik.',
    detail:
      'Buğday ambara girdi. Harman yerinde davul çaldı, ilk ekmek fırından ' +
      'çıktığında kokusu bütün sokağa yayıldı. Bereketli yıl demek, kışı ' +
      'rahat geçirmek demek.',
    happiness: 3,
  },
  {
    id: 'republic-day',
    at: 302 / 365,
    kind: 'national',
    icon: '🇹🇷',
    title: '29 Ekim — Cumhuriyet Bayramı, fener alayı.',
    detail:
      'Akşamüstü fener alayı ana caddeden geçti. Pencerelere bayrak, direklere ' +
      'ışık asıldı. Cumhuriyetin ilan edildiği o günü hatırlayan kalmasa da, ' +
      'şehir her yıl aynı yerde toplanmayı sürdürdü.',
    from: 1923,
    happiness: 4,
  },
];

/**
 * How wide a ritual's window is, as a fraction of the year.
 *
 * A day at this calendar is a quarter of a second, which nobody would see, so a
 * holiday is given a window — long enough that several sim steps land inside it
 * and the feed and the mood both notice.
 *
 * Kept small, and the number matters more than it looks. At a twentieth of a
 * year, four holidays put the city on holiday forty per cent of the time, and a
 * mood bonus that is nearly always on is not a holiday, it is a higher baseline
 * with flags on. At a fiftieth it is about a second and a half each, four times
 * a year: a texture rather than a subsidy.
 */
export const RITUAL_WINDOW = 0.02;
