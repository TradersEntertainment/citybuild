# Kadastro — Ajan Notları (devir dosyası)

Bu dosya, projeyi devralan herhangi bir ajanın/geliştiricinin **bağlam kaybetmeden**
devam edebilmesi için yazıldı. Üç bölüm: (1) şu ana kadar yapılanlar,
(2) mimari kurallar ve tuzaklar, (3) kalan plan.

- **Repo:** `TradersEntertainment/citybuild` (`main`)
- **Canlı:** citybuild-ten.vercel.app — `main`'e push = Vercel otomatik deploy
- **Stack:** Vite + TypeScript (strict, `exactOptionalPropertyTypes`) + three.js + zustand + vitest
- **Doğrulama:** `npx tsc --noEmit` → `npx vitest run` → `npm run build`
- **Test durumu (`0ec2e8e` sonrası):** 50 dosya / 649 test, yeşil

---

## 1. Yapılanlar (kronoloji)

### Faz 7 ve öncesi (commit `2bb5060d`'e kadar)
Çekirdek oyun: yol/bölge/hizmet inşası, büyüme-çürüme simülasyonu, ekonomi,
mutluluk, göç, era sistemi (kamp→köy→kasaba→şehir→metropol), görevler,
teknoloji ağacı, parsel genişleme, **ulusal otoyol** (haritayı boydan boya
geçen devlet yolu; şehir ona bağlanarak büyür), il/ilçe isimli mahalleler,
offline ilerleme, kaydetme sistemi, koç (öğretici) ve giriş ekranı.

### Commit `b3da3e9d` — bağlantı, kaos, tarih
- **Otoyol bağlantı kuralı** (`sim/connectivity.ts`): otoyola bağlı olmayan
  yol işe yaramaz — soluk çizilir, kenarında bina büyümez, göç gelmez.
  BFS, otoyola komşu yollardan tohumlanır; otoyol yoksa hepsi bağlı sayılır.
- **Kaos sistemi** (`sim/hazards.ts`): yangınlar (tutuşma, yayılma, itfaiye
  kapsamasıyla sönme, yanıp yıkılma) ve salgınlar (hastane kapsamasına göre
  şiddet/süre). Deterministik: zarlar `seed ^ hazardTick` ile üretilir.
  Offline'da kaos işlemez (`hazardsLive=false`). Olay bildirim şeridi
  (`ui/eventFeed.ts`) + alarm sesi.
- **Tarih şeridi** (`data/timeline.ts`, `sim/timeline.ts`): 1900'de kuruluş,
  40 sn = 1 yıl, üst barda yıl rozeti. 16 tarihi olay: 1914 seferberlik
  (gençler cepheye — nüfus akışı), 1918 İspanyol gribi, 1923 Cumhuriyet,
  1929 Buhran, 1939–45 savaş ekonomisi, 1948 Marshall, 1960'lar kırdan göç,
  1999 depremi (deterministik — her cihazda aynı binalar), 2001 krizi,
  2020 pandemi, **2050 uçan arabalar**, **2065 yörünge mekikleri**.
  Etkiler çarpan olarak sim'e işler (göç/gelir/mutluluk/askere alma).
- **Hassas silme:** dokun = tek karo, sürükle = fırça (`input/tools.ts`).
- **Menü katman düzeltmesi:** il/ilçe etiketleri menüyü örtmüyor
  (`.bar` z-2, `.district-labels` z-1) + buton hover/basma hissi.

### Commit `40b22ef0` — gezme, günlük, itfaiye aracı, trafik düzeltmesi
- **3D gezme modu** (`render3d/walkMode.ts` + saf `walkPhysics.ts` +
  `ui/walkHud.ts`): sağdaki 🚶 butonu kamerayı kaldırım seviyesine indirir.
  WASD/ok tuşları + Shift; dokunmatikte sanal joystick; sürükle = bakış;
  Esc = çık. Daire-karo çarpışma (duvardan kayma), bina/su/tesis engeli,
  en yakın yürünebilir karoya bırakma. `renderer.externalCameraControl`
  bayrağı rig'in kamerayı geri almasını engeller.
- **Tarihçe günlüğü** (`state/history.ts` + `ui/historyPanel.ts`): olaylar
  ve era geçişleri localStorage'a yazılır (kayıt şemasına dokunulmaz);
  📜 butonu paneli açar, yeniden→eskiye, hikâye metinleriyle.
- **12 yeni tarihi olay** (toplam 28): Çanakkale 1915, demiryolu 1934,
  çok partili hayat 1946, sanayileşme 1955, petrol krizi 1974, özel TV 1990,
  94 krizi, akıllı telefon 2010, 2023 depremi, iklim göçü 2030, yapay zekâ
  2042, Ay üssü 2075. Her olayın `detail` hikâye metni var.
