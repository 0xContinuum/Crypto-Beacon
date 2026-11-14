/* Piyasa göstergelerini sınar. Kullanım:
 *   node tools/validate_market.js --synthetic        (GARCH sentetik veri; ağ gerekmez)
 *   node tools/validate_market.js                     (Binance günlük BTCUSDT mumlarını indirir)
 */
const X = require('../web/js/market-ext.js');
const syn = process.argv.includes('--synthetic');
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sim(n, seed) { const r = rng(seed), g = () => { let u = 0; for (let i = 0; i < 12; i++) u += r(); return u - 6; }; let p = 20000, v = 0.0009, t0 = Date.UTC(2017, 0, 1); const o = [];
  for (let i = 0; i < n; i++) { const e = g() * (r() < .05 ? 2.2 : 1), ret = Math.sqrt(v) * e; v = 0.00001 + 0.08 * ret * ret + 0.9 * v; const op = p, cl = p * Math.exp(ret), a = Math.abs(g()) * Math.sqrt(v) * .6; o.push({ t: t0 + i * 864e5, o: op, h: Math.max(op, cl) * (1 + a), l: Math.min(op, cl) * (1 - a), c: cl, v: 1000 * (1 + Math.abs(g()) * .5) * (1 + Math.sqrt(v) * 20) }); p = cl; } return o; }
async function real() { const out = []; let end = Date.now(); for (let k = 0; k < 4; k++) { const r = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000&endTime=' + end); const a = await r.json(); if (!a.length) break; out.unshift(...a.map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }))); end = a[0][0] - 1; } return out; }
(async () => {
  if (!syn) { const cs = await real(); report('BTCUSDT gerçek (' + cs.length + ' gün)', cs); return; }
  const N = +process.env.N || 30; let moonSig = 0, bowRatio = [], hit = 0, hitN = 0, cov = [], r2 = [];
  for (let s = 1; s <= N; s++) { const cs = sim(2000, s), m = X.moonTest(cs); if (m.ph.p < .025 || m.an.p < .025) moonSig++; const b = X.bowTension(cs); if (b.stats.resolved) bowRatio.push(b.stats.avgExc / b.stats.baseExc); hit += b.stats.hit; hitN += b.stats.hitN; const S = X.stormGauge(cs); cov.push([S.st.cov80, S.st.cov95, S.st.corr]); r2.push(S.st.r2vsMean); }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log('AY: sahte "etki" oranı (beklenen ≈ %5): ' + (moonSig / N * 100).toFixed(1) + '% (' + moonSig + '/' + N + ')');
  console.log('YAY: gerilim>85 sonrası sapma / olağan sapma ort.: ' + mean(bowRatio).toFixed(2) + '  yön isabeti: ' + hit + '/' + hitN + ' = ' + (hit / hitN * 100).toFixed(1) + '%');
  console.log('FIRTINA: kapsama %80→' + (mean(cov.map((c) => c[0])) * 100).toFixed(1) + ' %95→' + (mean(cov.map((c) => c[1])) * 100).toFixed(1) + ' korelasyon ' + mean(cov.map((c) => c[2])).toFixed(2) + ' R²(ortalamaya göre) ' + mean(r2).toFixed(2));
})();
function report(name, cs) { const m = X.moonTest(cs), b = X.bowTension(cs), S = X.stormGauge(cs); console.log(name, '\nAy p(faz)=', m.ph.p.toFixed(3), 'p(yakınlık)=', m.an.p.toFixed(3), '\nYay', JSON.stringify(b.stats), '\nFırtına', JSON.stringify(S.st)); }
