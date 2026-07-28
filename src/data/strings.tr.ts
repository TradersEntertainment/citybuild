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
    densityTitle: 'Yükseklik',
    densityNote:
      'Normal imar üç kata kadar çıkar: mahalle, dükkân, atölye. Yoğun imar ' +
      'beşe kadar çıkar — ama dört katı da hizmet ister. Servisi olmayan ' +
      'yoğun arsaya hiçbir şey kurulmaz, boş durur. Fiyatı dört katı.',
    densityOff: 'Normal',
    densityOn: 'Yoğun ↑',
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
   * The vote (sim/elections.ts).
   *
   * Never a game over. A beaten mayor keeps their city, their money and their
   * map; what they lose is the grant. The copy has to say that, or a defeat reads
   * as a threat the game is not actually making.
   */
  election: {
    won: (share: string, grant: string): string =>
      `Seçimi kazandın — ${share} oy. Hazineye ${grant} ödenek geldi.`,
    lost: (share: string): string =>
      `Seçimi kaybettin — ${share} oy. Şehir senin; ödenek yok. Önümüzdeki dönem düzelt.`,
    row: 'Onay oranı',
    countdown: 'Sonraki seçim',
    next: (seconds: number): string => `${Math.ceil(seconds)} sn`,
  },

  /**
   * The electorate (sim/groups.ts, §23): one mood number becomes seven
   * factions. Names are banners, not demographics — "sürücüler" is anybody
   * who minds the traffic, not a licence count.
   */
  groups: {
    title: 'Kamuoyu',
    note:
      'Tek bir mutluluk yok — kesimler var. Her karar birilerini sevindirir, ' +
      'birilerini kızdırır; sandıkta hepsi ağırlığınca sayılır.',
    name: {
      young: 'Gençler',
      elders: 'Emekliler',
      families: 'Aileler',
      shopkeepers: 'Esnaf',
      industrialists: 'Sanayiciler',
      greens: 'Çevreciler',
      drivers: 'Sürücüler',
    } as Record<string, string>,
    share: (weight: number): string => `%${Math.round(weight * 100)}`,
    empty: 'Kamuoyu henüz yok — kimse taşınmadı.',
  },

  /**
   * The papers (§23). Two voices, one event: the Post reads everything as
   * business, the Gazette reads everything as neighbourhood. Neither lies —
   * the game only ever prints true things — they pick different truths.
   */
  /**
   * The opening (§33): choose your dictator, then win your first term by
   * telling people what they want to hear. This is where a politics game
   * should begin — with who you are and an election you have to buy.
   */
  onboarding: {
    pickTitle: 'Diktatörünü seç',
    pickLede: 'Nereden geldiğin, seni kimin desteklediğini belirler. Gerisi sana kalmış.',
    base: 'Tabanın',
    edge: 'Avantajın',
    leaders: {
      populist: { name: 'Halkın Sesi', edge: 'Geniş taban, boş kasa.' },
      technocrat: { name: 'Teknokrat', edge: 'Dolu kasa (+₺45.000), esnafın güveni.' },
      strongman: { name: 'Demir Yumruk', edge: 'Korkulan şehir: öfke %34 yavaş örgütlenir.' },
      patron: { name: 'Ağa', edge: 'Her seçim zaferi %25 daha çok öder.' },
      reformer: { name: 'Reformcu', edge: 'Çevre ve gençlik seninle; kasa değil.' },
    },
    voteTitle: 'İlk seçim',
    voteLede: 'Kazanmak için vaat ver. Tuttuğun sürece taban seninle; tutmazsan bir sonraki seçimde ödersin.',
    approval: 'Oy oranı',
    needed: 'Kazanmak için %50 gerekli.',
    win: 'Seçime gir',
    winning: 'Kazandın — göreve başla!',
    losing: 'Yetmez. Daha çok kesime vaat ver.',
    yourBase: 'Tabanın seninle:',
    begin: 'Şehri devral',
  },
  media: {
    postName: 'Şehir Postası',
    gazetteName: 'Körfez Gazetesi',
    /**
     * The crisis (§29), read two ways.
     *
     * The Post reads a coup as stability and the Gazette reads it as the end of
     * something — neither is lying, and the player is left to decide which
     * paper they think is right. That disagreement is the whole reason there
     * are two of them.
     */
    crisisHandedOver: {
      post: 'Devir teslim sorunsuz: piyasalar rahatladı.',
      gazette: 'Belediye anahtarı teslim etti — mahalle "hakkını verdi" diyor.',
    },
    crisisRefused: {
      post: 'Belediye koltuğu bırakmıyor: hukukçular tartışıyor.',
      gazette: 'Sandığa gidip ne oldu? Meydanda kalabalık var.',
    },
    crisisSeized: {
      post: 'Yönetim el değiştirmedi: kararlar artık hızlı alınacak.',
      gazette: 'Seçim yok. Bundan sonrasını kim soracak?',
    },
    /** The papers on a revolt — the one story censorship cannot bury. */
    revolt: {
      post: 'Meydanlarda kalabalık: üretim durdu, yatırımcı kaçıyor.',
      gazette: 'Bardak taştı. Kimse şaşırmadı — bir kişi hariç.',
    },
    /** What the Gazette prints under censorship: nothing it is allowed to say. */
    censoredLine: '\u{258C}\u{258C}\u{258C} — sansürlendi',
    opponentBeat: {
      post: 'Sandık değişim dedi: yeni yönetim göreve hazırlanıyor.',
      gazette: 'Meydanda kalabalık var — ama bu kez kutlama için.',
    },
    opponentHeld: {
      post: 'Belediye koltuğunu korudu: piyasa istikrarı sürdürüyor.',
      gazette: 'Yine aynı isim. Mahalle "bakalım" diyor.',
    },
    promiseKept: {
      post: 'Belediye taahhüdünü yerine getirdi: güven tazelendi.',
      gazette: 'Dediğini yaptı. Mahalle şaşırdı ama memnun.',
    },
    promiseBroken: {
      post: 'Taahhüt tutulmadı: yatırımcı temkinli.',
      gazette: 'Söz vermişti. Kimse unutmadı.',
    },
    crisisSettled: {
      post: 'Sokak yatıştı: yatırımcı geri dönüyor.',
      gazette: 'Meydan boşaldı — kimse kazandı demiyor, ama ekmek ucuzladı.',
    },
    policyOn: {
      freeTransit: {
        post: 'Bilet kasası kapandı: ulaşım artık vergiden.',
        gazette: 'Otobüs bedava — mahalle sandığa gülerek gider.',
      },
      nightShift: {
        post: 'Atölyeler gece de çalışacak: üretim rekora koşuyor.',
        gazette: 'Gece vardiyası: sanayi mahallelerinde uyku bitti.',
      },
      schoolBuses: {
        post: 'Okul servisi bütçeye dakika başı yazıyor.',
        gazette: 'Servisler kalktı: en uzak sokak da okula ulaşıyor.',
      },
      recycling: {
        post: 'Geri dönüşüm üretimi yavaşlatıyor, sanayi homurdanıyor.',
        gazette: 'Çöpün beşte biri artık tesise hiç gitmiyor.',
      },
      smokeBan: {
        post: 'Sigara yasağı dükkân cirosunu kıstı.',
        gazette: 'Kapalı mekânlar nefes aldı; salgınlar hafif geçecek.',
      },
      touristTax: {
        post: 'Turist vergisi otel kasasını doldurdu.',
        gazette: 'Vergiyi duyan yabancı şehre hiç sapmıyor.',
      },
    } as Record<string, { post: string; gazette: string }>,
    policyOff: {
      freeTransit: {
        post: 'Bilet kasası yeniden açıldı: hat kendi parasını kazanacak.',
        gazette: 'Bedava otobüs bitti — kalabalık yine cebinden ödüyor.',
      },
      nightShift: {
        post: 'Gece vardiyası kalktı: üretim gündüze sıkıştı.',
        gazette: 'Geceler yine sessiz — sanayi mahallesi uyuyor.',
      },
      schoolBuses: {
        post: 'Servis bütçeden çıktı: kasaya nefes.',
        gazette: 'Servis kalktı; uzak sokaklar okula yine yürüyor.',
      },
      recycling: {
        post: 'Ayrıştırma bitti: bant tam hızda.',
        gazette: 'Geri dönüşüm kaldırıldı — çöp yine tesise akıyor.',
      },
      smokeBan: {
        post: 'Yasak kalktı: tezgâh yine kalabalık.',
        gazette: 'Kapalı mekânlarda hava eskisine döndü.',
      },
      touristTax: {
        post: 'Turist vergisi kalktı: otelci payına küstü.',
        gazette: 'Vergi bitti — yabancı yine sapıyor.',
      },
    } as Record<string, { post: string; gazette: string }>,
    attractionBuilt: {
      hotel: {
        post: 'Yeni otel açıldı: geceleyen ziyaretçi kasaya yazıyor.',
        gazette: 'Otelin sokağı artık hiç boşalmıyor.',
      },
      clockTower: {
        post: 'Saat kulesi açıldı: meydanın değeri arttı.',
        gazette: 'Şehrin artık bir silueti var.',
      },
      opera: {
        post: 'Opera binası: bakımı ağır, prestiji ağırdır.',
        gazette: 'Perde açıldı — şehir bir akşamlığına başka bir yer.',
      },
      stadium: {
        post: 'Stadyum açıldı: maç günü esnafın günü.',
        gazette: 'Maç günü sokaklar tek renk.',
      },
      tvTower: {
        post: 'TV kulesi: şehir artık uzaktan görünüyor.',
        gazette: 'Kule mahallenin üstünde — kimine gurur, kimine gölge.',
      },
      airport: {
        post: 'Havalimanı açıldı: ihracatın üçüncü kapısı.',
        gazette: 'Pistin altındaki mahalle uçak sayıyor.',
      },
    } as Record<string, { post: string; gazette: string }>,
    electionWon: {
      post: 'Sandık kapandı: piyasalar istikrardan memnun.',
      gazette: 'Mahalle sandıkta evet dedi — şimdi sözlerin takvimi işliyor.',
    },
    electionLost: {
      post: 'Seçim kaybedildi: ödenek yok, kemerler sıkılacak.',
      gazette: 'Sandık uyarıydı — kesimler dinlenmediğini söylüyor.',
    },
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
  tourismIncome: 'Turizm',
  lobbyIncome: 'Anlaşmalar',
  decreeIncome: 'Fermanlar',
  policy: {
    title: 'Politikalar',
    note: 'Meclisin inşaatsız kolları. Her biri bir takas — bedavası yok.',
    on: 'Yürürlükte',
    off: 'Kapalı',
    name: {
      freeTransit: 'Ücretsiz ulaşım',
      nightShift: 'Gece vardiyası',
      schoolBuses: 'Okul servisi',
      recycling: 'Geri dönüşüm',
      smokeBan: 'Sigara yasağı',
      touristTax: 'Turist vergisi',
    },
    detail: {
      freeTransit: 'Otobüsler dolar, hat ferahlar — ama bilet kasası boş kalır.',
      nightShift: 'Atölyeler gece de çalışır: üretim artar, sokak gürler, şehir yorulur.',
      schoolBuses: 'Okul daha uzağa ulaşır; servis dakika başı yazar.',
      recycling: 'Çöpün beşte biri tesise hiç gitmez; ayrıştırma üretimi azıcık yavaşlatır.',
      smokeBan: 'Salgınlar hafif atlatılır, hava ferahlar; dükkân cirosu kılca düşer.',
      touristTax: 'Otel geliri artar; yabancıların bir kısmı hiç sapmaz.',
    },
    applied: (name: string): string => `${name} yürürlükte.`,
    repealed: (name: string): string => `${name} kaldırıldı.`,
  },
  attractionSheetTitle: 'Turizm ve simge',
  attractionNote:
    'Otel, kavşaktan sapan ziyaretçiyi geceletir — akışın ulaştığı bir sokağa ' +
    'kur. Simge yapılar birer kez kurulur: şehre gurur, yabancıya sebep.',
  attraction: {
    hotel: 'Otel',
    clockTower: 'Saat kulesi',
    opera: 'Opera binası',
    stadium: 'Stadyum',
    tvTower: 'TV kulesi',
    airport: 'Havalimanı',
  },
  attractionBuilt: 'Kuruldu — şehirde bir tane olur',

  serviceBlocked: {
    locked: 'Bu bina henüz açılmadı.',
    unowned: 'Burası senin arazin değil.',
    occupied: 'Bu kare dolu.',
    noRoad: 'Yola çok uzak. Yol kenarına kur.',
    noWater: 'Yeterli açık su yok. Suyun geniş olduğu bir kıyıya kur.',
    // Only asphalt and above carry mains; a dirt track cannot be dug up for pipe.
    noMains: 'Şebeke taşıyan yol yok. Asfalt ya da bulvar kenarına kur.',
    tooDear: 'Bakiye yetmiyor.',
    alreadyBuilt: 'Bundan zaten bir tane var — simge yapılar birer kez kurulur.',
  },

  zone: {
    res: 'Konut',
    com: 'Ticaret',
    ind: 'Sanayi',
    farm: 'Tarım',
    park: 'Park',
    office: 'Ofis',
  },
  zoneLocked: (era: string): string => `${era} çağında açılır`,
  officeNote:
    'Ofis, okullarının karşılığı. Kirletmez, mal istemez, konutun yanında ' +
    'durabilir ve en çok vergiyi o öder — ama zemin katın üstüne çıkması için ' +
    'şehrin işgücünün okumuş olması gerekir. Okul bugün, ofis iki kuşak sonra.',

  hud: {
    population: (value: number): string => `${plain.format(Math.round(value))} kişi`,
    happiness: (value: number): string => `mutluluk ${Math.round(value)}`,
    fps: (value: number): string => `${Math.round(value)} fps`,
    cpu: (value: number): string => `${value.toFixed(0)}ms cpu`,
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
    /** Why the points are what they are — the card's grade, and its effect. */
    graded: (grade: string, percent: string): string =>
      `Şehir karnesi: ${grade} — miras puanının ${percent}'i.`,
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
  /**
   * The lobbies (§24). Each one gets a name, the sentence it opens with, and a
   * plain statement of what the city is trading — never a euphemism, because a
   * card that undersells the cost would make the term feel like a trick rather
   * than a decision the player made.
   */
  lobby: {
    title: 'Teklif',
    icon: '\u{1F91D}',
    /** ₺ they pay, or ₺ the city pays, at signing. */
    signingPaid: (amount: number): string => `Peşin ödeme: +₺${money.format(amount)}`,
    signingCost: (amount: number): string => `Peşin bedel: −₺${money.format(amount)}`,
    /** …and the same, per minute, for as long as it runs. */
    stipendPaid: (amount: number): string => `Ayrıca dakikada +₺${money.format(amount)}`,
    stipendCost: (amount: number): string => `Ayrıca dakikada −₺${money.format(amount)}`,
    term: (seconds: number): string => `Süre: ${Math.round(seconds)} sn`,
    remaining: (seconds: number): string => `${Math.round(seconds)} sn kaldı`,
    accept: 'İmzala',
    decline: 'Reddet',
    tooPoor: 'Kasa yetmiyor.',
    /** The feed, when a term runs out on its own. */
    lapsed: (name: string): string => `${name} anlaşması sona erdi.`,
    declined: 'Teklif reddedildi.',
    /** The panel's own section. */
    heading: 'Anlaşmalar',
    none: 'İmzalı anlaşma yok.',
    names: {
      builder: 'İnşaat şirketi',
      oil: 'Petrol şirketi',
      tourism: 'Turizm şirketi',
      university: 'Üniversite',
      ngo: 'Çevre derneği',
      union: 'Sendika',
    },
    /** What each one wants, in its own voice. */
    pitch: {
      builder: 'Ruhsatları hızlandırın, şehri biz büyütelim.',
      oil: 'Rafineriye izin verin; karşılığı bu.',
      tourism: 'Şehri tanıtalım, otobüsler dolsun.',
      university: 'Kampüs için arsa ve bütçe istiyoruz.',
      ngo: 'Havayı temizleyecek bütçeyi ayırın.',
      union: 'Ücretlere zam istiyoruz.',
    },
    /** …and what it costs, said plainly. */
    cost: {
      builder: 'Binalar hızlı yükselir; arsa değeri her yerde düşer.',
      oil: 'Sanayi üretimi artar; bacalar daha çok kirletir.',
      tourism: 'Ziyaretçi artar; çöp de artar.',
      university: 'Eğitim daha uzağa ulaşır, araştırma hızlanır.',
      ngo: 'Kirlilik her karede azalır.',
      union: 'Şehir mutlu olur; atölyeler yavaşlar.',
    },
    /** The chronicle's telling. */
    chronicleSigned: 'Belediye anlaşmayı imzaladı.',
    chronicleLapsed: 'Anlaşmanın süresi doldu.',
  },
  /**
   * The city's report card (§25).
   *
   * Six graded dimensions, and one sentence saying what the card is *for*: the
   * ballot box counts voters, this counts none. Without that line the player
   * reads a second approval rating and wonders why it disagrees.
   */
  report: {
    title: 'Şehir karnesi',
    icon: '\u{1F4CB}',
    note: 'Sandık oy sayar; karne saymaz. İkisi ayrı düşebilir.',
    overall: 'Genel',
    /** The chronicle line at each election. */
    chronicle: (grade: string): string => `Dönem karnesi: ${grade}`,
    /** What the card is worth to the next city, on the retire screen. */
    endowment: (percent: string): string => `Karne mirası ${percent} etkiliyor`,
    names: {
      mobility: 'Ulaşım',
      environment: 'Çevre',
      welfare: 'Refah',
      economy: 'Ekonomi',
      equity: 'Adalet',
      endurance: 'Kalıcılık',
    },
  },
  /**
   * Streets the one-way arrows cut off (§26).
   *
   * Named as a signing mistake rather than as a disaster, because that is what
   * it is and the fix is thirty seconds with the same tool that caused it. The
   * line says how many and roughly where — a count alone is halfway to a bug
   * report and no way to a fix.
   */
  marooned: {
    icon: '\u{26D4}',
    unreachable: (tiles: number): string =>
      `${tiles} sokağa girilemiyor — tek yön okları ters.`,
    trapped: (tiles: number): string => `${tiles} sokaktan çıkılamıyor — tek yön okları ters.`,
    cleared: 'Tek yön okları düzeldi; bütün sokaklara girilebiliyor.',
    /** Where to look. Without this the count is a warning with nowhere to go. */
    hint: 'Tek yön erişimi katmanını aç: kırmızı sokaklara girilemiyor.',
    /** The chronicle's telling. */
    chronicle: 'Ters işaretlenmiş kavşak trafiği kesti.',
    chronicleCleared: 'Tek yön düzeni onarıldı.',
  },
  /**
   * The fork after a lost election (§29), and what the city says about it.
   *
   * Every line names the cost as well as the offer. A coup card that read like
   * a power fantasy and hid the bill would be the game tricking the player into
   * the most consequential decision in it; a card that read like a warning
   * would be the game deciding for them. Both are stated flatly, and the choice
   * is theirs.
   */
  /**
   * Campaign promises (§30).
   *
   * Every line is written as something a mayor would actually say on a stage,
   * not as a system description — "Trafiği çözeceğim" rather than "trafik
   * şikâyeti %18'in altına insin". The bar is shown separately, beside the
   * progress, so the promise reads as a promise and the measurement reads as
   * the measurement.
   */
  /**
   * The candidate standing against you (§31).
   *
   * Named, with their platform, before the vote. "Muhalefet sürücülerin %8'ini
   * aldı" is a statistic; "Nuri Balaban çukurlar üzerinden yarışıyor" is
   * something the player remembers when they read the chronicle back — and
   * something they can act on while there is still a term left to act in.
   */
  /**
   * Decrees (§32). Every row states both halves of its trade in the same
   * breath — what it pays, and that the city will mind — because the only
   * thing this system hides is *how much* this particular city minds, and that
   * is the game.
   */
  decree: {
    title: 'Fermanlar',
    icon: '\u{1F5DE}',
    note: 'Her ferman şimdi öder, halkı hep kızdırır. Bu şehrin sabrını ancak deneyerek öğrenirsin.',
    enact: 'Çıkar',
    repeal: 'Kaldır',
    enacted: 'Ferman çıktı.',
    repealed: 'Ferman kaldırıldı.',
    /** The year-gated lock, said plainly: a lock always names its key. */
    lockedYear: (year: number): string => `${year}'den önce olmaz`,
    names: {
      grainLevy: 'Tahıl tekeli',
      corvee: 'Angarya',
      conscription: 'Zorunlu askerlik',
      censorship: 'Basın sansürü',
      curfew: 'Sokağa çıkma yasağı',
      propaganda: 'Propaganda dairesi',
      strikeBan: 'Grev yasağı',
      informants: 'Muhbir ağı',
      surcharge: 'Ek vergi kararnamesi',
      martialLaw: 'Sıkıyönetim',
      borderClosure: 'Sınır kapısı kapatma',
      internetCut: 'İnternet kesintisi',
      socialMediaBan: 'Sosyal medya yasağı',
    },
    /** The trade, both halves, in one line each. */
    trade: {
      grainLevy: 'Hasadın kârı devlete kalır; köylük yerler unutmaz.',
      corvee: 'Yol bakımını halk sırtlar, hazine rahatlar; taş taşıyan da oy verir.',
      conscription: 'Hazineye aylık ödenek; atölyeler yavaşlar, gençler ve aileler kızar.',
      censorship: 'Öfke yavaş örgütlenir — ama sokağın sesi de sana ulaşmaz.',
      curfew: 'Suç yarıya iner; dükkânlar kan kaybeder, sokak için için kaynar.',
      propaganda: 'Her kesim biraz ısınır; kasadan öder, şehre hiçbir şey katmaz.',
      strikeBan: 'Bantlar durmaz, üretim artar; patronlar memnun, işçi değil.',
      informants: 'Her apartmanda bir kulak: suç düşer, sansürde bile sokağı duyarsın. Komşular birbirinden korkar.',
      surcharge: 'Vergiyi vergileyen kararname: kasa %15 şişer, esnaf ve sanayi bilenir.',
      martialLaw: 'Asker meydanda: suç ve huzursuzluk bastırılır, ticaret ölür, HERKES kızar. En hızlı öfke.',
      borderClosure: 'Kimse gidemez — huzursuzluğun kaçırdığı nüfus içeride kalır. Kalır ve kızar.',
      internetCut: 'Örgütlenme çöker; ofisler ve araştırma da çöker. Gençler unutmaz.',
      socialMediaBan: 'Platformlar karanlık, hat açık: örgütlenme yavaşlar ama uyarılar susmaz.',
    },
    /** The one-shot. */
    confiscate: 'Varlık haczi',
    confiscateTrade: 'Şimdi para. Sonrasını şehir söyler.',
    confiscated: (amount: number): string => `Haciz: +₺${money.format(amount)}`,
    /** The other one-shot: the release valve. */
    bread: 'Ekmek dağıtımı',
    breadTrade: 'Kasadan öder, öfkeyi biraz indirir. Ne kadar? Şehrine sor.',
    breadGiven: (amount: number): string => `Meydanda ekmek dağıtıldı: −₺${money.format(amount)}`,
    breadTooPoor: 'Kasa ekmeğe bile yetmiyor.',
    /** The tax lever, finally attached. */
    tax: 'Vergi oranı',
    taxNote: 'Canlı: her kesimin çubuğu anında oynar. Bir yerden sonra öfke birikmeye başlar — nerede? Dene.',
    /** The meter. */
    fury: 'Halkın öfkesi',
    stage: {
      calm: 'Sokak sakin.',
      murmurs: 'Halk homurdanıyor.',
      protests: 'Meydanlarda protesto var.',
    },
    /** What the meter shows when the player has blinded their own press. */
    censored: 'Basın susturuldu — sokak okunamıyor.',
    /** The snap. */
    revolt: 'İSYAN! Sokaklar yanıyor.',
    revoltWorst: (what: string): string => `İsyanın fitili: ${what}.`,
    revoltTax: 'vergiler',
    /** Feed lines for the meter's crossings. */
    calmAgain: 'Sokak yatıştı.',
    chronicleEnacted: 'Belediye fermanla yönetmeye başladı.',
    chronicleRepealed: 'Ferman geri çekildi.',
    chronicleRevolt: 'Şehir ayaklandı; meydanlar yandı.',
  },
  opponent: {
    heading: 'Rakip',
    icon: '\u{1F3F4}',
    note: 'Muhalefet, ihmal ettiğin yerden oy alır.',
    /** "Nuri Balaban — sürücülere ve esnafa oynuyor" */
    platform: (name: string, first: string, second: string): string =>
      `${name} — ${first} ve ${second} oynuyor`,
    /** What they are taking right now. */
    taking: 'Kaptırılan oy',
    /** In the election announcement. */
    beat: (name: string, share: string): string => `${name} kazandı. Senin payın %${share}.`,
    held: (name: string, share: string): string => `${name} kazanamadı. Payın %${share}.`,
    none: 'Karşında kimse yok.',
    archetype: {
      populist: 'Çukur adayı',
      reformer: 'Reformcu',
      industrialist: 'Sanayici',
      traditionalist: 'Muhafazakâr',
      technocrat: 'Teknokrat',
    },
  },
  promise: {
    title: 'Seçim vaatleri',
    icon: '\u{1F4E3}',
    note: 'Vaat vermek bedava ve hemen işe yarar. Seçimde tutulmayan vaat pahalıya patlar.',
    /** "2/3 vaat" */
    count: (made: number, limit: number): string => `${made}/${limit} vaat`,
    none: 'Henüz vaat yok.',
    make: 'Vaat ver',
    made: 'Vaat verildi.',
    full: 'Daha fazla vaat veremezsin.',
    /** On the row: where the city stands against the bar. */
    progress: (have: string, want: string): string => `${have} / ${want}`,
    onTrack: 'tutuluyor',
    behind: 'geride',
    /** At the election. */
    kept: (what: string): string => `Vaat tutuldu: ${what}`,
    broken: (what: string): string => `Vaat tutulmadı: ${what}`,
    /** The grudge, in the panel. */
    betrayed: 'Kırılan güven',
    betrayedNote: 'Tutulmayan vaatler unutulur, ama birkaç dönem sürer.',
    names: {
      noJams: 'Trafiği çözeceğim',
      cleanAir: 'Havayı temizleyeceğim',
      schools: 'Her mahalleye okul',
      lowTax: 'Vergiyi artırmayacağım',
      work: 'Herkese iş',
      care: 'Sağlık ocağı her yerde',
    },
    /** Who it is addressed to, shown on the row. */
    courts: {
      noJams: 'sürücülere',
      cleanAir: 'çevrecilere',
      schools: 'ailelere',
      lowTax: 'esnafa',
      work: 'gençlere',
      care: 'emeklilere',
    },
    chronicleKept: 'Belediye verdiği sözü tuttu.',
    chronicleBroken: 'Belediye verdiği sözü tutmadı.',
  },
  crisis: {
    title: 'Seçim kaybedildi',
    icon: '\u{1F5F3}',
    lead: (share: string): string =>
      `Sandıktan %${share} çıktı. Şehir yeni bir yönetim istiyor.`,
    handOver: 'Görevi devret',
    handOverNote: 'Ödenek gider, şehir kalır. Yeni yönetim iyi niyetle başlar.',
    refuse: 'Sonucu tanıma',
    refuseNote: 'Koltukta kalırsın. Sokak karışır; gelecek seçim hâlâ var.',
    seize: 'Yönetime el koy',
    seizeNote: 'Seçimler biter. Bir daha kaybetmezsin — şehir de bunu unutmaz.',
    /** Confirmations. */
    handedOver: 'Görev devredildi.',
    refused: 'Sonuç tanınmadı.',
    seized: 'Yönetime el kondu. Seçimler durdu.',
    /** The meter crossing, in the feed. */
    rising: 'Sokaklar karışıyor.',
    settling: 'Sokaklar yatışıyor.',
    /** The panel section. */
    heading: 'Meşruiyet',
    unrest: 'Huzursuzluk',
    mandate: {
      elected: 'Seçilmiş yönetim',
      refused: 'Tanınmayan sonuç',
      seized: 'El konmuş yönetim',
    },
    /** How the streets can be settled again, said where the meter is shown. */
    hint: {
      elected: 'Sandık seni onayladı.',
      refused: 'İyi bir karne sokağı yatıştırır; gelecek seçimi kazanmak bitirir.',
      seized: 'Seçim yok. Sokağı yatıştırmanın tek yolu şehri gerçekten iyi yönetmek.',
    },
    /** The chronicle. */
    chronicleRefused: 'Belediye sandık sonucunu tanımadı.',
    chronicleSeized: 'Belediye yönetime el koydu; seçimler askıya alındı.',
    chronicleHandedOver: 'Görev seçilen yönetime devredildi.',
  },
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
    /** The name of the marked square, shown beside a site goal. */
    site: (name: string): string => `📍 ${name}`,
    /** A mandate pays in what outlives the city, so it says so differently. */
    rewardLegacy: (points: number): string => `+${plain.format(points)} miras puanı`,
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
      /** The mandates (§27). Named as a standard to reach, not a thing to build. */
      cardOverall: (n: number): string => `Şehir karnesini %${n}'e çıkar`,
      cardDimension: (name: string, n: number): string => `Karnede ${name} %${n} olsun`,
      /**
       * The site goals (§28). Every one says "işaretli bölge" out loud, because
       * the pulsing square on the map and the line in the panel have to read as
       * the same instruction — a goal that said only "12 kare park boya" would
       * send the player anywhere.
       */
      onSite: {
        park: (n: number): string => `İşaretli bölgeye ${n} kare park boya`,
        homes: (n: number): string => `İşaretli bölgede ${n} konut yükselsin`,
        shops: (n: number): string => `İşaretli bölgede ${n} dükkân açılsın`,
        workshops: (n: number): string => `İşaretli bölgede ${n} atölye kurulsun`,
        service: (n: number): string =>
          n > 1 ? `İşaretli bölgeye ${n} hizmet binası kur` : 'İşaretli bölgeye bir hizmet binası kur',
        tall: (n: number): string => `İşaretli bölgede ${n} bina 3. seviyeye çıksın`,
      },
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
    /** The two tabs (§34): power, and the place. */
    tabGovern: 'Yönetim',
    tabCity: 'Şehir',
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

  lens: {
    off: 'Katman kapandı',
    name: {
      value: 'Arazi değeri',
      pollution: 'Kirlilik',
      noise: 'Gürültü',
      traffic: 'Trafik',
      coverage: 'Hizmet kapsaması',
      crime: 'Suç riski',
      density: 'İmar yoğunluğu',
      access: 'Tek yön erişimi',
    },
    hint: {
      value: 'Altın = değerli. Vergi burada toplanır; parklar ve hizmetler değeri yükseltir.',
      pollution: 'Kızıl = kirli. Fabrikalar ve santraller yayar; konut buradan kaçar.',
      noise: 'Turuncu = gürültülü. Anayollar ve sanayi; ev fiyatını düşürür.',
      traffic: 'Kırmızı = tıkalı. Tıkalı sokak ziyaretçiyi ve malı yavaşlatır.',
      coverage: 'Yeşil = hizmet alıyor, kırmızı = istasyon yetişmiyor.',
      crime: 'Pembe = riskli. Dükkânlar hedef; karakol kapsaması riski düşürür.',
      density: 'Parlak = yoğun imar (beş kat), soluk = normal (üç kat).',
      access:
        'Yeşil = girilip çıkılabiliyor, sarı = girilir çıkılmaz, kırmızı = hiç girilemiyor.',
    },
  },

  inspector: {
    close: 'Kapat',
    level: (level: number, cap: number): string => `Kat ${level}/${cap}`,
    residents: (people: number, capacity: number): string =>
      `${plain.format(Math.round(people))}/${plain.format(Math.round(capacity))} kişi`,
    jobs: (jobs: number, capacity: number): string =>
      `${plain.format(Math.round(jobs))}/${plain.format(Math.round(capacity))} iş`,
    output: (perMinute: number): string => `₺${money.format(Math.round(perMinute))}/dk`,
    upkeep: (perMinute: number): string => `Bakım: ₺${money.format(Math.round(perMinute))}/dk`,
    maxed: 'Bu bina zirvesinde — arsasının izin verdiği en yüksek hâli.',
    growing: 'Bir sorunu yok; sırası gelince büyüyecek.',
    blocker: {
      decay: 'Bu bina geriliyor — böyle kalırsa kat kaybedecek.',
      denseZoning: 'Normal imar üç katta durur. Daha yükseği için yoğun imar boyaman gerek.',
      services: 'Hizmet yetmiyor — kapsama katmanına bak, eksik istasyonu kur.',
      schools: 'Okumuş işgücü yok. Okul bugün, bu ofisin katları iki kuşak sonra.',
      demand: 'Şu an bu türe talep yok — talep çubuklarına bak.',
      pollution: 'Kirlilik bastırıyor. Kaynağı kirlilik katmanında gör.',
      noise: 'Sokak fazla gürültülü — anayolu ya da sanayiyi uzaklaştır.',
      stalled: 'Konum zayıf — yol erişimine, çevresine ve arazi değerine bak.',
    },
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
    lens: 'Veri katmanları',
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
    safeMode: 'Güvenli açılış',
    safeModeHint:
      'Oyun geçen sefer açılırken kapandı, bu yüzden uzakta geçen süre bu ' +
      'seferlik işlenmedi. Şehrin olduğu gibi duruyor.',
    cityShelved: 'Şehir kenara alındı',
    cityShelvedHint:
      'Kayıt üst üste iki açılışta oyunu kapattı, o yüzden yeni bir şehirle ' +
      'başlandı. Eskisi silinmedi — tarayıcı hafızasında duruyor.',
    // The tab's graphics context went away underneath us. Without this the
    // screen simply goes black and stays black, which reads as the game
    // freezing rather than as the browser reclaiming the card.
    gpuLost: 'Ekran kartı bağlantısı koptu',
    gpuLostHint:
      'Tarayıcı çizim bağlantısını kapattı — genelde hafıza darlığından olur. ' +
      'Şehrin kayıtlı; sayfayı yenilemek yeter. Başka sekmeleri kapatmak da yardımcı olur.',
    gpuBack: 'Görüntü geri geldi',
    gpuBackHint: 'Çizim bağlantısı kuruldu. Bir sorun görürsen sayfayı yenile.',
  },
} as const;
