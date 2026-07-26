# Kadastro

Parmağınla haritaya yol çiziyorsun, şehir o yolların etrafında kendi kendine büyüyor.
Haritayı baştan uca **ulusal otoyol** kesiyor: devletin yolu, sen çizmezsin,
yıkamazsın, bakımını ödemezsin. Oyunun sorusu şu — şehrin o yoldan ne
çıkaracak? Yolunu otoyola değdirirsen geçiş trafiği şehre para bırakır,
kamyonlar sanayiden harita dışına mal taşır, kavşak çevresindeki dükkânlar
yol üstü ticareti yapar.

Vite + TypeScript + three.js. Sunucu yok, hesap yok, tek statik klasör.
Tüm grafikler ve dokular kodla üretilir — projede sprite, model ya da doku
dosyası yoktur; bina cepheleri bile açılışta canvas'a çizilip dokuya çevrilir.

## Çalıştırma

```bash
npm install
npm run dev      # geliştirme sunucusu
npm run build    # tsc --noEmit + vite build → dist/ (saf statik)
npm run preview  # build çıktısını sun
npm test         # vitest
```

`dist/` tek statik klasördür; Netlify/Vercel/GitHub Pages farketmeksizin deploy edilir.

## Mimari kuralları

- `src/sim/` saf TypeScript. `canvas`, `document`, `window`, `Math.random`,
  `Date.now` yok. Deterministik, seed'li, test edilebilir.
  Bu kural sunum katmanının 2D'den 3D'ye taşınmasını mümkün kılan şeydir:
  sim tek satır değişmedi.
- `src/render3d/` sim durumunu okur, asla yazmaz.
- Sim ile kamera arasındaki tek bağ `screenToWorld` — bir ekran noktasını
  kareye çeviren tek metot. Araç katmanı kameranın 3D olduğunu bilmez.
- Tüm denge sayıları yalnızca `src/data/balance.ts` içinde.
- Oyun içi metinler yalnızca `src/data/strings.tr.ts` içinde. Kod ve yorumlar İngilizce.
- Hiçbir dosya 400 satırı geçmez.

## Performans kuralları

Gerçekçi bir şehir telefonda dönecekse çizim çağrısı sayısı sabit kalmalı:

- Binalar (dönem × bölge × seviye başına), ağaçlar ve araçlar `InstancedMesh`
  ile çizilir. Binlerce nesne, yirmi civarı çizim çağrısı. Bir çağda yalnızca
  bir mimari dönem canlıdır; kovalar ilk gerektiğinde kurulur, boş olanlar
  gizlenir.
- Arazi parçalara bölünür, böylece GPU görüş alanı dışını atabilir.
- Yol, bölge ve ağaç katmanları yalnızca oyuncu bir şey değiştirdiğinde yeniden kurulur.
- Kare sayacı üst çubukta açık durur: bütçeyi bozan değişikliğin fark edilmesi gerekir.

## Faz durumu

| Faz | Kapsam | Durum |
| --- | --- | --- |
| 0 | İskelet, PWA, kamera, sabit zamanlı döngü | Tamam |
| 1 | Arazi üretimi ve yol çizimi | Tamam |
| 2 | Bölgeler, binalar, temel ekonomi | Tamam |
| 3D | Sunum katmanının three.js'e taşınması, araç trafiği | Tamam |
| 3 | Kirlilik/gürültü difüzyonu, hizmet binaları | Tamam |
| 3b | Su/elektrik şebekesi | Tamam |
| 3c | Trafik sıkışıklığı | Tamam |
| 4a | Parsel satın alma — harita artık başlangıç karesiyle sınırlı değil | Tamam |
| 4 | Çağlar, teknoloji, görevler, offline ilerleme | Tamam |
| 5 | Cila, mahalle isimleri, performans, öğretici | Tamam |
| 6 | Prestij, alternatif haritalar, prosedürel ses | Tamam |
| 7 | Ulusal otoyol: tek devlet yolu, kavşak, geçiş geliri, amaçlı araç trafiği | Tamam |

