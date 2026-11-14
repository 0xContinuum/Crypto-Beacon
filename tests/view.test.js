// Piyasa göstergeleri, Pro kilidi ve kullanıcı göstergeleri. Çalıştırma: node tests/view.test.js
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
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(String(e)));
    await ctx.route(/fundingRate/, (r) => { const u = new URL(r.request().url()), a = +u.searchParams.get('startTime'), b = Math.min(+u.searchParams.get('endTime'), Date.now()), rows = []; for (let t = Math.ceil(a / 288e5) * 288e5; t < b && rows.length < 1000; t += 288e5) rows.push({ symbol: 'BTCUSDT', fundingTime: t, fundingRate: String(0.0001 + 0.0002 * Math.sin(t / 3e9)) }); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows) }); });
    await pg.goto(PAGE + '?demo=1'); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 }); await sleep(800);
    const box = await pg.locator('#chart').first().boundingBox().catch(() => null) || await pg.locator('#chartwrap').boundingBox();
    const y = box.y + box.height * 0.4, drag = async (x1, x2) => { await pg.mouse.move(x1, y); await pg.mouse.down(); await pg.mouse.move(x2, y, { steps: 6 }); await pg.mouse.up(); };
    const hist = await pg.evaluate(() => window.__beacon.chart.shift);
    for (let i = 0; i < 8; i++) await drag(box.x + 20, box.x + box.width - 20); const a1 = await pg.evaluate(() => window.__beacon.chart.shift);
    for (let i = 0; i < 16; i++) await drag(box.x + box.width - 20, box.x + 20); const a2 = await pg.evaluate(() => window.__beacon.chart.shift);
    console.log('shift', hist, a1, a2); const sh = Math.min(a1, a2);
ok(sh < 0, 'grafik sağa boşluğa kaydırılabilir (shift=' + sh.toFixed(1) + ')');
    const lastX = await pg.evaluate(() => { const c = window.__beacon.chart; return c.xOf ? c.xOf(c.n - 1) : null; });
    // tarih/OHLC yazısı çizim çubuğunun sağında başlar
    await pg.mouse.move(box.x + box.width * 0.5, y); await sleep(150);
    const tip = await pg.evaluate(() => { const t = document.getElementById('tip'), r = t.getBoundingClientRect(), rail = document.querySelector('.drail, #drawRail, .dr-rail'); return { on: t.classList.contains('on'), left: r.left, railRight: rail ? rail.getBoundingClientRect().right : 0, wrapLeft: document.getElementById('chartwrap').getBoundingClientRect().left }; });
    ok(tip.left - tip.wrapLeft >= 50, 'bilgi yazısı sol araç çubuğunun üstüne binmez (sol boşluk ' + Math.round(tip.left - tip.wrapLeft) + 'px)');
    await pg.screenshot({ path: path.join(SHOTS, 'view-blank.png') });
    // Pro: Rejim göstergesi ve piyasa kartları
    await pg.evaluate(() => localStorage.setItem('bcn', JSON.stringify({ legal: true, proUntil: Date.now() + 36e5 }))); await pg.reload(); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur() && window.__beacon.cur().data, null, { timeout: 8000 }); await sleep(600);
    await pg.click('[data-l="rej"]'); await sleep(500);
    const rj = await pg.evaluate(() => { const c = window.__beacon.cur().data.custom || []; return { n: c.length, hist: c.some((x) => x.style === 'histogram' && x.values.some(Number.isFinite)) }; });
    ok(rj.n >= 3 && rj.hist, 'Rejim katmanı alt panelde histogram çizer');
    await pg.screenshot({ path: path.join(SHOTS, 'view-rejim.png') });
    await pg.click('#tfs button:not([aria-pressed="true"])'); await sleep(1500); ok((await pg.evaluate(() => (window.__beacon.cur().data.custom || []).length)) >= 3, 'Rejim zaman dilimi/yenileme sonrası kaybolmaz');
    await pg.click('[data-l="rej"]'); await sleep(300); ok((await pg.evaluate(() => (window.__beacon.cur().data.custom || []).length)) === 0, 'Rejim kapatılınca panel kalkar');
    await pg.click('#dock [data-v="market"]'); await pg.waitForSelector('.mk', { timeout: 8000 }); await sleep(900);
    ok(await pg.locator('.mk[data-id="storm"]').count() === 1 && await pg.locator('.mk[data-id="drop"]').count() === 1 && await pg.locator('.mk[data-id="moon"]').count() === 0, 'Fırtına ve Düşüş Tabanı kartları var, Ay kartı yok');
    await pg.waitForSelector('.mk[data-id="fund"]', { timeout: 15000 }); ok(await pg.locator('.mk[data-id="zone"]').count() === 1, 'Funding ve Döngü Bölgeleri kartları görünür');
    await pg.locator('.mk[data-id="fund"]').scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(SHOTS, 'view-fund.png') }); await pg.locator('.mk[data-id="zone"]').scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(SHOTS, 'view-zone.png') });
    ok(await pg.locator('.mk[data-id="touch"]').count() === 0, 'Seviye Değme kartı şimdilik kapalı');
    await pg.locator('.mk[data-id="piad"]').scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(SHOTS, 'view-piad.png') }); await pg.locator('.mk[data-id="volad"]').scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(SHOTS, 'view-volad.png') });
    ok(await pg.locator('.zcoins').count() === 0, 'Döngü bölgeleri yalnızca BTC (coin seçici yok)');
    for (const id of ['pi', 'mayer', 'w200', 'ma2y', 'rainbow', 'halving', 'piad', 'volad']) { const cv = pg.locator('.mk[data-id="' + id + '"] canvas'); await cv.scrollIntoViewIfNeeded(); const bb = await cv.boundingBox(); const hh = () => pg.evaluate((i) => { const c = document.querySelector('.mk[data-id="' + i + '"] canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let k = 0; k < d.length; k += 89) h = (h * 31 + d[k]) | 0; return h; }, id); const a0 = await hh(); await pg.mouse.move(bb.x + bb.width * 0.55, bb.y + bb.height * 0.4); await sleep(120); ok(a0 !== await hh(), id + ' kartında imleç ipucu çizer'); await pg.mouse.move(2, 2); }
    const cvs = pg.locator('.mk[data-id="storm"] canvas'); await cvs.scrollIntoViewIfNeeded(); const cb = await cvs.boundingBox();
    const hash = async () => pg.evaluate(() => { const c = document.querySelector('.mk[data-id="storm"] canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; });
    const h0 = await hash(); await pg.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.4); await sleep(150); const h1 = await hash();
    ok(h0 !== h1, 'Fırtına kartında imleç tarih/değer ipucunu çizer'); await pg.screenshot({ path: path.join(SHOTS, 'view-storm-hover.png') });
    await pg.mouse.move(5, 5); await sleep(150); ok((await hash()) === h0, 'imleç ayrılınca ipucu kalkar');
    ok(errors.length === 0, 'sayfa hatası yok ' + errors.join('|'));
  } finally { await browser.close(); srv.close(); }
  console.log(n + ' test geçti');
})().catch((e) => { console.error(e.message); process.exit(1); });
