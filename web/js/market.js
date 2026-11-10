/*  Beacon Piyasa: Bitcoin döngü göstergeleri, yalnızca fiyat verisinden kendi hesabımızla.
 *  Zincir üstü (MVRV, NUPL, Puell...) göstergeler fiyattan hesaplanamaz, burada yoktur.
 *  Hesaplar saf işlevlerdir (market tests). Görünüm aşağıda, tarayıcıdaysa kurulur.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BeaconMarket = factory(root.Beacon);
})(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';
  const I = B.indicators, DAY = 86400000;
  const GENESIS = Date.UTC(2009, 0, 3);
  const HALVINGS = [Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20)]; // Binance verisi 2017'den başlar; 2016 öncesi yok
  const NEXT_HALVING_EST = Date.UTC(2028, 3, 1);              // tahmini; blok sayısına bağlıdır
  const isN = Number.isFinite;
  const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (isN(a[i])) return a[i]; return NaN; };
  const fin = (a) => a.filter(isN);

  /* Rainbow: ln(fiyat) ~ a + b·ln(gün); bantlar artık dağılımın standart sapma katlarıdır (Beacon'un kendi uyumu) */
  function rainbowFit(t, c) {
    const x = [], y = [];
    for (let i = 0; i < t.length; i++) { x.push(Math.log((t[i] - GENESIS) / DAY)); y.push(Math.log(c[i])); }
    const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const b = sxy / sxx, a = my - b * mx;
    let ss = 0; for (let i = 0; i < n; i++) ss += (y[i] - (a + b * x[i])) ** 2;
    return { a, b, sd: Math.sqrt(ss / n) };
  }
  const RB_NAMES = ['Aşırı ucuz', 'Ucuz', 'Düşük', 'Makul', 'Isınıyor', 'Yüksek', 'Pahalı', 'Aşırı pahalı'];
  const RB_COLORS = ['#3b6bff', '#2a9df4', '#35d6a0', '#8bd650', '#ffc25c', '#ff9a4d', '#ff6384', '#c2185b'];
  const RB_EDGES = [-1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75]; // σ, 8 + 1 bölge

  function compute(candles, now) {
    now = now || Date.now();
    const n = candles.length; if (n < 400) return null;
    const t = candles.map((k) => k.t), c = candles.map((k) => k.c);
    const s111 = I.sma(c, 111), s350 = I.sma(c, 350), s200 = I.sma(c, 200), s1400 = I.sma(c, 1400), s730 = I.sma(c, 730);
    const out = { t, c, n, asOf: t[n - 1] };
    // Pi Cycle
    const pi2 = s350.map((v) => v * 2), piR = s111.map((v, i) => v / pi2[i]);
    const crosses = []; for (let i = 1; i < n; i++) if (isN(piR[i]) && isN(piR[i - 1]) && piR[i] >= 1 && piR[i - 1] < 1) crosses.push(t[i]);
    out.pi = { s111, pi2, ratio: piR, now: last(piR), crosses, state: last(piR) >= 1 ? 'Tetiklendi' : last(piR) >= 0.9 ? 'Yaklaştı' : 'Uzakta' };
    // Mayer
    const mayer = c.map((v, i) => v / s200[i]);
    const mv = fin(mayer);
    out.mayer = { s200, ratio: mayer, now: last(mayer), avg: mv.reduce((a, b) => a + b, 0) / (mv.length || 1), zone: (m) => (m < 0.8 ? 'Düşük' : m < 1.2 ? 'Normal' : m < 2.4 ? 'Yüksek' : 'Aşırı') };
    out.mayer.state = out.mayer.zone(out.mayer.now);
    // 200 hafta (1400 gün) ortalama
    const w = c.map((v, i) => v / s1400[i]);
    out.w200 = { ma: s1400, ratio: w, now: last(w), maNow: last(s1400), state: last(w) < 1 ? 'Ortalamanın altında' : last(w) < 1.5 ? 'Ortalamaya yakın' : last(w) < 3 ? 'Ortalamanın üstünde' : 'Ortalamadan çok uzak', available: isN(last(s1400)) };
    // 2 yıllık ortalama çarpanı
    const m5 = s730.map((v) => v * 5), ratio2 = c.map((v, i) => v / s730[i]);
    out.ma2y = { ma: s730, x5: m5, ratio: ratio2, now: last(ratio2), state: last(ratio2) < 1 ? '2Y ortalamanın altında' : last(ratio2) < 5 ? 'Bant içinde' : '5× üstünde', available: isN(last(s730)) };
    // Rainbow
    const fit = rainbowFit(t, c), lines = RB_EDGES.concat([Infinity]).map(() => []);
    const mid = t.map((tt) => fit.a + fit.b * Math.log((tt - GENESIS) / DAY));
    const z = c.map((v, i) => (Math.log(v) - mid[i]) / fit.sd);
    const bands = RB_EDGES.map((e) => mid.map((m) => Math.exp(m + e * fit.sd)));
    const zi = (v) => { let k = 0; while (k < RB_EDGES.length && v > RB_EDGES[k]) k++; return Math.min(k, RB_NAMES.length - 1); };
    out.rainbow = { fit, bands, z, now: z[n - 1], idx: zi(z[n - 1]), name: RB_NAMES[zi(z[n - 1])], names: RB_NAMES, colors: RB_COLORS, edges: RB_EDGES };
    // Halving döngüsü + ATH'den düşüş
    let ath = 0, athT = 0; const dd = c.map((v, i) => { if (v > ath) { ath = v; athT = t[i]; } return v / ath - 1; });
    const h = HALVINGS[HALVINGS.length - 1], daysSince = Math.floor((now - h) / DAY);
    const idxAt = (ts) => { let k = t.findIndex((x) => x >= ts); return k; };
    const cycles = HALVINGS.map((hv, ci) => { const k = idxAt(hv); if (k < 0) return null; const base = c[k]; const len = ci === HALVINGS.length - 1 ? n - k : (idxAt(HALVINGS[ci + 1]) < 0 ? n : idxAt(HALVINGS[ci + 1])) - k; return { start: hv, base, vals: c.slice(k, k + len).map((v) => v / base) }; }).filter(Boolean);
    out.halving = { daysSince, cycles, ath, athT, drawdown: dd[n - 1], dd, nextEst: NEXT_HALVING_EST, daysToNext: Math.max(0, Math.round((NEXT_HALVING_EST - now) / DAY)),
      multiple: cycles.length ? c[n - 1] / cycles[cycles.length - 1].base : NaN, athDays: Math.floor((now - athT) / DAY),
      state: daysSince < 0 ? 'Halving öncesi' : dd[n - 1] <= -0.5 ? 'Derin düzeltme' : dd[n - 1] > -0.1 ? 'ATH yakınında' : 'Döngü içinde' };
    return out;
  }

  return { compute, GENESIS, HALVINGS, RB_NAMES, RB_COLORS, rainbowFit };
});
