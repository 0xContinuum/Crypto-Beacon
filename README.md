# Beacon: Kripto Analiz Terminali (Telegram Mini App)

BTC ve majör kriptolar için canlı mum grafiği, özel **Beacon skoru** (−100..+100), kısa/uzun vade eğilimi, çoklu zaman dilimi tarayıcısı ve **geriye dönük test laboratuvarı**. Gelir: Adsgram ödüllü reklam (isteğe bağlı, 30 dk Pro).

Sunucu yoktur: tamamen statik, istemci tarafı. Veri Binance'in herkese açık mum uç noktasından gelir.

## Klasörler
```
web/            yayınlanan uygulama (index.html, css, js, fonts)
  js/engine.js  göstergeler, skor, tetik, işlem simülasyonu (saf fonksiyonlar)
  js/chart.js   bağımlılıksız canvas mum grafiği
  js/data.js    Binance verisi, önbellek, yedek uç noktalar
  js/app.js     arayüz, Pro/Adsgram, Telegram entegrasyonu
  js/config.js  ← Adsgram blok kimliği burada
tests/          engine.test.js (37), ref.py (bağımsız Python referansı), ui.test.js (37, Playwright)
render.yaml     Render ücretsiz Static Site
```

## Yayına alma
1. GitHub'a yükleyin, Render'da **New → Blueprint** ile `render.yaml`'ı seçin (veya Static Site, publish dir `web`).
2. BotFather: botunuza Mini App tanımlayıp URL olarak Render adresini girin.
3. Adsgram: **yeni platform ve yeni ödüllü blok** oluşturun (mevcut Continuum bloğunu kullanmayın), kimliği `web/js/config.js` içine `adsgramBlockId` olarak yazın. Moderasyonda şunu net anlatın: reklam isteğe bağlıdır, uygulama reklam olmadan tam kullanılır.
4. Test: `index.html?demo=1` sahte reklam oynatır (yalnızca test).

## Testler
```
python3 tests/ref.py && node tests/engine.test.js     # motor, 37 test
node tests/ui.test.js                                  # arayüz, sahte veriyle, 37 test
```

## Dürüst notlar
- **Motorun avantajı kanıtlanmadı.** Testler hesapların doğru olduğunu gösterir, stratejinin kazandırdığını değil. Gerçek veride, farklı dönemlerde (walk-forward) doğrulayın. Sentetik veri sonuçları anlamsızdır.
- Pro kilidi istemci tarafıdır; teknik kullanıcı aşabilir. Kilitlenen şey değerli bir ürün değil, kolaylıktır. Ücretli Pro (Stars) için sunucu doğrulaması gerekir (Faz 2).
- Binance bazı ülkelerde/ağlarda engelli olabilir; uygulama üç adres dener ve hata durumunda "Tekrar dene" gösterir. Kraken yedeği eklenmedi.
- Dilde "AL/SAT" yoktur; "eğilim, tetik, geçersizlik seviyesi, hedef" kullanılır ve ilk açılışta yasal uyarı onayı istenir. Bu hukuki güvence değildir.

## Faz 2 (önerilen)
Sunucuda zaman damgalı ileri-dönük sinyal kaydı (en güçlü güven kanıtı), bot uyarıları, Telegram Stars ile Pro, sanal bakiyeli kağıt-ticaret ligleri (kanal ortaklığı modeli burada daha temizdir).

## Lisans
Inter yazı tipi SIL OFL 1.1 (`web/fonts/OFL-NOTICE.txt`). Kod sizindir.