- **İtfaiye aracı sevki:** yangında en yakın istasyondan BFS ile rota
  (`fire.truck.path`), sim ilerletir (`progress`), renderer kırmızı kasa +
  yanıp sönen ışık çizer; varınca ekip süresi (`FIRE_TRUCK_DWELL_S`) boyunca
  alev küçülür, sonra söner. Yol yoksa `truck=null` → eski zamanlayıcı.
- **TRAFİK KOORDİNAT BUG'I:** arabalar `pose - WORLD_HALF` ile çiziliyordu;
  arazi/bina/yol tile-space olduğu için filo yarım harita ötede görünüyordu
  ("arabalar şehrime gelmiyor"). Düzeltildi — her şey tile-space.
- **Intro PC düzeltmesi:** kısa/ölçekli ekranlarda "Başla" butonu taşıyordu;
  kart kaydırılabilir + Esc ile geçiş.
- **Debug handle:** `window.__kadastro = { game, camera, walk, enterWalk, exitWalk }`.

### "Yaşayan Şehir" paketleri — **tamamlandı**
Aşağıdaki §3'te plan olarak duran maddelerin hepsi yapıldı. Kısaca:
- **Paket 1:** yayalar (`render3d/pedestrians.ts`), gün döngüsü (`sim/daytime.ts`),
  gece ışıkları + sokak lambaları (`render3d/streetlights.ts`), ortam sesi
  (`audio/ambient.ts`). **Sapma:** gün = `SECONDS_PER_DAY = 40`, yani bir yıl
  bir gün — plan 120 diyordu, o üç yılı tek gündoğumuna sıkıştırırdı.
- **Paket 2:** araç evrimi (`data/vehicles.ts`), hava durumu (`sim/weather.ts`
  + `render3d/weatherFx.ts`).
- **Paket 3:** dilekçeler (`sim/petitions.ts`), mevsimler (`sim/seasons.ts` +
  `render3d/seasonLook.ts`), şantiye (`render3d/construction.ts`), doğa
  (`render3d/wildlife.ts`), takvim ritüelleri (`data/rituals.ts` +
  `sim/rituals.ts`). **Sapma:** ağaç salınımı yapılmadı — on binlerce
  instance'ın matrisini her kare yazmak, en pahalı ve en görünmez iş.

### Paketlerden sonra eklenenler
- **Müzik** (`audio/music.ts`): prosedürel, dosyasız. Beşli dizi, çağa göre
  mod, ~2 dk çalar ~2,5 dk susar. Sessizlik kasıtlı ve ayarın en önemlisi.
- **Kamera:** WASD/oklar + Q E R F (`input/keyboardCamera.ts`), orta tuş
  sürükler / sağ tuş çevirir (`bindMouseCamera`), ✋ kilidi tek parmakla
  kaydırır (`panLocked` in `main.ts`).
- **Savaş yolu bozuyor** (`sim/highwayWear.ts`): otoyol 24 karelik kesimlere
  bölündü; savaşta sahip olunan araziden geçen kesimler aşınır, %55'te devlet
  fatura keser, %100'de barikat. Barikatlı kesim bağlantı tohumu vermez ve
  kavşak saymaz — ceza mevcut kuraldan geliyor. Aşınma **kayıtta** (opsiyonel
  alan; eski kayıtlar sağlam yol olarak açılır).
- **Köprüler** (`render3d/roadDeck.ts` + `bridgeGeometry.ts`): yol karoları
  arazi yüksekliğini okuyordu, yani suyu geçen her yol **deniz tabanında**
  çiziliyordu. Güverte + kıyı rampası + plaka/korkuluk/ayak. Asfalta binen
  her katman artık `sampleRoadHeight` okuyor.
- **Denize yatırım** (`data/ports.ts` + `sim/ports.ts`): balıkçı barınağı,
  liman, tersane, marina. Kıyıya kurulur, önünde açık su şart. Liman
  `world.seaGate` yazar ve connectivity oradan da tohumlar — otoyol kapansa
  bile şehir bağlı kalır. Gemiler: `render3d/ships.ts`.
- **Otobandan şehre giriş** (`sim/visitors.ts`): geçen trafiğin bir kısmı
  kavşaktan sapıp sokaklara yayılıyor, her karede seyreliyor, kuyrukta daha
  hızlı seyreliyor; dükkânlar ona satıyor. Eski sabit `highwayTradeFactor`
  bonusu yerini buna bıraktı (fallback olarak duruyor: alan verilmeyen
  çağrılar için). Renderer'da araçlar gerçekten sapıp park ediyor.

