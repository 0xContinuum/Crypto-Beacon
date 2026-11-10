// Tanıtım videosu: uygulamanın gerçek ekranlarından (örnek verilerle) sessiz video + altyazı + seslendirme metni üretir.
// Çalıştırma: node video/build.js   (Playwright, ffmpeg, python3 gerekir)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { klinesRoute } = require('../tests/mock.js');
const ROOT = path.resolve(__dirname, '..'), WEB = path.join(ROOT, 'web');
const WORK = process.env.VWORK || fs.mkdtempSync(path.join(os.tmpdir(), 'beaconvid-')); fs.mkdirSync(WORK, { recursive: true });
const OUT = __dirname, API_PORT = 8791, API = `http://127.0.0.1:${API_PORT}`, ADMIN = 6394985954;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff': 'font/woff' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, uid, body) => (await fetch(API + p, { method: m, headers: { 'X-Init-Data': 'dev:' + uid, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

const mk = (withApi) => http.createServer((q, r) => {
  let f = path.join(WEB, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f += 'index.html';
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  let b = fs.readFileSync(f); if (withApi && f.endsWith(path.join('js', 'config.js'))) b = Buffer.from(b.toString().replace("apiUrl: ''", `apiUrl: '${API}'`));
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'x' }); r.end(b);
}).listen(0);
const web = mk(false), webApi = mk(true);
const BASEURL = 'http://127.0.0.1:' + web.address().port, BASEAPI = 'http://127.0.0.1:' + webApi.address().port;

/* ——— anlatım metni (sahneler) ——— */
const SC = [
  { id: 'title', text: 'Beacon. Kripto grafiğini tek bakışta okuyun.', min: 5 },
  { id: 'radar', text: 'Beacon, kripto grafiğini tek bakışta okumanızı sağlar. Trend, momentum, hacim ve yapı tek bir skorda toplanır: eksi yüz ile artı yüz arasında. Skor bir eğilim ölçüsüdür, al-sat çağrısı değildir.' },
  { id: 'trigger', text: 'Skor eşiği geçtiğinde tetik oluşur. Giriş referansı, geçersizlik seviyesi ve iki hedef grafikte hazır gelir.' },
  { id: 'form', text: 'Formasyon Merkezi üçgenleri, takozları, ikili tepe ve dipleri bulur. Eski çizgiler silinmez, destek ve direnç bölgelerini görmenizi sağlar.' },
  { id: 'scan', text: 'Tarayıcı, coinleri ve zaman dilimlerini tek tabloda gösterir. Hangi coin hangi vadede güçlü, bir bakışta görün.' },
  { id: 'market', text: 'Piyasa sekmesi Bitcoin döngü göstergelerini fiyattan kendi hesabımızla çıkarır: Pi Cycle, Mayer çarpanı, iki yüz haftalık ortalama ve halving döngüsü.' },
  { id: 'fx', text: 'Pro kullanıcılar kendi göstergelerini formülle yazıp doğrudan grafiğe ekleyebilir.' },
  { id: 'devices', text: 'Telegram içinde mini uygulama olarak, bilgisayarda geniş ekranlı terminal olarak çalışır. Hesabınız her yerde aynıdır.' },
  { id: 'feed', text: 'Topluluk sekmesi, dağınık Telegram topluluklarını tek çatı altında toplar. Yalnızca onaylı yayıncılar paylaşım yapar ve her paylaşım yayından önce incelenir.' },
  { id: 'bpanel', text: 'Yayıncılar paylaşımlarından gelen reklam gelirinin yüzde ellisini kazanır, kazançlarını kendi panelinden izler ve yüz dolardan itibaren ödeme ister.' },
  { id: 'admin', text: 'Sahip, yönetim menüsünden her yayıncının izlenen reklam videosu sayısını görür, paylaşımları onaylar ve ödeme taleplerini sonuçlandırır.' },
  { id: 'pro', text: 'Pro isteğe bağlıdır. Reklam izleyerek açın: reklam başına bir saat, günde en fazla altı reklam. Ücretsiz katman her zaman açıktır.' },
  { id: 'end', text: 'Beacon. Telegram’da açın, tarayıcıdan da kullanın. Yatırım tavsiyesi değildir.', min: 6 },
];
for (const s of SC) { const w = s.text.split(/\s+/).length; s.dur = Math.max(s.min || 0, 1.2 + w / 2.3); s.dur = Math.round(s.dur * 30) / 30; }

