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

const D0 = (global.self = global, require('../web/js/data.js'), global.BeaconData);
const P = D0.parseTf;
ok(P('c2d').base === '1d' && P('c2d').k === 2 && P('c14d').k === 14 && P('c2w').base === '1w' && P('c2M').base === '1M' && P('c3d').native === '3d' && P('c1M').native === '1M', 'özel TF: birleştirme planı doğru');
ok(P('c1d') === null && P('c60m') === null && P('c61d') === null && P('c1w') === null && P('x2d') === null && P('c0h') === null, 'özel TF: hazır ya da sınır dışı olanlar reddedilir');
ok(P('c90m').base === '30m' && P('c90m').k === 3 && P('c5h').base === '1h' && P('c36h').base === '12h', 'özel TF: dakika/saat için en büyük bölen temel seçilir');
{ const base = []; for (let i = 0; i < 100; i++) base.push({ t: Date.UTC(2024, 0, 1) + i * 864e5, o: i, h: i + 3, l: i - 2, c: i + 1, v: 2 });
  const a = D0.aggregate(base, P('c14d')); ok(a.every((k, i) => i === 0 || k.t - a[i - 1].t === 14 * 864e5) && a.every((k) => k.t % (14 * 864e5) === 0), 'gün grupları sabit takvime oturur');
  const k = a[1], src = base.filter((x) => x.t >= k.t && x.t < k.t + 14 * 864e5); ok(k.o === src[0].o && k.c === src[src.length - 1].c && k.h === Math.max(...src.map((x) => x.h)) && k.l === Math.min(...src.map((x) => x.l)) && k.v === src.length * 2, 'OHLCV doğru birleşir');
  const a2 = D0.aggregate(base.slice(0, 90), P('c14d')); ok(a2.length >= 5 && a2[0].t === a[0].t, 'geçmiş mumlar yeni veri gelince değişmez'); }
{ const base = []; for (let m = 0; m < 30; m++) base.push({ t: Date.UTC(2022, m, 1), o: 1, h: 2, l: 0.5, c: 1.5, v: 1 });
  const a = D0.aggregate(base, P('c2M')); ok(a.length >= 14 && a.every((k) => new Date(k.t).getUTCDate() === 1 && new Date(k.t).getUTCMonth() % 2 === 0 && k.e > k.t), 'ay grupları ay başına oturur, bitiş zamanı var');
  const w = []; for (let i = 0; i < 20; i++) w.push({ t: Date.UTC(2024, 0, 1) + i * 6048e5, o: 1, h: 2, l: 1, c: 1, v: 1 }); const aw = D0.aggregate(w, P('c2w')); ok(aw.length >= 9 && aw.every((k) => new Date(k.t).getUTCDay() === 1), 'hafta grupları pazartesiye oturur');
  ok(D0.closedCount([{ t: Date.now() - 864e5, e: Date.now() + 864e5 }], 1) === 0 && D0.closedCount([{ t: Date.now() - 2 * 864e5, e: Date.now() - 864e5 }], 1) === 1, 'closedCount bitiş zamanına bakar'); }

(async () => {
  const browser = await chromium.launch(); const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 }); await mock(ctx);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('bcn')) localStorage.setItem('bcn', JSON.stringify({ legal: true })); } catch (e) {} });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(String(e))); pg.on('dialog', (d) => d.accept());
    await pg.goto(PAGE + '?demo=1'); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 });
    await pg.click('#tfAdd'); await sleep(200);
    ok(!(await pg.locator('#ctfSheet').isVisible()) && await pg.locator('#v-pro.on').count() === 1, 'Pro olmayan "+" ile Pro sayfasına yönlenir');
    await pg.evaluate(() => localStorage.setItem('bcn', JSON.stringify({ legal: true, proUntil: Date.now() + 36e5 }))); await pg.reload(); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 });
    await pg.click('#tfAdd'); await sleep(200); ok(await pg.locator('#ctfSheet').isVisible(), 'Pro ile özel aralık penceresi açılır');
    await pg.click('#ctfQuick [data-id="c14d"]'); await pg.click('#ctfQuick [data-id="c2w"]'); await pg.click('#ctfQuick [data-id="c2d"]');
    ok(await pg.locator('#ctfList .ctfchip').count() === 3, 'hızlı ekle üç aralığı ekler');
    await pg.fill('#ctfN', '3'); await pg.selectOption('#ctfU', 'h'); await pg.click('#ctfAdd'); ok(await pg.locator('#ctfList .ctfchip').count() === 4, 'elle sayı+birim ile eklenir (3s)');
    await pg.fill('#ctfN', '1'); await pg.selectOption('#ctfU', 'd'); await pg.click('#ctfAdd'); ok(await pg.locator('#ctfErr').isVisible() && await pg.locator('#ctfList .ctfchip').count() === 4, '1G gibi hazır aralık reddedilir');
    await pg.click('#ctfClose'); await sleep(100);
    ok(await pg.locator('#tfSeg .ctf[data-tf]').count() === 4, 'özel aralıklar zaman çubuğunda görünür');
    await pg.click('#tfSeg [data-tf="c14d"]'); await pg.waitForFunction(() => window.__beacon.cur() && window.__beacon.cur().tf === 'c14d', null, { timeout: 8000 });
    ok(await pg.evaluate(() => { const c = window.__beacon.cur(); return c.candles.length > 100 && c.candles.every((k, i) => i === 0 || k.t - c.candles[i - 1].t === 14 * 864e5); }), '14G grafiği 14 günlük mumlarla açılır');
    ok(/14G/.test(await pg.textContent('#tfSeg [aria-pressed="true"]')), '14G seçili görünür');
    await pg.reload(); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur() && window.__beacon.cur().tf === 'c14d', null, { timeout: 8000 }); ok(true, 'seçim yenilemede korunur');
    await pg.click('#tfSeg [data-tf="c2w"]'); await pg.waitForFunction(() => window.__beacon.cur() && window.__beacon.cur().tf === 'c2w', null, { timeout: 8000 }); ok(true, '2H (iki haftalık) açılır');
    await pg.click('#tfSeg [data-tf="1h"]'); await pg.waitForFunction(() => window.__beacon.cur().tf === '1h'); await sleep(100);
    await pg.screenshot({ path: path.join(SHOTS, 'ctf.png') });
    await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('bcn')); s.proUntil = 0; s.tf = 'c14d'; localStorage.setItem('bcn', JSON.stringify(s)); }); await pg.reload(); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 });
    ok(await pg.evaluate(() => window.__beacon.state().tf) === '1d' && await pg.locator('#tfSeg .ctf[data-tf]').count() === 0, 'Pro bitince özel aralık kapanır, 1G\'ye dönülür');
    ok(errors.length === 0, 'konsolda hata yok ' + errors.join('|'));
  } finally { await browser.close(); srv.close(); }
  console.log(`\nTÜM ÖZEL ZAMAN ARALIĞI TESTLERİ GEÇTİ (${n})`);
})().catch((e) => { console.error(e); process.exit(1); });
