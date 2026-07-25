/**
 * All player-facing copy lives here so another language can be added later.
 * Tone (§14.6): dry, measured, faintly official — a municipal clerk.
 * No exclamation marks, no emoji.
 */
const money = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat('tr-TR');

export const STR = {
  appName: 'Kadastro',

  format: {
    money: (value: number): string => `₺${money.format(Math.round(value))}`,
    count: (value: number): string => plain.format(Math.round(value)),
  },

  empty: {
    noRoads: 'Henüz yol yok. Bir hat çiz — şehir yolun kenarında büyür.',
    noZones: 'Bölge boyanmamış. Yolun kenarını konuta ayır.',
    noPeople: 'Konut boyandı. İlk hane birazdan taşınır.',
    noJobs: 'İşsizlik yüksek. Ticaret ya da sanayi bölgesi boya.',
    noHomes: 'İş var, ev yok. Yol kenarına konut boya.',
  },

  tools: {
    road: 'yol',
    zone: 'bölge',
    erase: 'sil',
    undo: 'geri al',
    service: 'hizmet',
    roadSheetTitle: 'Yol tipi',
    zoneSheetTitle: 'Bölge',
    serviceSheetTitle: 'Hizmet binası',
    brushTitle: 'Fırça',
    brushSize: (size: number): string => `${size}×${size}`,
  },

  service: {
    fire: 'İtfaiye',
    health: 'Sağlık ocağı',
    education: 'Okul',
    police: 'Karakol',
  },

  /** "₺3.200 · 42 ₺/dk gider" */
  serviceCost: (cost: number, upkeep: number): string =>
    `₺${money.format(cost)} · ${money.format(upkeep)} ₺/dk gider`,

  serviceBuilt: 'Hizmet binası kuruldu.',
  serviceBlocked: {
    locked: 'Bu hizmet henüz açılmadı.',
    unowned: 'Burası senin arazin değil.',
    occupied: 'Bu kare dolu.',
    noRoad: 'Yola çok uzak. Yol kenarına kur.',
    tooDear: 'Bakiye yetmiyor.',
  },

  zone: {
    res: 'Konut',
    com: 'Ticaret',
    ind: 'Sanayi',
    farm: 'Tarım',
    park: 'Park',
  },

  hud: {
    population: (value: number): string => `${plain.format(Math.round(value))} kişi`,
    happiness: (value: number): string => `mutluluk ${Math.round(value)}`,
    fps: (value: number): string => `${Math.round(value)} fps`,
    /** Net income per minute, signed. */
    net: (value: number): string =>
      `${value >= 0 ? '+' : '−'}${money.format(Math.abs(Math.round(value)))} ₺/dk`,
    demand: 'K · T · S',
  },

  era: {
    reached: (name: string): string => `${name} çağına ulaşıldı.`,
    next: (name: string, remaining: number): string =>
      `${name} çağına ${plain.format(Math.round(remaining))} kişi kaldı`,
  },

  road: {
    path: 'Patika',
    stone: 'Taş yol',
    asphalt: 'Asfalt',
    boulevard: 'Bulvar',
    highway: 'Otoyol',
    metro: 'Metro hattı',
  },

  /** Locked entries always show what opens them (§1: no hidden locks). */
  lockedAt: (era: string): string => `${era} çağında açılır`,
  unlocked: (what: string): string => `${what} açıldı`,

  parcel: {
    title: 'Komşu parsel',
    /** "₺120.000 · %78 kara" — money reads the same way as it does in the bar. */
    detail: (price: number, landFraction: number): string =>
      `₺${money.format(Math.round(price))} · %${Math.round(landFraction * 100)} kara`,
    buy: 'Satın al',
    tooDear: 'Bakiye yetmiyor',
    cancel: 'Vazgeç',
    bought: 'Yeni parsel alındı.',
    /** Second line of the purchase toast. */
    boughtDetail: (tiles: number): string => `${plain.format(tiles)} kare eklendi`,
  },

  draft: {
    /** "₺2.340 · 26 kare" */
    cost: (amount: number, tiles: number): string =>
      `${money.format(Math.round(amount))} ₺ · ${plain.format(tiles)} kare`,
    truncated: 'para yetmiyor',
    erase: (tiles: number) => `${plain.format(tiles)} kare siliniyor`,
  },

  camera: {
    hint: 'İki parmakla gez ve yaklaştır, çevirmek için parmakları döndür.',
  },

  terrain: {
    water: 'Su',
    marsh: 'Bataklık',
    plain: 'Ova',
    forest: 'Orman',
    hill: 'Tepe',
    rock: 'Kayalık',
  },

  eraName: {
    founding: 'Kuruluş',
    village: 'Köy',
    town: 'Kasaba',
    city: 'Şehir',
    metro: 'Büyükşehir',
    metropolis: 'Metropol',
    megacity: 'Megakent',
  },

  chronicle: {
    /** "8 sa 12 dk yoktun" */
    away: (hours: number, minutes: number): string =>
      hours === 0 ? `${minutes} dk yoktun` : `${hours} sa ${minutes} dk yoktun`,
    back: 'Şehre dön',
  },

  system: {
    offlineReady: 'Oyun çevrimdışı çalışmaya hazır.',
    saveCorrupt: 'Kayıt okunamadı. Temiz bir şehirle başlanabilir.',
    nothingToUndo: 'Geri alınacak bir şey yok.',
  },
} as const;
