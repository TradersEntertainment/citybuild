/**
 * The years the city lives through (§14). Time in Kadastro is not a clock on
 * the wall: it is a century of history the city has to survive, from the
 * mobilisation of 1914 to the first flying taxi of 2050. Events are dated
 * facts, not dice — every city on every device meets the same history in the
 * same year, because a story you can anticipate is a story you can prepare
 * for.
 *
 * Effects are multipliers the sim reads every step while an event's span is
 * active; disasters are one violent moment handled by the hazards machinery.
 */

/** The year a new city is founded in. */
export const START_YEAR = 1900;
/** Seconds of played city time per calendar year. */
export const SECONDS_PER_YEAR = 40;
/** From this year the traffic layer takes to the air. */
export const FLYING_YEAR = 2050;
/** From this year orbital shuttles cross the sky. */
export const SHUTTLE_YEAR = 2065;

export type TimelineKind =
  | 'war'
  | 'epidemic'
  | 'boom'
  | 'crisis'
  | 'celebration'
  | 'disaster'
  | 'progress';

export interface TimelineEvent {
  id: string;
  year: number;
  /** Years the effect span runs; one-moment events omit it. */
  durationYears?: number;
  kind: TimelineKind;
  /** Feed icon and line, in Turkish, past tense — history is reported. */
  icon: string;
  title: string;
  /** The disasters: a forced outbreak or a struck fault line. */
  disaster?: 'epidemic' | 'earthquake';
  effects?: {
    /** Multiplies people moving in — a draft empties the road in, a boom fills it. */
    migrationMult?: number;
    /** Multiplies all income — depressions and booms both live here. */
    incomeMult?: number;
    /** Flat mood shift for the span. */
    happinessMod?: number;
    /** Share of the population conscripted per second while the war runs. */
    draftDrainPerSec?: number;
  };
}

export const TIMELINE: readonly TimelineEvent[] = [
  {
    id: 'great-war',
    year: 1914,
    durationYears: 4,
    kind: 'war',
    icon: '⚔️',
    title: '1. Dünya Savaşı — gençler cepheye çağrıldı.',
    effects: { migrationMult: 0.3, incomeMult: 0.85, happinessMod: -12, draftDrainPerSec: 0.0006 },
  },
  {
    id: 'spanish-flu',
    year: 1918,
    kind: 'epidemic',
    icon: '🦠',
    title: 'İspanyol gribi şehre ulaştı.',
    disaster: 'epidemic',
  },
  {
    id: 'war-over',
    year: 1918,
    durationYears: 2,
    kind: 'celebration',
    icon: '🕊️',
    title: 'Savaş bitti — cepheden dönüş başladı.',
    effects: { migrationMult: 1.6, happinessMod: 6 },
  },
  {
    id: 'republic',
    year: 1923,
    durationYears: 3,
    kind: 'celebration',
    icon: '🎉',
    title: 'Cumhuriyet ilan edildi — şehirde bayram.',
    effects: { happinessMod: 8, migrationMult: 1.2 },
  },
  {
    id: 'depression',
    year: 1929,
    durationYears: 4,
    kind: 'crisis',
    icon: '📉',
    title: 'Büyük Buhran — ticaret bıçak gibi kesildi.',
    effects: { incomeMult: 0.6, migrationMult: 0.7, happinessMod: -8 },
  },
  {
    id: 'world-war-two',
    year: 1939,
    durationYears: 6,
    kind: 'war',
    icon: '⚔️',
    title: '2. Dünya Savaşı — savaş ekonomisi, kıtlık yılları.',
    effects: { migrationMult: 0.5, incomeMult: 0.8, happinessMod: -10, draftDrainPerSec: 0.0003 },
  },
  {
    id: 'marshall',
    year: 1948,
    durationYears: 3,
    kind: 'boom',
    icon: '🏗️',
    title: 'Marshall yardımı — inşaat her yerde.',
    effects: { incomeMult: 1.25, migrationMult: 1.2 },
  },
  {
    id: 'rural-exodus',
    year: 1960,
    durationYears: 10,
    kind: 'boom',
    icon: '🚌',
    title: 'Köyden kente göç — her otobüs dolu geliyor.',
    effects: { migrationMult: 1.5 },
  },
  {
    id: 'opening',
    year: 1980,
    durationYears: 10,
    kind: 'boom',
    icon: '🌐',
    title: 'Dışa açılma — ihracat büyüyor.',
    effects: { incomeMult: 1.2, migrationMult: 1.1 },
  },
  {
    id: 'earthquake',
    year: 1999,
    kind: 'disaster',
    icon: '🌋',
    title: 'Büyük deprem — şehir sarsıldı.',
    disaster: 'earthquake',
  },
  {
    id: 'crisis-2001',
    year: 2001,
    durationYears: 2,
    kind: 'crisis',
    icon: '📉',
    title: 'Ekonomik kriz — kemer sıkma yılları.',
    effects: { incomeMult: 0.75, happinessMod: -6 },
  },
  {
    id: 'tech-leap',
    year: 2008,
    durationYears: 10,
    kind: 'boom',
    icon: '💡',
    title: 'Teknoloji atılımı — yeni işler, yeni para.',
    effects: { incomeMult: 1.15, migrationMult: 1.15 },
  },
  {
    id: 'pandemic',
    year: 2020,
    kind: 'epidemic',
    icon: '🦠',
    title: 'Küresel salgın — sokaklar boşaldı.',
    disaster: 'epidemic',
  },
  {
    id: 'green-energy',
    year: 2035,
    durationYears: 10,
    kind: 'boom',
    icon: '⚡',
    title: 'Temiz enerji dönemi — maliyetler düştü.',
    effects: { incomeMult: 1.15 },
  },
  {
    id: 'flying-cars',
    year: 2050,
    kind: 'progress',
    icon: '🚁',
    title: 'Uçan araçlar trafiğe çıktı — yollar gökyüzüne taşındı.',
  },
  {
    id: 'orbital-shuttle',
    year: 2065,
    kind: 'progress',
    icon: '🚀',
    title: 'Yörünge mekiği seferleri başladı — uzay çağı kapıda.',
  },
] as const;
