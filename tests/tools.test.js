// Tam ekran grafik, görsel paylaşma (Beacon logolu), piyasa göstergesi tam ekran. Çalıştırma: node tests/tools.test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { klinesRoute } = require('./mock.js');
const WEB = path.resolve(__dirname, '..', 'web'), SHOTS = path.join(__dirname, 'shots');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => { let f = path.join(WEB, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f += 'index.html'; if (!f.startsWith(WEB) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'x' }); r.end(fs.readFileSync(f)); }).listen(0);
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
let n = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); n++; console.log('PASS ' + m); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  try {
    for (const [label, vp] of [['mobil', { width: 390, height: 800 }], ['masaüstü', { width: 1440, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await ctx.route(/telegram\.org|adsgram\.ai/, (r) => r.abort());
      await ctx.route(/config\.local\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: "Object.assign(window.BEACON_CONFIG, { apiUrl: '' });" }));
      await ctx.addInitScript(() => { try { if (!localStorage.getItem('bcn')) localStorage.setItem('bcn', JSON.stringify({ legal: true, proUntil: Date.now() + 5 * 3600e3 })); } catch (e) {} });
      const pg = await ctx.newPage(); await klinesRoute(pg);
      pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
      await pg.goto(PAGE + '?demo=1'); await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 8000 }); await pg.waitForTimeout(1200);
      // tam ekran
      await pg.click('#fsBtn'); await pg.waitForTimeout(500);
      const b = await pg.locator('#chartwrap').boundingBox();
      ok(b.width >= vp.width - 60 && b.height > vp.height * 0.6, `${label}: tam ekran grafik ekranı kaplar (${Math.round(b.width)}x${Math.round(b.height)})`);
      ok(await pg.evaluate(() => { const c = document.getElementById('cv'); return Math.abs(c.getBoundingClientRect().width - document.getElementById('chartwrap').getBoundingClientRect().width) < 4; }), `${label}: tuval yeni boyuta uyar`);
      ok(await pg.locator('#tfSeg').isVisible() && await pg.locator('#layers').isVisible(), `${label}: tam ekranda zaman dilimi ve katmanlar erişilebilir`);
      await pg.click('#tfSeg [data-tf="4h"]'); await pg.waitForTimeout(900);
      ok(await pg.getAttribute('#tfSeg [data-tf="4h"]', 'aria-pressed') === 'true', `${label}: tam ekranda zaman dilimi değişir`);
      await pg.screenshot({ path: path.join(SHOTS, `tools-fs-${label}.png`) });
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
      ok(!(await pg.evaluate(() => document.getElementById('v-radar').classList.contains('fs'))), `${label}: Esc tam ekrandan çıkarır`);
      // görsel paylaşma
      await pg.click('#shareBtn'); await pg.waitForSelector('#shareSheet.on'); await pg.waitForFunction(() => document.getElementById('shareImg').complete && document.getElementById('shareImg').naturalWidth > 0);
      const dim = await pg.evaluate(() => { const i = document.getElementById('shareImg'), c = document.getElementById('cv'); return { w: i.naturalWidth, h: i.naturalHeight, cw: c.width, ch: c.height }; });
      ok(dim.w === dim.cw && dim.h > dim.ch, `${label}: paylaşım görseli grafik + başlık + alt şerit (${dim.w}x${dim.h}, grafik ${dim.cw}x${dim.ch})`);
      // üst şeritte Beacon logosu: amber piksel var mı
      const amber = await pg.evaluate(() => { const i = document.getElementById('shareImg'), c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = 140; const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(0, 0, c.width, 140).data; let k = 0; for (let p = 0; p < d.length; p += 4) if (d[p] > 230 && d[p + 1] > 170 && d[p + 1] < 215 && d[p + 2] < 130) k++; return k; });
      ok(amber > 150, `${label}: görselde Beacon logosu ve adı (amber piksel ${amber})`);
      const dl = pg.waitForEvent('download'); await pg.click('#shDl'); const d = await dl;
      ok(/^beacon-BTC-4h\.png$/.test(d.suggestedFilename()), `${label}: indirilen dosya adı ${d.suggestedFilename()}`);
      await pg.screenshot({ path: path.join(SHOTS, `tools-share-${label}.png`) });
      await pg.click('#shClose');
      // piyasa kartı tam ekran
      await pg.click('#dock [data-v="market"]'); await pg.waitForSelector('#mkBox .mk', { timeout: 8000 }); await pg.waitForTimeout(800);
      await pg.click('#mkBox .mk[data-id="pi"] .mkc'); await pg.waitForSelector('#mkFull.on');
      await pg.waitForTimeout(600);
      const mf = await pg.evaluate(() => { const c = document.getElementById('mfCv'), r = c.getBoundingClientRect(); return { w: r.width, h: r.height, drawn: c.width > 300 }; });
      ok(mf.w > vp.width * 0.8 && mf.h > 280 && mf.drawn, `${label}: piyasa grafiği tam ekran açılır (${Math.round(mf.w)}x${Math.round(mf.h)})`);
      ok((await pg.textContent('#mfTitle')) === 'Pi Cycle Top', `${label}: tam ekran başlığı`);
      await pg.click('#mfRange [data-r="1y"]'); await pg.waitForTimeout(400);
      ok(await pg.getAttribute('#mfRange [data-r="1y"]', 'aria-pressed') === 'true', `${label}: tam ekranda aralık değişir`);
      await pg.screenshot({ path: path.join(SHOTS, `tools-mkfull-${label}.png`) });
      await pg.click('#mfShare'); await pg.waitForSelector('#shareSheet.on'); ok(true, `${label}: piyasa grafiği de görsel olarak paylaşılır`); await pg.click('#shClose');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
      ok(!(await pg.evaluate(() => document.getElementById('mkFull').classList.contains('on'))), `${label}: Esc piyasa tam ekranını kapatır`);
      await ctx.close();
    }
    ok(errors.length === 0, 'konsolda hata yok ' + errors.join('|'));
    console.log(`\nTÜM ARAÇ TESTLERİ GEÇTİ (${n})`);
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await browser.close(); srv.close(); }
})();
