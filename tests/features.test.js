// Piyasa göstergeleri, Pro kilidi ve kullanıcı göstergeleri. Çalıştırma: node tests/features.test.js
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'), assert = require('assert');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const http = require('http'), fsx = require('fs');
const WEBDIR = path.resolve(__dirname, '..', 'web');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff': 'font/woff' };
// file:// kaynağında localStorage kararsız olduğundan sayfa gerçek bir HTTP sunucusundan açılır
const srv = http.createServer((q, r) => { let f = path.join(WEBDIR, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f += 'index.html'; if (!f.startsWith(WEBDIR) || !fsx.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fsx.readFileSync(f)); }).listen(0);
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
let n = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); n++; console.log('PASS ' + m); };
const MS = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 };
function candle(sym, ms, t, i) { const c = (sym === 'BTC' ? 4000 : 100) * Math.exp(0.0016 * (ms === 864e5 ? i : i * ms / 864e5) + 0.25 * Math.sin(i / 90)); return [t, c * 0.998, c * 1.01, c * 0.99, c, 100 + (i % 9)]; }
async function mock(ctx) {
  await ctx.route(/binance\.(vision|com)/, (r) => {
    const u = new URL(r.request().url()), sym = (u.searchParams.get('symbol') || 'BTCUSDT').replace('USDT', ''), tf = u.searchParams.get('interval'), ms = MS[tf] || 36e5, lim = +u.searchParams.get('limit') || 500;
    const last = Math.floor(Date.now() / ms) * ms, firstT = tf === '1d' ? Date.UTC(2017, 7, 17) : last - 5000 * ms;
    const end = u.searchParams.get('endTime') ? +u.searchParams.get('endTime') : last, rows = [];
    for (let t = Math.min(end, last); t >= firstT && rows.length < lim; t -= ms) rows.push(candle(sym, ms, t, Math.round((t - firstT) / ms)));
    rows.reverse(); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows.map((x) => [x[0], String(x[1]), String(x[2]), String(x[3]), String(x[4]), String(x[5])])) });
  });
  await ctx.route(/adsgram|telegram\.org/, (r) => r.abort());
    await ctx.route(/config\.local\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: "Object.assign(window.BEACON_CONFIG, { apiUrl: '' });" })); // testler sunucusuz modda çalışır
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(); const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 }); await mock(ctx);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('bcn')) localStorage.setItem('bcn', JSON.stringify({ legal: true })); } catch (e) {} });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(String(e))); pg.on('dialog', (d) => d.accept());
    await pg.goto(PAGE + '?demo=1'); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 });

    ok(await pg.locator('#dock button').count() === 5, 'dock 5 sekme: Radar, Piyasa, Tarayıcı, Performans, Pro');
    ok(/GRAM/.test(await pg.evaluate(() => window.BeaconData.COINS.map((c) => c.s).join())) && !(await pg.evaluate(() => window.BeaconData.COINS.some((c) => c.s === 'TON'))), 'coin listesinde TON yerine GRAM var');
    await pg.evaluate(() => localStorage.setItem('bcn', JSON.stringify({ legal: true, sym: 'TON', proUntil: Date.now() + 36e5 }))); await pg.reload(); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 });
    ok(await pg.evaluate(() => window.__beacon.state().sym) === 'GRAM', 'eski kayıtlı TON seçimi GRAM\'a taşınır');

    await pg.evaluate(() => localStorage.setItem('bcn', JSON.stringify({ legal: true }))); await pg.reload(); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 });
    ok(!(await pg.evaluate(() => window.__beacon.isPro())), 'Pro olmayan hesapla devam');
    // Piyasa (Pro değil)
    await pg.click('#dock [data-v="market"]'); await pg.waitForSelector('.mk', { timeout: 8000 }); await sleep(600);
    ok(await pg.locator('.mk').count() === 6, 'Piyasa 6 gösterge kartı gösterir');
    ok(await pg.locator('.mk.locked').count() === 4, 'Pro değilken 4 kart kilitli, 2 kart açık (Pi Cycle, Mayer)');
    ok(!(await pg.textContent('.mk[data-id="pi"] .mkv')).includes('•'), 'açık kartın değeri görünür');
    const drawn = (id) => pg.evaluate((id) => { const cv = document.querySelector(`.mk[data-id="${id}"] canvas`); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) k++; return k; }, id);
    ok(await drawn('pi') > 3000 && await drawn('mayer') > 1500, 'açık kartların grafiği çizilmiş');
    await pg.screenshot({ path: path.join(SHOTS, 'market-free.png'), fullPage: true });

    // gösterge yazmak Pro ister
    await pg.click('#dock [data-v="radar"]'); await sleep(300);
    await pg.click('#fxBtn'); await pg.click('#fxNew'); await sleep(300);
    ok(await pg.locator('#fxEdit').isHidden() && await pg.evaluate(() => document.getElementById('v-pro').classList.contains('on')), 'Pro değilken gösterge yazmak Pro sayfasına yönlendirir');

    // Pro kazan (demo reklam)
    await pg.click('#dock [data-v="pro"]'); await pg.click('#adBtn'); await pg.waitForFunction(() => window.__beacon.isPro(), null, { timeout: 6000 });
    // Pine çevirici
    await pg.click('#dock [data-v="radar"]'); await sleep(300);
    await pg.click('#fxBtn'); await pg.click('#pineBtn'); await sleep(300);
    ok(await pg.locator('#pineSheet').isVisible(), 'Pro ile Pine çevirici açılır');
    await pg.fill('#pineIn', fs.readFileSync(path.join(__dirname, 'fixtures/pine/Nexus_Alpha.pine'), 'utf8')); await pg.click('#pineGo'); await sleep(300);
    const pout = await pg.inputValue('#pineOut'); ok(/mark\(buySignal, "up"/.test(pout) && /sqzOn = /.test(pout), 'Pine çıktısı sağ tarafta oluşur');
    ok(/satır çevrildi/.test(await pg.textContent('#pineRep')) && await pg.locator('#pineCopy').isEnabled(), 'çeviri raporu gösterilir');
    await pg.screenshot({ path: path.join(SHOTS, 'pine-mobil.png') });
    await pg.click('#pineAdd'); await sleep(600);
    ok(await pg.evaluate(() => (window.__beacon.state().custom || []).some((f) => /Uçsun/.test(f.name) && f.on && !f.err)), 'çevrilen gösterge Göstergelerim listesine eklenir');
    await pg.evaluate(() => { const S = window.__beacon.state(); S.custom = []; window.__beacon.save(); window.__beacon.applyCustom(); });
    await pg.click('#dock [data-v="market"]'); await sleep(800);
    ok(await pg.locator('.mk.locked').count() === 0, 'Pro ile tüm kartlar açılır');
    const vals = await pg.$$eval('.mk .mkv b', (e) => e.map((x) => x.textContent.trim()));
    ok(vals.every((v) => v && !v.includes('•')), 'tüm kartların değeri var: ' + vals.join(' | '));
    for (const id of ['pi', 'mayer', 'w200', 'ma2y', 'rainbow', 'halving']) ok(await drawn(id) > 1500, id + ' grafiği çizilmiş');
    await pg.click('#mkRange [data-r="1y"]'); await sleep(400); ok(await drawn('rainbow') > 1500, '1 yıl aralığında da çizilir');
    await pg.screenshot({ path: path.join(SHOTS, 'market-pro.png'), fullPage: true });

    // kullanıcı göstergesi
    await pg.click('#dock [data-v="radar"]'); await sleep(300);
    await pg.click('#fxBtn'); await pg.click('#fxNew'); await sleep(200);
    ok(await pg.locator('#fxEdit').isVisible(), 'Pro ile gösterge editörü açılır');
    await pg.fill('#fxCode', 'a = ema(close, 20\nplot(a)'); await pg.click('#fxSave');
    ok(/Satır 1/.test(await pg.textContent('#fxErr')), 'hatalı formül satır numarasıyla bildirilir');
    await pg.fill('#fxCode', 'plot(window)'); await pg.click('#fxSave'); ok(/Tanımsız/.test(await pg.textContent('#fxErr')), 'tehlikeli ad reddedilir');
    await pg.fill('#fxName', 'Çift EMA'); await pg.click('#fxTpls [data-tpl="0"]'); await pg.click('#fxSave'); await sleep(400);
    ok(await pg.evaluate(() => window.__beacon.cur().data.custom.length) === 2, 'kaydedilen gösterge grafik verisine eklenir (2 çizgi)');
    await pg.click('#fxNew'); await pg.fill('#fxName', 'Sapma'); await pg.click('#fxTpls [data-tpl="2"]'); await pg.click('#fxSave'); await sleep(300);
    ok(await pg.evaluate(() => window.__beacon.cur().data.custom.filter((p) => p.pane === 'sub').length) === 1, 'pane() alt panele eklenir');
    ok(await pg.locator('.fxrow').count() === 2, 'gösterge listesinde 2 kayıt var');
    await pg.evaluate(() => document.getElementById('fxSheet').classList.remove('on')); await sleep(500);
    await pg.screenshot({ path: path.join(SHOTS, 'custom-indicators.png') });
    await pg.reload(); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 });
    const kept = await pg.evaluate(() => JSON.stringify({ n: (window.__beacon.state().custom || []).length, ls: (localStorage.getItem('bcn') || '').length, pro: window.__beacon.isPro() })); ok(JSON.parse(kept).n === 2, 'göstergeler yeniden açılışta korunur ' + kept);
    ok(errors.length === 0, 'konsolda hata yok ' + errors.join('|'));
    console.log(`\nTÜM ÖZELLİK TESTLERİ GEÇTİ (${n})`);
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await browser.close(); srv.close(); }
})();
