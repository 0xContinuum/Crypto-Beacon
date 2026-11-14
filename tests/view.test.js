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
    ok(errors.length === 0, 'sayfa hatası yok ' + errors.join('|'));
  } finally { await browser.close(); srv.close(); }
  console.log(n + ' test geçti');
})().catch((e) => { console.error(e.message); process.exit(1); });
