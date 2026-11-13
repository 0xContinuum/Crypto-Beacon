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

const DG = require('../web/js/draw.js').BeaconDraw.geom;
ok(Math.abs(DG.segDist(5, 5, 0, 0, 10, 0) - 5) < 1e-9 && DG.segDist(-3, 4, 0, 0, 10, 0) === 5 && Math.abs(DG.rayDist(20, 3, 0, 0, 10, 0) - 3) < 1e-9, 'geometri: doğru parçası ve ışın uzaklığı');
ok(DG.fibPrice(100, 200, 0) === 200 && DG.fibPrice(100, 200, 1) === 100 && DG.fibPrice(100, 200, 0.5) === 150, 'geometri: fibonacci seviyeleri');
ok(DG.inRect(5, 5, 0, 0, 10, 10) && !DG.inRect(11, 5, 0, 0, 10, 10) && DG.inRect(11, 5, 0, 0, 10, 10, 2), 'geometri: dikdörtgen içi');

(async () => {
  const browser = await chromium.launch(); const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }); await mock(ctx);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('bcn')) localStorage.setItem('bcn', JSON.stringify({ legal: true })); } catch (e) {} });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(String(e))); pg.on('dialog', (d) => d.accept('Destek bölgesi'));
    await pg.goto(PAGE + '?demo=1'); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur() && window.BeaconDraw && window.BeaconDraw.ctl, null, { timeout: 8000 });
    const box = await pg.locator('#cv').boundingBox(); const X = (f) => box.x + box.width * f, Y = (f) => box.y + box.height * f;
    const dcount = () => pg.evaluate(() => window.__beacon.state().draw.length);
    const tool = async (t) => { await pg.evaluate((t) => window.BeaconDraw.ctl.setTool(t), t); };
    ok(await pg.locator('.drail').isVisible(), 'masaüstünde çizim çubuğu açık gelir');
    // trend çizgisi: sürükleyerek
    await tool('trend'); await pg.mouse.move(X(0.3), Y(0.5)); await pg.mouse.down(); await pg.mouse.move(X(0.45), Y(0.4), { steps: 6 }); await pg.mouse.up();
    ok(await dcount() === 1, 'sürükleyerek trend çizgisi çizilir');
    ok(await pg.evaluate(() => { const d = window.__beacon.state().draw[0]; return d.type === 'trend' && d.sym === 'BTC' && d.pts.length === 2 && d.pts[1].t > d.pts[0].t && Number.isFinite(d.pts[0].p); }), 'çizim (zaman, fiyat) olarak saklanır');
    await tool('hline'); await pg.mouse.click(X(0.5), Y(0.55)); ok(await dcount() === 2, 'yatay çizgi ücretsiz hesapta da kullanılabilir');
    await tool('fib'); ok(await pg.evaluate(() => window.BeaconDraw.ctl.state().tool) === null && await pg.locator('#v-pro.on').count() === 1, 'Pro olmayan Fibonacci aracını seçemez, Pro sayfasına yönlenir'); await pg.evaluate(() => window.__beacon.go('radar'));
    await pg.evaluate(() => { const s = window.__beacon.state(); s.proUntil = Date.now() + 36e5; s.draw = []; window.__beacon.save(); }); await pg.reload(); await pg.waitForFunction(() => window.BeaconDraw && window.BeaconDraw.ctl && window.__beacon.cur(), null, { timeout: 8000 });
    // Pro ile tüm araçlar
    const draw2 = async (t, a, b) => { await tool(t); await pg.mouse.move(X(a[0]), Y(a[1])); await pg.mouse.down(); await pg.mouse.move(X(b[0]), Y(b[1]), { steps: 6 }); await pg.mouse.up(); };
    await draw2('trend', [0.25, 0.6], [0.5, 0.35]); await draw2('ray', [0.3, 0.7], [0.45, 0.62]); await draw2('rect', [0.55, 0.3], [0.7, 0.45]); await draw2('fib', [0.35, 0.75], [0.62, 0.3]);
    ok(await dcount() === 4, 'trend, ışın, dikdörtgen ve fibonacci çizilir');
    await tool('hline'); await pg.mouse.click(X(0.5), Y(0.55)); ok(await dcount() === 5 && await pg.evaluate(() => window.__beacon.state().draw[4].type) === 'hline', 'yatay çizgi tek dokunuşla konur');
    await tool('vline'); await pg.mouse.click(X(0.6), Y(0.5)); ok(await dcount() === 6, 'dikey çizgi konur');
    await tool('text'); await pg.mouse.click(X(0.4), Y(0.45)); ok(await dcount() === 7 && await pg.evaluate(() => window.__beacon.state().draw[6].tx) === 'Destek bölgesi', 'not eklenir ve metni saklanır');
    // kanal: 3 dokunuş (tap-tap-tap)
    await tool('channel'); await pg.mouse.click(X(0.3), Y(0.8)); await pg.mouse.click(X(0.5), Y(0.7)); await pg.mouse.click(X(0.5), Y(0.55)); ok(await dcount() === 8, 'paralel kanal üç dokunuşla çizilir');
    // pozisyon: iki dokunuş → hedef otomatik 2R
    await tool('pos'); await pg.mouse.click(X(0.7), Y(0.5)); await pg.mouse.click(X(0.85), Y(0.6));
    ok(await dcount() === 9 && await pg.evaluate(() => { const d = window.__beacon.state().draw[8]; const e = d.pts[0].p, s = d.pts[1].p, t = d.pts[2].p; return Math.abs((t - e) / (e - s) - 2) < 1e-6; }), 'pozisyon aracında hedef 2R otomatik gelir');
    await pg.screenshot({ path: path.join(SHOTS, 'draw.png') });
    // cetvel kaydedilmez
    await tool('measure'); await pg.mouse.move(X(0.2), Y(0.7)); await pg.mouse.down(); await pg.mouse.move(X(0.35), Y(0.5), { steps: 5 }); await pg.mouse.up(); ok(await dcount() === 9, 'cetvel geçicidir, kaydedilmez');
    await pg.screenshot({ path: path.join(SHOTS, 'draw-measure.png') });
    await tool('cursor');
    // seçme ve taşıma
    const before = await pg.evaluate(() => JSON.stringify(window.__beacon.state().draw[2].pts));
    await pg.mouse.move(X(0.67), Y(0.33)); await pg.mouse.down(); await pg.mouse.move(X(0.67) + 40, Y(0.33) + 30, { steps: 6 }); await pg.mouse.up();
    const after = await pg.evaluate(() => JSON.stringify(window.__beacon.state().draw[2].pts)); ok(before !== after && await pg.locator('.dbar').isVisible(), 'dikdörtgen seçilip taşınır, stil çubuğu açılır');
    // renk değiştir
    await pg.click('.dbar [data-col="#ff6384"]'); ok(await pg.evaluate(() => window.__beacon.state().draw[2].st.c) === '#ff6384', 'renk değişir');
    // silme + geri alma
    await pg.click('.dbar [data-bar="del"]'); ok(await dcount() === 8, 'seçili çizim silinir'); await pg.click('.drail [data-act="undo"]'); ok(await dcount() === 9, 'geri al silineni geri getirir');
    // kilit
    await pg.evaluate(() => { const s = window.__beacon.state(); s.draw[2].lk = true; });
    // zaman dilimi değişince yerinde kalır
    const tPts = await pg.evaluate(() => JSON.stringify(window.__beacon.state().draw[0].pts));
    await pg.click('#tfSeg [data-tf="4h"]'); await pg.waitForFunction(() => window.__beacon.cur().tf === '4h'); await sleep(200);
    ok(await pg.evaluate(() => JSON.stringify(window.__beacon.state().draw[0].pts)) === tPts && await pg.evaluate(() => window.BeaconDraw.ctl.state().count) === 9, 'zaman dilimi değişince çizimler korunur (zamana bağlı)');
    await pg.screenshot({ path: path.join(SHOTS, 'draw-4h.png') });
    // başka coinde görünmez
    ok(await pg.evaluate(() => { const s = window.__beacon.state(); const n = s.draw.filter((d) => d.sym === 'ETH').length; return n === 0; }), 'çizimler coine özeldir');
    // gizle
    await pg.click('.drail [data-act="hide"]'); ok(await pg.evaluate(() => window.__beacon.state().dr.hide), 'çizimler gizlenir'); await pg.click('.drail [data-act="hide"]');
    // yenilemede kalıcı
    await pg.reload(); await pg.waitForFunction(() => window.BeaconDraw && window.BeaconDraw.ctl && window.__beacon.cur(), null, { timeout: 8000 }); ok(await pg.evaluate(() => window.BeaconDraw.ctl.state().count) === 9, 'çizimler yenilemede kalıcıdır');
    // klavye: Delete
    await tool('cursor'); await pg.mouse.click(X(0.5), Y(0.55)); await pg.keyboard.press('Escape');
    // ücretsiz sınır
    await pg.evaluate(() => { const s = window.__beacon.state(); s.proUntil = 0; s.draw = []; for (let i = 0; i < 8; i++) s.draw.push({ id: 'x' + i, sym: 'BTC', type: 'hline', pts: [{ t: 1, p: 100 + i }], st: { c: '#fff', w: 1 }, tx: '', lk: false, u: 1 }); window.__beacon.save(); });
    await pg.reload(); await pg.waitForFunction(() => window.BeaconDraw && window.BeaconDraw.ctl && window.__beacon.cur(), null, { timeout: 8000 });
    await tool('trend'); await pg.mouse.move(X(0.3), Y(0.5)); await pg.mouse.down(); await pg.mouse.move(X(0.4), Y(0.4), { steps: 3 }); await pg.mouse.up(); ok(await dcount() === 8, 'ücretsiz hesapta 8 çizim sınırı uygulanır');
    ok(errors.length === 0, 'konsolda hata yok ' + errors.join('|'));
  } finally { await browser.close(); srv.close(); }
  console.log(`\nTÜM ÇİZİM TESTLERİ GEÇTİ (${n})`);
})().catch((e) => { console.error(e); process.exit(1); });