## Faz 7 notları — otoyol ve trafik

- Otoyol rotası araziyle birlikte seed'den üretilir; kayda yazılmaz, yüklemede
  araziyle yeniden kurulur. Oyuncunun yol sütununda durur ama ayrı bir maskeyle
  işaretlidir: çizilemez, yıkılamaz, bakımı devlettendir, bina cephesi açamaz
  (erişim kontrollü yol). Tek giriş yolu kavşaktır — otoyola değen oyuncu yolu.
- **Kayıt sürümü 4.** Otoyol öncesi kayıtlar reddedilir; eski şehirle yeni
  altyapıyı yarım yamalak birleştirmektense temiz başlangıç. Miras puanları
  ayrı tutulduğu için prestij kaybolmaz.
- Araçlar artık süs değil: her aracın kaynağı ve hedefi var. İşe gidişler ev↔iş
  arasında A* ile gerçek en hızlı yoldan; kamyonlar sanayi→dükkân ya da
  sanayi→otoyol→harita dışı (ihracat); transit araçlar otoyolu uçtan uca geçer,
  yoğunlukları simülasyonun geçiş trafiği sayısıyla aynıdır.
- Yeni defter satırları: **otoyol geçişi** (sahip olunan otoyol kesimi ×
  kavşak yakalaması × geçiş trafiği) ve **tarım geliri** (ürün artık satılıyor;
  önceden çiftlikler sadece istihdamdı).
- Düzeltilen mantık açıkları: yol üstüne bina doğabiliyordu (imar boyanmış
  yol karesi); otoyol trafiği akışı ve gürültüsü simülasyona işlendi (gürültü
  yalnızca sahip olunan parsellerde hesaplanır — boş arazide çözücüyü
  şişirmez); "yol çiz" görevi ve dönüş kontrolü artık yalnızca oyuncunun
  yolunu sayar.

## Bilinen eksikler

Planın bütün fazları kapandı. Kalanlar plan dışı, ileriye dönük notlar:

- **Tek dil.** Metinler `strings.tr.ts` içinde toplu duruyor ama ikinci bir dil
  eklemek için bir seçim mekanizması yok.
- **Bina çeşidi seçimi yok.** Oyuncu tek tek binaları seçemiyor; bu bilinçli —
  oyunun tezi "yolu sen çiziyorsun, şehir kendi büyüyor". Tesis tarafında
  (istasyon, santral) seçim var.

## Bilinçli sapmalar

Plandan bilerek ayrılan yerler:

- **Ses varsayılan olarak açık** (§15 kapalı diyordu). Kapalı bir ses anahtarı
  kimse bulamazsa oyun herkes için sessiz kalır; tarayıcının jest kilidi zaten
  ilk dokunuştan önce hiçbir sesin çıkamayacağını garanti ediyor. Anahtar sağ
  kenarda, tek dokunuş uzakta.

## Ölçüm notu

Bu sanal ortamda GPU yok; Chromium yazılımla çiziyor ve saniyede bir kare
civarında kalıyor. Tarayıcı üzerinden yapılan etkileşim ölçümleri bu yüzden
güvenilmez — birkaç kez var olmayan hatalar "bulundu". Doğrulama yöntemi:
şehri Node içinde kur, kayıt kodeğiyle tarayıcıya enjekte et, sonucu oku.
`addInitScript` her gezinmede yeniden çalışır; devretme sayfayı yenilediği
için şehri koşulsuz ekmek, testin kendi yarattığı bir hatayı "kanıtlamasına"
yol açar.

## Testler

`tests/growth.test.ts` uzun vadeli testleri tutar ve özellikle önemlidir:
kısa entegrasyon testlerinin hepsi *ölü* bir şehirde de geçer — üç saniye sonra
ilk binalar doğmuş, vergi akmaya başlamıştır ve sonra hiçbir şey olmaz. Oyunun
bir dönem tam olarak bu durumda olduğu için, denge değişiklikleri bu dosyaya
karşı doğrulanmalıdır.
