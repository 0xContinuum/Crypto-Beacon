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
let r = P.convert(fx('Nexus_Alpha')), run = S.run(r.code, cs);
ok(r.skipped === 2 && r.drawable, 'Nexus Alpha: yalnızca mum rengi ve dolgu atlanır');
ok(run.filter((q) => q.pane === 'mark').length === 2 && run.filter((q) => q.pane === 'price').length === 2, 'Nexus Alpha: 2 işaret + 2 çizgi');
// sinyal mantığı elle
const c = cs.map((k) => k.c), sd = (a, n) => a.map((_, i) => { if (i < n - 1) return NaN; const w = a.slice(i - n + 1, i + 1), mu = w.reduce((x, y) => x + y) / n; return Math.sqrt(w.reduce((x, y) => x + (y - mu) ** 2, 0) / n); });
const basis = B.indicators.sma(c, 20), sdv = sd(c, 20), up = run.find((q) => q.label === 'Üst Bant');
ok(up.values.every((v, i) => approx(v, basis[i] + 2 * sdv[i])), 'Nexus Alpha: üst Bollinger bandı elle hesapla aynı');

/* Macro Cycle: haftalık RSI atlanır, kalanı çalışır */
r = P.convert(fx('Macro_Cycle_Decipherer')); run = S.run(r.code, cs);
ok(/trendState = hold\(0,/.test(r.code) && run.filter((q) => q.pane === 'mark').length === 2, 'Macro Cycle: var/:= → hold ve 2 etiket');
ok(P.groupReport(r.report).some((g) => /request\.security/.test(g.text)) && P.groupReport(r.report).some((g) => /önceki mumdaki/.test(g.text)), 'Macro Cycle: request.security ve bekleme süresi kalıbı raporlanır');

/* Trend Signals */
r = P.convert(fx('Trend_Signals')); run = S.run(r.code, cs);
ok(run.filter((q) => q.pane === 'price').length === 3 && run.filter((q) => q.pane === 'mark').length === 4, 'Trend Signals: 3 çizgi + 4 işaret');
const tr = run.find((q) => /Upper/.test(q.label)); ok(tr.values.some(Number.isNaN) && tr.values.some(Number.isFinite), 'Trend Signals: koşullu bant yalnızca trend -1 iken çizilir');
ok(!r.code.includes('table') && r.skipped > 30, 'Trend Signals: tablo/uyarı satırları atlanır');

/* TPL Pro ve Formasyon: dürüstçe çevrilemez, ama çökmez */
for (const n of ['Beacon_TPL_Pro', 'Formasyon']) { r = P.convert(fx(n)); ok(!r.drawable && r.warnings.length > 0 && r.skipped > 20, n + ': çevrilemeyen kod uyarıyla bildirilir'); }

/* güvenlik: sessizce yanlış çeviri yok */
r = P.convert('//@version=5\nindicator("t")\nx = ta.foo(close, 5)\nplot(ta.sma(close, 20), "ok")'); ok(r.skipped === 1 && /ta\.foo/.test(r.report.find((q) => q.status === 'skip').text) && S.run(r.code, cs).length === 1, 'bilinmeyen işlev atlanır, gerisi çevrilir');
r = P.convert('//@version=5\nindicator("t", overlay=false)\n[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(h, "h")'); run = S.run(r.code, cs); ok(run[0].pane === 'sub' && run[0].values.every((v, i) => approx(v, B.indicators.macd(c).hist[i])), 'overlay=false → pane, ta.macd üçlüsü çevrilir');
r = P.convert('plot(ta.highest(10), "h")\nplot(not (close > open) ? 1 : 0)'); ok(r.drawable && /highest\(high, 10\)/.test(r.code), 'tek argümanlı highest ve not');
ok(P.convert('').skipped === 0 && !P.convert('').drawable, 'boş girdi çökmez');
console.log(`\nTÜM PINE TESTLERİ GEÇTİ (${pass})`);
