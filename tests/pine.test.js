// Çalıştırma: node tests/pine.test.js
const assert = require('assert'), fs = require('fs');
global.Beacon = require('../web/js/engine.js');
const S = require('../web/js/script.js'), P = require('../web/js/pine.js'), B = global.Beacon;
let pass = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); pass++; console.log('PASS ' + m); };
const cs = Array.from({ length: 600 }, (_, i) => { const c = 100 + Math.sin(i / 9) * 10 + Math.cos(i / 3) * 2 + i * 0.05; return { t: i * 3600000, o: c - 0.4, h: c + 1.5, l: c - 1.5, c, v: 1000 + (i % 7) * 10 }; });
const fx = (n) => fs.readFileSync(__dirname + '/fixtures/pine/' + n + '.pine', 'utf8');
const approx = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9;

/* dil eklemeleri */
let p = S.run('plot(close[1], "x")', cs); ok(Number.isNaN(p[0].values[0]) && p[0].values[5] === cs[4].c, 'x[1] geçmiş mum erişimi');
p = S.run('plot(hma(close, 21))\nplot(wma(close, 10))\nplot(alma(close, 20))\npane(cci(close, 20))\npane(mfi(hlc3, 14))\npane(stoch(close, high, low, 14))\nplot(vwma(close, 20))', cs);
ok(p.length === 7 && p.every((q) => q.values.filter(Number.isFinite).length > 400), 'yeni göstergeler değer üretir');
const wm = (n) => cs.map((_, i) => { if (i < n - 1) return NaN; let s = 0; for (let j = 0; j < n; j++) s += cs[i - j].c * (n - j); return s / (n * (n + 1) / 2); });
p = S.run('plot(wma(close, 10))', cs); ok(p[0].values.every((v, i) => approx(v, wm(10)[i])), 'wma elle hesapla aynı');
const m = B.indicators.macd(cs.map((k) => k.c)); p = S.run('pane(macd(close))\npane(macdsig(close))', cs);
ok(p[0].values.every((v, i) => approx(v, m.line[i])) && p[1].values.every((v, i) => approx(v, m.sig[i])), 'macd motorla aynı');
p = S.run('t = hold(0, crossover(close, sma(close, 20)), 1, crossunder(close, sma(close, 20)), -1)\npane(t)', cs);
ok(p[0].values.every((v) => v === 0 || v === 1 || v === -1) && p[0].values.some((v) => v === 1) && p[0].values.some((v) => v === -1), 'hold durumu tutar');
p = S.run('mark(crossover(close, sma(close, 20)), "up", "AL", "#35d6a0")\nplot(close)', cs);
ok(p[0].pane === 'mark' && p[0].on.some((v) => v) && p[0].dir === 'up' && p[0].text === 'AL', 'mark işareti üretilir');

/* Nexus Alpha: neredeyse tamamen çevrilir */
let r = P.convert1(fx('Nexus_Alpha')), run = S.run(r.code, cs);
ok(r.skipped === 2 && r.drawable, 'Nexus Alpha: yalnızca mum rengi ve dolgu atlanır');
ok(run.filter((q) => q.pane === 'mark').length === 2 && run.filter((q) => q.pane === 'price').length === 2, 'Nexus Alpha: 2 işaret + 2 çizgi');
// sinyal mantığı elle
const c = cs.map((k) => k.c), sd = (a, n) => a.map((_, i) => { if (i < n - 1) return NaN; const w = a.slice(i - n + 1, i + 1), mu = w.reduce((x, y) => x + y) / n; return Math.sqrt(w.reduce((x, y) => x + (y - mu) ** 2, 0) / n); });
const basis = B.indicators.sma(c, 20), sdv = sd(c, 20), up = run.find((q) => q.label === 'Üst Bant');
ok(up.values.every((v, i) => approx(v, basis[i] + 2 * sdv[i])), 'Nexus Alpha: üst Bollinger bandı elle hesapla aynı');

