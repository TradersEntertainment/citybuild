# KADASTRO — Godot Yeniden Yapım Şartnamesi

> Bu dosya, oyunu **sıfırdan Godot 4.x'te** yeniden yapacak bir geliştiriciye
> (veya bir yapay zekâ ajanına) verilecek tek kaynaktır. TypeScript/three.js
> sürümünün 34.000 satırından damıtıldı: sistemler, sayılar, ve **pahalıya
> öğrenilmiş tuzaklar**. Sayılar tahmin değil — hepsi çalışan bir oyundan.
>
> Kullanımı: baştan sona oku, sonra §14'teki inşa sırasını takip et. Bir sayıyı
> değiştireceksen önce yanındaki gerekçeyi oku; çoğu ölçülerek konuldu.

---

## 0. TEK CÜMLE

**Kadastro bir şehir kurma oyunu değil; şehir *yönetme* ve siyasi strateji
oyunudur. Tezi şudur: popülizm bazen iyi planlamadan çok oy getirir.**

Bu cümle her tasarım kararının hakemidir. Bir özellik "güzel şehir" yapmaya
hizmet ediyor ama "zor siyasi tercih" üretmiyorsa, o özellik bu oyuna ait
değildir.

---

## 1. NE YAPIYORSUN, NE YAPMIYORSUN

### Yapıyorsun
- Yol çiziyorsun, imar boyuyorsun, hizmet kuruyorsun — ama bunlar **oyunun
  kendisi değil, siyasetin malzemesi.**
- Yedi seçmen kesimini idare ediyorsun. Tek bir "mutluluk" sayısı yok.
- Beş yılda bir seçime giriyorsun ve **karşında biri var.**
- Vaat veriyorsun. Vaat bedava, ihanet pahalı.
- Ferman çıkarıyorsun (diktatör menüsü). Şehrin **gizli bir mizacı** var ve
  onu ancak deneyerek buluyorsun.
- Seçimi kaybedince: çekil, tanıma, ya da **darbe yap.**

### Yapmıyorsun (bilinçli, tekrar açmadan önce oku)
- **Kişi başı NPC simülasyonu.** Yüz bin ajanın rotası ve günlük rutini hiçbir
  bütçede dönmez. Dört yaş bandı (§7.2) neredeyse aynı hissi veriyor.
- **Şerit değiştirme / trafik ışığı / kavşak tasarımı.** Sim'de trafik bir
  *alandır*, araç değil. Araçlar sadece görseldir ve sim'e geri beslemez.
- **Ayrı kanalizasyon/yağmur suyu şebekesi.** Su ve elektrik zaten yol üstünden
  akıyor; üçüncü bir ağ oyuncuya üç kat kurulum işi demek.
- **Emlak piyasası.** Kira zaten arazi değeri üzerinden vergiye giriyor;
  değerli olan tek parçası (boşluk oranının çöküşü tetiklemesi) `suitability`
  içinde zaten var.
- **Mod desteği.** Ayrı bir ürün.

---

## 2. GODOT MİMARİ SÖZLEŞMESİ (bunu bozma)

Orijinaldeki tek en değerli karar, saf simülasyonu çizimden ayırmaktı. Godot'ta
karşılığı:

```
res://sim/        Saf GDScript/C#. Node DEĞİL — Resource/RefCounted sınıfları.
                  Sahne ağacına, Node'a, RenderingServer'a erişim YASAK.
                  randi() / randf() / Time.get_ticks_msec() YASAK.
res://view/       Node3D ağacı. sim'i OKUR, asla YAZMAZ.
res://data/       balance.gd (bütün sayılar), strings_tr.gd (bütün metinler)
res://ui/         Control ağacı. sim'i OKUR, komut GÖNDERİR.
res://tests/      GUT veya gdUnit4. sim'deki her özellik için test ZORUNLU.
```

### İhlal edilmemesi gereken beş kural

1. **`sim/` deterministiktir.** Rastgelelik yalnız tohumdan türetilir:
   `RandomNumberGenerator.new()` ile `seed = state.seed ^ hash(key)`. Aynı
   tohum + aynı girdi = aynı şehir, her cihazda.
2. **`view/` salt-okunur.** Her karede sim'i okuyup çizer. Renderer'ın sim'e
   yazdığı tek satır bile, kaydı bozan bir hata sınıfı açar.
3. **Sayılar `balance.gd`'ye, metinler `strings_tr.gd`'ye.** Kodda çıplak sayı
   yok. Denge ayarı tek dosyada yapılır.
4. **Kayıt şeması genişletilebilir, bozulamaz.** Alan eklemek sürüm artırmaz;
   alan **anlamını değiştirmek** artırır. Detay §12.
5. **KOORDİNAT: her şey karo uzayında (0..255).** Dünya merkezi çıkarma,
   yarım-harita kaydırma YOK. Orijinalde en pahalı bug buydu: arabalar yarım
   harita ötede çiziliyordu.

### Godot'a özel çeviriler

| three.js'te | Godot'ta |
|---|---|
| `InstancedMesh` | `MultiMeshInstance3D` (`MultiMesh.use_colors = true`) |
| Chunk'lı arazi (`ArrayMesh` × 64) | `ArrayMesh` × 64, `MeshInstance3D` altında |
| Canvas ile üretilen cephe dokusu | `ImageTexture` (kod ile çizilir) veya `NoiseTexture2D` |
| `Float32Array` alanlar | `PackedFloat32Array` |
| Karo sütunları (`Uint8Array`) | `PackedByteArray` |
| rAF döngüsü | `_process(delta)` çizim, `_physics_process` **kullanma** |
| localStorage | `user://city.save` (`FileAccess` + `var_to_bytes`) |

**Önemli:** MultiMesh'te `visible_instance_count` her kare yazılabilir; bütün
matris tamponunu yeniden yazma. Binalar için tek MultiMesh **per (dönem, imar,
kademe)** = en fazla 60 tampon; bir metropol bile bu kadar çizim çağrısıyla
döner.

---

## 3. DÜNYA MODELİ

