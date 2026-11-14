# Beacon: Kripto Analiz Terminali (Telegram Mini App)

BTC ve majör kriptolar için canlı mum grafiği (15d, 1s, 4s, 1G, 1H), özel **Beacon skoru** (−100..+100), kısa/uzun vade eğilimi, **Formasyon Merkezi** (üçgen, takoz, ikili tepe/dip), çoklu zaman dilimi tarayıcısı ve **geriye dönük test laboratuvarı**. Gelir: Adsgram ödüllü reklam (isteğe bağlı, 30 dk Pro).

Sunucu yoktur: tamamen statik, istemci tarafı. Veri Binance'in herkese açık mum uç noktasından gelir.

## Klasörler
```
web/            yayınlanan uygulama (index.html, css, js, fonts)
  js/engine.js  göstergeler, skor, tetik, işlem simülasyonu (saf fonksiyonlar)
  js/chart.js   bağımlılıksız canvas mum grafiği
  js/formation.js  Pine göstergesinin JS karşılığı (aşağıya bakın)
  js/data.js    Binance verisi, önbellek, yedek uç noktalar
  js/app.js     arayüz, Pro/Adsgram, Telegram entegrasyonu
  js/config.js  ← Adsgram blok kimliği burada
tests/          engine.test.js (37), formation.test.js (31), ref.py (bağımsız Python referansı), ui.test.js (65, Playwright)
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
node tests/formation.test.js                           # formasyon, 31 test
node tests/ui.test.js                                  # arayüz, sahte veriyle, 65 test
```

