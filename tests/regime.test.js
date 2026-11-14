const assert = require('assert'); const R = require('../web/js/regime.js');
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gen(seed, blocks, phis, garch) { const r = rng(seed), g = () => { let u = 0; for (let i = 0; i < 12; i++) u += r(); return u - 6; }; let p = 100, v = 1e-4, prev = 0; const cs = [], lab = [];
  for (const b of blocks) for (let k = 0; k < 150; k++) { const e = Math.sqrt(v) * g(), ret = phis[b] * prev + e; if (garch) v = 2e-6 + 0.08 * e * e + 0.9 * v; prev = ret; const o = p; p *= Math.exp(ret); cs.push({ t: cs.length * 864e5, o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * .997, c: p, v: 1 }); lab.push(b); } return { cs, lab }; }
let ok = 0; const t = (n, f) => { try { f(); ok++; console.log('✓', n); } catch (e) { console.error('✗', n, e.message); process.exitCode = 1; } };
const phis = { T: 0.35, R: -0.35, N: 0 }, order = ['N', 'T', 'R', 'N', 'R', 'T', 'N', 'T', 'R', 'N'];
const cnt = { T: [0, 0, 0], R: [0, 0, 0], N: [0, 0, 0] };
for (let s = 1; s <= 30; s++) { const { cs, lab } = gen(s, order, phis, s % 2 === 0); const Z = R.compute(cs); for (let i = 0; i < cs.length; i++) { if (i % 150 < 70 || !Number.isFinite(Z.reg[i])) continue; const g = Z.reg[i]; cnt[lab[i]][g === 1 || g === -1 ? 0 : g === 2 ? 1 : 2]++; } }
const pc = (b, k) => cnt[b][k] / (cnt[b][0] + cnt[b][1] + cnt[b][2]);
t('trend bloklarını tanır (>%50)', () => assert(pc('T', 0) > 0.5, pc('T', 0)));
t('geri dönüş bloklarını tanır (>%55)', () => assert(pc('R', 1) > 0.55, pc('R', 1)));
t('trend blokta geri dönüş, geri dönüş blokta trend demez (<%3)', () => { assert(pc('T', 1) < 0.03); assert(pc('R', 0) < 0.03); });
t('rastgele blokta yanlış alarm düşük (trend <%10, geri dönüş <%14)', () => { assert(pc('N', 0) < 0.10, pc('N', 0)); assert(pc('N', 1) < 0.14, pc('N', 1)); });
t('geleceğe bakmaz', () => { const { cs } = gen(5, order, phis, true), A = R.compute(cs), B = R.compute(cs.slice(0, 900)); for (let i = 200; i < 890; i += 13) assert.strictEqual(A.z[i], B.z[i]); });
t('yön: yükselen trend yeşil, düşen trend kırmızı', () => { const up = Array.from({ length: 400 }, (_, i) => { const c = 100 * Math.exp(0.004 * i + 0.01 * Math.sin(i * 0.7)); return { t: i, o: c, h: c * 1.002, l: c * 0.998, c, v: 1 }; }), dn = up.map((k) => ({ ...k, c: 1e4 / k.c, o: 1e4 / k.c, h: 1e4 / k.c * 1.002, l: 1e4 / k.c * 0.998 })); const a = R.compute(up), b = R.compute(dn); assert(a.reg[399] === 1 || a.reg[399] === 0); assert(b.reg[399] !== 1); });
t('az veri: boş sonuç, hata yok', () => { const r = R.compute([{ c: 1 }, { c: 2 }]); assert(r.z.length === 2 && r.z.every(Number.isNaN)); });
t('plots şeması', () => { const { cs } = gen(3, order, phis, false), P = R.plots(cs); assert(P[0].pane === 'sub' && P[0].style === 'histogram' && P[0].values.length === cs.length && P[0].colors.length === cs.length && P.length === 3); });
t('hız: 5000 mum < 100 ms', () => { const { cs } = gen(2, order.concat(order, order, order, order), phis, true), a = Date.now(); R.compute(cs); assert(Date.now() - a < 100); });
console.log(ok + ' test geçti');
