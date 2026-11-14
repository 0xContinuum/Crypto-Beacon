const assert = require('assert'); const X = require('../web/js/market-ext.js');
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sim(n, seed) { const r = rng(seed), g = () => { let u = 0; for (let i = 0; i < 12; i++) u += r(); return u - 6; }; let p = 20000, v = 0.0009; const o = [];
  for (let i = 0; i < n; i++) { const ret = Math.sqrt(v) * g(); v = 0.00001 + 0.08 * ret * ret + 0.9 * v; const op = p, cl = p * Math.exp(ret), a = Math.abs(g()) * Math.sqrt(v) * .6; o.push({ t: 1.5e12 + i * 864e5, o: op, h: Math.max(op, cl) * (1 + a), l: Math.min(op, cl) * (1 - a), c: cl, v: 1000 + Math.abs(g()) * 500 }); p = cl; } return o; }
let ok = 0; const t = (n, f) => { try { f(); ok++; console.log('✓', n); } catch (e) { console.error('✗', n, e.message); process.exitCode = 1; } };
const cs = sim(2500, 7), S = X.stormGauge(cs);
t('hiç NaN olmayan tahmin üretir', () => assert(S.yhat.filter(Number.isFinite).length > 2000));
t('kapsama %80/%95 hedefine yakın', () => { assert(Math.abs(S.st.cov80 - .8) < .04, S.st.cov80); assert(Math.abs(S.st.cov95 - .95) < .03, S.st.cov95); });
t('ortalamadan ve son-30-günden iyi', () => { assert(S.st.r2vsMean > 0.1); assert(S.st.r2vsNaive > 0); assert(S.st.ratio > 1.2); });
t('geleceğe bakmaz: kesilmiş veride aynı değerler', () => { for (const cut of [1200, 1800]) { const P = X.stormGauge(cs.slice(0, cut)); for (let i = 400; i < cut - 10; i += 37) { const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9; assert(same(P.yhat[i], S.yhat[i]) && same(P.q.hi80[i], S.q.hi80[i]), 'i=' + i); } } });
t('son mumu değiştirmek eski tahminleri değiştirmez', () => { const c2 = cs.map((k) => ({ ...k })); c2[c2.length - 1].c *= 3; c2[c2.length - 1].h *= 3; const P = X.stormGauge(c2); for (let i = 400; i < cs.length - 10; i += 50) assert.strictEqual(P.yhat[i], S.yhat[i]); });
t('hız: 2500 gün < 300 ms', () => { const a = Date.now(); X.stormGauge(cs); assert(Date.now() - a < 300); });
t('compute az veriyi reddeder', () => assert.strictEqual(X.compute(cs.slice(0, 100)), null));
t('kart şeması', () => { const R = X.compute(cs), tt = R.t, cards = X.cards(R, { t: tt, c: cs.map((k) => k.c), xMin: tt[0], beam: '#fc5', foam: '#eee', bull: '#3d9', bear: '#f66' }); const st = cards.find((c) => c.id === 'storm'); assert(st && /^±%/.test(st.value) && st.cfg.series.length === 2 && st.info.includes('YÖN SÖYLEMEZ')); assert(!cards.find((c) => c.id === 'moon') && !cards.find((c) => c.id === 'bow')); const dr = cards.find((c) => c.id === 'drop'); assert(dr && /^%-/.test(dr.value.replace('−','-')) || dr && /^%/.test(dr.value)); assert(dr.cfg.under && st.cfg.under); });
t('ay evresi: 2000-01-06 yeni ay civarı', () => { const m = X.moonAt(Date.UTC(2000, 0, 6, 18)); assert(m.ph < 0.02 || m.ph > 0.98, JSON.stringify(m)); });
const Dg = X.dropGauge(cs);
t('Düşüş Tabanı: %90/%95 sınırları tutuyor', () => { assert(Math.abs(Dg.st.cov90 - .9) < .04, Dg.st.cov90); assert(Math.abs(Dg.st.cov95 - .95) < .035, Dg.st.cov95); });
t('Düşüş Tabanı: sabit sınırdan daha dengeli (hareketli dönemde)', () => { assert(Dg.st.covHigh > Dg.st.staticHigh - 0.01 && Dg.st.covLow < Dg.st.staticLow + 0.01, JSON.stringify(Dg.st)); assert(Dg.st.ratio > 1.1); });
t('Düşüş Tabanı: geleceğe bakmaz', () => { const P = X.dropGauge(cs.slice(0, 1500)); const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9; for (let i = 400; i < 1460; i += 41) assert(same(P.dn90[i], Dg.dn90[i]) && same(P.up90[i], Dg.up90[i]), 'i=' + i); });
t('Düşüş Tabanı: sınır her zaman negatif, seviyeler sıralı', () => { assert(Dg.now < 0 && Dg.lvl.dn95 < Dg.lvl.dn90 && Dg.lvl.dn90 < Dg.price && Dg.lvl.up90 > Dg.price); });
t('Düşüş Tabanı hız < 400 ms', () => { const a = Date.now(); X.dropGauge(cs); assert(Date.now() - a < 400); });
console.log(ok + ' test geçti');
