// Masaüstü terminali: geniş ekran yerleşimi. Çalıştırma: node tests/desktop.test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { klinesRoute } = require('./mock.js');
const WEB = path.resolve(__dirname, '..', 'web'), SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => { let f = path.join(WEB, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f += 'index.html'; if (!f.startsWith(WEB) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'x' }); r.end(fs.readFileSync(f)); }).listen(0);
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
let n = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); n++; console.log('PASS ' + m); };
const box = (pg, sel) => pg.locator(sel).first().boundingBox();
(async () => {
  const browser = await chromium.launch(); const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.route(/telegram\.org|adsgram\.ai/, (r) => r.abort());
    await ctx.route(/config\.local\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: "Object.assign(window.BEACON_CONFIG, { apiUrl: '' });" })); // testler sunucusuz modda çalışır
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('bcn')) localStorage.setItem('bcn', JSON.stringify({ legal: true })); } catch (e) {} });
    const pg = await ctx.newPage(); await klinesRoute(pg);
    pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    await pg.goto(PAGE + '?demo=1'); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 }); await pg.waitForTimeout(1500);
    const dock = await box(pg, '.dock'), chart = await box(pg, '#chartwrap'), side = await box(pg, '#v-radar .side');
    ok(dock.width < 110 && dock.height >= 800, 'menü solda dikey çubuk olur (' + Math.round(dock.width) + 'x' + Math.round(dock.height) + ')');
    ok(chart.width > 800 && chart.height > 520, 'grafik geniş ve yüksek (' + Math.round(chart.width) + 'x' + Math.round(chart.height) + ')');
    ok(side.x >= chart.x + chart.width - 1, 'yan panel grafiğin sağında');
    ok(Math.abs(side.y - chart.y) < 120, 'yan panel grafikle aynı hizada başlar');
    ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'yatay kaydırma yok');
    ok(await pg.evaluate(() => { const c = document.getElementById('cv'); return c.width >= 800 && c.getBoundingClientRect().width > 800; }), 'tuval geniş çiziliyor');
    ok(await pg.evaluate(() => document.body.classList.contains('web')) && await pg.locator('#webTools').isVisible(), 'tarayıcı kabuğu: Telegram\'da aç görünür');
    ok((await pg.getAttribute('#openTg', 'href')) === 'https://t.me/BeaconCrypto_Bot', 'Telegram bağlantısı bot adresine gider');
    await pg.screenshot({ path: path.join(SHOTS, 'desk-radar.png') });
    await pg.click('#dock [data-v="market"]'); await pg.waitForTimeout(900);
    const cards = await pg.$$eval('#mkBox .mk', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    ok(new Set(cards).size >= 2, 'piyasa kartları çok sütunlu (' + [...new Set(cards)].length + ' sütun)');
    await pg.screenshot({ path: path.join(SHOTS, 'desk-market.png') });
    await pg.click('#dock [data-v="scan"]'); await pg.waitForTimeout(1500); await pg.screenshot({ path: path.join(SHOTS, 'desk-scan.png') });
    await pg.click('#dock [data-v="perf"]'); await pg.waitForTimeout(1200); await pg.screenshot({ path: path.join(SHOTS, 'desk-perf.png') });
    await pg.click('#dock [data-v="pro"]'); await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(SHOTS, 'desk-pro.png') });
    // dar ekranda eski mobil yerleşim bozulmaz
    await pg.setViewportSize({ width: 390, height: 800 }); await pg.click('#dock [data-v="radar"]'); await pg.waitForTimeout(600);
    const d2 = await box(pg, '.dock'); ok(d2.width >= 380 && d2.y > 700, 'dar ekranda menü altta yatay');
    ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'dar ekranda yatay kaydırma yok');
    ok(errors.length === 0, 'konsolda hata yok ' + errors.join('|'));
    console.log(`\nTÜM MASAÜSTÜ TESTLERİ GEÇTİ (${n})`);
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await browser.close(); srv.close(); }
})();