(async () => {
  const srvEnv = { ...process.env, PYTHONPATH: ROOT, DEV_MODE: '1', DATABASE_URL: 'sqlite:///' + path.join(WORK, 'v.db'), ADSGRAM_SECRET: 'x' };
  const srv = spawn('python3', ['-I', '-m', 'uvicorn', 'server.app:default_app', '--factory', '--port', String(API_PORT), '--log-level', 'error'], { cwd: ROOT, env: srvEnv, stdio: 'inherit' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(API + '/healthz')).ok) break; } catch (e) {} await sleep(250); }
    const shot = (name) => path.join(WORK, name + '.png');
    const newCtx = async (vp, dsf, ls) => {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf });
      await ctx.route(/telegram\.org|adsgram\.ai/, (r) => r.abort());
      await ctx.addInitScript((v) => { try { if (!localStorage.getItem('bcn')) localStorage.setItem('bcn', JSON.stringify(v)); } catch (e) {} }, ls);
      return ctx;
    };
    const DESK = { width: 1440, height: 810 }, PRO = () => ({ legal: true, proUntil: Date.now() + 5 * 3600e3, ads: { d: new Date().toISOString().slice(0, 10), n: 3 } });
    const ready = async (pg) => { await pg.waitForFunction(() => window.__beacon && window.__beacon.cur(), null, { timeout: 10000 }); await pg.waitForTimeout(1600); };

    /* 1) radar, tarayıcı, piyasa, formül: sunucusuz mod, Pro açık */
    {
      const ctx = await newCtx(DESK, 2, PRO()); const pg = await ctx.newPage(); await klinesRoute(pg);
      await pg.goto(BASEURL + '/index.html?demo=1'); await ready(pg);
      await pg.screenshot({ path: shot('radar') });
      // tetik kutusunu görünür yap: yan paneli kaydır
      await pg.evaluate(() => { const s = document.querySelector('#v-radar .side'); const t = document.getElementById('h-trig'); s.scrollTop = t.offsetTop - 20; });
      await pg.waitForTimeout(400); await pg.screenshot({ path: shot('trigger') });
      // formasyonlu bir zaman dilimi bul
      let found = false;
      for (const tf of ['4h', '1d', '1h', '15m', '1w']) {
        await pg.click(`#tfSeg [data-tf="${tf}"]`); await pg.waitForTimeout(1400);
        if (await pg.evaluate(() => !!(window.__beacon.cur() && window.__beacon.cur().formation))) { found = true; break; }
      }
      await pg.evaluate(() => { const s = document.querySelector('#v-radar .side'); const t = document.getElementById('h-form'); s.scrollTop = t.offsetTop - 20; });
      await pg.waitForTimeout(500); await pg.screenshot({ path: shot('form') });
      console.log('formasyon bulundu:', found);
      await pg.click(`#tfSeg [data-tf="1h"]`); await pg.waitForTimeout(1200);
      await pg.click('#dock [data-v="scan"]'); await pg.waitForTimeout(3500); await pg.screenshot({ path: shot('scan') });
      await pg.click('#dock [data-v="market"]'); await pg.waitForTimeout(1600);
      await pg.evaluate(() => window.scrollTo(0, 0)); await pg.screenshot({ path: shot('market') });
      await pg.click('#dock [data-v="radar"]'); await pg.waitForTimeout(800);
      await pg.click('#fxBtn'); await pg.click('#fxNew'); await pg.waitForTimeout(300);
      await pg.fill('#fxName', 'Çift EMA farkı'); await pg.fill('#fxCode', '// 20 ve 50 günlük ortalama farkı\nhizli = ema(close, 20)\nyavas = ema(close, 50)\n\nplot(hizli, "EMA 20", "#ffc25c")\nplot(yavas, "EMA 50", "#9aa7bd")\npane((hizli - yavas) / yavas * 100, "Fark %")');
      await pg.waitForTimeout(300); await pg.screenshot({ path: shot('fx') });
      await pg.evaluate(() => document.getElementById('fxSheet').classList.remove('on'));
      await pg.click('#dock [data-v="pro"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: shot('pro') });
      await ctx.close();
      // mobil görünüm
      const mctx = await newCtx({ width: 390, height: 844 }, 2, PRO()); const mp = await mctx.newPage(); await klinesRoute(mp);
      await mp.goto(BASEURL + '/index.html?demo=1'); await ready(mp); await mp.screenshot({ path: shot('mobile') }); await mctx.close();
    }

    /* 2) topluluk: gerçek sunucu (örnek veriyle) */
    {
      const reg = [[1001, 'Alfa Analiz', 'Alfa Kripto', 'https://t.me/alfakripto'], [1002, 'Beta Zincir', 'Beta Zincir Topluluğu', 'https://t.me/betazincir'], [1003, 'Gamma Piyasa', 'Gamma Piyasa Notları', 'https://t.me/gammapiyasa']];
      for (const [id, n, g, l] of reg) { await call('POST', '/api/admin/broadcasters', ADMIN, { user_id: id, display_name: n, group_title: g, group_link: l, auto_approve: true }); }
      // grafik görseli
      const ictx = await newCtx(DESK, 1, PRO()); const ip = await ictx.newPage(); await klinesRoute(ip); await ip.goto(BASEURL + '/index.html?demo=1'); await ready(ip);
      const img = await ip.evaluate(() => { const s = document.getElementById('cv'), w = Math.min(900, s.width), c = document.createElement('canvas'); c.width = w; c.height = Math.round(s.height * w / s.width); const g = c.getContext('2d'); g.fillStyle = '#060a12'; g.fillRect(0, 0, c.width, c.height); g.drawImage(s, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.72); });
      await ictx.close();
      const posts = [
        [1001, 'BTC günlük grafikte yapı: direnç bölgesi yeniden test ediliyor', 'Günlükte son üç dipten geçen yükselen çizgi korunuyor. Üst tarafta daha önce reddedilen bölge yeniden test ediliyor. Hacim bu hareketi henüz desteklemiyor, bu yüzden kırılımı kapanışla teyit etmek mantıklı. Eğitim amaçlı bir okumadır.', 'BTC', '1d', img],
        [1002, 'ETH/BTC oranı neden önemli?', 'Oran uzun süredir düşen bir kanalın içinde. Kanalın üst bandı aşılmadan ETH lehine bir rotasyondan söz etmek erken. Takip edilecek şey haftalık kapanışlar ve oranın 200 haftalık ortalamayla ilişkisi. Yatırım tavsiyesi değildir.', 'ETH', '1w', ''],
        [1003, 'GRAM (eski Toncoin) için kısa notlar', 'Yeniden adlandırmadan sonra fiyat yapısı daha sakin. Dört saatlik grafikte yatay bir aralık var, aralığın alt ve üst sınırı izlenebilir. Hacimdeki artış olmadan yön çıkmaz. Bu bir görüştür.', 'GRAM', '4h', img],
        [1001, 'Haftalık kapanış öncesi kontrol listesi', 'Hafta kapanışlarında bakılacak üç şey: önceki haftanın tepesi ve dibi, haftalık ortalamaya mesafe ve hacmin son dört haftaya göre durumu. Bu liste bir karar verici değil, düzenli bakmak için bir çerçevedir.', 'BTC', '1w', ''],
      ];
      for (const [u, t, b, s, tf, im] of posts) console.log('paylaşım:', JSON.stringify(await call('POST', '/api/b/posts', u, { title: t, body: b, symbol: s, tf, image: im })).slice(0, 60));
      // örnek reklam geçmişi: dünün kayıtları doğrudan veritabanına
      const py = `
import sqlite3,time,sys
db=sqlite3.connect(sys.argv[1]); t=int(time.time()); d=time.strftime('%Y-%m-%d',time.gmtime(t-86400))
rows=[]; n=0
for src,cnt in ((1001,41000),(1002,17500),(1003,9200)):
    for i in range(cnt):
        n+=1; rows.append((f's{n}',3000+i%50,'support',1,'broadcaster',src,'verified',t-86400,t-86400,d))
for i in range(23000):
    n+=1; rows.append((f's{n}',4000+i%90,'pro_owner',0,'owner',0,'verified',t-86400,t-86400,d))
db.executemany("INSERT INTO ad_sessions (id,user_id,placement,post_id,src_type,src_id,status,created_at,verified_at,day) VALUES (?,?,?,?,?,?,?,?,?,?)",rows)
tot=len(rows); db.execute("INSERT INTO days (day,impressions,cpm_micro,revenue_micro,collected,note,updated_at) VALUES (?,?,?,?,?,?,?)",(d,tot,2400000,tot*2400000//1000,1,'örnek',t))
db.execute("INSERT INTO adjustments (bcast_id,amount_micro,note,created_at) VALUES (1001,25000000,'örnek bonus',?)",(t,))
db.commit()`;
      execFileSync('python3', ['-I', '-c', py, path.join(WORK, 'v.db')]);
      // topluluk ekranları
      const open = async (uid, v) => {
        const ctx = await newCtx(DESK, 2, PRO()); const pg = await ctx.newPage(); await klinesRoute(pg);
        await pg.goto(BASEAPI + `/index.html?demo=1&dev=${uid}`); await pg.waitForFunction(() => window.BeaconApi && window.BeaconApi.me, null, { timeout: 10000 }); await pg.waitForTimeout(800);
        await pg.click(`#dock [data-v="${v}"]`); await pg.waitForTimeout(1500); return [ctx, pg];
      };
      let [c1, p1] = await open(2001, 'feed'); await p1.screenshot({ path: shot('feed') }); await c1.close();
      [c1, p1] = await open(1001, 'acct'); await p1.evaluate(() => window.scrollTo(0, 0)); await p1.screenshot({ path: shot('bpanel') }); await c1.close();
      [c1, p1] = await open(ADMIN, 'acct'); await p1.evaluate(() => { const h = [...document.querySelectorAll('#aPanel h2')].find((x) => /Yayıncılar/.test(x.textContent)); h.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110); }); await p1.waitForTimeout(500); await p1.screenshot({ path: shot('admin') }); await c1.close();
    }

    /* 3) başlık, kapak ve altyazı kartları (şeffaf PNG) */
    const fontCss = `@font-face{font-family:'Inter';font-weight:400 600;src:url('${BASEURL}/fonts/Inter-Medium.woff')}@font-face{font-family:'ID';font-weight:700;src:url('${BASEURL}/fonts/InterDisplay-Bold.woff')}`;
    const cardPg = await (await newCtx({ width: 1920, height: 1080 }, 1, { legal: true })).newPage();
    const html = async (body, file, transparent = true) => { await cardPg.setContent(`<style>${fontCss} *{margin:0;box-sizing:border-box} body{width:1920px;height:1080px;font-family:Inter,sans-serif;color:#e9eef8;${transparent ? '' : 'background:radial-gradient(1200px 700px at 30% 20%,#12203a,#060a12)'}}</style>${body}`); await cardPg.waitForTimeout(300); await cardPg.screenshot({ path: shot(file), omitBackground: transparent }); };
    const cap = (t) => `<div style="position:absolute;left:0;right:0;bottom:46px;display:flex;justify-content:center;padding:0 160px"><div style="background:rgba(6,10,18,.84);border:1px solid #1f2b44;border-radius:16px;padding:20px 32px;font-size:34px;line-height:1.38;font-weight:500;text-align:center;max-width:1500px">${t}</div></div><div style="position:absolute;left:50%;transform:translateX(-50%);top:10px;font-size:18px;color:#a7b2c8;background:rgba(6,10,18,.7);border:1px solid #1f2b44;border-radius:10px;padding:6px 14px">Örnek verilerle gösterim</div>`;
    for (const s of SC) if (!['title', 'end'].includes(s.id)) await html(cap(s.text), 'cap-' + s.id);
    const mark = '<svg width="92" height="92" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0d1422" stroke="#1a2438"/><path d="M16 5l4 7h-8z" fill="#ffc25c"/><path d="M13 14h6l2 13H11z" fill="#e9eef8"/></svg>';
    await html(`<div style="height:100%;display:grid;place-content:center;text-align:center;gap:26px"><div style="margin:auto">${mark}</div><div style="font:700 112px/1.05 ID,Inter;letter-spacing:-.03em">Beacon</div><div style="font-size:44px;color:#a7b2c8">Kripto grafiğini tek bakışta okuyun.</div><div style="font-size:26px;color:#7e8ba6">Telegram mini uygulaması · Masaüstü terminali</div></div>`, 'title', false);
    await html(`<div style="height:100%;display:grid;place-content:center;text-align:center;gap:22px"><div style="margin:auto">${mark}</div><div style="font:700 96px/1.05 ID,Inter;letter-spacing:-.03em">Beacon</div><div style="font-size:42px;color:#ffc25c">t.me/BeaconCrypto_Bot</div><div style="font-size:28px;color:#a7b2c8;max-width:1200px;margin:auto">Beacon bir analiz ve eğitim aracıdır. Yatırım tavsiyesi değildir. Geçmiş performans gelecekteki sonucu garanti etmez; kripto varlıklar yüksek risk taşır.</div></div>`, 'end', false);
    // cihazlar sahnesi: telefon + masaüstü
    const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(shot(f)).toString('base64');
    await html(`<div style="height:100%;display:flex;align-items:center;justify-content:center;gap:70px;padding-bottom:120px"><img src="${b64('radar')}" style="width:1060px;border-radius:18px;border:1px solid #1f2b44;box-shadow:0 30px 80px rgba(0,0,0,.6)"><div style="width:380px;border-radius:44px;border:10px solid #1a2438;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)"><img src="${b64('mobile')}" style="width:100%;display:block"></div></div>`, 'devices', false);
    await cardPg.close();

    /* 4) ffmpeg: sahne başına bir dosya */
    const FFM = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    const files = [];
    SC.forEach((s) => { s.still = ['title', 'end', 'devices'].includes(s.id) ? s.id : s.id; });
    const stillOf = { trigger: 'trigger', form: 'form', radar: 'radar', scan: 'scan', market: 'market', fx: 'fx', feed: 'feed', bpanel: 'bpanel', admin: 'admin', pro: 'pro', devices: 'devices', title: 'title', end: 'end' };
    let t0 = 0; const srt = []; const fmt = (x) => { const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = x % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0').replace('.', ',')}`; };
    SC.forEach((s, i) => {
      const N = Math.round(s.dur * 30), tmp = path.join(WORK, `sc${i}.tmp.mp4`), out = path.join(WORK, `sc${i}.mp4`);
      const zoomIn = i % 2 === 0, z = zoomIn ? `1+0.00012*on` : `1.04-0.00012*on`;
      const hasCap = !['title', 'end'].includes(s.id);
      const zp = `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=1920x1080:fps=30`;
      const fades = `fade=t=in:st=0:d=0.4,fade=t=out:st=${(s.dur - 0.4).toFixed(3)}:d=0.4`;
      const fc = hasCap ? `[0:v]${zp},format=yuv420p[a];[1:v]format=rgba[c];[a][c]overlay=0:0:format=auto,${fades},format=yuv420p` : `[0:v]${zp},${fades},format=yuv420p`;
      const inputs = ['-i', shot(stillOf[s.id])].concat(hasCap ? ['-i', shot('cap-' + s.id)] : []);
      FFM([...inputs, '-filter_complex', fc, '-frames:v', String(N), '-r', '30', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', tmp]); fs.renameSync(tmp, out); files.push(out);
      srt.push(`${i + 1}\n${fmt(t0 + 0.4)} --> ${fmt(t0 + s.dur - 0.3)}\n${s.text}\n`); s.start = t0; t0 += s.dur;
    });
    fs.writeFileSync(path.join(WORK, 'list.txt'), files.map((f) => `file '${f}'`).join('\n'));
    const video = path.join(OUT, 'beacon-tanitim-sessiz.mp4'); FFM(['-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'list.txt'), '-c', 'copy', video + '.tmp.mp4']); fs.renameSync(video + '.tmp.mp4', video);
    fs.writeFileSync(path.join(OUT, 'altyazi.srt'), srt.join('\n'));
    fs.writeFileSync(path.join(OUT, 'seslendirme.txt'), 'BEACON TANITIM VİDEOSU: SESLENDİRME METNİ\n(Her bölümün yanındaki süre, o bölümün videodaki başlangıç anıdır. Okuma hızı dakikada yaklaşık 140 kelimeye göre ayarlıdır.)\n\n' + SC.map((s, i) => `[${fmt(s.start).slice(3, 8)}]  (${s.dur.toFixed(1)} sn)\n${s.text}\n`).join('\n'));
    console.log('SÜRE', t0.toFixed(1), 'sn');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await browser.close(); srv.kill(); web.close(); webApi.close(); }
})();
