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
    percent: (value: number): string => `%${Math.round(value * 100)}`,
  },

  intro: {
    title: 'Kadastro',
    lede: 'Parmağınla yol çiziyorsun. Şehir o yolun kenarında kendi kendine büyüyor.',
    steps: [
      { verb: 'Sürükle', text: '— haritaya bir yol çizilir.' },
      { verb: 'Bölge boya', text: '— alttan konut seç, yolun kenarına sür.' },
      { verb: 'Bekle', text: '— evler kendiliğinden yükselir, insanlar taşınır.' },
    ],
    camera: 'İki parmak: gez ve yaklaştır. Parmakları döndür: kamerayı çevir.',
    start: 'Şehri kur',
  },

  coach: {
    road: 'Haritada parmağını sürükle — bir yol çiz.',
    zoneTool: 'Şimdi "bölge" düğmesine bas.',
    zonePick: '"Konut"u seç.',
    zonePaint: 'Yolun hemen kenarına sürükle — konut alanı boya.',
    wait: 'Bekle. Birazdan evler yükselecek.',
    jobs: 'İnsanlara iş lazım. "bölge"den ticaret seçip biraz da onu boya.',
    grow: 'Şehir büyüyor. Yol çizmeye devam et — gerisi kendiliğinden gelir.',
    skip: 'geç',
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
    pan: 'gez',
    erase: 'sil',
    undo: 'geri al',
    service: 'hizmet',
    roadSheetTitle: 'Yol tipi',
    zoneSheetTitle: 'Bölge',
    serviceSheetTitle: 'Hizmet binası',
    utilitySheetTitle: 'Su ve elektrik',
    eraseSheetTitle: 'Sil',
    eraseNote:
      'Fırçanın altındaki her şeyi kaldırır: yol, bölge, bina ve tesis. ' +
      'Ücretsiz — tesislerin yarı parası geri gelir.',
    brushTitle: 'Fırça',
    brushSize: (size: number): string => `${size}×${size}`,
  },

  service: {
    fire: 'İtfaiye',
    health: 'Sağlık ocağı',
    education: 'Okul',
    police: 'Karakol',
  },

  utility: {
    well: 'Su kuyusu',
    waterworks: 'Su arıtma',
    coalPlant: 'Kömür santrali',
    gasPlant: 'Doğalgaz santrali',
  },

  /** "₺3.200 · 42 ₺/dk gider" */
  serviceCost: (cost: number, upkeep: number): string =>
    `₺${money.format(cost)} · ${money.format(upkeep)} ₺/dk gider`,

  serviceBuilt: 'Hizmet binası kuruldu.',
  serviceBlocked: {
    locked: 'Bu bina henüz açılmadı.',
    unowned: 'Burası senin arazin değil.',
    occupied: 'Bu kare dolu.',
    noRoad: 'Yola çok uzak. Yol kenarına kur.',
    // Only asphalt and above carry mains; a dirt track cannot be dug up for pipe.
    noMains: 'Şebeke taşıyan yol yok. Asfalt ya da bulvar kenarına kur.',
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

  /** The returning card: what the city did while nobody was watching (§11). */
  chronicle: {
    title: 'Şehir günlüğü',
    away: (hours: number, minutes: number): string => {
      if (hours <= 0) return `${minutes} dakika yoktun. Şehir kendi işine baktı.`;
      if (minutes === 0) return `${hours} saat yoktun. Şehir kendi işine baktı.`;
      return `${hours} saat ${minutes} dakika yoktun. Şehir kendi işine baktı.`;
    },
    earned: 'Kasa',
    moved: 'Taşınan',
    built: 'Yeni bina',
    city: 'Şehir',
    resume: 'Devam et',
    money: (amount: number): string =>
      `${amount >= 0 ? '+' : '−'}₺${money.format(Math.abs(Math.round(amount)))}`,
    people: (people: number): string =>
      `${people >= 0 ? '+' : '−'}${plain.format(Math.abs(Math.round(people)))} kişi`,
    buildings: (count: number): string =>
      `${count >= 0 ? '+' : '−'}${plain.format(Math.abs(count))}`,
    /** "4.200 konut · 3.100 iş" */
    glance: (housing: number, jobs: number): string =>
      `${plain.format(Math.round(housing))} konut · ${plain.format(Math.round(jobs))} iş`,
    /** Long absences pay less; the card says so rather than letting it be found out. */
    efficiency: (percent: number): string =>
      `Yokluğun %${percent} verimle işledi — ilk iki saat tam, sonrası azalarak, 14 saatte durur.`,
  },

  draft: {
    /** "₺2.340 · 26 kare" */
    cost: (amount: number, tiles: number): string =>
      `${money.format(Math.round(amount))} ₺ · ${plain.format(tiles)} kare`,
    truncated: 'para yetmiyor',
    erase: (tiles: number) => `${plain.format(tiles)} kare siliniyor`,
  },

  panel: {
    people: 'Nüfus',
    jobs: 'İş',
    housing: 'Konut kapasitesi',
    vacancy: 'Boş konut',
    workers: 'Çalışabilir nüfus',
    unemployment: 'İşsizlik',
    books: 'Bütçe',
    tax: 'Vergi',
    roads: 'Yol bakımı',
    stations: 'Hizmet gideri',
    plants: 'Şebeke gideri',
    gridTitle: 'Şebeke',
    water: 'Su',
    power: 'Elektrik',
    /** "820 / 1.400" — what the city has against what it draws. */
    supply: (have: number, need: number): string =>
      `${plain.format(Math.round(have))} / ${plain.format(Math.round(need))}`,
    net: 'Net',
    demandTitle: 'Talep',
    farmYield: 'Tarım ürünü',
  },

  view: {
    zoomIn: 'Yaklaştır',
    zoomOut: 'Uzaklaştır',
    rotate: 'Kamerayı çevir',
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

  system: {
    offlineReady: 'Oyun çevrimdışı çalışmaya hazır.',
    saveCorrupt: 'Kayıt okunamadı. Temiz bir şehirle başlanabilir.',
    nothingToUndo: 'Geri alınacak bir şey yok.',
  },
} as const;