/* Macro Cycle: haftalık RSI atlanır, kalanı çalışır */
r = P.convert1(fx('Macro_Cycle_Decipherer')); run = S.run(r.code, cs);
ok(/trendState = hold\(0,/.test(r.code) && run.filter((q) => q.pane === 'mark').length === 2, 'Macro Cycle: var/:= → hold ve 2 etiket');
ok(P.groupReport(r.report).some((g) => /request\.security/.test(g.text)) && P.groupReport(r.report).some((g) => /önceki mumdaki/.test(g.text)), 'Macro Cycle: request.security ve bekleme süresi kalıbı raporlanır');

/* Trend Signals */
r = P.convert1(fx('Trend_Signals')); run = S.run(r.code, cs);
ok(run.filter((q) => q.pane === 'price').length === 3 && run.filter((q) => q.pane === 'mark').length === 4, 'Trend Signals: 3 çizgi + 4 işaret');
const tr = run.find((q) => /Upper/.test(q.label)); ok(tr.values.some(Number.isNaN) && tr.values.some(Number.isFinite), 'Trend Signals: koşullu bant yalnızca trend -1 iken çizilir');
ok(!r.code.includes('table') && r.skipped > 30, 'Trend Signals: tablo/uyarı satırları atlanır');

/* TPL Pro (Aşama 2): kendi fonksiyonlar açılır, string seçenek sabiti çözülür; döngüsel durum (cooldown) kısmı atlanır */
r = P.convert1(fx('Beacon_TPL_Pro')); run = S.run(r.code, cs);
ok(r.drawable && /basis = \(?hma\(/.test(r.code.replace(/\s+/g, ' ')) || /hma\(src, trendLen\)/.test(r.code), 'TPL Pro: f_getMA açılır, "HMA" seçeneği sabit çözülür');
const tl = run.find((q) => q.label === 'Trend Pressure Line'); ok(!!tl && tl.pane === 'price', 'TPL Pro: ana çizgi çevrilir');
{ const cl = cs.map((k) => k.c), I = B.indicators, bs = S.run('plot(hma(close, 34))', cs)[0].values, at = I.atr(cs.map((k) => k.h), cs.map((k) => k.l), cl, 14);
  const raw = cs.map((k, i) => { const sa = at[i] !== 0 ? at[i] : 1e-8, pp = (cl[i] - bs[i]) / sa, bp = (k.c - k.o) / sa, mp = i ? (cl[i] - cl[i - 1]) / sa : NaN; return (pp * 0.5 + bp * 0.3 + mp * 0.2) / 1.0; });
  const pr = I.ema(raw, 8), line = I.ema(cs.map((_, i) => bs[i] + pr[i] * (at[i] !== 0 ? at[i] : 1e-8)), 7);
  ok(tl.values.every((v, i) => (Number.isNaN(v) && Number.isNaN(line[i])) || Math.abs(v - line[i]) < 1e-6), 'TPL Pro: Trend Pressure Line elle hesaplananla aynı'); }
ok(P.groupReport(r.report).some((g) => /lastSignalBar/.test(g.text)), 'TPL Pro: bekleme süresi/durum kalıbı raporlanır');
r = P.convert1(fx('Formasyon')); ok(!r.drawable && r.warnings.length > 0 && r.skipped > 20, 'Formasyon: çevrilemeyen kod uyarıyla bildirilir');
r = P.convert1('//@version=5\nindicator("f")\nf_avg(a, b) =>\n    m = (a + b) / 2\n    m * 2\nx = f_avg(close, open)\nplot(x, "x")\nmode = input.string("EMA", "m", options=["EMA", "SMA"])\ny = mode == "EMA" ? ta.ema(close, 10) : ta.sma(close, 10)\nplot(y, "y")');
run = S.run(r.code, cs); ok(r.drawable && run.length === 2 && run[0].values.every((v, i) => Math.abs(v - (cs[i].c + cs[i].o)) < 1e-9), 'çok satırlı kendi fonksiyon açılır ve doğru hesaplar');
ok(run[1].values.every((v, i) => Math.abs(v - S.run('plot(ema(close, 10))', cs)[0].values[i]) < 1e-9 || Number.isNaN(v)) && !/sma\(/.test(r.code), 'sabit string koşulu seçili dalı alır, diğeri çıktıya girmez');

/* güvenlik: sessizce yanlış çeviri yok */
r = P.convert1('//@version=5\nindicator("t")\nx = ta.foo(close, 5)\nplot(ta.sma(close, 20), "ok")'); ok(r.skipped === 1 && /ta\.foo/.test(r.report.find((q) => q.status === 'skip').text) && S.run(r.code, cs).length === 1, 'bilinmeyen işlev atlanır, gerisi çevrilir');
r = P.convert1('//@version=5\nindicator("t", overlay=false)\n[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(h, "h")'); run = S.run(r.code, cs); ok(run[0].pane === 'sub' && run[0].values.every((v, i) => approx(v, B.indicators.macd(c).hist[i])), 'overlay=false → pane, ta.macd üçlüsü çevrilir');
r = P.convert1('plot(ta.highest(10), "h")\nplot(not (close > open) ? 1 : 0)'); ok(r.drawable && /highest\(high, 10\)/.test(r.code), 'tek argümanlı highest ve not');
ok(P.convert1('').skipped === 0 && !P.convert1('').drawable, 'boş girdi çökmez');

/* ——— Formül 2 (mum mum motor) ——— */
const S2 = require('../web/js/script2.js');
const hcs = []; for (let i = 0; i < 40; i++) { const sl = cs.slice(i * 24, i * 24 + 24); if (sl.length < 24) break; hcs.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map((x) => x.h)), l: Math.min(...sl.map((x) => x.l)), c: sl[23].c, v: 1 }); }
for (const f of ['Beacon_TPL_Pro', 'Macro_Cycle_Decipherer', 'Nexus_Alpha', 'Trend_Signals', 'Formasyon']) { let e = null, res; try { res = S2.run('//@beacon2\n' + fx(f), cs, { tf: '1h', getCandles: () => hcs }); } catch (x) { e = x; } ok(!e && res.length > 0, `Formül 2: ${f} hatasız çalışır${e ? ' – ' + e.message : ''}`); }
r = P.convert(fx('Formasyon')); ok(r.engine === 2 && r.drawable && /^\/\/@beacon2/.test(r.code), 'Formasyon artık Formül 2 ile çevrilir');
r = P.convert(fx('Nexus_Alpha')); ok(r.engine === 2 && r.skipped === 0, 'Nexus tam çevrilir (Formül 2)');
let q = S2.run('var int cnt = 0\nup = ta.crossover(close, ta.sma(close, 20))\nif up\n    cnt := cnt + 1\nplot(cnt, "c")', cs, { tf: '1h' }); ok(q[0].values[599] > 0 && q[0].values.every((v, i) => i === 0 || v >= q[0].values[i - 1]), 'var + := sayaç artar, geri düşmez');
q = S2.run('f(x, n) =>\n    s = 0.0\n    for i = 0 to n - 1\n        s += x[i]\n    s / n\nplot(f(close, 5), "a")\nplot(ta.sma(close, 5), "b")', cs, { tf: '1h' }); ok(q[0].values.every((v, i) => (Number.isFinite(v) ? Math.abs(v - q[1].values[i]) < 1e-9 : !Number.isFinite(q[1].values[i]) || i < 5)), 'kullanıcı fonksiyonu + for döngüsü SMA ile aynı sonucu verir');
let t0 = Date.now(), e2 = null; try { S2.run('while true\n    x = 1\nplot(1)', cs, {}); } catch (x) { e2 = x; } ok(e2 && Date.now() - t0 < 6000, 'sonsuz döngü güvenle durdurulur');
e2 = null; try { S2.run('plot(close[-1])', cs, {}); } catch (x) { e2 = x; } ok(e2 && /geleceğe/.test(e2.message), 'geleceğe bakış reddedilir');
q = S2.run('d = request.security(syminfo.tickerid, "1D", close)\nplot(d, "d")', cs, { tf: '1h', getCandles: () => hcs }); const vv = q[0].values.filter(Number.isFinite); ok(vv.length > 400 && q[0].values.every((v, i) => !Number.isFinite(v) || cs[i].t >= hcs[0].t), 'request.security son tamamlanan üst mumu kullanır');
q = S2.run('if barstate.islast\n    label.new(bar_index, high, "son")\n    line.new(bar_index - 5, low, bar_index, high)\n    box.new(bar_index - 5, high, bar_index, low, bgcolor=color.new(color.red, 80))\nbgcolor(close > open ? color.new(color.green, 85) : na)', cs, { tf: '1h' }); ok(q.some((x) => x.pane === 'draw' && x.draws.labels.length === 1 && x.draws.lines.length === 1 && x.draws.boxes.length === 1) && q.some((x) => x.pane === 'bg'), 'etiket/çizgi/kutu/bgcolor üretilir');
{ const r = P.convert(fx('Yay_Gerilimi')); ok(r.ok !== false && /^\/\/@beacon2/.test(r.code), 'Yay Gerilimi Formül 2 olarak çevrilir');
  const d1 = Array.from({ length: 900 }, (_, i) => { const c = 100 + Math.sin(i / 30) * 20 + i * 0.02; return { t: 1.6e12 + i * 864e5, o: c, h: c * 1.02, l: c * 0.98, c, v: 1000 + (i % 11) * 30 }; });
  const wk = Array.from({ length: 200 }, (_, i) => { const c = 100 + i * 0.1; return { t: 1.6e12 + i * 6048e5, o: c, h: c * 1.05, l: c * 0.95, c, v: 5000 }; });
  const pl = S.run(r.code, d1, { tf: '1d', symbol: 'BTCUSDT', getCandles: (tf) => (tf === '1W' || tf === '1w' ? wk : d1) }); ok(Array.isArray(pl) && pl.length > 0 && pl.some((p) => p.kind === 'draw' || p.type === 'draw' || /draw|bg|mark/.test(JSON.stringify(Object.keys(p)) + (p.kind || p.type || ''))), 'Yay Gerilimi örnek veride hatasız çalışır ve çizim üretir'); }
const mt = S2.run('//@beacon2\nplot(1, "a")\nvar t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, str.tostring(0.5, format.mintick))', cs, {}); ok(mt, 'format.mintick hata vermez');
{ const dc = fs.readFileSync(__dirname + '/fixtures/beacon/Denge_Hatti.beacon.txt', 'utf8'); const o = S.run(dc, cs, {}); ok(o.filter((x) => x.pane === 'price').length === 5 && o.some((x) => x.pane === 'fill') && o.filter((x) => x.pane === 'mark').length === 2, 'Beacon Denge Hattı örnek göstergesi çalışır');
  const a = o[0].values, b = S.run(dc, cs.slice(0, 450), {})[0].values; let bad = 0; for (let i = 0; i < 440; i++) if (!(Math.abs(a[i] - b[i]) < 1e-9)) bad++; ok(bad === 0, 'Beacon Denge Hattı geleceğe bakmaz'); }
console.log(`\nTÜM PINE TESTLERİ GEÇTİ (${pass})`);
