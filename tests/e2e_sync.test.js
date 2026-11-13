// Gerçek sunucu (uvicorn+SQLite, DEV_MODE) + gerçek arayüz. Çalıştırma: node tests/e2e.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..'), WEB = path.join(ROOT, 'web'), SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_PORT = 8765, WEB_PORT = 8766, API = `http://127.0.0.1:${API_PORT}`, ADMIN = 6394985954;
let n = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); n++; console.log('PASS ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, uid, body) => { const r = await fetch(API + p, { method: m, headers: { 'X-Init-Data': 'dev:' + uid, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };

(async () => {
  let browser;
  const db = path.join(require('os').tmpdir(), 'beacon_e2e_' + Date.now() + '.db');
  const srv = spawn('python3', ['-I', '-m', 'uvicorn', 'server.app:default_app', '--factory', '--port', String(API_PORT), '--log-level', 'error'],
    { cwd: ROOT, env: { ...process.env, PYTHONPATH: ROOT, DEV_MODE: '1', BOT_TOKEN: '111:E2ETOKEN', TG_OFFLINE: '1', DATABASE_URL: 'sqlite:///' + db, ADSGRAM_SECRET: 'x' }, stdio: 'inherit' });
  const web = http.createServer((q, s) => {
    let f = path.join(WEB, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
    if (!f.startsWith(WEB) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
    const t = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff': 'font/woff' }[path.extname(f)] || 'application/octet-stream';
    let b = fs.readFileSync(f); if (f.endsWith('config.js')) b = Buffer.from(b.toString().replace(/apiUrl: '[^']*'/, `apiUrl: '${API}'`));
    s.writeHead(200, { 'Content-Type': t }); s.end(b);
  }).listen(WEB_PORT);
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/healthz')).ok) break; } catch (e) {} await sleep(250); }
    browser = await chromium.launch();
    const errors = [];
    const open = async (uid) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 });
      await ctx.route(/binance\.com|adsgram|youtube|ytimg/, (r) => r.abort());
      await ctx.addInitScript(() => { try { localStorage.setItem('bcn', JSON.stringify({ legal: true })); } catch (e) {} });
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => errors.push(String(e)));
      pg.on('dialog', (d) => d.accept('0xabcdef1234567890'));
      await pg.goto(`http://127.0.0.1:${WEB_PORT}/index.html?demo=1&dev=${uid}`);
      await pg.waitForFunction(() => window.BeaconApi && window.BeaconApi.me, null, { timeout: 8000 });
      return pg;
    };
    const A = await open(777001), B = await open(777001);
    const st = (pg) => pg.evaluate(() => { const s = window.__beacon.state(); return { custom: s.custom.map((f) => f.name), ctf: s.ctf, wl: s.wl && s.wl.lists.map((l) => l.name), draw: (s.draw || []).map((d) => d.id) }; });
    await A.evaluate(() => { const b = window.__beacon, s = b.state(); s.custom.push({ id: 111, name: 'Test RSI', code: 'plot(rsi(close,14))', on: true }); s.ctf = ['c14d']; s.wl = { act: 1, lists: [{ id: 1, name: 'Listem', items: ['BTC', 'ETH'] }] }; s.draw = [{ id: 'd1', sym: 'BTC', type: 'trend', pts: [{ t: 1, p: 2 }, { t: 3, p: 4 }], st: {}, tx: '', u: 0 }]; b.save(); });
    await sleep(2300); // 1.5 sn gecikmeli otomatik gönderim
    await B.evaluate(() => window.__beacon.syncNow()); await sleep(400);
    let x = await st(B); ok(x.custom.join() === 'Test RSI' && x.ctf.join() === 'c14d' && x.wl.join() === 'Listem' && x.draw.join() === 'd1', 'A cihazında eklenenler B cihazında görünür (gösterge, özel aralık, takip listesi, çizim)');
    await B.evaluate(() => { const b = window.__beacon, s = b.state(); s.custom[0].code = 'plot(rsi(close,7))'; s.custom.push({ id: 222, name: 'İkinci', code: 'plot(sma(close,20))', on: true }); s.draw = []; b.save(); });
    await sleep(2300); await A.evaluate(() => window.__beacon.syncNow()); await sleep(400);
    x = await st(A); ok(x.custom.join() === 'Test RSI,İkinci' && x.draw.length === 0, 'B cihazındaki ekleme ve silme A cihazına gelir');
    ok(await A.evaluate(() => window.__beacon.state().custom[0].code) === 'plot(rsi(close,7))', 'düzenleme eşitlenir');
    // ağ kopukken yapılan iki farklı değişiklik birleşir
    await A.evaluate(() => { const b = window.__beacon, s = b.state(); s.custom.push({ id: 333, name: 'Sadece A', code: 'a', on: true }); b.save(); });
    await B.evaluate(() => { const b = window.__beacon, s = b.state(); s.custom.push({ id: 444, name: 'Sadece B', code: 'b', on: true }); b.save(); });
    await sleep(2600); await A.evaluate(() => window.__beacon.syncNow()); await B.evaluate(() => window.__beacon.syncNow()); await sleep(600); await A.evaluate(() => window.__beacon.syncNow()); await sleep(400);
    const a1 = (await st(A)).custom.sort().join(), b1 = (await st(B)).custom.sort().join(); ok(a1 === b1 && /Sadece A/.test(a1) && /Sadece B/.test(a1), 'eşzamanlı değişiklikler iki cihazda da birleşir: ' + a1);
    ok(errors.length === 0, 'konsolda hata yok ' + errors.join('|'));
  } finally { if (browser) await browser.close(); srv.kill(); web.close(); try { fs.unlinkSync(db); } catch (e) {} }
  console.log(`\nTÜM EŞİTLEME E2E TESTLERİ GEÇTİ (${n})`);
})().catch((e) => { console.error(e); process.exit(1); });
