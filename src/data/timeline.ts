/**
 * The years the city lives through (§14). Time in Kadastro is not a clock on
 * the wall: it is a century and a half of history the city has to survive,
 * from the mobilisation of 1914 to the first flying taxi of 2050 and the Moon
 * beyond it. Events are dated facts, not dice — every city on every device
 * meets the same history in the same year, because a story you can anticipate
 * is a story you can prepare for.
 *
 * Effects are multipliers the sim reads every step while an event's span is
 * active; disasters are one violent moment handled by the hazards machinery.
 * The `detail` line is the chronicle's telling of it — the feed announces,
 * the history log remembers.
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
  /** The chronicle's longer telling of the event, read in the history log. */
  detail?: string;
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
    detail:
      'Seferberlik ilan edildi. Şehrin gençleri trenlere bindi; tarlada, tezgâhta eli iş tutan kalmadı. Dönenler bir daha eskisi gibi olmadı.',
    effects: { migrationMult: 0.3, incomeMult: 0.85, happinessMod: -12, draftDrainPerSec: 0.0006 },
  },
  {
    id: 'canakkale',
    year: 1915,
    durationYears: 1,
    kind: 'war',
    icon: '⚔️',
    title: 'Çanakkale cephesi — şehir bir kez daha asker verdi.',
    detail:
      'Boğazın iki yakasında dünya savaşıyordu. Şehirden giden ikinci kafilede lise sıralarındaki çocuklar vardı. Haber gelene dek her kapı yaslıydı.',
    effects: { happinessMod: -6, draftDrainPerSec: 0.0004 },
  },
  {
    id: 'spanish-flu',
    year: 1918,
    kind: 'epidemic',
    icon: '🦠',
    title: 'İspanyol gribi şehre ulaştı.',
    detail:
      'Savaş bitmeden hastalık geldi. Asker trenleriyle taşınan grip, cepheden sağ dönenleri de evlerinde yakaladı. Sokaklar haftalarca boş kaldı.',
    disaster: 'epidemic',
  },
  {
    id: 'war-over',
    year: 1918,
    durationYears: 2,
    kind: 'celebration',
    icon: '🕊️',
    title: 'Savaş bitti — cepheden dönüş başladı.',
    detail:
      'Silahlar sustu. Dönen her asker kapıda bir bayram, dönmeyen her isim duvar dibinde bir ağıt oldu. Şehir yaralarını sarmaya koyuldu.',
    effects: { migrationMult: 1.6, happinessMod: 6 },
  },
  {
    id: 'republic',
    year: 1923,
    durationYears: 3,
    kind: 'celebration',
    icon: '🎉',
    title: 'Cumhuriyet ilan edildi — şehirde bayram.',
    detail:
      'Ankara\'dan gelen haber meydanda okundu: Cumhuriyet! Balkonlara bayraklar asıldı, davullar sabaha kadar susturulamadı. Yeni bir çağ açıldı.',
    effects: { happinessMod: 8, migrationMult: 1.2 },
  },
  {
    id: 'depression',
    year: 1929,
    durationYears: 4,
    kind: 'crisis',
    icon: '📉',
    title: 'Büyük Buhran — ticaret bıçak gibi kesildi.',
    detail:
      'Okyanus ötesinde borsa çöktü, dalga buraya da vurdu. Buğday para etmedi, tezgâhlar sustu. Ekmek kuyrukları şehrin hafızasına kazındı.',
    effects: { incomeMult: 0.6, migrationMult: 0.7, happinessMod: -8 },
  },
  {
    id: 'railways',
    year: 1934,
    durationYears: 5,
    kind: 'boom',
    icon: '🛤️',
    title: 'Demiryolu hamlesi — hat şehre ulaştı.',
    detail:
      'Demir yolları memleketin dört yanına örülüyordu. İlk tren gar Peronuna yanaştığında şehir artık haritanın kenarı değil, ağın düğümüydü.',
    effects: { incomeMult: 1.1, migrationMult: 1.1 },
  },
  {
    id: 'world-war-two',
    year: 1939,
    durationYears: 6,
    kind: 'war',
    icon: '⚔️',
    title: '2. Dünya Savaşı — savaş ekonomisi, kıtlık yılları.',
    detail:
      'Cepheye gidilmedi ama savaş kapıya dayandı: karneyle ekmek, karartma geceleri, askere alınan erkekler. Şehir dişini sıkıp bekledi.',
    effects: { migrationMult: 0.5, incomeMult: 0.8, happinessMod: -10, draftDrainPerSec: 0.0003 },
  },
  {
    id: 'multiparty',
    year: 1946,
    durationYears: 2,
    kind: 'celebration',
    icon: '🗳️',
    title: 'Çok partili hayat — meydanlar mitinglerle doldu.',
    detail:
      'Tek parti dönemi kapandı. Kahvehanelerde siyaset konuşulmaya başlandı, miting otobüsleri ilk kez şehre girdi. Herkes sandık başına koştu.',
    effects: { happinessMod: 4 },
  },
  {
    id: 'marshall',
    year: 1948,
    durationYears: 3,
    kind: 'boom',
    icon: '🏗️',
    title: 'Marshall yardımı — inşaat her yerde.',
    detail:
      'Amerikan yardımı traktörler, kamyonlar, krediler demekti. Tarlada traktör sesi, şantiyede beton mikseri. Şehir modernleşmeye hız verdi.',
    effects: { incomeMult: 1.25, migrationMult: 1.2 },
  },
  {
    id: 'industrialisation',
    year: 1955,
    durationYears: 5,
    kind: 'boom',
    icon: '🏭',
    title: 'Sanayileşme hamlesi — fabrika bacaları yükseldi.',
    detail:
      'Tezgâhların yerini fabrikalar almaya başladı. İlk bacanın tüttüğü gün şehirli hem gururlandı hem korktu: duman, para demekti.',
    effects: { incomeMult: 1.15, migrationMult: 1.15 },
  },
  {
    id: 'rural-exodus',
    year: 1960,
    durationYears: 10,
    kind: 'boom',
    icon: '🚌',
    title: 'Köyden kente göç — her otobüs dolu geliyor.',
    detail:
      'Köyünde doyamayan yollara düştü. Otogara her otobüs yanaştığında şehir biraz daha büyüdü; gecekondular bir gecede, mahalleler bir yılda kuruldu.',
    effects: { migrationMult: 1.5 },
  },
  {
    id: 'oil-crisis',
    year: 1974,
    durationYears: 2,
    kind: 'crisis',
    icon: '⛽',
    title: 'Petrol krizi — benzin kuyrukları, pahalı her şey.',
    detail:
      'Petrolün fiyatı bir gecede katlandı. Benzin istasyonlarının önünde kuyruklar, vitrinlerde zam etiketleri. Şehir tasarrufu öğrendi.',
    effects: { incomeMult: 0.85, happinessMod: -5 },
  },
  {
    id: 'opening',
    year: 1980,
    durationYears: 10,
    kind: 'boom',
    icon: '🌐',
    title: 'Dışa açılma — ihracat büyüyor.',
    detail:
      'Kapılar dünyaya açıldı. Tezgâhta yabancı mal, dükkânda renkli ambalaj, atölyede ihracat siparişi. Şehir pazarını önce bölgeye, sonra dünyaya sattı.',
    effects: { incomeMult: 1.2, migrationMult: 1.1 },
  },
  {
    id: 'tv-era',
    year: 1990,
    durationYears: 3,
    kind: 'celebration',
    icon: '📺',
    title: 'Özel kanallar — her evde renkli ekran.',
    detail:
      'Tek kanallı günler bitti. Akşamları sokaklar boşaldı, herkes ekran başına geçti. Şehir artık ne izliyorsa onu konuşuyordu.',
    effects: { happinessMod: 5, migrationMult: 1.1 },
  },
  {
    id: 'crisis-1994',
    year: 1994,
    durationYears: 1,
    kind: 'crisis',
    icon: '📉',
    title: '94 krizi — faizler fırladı, esnaf zorlandı.',
    detail:
      'Bir gecede faizler rekor kırdı. Krediler çöktü, çekler karşılıksız çıktı. Şehir bir yıl boyunca kemerin en son deliğini kullandı.',
    effects: { incomeMult: 0.8, happinessMod: -4 },
  },
  {
    id: 'earthquake',
    year: 1999,
    kind: 'disaster',
    icon: '🌋',
    title: 'Büyük deprem — şehir sarsıldı.',
    detail:
      'Gece yarısı yer kırk beş saniye sallandı. Kimi bina dayandı, kimi yığıldı. Şehir haftalarca çadırlarda yaşadı; yardıma koşan da yağmalayan da oldu.',
    disaster: 'earthquake',
  },
  {
    id: 'crisis-2001',
    year: 2001,
    durationYears: 2,
    kind: 'crisis',
    icon: '📉',
    title: 'Ekonomik kriz — kemer sıkma yılları.',
    detail:
      'Bankalar battı, para değer kaybetti. "Kriz maaşıyla geçinenler" şehrin yeni konusuydu. Pazar yerinde fiyat sormak ayıp sayılmadı artık.',
    effects: { incomeMult: 0.75, happinessMod: -6 },
  },
  {
    id: 'tech-leap',
    year: 2008,
    durationYears: 10,
    kind: 'boom',
    icon: '💡',
    title: 'Teknoloji atılımı — yeni işler, yeni para.',
    detail:
      'İnternet kafeler yerini fiber hatlara, atölyeler yazılım ofislerine bıraktı. Şehrin çocukları artık klavyeyle dünyaya açılıyordu.',
    effects: { incomeMult: 1.15, migrationMult: 1.15 },
  },
  {
    id: 'smartphones',
    year: 2010,
    durationYears: 5,
    kind: 'boom',
    icon: '📱',
    title: 'Akıllı telefon çağı — dünya cebe girdi.',
    detail:
      'Herkesin cebinde bir ekran: pazar yeri, banka, gazete, meydan hepsi oraya taşındı. Şehir artık iki yerde birden yaşıyordu.',
    effects: { incomeMult: 1.1, happinessMod: 3 },
  },
  {
    id: 'pandemic',
    year: 2020,
    kind: 'epidemic',
    icon: '🦠',
    title: 'Küresel salgın — sokaklar boşaldı.',
    detail:
      'Bütün dünya eve kapandı. Maskeler, dezenfektanlar, balkondan alkışlar. Şehir bir kez daha gördü: hastanesi olmayan, çaresiz kalıyor.',
    disaster: 'epidemic',
  },
  {
    id: 'earthquake-2023',
    year: 2023,
    kind: 'disaster',
    icon: '🌋',
    title: 'Asrın depremi — yer bir kez daha sarsıldı.',
    detail:
      'Şubat soğuğunda, sabaha karşı yer yarıldı. Enkaz başında nöbet tutan şehir, bir şeyi iyi biliyordu: sağlam kural, sağlam yapı, sağlam kurtuluş.',
    disaster: 'earthquake',
  },
  {
    id: 'climate-migration',
    year: 2030,
    durationYears: 5,
    kind: 'boom',
    icon: '🌊',
    title: 'İklim göçleri — kıyıdan, kuraktan kaçan şehre geldi.',
    detail:
      'Kuraklık tarlayı, yükselen deniz kıyıyı yuttu. Binlerce insan yeni hayat aramaya çıktı; şehir onlara hem kapı hem umut oldu.',
    effects: { migrationMult: 1.3, happinessMod: -3 },
  },
  {
    id: 'green-energy',
    year: 2035,
    durationYears: 10,
    kind: 'boom',
    icon: '⚡',
    title: 'Temiz enerji dönemi — maliyetler düştü.',
    detail:
      'Çatılarda panel, tepelerde rüzgâr gülü. Elektrik faturası tarihe karışırken şehir temiz havayla ucuz gücü aynı anda tattı.',
    effects: { incomeMult: 1.15 },
  },
  {
    id: 'ai-era',
    year: 2042,
    durationYears: 8,
    kind: 'boom',
    icon: '🤖',
    title: 'Yapay zekâ dönüşümü — her işe bir akıl.',
    detail:
      'Lojistiği, tarımı, imalatı artık algoritmalar yönetiyordu. Kimi işini kaybetti, kimi yenisini buldu; şehrin verimi görülmemiş seviyeye çıktı.',
    effects: { incomeMult: 1.2, happinessMod: 4 },
  },
  {
    id: 'flying-cars',
    year: 2050,
    kind: 'progress',
    icon: '🚁',
    title: 'Uçan araçlar trafiğe çıktı — yollar gökyüzüne taşındı.',
    detail:
      'İlk hava taksinin kalktığı gün milat oldu. Trafik lambası kavşaklardan semaya taşındı; şehrin siluetine artık bir de uçuş hatları eklendi.',
  },
  {
    id: 'orbital-shuttle',
    year: 2065,
    kind: 'progress',
    icon: '🚀',
    title: 'Yörünge mekiği seferleri başladı — uzay çağı kapıda.',
    detail:
      'Mekikler artık şehrin üstünden iz bırakarak geçiyor. Çocuklar gökyüzüne bakıp "bir gün" demiyor; "hangi seferle" diyor.',
  },
  {
    id: 'moon-base',
    year: 2075,
    kind: 'progress',
    icon: '🌕',
    title: 'Ay üssüne ilk kargo şehirden gitti.',
    detail:
      'Şehrin fabrikalarında üretilen modüller Ay\'daki ilk kalıcı üsse ulaştı. Toprağından çıkan şehir, artık başka bir gök cismine de el uzatıyor.',
  },
] as const;