## Formasyon Merkezi (Pine'dan taşıma)
`web/js/formation.js`, "Gelişmiş Formasyon Merkezi V2 [AlperA]" göstergesinin mantığını taşır (orijinal kod © AlperA2259, MPL 2.0; bu dosya türev olduğu için başlığındaki notu koruyun). Aynı: pivot, son iki tepe/dip, yataylık toleransı, üçgen ve takoz kuralları. **Bilerek farklı:**
- Pine aynı formasyonu her mumda yeniden çizer (aynı çizgi yüzlerce kez). Burada her benzersiz formasyon bir kez kaydedilir ve **eskiler silinmez**: geçmiş formasyonların çizgileri soluk renkte kalır, güncel olan kalındır (destek/direnç bölgeleri için). Ayarlardan kapatılabilir; varsayılan sınır en yeni 120 formasyondur.
- Eğim mum başına hesaplanır (Pine iki pivot arasındaki fiyat farkını kıyaslıyor; pivotlar arası mesafe farklıysa yanlış sonuç verir).
- Üst çizgisi neredeyse yatay olan yapı "yükselen takoz" diye ezilmez, yükselen üçgen kalır.
- Kırılım durumu gerçekten hesaplanır; ikili tepe/dip eklendi (Pine'da seçenek vardı, mantığı yoktu).
- Yalnızca *güncel* sayılan formasyon için 6×hassasiyet mumluk bayat kontrolü vardır; geçmiş çizgiler bundan etkilenmez.
Sonuçlar TradingView'dakiyle birebir aynı olmayabilir. Ayarlar (hassasiyet, tolerans) Radar'da Formasyon bölümündeki dişli simgesindedir.

## Sahip ve Pro verme
`web/js/config.js` içinde `ownerIds` (sahip kimlikleri, süresiz tam erişim) ve `grants` (başkalarına Pro) vardır. Pro sekmesi kullanıcının Telegram kimliğini gösterir; sahip, aynı sekmede kimlik ve süre girip `grants` için hazır satır üretebilir. Satırı `config.js`'e ekleyip GitHub'a gönderin.
**Güvenlik:** uygulamada sunucu yok, kimlik istemciden okunur ve doğrulanmaz; teknik biliği olan biri taklit edebilir. Kilitlenen şey değerli bir ürün değil, kolaylıktır. Para karşılığı satılacak bir özellik için kimliği sunucuda `initData` imzasıyla doğrulamak gerekir.

## Topluluk platformu (sunucu)

Yayıncılar (grup kurucuları) yalnızca sahibin eklediği kişilerdir. Paylaşımlar önce sahip onayından geçer. Yayıncı sayfasından izlenen
reklamların geliri yayıncıya (%50, kişi başı değiştirilebilir), Pro sayfasından izlenenler sahibe yazılır.

**Kurulum (sırayla)**
1. Neon'da ücretsiz Postgres açın, bağlantı adresini kopyalayın (`DATABASE_URL`).
2. Render'da `beacon-api` servisini oluşturun (render.yaml). Ortam değişkenleri: `BOT_TOKEN`, `DATABASE_URL`, `ADSGRAM_SECRET` (uzun rastgele), `WEBHOOK_SECRET`, `APP_URL`, `PUBLIC_URL` (API adresi), `ADMIN_IDS`.
3. `web/js/config.js` içinde `apiUrl` alanına API adresini yazın, GitHub'a gönderin.
4. Adsgram panelinde Reward URL: `https://<api>.onrender.com/api/adsgram/reward?userid=[userId]&secret=<ADSGRAM_SECRET>`
5. BotFather: botun Mini App adresini statik sitenin adresi yapın. Bot `/start`'a yanıt verir (webhook sunucu açılışında kaydedilir).
6. UptimeRobot ile `https://<api>.onrender.com/healthz` adresini 5 dakikada bir çağırın (ücretsiz plan uyku modunu önler).
7. Uygulamada Hesap > Yönetim bölümünden yayıncı ekleyin.

**Günlük işleyiş**: Her sabah Adsgram panelinden dünün gösterim ve CPM değerini Yönetim > Günlük gelir girişi'ne girin. Adsgram ödemesi
hesabınıza geçince "tahsil edildi" işaretleyin; yayıncı bakiyesi ancak o zaman çekilebilir olur. Ödeme talebinde cüzdana kendiniz gönderin, txid yazıp "Ödendi" deyin.

**Hesaplama**: yayıncı kazancı = günlük gelir × (yayıncının doğrulanmış reklamı / max(Adsgram gösterimi, bizim kaydımız)) × pay. Tüm tutarlar tam sayı mikro-dolardır.

**Testler**: `python3 -I server/tests/test_core.py`, `python3 -I server/tests/test_api.py`, `node tests/e2e.test.js`, `node tests/desktop.test.js`, `node tests/tools.test.js`.
Yerelde denemek için `DEV_MODE=1` ile sunucuyu açıp uygulamayı `?demo=1&dev=<kimlik>` ile açın (yalnızca geliştirme; canlıda asla açmayın).

**Yasal ve riskler (avukat değilim)**: Ödeme yaptığınız kişilerin içeriği nedeniyle SPK mevzuatı (izinsiz yatırım danışmanlığı, menfaat sağlama) ve vergi konuları gündeme gelebilir. İlk ödemeden önce bir avukat ve mali müşavirden görüş alın. Adsgram kendi içerik kurallarını uygular; reklam hesabınız için ayrı bir başvuru önerilir. İçerik filtresi ilk savunma hattıdır, asıl güvence admin onayıdır.

## Ayarlarınızı korumak: config.local.js
`web/js/config.js` her yeni sürümde değişir. Size özel değerleri (Adsgram blok kimliği, `webAds` vb.) `web/js/config.local.js` dosyasına yazın; bu dosya varsa config.js'in üzerine yazar ve yeni sürüm yüklerken ezilmez. Örnek:
```js
Object.assign(window.BEACON_CONFIG, { adsgramBlockId: '12345' });
```
`apiUrl` varsayılan olarak API adresinize ayarlıdır. Boş olursa Topluluk ve Hesap sekmeleri görünmez (sunucusuz mod).

## Grafik araçları
- **Tam ekran:** Radar grafiğinde ⛶ düğmesi (Esc ile çıkış). Piyasa göstergesi kartına dokununca tam ekran açılır.
- **Görsel indir/paylaş:** Radar ve piyasa grafiklerinde ⬆ düğmesi. Görsele Beacon adı, logosu, bot bağlantısı ve silik filigran eklenir; indir, paylaş (cihaz paylaşım menüsü) veya kopyala.
- **Yayıncı paylaşımları:** Görsel yükleme (otomatik küçültülür) ve YouTube video bağlantısı. Video dosyası barındırmıyoruz (maliyet ve moderasyon yükü); video oynatılmadan önce isteğe bağlı kısa reklam gösterilir, reklam yoksa video yine açılır. Reklam geliri yayıncıya yazılır.

## Piyasa göstergeleri, özel göstergeler, GRAM
- **Piyasa sekmesi** (`web/js/market.js`, `market-ui.js`): Bitcoin günlük verisinden kendi hesabımızla Pi Cycle Top, Mayer Çarpanı (herkese açık); 200 haftalık ortalama, 2 yıllık ortalama çarpanı, regresyon bandı (Rainbow benzeri) ve halving döngüsü (Pro). Hiçbir üçüncü taraf siteden veri kopyalanmaz.
- **Özel gösterge** (`web/js/script.js`): Pro kullanıcı grafikte "ƒx" ile kendi formülünü yazar (`ema`, `sma`, `rsi`, `atr`, `plot`, `pane`...). Formüller `eval` ile değil kendi ayrıştırıcımızla çalışır; pencere/belge erişimi yoktur. Göstergeler hesapta saklanır.
- **GRAM**: Toncoin, 15 Haziran 2026'da GRAM adını aldı (ağ adı TON kalıyor). Eski kayıtlı TON seçimi otomatik GRAM'a çevrilir.

## Web sürümü (masaüstü terminali) ve reklamlar
Aynı uygulama (`web/`) tarayıcıda açılınca **masaüstü terminali** olur: ≥1100 px genişlikte sol menü, büyük grafik, yan panel, çok sütunlu Piyasa ve Topluluk. Telegram içinde mini uygulama olarak çalışmaya devam eder. Tek yayın, tek adres; kendi alan adınızı Render'da bu siteye bağlayın.
- **Giriş:** Tarayıcıda "Telegram ile giriş" düğmesi bir doğrulama kodu üretir, botu açtırır ve botta "Girişi onayla" düğmesine basılmasını bekler. BotFather'da alan adı (`/setdomain`) tanımlamaya gerek yoktur. Bot webhook'u çalışmalıdır (API servisi açılışta kaydeder). Kod 10 dakika geçerli ve tek kullanımlıktır; onay için botta kodun eşleşmesi gerekir, bu yüzden başkasının gönderdiği bağlantıyla girişe zorlanılamaz. `telegramBot` ayarı bot kullanıcı adıdır.
- **Pro:** Reklamla Pro yalnızca Telegram'da (Adsgram) kazanılır; web, aynı hesabın Pro durumunu gösterir.
- **Web reklamı:** `web/js/config.js` içinde `webAds` boşsa hiç reklam görünmez. Google AdSense için `{ provider: 'adsense', client: 'ca-pub-...', slots: { a: '...', b: '...' } }`. Reklam, ziyaretçi onayından sonra yüklenir, Telegram içinde asla gösterilmez. AB/BK ziyaretçileri için Google onaylı bir onay aracı (CMP) gerekir; yerleşik kutu onun yerine geçmez. AdSense onayı kripto içerikte gecikebilir ya da çıkmayabilir.
- **Tanıtım sayfası:** `web/hakkinda/` (özellikler, SSS, yasal metinler).
- **Tanıtım videosu:** `node video/build.js` uygulamanın örnek verili ekranlarından sessiz video, `altyazi.srt` ve `seslendirme.txt` üretir.

## Dürüst notlar
- **Motorun avantajı kanıtlanmadı.** Testler hesapların doğru olduğunu gösterir, stratejinin kazandırdığını değil. Gerçek veride, farklı dönemlerde (walk-forward) doğrulayın. Sentetik veri sonuçları anlamsızdır.
- Pro kilidi istemci tarafıdır; teknik kullanıcı aşabilir. Kilitlenen şey değerli bir ürün değil, kolaylıktır. Ücretli Pro (Stars) için sunucu doğrulaması gerekir (Faz 2).
- Binance bazı ülkelerde/ağlarda engelli olabilir; uygulama üç adres dener ve hata durumunda "Tekrar dene" gösterir. Kraken yedeği eklenmedi.
- Dilde "AL/SAT" yoktur; "eğilim, tetik, geçersizlik seviyesi, hedef" kullanılır ve ilk açılışta yasal uyarı onayı istenir. Bu hukuki güvence değildir.

## Faz 2 (önerilen)
Sunucuda zaman damgalı ileri-dönük sinyal kaydı (en güçlü güven kanıtı), bot uyarıları, Telegram Stars ile Pro, sanal bakiyeli kağıt-ticaret ligleri (kanal ortaklığı modeli burada daha temizdir).

## Lisans
Inter yazı tipi SIL OFL 1.1 (`web/fonts/OFL-NOTICE.txt`). Kod sizindir.

## Pine çevirici (Pro)
Göstergelerim → "Pine Script'ten çevir". Kural tabanlıdır, sunucu ve maliyet gerektirmez; `web/js/pine.js`.
- Çevrilenler: input.* (sabite), ta.* göstergeleri, math.*, `x[1]`, `var` + `:=` durum kalıpları (`hold()`), plot/plotshape/plotchar ve `if` içindeki `label.new` (grafikte `mark()` işareti), `[a,b,c] = ta.macd/ta.bb`, kendi yazdığınız fonksiyonlar (çağrıldığı yerde açılır) ve sabit metin seçenekleri (`input.string` varsayılanı).
- Çevrilmeyenler (yorum olarak kalır, nedeni raporlanır): strategy, request.security, for/while, diziler, tablo/çizgi/kutu, bgcolor/barcolor/fill, alert. Bunlar Aşama 2 kapsamındadır.
- Pro olmayanlar mevcut "reklam izle → 1 saat Pro" ile kullanır.
- Test: `node tests/pine.test.js` (tests/fixtures/pine altındaki gerçek kodlarla).

## Faz 2: semboller, perpetual, endeksler, takip listeleri
- **Semboller:** ilk 100 coin (statik sıra, açılışta canlı Binance listesiyle süzülür), perpetual için `BTC.P` biçimi (Binance fapi), endeksler `$TOTAL`, `$TOTAL2`, `$TOTAL3`, `$BTCD`, `$USDTD`. Seçicide isim ya da sembolle arama; aramada ilk 100 dışındaki tüm Binance USDT pariteleri de bulunur.
- **Endeksler:** sunucu CoinGecko'dan ilk 100 coinin 1 yıllık günlük piyasa değerini çekip hesaplar (`server/mkt.py`), veritabanında saklar, 12 saatte bir yeniler. Yalnızca günlük/haftalık. İlk kurulumda hazır olması birkaç dakika sürer. Değerler ilk 100 toplamıdır, TradingView'daki gerçek TOTAL/dominanstan birkaç puan farklı çıkabilir. Hız sınırı için isteğe bağlı `COINGECKO_KEY`.
- **Pro:** takip listeleri (en çok 5 liste, her biri 40 parite) ve tarayıcıda "Takip listem" kapsamı (en çok 20 parite). Ücretsiz: BTC, ETH, SOL, BTC.P, TOTAL, BTC.D.
- Test: `node tests/faz2.test.js`, `python -m unittest server.tests.test_mkt`.

## Telegram içinde görsel
Telegram'ın web görünümü indirme, paylaşma ve panoya kopyalamayı engellediği için "Sohbetime gönder" kullanılır: sunucu (`POST /api/me/photo`) görseli botun kullanıcıyla sohbetine yollar, oradan kaydedilir ya da iletilir. Kullanıcının bota bir kez /start yazmış olması gerekir. Saatte 8 görsel sınırı vardır.

## Endeksler (kapalı)
TOTAL/BTC.D/USDT.D kodu hazır ama kapalıdır. Açmak için `config.local.js` içinde `indexes: true` ve sunucuda `MARKET_AUTO=1`. Veri kaynağı kararı verilene kadar kapalı kalmalıdır.

## API'yi Vercel'de çalıştırma (Render yerine ya da yanında)
1. Bu klasörü GitHub'a koyun (kökte `vercel.json`, `api/index.py`, `requirements.txt`, `server/` olmalı). Vercel'de **Add New → Project**, repoyu seçin, Framework "Other", Root Directory = repo kökü.
2. Environment Variables: Render'dakilerin aynısı (`DATABASE_URL` Neon bağlantısı, `BOT_TOKEN`, `ADMIN_IDS`, `ADSGRAM_SECRET`, `WEBHOOK_SECRET`, `APP_URL`, `SITE_URL`) ve `PUBLIC_URL` = Vercel adresiniz (https://....vercel.app). `DEV_MODE` koymayın.
3. Telegram webhook'u Vercel'de otomatik kaydedilmez; bir kez tarayıcıdan ya da terminalden çalıştırın:
   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<VERCEL_ADRESI>/tg/webhook&secret_token=<WEBHOOK_SECRET>&allowed_updates=["message","callback_query"]`
4. Statik sitede `config.local.js` içindeki `apiUrl` değerini Vercel adresiyle değiştirin. Adsgram Reward URL'sini de yeni adrese çevirin: `<VERCEL_ADRESI>/api/adsgram/reward?userid=[userId]&secret=<ADSGRAM_SECRET>`.
5. Sınırlar: sunucusuz ortam, ilk istek (soğuk başlangıç) 1-3 sn sürebilir; istek sınırlayıcı (`rate`) bellekte tutulduğundan örnekler arasında paylaşılmaz (gevşek kalır); arka plan işleri (endeks yenileme) çalışmaz, zaten kapalı.


## Formül 2 (Pine'ın tamamına yakınını çalıştıran motor)
`web/js/script2.js`: mum mum çalışan, `eval` kullanmayan yorumlayıcı. `var`, `:=`, `if/else`, `for`, `while`, kendi fonksiyonlar, diziler/map, `request.security` (aynı sembolün üst zaman dilimi, son tamamlanan mum, yeniden boyama yok), `ta.*`, `math.*`, `str.*`, `color.*`, `plot/plotshape/plotchar/plotarrow/bgcolor/barcolor/hline/fill`, `label/line/box/table`, `strategy.entry` (işarete çevrilir).
Pine çevirici önce hafif v1'i dener; tam çeviremezse kodu `//@beacon2` başlığıyla Formül 2'ye geçirir. Güvenlik: adım ve süre sınırı (4 sn), 30.000 karakter, nesne sınırı. Desteklenmeyenler: başka sembol verisi, kendi OHLC mumu çizimi, matrix, gerçek strateji backtest'i.

## Özel zaman aralıkları (Pro)
`data.js`: kimlik `c<n><birim>` (m, h, d, w, M). Binance'te olmayanlar (2G, 14G, 2H, 2A...) temel mumlardan sabit takvime göre birleştirilir; geçmiş mumlar yarın değişmez. Zaman çubuğundaki "+" ile eklenir (en çok 8), hesaba bağlı eşitlenir.

## Eşitleme (web ↔ Telegram)
`GET/PUT /api/me/sync` + `web/js/sync.js`. Göstergeler, çizimler, özel aralıklar ve takip listeleri hesapta tutulur; öğe bazında "en yeni kazanır", silinenler mezar taşıyla işaretlenir, sürüm çakışmasında (409) yeniden birleştirilir. Tablo `user_sync` açılışta kendiliğinden oluşur.

## Çizim ve ölçüm araçları
`web/js/draw.js`: trend, ışın, yatay/dikey çizgi, paralel kanal, Fibonacci, dikdörtgen, not, cetvel (geçici), risk/ödül pozisyonu. Zaman+fiyat ile saklanır (TF değişince yerinde kalır), mıknatıs, kilit, gizle, geri al, kopyala. Ücretsiz: trend, yatay çizgi, cetvel (en çok 8 çizim); diğerleri Pro.

## Yeni göstergeler (sentetik veride sınanmış; gerçek veri sınaması için tools/validate_market.js)
- **Fırtına Barometresi** (piyasa, Pro): 7 günlük hareket büyüklüğü tahmini (yön değil). Kartta imleç/dokunuşla gün seçilir; altta BTC fiyatı aynı eksende.
- **Düşüş Tabanı** (piyasa, Pro): 30 günde bugünkü fiyattan en kötü düşüş (%90/%95) ve en iyi yükseliş sınırı; stop/kaldıraç mesafesi için. Sabit sınıra göre sakin/hareketli döneme uyar.
- **Beacon Rejim** (grafik katmanı, Pro): oynaklığa göre standartlaştırılmış getirilerde kayan Varyans Oranı. Yeşil/kırmızı: trend, mavi: geri dönüş, gri: belirsiz.
- Ay Fazı Sınaması kaldırıldı. Yay Gerilimi kodda duruyor ama kapalı (`showBow:true` ile açılır).
- Testler: `node tests/marketx.test.js`, `node tests/regime.test.js`, `node tests/view.test.js`.
- **Funding Rates** (piyasa, Pro): Binance BTCUSDT vadeli funding geçmişi (2019-09'dan, sayfalı), 7 günlük ortalama, altta BTC fiyatı; aşırı funding sonrası getiriler betimleyici olarak gösterilir.
- **Döngü Dip/Tepe Bölgeleri** (piyasa, Pro): fiyat tabanlı "döngü ısısı" (0-100); önceki döngülerin gerçek tepe/dipleri otomatik bulunup bölgelerle karşılaştırılır.
- Örnek kullanıcı göstergesi: `tests/fixtures/beacon/Denge_Hatti.beacon.txt` (ƒx Göstergelerim'e yapıştırın).
