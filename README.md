# Kadastro

Parmağınla haritaya yol çiziyorsun, şehir o yolların etrafında kendi kendine büyüyor.

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
| 4 | Çağlar, görevler, offline ilerleme | Tamam — teknoloji ağacı hariç |
| 5 | Cila, mahalle isimleri, performans, öğretici | Kısmen — yönlendirme ve mimari tamam |
| 6 | Prestij, alternatif haritalar, prosedürel ses | — |

## Bilinen eksikler

Bunlar bilerek açık bırakıldı, unutulmadı:

- **Yol çizimi köşegende basamaklı görünüyor.** Yollar kare kare çiziliyor;
  düzgün bir şerit için çizginin kendisi boyunca üretilmeleri gerekir.
- **Teknoloji ağacı yok.** `research` durumda tutuluyor ve `researchPerMinute`
  hesaplanabiliyor ama harcanacak bir yer yok.
- **Kredi sistemi yok.** Bakiye sıfırın altına inmiyor; §7'nin faiz ve taksit
  kuralları `balance.ts` içinde duruyor, kullanılmıyor.

## Testler

`tests/growth.test.ts` uzun vadeli testleri tutar ve özellikle önemlidir:
kısa entegrasyon testlerinin hepsi *ölü* bir şehirde de geçer — üç saniye sonra
ilk binalar doğmuş, vergi akmaya başlamıştır ve sonra hiçbir şey olmaz. Oyunun
bir dönem tam olarak bu durumda olduğu için, denge değişiklikleri bu dosyaya
karşı doğrulanmalıdır.