- **Belediye yatırımları** (`data/investments.ts` + `sim/investments.ts`):
  paranın gideceği yer ve gecenin cevabı. Aydınlatma / ağaçlandırma / şenlik,
  kademeli, bir kez alınır her yere işler satılamaz. **Gecenin artık mekanik
  etkisi var:** karanlıkta dükkânlar kapanır ve kimse otoyoldan sapıp ışıksız
  şehre girmez; lamba bunu geri alır. Kalibrasyon türetilmiş, elle yazılmamış —
  `MEAN_NIGHT` gün eğrisinden örnekleniyor ve `DAY_TRADE_UPLIFT` onu geri
  ödüyor, yani **ışıksız şehrin günlük ortalaması tam olarak eskisi**. Bu
  özellik nerf değil, fırsat. Fiyat dik, gider hafif; asıl ayar **çağ
  kilitleri** — köyde korunacak ticaret yok, hiçbir fiyat geri ödemezdi.
  Ölçüm: tam aydınlatma kişi başı ~0.1 ₺/dk getiriyor.
- **Tek yönlü yollar** (`sim/oneWay.ts`): oyuncunun fikri. `world.oneWay`
  sütunu (kayıtta, RLE), yol sayfasında "tek yön" anahtarı, yön çizim
  yönünden geliyor. Kural tek yerde: ok, kendisine **karşı** gitmeyi
  yasaklar — üstünden geçmeyi ya da sapmayı yasaklamaz. Yük yayılımı,
  ziyaretçi dalgası ve araç pathfinder'ı aynı `canTravel`'ı soruyor.
  Ölçüldü: tıkanmış şehirde tek yön çifti kazandırıyor (net 2205→2466),
  rahat şehirde kaybettiriyor (2678→2386), ters yönde felaket (ziyaretçi 0).
  Yani gerçek bir karar, bedava yükseltme değil.

### Oyuncu geri bildirimi — 1. tur

Sandbox'ın göremediği iki şey oyuncudan geldi. İkisi de gerçekti ve ikisi de
**ölçülünce tahminden çok daha kötü** çıktı. Ders: bir sayı "makul görünüyor"
diye doğru değil; çarpan yığınıyla birlikte ölçülmediyse ölçülmemiştir.

- **"Gecede ekran hiç gözükmüyormuş."** Ölçüldü: gece, öğlenin **%0.4'ü**.
  `sun.intensity = SUN_INTENSITY * daylight` güneş ufka değer değmez sıfır
  oluyordu, geriye lacivert boyalı tek bir 0.34 hemisphere ışığı kalıyordu —
  yön ışığı yok, yani gölge yok, aydınlık yüz yok, siluet yok. Tek çare olan
  aydınlatma programı **kasabada** açılıyor, yani her oyunun açılışı ışıksız
  oynanıyordu. Düzeltme: ay (anti-güneş yönünde bir yön ışığı, gölge de
  atıyor), yükseltilmiş gece ambient'ı, açılmış gece renkleri ve ufuk
  geçişindeki çukuru dolduran bir alacakaranlık takviyesi. Gece artık öğlenin
  **%24'ü**; en karanlık an (şafak öncesi) %19.
  **Aydınlatma programı artık "görmek" ile "görmemek" arasındaki fark değil,
  gecenin *satın alınmış* görünmesi.** Okunabilirlik ödül değil, taban.
- **"Hırsızlık çok fazla, güçlenemiyorum."** Ölçüldü: karakolsuz bir kasaba
  (273 bina) dakikada 4.6 suç ve 1 382 ₺ kayıp yaşıyordu; şehrin **tüm geliri**
  625 ₺/dk. Yani suç kazancın **%221'ini** alıyor, bakiye hep düşüyor ve onu
  durduracak 5 400 ₺'lik karakol asla alınamıyordu — tanımı gereği tuzak.
  Yarısı kaplı şehirde bile %119. Eski `CRIME_PER_SEC` yalnız taban oran
  düşünülerek yazılmıştı; üstündeki gece × sefalet × kasa çarpanları (sağlıklı
  şehirde ~1.8×, mutsuzda ~2.4×) hiç hesaba katılmamıştı. Yeni değerlerle
  ölçüm: köy %8, karakolsuz kasaba %31, tek karakollu kasaba %18, üç karakollu
  şehir %7 — ve fixtureların nüfusu 158→337, 13→54, 10→264, 0→351.
- Her ikisi de artık regresyon testi: `tests/night.test.ts` (ışık eğrisi) ve
  `tests/runaway.test.ts` → "crime is a bill the city can pay". İkisinin de
  eski sayılarla **düştüğü doğrulandı**; düşmeyen test testi değildir.
