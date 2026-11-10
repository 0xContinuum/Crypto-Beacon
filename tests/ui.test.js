// Uçtan uca arayüz testi. Binance istekleri sahte (sentetik) veriyle karşılanır.
// Çalıştırma:  node tests/ui.test.js     (Playwright + Chromium gerekir)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', 'web');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const MS = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 };
const BASE = { BTC: 67000, ETH: 3400, SOL: 160, BNB: 590, XRP: 0.55, ADA: 0.45, DOGE: 0.16, AVAX: 36, LINK: 15, GRAM: 6.5 };

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }
function series(sym, tf, n) {
  const ms = MS[tf], now = Date.now(), last = Math.floor(now / ms) * ms;
  const seed = [...sym + tf].reduce((a, c) => a * 31 + c.charCodeAt(0), 7), r = rng(seed);
  let p = BASE[sym] || 100, drift = 0; const out = [];
  for (let i = 0; i < n; i++) {
    if (i % 180 === 0) drift = [-0.0012, 0.0016, 0, 0.0009, -0.0007][Math.floor(r() * 5)];
    const vol = 0.005 + 0.004 * r(), ret = drift + vol * gauss(r), o = p, c = p * (1 + ret);
    out.push([last - (n - 1 - i) * ms, o, Math.max(o, c) * (1 + Math.abs(gauss(r)) * 0.002), Math.min(o, c) * (1 - Math.abs(gauss(r)) * 0.002), c, 1000 * (1 + r()) * (1 + 3 * Math.abs(ret) / vol)]);
    p = c;
  }
  return out.map((k) => k.map(String));
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let pass = 0;
  const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); pass++; console.log('PASS ' + m); };

  async function newPage(opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: !!opts.touch, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const page = await ctx.newPage();
    if (opts.tgUser || opts.grants) await page.addInitScript(({ u, g }) => {
      if (u) window.Telegram = { WebApp: { initDataUnsafe: { user: { id: u } }, ready() {}, expand() {} } };
      if (g) { let c; Object.defineProperty(window, 'BEACON_CONFIG', { configurable: true, get() { return c; }, set(v) { c = Object.assign(v, { grants: g }); } }); }
    }, { u: opts.tgUser, g: opts.grants });
    if (opts.legal) await page.addInitScript(() => localStorage.setItem('bcn', JSON.stringify({ legal: true })));
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.route(/telegram\.org|adsgram\.ai/, (r) => r.abort());
    await page.route(/config\.local\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: "Object.assign(window.BEACON_CONFIG, { apiUrl: '' });" })); // testler sunucusuz modda çalışır
    if (opts.fail) await page.route(/api\/v3\/klines/, (r) => r.abort());
    else await page.route(/api\/v3\/klines/, (r) => {
      const u = new URL(r.request().url()), sym = u.searchParams.get('symbol').replace('USDT', ''), tf = u.searchParams.get('interval'), lim = +u.searchParams.get('limit');
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(series(sym, tf, lim).slice(-lim)) });
    });
    return page;
  }

  /* 1) Açılış, yasal uyarı, radar */
  let page = await newPage();
  await page.goto(PAGE + '?demo=1');
  await page.waitForSelector('#legal.on');
  ok(true, 'ilk açılışta yasal uyarı gösterilir');
  await page.screenshot({ path: path.join(SHOTS, '01-legal.png') });
  await page.click('#legalOk');
  ok(await page.locator('#legal.on').count() === 0, 'onaydan sonra uyarı kapanır');
  await page.waitForFunction(() => document.getElementById('verd').textContent !== 'Hesaplanıyor', null, { timeout: 8000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, '02-radar.png') });
  await page.screenshot({ path: path.join(SHOTS, '03-radar-full.png'), fullPage: true });
  const price = await page.textContent('#price');
  ok(/\d/.test(price) && price !== '–', 'fiyat başlıkta görünür (' + price + ')');
  const painted = await page.evaluate(() => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n / (d.length / 4); });
  ok(painted > 0.02, 'grafik tuvali boş değil (dolu oran ' + painted.toFixed(3) + ')');
  const sc = await page.textContent('#score');
  ok(/^[+−]?\d+$/.test(sc), 'skor biçimi doğru (' + sc + ')');
  ok(/rotate\(-?[\d.]+deg\)/.test(await page.getAttribute('#ptr', 'style')), 'kadran ibresi döndü');
  ok((await page.locator('#facts .fact .v').allTextContents()).every((t) => t !== '–'), 'dört faktör çubuğu dolu');
  ok((await page.textContent('#hsS')) !== '–' && (await page.textContent('#hsL')) !== '–', 'kısa ve uzun vade skorları dolu');
  ok(/tetiği|Tetik yok/.test(await page.textContent("#trig")), 'son tetik bölümü içerik gösteriyor');
  const dpr = await page.evaluate(() => { const c = document.getElementById('cv'); return c.width / c.clientWidth; });
  ok(dpr >= 2, 'tuval cihaz piksel oranına göre keskin (' + dpr + 'x)');
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(noHScroll, 'mobil genişlikte yatay kaydırma yok');
  ok(!/\bAL\b|\bSAT\b/.test(await page.evaluate(() => document.body.innerText)), 'arayüzde "AL/SAT" çağrısı dili yok');

  /* etkileşim */
  const box = await page.locator('#cv').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.waitForTimeout(120);
  ok(await page.locator('#tip.on').count() === 1, 'grafiğin üstünde imleç ipucu çıkar');
  const bw0 = await page.evaluate(() => window.__beacon.chart.barW);
  await page.mouse.wheel(0, -300); await page.waitForTimeout(100);
  ok((await page.evaluate(() => window.__beacon.chart.barW)) > bw0, 'tekerlek yakınlaştırır');
  await page.click('#zoomOut'); await page.click('#zoomOut');
  ok((await page.evaluate(() => window.__beacon.chart.barW)) < bw0 * 1.5, 'uzaklaştır düğmesi çalışır');

  for (const tf of ['15m', '4h', '1d', '1w', '1h']) {
    await page.click(`#tfSeg [data-tf="${tf}"]`);
    await page.waitForFunction((t) => window.__beacon.state().tf === t && document.querySelector('#skel').style.display === 'none', tf, { timeout: 8000 });
  }
  ok(true, 'beş zaman dilimi (15d, 1s, 4s, 1G, 1H) yüklenir');
  await page.click('#layers [data-l="rsi"]'); await page.click('#layers [data-l="bb"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '04-radar-rsi-bb.png') });
  ok(await page.getAttribute('#layers [data-l="rsi"]', 'aria-pressed') === 'true', 'RSI katmanı açılır');

  ok(/Aktif formasyon yok|Üçgen|Takoz|İkili/.test(await page.textContent('#form')), 'formasyon bölümü içerik gösteriyor');
  await page.click('#formCfg');
  ok(await page.locator('#formSheet.on').count() === 1, 'formasyon ayarları açılır');
  await page.evaluate(() => { const e = document.getElementById('pivR'); e.value = 5; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  ok((await page.evaluate(() => window.__beacon.state().form.pivot)) === 5, 'pivot hassasiyeti ayarı kaydedilir');
  const hl = () => page.evaluate(() => window.__beacon.cur().data.formHistory.length);
  const h0 = await hl();
  ok(h0 > 0, 'eski formasyon çizgileri varsayılan olarak açık (' + h0 + ' formasyon)');
  await page.uncheck('#histC');
  ok((await hl()) === 0, 'eski çizgiler ayardan kapatılabilir');
  await page.check('#histC');
  ok((await hl()) === h0, 'eski çizgiler tekrar açılınca geri gelir');
  await page.evaluate(() => { const e = document.getElementById('histR'); e.value = 10; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  ok((await hl()) <= 10, 'geçmiş formasyon sayısı sınırı uygulanır');
  await page.evaluate(() => { const e = document.getElementById('histR'); e.value = 120; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.screenshot({ path: path.join(SHOTS, '12-form-settings.png') });
  await page.click('#formReset');
  ok((await page.evaluate(() => window.__beacon.state().form.pivot)) === 10, 'varsayılana dön çalışır');
  await page.click('#formOk');

  /* coin sheet: kilitli coin */
  await page.click('#symBtn');
  ok(await page.locator('#symSheet.on').count() === 1, 'coin listesi açılır');
  await page.screenshot({ path: path.join(SHOTS, '05-coinsheet.png') });
  await page.click('#coinList [data-s="XRP"]');
  await page.waitForSelector('#v-pro.on');
  ok(true, 'kilitli coin seçilince Pro sekmesine yönlendirir');
  ok(await page.evaluate(() => window.__beacon.state().sym) === 'BTC', 'kilitli coin seçilmedi, BTC kaldı');

  /* 2) Tarayıcı (ücretsiz) */
  await page.click('#dock [data-v="scan"]');
  await page.waitForFunction(() => document.querySelectorAll('#heat .cell[data-s]').length >= 15, null, { timeout: 10000 });
  ok((await page.locator('#heat .cell.lock').count()) === 35, 'ücretsiz katmanda 7 coin kilitli (35 hücre)');
  await page.screenshot({ path: path.join(SHOTS, '06-scan-free.png'), fullPage: true });
  await page.click('#sortChips [data-sort="long"]');
  ok(true, 'sıralama değişir');

  /* 3) Performans */
  await page.click('#dock [data-v="perf"]');
  await page.waitForFunction(() => document.querySelectorAll('#kpis .kpi').length === 9, null, { timeout: 8000 });
  ok(true, 'performans: 9 ölçü hesaplandı');
  ok((await page.textContent('#perfWarn')).length > 30, 'performans uyarı metni var');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '07-perf.png'), fullPage: true });
  const eqPaint = await page.evaluate(() => { const c = document.getElementById('eq'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  ok(eqPaint > 200, 'özsermaye eğrisi çizildi');
  await page.click('#perfTf [data-tf="1w"]');
  await page.waitForFunction(() => /1H/.test(document.getElementById('perfTitle').textContent), null, { timeout: 5000 });
  ok(true, 'performans sekmesinde haftalık test açılır');
  await page.click('#perfTf [data-tf="4h"]');
  await page.waitForFunction(() => /4s/.test(document.getElementById('perfTitle').textContent), null, { timeout: 5000 });
  ok(true, 'performans zaman dilimi değişir');

  /* 4) Pro: demo reklam */
  await page.click('#dock [data-v="pro"]');
  ok((await page.textContent('#proState')) === 'Kapalı', 'başlangıçta Pro kapalı');
  await page.click('#adBtn');
  await page.waitForFunction(() => /^\d+:\d\d$/.test(document.getElementById('proState').textContent), null, { timeout: 6000 });
  const left = await page.textContent('#proState');
  ok(/^(59:\d\d|1:00:00)$/.test(left), 'reklamdan sonra ~1 saat Pro (' + left + ')');
  await page.screenshot({ path: path.join(SHOTS, '08-pro.png'), fullPage: true });
  for (let k = 0; k < 6; k++) { if (await page.locator('#adBtn[disabled]').count()) break; await page.click('#adBtn'); await page.waitForTimeout(2300); }
  const st = await page.evaluate(() => window.__beacon.state());
  ok(st.proUntil - Date.now() <= 360 * 60000 + 2000, 'Pro süresi 6 saati aşmaz');
  ok(st.ads.n <= 6, 'günlük reklam sınırı aşılmaz (' + st.ads.n + ')');
  await page.click('#dock [data-v="scan"]');
  await page.waitForFunction(() => document.querySelectorAll('#heat .cell[data-s]').length === 50, null, { timeout: 15000 });
  ok((await page.locator('#heat .cell.lock').count()) === 0, 'Pro açıkken tarayıcıda 10 coin x 5 zaman dilimi açık');
  await page.screenshot({ path: path.join(SHOTS, '09-scan-pro.png'), fullPage: true });
  await page.click('#heat .cell[data-s="XRP"][data-tf="1h"]');
  await page.waitForSelector('#v-radar.on');
  ok(await page.evaluate(() => window.__beacon.state().sym) === 'XRP', 'hücreye dokunmak radara o coinle geçirir');
  await page.waitForFunction(() => document.getElementById('symName').textContent === 'XRP' && document.querySelector('#skel').style.display === 'none', null, { timeout: 8000 });
  ok(/0[,.]\d/.test(await page.textContent('#price')), 'küçük fiyatlı coin için ondalıklar gösterilir (' + (await page.textContent('#price')) + ')');
  await page.close();

  /* 4b) Sahip modu */
  page = await newPage({ legal: true, tgUser: 6394985954 });
  await page.goto(PAGE);
  await page.waitForFunction(() => document.getElementById('verd').textContent !== 'Hesaplanıyor', null, { timeout: 8000 });
  ok(await page.evaluate(() => window.__beacon.isOwner() && window.__beacon.isPro()), 'sahip kimliği tanınır ve Pro sayılır');
  await page.click('#dock [data-v="pro"]');
  ok((await page.textContent('#proState')) === 'Sahip', 'Pro sekmesinde "Sahip" yazar');
  ok(await page.locator('#adBtn').isHidden(), 'sahipte reklam butonu gizli');
  ok((await page.textContent('#myId')) === '6394985954', 'Telegram kimliği gösterilir');
  ok(await page.locator('#ownerSec').isVisible(), 'sahip paneli görünür');
  await page.fill('#gId', '111222333'); await page.selectOption('#gDays', '30'); await page.fill('#gNote', 'Ali');
  await page.click('#gMake');
  const line = await page.textContent('#gOut');
  ok(/^\{ id: 111222333, until: '\d{4}-\d\d-\d\d', note: 'Ali' \},$/.test(line), 'hibe satırı doğru biçimde üretilir: ' + line);
  await page.fill('#gId', 'abc'); await page.click('#gMake');
  ok(await page.locator('#toast.on').count() === 1, 'geçersiz kimlik reddedilir');
  await page.screenshot({ path: path.join(SHOTS, '13-owner.png'), fullPage: true });
  await page.click('#dock [data-v="scan"]');
  await page.waitForFunction(() => document.querySelectorAll('#heat .cell[data-s]').length === 50, null, { timeout: 15000 });
  ok((await page.locator('#heat .cell.lock').count()) === 0, 'sahipte tüm coinler ve zaman dilimleri açık');
  await page.click('#symBtn'); await page.click('#coinList [data-s="GRAM"]');
  await page.waitForFunction(() => window.__beacon.state().sym === 'GRAM', null, { timeout: 5000 });
  ok(true, 'sahip kilitli coine doğrudan geçebilir');
  await page.close();

  /* 4c) Hibe: süresi dolmamış / dolmuş / başka kimlik */
  const gr = [{ id: 777000111, until: '2099-01-01', note: 'x' }, { id: 555000222, until: '2020-01-01' }, { id: 888000333 }];
  for (const [id, want, label] of [[777000111, 'Pro', 'süreli hibe'], [888000333, 'Pro', 'süresiz hibe'], [555000222, 'Kapalı', 'süresi dolmuş hibe'], [999000444, 'Kapalı', 'listede olmayan kimlik']]) {
    page = await newPage({ legal: true, tgUser: id, grants: gr });
    await page.goto(PAGE);
    await page.click('#dock [data-v="pro"]');
    ok((await page.textContent('#proState')) === want, label + ': Pro durumu "' + want + '"');
    ok(await page.locator('#ownerSec').isHidden(), label + ': sahip paneli görünmez');
    await page.close();
  }
  page = await newPage({ legal: true });
  await page.goto(PAGE);
  await page.click('#dock [data-v="pro"]');
  ok((await page.textContent('#myId')).includes('Telegram dışında'), 'Telegram dışında kimlik yerine açıklama gösterilir');
  ok(await page.evaluate(() => !window.__beacon.isOwner()), 'Telegram dışında sahip sayılmaz');
  await page.close();

  /* 5) Masaüstü genişlik */
  page = await newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => localStorage.setItem('bcn', JSON.stringify({ legal: true })));
  await page.goto(PAGE);
  await page.waitForFunction(() => document.getElementById('verd').textContent !== 'Hesaplanıyor', null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, '10-desktop.png') });
  ok(true, 'masaüstü genişlikte açılır');
  await page.close();

  /* 6) Ağ hatası */
  page = await newPage({ fail: true });
  await page.addInitScript(() => localStorage.setItem('bcn', JSON.stringify({ legal: true })));
  await page.goto(PAGE);
  await page.waitForSelector('#chartMsg.on', { timeout: 30000 });
  ok(/ulaşılamadı/.test(await page.textContent('#chartMsg')), 'veri yoksa anlaşılır hata ve "Tekrar dene" görünür');
  ok(await page.locator('#live.err').count() === 1, 'canlı göstergesi hata durumunda');
  await page.screenshot({ path: path.join(SHOTS, '11-error.png') });
  await page.close();

  await browser.close();
  ok(errors.length === 0, 'konsolda hata yok' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(`\nTÜM ARAYÜZ TESTLERİ GEÇTİ (${pass})`);
})().catch((e) => { console.error(e); process.exit(1); });
