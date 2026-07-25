# Kadastro

Parmağınla haritaya yol çiziyorsun, şehir o yolların etrafında kendi kendine büyüyor.

Vite + TypeScript, framework yok, tek `<canvas>` + Canvas 2D, sunucu yok, hesap yok.
Tüm grafikler prosedürel çizilir — projede sprite/ikon paketi yoktur.

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

- `src/sim/` saf TypeScript. `canvas`, `document`, `window`, `Math.random`, `Date.now` yok.
  Deterministik, seed'li, test edilebilir.
- `src/render/` sim durumunu okur, asla yazmaz.
- Tüm denge sayıları yalnızca `src/data/balance.ts` içinde.
- Oyun içi metinler yalnızca `src/data/strings.tr.ts` içinde. Kod ve yorumlar İngilizce.
- Hiçbir dosya 400 satırı geçmez.

## Faz durumu

| Faz | Kapsam | Durum |
| --- | --- | --- |
| 0 | İskelet, PWA, Safari düzeltmeleri, kamera, sabit zamanlı döngü, boş ızgara | Tamam |
| 1 | Arazi üretimi ve yol çizimi | Tamam |
| 2 | Bölgeler, binalar, temel ekonomi | Tamam |
| 3 | Trafik, şebekeler, hizmetler, difüzyon | — |
| 4 | Çağlar, teknoloji, görevler, olaylar, offline, kayıt | — |
| 5 | Cila, mahalle isimleri, performans, öğretici | — |
| 6 | Prestij, alternatif haritalar, prosedürel ses | — |