- **"Out of Memory" ile sekme ölüyor.** Sunucuyla ilgisi yok — Vercel statik
  dosya sunuyor, ölen tarayıcı sekmesi. Bulunan sızıntı `render3d/buildings.ts`
  ve `render3d/stations.ts`'te aynı şekilde duruyordu: kapasitesi dolan bir
  `InstancedMesh` iki katına çıkarılırken **arketipin tamamı yeniden
  üretiliyordu** — iki CanvasTexture, iki materyal, bir geometri — ve yalnızca
  mesh `dispose` ediliyordu. WebGL kaynakları çöp toplanmaz, üstelik eskiler
  yalnızca teardown'da boşaltılan dizilere ekleniyordu: yani her ikiye katlama
  kalıcıydı. Çözüm: şekil (`Kit`) kapasiteden ayrıldı; büyütmek artık sadece
  yeni bir mesh yapıp eskisini atıyor.
  **Aynı yerde ikinci bir hata:** büyüyen kova sayacı sıfırlıyordu, yani o kare
  boyunca daha önce yazılmış her instance kayboluyordu — ölçüldü, 1 000 evden
  **232'si** çiziliyordu. `issues.ts` ve `stations.ts`'te aynı hata identity
  matrisle kalıyordu, yani markerlar bir kare boyunca **(0,0) karesinde** üst
  üste yığılıyordu. Üçünde de instance tamponu artık taşınıyor.
  Test: `tests/meshLeaks.test.ts`. Facade dokuları `<canvas>` istediği için
  üretici enjekte edildi — o dikiş sırf bu test için var.
  **Dürüstlük notu:** sızıntı gerçek ve düzeltildi, ama oyuncunun çökmesinin
  *tam olarak bu* olduğu kanıtlanmadı; sandbox'ta swiftshader zaten düzeltmeden
  önce de sonra da ara ara çöküyor. Düzeltmeden sonra 220 saniyelik ölçümde
  Chromium RSS ~1.5 GB'da **düz**, geometri/doku sayıları sabit.
### Ofis bölgesi (§19): okulların karşılığı

Eğitim sistemi hep vardı ve hep bir şey yapıyordu — her gelire küçük bir çarpan
— ama oyunda eğitim *olan* bir şey yoktu. Ofis o zincirin ucu: en pahalı arsa,
mal istemez, kirletmez, konutun yanında durur, en çok vergiyi öder — ve
işgücünün ciddi bir kısmı okula gitmeden **zemin katın üstüne çıkmaz**. Bugün
okul, iki kuşak bandı sonra ofis: oyundaki en uzun sebep-sonuç.

Yeni bir `ZoneKind` eklemenin asıl tehlikesi sim değil **kayıt**: bölge kodu
`ZONE_ORDER`'daki indeks + 1. Araya eklemek, kayıtlı her şehrin sanayisini park
diye geri yüklerdi — sessizce, hatasız, geri dönüşsüz. Bu yüzden `ZONE_ORDER`,
`save.ts`'teki `ZONES` ve `render3d/buildings.ts`'teki `ZONES` **sadece sona
eklenir**; `tests/office.test.ts` ilk olarak bunu sabitliyor.

İkinci tuzak `demand`: nesne bir anahtar kazandı, eski dosyada üç tane var.
Doğrudan `state.demand = { ...data.demand }` yapmak `demand.office`'i
`undefined` bırakıyordu ve o da suitability toplamına **NaN** olarak giriyor —
bir tick içinde şehirdeki her puana yayılırdı. Artık taze state'in kendi
varsayılanının üstüne yayılıyor.

Ölçüm (aynı şehir, 3 000 sn): okulsuz ofis şehri 3 490 ₺/dk vergi, 74 ofisin
hepsi 1. kademede (296 iş = tam olarak 74 × 4). Okullu 6 698 ₺/dk ve 1 107 iş.
Yani okul, ofis gelirini **iki katına** çıkarıyor. Ledger'da kendi dalı var —
öncesinde `else` sanayiye düşüyordu, yani ofis sanayi vergisiyle
vergilendirilip kamyonlara satış yapıyordu.

### Yoğunluk: iki tasarım ölçülerek elendi (§19)

Ölçmeden seçilmiş bir eşik, olmayan bir özellik demek. İkisi de böyle öldü:

1. **Suitability'den dilim kesmek.** Hizmetsiz yoğun arsanın puanı doğuş
   eşiğinin altına düşüyordu, yani **hiçbir şey kurulmuyordu**: oyuncu dört
   katı fiyat ödeyip boş araziye bakıyor ve kimse ona sebebini söylemiyor.
   Klasik "sessiz hata oyunu bozuk gösterir" tuzağı. Doğru olan *doğuşu* değil
   *büyümeyi* engellemek: bina kurulsun, üç katta kalsın — aynı bilgi, görünür
   yerde.
2. **0.62'lik suitability eşiği.** Tam hizmetli bir şehirde ölçüldü: en iyi
   arsanın puanı **0.470**, doğuş eşiği 0.45. Eşik erişilemezdi, yani yoğun
   imar saf para yakma olurdu. Suitability yedi ağırlıklı terimin karışımı ve
   içinde global talep var; tavanı tahmin edilecek şey değil.

Kalan tasarım: **hizmet kapsaması ≥ 0.8**. Tavanı yapısı gereği 1.0, oyuncunun
kaplama katmanında zaten gördüğü birim, ve kuralı tek cümlede söylenebiliyor —
"merkezine hizmet götür". Çağın beklemediği hizmet sayılmıyor, yani köyde yoğun
imar sırf fiyatıyla beşe çıkıyor; bu bilinçli, "oyuncuyu yapamayacağı şeyden
sorumlu tutma" kuralının aynısı.

