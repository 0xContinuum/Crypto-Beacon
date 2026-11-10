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
    { cwd: ROOT, env: { ...process.env, PYTHONPATH: ROOT, DEV_MODE: '1', DATABASE_URL: 'sqlite:///' + db, ADSGRAM_SECRET: 'x' }, stdio: 'inherit' });
  const web = http.createServer((q, s) => {
    let f = path.join(WEB, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
    if (!f.startsWith(WEB) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
    const t = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff': 'font/woff' }[path.extname(f)] || 'application/octet-stream';
    let b = fs.readFileSync(f); if (f.endsWith('config.js')) b = Buffer.from(b.toString().replace("apiUrl: ''", `apiUrl: '${API}'`));
    s.writeHead(200, { 'Content-Type': t }); s.end(b);
  }).listen(WEB_PORT);
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/healthz')).ok) break; } catch (e) {} await sleep(250); }
    browser = await chromium.launch();
    const errors = [];
    const open = async (uid) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 });
      await ctx.route(/binance\.com|adsgram/, (r) => r.abort());
      await ctx.addInitScript(() => { try { localStorage.setItem('bcn', JSON.stringify({ legal: true })); } catch (e) {} });
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => errors.push(String(e)));
      pg.on('dialog', (d) => d.accept('0xabcdef1234567890'));
      await pg.goto(`http://127.0.0.1:${WEB_PORT}/index.html?demo=1&dev=${uid}`);
      await pg.waitForFunction(() => window.BeaconApi && window.BeaconApi.me, null, { timeout: 8000 });
      return pg;
    };
    const tab = async (pg, v) => { await pg.click(`#dock [data-v="${v}"]`); await sleep(500); };

    ok((await call('POST', '/api/admin/broadcasters', ADMIN, { user_id: 1001, display_name: 'Alfa Analiz', group_title: 'Alfa Kripto', group_link: 'https://t.me/alfagrup' })).ok, 'yönetici yayıncı ekler');

    // yayıncı: paylaşım gönderir
    const b = await open(1001);
    ok((await b.locator('#dock button:visible').count()) === 6, 'sunucu modunda dock 6 sekme (Topluluk ve Hesap eklenir)');
    await tab(b, 'acct');
    ok(await b.locator('#bPanel #cSend').count() === 1, 'yayıncıya yayıncı paneli görünür');
    ok(await b.locator('#aPanel').count() === 0, 'yayıncıya yönetim paneli görünmez');
    await b.fill('#cT', 'BTC haftalık yapı analizi'); await b.fill('#cB', 'Haftalık grafikte yükselen dipler korunuyor, direnç bölgesi test ediliyor. Bu bir eğitim amaçlı analizdir.');
    await b.click('#cSend'); await sleep(900);
    ok(/Onaya gönderildi/.test(await b.textContent('#toast')), 'paylaşım onaya gönderilir');
    await b.fill('#cT', 'Kötü niyetli başlık'); await b.fill('#cB', 'VIP grubuma katılın, garanti kazanç var burada ve hemen al! uzun metin uzun metin.'); await b.click('#cSend'); await sleep(700);
    ok(/Yasak ifade/.test(await b.textContent('#toast')), 'yasak ifade arayüzde reddedilir');
    await b.screenshot({ path: path.join(SHOTS, 'srv-broadcaster.png'), fullPage: true });

    // yönetici: onaylar
    const a = await open(ADMIN);
    await tab(a, 'acct');
    ok(await a.locator('#aPanel [data-ap]').count() === 1, 'yönetici onay kuyruğunda 1 paylaşım görür');
    ok((await a.textContent('#aPanel')).includes('Alfa Analiz'), 'yönetim yayıncı listesini gösterir');
    await a.click('#aPanel [data-ap]'); await sleep(700);
    ok(await a.locator('#aPanel [data-ap]').count() === 0, 'onaylanan paylaşım kuyruktan çıkar');

    // okuyucu: akış, beğeni, reklam
    const u = await open(2001);
    await tab(u, 'feed');
    ok(await u.locator('.post').count() === 1, 'okuyucu akışta onaylı paylaşımı görür');
    await u.screenshot({ path: path.join(SHOTS, 'srv-feed.png') });
    await u.click('.post'); await sleep(600);
    ok(/Yatırım tavsiyesi değildir/.test(await u.textContent('#dynSheet')), 'paylaşım detayında uyarı metni var');
    await u.click('#pLike'); await sleep(400);
    ok((await u.textContent('#pLike')).includes('1'), 'beğeni sayılır');
    await u.click('#pSup'); await sleep(4500);
    ok(/yayıncı desteklendi/.test(await u.textContent('#toast')), 'destek reklamı sunucuda doğrulanır');
    await u.click('#pPro'); await sleep(4500);
    ok((await u.evaluate(() => window.BeaconApi.me.pro.active)), 'reklamla Pro açılır (sunucu doğrulamalı)');
    await u.keyboard.press('Escape'); await u.evaluate(() => document.getElementById('dynSheet').classList.remove('on'));
    await tab(u, 'pro');
    ok(/^\d+:\d\d:\d\d$/.test((await u.textContent('#proState')).trim()), 'Pro sayacı saat:dakika:saniye gösterir');
    ok(/6 saat/.test(await u.textContent('#v-pro')), 'Pro sayfası 6 saat üst sınırını söyler');
    await u.screenshot({ path: path.join(SHOTS, 'srv-pro.png') });

    // yönetici: reklam videosu sayısını görür
    await tab(a, 'radar'); await tab(a, 'acct');
    const txt = await a.textContent('#aPanel');
    ok(/Video:\s*2 \/ 2 \/ 2/.test(txt.replace(/\s+/g, ' ')), 'yönetim yayıncının reklam videosu sayısını gösterir (2/2/2)');
    await a.screenshot({ path: path.join(SHOTS, 'srv-admin.png'), fullPage: true });
    ok(errors.length === 0, 'konsolda hata yok ' + errors.join('|'));
    console.log(`\nTÜM E2E TESTLERİ GEÇTİ (${n})`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { try { await browser.close(); } catch (e) {} srv.kill(); web.close(); try { fs.unlinkSync(db); } catch (e) {} }
})();