### Izgara
- **256 × 256 karo.** Karo = 1 dünya birimi (Godot'ta 1 metre gibi davran).
- Her karo için paralel diziler (yapı dizisi değil — **sütun dizisi**, cache
  dostu ve serileştirmesi kolay):

```
height      float   0..1   arazi yüksekliği (SEA_LEVEL = 0.42 altı su)
terrain     byte           0 su, 1 bataklık, 2 ova, 3 tepe, 4 kayalık, 5 orman
fertility   float   0..1   çiftlik verimi
resource    byte           0 yok, 1 kömür, 2 demir, 3 taş, 4 kil
depleted    byte           damar tükendi mi
road        byte           0 yok, 1 patika … 6 metro hattı
oneWay      byte           yön (kayıtta RLE)
zone        byte           0 yok, 1 konut, 2 ticaret, 3 sanayi, 4 tarla, 5 park, 6 ofis
density     byte           0 normal imar, 1 yoğun imar (kayıtta RLE)
building    uint32         bina kimliği, 0 = boş
landValue   float   0..100 türetilmiş
pollution   float   0..100 türetilmiş
noise       float   0..100 türetilmiş
serviceMask byte           bit maskesi: hangi hizmetler bu karoyu kapsıyor
parcelsOwned byte          parsel satın alındı mı
highway     byte           bu karo devlet yolu mu
connected   byte           türetilmiş — otoyola bağlı mı
seaGate     byte           türetilmiş — liman bağlantısı
```

**Türetilmiş alanlar asla kaydedilmez.** Yüklendikten sonra yeniden hesaplanır.

### Yükseklik ve ölçek
- Yükseklik sütunu 0..1, sahneye `HEIGHT_SCALE = 26` ile gerilir.
- Deniz seviyesi sahne Y'si = `0.42 × 26 = 10.92`.
- Arazi 32×32 karoluk **chunk**'lara bölünür (8×8 = 64 chunk). Bir düzenleme
  yalnız o chunk'ı yeniden kurar.

### Parseller
- `PARCEL_SIZE = 48` karo. Harita 5×5 parsel (kenarda artık kalır).
- Başlangıç merkezi `{168, 168}`, başlangıç parseli **144–191** aralığı.
- Fiyat: `120_000 × 1.9^n` — n, sahip olunan parsel sayısı. Üstel, çünkü
  genişleme bir *karar* olmalı, bir rutin değil.
- **Sahip olunmayan araziye yol çizilemez, imar boyanamaz.**

### Ulusal otoyol — oyunun omurgası
Harita üretiminde, tohumdan deterministik olarak çizilir. Haritayı boydan boya
geçer. **Kayıtta değildir, tohumdan yeniden üretilir.**

- Rota **4-bağlantılı** olmak zorunda (bağlantı BFS'i, yük yayılımı ve trip
  enjeksiyonu dört yönlü okuyor). Yani her viraj tek karelik bir dirsektir.
- `HIGHWAY_MIN_RUN = 10` — iki viraj arası en az on karo. Bu sayı yolun
  "otoyol" mu "dağ patikası" mı göründüğüne karar verir. Ölçüm: 100 karede
  viraj sayısı 39–71'den 12'ye indi.
- `HIGHWAY_END_DRIFT = 18`, `HIGHWAY_WANDER = 7`.
- **Rota üreticisine dokunmak KAYIT SÜRÜMÜ artırmayı gerektirir.** Rota kayıtta
  olmadığı için üretici değişirse mevcut şehirler kendi sokaklarıyla kalıp
  otoyolu başka yerde bulur: kavşaklar gider, mahalleler sessizce kopar, ve
  ekranda sebebi yazmaz.

### Bağlantı kuralı (en önemli tek kural)
**Otoyola bağlı olmayan yol işe yaramaz.** Soluk çizilir, kenarında bina
büyümez, göç gelmez. BFS otoyola komşu yollardan tohumlanır. Otoyol hiç yoksa
hepsi bağlı sayılır (erken oyun kilitlenmesin).

Limanlar ikinci bir tohum kaynağıdır (`seaGate`): otoyol savaşta kapansa bile
deniz kapısı olan şehir bağlı kalır.

---

## 4. ZAMAN VE TICK MODELİ

```
SIM_TICK_HZ          = 5     ana simülasyon
ECONOMY_TICK_HZ      = 1     gelir/gider defteri
BUILDING_EVAL_S      = 3     bina büyüme/çürüme değerlendirmesi
TRAFFIC_REFRESH_S    = 5     trafik alanı
FIELD_DIFFUSION_S    = 10    kirlilik/gürültü yayılımı
SECONDS_PER_YEAR     = 40    takvim
SECONDS_PER_DAY      = 120   gün/gece döngüsü (üç yıl = bir gün)
DAYLIGHT_SHARE       = 0.78  günün ne kadarı aydınlık
START_YEAR           = 1900
```

**Neden gün 120 saniye, yıl 40:** 40 saniyelik gün döngüsü saatte **doksan
gün batımı** demek ve bu "gün geçiyor" gibi değil "gökyüzü bir türlü
durulmuyor" gibi okunuyor. Oyuncu şikâyeti aynen buydu. 120'de saatte otuz
oluyor ve üç tam yıl bir güne denk geldiği için yıl rozeti hâlâ tutuyor.

### Sistem sırası — bu sıra zorunlu
```
refreshSeaGates → computeConnectivity → computeRoadDistance
→ computeTraffic → computeVisitors → computeLandValue → coverage
```
Yol ekledikten sonra mesafe hesabı o yolu **göremez**, çünkü mesafe yalnız
*bağlı* sokaklardan ölçülüyor. Bu tuzağa orijinalde iki kez düşüldü.

### Çevrimdışı ilerleme
- Tavan **14 saat**. Verim bantları: ilk 2 saat ×1.0, 2–8 ×0.6, 8–14 ×0.35.
- Uzakta geçen zaman **formülle ödenmez, simüle edilir** — en fazla `OFFLINE_STEPS = 30`
  adımda. Yani bir saat = 120 saniyelik adımlar.
- **Bu yüzden `delta`'ya bağlı her şey iki yolu ayırmak zorunda:**
  - Akış oranları **üstel** olsun: `1 - exp(-dt/T)`, asla `dt/T`.
  - Bir **stoktan** pay kesen şey (boş konut, birikmiş çöp) kaba adımda daha
    sert kırpılır — oranı yumuşak bir rampayla ölçekle, stoku doğrudan okuma.
  - Birikimler (defin bekleyenler, çöp) çevrimdışında **kapalı** olmalı.
    Ölçüldü: defin birikimi yüzünden bir saatlik çevrimdışı %14 küçük döndü.
- **Kural: uzakta geçen zaman kazandırır, asla yıkmaz.** Kaos (yangın, salgın,
  suç) çevrimdışında işlemez.

---

## 5. YOL VE ÇİZİM

Altı kademe, her biri bir çağda açılır:
`patika → taş yol → asfalt → bulvar → otoyol → metro hattı`

- Maliyet eğimle çarpılır: `1 + eğim × 2.5`. Su üstü köprü ise `× 6`.
- **Parmakla çizim**: ham nokta dizisi düzeltilir —
  - 8 karodan kısa sapmalar ana eksene yapışır
  - 3 karo içindeki açı tam 45°'ye kilitlenir
  - kendi kirişinden 3 karo veya %10'dan fazla sapan koşu **kasıtlı virajdır**
  - titreme 1.2 karoluk pencerede ortalanır
  - 3 karoluk pencerede 0.95 radyandan (≈55°) keskin dönüş = köşe
  - köşeler 2.5 karo yarıçapla yuvarlanır, viraj 3 Chaikin geçişiyle yumuşar
  - tek harekette en fazla 400 karo
- **Tek yönlü yol**: yön çizim yönünden gelir, kapasiteye `×1.55` bonus verir
  (karşı yönde kuyruk ve sola dönüş yok). Kural tek yerde durur.

### Köprüler
Yol karoları arazi yüksekliğini okursa suyu geçen her yol **deniz tabanında**
çizilir. Çözüm: ayrı bir `sampleRoadHeight`.
- Güverte suyun `0.55` üstünde, rampa karo başına en fazla `0.24` düşer
  (yani kıyı geçişi 2–3 karo), plaka kalınlığı `0.14`, korkuluk `0.16`,
  ayaklar 3 karoda bir.
- **Asfaltın üstüne binen her katman (araç, şerit çizgisi, lamba)
  `sampleRoadHeight` okur; toprağa oturan (bina, ağaç, istasyon) araziyi okur.**
  Karıştırırsan araç köprünün altından geçer.

---

## 6. İMAR VE BİNALAR

### İmar türleri ve fiyatları (karo başına ₺)
```
konut 40 · ticaret 65 · sanayi 55 · tarla 20 · park 90 · ofis 110
```
Fırça çapları: 1, 3, 5.

### Uygunluk (suitability) — büyümenin tek karar fonksiyonu
```
yol erişimi        +0.30   (en fazla 4 karo yürüme)
talep              +0.25
hizmet kapsaması   +0.20
arazi değeri       +0.15
komşu uyumu        +0.10
kirlilik           -0.20
gürültü            -0.10
```
Kirlilik/gürültü **imar türüne göre** ölçeklenir:
```
konut  kirlilik 1.00  gürültü 1.00
ticaret        0.65           0.50
sanayi         0.00           0.00   (fabrika kendi dumanından şikâyet etmez)
ofis           0.90           0.80
```

- `> 0.45` → bina doğar. `< 0.25` → 90 saniyede çürür ve yıkılır.
- Yeni bina kapasitesinin `%60`'ı dolu doğar (ev zaten insanlar geldiği için
  yapılıyor; boş doğarsa her doğuş dalgası boşluk oranını fırlatır).