Ölçüm (hizmetli şehir, 2 400 sn): normal 6 497 konut / 2 618 iş, hepsi 3.
kademede; yoğun 8 468 konut / 3 131 iş, **15 tane 4. ve 103 tane 5. kademe**.
Yani karar gerçekten ödüyor: +%30 konut, +%20 iş, ve bir siluet.

**Eski kayıtlar affedildi.** Density'den önce kaydedilmiş her şehir hizmetinin
elverdiği kadar yükselmişti; kuralı geriye dönük uygulamak, güncellemeden
sonraki ilk tick'te oyuncunun diktiği her kuleden kat sökmeye başlardı.
`deserialize` üçüncü kademenin üstündeki her binanın altını yoğun işaretliyor.

- Ölçüm aracı kalıcı: `window.__kadastro.resources()` üç sayıyı veriyor
  (geometri, doku, program). Bunların bir şehir oturduktan sonra düz durması
  gerekir; tırmanan biri sızıntıdır. Profiler'ın JS heap'i bunu **göstermez**.

---

## 2. Mimari kurallar ve tuzaklar (bozma)

```
src/sim/       Saf, deterministik mantık — three.js import YASAK
src/render3d/  three.js çizim — sim'i OKUR, asla YAZMAZ
src/data/      balance.ts (sayılar), strings.tr.ts (metinler), timeline.ts
src/ui/        DOM HUD/paneller      src/state/   store, persistence, history
tests/         vitest — sim tarafındaki her özellik için test ZORUNLU
```

1. **`src/sim` altında `Math.random` YASAK.** Seeded rng:
   `createRng(state.seed ^ Math.imul(stepNo, 0x9e3779b1))`.
2. **Render read-only.** Gerçek sim'de yaşar; renderer her frame okuyup çizer.
3. Sayılar `balance.ts`'e, metinler `strings.tr.ts`'e.
4. **Kaydetme şeması bozulmaz — ama toplanabilir.** `SAVE_VERSION` bump
   ETMEDEN alan eklemenin kalıbı var ve dört kez kullanıldı (`loans`,
   `services`, `utilities`, sonra `highwayWear` ve `ports`): alanı
   `SaveData`'ya ekle, `serialize`'da yaz, `deserialize`'da **savunmalı** oku
   (`Array.isArray(data.x) ? data.x : []`) ve yorumda "alanı olmayan dosya
   şu demek" yaz. Türetilmiş veri hiç kaydedilmez (`connected`,
   `highwayBlocked`, `highwayDamage`, `seaGate`); yükledikten sonra yeniden
   hesaplanır. Kalıcı olması gereken yan veri localStorage'a
   (`state/history.ts`).
5. **KOORDİNAT: her şey tile-space (0..256). `WORLD_HALF` çıkarma YASAK** —
   trafik bug'ının kökü buydu. Yeni katmanı mevcut birinden kopyala
   (örn. `render3d/hazards.ts`).
6. z-index: `.bar`=2, `.district-labels`=1, walk-hud=6, history-panel=8,
   coach=9, intro=10, event-feed=12 (pointer-events:none).
7. Era: `eraReached(state.era, 'village')`; yıl: `yearOf(state.playedMs)`;
   `START_YEAR=1900`, `SECONDS_PER_YEAR=40`, `FLYING_YEAR=2050`, `SHUTTLE_YEAR=2065`.
8. **Hoisted function declaration içinde daraltılmış const null görünür** —
   closure'da `ui!` kalıbı bu yüzden var.
9. **Console'dan sahne kurarken:** `state.buildings`'e elle bina eklersen
   `world.zone[i]`'yi de ayarla (res=1, com=2, ind=3) yoksa ilk growth pass'te
   yıkılır. `buildRoad` sadece sahip olunan parselde çalışır; başlangıç parseli
   144–191 (`PARCEL_SIZE=48`, `startingCentre={168,168}`).
10. **Event feed CSS'i:** `animation ... forwards` YASAK (takılı kalıyor);
    görünür-başla + `from` keyframe (`.event-entry` kalıbı).
11. Test fixture kalıpları: `stripHighway(game)` (otoyolu kaldırır),
    `systems.step(game, dt, false)` (kaos kapalı), `scripted([...], fallback)` zar.
12. **Gezme modu:** `renderer.externalCameraControl = true` olmadan rig
    kamerayı geri alır; çıkarken `CAMERA_NEAR` geri yüklenir (yürürken 0.04).
