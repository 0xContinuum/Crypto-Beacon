// Çalıştırma: node tests/formation.test.js
const assert = require('assert');
const F = require('../web/js/formation.js');
let pass = 0;
const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); pass++; console.log('PASS ' + m); };

/* köşe noktalarından mum üretir: her köşe arasında `seg` mum, çizgisel yol */
function build(points, seg = 8) {
  const closes = [points[0]];
  for (let k = 1; k < points.length; k++) for (let s = 1; s <= seg; s++) closes.push(points[k - 1] + ((points[k] - points[k - 1]) * s) / seg);
  return closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: i, o, c, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, v: 1 }; });
}
const OPT = { pivot: 3, tol: 1.5 };
const det = (pts, seg) => F.detect(build(pts, seg), OPT);

/* pivotlar */
{
  const cs = build([95, 100, 90, 100.2, 94, 98]);
  const { ph, pl } = F.pivots(cs, 3);
  ok(ph.map((x) => x.i).join() === '8,24' && pl.map((x) => x.i).join() === '16,32', 'pivot tepe ve dipleri doğru mumlarda (8,24 / 16,32)');
}

/* üçgenler */
let r = det([95, 100, 90, 100.2, 94, 98]);
ok(r && r.key === 'asc' && r.name === 'Yükselen Üçgen' && r.status === 'Takipte', 'yükselen üçgen: yatay tepe + yükselen dipler, kırılım yok');
ok(Math.abs(r.lines[0].p0 - r.lines[0].p1) < 1e-9 && r.lines[1].p1 > r.lines[1].p0, 'yükselen üçgen: üst çizgi yatay, alt çizgi yükseliyor');
r = det([95, 100, 90, 100.2, 94, 101.5]);
ok(r && r.key === 'asc' && r.status === 'Yukarı kırılım', 'yükselen üçgen: tavanın üstünde kapanış = yukarı kırılım');
r = det([95, 100, 90, 98, 90.2, 92]);
ok(r && r.key === 'desc' && r.name === 'Alçalan Üçgen' && r.status === 'Takipte', 'alçalan üçgen: yatay dip + alçalan tepeler');
r = det([95, 100, 90, 98, 90.2, 93, 87]);
ok(r && r.key === 'desc' && r.status === 'Aşağı kırılım', 'alçalan üçgen: tabanın altında kapanış = aşağı kırılım');
r = det([95, 100, 90, 97.5, 92, 94]);
ok(r && r.key === 'sym' && r.name === 'Simetrik Üçgen' && r.status === 'Takipte', 'simetrik üçgen: alçalan tepeler + yükselen dipler');

/* takozlar */
r = det([95, 100, 90, 94, 87, 90]);
ok(r && r.key === 'fwedge' && r.name === 'Alçalan Takoz', 'alçalan takoz: üst çizgi daha dik düşüyor');
r = det([95, 100, 90, 104, 96, 100]);
ok(r && r.key === 'rwedge' && r.name === 'Yükselen Takoz', 'yükselen takoz: alt çizgi daha dik yükseliyor');
{ // genişleyen yapı takoz değildir: tepeler yükselir, dipler düşer
  r = det([95, 100, 90, 104, 86, 95]);
  ok(r === null, 'genişleyen yapı (tepeler yukarı, dipler aşağı) formasyon sayılmaz');
}

/* eğim mum başına: pivotlar arası mesafe farklıysa Pine'dan farklı sonuç doğru olmalı */
{
  // tepeler 8 mum arayla (hızlı), dipler 24 mum arayla (yavaş) düşüyor; fiyat farkı aynı (-4) ama mum başına eğim farklı
  const cs = [];
  const seg = (a, b, n) => { for (let s = 1; s <= n; s++) cs.push(a + ((b - a) * s) / n); };
  cs.push(100); seg(100, 110, 6); seg(110, 100, 6); seg(100, 106, 6); seg(106, 90, 14); seg(90, 100, 14); seg(100, 86, 14);
  const cd = cs.map((c, i) => { const o = i ? cs[i - 1] : c; return { t: i, o, c, h: Math.max(o, c) + 0.02, l: Math.min(o, c) - 0.02, v: 1 }; });
  const rr = F.detect(cd, { pivot: 3, tol: 1.5 });
  ok(rr === null || rr.key !== 'rwedge', 'eğim mum başına hesaplanır, mesafe farkı yanlış takoz üretmez');
}

/* ikili tepe / dip */
r = det([95, 100, 90, 100.4, 86, 92]);
ok(r && r.key === 'dtop' && r.name === 'İkili Tepe' && r.status === 'Takipte', 'ikili tepe: iki eşit tepe, aradaki dip boyun çizgisi');
ok(Math.abs(r.levels.neck - 89.95) < 0.2, 'ikili tepe boyun çizgisi ara dibin altında (' + r.levels.neck.toFixed(2) + ')');
r = det([95, 100, 90, 100.4, 86, 86.5]);
ok(r && r.key === 'dtop' && /aşağı kırıldı/.test(r.status), 'ikili tepe: boyunun altında kapanış = aşağı kırıldı');
r = det([95, 90, 100, 89.8, 103, 98]);
ok(r && r.key === 'dbot' && r.name === 'İkili Dip' && r.status === 'Takipte', 'ikili dip: iki eşit dip, aradaki tepe boyun çizgisi');
r = det([95, 90, 100, 89.8, 103, 102]);
ok(r && r.key === 'dbot' && /yukarı kırıldı/.test(r.status), 'ikili dip: boynun üstünde kapanış = yukarı kırıldı');

/* belirsiz yatay aralık: tepeler de dipler de eşitse en yeni ikinci pivotun yönü seçilir */
{
  const rr = det([95, 100, 90, 100.4, 89, 92]);
  ok(rr && (rr.key === 'dtop' || rr.key === 'dbot'), 'yatay aralıkta (tepe+dip eşit) tek bir formasyon döner: ' + (rr && rr.key));
}

/* güvenlik: repaint yok, bayat formasyon yok, yetersiz veri */
{
  const cs = build([95, 100, 90, 100.2, 94, 98]);
  ok(F.detect(cs.slice(0, 34), OPT) === null, 'onaylanmamış pivot kullanılmaz (sağında n mum yoksa formasyon yok)');
  const stale = cs.concat(Array.from({ length: 30 }, (_, k) => ({ t: 100 + k, o: 98, c: 98, h: 98.05, l: 97.95, v: 1 })));
  ok(F.detect(stale, OPT) === null, 'bayat formasyon (en yeni pivot 6n mumdan eski) gösterilmez');
  ok(F.detect(cs.slice(0, 5), OPT) === null, 'yetersiz veride null döner');
  const a = F.detect(cs, OPT), b = F.detect(cs.map((x) => Object.assign({}, x)), OPT);
  ok(JSON.stringify(a) === JSON.stringify(b), 'aynı girdi aynı sonuç (deterministik)');
}

/* kesişen çizgiler (tepe noktası geçildi) */
{
  const rr = det([95, 100, 90, 97, 93, 95.1], 8);
  ok(rr === null, 'çizgiler kesişmişse (tepe noktası geçildi) formasyon döndürülmez');
}

console.log(`\nTÜM FORMASYON TESTLERİ GEÇTİ (${pass})`);
