# Kadastro — Ajan Notları (devir dosyası)

Bu dosya, projeyi devralan herhangi bir ajanın/geliştiricinin **bağlam kaybetmeden**
devam edebilmesi için yazıldı. Üç bölüm: (1) şu ana kadar yapılanlar,
(2) mimari kurallar ve tuzaklar, (3) kalan plan.

- **Repo:** `TradersEntertainment/citybuild` (`main`)
- **Canlı:** citybuild-ten.vercel.app — `main`'e push = Vercel otomatik deploy
- **Stack:** Vite + TypeScript (strict, `exactOptionalPropertyTypes`) + three.js + zustand + vitest
- **Doğrulama:** `npx tsc --noEmit` → `npx vitest run` → `npm run build`
- **Test durumu (40b22ef0 itibarıyla):** 33 dosya / 423 test, yeşil

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
4. **Kaydetme şeması değişmez** (`state/persistence.ts`); yan veri transient
   ya da localStorage (`state/history.ts` kalıbı).
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

### Doğrulama reçetesi (puppeteer)
`evaluateOnNewDocument` ile `localStorage`'a `kadastro.introSeen=1`,
`kadastro.coachDone=1` yaz → intro'yu atla. `window.__kadastro` üzerinden
state kur/oku, `page.screenshot` ile gözle doğrula. Sandbox'ta swiftshader
~1fps: bekleme sürelerini bol tut, "takıldı" sanılan şey çoğu zaman sadece
yavaşlıktır (yanılgıya düşme).

---

## 3. Kalan plan — "Yaşayan Şehir"

Detaylı spec: depodaki plan çıktısının kaynağıyla aynıdır; aşağıdaki özet
yeterlidir. Her madde bağımsız uygulanabilir; önerilen sıra baştan sona.

### Paket 1 — Yaşayan Sokaklar (önce bu)
1. **Yayalar** (`render3d/pedestrians.ts`, sim'e dokunma): trafik katmanının
   iskeletini kopyala; 2-kutu insan figürü instanced mesh; ev↔iş bacakları;
   kaldırım = yola komşu bina-olmayan karo; sayı `min(180, pop/30)`;
   LOD mesafesi üstünde çizme.
2. **Gün döngüsü** (`sim/daytime.ts` + test): `dayFraction(playedMs)`
   (gün = 120 sn), gece/gündüz/rush-hour; `sky.ts` güneşi döndürür, gece
   shader'ı (koyu gradyan + yıldız), `FrameInput`'a `dayFrac`.
3. **Gece ışıkları**: bina cephe glow instanced mesh (`nightAmount` uniform'u
   paylaşımlı modülde); `render3d/streetlights.ts` (çağa göre lamba rengi:
   <1950 gaz lambası, ≥1950 ampul, ≥2035 LED); araba farları ikinci instanced mesh.
4. **Ortam sesler** (`audio/ambient.ts`): prosedürel (asset yok) şehir
   uğultusu/kuş/dalga/cırcır; `setScene(pop, isNight, zoom)` 1 sn throttle;
   `sfx.enabled`'a saygı.

### Paket 2 — Çağın Ruhu
5. **Araç evrimi** (`render3d/traffic.ts`): <1920 at arabası/kağnı (hız ×0.5),
   1920–60 erken otomobil (×0.7), 1960+ mevcut, 2050+ uçan (var).
6. **Hava durumu** (`sim/weather.ts` + test, seeded zar; `render3d/weatherFx.ts`):
   yağmur (yangın ×0.4 yayılma, çiftlik ×1.2), fırtına (+itfaiye ×0.7),
   sıcak (tutuşma ×1.6), sis (görsel). Bildirim `eventFeed.pushCustom`.

### Paket 3 — Derinlik
7. **Vatandaşın sesi** (`sim/petitions.ts`): `diagnose()` issue'larını say,
   %22 üstü dilekçe olayı → feed + günlük; karşılanınca mutluluk +3.
8. **Mevsimler** (`sim/seasons.ts` + test): 10 sn/mevsim; ağaç/arazi tint
   uniform'u; kış kar overlay'i; çiftlik kışın ×0.7.
9. **İnşaat animasyonları**: `growthProgress<0.6` iskele, <1 yarım bina;
   level≥3'te 20 sn vinç.
10. **Doğa**: kuş sürüleri (gündüz), balık sıçraması, ağaç salınımı.
11. **Takvim ritüelleri** (`data/timeline.ts`'e `recurring`): 23 Nisan /
    29 Ekim bayrakları, yılbaşı havai fişek, bayramlar (mutluluk bonusu);
    hepsi günlüğe düşer.

### İş akışı (her özellik)
Sim varsa önce test → `tsc` temiz → `vitest run` 423+ yeşil → `build` →
puppeteer ile gözle doğrula → Türkçe tek satır commit. Paket sonunda canlıda
oyna ve his kontrolü yap.