13. Dengeler iki tur yumuşatıldı (`FIRE_*`, `EPIDEMIC_*`) — sertleştirme.
14. **`computeConnectivity` her şeyden önce.** Yol ekledikten sonra
    `computeRoadDistance` o yolu göremez, çünkü mesafe sadece *bağlı*
    sokaklardan ölçülüyor. Sıra: `refreshSeaGates` → `computeConnectivity` →
    `computeRoadDistance` → `computeTraffic` → `computeVisitors` →
    `computeLandValue` → kapsama. (`Systems.step` bu sırayı tutuyor; testte
    elle kurarken aynısını yap.) Bu tuzağa iki kez düştüm.
15. **`paintZone(world, tiles, kind, budget)`** — `state` değil `world` alıyor
    ve fırça boyutu almıyor; kareleri sen üret. Ayrıca ekonomi `world.zone`
    sütununu sayıyor, `state.farmTiles`'ı ayrı: elle boyarsan ikisini birlikte
    güncelle yoksa çiftlik geliri sıfır kalır.
16. **Yeni şehir `playedMs = 0`, yani 1 Ocak — ve 1 Ocak bir bayram**
    (`sim/rituals.ts`, mutluluk bonusu var). Saati hiç ilerletmeyen test
    fixture'ları o pencerede sonsuza kadar oturur ve dosyadaki her mutluluk
    iddiasını sessizce yukarı çeker. `tests/hazards.test.ts`'teki
    `ORDINARY_DAY_MS` kalıbını kullan.
17. **Asfalta binen katman `sampleRoadHeight` okur, `sampleHeight` değil**
    (`render3d/roadDeck.ts`). Toprağa oturan (bina, ağaç, istasyon) araziyi
    okur. Karıştırırsan araç köprünün altından geçer.