- Kademe atlama süreleri: `14, 35, 80, 170` saniye.

### Kapasite eğrileri
```
konut   4 × kademe^1.6
ticaret 3 × kademe^1.5
sanayi  5 × kademe^1.4
ofis    4 × kademe^1.7   ← en dik eğri
```
**Ofis neden en dik:** dükkân, bina ne kadar yüksek olursa olsun bir vitrindir;
ofis kulesi tepeye kadar ofistir. Yani 1. kademe ofis dükkândan kötü, 5. kademe
ofis çok daha iyi — bu şekil, ofis bölgesini yoğun imar etmeye değer, oraya
buraya serpmeyi anlamsız kılar.

### Yoğunluk — bir şehirde neden mahalle olur
- Normal imar **3. kademede** durur. Yoğun imar **5'e** çıkar.
- Yoğun imar zone türü DEĞİLDİR — ayrı bir `density` sütunudur. Böylece koddaki
  hiçbir `zone == RES` kontrolü değişmez.
- Fiyatı normalin **4 katı** ve 4./5. kademe için mahallenin hizmet kapsamasının
  **%80**'i şart.
- **Ölçülerek elenen iki tasarım** (tekrar denemeden önce oku):
  1. *Uygunluk puanından kesinti*: hizmetsiz merkez hiçbir şey büyütmedi —
     oyuncu dört kat para verip boş arsa izledi ve sebebi söylenmedi.
  2. *0.62 uygunluk eşiği*: tam hizmetli bir şehirde en iyi karo **0.470**
     aldı. Eşik ulaşılamazdı, yani yoğun imar saf para çukuruydu. Uygunluk
     yedi ağırlıklı terimin karışımı; tavanı tahmin edilecek şey değil.
     Kapsamanın tavanı yapısı gereği 1.0.

### Ofis — okulların karşılığı
Ofis `city` çağında açılır, eğitimden **sonra**, yanında değil. Çünkü okul bir
kohort bandı sonra iş gücüne ulaşır: ikisi birlikte verilseydi oyuncu, hiç
büyümeyen bir iş merkezi imar ederdi ve sebebini ekranda hiçbir şey yazmazdı.
- Zemin katın üstüne çıkması için iş gücünün **%35'i okumuş** olmalı.
- Bu, oyundaki en uzun neden-sonuç zinciri: bugün okul yaparsın, iki bant sonra
  ofis imar edersin.

### Yıkım
Boya silmek bedava (kendi hatanı düzeltmek cezalandırılmaz). İstasyon yıkmak
fiyatın **yarısını** geri verir — dört haneli tek bir alım için hiçbir şey
geri vermemek "cezalandırılmış yanlış dokunuş" olurdu.

---

## 7. İNSANLAR

### 7.1 Göç ve mutluluk
```
göç/dk = 0.5 × (mutluluk − 40) / 60 × boş_konut
```
`0.5` katsayısı ölçüldü: boş bir evin dolma süresi `1 / (k × (m−40)/60)` dakika.
Orijinal tasarımın önerdiği 0.02, 85 mutlulukta **bir saat** ediyordu — bu
"dolmakta olan şehir" değil "durmuş şehir" gibi okunuyor ve bütün geri besleme
döngüsünü kilitliyordu (boşluk yüksek kalır → konut talebi sıfır kalır → bir
daha hiçbir şey yapılmaz). 0.5'te dolma süresi ~3 dakika.

- Mutluluk `< 35` → göç tersine döner.
- Başlangıç mutluluğu 60. Mutluluk hedefine saniyede `0.08` yaklaşır.

### 7.2 Yaş kohortları — dört bant
`çocuk → genç → yetişkin → yaşlı`, her bant **900 saniye**.

**Bu takvim değil, oyun sayısıdır ve bilerek öyle.** Gerçek 20 yıllık bant
40 sn/yıl'da 800 saniye eder; bu, gerçek ölüm oranını dakikalık göç oranıyla
karşı karşıya getirir ve aritmetik acımasızdır: on bin kişilik şehir dakikada
yüz kişi gömer ve hiçbir mutluluk onu dolduramaz.

Ölçüm: 420 saniyede bütün nüfus 20 dakikada değişiyordu (4700 kişilik şehir
dakikada 240 ölü, dokuz mezarlık ister — bu şehir değil koşu bandı). **900'de**
ömür bir saat, dakikada şehrin ~%1.5'i, iki-üç mezarlık yetiyor, kuruluş
patlamasının ilk dalgası ~45. dakikada geliyor.

- Gelenlerin `%28`'i çocuk, `%4`'ü yaşlı. Otoyoldan gelen **ailedir** — okul
  bu yüzden istatistik değil talep.
- Doğum: `(60 × 0.25) / (900 × 0.5)` çocuk / çalışan / dakika. Bu sayı
  *seçilmedi*, bant uzunluğundan **türetildi** — büyümesi durmuş bir şehrin
  kendini yenilediği orandır. Doğumlar göçle aynı konut kontrolünden geçer.
- Okumuş iş gücü: çıktıya `×1.35`, suça `×0.6`.
- Ölüm → defin. Mezarlık dakikada 40 defin. Bin kişide 4 ceset beklemeye
  başlayınca şehir fark eder, mutluluk `−14`'e kadar iner.

### 7.3 Talep dengesi
```
14 sakine 1 ticaret işi
1 sanayi işine 1.6 ticaret işi
22 (okumuş) sakine 1 ofis işi
tarla karosu başına 0.35 iş
```
İşsizlik `%8`'in üstünde mutluluğu düşürmeye başlar; tam işsizlikte `−75`.
Bu kasten ılımlı: iş yeri olmayan kuruluş köyü **durgunlaşmalı, boşalmamalı** —
daha dik bir eğri oyunun kendi açılış hamlesini cezalandırırdı.

---

## 8. EKONOMİ

```
ticaret cirosu   26 ₺ / iş / dk,  vergi %6
sanayi çıktısı   18 ₺ / iş / dk,  vergi %5
ofis cirosu      34 ₺ / iş / dk,  vergi %7.5
tarla verimi     4 birim / karo / dk × 0.5 ₺
```
- Başlangıç: **25.000 ₺**, vergi oranı **%9** (tavan %20).
- Defter kalemleri: vergi, turizm, lobi, ferman, yol bakımı, hizmet gideri,
  şebeke gideri, borç servisi, tarla, hat, deniz, liman, program, ziyaretçi,
  bilet.
- **Kredi**: faiz %6 (üst üste kredi %11), tavan = şehrin brüt vergisinin
  **12 dakikası**, vade 20 dakika. Bu tavan "oyuncunun kendine kazdığı çukur"
  boyunda: bir kötü kararı köprülemeye yeter, kredi ile ikinci şehir kurmaya
  yetmez.
- **Birim bütçeleri**: altı birim, 0.5×–1.5× arası 5 kademe. **Yarıçap bütçenin
  karekökü ile ölçeklenir** — kapladığı alan parayla aynı hızda büyüsün diye.
  Düz ölçeklemek bedava yükseltme olurdu.

