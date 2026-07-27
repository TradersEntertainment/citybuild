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
      { verb: 'Otoyol', text: '— ulusal otoyol arazinden geçiyor; ona bağlan, geçiş trafiği para getirir.' },
    ],
    camera: 'İki parmak: gez ve yaklaştır. Parmakları döndür: kamerayı çevir.',
    start: 'Şehri kur',
  },

  /** The national highway: the one road the player does not draw. */
  highway: {
    intro: 'Ulusal otoyol arazinin içinden geçiyor. Yolunu ona değdir — geçiş trafiği şehre para bırakır.',
    connectHint: 'Otoyola bağlan: bir yolu ulusal otoyola değene kadar çiz.',
    connected: 'Otoyol bağlantısı kuruldu. Geçiş trafiği şehre akıyor.',
    blocked: 'Otoyol devletin yolu — üzerine çizilmez, yıkılmaz. Kenarından bağlan.',
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
    disconnected:
      'Yolun ulusal otoyola bağlantısı yok — kimse bu yoldan şehre gelemez. Yolu otoyola kadar uzat.',
    noZones: 'Bölge boyanmamış. Yolun kenarını konuta ayır.',
    noPeople: 'Konut boyandı. İlk hane birazdan taşınır.',
    noJobs: 'İşsizlik yüksek. Ticaret ya da sanayi bölgesi boya.',
    noHomes: 'İş var, ev yok. Yol kenarına konut boya.',
  },

  /** Fires and epidemics (§13): the event feed and the toast share these. */
  hazard: {
    fireStart: 'Yangın çıktı!',
    fireOut: 'İtfaiye yangını söndürdü.',
    fireLost: 'Bir bina kül oldu.',
    fireRaging: 'Şehir yanıyor — itfaiye şart!',
    epidemicStart: 'Salgın başladı!',
    epidemicEndMild: 'Salgın atlatıldı.',
    epidemicEndSevere: 'Salgın şehri kırıp geçirdi — hastane yoksa sonu bu.',
  },

  /**
   * Crime. The only hazard the player answers with a finger, so the first line a
   * new player reads has to teach the verb: tap the marker.
   */
  crime: {
    started: 'Suç ihbarı! İşaretin üstüne bas, ekip gitsin.',
    dispatched: 'Ekip yolda.',
    solved: 'Şüpheli yakalandı.',
    escaped: (loot: string) => `Soygun oldu — ${loot} götürüldü.`,
    noStation: 'Karakol yok. Bir karakol kur ki ekip gönderebilelim.',
  },

  /**
   * Ageing, and the wave that follows a boom (sim/cohorts.ts).
   *
   * The city fills in waves and those waves grow old together, so a founding rush
   * is a funeral an hour later. The player has to be told, or the mood drop looks
   * like a bug.
   */
  cohort: {
    backlog: 'Defin işleri yetişmiyor. Mezarlık kur.',
    cleared: 'Defin işleri yeniden yetişiyor.',
    title: 'Nüfus yapısı',
    band: { child: 'Çocuk', young: 'Genç', adult: 'Yetişkin', elder: 'Yaşlı' },
    working: (share: number): string => `Çalışma çağı %${Math.round(share * 100)}`,
    schooled: (share: number): string => `Okumuş iş gücü %${Math.round(share * 100)}`,
    waiting: (n: number): string => `${plain.format(Math.round(n))} defin bekliyor`,
    /** The age structure as one line: "412 · 486 · 520 · 498". */
    spread: (child: number, young: number, adult: number, elder: number): string =>
      [child, young, adult, elder].map((n) => plain.format(Math.round(n))).join(' · '),
    backlogRow: 'Defin bekleyen',
  },

  /** The ground the city is standing on (sim/resources.ts). */
  resource: {
    none: 'Yok',
    coal: 'Kömür',
    iron: 'Demir',
    stone: 'Taş',
    clay: 'Kil',
  },
  seamExhausted: (kind: string): string => `${kind} damarı tükendi.`,

  tools: {
    road: 'yol',
    zone: 'bölge',
    pan: 'gez',
    erase: 'sil',
    undo: 'geri al',
    service: 'hizmet',
    transit: 'hat',
    tech: 'ar-ge',
    roadSheetTitle: 'Yol tipi',
    zoneSheetTitle: 'Bölge',
    serviceSheetTitle: 'Hizmet binası',
    utilitySheetTitle: 'Su ve elektrik',
    eraseSheetTitle: 'Sil',
    eraseNote:
      'Fırçanın altındaki her şeyi kaldırır: yol, bölge, bina ve tesis. ' +
      'Ücretsiz — tesislerin yarı parası geri gelir.',
    oneWayTitle: 'Yön',
    oneWayNote:
      'Tek yön açıkken çizdiğin yol, çizdiğin yönde tek yönlü olur — daha çok ' +
      'trafik taşır, ama ters yönde gidenler dolanmak zorunda kalır. ' +
      'Kendi sokağının üstüne tekrar çizerek yönünü değiştirebilir ya da ' +
      '"iki yön" ile kaldırabilirsin.',
    oneWayOff: 'İki yön',
    oneWayOn: 'Tek yön →',
    brushTitle: 'Fırça',
    brushSize: (size: number): string => `${size}×${size}`,
  },

  service: {
    fire: 'İtfaiye',
    health: 'Sağlık ocağı',
    education: 'Okul',
    police: 'Karakol',
    cemetery: 'Mezarlık',
    depot: 'Çöp toplama',
  },

  /**
   * Department budgets (sim/budgets.ts): the lever between "build one" and
   * "knock one down".
   */
  budget: {
    title: 'Birim bütçeleri',
    note:
      'Her birim yarım ile bir buçuk kat arasında çalışır. Bütçe ne kadar ' +
      'kazandırıyorsa o kadar da tutuyor — kısmak da artırmak da gerçek bir karar.',
    level: (value: number): string => `%${Math.round(value * 100)}`,
    down: '−',
    up: '+',
  },

  /** Bus and tram lines (sim/transit.ts): the second thing the player draws. */
  transit: {
    locked: (people: string): string => `Toplu taşıma ${people} kişide açılır.`,
    hint: 'Parmağınla bir hat çiz — duraklar kendiliğinden dizilir, çevresindeki trafiği alır.',
    laid: 'Hat açıldı.',
    tooDear: 'Bakiye hattı çekmeye yetmiyor.',
    tooShort: 'Hat çok kısa — en az iki durak lazım.',
    riders: 'Yolcu',
    fares: 'Bilet geliri',
    upkeep: 'Hat gideri',
  },

  /** The bins (sim/rubbish.ts): the service nobody builds a city for. */
  rubbish: {
    piling: 'Çöp toplanmıyor. Çöp toplama tesisi kur.',
    cleared: 'Çöpler yeniden toplanıyor.',
    row: 'Bekleyen çöp',
    issue: 'Çöp alınmıyor',
  },

  /** The waterfront (denize yatırım): the coast, finally worth something. */
  port: {
    fishing: 'Balıkçı barınağı',
    cargo: 'Liman',
    shipyard: 'Tersane',
    marina: 'Marina',
  },
  portSheetTitle: 'Deniz yatırımı',
  portNote:
    'Kıyıya kurulur — önünde açık su olmalı. Liman şehri memlekete bağlar: ' +
    'otoyol kapansa bile gemiler gelir.',
  portBuilt: 'Deniz tesisi kuruldu.',
  /** The panel row, once there is a waterfront to talk about. */
  seaIncome: 'Deniz geliri',
  /** What the motorway's own traffic left in the city's tills. */
  visitorIncome: 'Yoldan geçen',
  seaGateOpen: 'Liman açıldı — şehir artık denizden de bağlı.',

  utility: {
    well: 'Su kuyusu',
    waterworks: 'Su arıtma',
    coalPlant: 'Kömür santrali',
    gasPlant: 'Doğalgaz santrali',
    oilPlant: 'Petrol santrali',
    hydroPlant: 'Hidroelektrik baraj',
    solarFarm: 'Güneş tarlası',
    nuclearPlant: 'Nükleer santral',
  },

  /**
   * A plant's line in the sheet: "210 MW · ₺62.000 · 680 ₺/dk · duman".
   *
   * Capacity comes first because that is what the player is shopping for, and
   * the smoke comes last because that is the part they find out about later. Six
   * ways to make power are only a choice if the trade is on the row.
   */
  plantDetail: (
    capacity: number,
    unit: string,
    cost: number,
    upkeep: number,
    tags: readonly string[],
  ): string =>
    [
      `${plain.format(capacity)} ${unit}`,
      `₺${money.format(cost)}`,
      `${money.format(upkeep)} ₺/dk`,
      ...tags,
    ].join(' · '),
  plantUnit: { water: 'm³', power: 'MW' },
  plantTag: {
    clean: 'temiz',
    someSmoke: 'az duman',
    smoke: 'duman',
    heavySmoke: 'çok duman',
    needsWater: 'su kıyısı ister',
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
    noWater: 'Yeterli açık su yok. Suyun geniş olduğu bir kıyıya kur.',
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
    /** The calendar year, the city's clock. */
    year: (value: number): string => `${value}`,
    /** Net income per minute, signed. */
    net: (value: number): string =>
      `${value >= 0 ? '+' : '−'}${money.format(Math.abs(Math.round(value)))} ₺/dk`,
    demand: 'K · T · S',
  },

  era: {
    reached: (name: string): string => `${name} çağına ulaşıldı.`,
    next: (name: string, remaining: number): string =>
      `${name} çağına ${plain.format(Math.round(remaining))} kişi kaldı`,
    /** Said when the era crosses into a new architectural period. */
    rebuilt: 'Şehir yeniden inşa ediliyor',
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

  /**
   * Civic investments: what a rich city buys, and the answer to a long night.
   */
  invest: {
    title: 'Belediye yatırımları',
    note:
      'Bir kez alınır, her yere işler, satılamaz. Aydınlatma geceyi ölü zamandan ' +
      'çıkarır: karanlıkta dükkânlar kapanır, kimse otoyoldan sapıp ışıksız ' +
      'şehre girmez.',
    name: {
      lighting: 'Sokak aydınlatması',
      greening: 'Ağaçlandırma',
      festivals: 'Şenlik bütçesi',
    },
    detail: {
      lighting: 'Gece dükkânlar açık kalır, yoldan geçen durur, sokak güven verir.',
      greening: 'Şehrin her karesinde kirlilik emilir — sanayinin en kötü olduğu yerde en çok.',
      festivals: 'Takvimdeki bayramlar daha çok değer.',
    },
    /** "2/4" — how far through a programme the city is. */
    level: (level: number, total: number): string => `${level}/${total}`,
    /** "Elektrik hattı · ₺65.000 · 380 ₺/dk" */
    buy: (name: string, cost: number, upkeep: number): string =>
      `${name} · ₺${money.format(cost)} · ${money.format(upkeep)} ₺/dk`,
    complete: 'Program tamamlandı.',
    bought: 'Yatırım yapıldı.',
    tooDear: 'Bakiye yetmiyor.',
    /** The panel row for what the programmes cost to run. */
    upkeep: 'Yatırım gideri',
    /** Said once, when the first lighting tier lands. */
    lightsOn: 'Şehir aydınlandı — gece artık ölü zaman değil.',
  },

  /** Retiring a city (§6): the second run is where an idle game lives. */
  legacy: {
    title: 'Şehri devret',
    /** The panel row that opens it. */
    action: 'Şehri devret',
    /** "Bu şehir 26 miras puanı bırakır" */
    worth: (points: number): string => `Bu şehir ${plain.format(points)} miras puanı bırakır.`,
    /** What the endowment buys next time. */
    endowment: (amount: number): string =>
      `Yeni şehir ₺${plain.format(Math.round(amount))} ile başlar.`,
    warning: 'Bu şehir silinir. Geri alınamaz.',
    confirm: 'Devret ve yeniden başla',
    cancel: 'Vazgeç',
    /** Shown in the panel once the player has any. */
    held: (points: number): string => `${plain.format(points)} miras puanı`,
    locked: 'Kent çağına ulaşan bir şehir devredilebilir.',
    done: 'Şehir devredildi.',
  },

  /** Petitions (Paket 3 §7): the city naming what is wrong with it. */
  petition: {
    raised: {
      water: 'Mahalleli su istiyor — şebeke yetmiyor.',
      power: 'Elektrik kesintisi şikâyeti geldi.',
      services: 'Hizmet binası yok diye dilekçe verildi.',
      traffic: 'Trafik dilekçesi: sokaklar tıkanıyor.',
      pollution: 'Hava kirliliği şikâyeti geldi.',
      noise: 'Gürültü şikâyeti geldi.',
      rubbish: 'Çöpler alınmıyor diye dilekçe verildi.',
    },
    resolved: {
      water: 'Su sorunu çözüldü, dilekçe geri çekildi.',
      power: 'Elektrik düzeldi, dilekçe geri çekildi.',
      services: 'Hizmet binası kuruldu, dilekçe geri çekildi.',
      traffic: 'Trafik rahatladı, dilekçe geri çekildi.',
      pollution: 'Hava temizlendi, dilekçe geri çekildi.',
      noise: 'Gürültü azaldı, dilekçe geri çekildi.',
      rubbish: 'Çöpler toplanmaya başladı, dilekçe geri çekildi.',
    },
    icon: '📋',
  },

  /** The war on the road: convoys wear the motorway, the state sends a bill. */
  roadRepair: {
    title: 'Karayolları müdürlüğü',
    /** The feed, as each stretch crosses a line. */
    damaged: (sections: number): string =>
      sections > 1
        ? `Ana yolun ${sections} kesimi askerî konvoylarda bozuldu.`
        : 'Ana yol askerî konvoylarda bozuldu.',
    blocked: (sections: number): string =>
      sections > 1
        ? `Ana yolun ${sections} kesimi kapandı — barikat kuruldu.`
        : 'Ana yolun bir kesimi kapandı — barikat kuruldu.',
    reopened: (sections: number): string =>
      sections > 1 ? `Ana yolun ${sections} kesimi açıldı.` : 'Ana yol yeniden açıldı.',
    /** The card. Says the price, and what happens if it is not paid. */
    bill: (amount: number): string => `Tamir bedeli ₺${money.format(amount)}`,
    warning: 'Ödenmezse bozuk kesim trafiğe kapanır: göç durur, geçiş geliri kesilir.',
    urgent: 'Yol kapalı. Şehrin memleketle bağı kesildi.',
    pay: 'Öde',
    later: 'Sonra',
    paid: 'Ana yol onarıldı.',
    tooPoor: 'Kasa yetmiyor. Krediyle ödeyebilirsin.',
    icon: '🚧',
    /** The chronicle's telling of it. */
    chronicleDamaged:
      'Cephe yolu buradan geçiyordu. Tank taşıyıcıları ve top arabaları asfaltı söktü; ' +
      'karayolları müdürlüğü tamir masrafını belediyeden istedi.',
    chronicleBlocked:
      'Bozuk kesime barikat kuruldu. Şehrin memlekete açılan tek yolu kapandı; ' +
      'gelen giden kesildi, tezgâhın malı elinde kaldı.',
    chronicleReopened: 'Ana yol yeniden trafiğe açıldı. Şehir memleketle yeniden buluştu.',
  },

  /** Weather (Paket 2 §6). Announced when a spell begins, then left alone. */
  weather: {
    rain: 'Yağmur başladı. Yangın zor yayılır, tarla verir.',
    storm: 'Fırtına var. İtfaiye geç yetişiyor.',
    heat: 'Sıcak dalgası. Her şey kolay tutuşur.',
    fog: 'Sis çöktü.',
    clear: 'Hava açtı.',
    icon: {
      rain: '🌧️',
      storm: '⛈️',
      heat: '🌡️',
      fog: '🌫️',
      clear: '☀️',
    },
  },

  /** Research (§12.2): what the city has learned to do better. */
  tech: {
    title: 'Araştırma',
    /** Points in hand, on the sheet's heading. */
    points: (value: number): string => `${plain.format(Math.floor(value))} AP`,
    cost: (value: number): string => `${plain.format(value)} AP`,
    done: 'tamam',
    researched: 'Araştırma tamamlandı.',
    tooDear: 'Yeterli araştırma puanı yok.',
    none: 'Henüz araştırılacak bir şey yok. Şehir büyüdükçe açılır.',
    /**
     * What the schools are actually doing, in numbers.
     *
     * The old line just said schools help. A player who builds one and sees no
     * number move has been told a rumour: this says the coverage and the rate, so
     * the next school visibly changes both.
     */
    rate: (coverage: number, perMinute: number): string =>
      `Okul kapsamı %${Math.round(coverage * 100)} · ${plain.format(Math.round(perMinute * 10) / 10)} AP/dk`,
    rateHint: 'Okul kur — kapsam büyüdükçe araştırma hızlanır.',
    /** Said when a new school measurably speeds the city's research up. */
    schoolBuilt: (perMinute: number): string =>
      `Okul açıldı. Araştırma ${plain.format(Math.round(perMinute * 10) / 10)} AP/dk'ya çıktı.`,
    name: {
      sanitation: 'Arıtma',
      transit: 'Toplu taşıma',
      codes: 'İmar yönetmeliği',
      registry: 'Tapu kadastro',
      administration: 'Belediye teşkilatı',
      agronomy: 'Ziraat',
      fireproofing: 'Yapı güvenliği',
      forensics: 'Kriminoloji',
      medicine: 'Tıp',
      turbines: 'Türbin',
      hydrology: 'Hidroloji',
      coldChain: 'Soğuk zincir',
      hospitality: 'Konukçuluk',
    },
    detail: {
      sanitation: 'Sanayi daha az kirletir ve daha az gürültü yapar.',
      transit: 'Aynı yol daha çok trafik taşır.',
      codes: 'Binalar daha hızlı yükselir.',
      registry: 'Parseller daha ucuza alınır.',
      administration: 'Hizmet ve şebeke giderleri düşer.',
      agronomy: 'Tarım daha çok iş ve ürün verir.',
      fireproofing: 'Yangın daha seyrek çıkar.',
      forensics: 'Suç daha seyrek işlenir.',
      medicine: 'Salgın daha hafif geçer.',
      turbines: 'Santraller daha çok elektrik verir.',
      hydrology: 'Su tesisleri daha çok su verir.',
      coldChain: 'Balıkçılık daha çok kazandırır.',
      hospitality: 'Yoldan geçen daha çok para bırakır.',
    },
  },

  /** Credit (§7): the bank, and what it will lend. */
  bank: {
    title: 'Banka',
    /** Shown when the balance runs dry and there is an offer on the table. */
    offer: (amount: number, rate: number): string =>
      `₺${money.format(amount)} kredi · %${Math.round(rate * 100)} faiz`,
    instalment: (perMinute: number): string =>
      `${money.format(Math.round(perMinute))} ₺/dk taksit, 20 dakika`,
    take: 'Krediyi al',
    decline: 'Gerek yok',
    taken: 'Kredi kullanıldı.',
    cleared: 'Kredi kapandı.',
    /** Why the bank said no. */
    tooPoor: 'Banka bu şehre henüz kredi vermiyor. Vergi geliri artmalı.',
    tooManyLoans: 'İki kredin var. Biri kapanmadan üçüncüsü açılmaz.',
    /** The panel row. */
    debt: 'Borç',
  },

  /** Neighbourhoods, floating over the city. */
  district: {
    /** "1.240 kişi · 32 bina" */
    detail: (people: number, buildings: number): string =>
      `${plain.format(Math.round(people))} kişi · ${plain.format(buildings)} bina`,
  },

  /** Goals (§12.3): what the city is being asked for next. */
  mission: {
    title: 'Hedefler',
    /** "4/19 tamam" */
    done: (complete: number, total: number): string => `${complete}/${total} tamam`,
    none: 'Şimdilik hepsi tamam. Bir sonraki çağ yenilerini açar.',
    /** Toast when one lands. */
    complete: 'Hedef tamamlandı',
    reward: (amount: number): string => `+₺${money.format(amount)}`,
    /** "18 / 24" — where the city is against what was asked. */
    progress: (have: number, want: number): string =>
      `${plain.format(Math.floor(have))} / ${plain.format(want)}`,
    goal: {
      roadTiles: (n: number): string => `${plain.format(n)} kare yol çiz`,
      buildings: (n: number): string => `${plain.format(n)} bina yükselsin`,
      population: (n: number): string => `${plain.format(n)} kişi yaşasın`,
      jobs: (n: number): string => `${plain.format(n)} iş oluştur`,
      housing: (n: number): string => `${plain.format(n)} konut kapasitesi kur`,
      happiness: (n: number): string => `Mutluluğu ${n}'e çıkar`,
      reserve: (n: number): string => `Kasada ₺${money.format(n)} biriktir`,
      services: (n: number): string => `${plain.format(n)} hizmet binası kur`,
      utilities: (n: number): string => `${plain.format(n)} su/elektrik tesisi kur`,
      parcels: (n: number): string => `${plain.format(n)} parsele sahip ol`,
      farmTiles: (n: number): string => `${plain.format(n)} kare tarım boya`,
      interchanges: (n: number): string => {
        void n;
        return 'Yolunu ulusal otoyola bağla';
      },
      transitFlow: (n: number): string =>
        `Otoyoldan dakikada ${plain.format(n)} araç geçsin`,
      ports: (n: number): string =>
        n > 1 ? `Kıyıda ${plain.format(n)} deniz tesisi çalıştır` : 'Kıyıya bir deniz tesisi kur',
      seaIncome: (n: number): string => `Denizden dakikada ₺${money.format(n)} kazan`,
      atLevel: (level: number, n: number): string =>
        `${plain.format(n)} bina ${level}. seviyeye çıksın`,
    },
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
    debt: 'Kredi taksiti',
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
    farmIncome: 'Tarım geliri',
    transit: 'Otoyol geçişi',
  },

  view: {
    zoomIn: 'Yaklaştır',
    zoomOut: 'Uzaklaştır',
    rotate: 'Kamerayı çevir',
    sound: 'Sesi aç/kapat',
    walk: 'Şehirde yürü',
    history: 'Şehrin tarihçesi',
    pan: 'Haritayı kaydır (tek parmak)',
    speed: 'Zaman hızı',
    /** Said when the city is stopped, so a player cannot wonder why nothing moves. */
    paused: 'Zaman durdu.',
    panOn: 'Kaydırma açık — tek parmakla haritayı sürükle.',
    panOff: 'Kaydırma kapalı — tek parmak yine çiziyor.',
    /** Shown once, the first time a desktop city opens. */
    keyboardHint: 'WASD / ok tuşları ile haritayı gezebilirsin · Q E çevirir · R F yakınlaştırır',
  },

  walk: {
    exit: 'Haritaya dön',
    hintKeys: 'WASD ile yürü · sürükleyerek etrafına bak · Esc ile çık',
    hintTouch: 'Sol tarafla yürü · sağ tarafla etrafına bak',
  },

  history: {
    title: 'Şehrin tarihçesi',
    empty: 'Henüz bir olay yaşanmadı — tarih, şehir büyüdükçe yazılacak.',
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
