// Eşitleme birleştirme kuralları. Çalıştırma: node tests/sync.test.js
const assert = require('assert'); const SY = require('../web/js/sync.js');
let n = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); n++; console.log('PASS ' + m); };
const mk = (o) => Object.assign({ custom: [], draw: [], ctf: [], ctfU: 0, wl: { act: 0, lists: [] }, wlU: 0, tomb: {} }, o);
// A cihazı gösterge ekler → B'ye gelir
let A = mk({ ts: 5 }), B = mk({ ts: 5 }); const tA = SY.tracker(), tB = SY.tracker(); tA.reset(A); tB.reset(B);
A.custom.push({ id: 1, name: 'RSI', code: 'plot(rsi(close,14))', on: true }); ok(tA.scan(A, 100) && A.custom[0].u === 100, 'yeni gösterge u damgası alır');
let m = SY.merge(SY.pack(B), SY.pack(A)); ok(m.local && m.merged.custom.length === 1, 'B uzaktan göstergeyi alır'); SY.apply(B, m.merged); tB.reset(B); ok(B.custom[0].name === 'RSI' && B.custom[0].id === 1, 'apply sonrası kimlik korunur'); ok(!tB.scan(B, 200), 'uzaktan gelen değişiklik yerel değişiklik sayılmaz');
// B düzenler (daha yeni), A eski → B kazanır
B.custom[0].code = 'plot(rsi(close,7))'; tB.scan(B, 300); m = SY.merge(SY.pack(A), SY.pack(B)); SY.apply(A, m.merged); tA.reset(A); ok(A.custom[0].code === 'plot(rsi(close,7))', 'en yeni düzenleme kazanır');
// B siler → A'dan da silinir; silinen geri gelmez
B.custom = []; tB.scan(B, 400); ok(B.tomb.custom['1'] === 400, 'silme mezar taşı bırakır');
m = SY.merge(SY.pack(A), SY.pack(B)); SY.apply(A, m.merged); tA.reset(A); ok(A.custom.length === 0, 'silinen gösterge diğer cihazdan da kalkar');
m = SY.merge(SY.pack(B), SY.pack(A)); ok(m.merged.custom.length === 0, 'silinen yeniden dirilmez');
// silindikten sonra daha yeni düzenleme varsa kalır
A = mk({ custom: [{ id: 9, name: 'X', code: 'a', on: true, u: 500 }], tomb: { custom: { 9: 450 } } }); tA.reset(A); m = SY.merge(SY.pack(A), SY.pack(mk({ tomb: { custom: { 9: 450 } } }))); ok(m.merged.custom.length === 1, 'mezar taşından yeni öğe korunur');
// eşzamanlı farklı öğeler birleşir
A = mk({ custom: [{ id: 1, name: 'A', code: 'a', on: true, u: 10 }] }); B = mk({ custom: [{ id: 2, name: 'B', code: 'b', on: true, u: 11 }] }); m = SY.merge(SY.pack(A), SY.pack(B)); ok(m.merged.custom.length === 2 && m.local && m.push, 'iki cihazın farklı göstergeleri birleşir');
// çizimler
A = mk({ draw: [{ id: 'd1', sym: 'BTC', type: 'trend', pts: [{ t: 1, p: 2 }, { t: 3, p: 4 }], st: {}, u: 5 }] }); B = mk(); m = SY.merge(SY.pack(B), SY.pack(A)); ok(m.merged.draw.length === 1, 'çizimler eşitlenir');
// ctf & wl bütün olarak en yenisi
A = mk({ ctf: ['c2d'], ctfU: 5, wl: { act: 1, lists: [{ id: 1, name: 'a', items: ['BTC'] }] }, wlU: 5 }); B = mk({ ctf: ['c14d'], ctfU: 9, wl: { act: 2, lists: [{ id: 2, name: 'b', items: [] }] }, wlU: 3 });
m = SY.merge(SY.pack(A), SY.pack(B)); ok(m.merged.ctf.v[0] === 'c14d' && m.merged.wl.v.lists[0].name === 'a', 'özel aralıklar ve takip listeleri en yeni sürümden gelir');
// değişiklik yoksa push yok
A = mk({ custom: [{ id: 1, name: 'A', code: 'a', on: true, u: 10 }] }); m = SY.merge(SY.pack(A), SY.pack(A)); ok(!m.local && !m.push, 'aynı veride yazma yapılmaz');
ok(SY.merge(SY.pack(A), null).push === true, 'sunucuda veri yoksa yerel olan gönderilir');
console.log(`\nTÜM EŞİTLEME TESTLERİ GEÇTİ (${n})`);