18. **Bir binaya sokak trafiği için para veren her şey `nearestRoad`
    kullanmalı** (artık `sim/traffic.ts`'ten export). İki farklı "hangi
    sokağın önündeyim" cevabı, dükkânı üstünde olmadığı sokak için ödemek
    demek.
19. **`plotRoute`'a dokunmak `SAVE_VERSION` bump'ı gerektirir.** Rota kayıtta
    değil, tohumdan yeniden üretiliyor — yani üretici değişirse mevcut şehirler
    kendi sokaklarıyla kalıp otoyolu başka yerde bulur: kavşaklar gider,
    mahalleler sessizce kopar, ekranda sebebi yazmaz. v5 tam bu yüzden.
20. **Rota 4-bağlantılı olmak zorunda** (connectivity BFS, yük yayılımı, trip
    injection hepsi dört yönlü okuyor) — yani her viraj tek karelik bir
    dirsektir ve zikzağın ölçüsü *viraj sayısıdır*, dirsek oranı değil. İlk
    ölçümümde bunu karıştırdım: "%49 tek karelik koşu" yapısal, anlamlı sayı
    "100 karede kaç viraj" (39–71'den 12'ye indi, `HIGHWAY_MIN_RUN`).
21. **`drainPopulation` manşet sayıyı güncellemez.** Evleri boşaltır, ama
    `state.population`'ı yeniden hesaplamaz — `refreshPopulation(state)`
    (`sim/hazards.ts`) çağırmak *çağıranın* işi. Kohortlarda bir adımlık
    kalıcı kayma olarak yaşandı; her uzlaştırma bu farkı "yeni gelenler"
    diye okudu.
22. **`refreshPopulation` binaları otorite yapar.** Fixture'da sadece
    `state.population = N` yazmak bir adım sonra geri alınır; insanları
    binalara dağıtmak gerekiyor (`tests/cohorts.test.ts` içindeki
    `resettle`).
23. **Çevrimdışı yol 30 adımda ilerliyor** (`OFFLINE_STEPS`), yani bir saat
    120 saniyelik adımlar demek. Bu yüzden `dt`'ye bağlı her şey iki yolu
    ayırır. Kurallar:
    - Akış oranları üstel olsun (`1 - exp(-dt/T)`), `dt/T` değil.
    - Bir **stok**tan (boş konut, birikmiş çöp) pay kesen şey kaba adımda
      daha sert kırpılır — oranı yumuşak bir rampayla ölçekle, stoku
      doğrudan okuma.
    - Birikimler (`awaitingBurial`, `rubbish`) `hazardsLive` ile kapılı
      olmalı: `offline.ts`'in kendi kuralı, "uzakta geçen zaman kazandırır,
      yıkmaz". Ölçüldü: defin birikimi yüzünden bir saat %14 küçük döndü.
24. **Yeni bir hizmet türü eklemek yedi dosyaya dokunur:**
    `data/services.ts` (spec + ORDER), `sim/tiles.ts` (SERVICE biti),
    `data/strings.tr.ts` (isim), `render3d/stations.ts` (LOOKS) — ve
    tsc bunların hepsini yakalar, o yüzden derleyiciye güven.
25. **Aynı kutuyu üçüncü kez yazma:** `render3d/boxMesh.ts` var
    (`pushBox` / `pushColouredBox` / `pushTriangle` / `toMeshGeometry`).
    Ters sarılmış yüz dışarıdan görünmez içeriden siyahtır — arketip
    çatılarında bir kez yaşandı.

### Doğrulama reçetesi (puppeteer)
`evaluateOnNewDocument` ile `localStorage`'a `kadastro.introSeen=1`,
`kadastro.coachDone=1` yaz → intro'yu atla. `window.__kadastro` üzerinden
state kur/oku, `page.screenshot` ile gözle doğrula. Sandbox'ta swiftshader
~1fps: bekleme sürelerini bol tut, "takıldı" sanılan şey çoğu zaman sadece
yavaşlıktır (yanılgıya düşme).

---

## 3. Kalan plan

"Yaşayan Şehir" paketlerinin **hepsi yapıldı** (§1'deki listeye bak). Bu bölüm
artık bundan sonrası için.

### Faz 8 — "yaşayan şehir" derinliği (Cities: Skylines listesi)
Oyuncunun otuz maddelik listesinden yapılanlar:

- **Nüfus kohortları** (`sim/cohorts.ts`) — çocuk/genç/yetişkin/yaşlı
  bantları. İş gücü artık *ölçülüyor*, varsayılmıyor; okul bir nesil sonra
  ödüyor; ölüm dalgaları akışın kendisinden çıkıyor. Kişi başı ajan
  simülasyonu **bilinçli olarak yapılmadı** — yüz bin kayıt tarayıcıda
  dönmez; dört sayı neredeyse aynı şeyi veriyor.
- **Mezarlık** ve **çöp toplama** (`sim/rubbish.ts`) hizmetleri. Çöp,
  salgının hiç sahip olmadığı *sebep*: artık oyuncu olmadan önce
  müdahale edebiliyor.
- **Yeraltı kaynakları canlandı** (`sim/resources.ts`) — kömür/demir/taş/kil
  ilk fazdan beri her haritada üretiliyordu ve *hiçbir şey okumuyordu*.
  Sanayi damarın üstünde daha çok kazanıyor, damar tükeniyor, tükenmişlik
  kaydediliyor (yoksa sekmeyi kapatmak madeni doldururdu).
- **Park arazi değeri veriyor** — zincirin ilk halkası eksikti.
- **Altı elektrik üretim yolu**, iki tanesi su kıyısı istiyor.
- **On üç araştırma**, her birinin `sim/` içinde tam bir tüketicisi var.
- **Zaman kontrolü** (duraklat/0.5×/2×/4×) ve **suç + polis sevki**.

İkinci turda eklenenler:

- **Toplu taşıma** (`sim/transit.ts`) — hattı parmakla çiziyorsun, duraklar
  aralıkla kendiliğinden diziliyor, çevresindeki binalar yolculuklarının bir
  kısmını yola değil hatta bindiriyor. Kapasitesi var: dolan hattın cevabı
  ikinci hat. Yol ağını *boşaltmıyor*, hafifletiyor — yol bu oyunun enstrümanı.
- **Sanayi–ticaret zinciri** (`sim/goods.ts`) — atölyeler yola sandık koyuyor,
  sandık mesafeyle ve kuyrukla eriyor, mağaza ulaşanı satıyor. Liman fazlayı
  ihraç ediyor (port sisteminin adında olan ama hiç yapmadığı şey).
- **Birim bütçeleri** (`sim/budgets.ts`) — altı birim yarım ile bir buçuk kat
  arası. Yarıçap bütçenin *karekökü* ile ölçekleniyor: kapladığı alan parayla
  aynı hızda büyüsün diye. Düz ölçeklemek bedava yükseltme olurdu.
- **Seçim** (`sim/elections.ts`) — beş yılda bir, zar yok. **Kaybetmek oyunu
  bitirmiyor**: şehir de para da harita da kalıyor, giden sadece ödenek.
- **Gece trafiği** — araç sayısı artık saate bağlı (`streetActivity`), yayalarla
  aynı eğri.

Listeden **yapılmayanlar** ve nedenleri §3'ün sonunda.

### Sırada duran, başlanmamış
1. **Otoyol genişletme.** Devlet yolu tek şerit; oyuncu para verip
   genişletebilse "faturayı öde" mekaniğinin olumlu kardeşi olurdu.
2. **Turizm/otel.** Ziyaretçi alanı var ama ziyaretçi *kalmıyor*. Marina ve
   ziyaretçi akışının kesiştiği yerde otel = gecelik gelir.
3. **Tek yön için görsel geri bildirim.** Ok işaretleri var; eksik olan
   "buraya giremiyorlar" uyarısı. Ters imzalanmış bir kavşak ziyaretçi
   gelirini sessizce sıfırlıyor — feed'e bir satır hak ediyor.

### Denenmiş ve bilinçli olarak yapılmayanlar (tekrar açmadan önce oku)
- **Ağaç salınımı:** on binlerce instance'ın matrisini her kare yazmak demek.
  Harita yüksekliğinden görünmüyor.
- **Daha yoğun karo ızgarası** (arabaların zikzakı için): zikzak `poseOf`'ta
  karo merkezleri arası düz interpolasyondan geliyordu, çözümü Catmull-Rom
  oldu. Karoyu küçültmek dokumayı küçültür, kaldırmaz — ve karo-indeksli her
  katmanın belleğini dörde katlar.
- **Bireysel ziyaretçi yönlendirme:** betweenness centrality, telefonda çok
  pahalı. Alan yaklaşımı (`sim/visitors.ts`) aynı kararları veriyor.

### İş akışı (her özellik)
Sim varsa önce test → `tsc` temiz → `vitest run` 625+ yeşil → `build` →
Türkçe commit. Büyük adımlarda `main`'e push (Vercel deploy) ve canlıda his
kontrolü — **bunu sandbox yapamaz**, aşağıya bak.

### Listeden bilinçli olarak yapılmayanlar (tekrar açmadan önce oku)
Oyuncunun Cities: Skylines listesindeki her madde bu oyunun ölçeğine sığmıyor.
Sığmayanlar ve nedenleri:

- **Kişi başı NPC simülasyonu** (madde 2, 29). Yüz bin ajanın rotası, günlük
  rutini ve yaşı tek thread'de tarayıcıda dönmez. `sim/cohorts.ts` dört bant
  ile yaşlanmayı, eğitimi ve ölüm dalgalarını *aynı hisle* veriyor.
  Yeniden açacaksan önce onun ne verdiğini oku.
- **Şerit değiştirme, trafik ışığı, kavşak tasarımı** (madde 1). Renderer'da
  gerçek A* var (`render3d/traffic.ts`) ama sim'e geri beslemiyor ve
  bilinçli: sim trafiği bir *alan*, araç değil. Işık eklemek araçları sim'e
  taşımak demek.
- **Mod desteği** (madde 30). Ayrı bir ürün.
- **Yağmur suyu / kanalizasyon ağı, su fiziği** (madde 5, 6, 32). Ayrı bir
  şebeke katmanı; su/elektrik zaten yol üstünden akıyor, üçüncü bir ağ
  oyuncuya üç kat kurulum işi demek. Değeri ölçülmeden açılmasın.

Henüz **yapılmamış ama sığar** olanlar, tavsiyeyle birlikte:

1. **~~Yoğunluk kademeleri~~ — yapıldı** (`sim/density.ts`). Buradaki itiraz
   yanlış çıktı: pahalı olan `ZoneKind` eklemekti, yoğunluğun kendisi değil.
   Yoğunluk *imar türünden bağımsız* bir şey — `res` yine `res`, yanına bir
   `world.density` sütunu kondu (kayıtta RLE, tek yön oklarıyla aynı kalıp),
   böylece koddaki hiçbir `zone === 'res'` değişmedi. Renderer'a da hiç
   dokunulmadı: arketip tabloları zaten beş kademeydi ve beşincisi üç birim
   boyunda gerçek bir gökdelendi — **gökdelen hep vardı, kimse yerini
   seçmiyordu**. Kural tek satır: normal imar üçe, yoğun imar beşe çıkar;
   dördüncü ve beşinci kat da mahallenin gerçekten hizmet almasına bağlı.
   **Ofis de yapıldı** — ve o gerçekten yeni bir `ZoneKind`'dı. Bkz. aşağısı.
2. **Hizmet kapsamasının mesafeyle azalması** (madde 28). İlk bakışta ucuz
   görünüyor, değil: `serviceMask` bit maskesi, yani doğası gereği ikili, ve
   suç/yangın/çöp/eğitim/şebeke hepsi bitleri okuyor. Dereceli yapmak tür
   başına bir Float32Array (~1.5 MB) ve her tüketicinin değişmesi demek.
   Kazancı cila; sırası bunlardan sonra.
3. **Emlak piyasası** (madde 29). Marjinal değeri düşük: kira/fiyat zaten arazi
   değeri + nüfus üzerinden vergiye giriyor, ayrı bir kira akışı yeni bir karar
   getirmiyor. Değerli olan tek parçası — boşluk oranının çöküşü tetiklemesi —
   `suitability` içinde zaten var.

### Sandbox'ın göremediği şeyler (dürüst ol)
Bu ortamda GPU yok: Chromium swiftshader ile ~0.5 fps çiziyor ve
`page.screenshot` çoğu zaman hiç oturmuyor. Yani **hiçbir görsel özellik
gözle doğrulanmadı**: köprü oranları, gemiler, mevsim renkleri, iskele,
kuşlar, ziyaretçi araçları, gece karanlığı, müziğin seviyesi. Hepsinin sayısı
`balance.ts`'te tek satır; oyuncudan geri bildirim geldiğinde orayı ayarla,
kodu değil. Bir özelliğin "çalıştığını" görmediysen öyle söyle.