### Sanayi–ticaret zinciri
Atölye yola sandık koyar, sandık mesafeyle (`karo başına ×0.94`) ve kuyrukla
erir, dükkân ulaşanı satar. Erişim 34 karo. Liman fazlayı ihraç eder
(`2.4 ₺/sandık`).
- Sanayi 0.5 sandık/iş/dk üretir, ticaret 0.62 ister. **Oran kasıtlı:** dükkân
  atölyeden biraz fazla ister, yani saf perakende şehir kıtlık çeker, saf sanayi
  şehrinin sandığı gidecek yer bulamaz. İki durumda da cevap aynı fiil: *öbür
  imarı boya.*
- Taban: kıtlıkta dükkân `×0.55`'e, tıkanmada atölye `×0.7`'ye düşer — uçurum
  değil yokuş.

### Otoyol geliri
```
temel akış        26 araç/dk (şehir olmasa bile)
nüfus çekimi      +1.4 × √nüfus
kavşak başına     +%12 (en fazla 4 sayılır)
tavan             320 araç/dk
geçiş ücreti      5.5 ₺ / araç / dk × sahip olunan arazi payı
```

### Ziyaretçiler — otoyoldan şehre giriş
Geçen trafiğin `%34`'ü sapmak için sebep taşır. Kavşaktan girer, her sokakta
`×0.86` seyrelir, 22 karo gider. Kuyrukta daha hızlı seyrelir (`1.6` ısırma).
Dükkânın çıktısını en fazla `+%85` yükseltir, doyumlu eğriyle.
- **Ölçüm uyarısı:** işlek bir kavşak sokağı dakikada **tek haneli** ziyaretçi
  taşır, onlarca değil. İlk sürüm onlarca varsaydı ve iyi kurulmuş bir koridor,
  yerini aldığı sabit bonustan az kazandı. Doyum noktası: 4.

### Gece
Karanlıkta dükkânlar cirosunun `%45`'ini kaybeder ve kimse ışıksız şehre sapmaz.
Aydınlatma yatırımı bunu geri alır.
**Kalibrasyon türetilmiş:** gündüz artışı, gece kaybını tam olarak geri öder —
yani ışıksız şehrin *günlük ortalaması* gece mekaniği eklenmeden önceki ile
aynıdır. Bu bir nerf değil, bir fırsattır. (Bu kalıbı her yeni "gündüz/gece"
mekaniğinde tekrarla.)

---

## 9. ALANLAR (görünmeyen motor)

Hepsi 0..100 ölçeğinde, gevşetme (relaxation) çözücüyle yayılır.

```
yayılım geçişi        12   (her geçiş ≈ 1 karo)
kirlilik sönümü       0.12 (uzağa gider — sanayi bir planlama problemi)
gürültü sönümü        0.35 (birkaç sokakta biter)
sanayi işi başına     1.8 kirlilik, 2.0 gürültü
ticaret işi başına    1.0 gürültü
park emilimi          0.30 / geçiş
ağaç emilimi          0.16 / geçiş
park arazi değeri     +20, 5 karo menzil
kirlilik alarmı       45
gürültü alarmı        55
```

**Park zinciri:** park → arazi değeri → daha yüksek bina → aynı arazidan daha
çok vergi. Bu halka orijinalde **eksikti**: park karo başına 90 ₺ (fırçanın en
pahalısı) tutuyordu ve tek getirisi temiz havaydı. Kimse difüzyon geçişi için
park yapmaz.

**Sekiz mercek** (harita üstü ısı katmanı):
`arazi değeri · kirlilik · gürültü · trafik · kapsama · suç · yoğunluk · tek yön erişimi`

> **Kural: yeni bir metrik eklerken önce onun *tüketicisini* yaz.** Orijinalde
> arazi değeri hesaplanıyor ama hiçbir yere yazılmıyordu; mercek her şehirde
> boş çiziliyordu ve kimse fark etmedi. Yeraltı kaynakları da ilk fazdan beri
> üretiliyor ve **hiçbir şey okumuyordu**.

### Trafik — alan, araç değil
Evler ve iş yerleri önlerindeki yola trip enjekte eder; her geçiş her karonun
yükünün bir kısmını komşularına iter (6 geçiş). Yük = akış / kapasite.
```
sakin başına 0.5 trip/dk · iş başına 0.35 trip/dk
4 yollu kavşak cezası 0.25 · 3 yollu 0.10
tıkanıklıkta hız: hız / (1 + (yük−1) × 1.5)
tıkanıklık alarmı 1.2
tıkanıklık arazi değerinden 16 götürür
```

### Tek yön erişimi (§26) — sayı ile harita aynı kaynaktan
Oklara **uyan** iki BFS: kapılardan içeri, kapılara geri. Girilemeyen ve
çıkılamayan sokaklar sayılır, akışa bir satır düşer, düzelince ikinci satır.
Sim'e hiç dokunmaz — sorun kayıp gelir değildi, oyuncunun bunu **öğrenememesiydi**.
Sekizinci mercek hangi sokaklar olduğunu boyar. Sayı ile katman **aynı iki
maskeyi** paylaşır, yoksa cümle ile harita birbirinden sapar.

---

## 10. HİZMETLER, ŞEBEKE, KAOS

### Hizmetler (elle yerleştirilir, kendiliğinden büyümez)
`itfaiye · sağlık · eğitim · polis · mezarlık · çöp deposu`

Kapsama bir **bit maskesidir** — doğası gereği ikili.
> Mesafeyle azalan kapsama "ucuz görünüp pahalı çıkan" iştir: tür başına bir
> `PackedFloat32Array` (~1.5 MB) ve suç/yangın/çöp/eğitim/şebeke tüketicilerinin
> hepsinin değişmesi demek. Kazancı cila.

### Şebeke — yarıçapla değil, **yol boyunca** ulaşır
`kuyu · su şebekesi · kömür · doğalgaz · petrol · hidroelektrik · güneş · nükleer`
(hidro ve güneş su kıyısı ister)
```
kişi başı su      0.35 m³/dk
kişi başı elektrik 0.012 MW
```

### Limanlar
`balıkçı barınağı · kargo limanı · tersane · marina`
Kıyıya kurulur, **önünde açık su şart.** Liman `seaGate` yazar ve bağlantı
oradan da tohumlanır. Marina mutluluk verir ama **tavanı 6** — sekiz marina
daha mutlu şehir değil, bir istismardır.

### Cazibe yapıları
`otel · saat kulesi · opera · stadyum · TV kulesi · havalimanı`
Turist: dolu yatak başına `1.4 ₺/dk`. Anıtların toplam mutluluk katkısı
**en fazla 10** — gurur gerçektir ve sonludur; her kapalı hastaneyi heykelle
satın alabilen bir hazine yanlış dersi verirdi.

### Yangın
```
tutuşma          0.00002 / bina / sn   (kademe başına ×1.5)
kapsama          tutuşmayı ×0.2'ye indirir
müdahale         25 sn içinde söner
araç hızı        9 karo/sn, olay yerinde 3 sn
söndürülmezse    80 sn'de bina gider
yayılma          12 sn'de bir, %13 şans, 2 karo yarıçap
```
**%13 sayısının gerekçesi — üreme sayısı:** söndürülmemiş yangın 80 saniye
yaşar ve 12 saniyede bir dener = 6 deneme. Eski değer 0.3 idi → üreme sayısı
**1.8**. Birden büyük demek, itfaiyesiz mahallede ilk yangın **hiç durmaz**:
60 dakikalık ölçümde 400 binalı şehir 300 eşzamanlı yangına ulaştı ve orada
kaldı, nüfus sıfıra çakılı (tutuşma binayı boşaltıyor). Sayfayı yenilemek
düzeltiyordu — bu, zorluk değil **kaçak** olduğunun en net işareti.
0.13'te üreme sayısı 0.78: bir tutuşma mahalleye dört-beş binaya mal olur ve
kendiliğinden söner.

