// Çalıştırma: node tests/market.test.js
const assert = require('assert'); const M = require('../web/js/market.js');
let pass = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); pass++; console.log('PASS ' + m); };
const DAY = 864e5, start = Date.UTC(2017, 7, 17);
// üstel büyüyen sentetik seri: fiyat = 4000·e^(0.0016·gün), dalgalanma + bir tepe
const cs = Array.from({ length: 3300 }, (_, i) => { const c = 4000 * Math.exp(0.0016 * i + 0.25 * Math.sin(i / 90)); return { t: start + i * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }; });
const now = cs[cs.length - 1].t + DAY;
const r = M.compute(cs, now);
ok(r && r.n === 3300, 'yeterli veriyle hesaplanır');
ok(M.compute(cs.slice(0, 100), now) === null, 'yetersiz veride null döner');
const sma = (a, n, i) => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += a[j]; return s / n; }, c = cs.map((k) => k.c), L = cs.length - 1;
ok(Math.abs(r.mayer.now - c[L] / sma(c, 200, L)) < 1e-9, 'Mayer çarpanı = fiyat / 200 günlük ortalama');
ok(Math.abs(r.pi.now - sma(c, 111, L) / (2 * sma(c, 350, L))) < 1e-9, 'Pi Cycle oranı = 111G / (2 × 350G)');
ok(Math.abs(r.w200.maNow - sma(c, 1400, L)) < 1e-6, '200 hafta ortalama 1400 günlük ortalamadır');
ok(Number.isNaN(r.w200.ratio[1000]) && Number.isFinite(r.w200.ratio[1500]), '200 hafta oranı yeterli veri oluşana kadar boş (NaN)');
ok(r.ma2y.available && Math.abs(r.ma2y.x5[L] - 5 * sma(c, 730, L)) < 1e-6, '2Y ortalama ×5 bandı');
ok(r.rainbow.bands.length === 8 && r.rainbow.bands.every((b, k, a) => k === 0 || b[L] > a[k - 1][L]), 'rainbow bantları artan sırada');
ok(Math.abs(r.rainbow.fit.b - 0) > 0 && r.rainbow.idx >= 0 && r.rainbow.idx < 8, 'rainbow bölgesi geçerli: ' + r.rainbow.name);
// Pi Cycle kesişim: sahte tepede 111G, 2×350G'yi geçmeli
const spike = cs.map((k, i) => { const m = i > 3150 ? 40 : 1; return { ...k, c: k.c * m, h: k.c * m, l: k.c * m, o: k.c * m }; });
const rs = M.compute(spike, now);
ok(rs.pi.crosses.length >= 1 && rs.pi.state === 'Tetiklendi', 'Pi Cycle sert yükselişte tetiklenir ve kesişim tarihi kaydedilir');
ok(r.halving.ath === Math.max(...c) && r.halving.drawdown <= 0 && r.halving.drawdown >= -1, 'ATH ve düşüş oranı tutarlı');
ok(r.halving.cycles.length === 2 && r.halving.cycles[1].vals[0] === 1, 'halving döngüleri halving günü fiyatına göre normalleşir');
ok(r.halving.daysSince === Math.floor((now - Date.UTC(2024, 3, 20)) / DAY), 'halving\'den beri gün sayısı doğru');
ok(['Düşük', 'Normal', 'Yüksek', 'Aşırı'].includes(r.mayer.state), 'Mayer bölgesi adı geçerli');
console.log(`\nTÜM PİYASA TESTLERİ GEÇTİ (${pass})`);
