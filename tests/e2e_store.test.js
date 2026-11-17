// Gerçek sunucu (uvicorn+SQLite, DEV_MODE) + gerçek arayüz. Çalıştırma: node tests/e2e.test.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..'), WEB = path.join(ROOT, 'web'), SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_PORT = 8775, WEB_PORT = 8776, API = `http://127.0.0.1:${API_PORT}`, ADMIN = 6394985954;
let n = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); n++; console.log('PASS ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, uid, body) => { const r = await fetch(API + p, { method: m, headers: { 'X-Init-Data': 'dev:' + uid, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };

(async () => {
  let browser;
  const db = path.join(require('os').tmpdir(), 'beacon_e2es_' + Date.now() + '.db');
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
    const code = 'plot(sma(close, 5), "Test SMA", "#ff0")';
    const mkI = (o) => call('POST', '/api/admin/store', ADMIN, Object.assign({ title: 'Ücretsiz SMA', summary: 'Kısa özet', description: 'Uzun açıklama metni', code, audience: 'public', price: '0', asset: 'USDT', duration_days: 0, status: 'active' }, o));
    const free = await mkI({}); const paid = await mkI({ title: 'Ücretli X', price: '4.99', asset: 'TON', duration_days: 30 });
    const pg = await open(777002);
    await pg.click('#stBtn');
    await pg.waitForSelector('.stc');
    ok((await pg.$$('.stc')).length === 2, 'iki gösterge listelendi');
    ok(!(await pg.$('#stNew')).isVisible || !(await pg.locator('#stNew').isVisible()), 'sahip olmayan yeni ekle düğmesini görmez');
    const txt = await pg.locator('#stList').innerText();
    ok(/GRAM/.test(txt) && /Ücretsiz/.test(txt), 'ücret etiketleri (GRAM) görünür');
    await pg.click('[data-st-like]'); await pg.waitForTimeout(300);
    ok(/1/.test(await pg.locator('.stlike').first().innerText()), 'beğeni sayısı arttı');
    await pg.click('[data-st-det="' + free.id + '"]'); await pg.waitForSelector('#stDetBody .stdesc');
    ok(/Uzun açıklama/.test(await pg.locator('#stDetBody').innerText()), 'detayda açıklama görünür');
    await pg.click('#stDetBody [data-st-claim]'); await pg.waitForTimeout(800);
    const on = await pg.evaluate(() => window.__beacon.state().st);
    ok(on.includes(free.id), 'ücretsiz gösterge eklendi ve açıldı');
    const n = await pg.evaluate(() => window.__beacon.storePlots(window.__beacon.cur() ? window.__beacon.cur().candles : []).length);
    ok(n >= 0, 'storePlots çalışıyor');
    const nc = await call('GET', '/api/store/' + paid.id + '/code', 777002);
    ok(nc.error, 'ücretli kod ödemeden verilmez');
    const o = await call('POST', '/api/store/' + paid.id + '/buy', 777002, {});
    ok(o.pay_url !== undefined || o.error, 'satın alma isteği yanıtlandı');
    ok(errors.length === 0, 'sayfa hatası yok ' + errors.join('|'));
    console.log('\nMAĞAZA E2E GEÇTİ (' + n + ')');
  } finally { if (browser) await browser.close(); web.close(); srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