### Salgın
Nüfus 120 altında tutunamaz. Saniyede 0.0006 (yarım saatte bir). Süre 150 sn,
saniyede nüfusun `%0.09`'unu alır, mutluluk `−26`.
**Çöp birikimi salgın şansını `×2.6`'ya kadar çıkarır** — salgının hiç sahip
olmadığı *sebep* budur; artık oyuncu olmadan önce müdahale edebiliyor.

### Suç — parmakla cevaplanan tehlike
```
oran              0.000035 / bina / sn
dükkân            ×2.2   gece ×2.4   sefalet ×1.8   kapsama ×0.35
devriye hızı      11 karo/sn, tutuklama 2.5 sn
kaçış             45 sn
zarar             60 ₺ + kademe başına 40 ₺
mutluluk          −4 (tavan −12), kaçan hırsız ayrıca −3, 90 sn hatırlanır
```
**Bu sayı bir oyuncu şikâyetiyle yeniden ayarlandı** ("çok hırsızlık var,
ilerleyemiyorum"). Ölçüm daha da açıktı: kapsamasız 273 binalı kasaba dakikada
4.6 suç görüyor ve 1382 ₺ kaybediyordu — brüt geliri 625 ₺ iken. Suç şehrin
kazandığı her şeyin **%221'ini** alıyordu. Bu durumdaki şehir onu düzeltecek
karakolu biriktiremez; tuzağın tanımı budur.
Hata, taban oranı tek başına akıl yürüterek koymak ve üstündeki çarpan yığınını
(gece × sefalet × dükkân ≈ 1.8–2.4×) hiç ölçmemekti.

### Çöp
```
sakin 0.05 · iş 0.08 birim/dk
depo  120 birim/dk
tolerans: kendi üretiminin 3 dakikası
mutluluk −16
```
Depo kapasitesi **itfaiyeye göre kalibre edildi**, tahmin edilmedi: oyuncunun
gerçekten hissettiği sayı "bu hizmetten kaç tane ister". İlk denemede (10/dk)
11 bin kişilik şehir **99 depo** isterken 8 itfaiye istiyordu — bu bir karar
değil, angaryadır; beş tane kurup hiçbir şey değişmeyen oyuncu sistemin bozuk
olduğu sonucuna varır. 120'de sayım bütün aralıkta itfaiyeyi takip ediyor.

---

## 11. SİYASET KATMANI — OYUNUN KALBİ

Burası oyunun *asıl kendisi*. Yukarıdaki her şey bunun malzemesi.

### 11.1 Yedi kesim
`gençler · yaşlılar · aileler · esnaf · sanayiciler · yeşiller · sürücüler`

Her kesimin oyu:
```
mutluluk        %50
vergi yükü      %14
bütçe sağlamlığı %6
kendi dertleri  %30   ← kesimi kesim yapan şey
```
İlk üçü toplam %70 (medeni taban), son %30 kesimin kendi meselesi.

**Etki büyüklükleri** (0..1'lik "dert puanı" üzerinde):
```
politika (kararname)  0.15
ferman                0.16   ← dayatılan politika, anlaşılan değil
lobi sözleşmesi       0.22   ← altında imza var, şehir daha çok takar
vaat (verilirken)     0.18
vaat (tutulunca)      0.10
vaat (ihanet)         0.34   ← asimetri mekanizmanın kendisi
lider tabanı          0.10   ← nereden geldiğin, yaptığın bir şey değil
```

### 11.2 Seçim — ve karşındaki aday
- Beş yılda bir (≈3.5 dakika oyun). **Zar yok.**
- Eşik %50.
- **Kaybetmek oyunu bitirmez**: şehir de para da harita da kalır, giden ödenek.
- Kazanınca **ödenek**: kişi başı 9 ₺ — oyundaki **en büyük tek meblağ**
  (100 bin nüfusta 900 bin ₺, yani 29 hedeflik bütün görev zincirinin bir
  oyunda ödediğinden fazla). Bu yüzden karneyle çarpılır: C notunda çarpan
  tam **1.0** (mevcut hiçbir şehirden bir şey alınmaz), A'da 1.4×, F'de 0.6×.
  > **Genel kural:** ortalama durumu aşağı çeken bir yeniden dengeleme, tasarım
  > gerekçesi giymiş bir nerf'tür. Kaliteyi bir *fırsat* yap, bir ceza değil.
- **Rakip**: 5 arketip, her biri 2 kesime kur yapar, 10 isim havuzu.
  Kaptığı pay = `0.45 × (1 − o kesimin memnuniyeti)`. Yani tavan, oran değil:
  tam memnun kesimden hiçbir şey alamaz.
  0.45 şu boyda: bir kesimi ihmal etmiş belediye başkanı hâlâ rahat kazanır,
  adayın hedeflediği **iki** kesimi de ihmal etmişse başı gerçekten dertte.

### 11.3 Vaatler — popülizmin fiili
Altı vaat (trafik, temiz hava, okul, düşük vergi, iş, bakım). Aynı anda **3**.
- **Vermek bedava ve anında; bozmak, vermenin kazandırdığından fazlasına mal
  olur ve terimlerce üstünde kalır.** İkisi denk olsaydı her şeyi vaat etmek
  kesin doğru olurdu ve tartacak bir şey kalmazdı. Oyuncu seçimi *lafla* satın
  alabilmeli ve bedelini bir sonraki seçimde öğrenmeli.
- İhanet hafızası: bir ihanet güvenin `0.75`'ini götürür (1.0 değil —
  1.0'da ölçek ilk ihanette dolar ve aynı odaya iki kez yalan söyleyen, bir kez
  söyleyenden farksız kalır: eğim yok). İkinci ihanet tavanı bulur.
- Unutma hızı: bir tam ihanet ≈ **3 seçim dönemi**.

### 11.4 Fermanlar — diktatörün menüsü ve **şehrin gizli mizacı**
On üç sürekli ferman + iki tek seferlik fiil.

```
tahıl tekeli · angarya · zorunlu askerlik · basın sansürü · sokağa çıkma yasağı
propaganda dairesi · grev yasağı · muhbir ağı · ek vergi · sıkıyönetim
sınır kapatma · internet kesme · sosyal medya yasağı
+ varlık haczi (tek seferlik) · ekmek dağıtımı (tek seferlik)
```

Her fermanın: bir kazancı, bir bedeli, kızdırdığı kesim(ler), ve bir çağ kilidi
var. `internet kesme` 2000'lerden sonra anlamlı — çağ değil **takvim** kilidi.

**En önemli tasarım fikri — gizli eşikler:**
Şehrin öfke toleransı, her fermana özel hassasiyeti ve vergi konfor sınırı
`balance` dosyasında **DEĞİLDİR**. Tohumdan türetilir:

```gdscript
tolerance    = rng_for(seed ^ hash("temper:tolerance")).randf_range(0.55, 1.15)
sensitivity  = rng_for(seed ^ hash("temper:sense:" + id)).randf_range(0.6, 1.8)
tax_comfort  = rng_for(seed ^ hash("temper:taxComfort")).randf_range(0.10, 0.15)
```

Yani **her oyunda farklı**, ama **aynı tohumda hep aynı** — yani yeniden
yükleyerek zar atılamaz. Oyuncu bu eşikleri ancak *deneyerek* bulur: "bu şehir
sansüre pek ses çıkarmıyor ama vergiye çok kızıyor." `balance` dosyasındaki bir
sabit okunabilirlik sözüdür; mizaç, oyuncunun **yöneterek keşfetmesi gereken**
tek sayıdır ve bu yüzden orada olamaz.

**Öfke (fury) mekaniği:**
```
sönme                  1/1200 / sn   (birikimden yavaş)
vergi öfkesi           1/900 / sn, konfor çizgisinin her %5 üstü için
ayaklanma              huzursuzluğa +0.45 sıçrama
ayaklanmadan sonra kalan %35   ← meydan boşalır, dert boşalmaz
varlık haczi           kişi başı 2 ₺ (tavan 150.000), öfke +0.16
ekmek dağıtımı         kişi başı 1.5 ₺ (tavan 100.000), öfke −0.12
```
Ekmek rahatlaması şehrin mizacına **bölünür** — huysuz şehri susturmak da zor.
İki gizli sayı aynı yöne çeker.

**Uyarı körlüğü:** sansür + propaganda birlikteyken oyuncu artık uyarıları
görmez. Bu bir bug değil, satın aldığı şeydir.

### 11.5 Meşruiyet — seçimin gerçekten önemli olduğu an
Seçimi kaybettin. Üç cevap, "sonra bakarım" yok:

| Seçim | Huzursuzluk | Anlamı |
|---|---|---|
| **Çekil** | 0 | Ödenek gider, şehir kalır |
| **Tanıma** | +0.35 | Mandasız yönetim — şehirlerin atlattığı bir şey |
| **Darbe** | +0.75 | Oylamayı bitirmek — atlatılan bir şey değil |

Aradaki fark, mekanizmanın çizdiği bütün ahlaki ayrımdır.

```
mandasızken sıkılaşma  1/900 / sn
manda varken sönme     1/420 / sn
iyi karne çarpanı      2.4× sönme
```
Sıkılaşma sönmeden **kasten yavaş**: işleri düzelten bir yönetim, kaymayı
geçebilir. Bu, kurtuluş yolunu dekoratif değil **gerçek** yapar. Bu oranlarda
A notlu şehir yöneten bir gaspçı ~2 dönemde gürültü çizgisinin altına iner;
D notlu olan hiç inemez.

Huzursuzluğun bedeli: mutluluk `−22`, binde 0.35 kişi/dk ekstra göç,
suç `×1.6`, kesimlerde ek kayıp.

### 11.6 Lobiler
Altı lobi: `müteahhit · petrol · turizm · üniversite · STK · sendika`
- ~150 saniyede bir kapı çalar, **45 saniye** pencere. Bir dönemde 2–3 teklif.
- İmza parası + süreli aylık ödeme + süre. İmza bir kesimi sevindirir, bir
  kesimi kızdırır.
- **Pencere kararı kararın kendisidir**: 45 saniye, yolu bitirip kartı okumaya
  yeter, "düşüneyim" demenin kendisi bir cevap olacak kadar kısa.
- **Tuzak:** teklif tohumdan türetilmeli (`seed ^ hash(pencere_indeksi)`),
  yoksa yeniden yükleyerek teklif zarı atılır.

### 11.7 Şehir karnesi — "ne kadar" değil "ne kadar iyi"
Altı boyut, **eşit ağırlıklı, kalıcı olarak**:
`hareketlilik · çevre · refah · ekonomi · adalet · dayanıklılık`

Notlar: A ≥ 0.85 · B ≥ 0.70 · C ≥ 0.55 · D ≥ 0.40 · F altı.
Bantlar eğri değil — bir harf köyde de metropolde de aynı şeyi anlatmalı:
*iyileşen* oyuncu notunun oynadığını görmeli, sadece *büyüyen* görmemeli.

**Adalet boyutu ve öğrenilmiş ders:** adalet bir orandır (en kötü beşte birin
arazi değeri / en iyisinin). Ama saf oran, **her adresi değersiz olan şehre
1.0 verir** — ki bu doğrudur ve "Adalet"in iddia ettiği şey değildir. Bu boşluk
`oneCity` mandasını bedavaya bankaya yatırıyordu.
Çözüm: **hem yayılım hem standart.**
```
puan = min(en_kötü/en_iyi, en_kötü/30)
```
30 sayısı ölçülmüş bir şehirden: en kötü beşte biri ~39, en iyisi ~52. Yani
sadece mütevazı olan şehre hiç dokunmaz, yalnız baştan sona sefil olanı yakalar.
Ayrıca 12 binanın altında adalet **hiç ölçülmez** — "en kötü beşte bir" bir-iki
bina demektir ve köyün ikinci dükkânında zıplar; sebebi görünmeyen not,
notsuzluktan kötüdür.

### 11.8 Lider seçimi ve açılış — oyun siyasetle başlar
Oyun boş haritada değil, **kim olduğun** sorusuyla açılır. İki ekran:

1. **Diktatörünü seç.** Beş lider; her biri bir *eğilim*, bir sınıf değil.
   ```
   popülist    taban: gençler + aileler        (geniş ve sığ, cepte hiçbir şey)
   teknokrat   taban: esnaf + sanayiciler      +45.000 ₺ hazine
   güçlü adam  taban: sürücüler                öfke %34 yavaş örgütlenir
   patron      taban: yaşlılar + sanayiciler   ödenek ×1.25
   reformist   taban: yeşiller + gençler       (hazine de yok yönetim kurulu da)
   ```
   Artı **görünmeyen bir 6.'sı: `neutral`** — seçiciye asla çıkmaz. Taze
   `create_state()`'in tuttuğu değer ve liderler eklenmeden yazılmış eski
   kaydın yükleneceği değerdir. Diktatör seçmemiş bir oyun **hiçbir kesimi
   sessizce ısıtmamalı.**
2. **İlk dönemi kazan.** Tabanın hangi kesimleri ısıttığı yazar; üç vaat
   seçersin; canlı bir oy oranı işler; eşiği geçince "başla" yanar.
   ```
   oy = 0.33 + taban_kesim_sayısı × 0.08 + vaat_sayısı × 0.07
   ```
   **Taban tek başına asla %50'yi geçmemeli** — koltuğa vaat vererek oturursun,
   ilk ders budur.

> **İki kez öğrenilen tuzak:** açılış seçimi için mevcut seçmen fonksiyonunu
> yeniden kullanma. Ortada şehir yokken o fonksiyon hiçbir şey vaat etmeden
> ~%83 veriyordu, yani seçim bedavaydı. Açılışın **kendi formülü** olmalı.
>
> **İkinci tuzak:** açılışta verilen vaatler doğrudan duruma yazılmalı. Taze
> şehir `founding` çağındadır, vaatler `town` çağında açılır — normal yoldan
> geçirirsen hepsi *sessizce reddedilir* ve oyuncu, oyunun unuttuğu vaatlerle
> seçim kazanmış olur.

### 11.9 Görevler ve mandalar
- ~29 klasik hedef: **ne kadar inşa ettiğini** ölçer, parayla öder.
- **7 manda**: karnenin altı sütununu ve genel notu hedefler, **parayla değil
  miras puanıyla** öder. Asıl oyun budur.
- **Manda zincirinin değişmezleri** (testle tut, üçü de gerçekten yakalandı):
  1. Aynı ölçüyü paylaşan hedefler bir **merdiven** değildir — sıralanamazlar.
  2. Mandalar **para ödemez**.
  3. Saha hedefleri, çağ sırasına göre dizilmiş tabloda metropol hedeflerinden
     **sonra** gelemez.

### 11.10 Saha görevleri — haritada *yer* gösteren hedefler
Görev haritanın belli bir karesini işaretler ve orası **yanıp söner**.
- Kare `10 × 10` karo — plan değil, bir *mahalle*. Daha küçüğü, oyunun
  oynandığı kamera yüksekliğinde nabzın altında kaybolur.
- Merkezden dışa doğru en fazla 12 halka aranır; ıslak kareler reddedilir;
  hiç kuru yer yoksa hedef **düşürülür** (denizi işaretlemektense).
- Nabız duvar saatiyle sürülür: `2.8 rad/sn`, opaklık 0.28–0.85.

### 11.11 Medya
Her olayı iki gazete farklı anlatır. Sansür varken bir tanesi hep susar —
ama **bir rejim daima sadık bir gazete tutar**, yani oyuncu tam olarak ne satın
aldığını her seferinde görür.
> Üçüncü ses (sosyal medya) açık iş.

---

## 12. KAYIT ŞEMASI — KURALLAR

1. **Alan eklemek sürüm artırmaz.** Kalıp: alanı yaz, okurken **savunmalı** oku
   (`data.x if data.x is Array else []`), ve yorumda *"bu alanı olmayan dosya
   şu demek"* yaz. Orijinalde bu kalıp beş kez kullanıldı.
2. **`*_ORDER` dizileri SADECE SONA EKLENİR.** İndeksler kayıtta duruyor;
   sırayı değiştirmek her kaydı sessizce başka bir şeye çevirir.
3. **Tanınmayan kimlik DÜŞÜRÜLÜR, hata vermez.** Eski kayıt yeni sürümde
   açılabilmeli.
4. **Türetilmiş veri kaydedilmez** (`connected`, `seaGate`, kohortlar, alanlar,
   yangın, suç, çöp). Yükledikten sonra hesaplanır.
5. **Ne kaydedilir, çünkü karardır:** para, vergi oranı, krediler, imar, yollar,
   binalar, hizmetler, şebeke, limanlar, cazibe, politikalar, **lobi
   sözleşmeleri, vaatler, ihanet hafızası, fermanlar, öfke, manda tipi,
   huzursuzluk, seçilen lider**, bütçeler, hatlar, otoyol aşınması, görevler,
   teknolojiler, yatırımlar.
6. **Ne kaydedilmez, çünkü andır:** yangınlar, suçlar, çöp yığını, salgın.
   Yarım yangınla kaydedilen şehir sakin açılır — bu bir merhamet ve bir
   şema değişikliğinden ucuz.
7. **Harita üreticisine dokunmak sürüm artırır** (§3, otoyol).

---

## 13. ARAYÜZ

- **Üst bar**: para, net ₺/dk, nüfus, mutluluk, yıl rozeti, sonraki çağa kalan.
- **Alt takım çubuğu**: gez · yol · bölge · hizmet · hat · sil · ar-ge · geri al.
  Bir takıma basmak **sayfa** açar (yol tipi, imar tipi, hizmet tipi).
- **Şehir paneli — iki sekme, siyaset önce:**
  ```
  [ YÖNETİM ]   meşruiyet · fermanlar · vaatler · rakip · kamuoyu · karne
                · anlaşmalar · politikalar
  [ ŞEHİR   ]   nüfus · ekonomi · talep · hizmetler · şebeke · bütçeler
  ```
  Açık sekme hatırlanır. **Siyaset tek dokunuşta erişilebilir olmalı** —
  oyunun konusu o.
- **Kart soruları** (lobi teklifi, kriz, banka, parsel, yol faturası, emeklilik):
  ekranı kaplayan tek karar. Kriz kartında **"sonra" yok**.
- **Olay akışı** (sağ üst şerit), **tarihçe günlüğü** (📜), **koç** (öğretici),
  **müfettiş** (karoya uzun bas), **mercek düğmesi**, **gezme modu** (🚶).

### Godot UI notları
- Telefon hedefi: **390 × 780 CSS px**, dokunma hedefi min **44 px**.
- `Control` ağacı, `anchors_preset` ile; panel `ScrollContainer`.
- Uzun basma 380 ms, dokunma toleransı 10 px.

---

## 14. İNŞA SIRASI (bu sırayla yap)

Her adımın sonunda **oynanabilir bir şey** olmalı.

1. **Dünya + kamera.** 256² ızgara, arazi üretimi, chunk'lı `ArrayMesh`,
   yörünge kamerası. Hiçbir oyun yok — sadece bakılabilen bir arazi.
2. **Yol çizimi.** Parmakla çiz, düzelt, ücret al. Otoyol + bağlantı BFS'i.
   *Burada durup his kontrolü yap — çizim hissi oyunun yarısıdır.*
3. **İmar + bina büyümesi.** Uygunluk, doğuş, kademe, çürüme. MultiMesh.
4. **Nüfus + ekonomi.** Göç, talep, vergi, defter. Artık bir oyun var.
5. **Alanlar.** Kirlilik, gürültü, arazi değeri, trafik. Mercekler.
6. **Hizmetler + şebeke.** Kapsama maskesi, yol boyunca ulaşım.
7. **Kaos.** Yangın, salgın, suç, çöp.
8. **Çağlar + görevler + teknoloji.** İlerleme hissi.
9. **Kayıt + çevrimdışı.** Burada yapmazsan sonra şema borcu birikir.
10. **▸ SİYASET.** Kesimler → seçim → rakip → vaatler → fermanlar → meşruiyet
    → lobiler → karne → lider seçimi. **Oyun asıl burada başlıyor.**
11. **Yaşayan şehir.** Yayalar, araçlar, gün/gece, hava, mevsim, müzik, tarih
    şeridi.
12. **Cila.** Köprüler, gemiler, şantiye, doğa, gezme modu.

---

## 15. GÖRSEL ÖLÇEK — pahalıya öğrenilen ders

Orijinalde binalar, **içinde durdukları dünyaya göre çok küçük çizildi** ve bu
aylarca fark edilmedi. Kuruluş çağı evi 0.20 birim duvar + 0.16 çatıydı —
kendi bahçesindeki ağaçtan (0.8) alçak, kapısındaki arabanın (0.16) ancak iki
katı. Varsayılan kameradan ekranın %1'inden azını kaplıyordu: telefonda yedi
piksel. Harita "binaları olan bir yer" gibi değil, **yere sürülmüş bir doku**
gibi okunuyordu.

**Sahnenin kendi mobilyası tartışmayı bitirir.** Araba 0.16, sokak lambası 0.34,
ağaç tepesi 0.8 → bir karo ≈ 8 metre → iki katlı ev bir karonun biraz altında
durmalı. Godot'ta bunu **baştan doğru yap**:

```
karo                 1.0 birim  ≈ 8 m
araba yüksekliği     0.16
sokak lambası        0.34
iki katlı ev         0.75–0.85  (duvar ~0.50 + çatı ~0.27)
5. kademe konut      ~3.4
5. kademe ofis       ~7.7
kat yüksekliği       0.30       (cephe dokusu ölçeği)
```

Düzeltirken **düz çarpan kullanma** — alttan sert, üstten yumuşak bir eğri
kullan, yoksa ya kulübe görünmez kalır ya da gökdelen bir iğneye döner:
```
yükseklik = 1.81 × kütle^0.80
taban     = 0.97 × kütle^0.50     (tavan ~0.93; 1.0 komşuya değer)
çatı eğimi= kütle × 1.70          (düz çarpan — çatı genişliğin fonksiyonu,
                                   yüksekliğin değil)
```
Kamera: yörünge mesafesi ~34 birim (52 çok uzaktı), zoom aralığı
`0.23 – 3.0`.

**Uyarı işaretleri binanın kendi çatısına konur**, zeminden sabit yüksekliğe
değil — yoksa 3. kademeden yüksek her bina uyarısını kendi duvarının içinde
taşır ve görünmez.

---

## 16. PERFORMANS VE BELLEK

- **Çizim tamponunu sınırla.** Piksel oranı tek başına bütçe değildir: 4K
  pencerede oran 2 iken 33 milyon piksel ister ve tampon hem renk hem derinlik
  için ayrılıp bir de MSAA örnek sayısıyla çarpılır — tek bir mesh yüklenmeden
  neredeyse bir gigabayt. **Toplam piksele tavan koy** (≈4.000.000). Telefon,
  1080p ve 1440p bundan etkilenmez; sığmayan büyük HiDPI penceredir.
- **Bağlam kaybını yakala.** Godot'ta `RenderingDevice` kaybı nadirdir ama
  mobilde uygulama arka plana atılınca olur: geri geldiğinde MultiMesh
  tamponlarını ve chunk mesh'lerini yeniden kur.
- **Ağaç salınımı yapma.** On binlerce instance'ın matrisini her kare yazmak,
  en pahalı ve en görünmez iş.
- **Karo ızgarasını küçültme.** Karo-indeksli her katmanın belleğini dörde
  katlar; araç zikzağının çözümü Catmull-Rom eğrisidir, daha ince ızgara değil.
- Binalar için **frustum culling kapalı** (instance'lar haritayı kapsıyor,
  sınır kutusu = harita).
- MultiMesh kapasitesi dolunca **iki katına çıkar** ve *o karenin
  instance'larını taşı*. Orijinalde taşımayı unutmak, her güç-ikisi sınırında
  bir kare boyunca mahallenin dörtte üçünü söndürüyordu.

---

## 17. TASARIM DOKTRİNİ (her kararın hakemi)

Bu on madde, oyunun bütün "his" kararlarını üretti:

1. **Hiçbir şey geri alınamaz olmasın.** Yenilgi bir uyarıydı, duvar değil.
2. **Sıfır bilgidir, sessizlik değil.** Boş bir sayı göster; hiçbir şey gösterme.
3. **Kilit anahtarını söyler.** "Kasaba çağında açılır" — "kilitli" değil.
4. **Yenilgi, dinlenmemiş bir uyarıdır.** Kaybedilen her şeyin öncesinde
   ekranda okunabilir bir işaret olmalı.
5. **Uzakta olanı cezalandırma.** Çevrimdışı kazandırır, yıkmaz.
6. **Kaydetmek zar atmak değildir.** Teklifler, rakipler, saha kareleri ve
   gizli mizaç hep tohumdan türetilir.
7. **Her etki fonksiyonu, sistemi kapalıyken tam olarak `1` (veya `0`) döner** —
   böylece çağıran yer koşulsuz çarpar. `-0` bile döndürme.
8. **Yeni metrikten önce tüketicisini yaz.**
9. **Ortalama durumu aşağı çeken denge değişikliği nerf'tür.** Kaliteyi fırsat
   yap.
10. **Görmediysen "çalışıyor" deme.** Ölçmediğin sayıyı yazma.

---

## 18. TEST ZORUNLULUKLARI

`sim/` içindeki her özellik için test **zorunlu**. En değerli üç test sınıfı:

1. **Canlılık testleri.** "Büyümüş bir şehirde her mercek en az bir okuma
   üretir." Orijinalde arazi değeri merceğinin her şehirde boş çizildiğini
   *sadece* böyle bir test yakalayabilirdi.
2. **Zincir değişmezleri.** Görev/manda tablosunun sıralanabilirliği, ödeme
   türü, çağ sırası. Üç kez gerçekten hata yakaladı — ve **her seferinde testi
   değil kodu düzelt.**
3. **Determinizm.** Aynı tohum + aynı adım sayısı = aynı şehir. Çevrimdışı 30
   adımlık yol ile saniye saniye yol **%1 içinde** buluşmalı.

**Kalıplar:** `strip_highway(state)` (otoyolu kaldır), `step(state, dt, false)`
(kaos kapalı), senaryolu zar.

> **Tuzak:** yeni şehir `played_ms = 0`, yani **1 Ocak — ve 1 Ocak bayramdır**
> (mutluluk bonusu var). Saati hiç ilerletmeyen fixture'lar o pencerede sonsuza
> kadar oturur ve dosyadaki her mutluluk iddiasını sessizce yukarı çeker.
> Fixture'da sıradan bir güne git.

> **Tuzak:** `state.population = N` yazmak yetmez; bir adım sonra binalardan
> yeniden hesaplanıp geri alınır. İnsanları **binalara dağıt**.

---

## 19. AJANA VERİLECEK KISA PROMPT

Uzun dosyayı okutamayacağın yerde bunu ver:

> Godot 4.x'te **Kadastro** adlı bir oyun yap: 256×256 karoluk izometrik bir
> haritada geçen, Türkçe, **şehir yönetme ve siyasi strateji** oyunu. Şehir
> kurma oyunu **değil** — tezi "popülizm bazen iyi planlamadan çok oy getirir".
>
> Mimari sözleşme: `sim/` saf ve deterministik (Node yok, `randi()` yok,
> rastgelelik yalnız tohumdan türetilir), `view/` sim'i sadece okur,
> bütün sayılar `data/balance.gd`'de, bütün metinler `data/strings_tr.gd`'de,
> `sim/` içindeki her özellik için test zorunlu.
>
> Temel döngü: parselini satın al → ulusal otoyola bağlanan yol çiz → imar boya
> → binalar uygunluğa göre kendiliğinden büyüsün/çürüsün → hizmet ve şebeke kur
> → kirlilik/gürültü/trafik/arazi değeri alanlarını yönet.
>
> **Asıl oyun siyaset:** yedi seçmen kesimi (tek mutluluk puanı yok), beş yılda
> bir ve karşında bir aday olan seçim, üç taneye kadar seçim vaadi (vermek
> bedava, bozmak pahalı ve terimlerce sürer), on üç ferman içeren bir diktatör
> menüsü, ve şehrin **tohumdan türetilen gizli bir mizacı** — öfke toleransı ve
> vergi konfor sınırı her oyunda farklı, oyuncu ancak deneyerek bulur, ama
> yeniden yükleyerek zar atamaz. Seçimi kaybedince üç cevap: çekil, mandasız
> devam et (huzursuzluk +0.35), ya da darbe yap (+0.75). Kaybetmek oyunu
> bitirmez.
>
> Oyun boş haritada değil, **"diktatörünü seç"** ekranıyla başlar: beş lider,
> her biri iki kesimi ısıtır ve bir somut avantaj verir; sonra vaat vererek ilk
> seçimi kazanırsın. Taban tek başına asla %50'yi geçmemeli.
>
> Altı boyutlu bir **şehir karnesi** (hareketlilik, çevre, refah, ekonomi,
> adalet, dayanıklılık) *ne kadar iyi yönettiğini* ölçer ve seçim ödeneğini
> çarpar; C notu tam 1.0'dır, yani mevcut hiçbir şehirden bir şey alınmaz.
>
> Doktrin: hiçbir şey geri alınamaz olmasın; sıfır bilgidir, sessizlik değil;
> kilit anahtarını söyler; yenilgi dinlenmemiş bir uyarıdır; kaydetmek zar
> atmak değildir; her etki fonksiyonu sistemi kapalıyken tam olarak 1 döner.

---

## 20. SON SÖZ

Bu oyunun en değerli kısmı kodu değil, **ölçülmüş sayıları ve reddedilmiş
tasarımlarıdır.** Yangın yayılma oranı, kohort bant uzunluğu, suç taban oranı,
depo kapasitesi, yoğunluk kapısı, adalet formülü — hepsi önce yanlış yapıldı,
sonra **oyun çalıştırılıp ölçülerek** düzeltildi.

Godot sürümünde de aynısını yap: bir sayıyı akıl yürüterek koyma, koy ve
**ölç**. Ve bir şeyin çalıştığını görmediysen, çalıştığını söyleme.
