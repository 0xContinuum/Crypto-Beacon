/*  Beacon Rejim: piyasanın "trend mi, geri dönüş mü, rastgele mi" olduğunu ölçer.
 *  Yöntem: oynaklığa göre standartlaştırılmış getirilerde kayan Varyans Oranı (Lo–MacKinlay, q mumluk).
 *    VR = Var(q mumluk getiri) / (q · Var(1 mumluk getiri)).  VR > 1: hareketler birbirini sürüyor (trend), VR < 1: birbirini geri alıyor.
 *    z = (VR − 1) / sd0 ile anlamlılığı ölçülür; sd0 rastgele yürüyüş varsayımındaki standart sapmadır.
 *  Standartlaştırma: her getiri, ondan ÖNCEKİ mumun EWMA oynaklığına bölünür (geleceğe bakmaz), böylece oynaklık kümelenmesi z'yi şişirmez.
 *  Kullanım: strateji seçimi. Trend rejiminde kırılım/takip, geri dönüş rejiminde aralık işlemleri daha mantıklıdır; rastgele rejimde tetikler zayıftır.
 *  Çıktı mum başına: z (−4…4 kırpılmış), rejim (+1 yukarı trend, −1 aşağı trend, 2 geri dönüş, 0 belirsiz).
 */
(function (root) {
  'use strict';
  const OPT = { N: 60, q: 5, zUp: 1.65, zDn: -1.5, lam: 0.94 };
  function compute(candles, opt) {
    const o = Object.assign({}, OPT, opt || {}), N = o.N, q = o.q, n = candles.length;
    const z = new Array(n).fill(NaN), vr = new Array(n).fill(NaN), reg = new Array(n).fill(NaN);
    if (n < N + q + 25) return { z, vr, reg, o };
    const lc = candles.map((k) => Math.log(k.c)), r = new Array(n).fill(0);
    for (let i = 1; i < n; i++) r[i] = lc[i] - lc[i - 1];
    // oynaklık: i mumunun getirisi, i-1'de bilinen EWMA ile standartlaştırılır
    let v = 0; for (let i = 1; i <= 20; i++) v += r[i] * r[i]; v /= 20;
    const rs = new Array(n).fill(NaN);
    for (let i = 21; i < n; i++) { rs[i] = r[i] / Math.sqrt(Math.max(v, 1e-14)); v = o.lam * v + (1 - o.lam) * r[i] * r[i]; }
    // kümülatif toplamlar: 1 mumluk ve q mumluk standartlaşmış getiriler
    const S1 = [0], S2 = [0], Q1 = [0], Q2 = [0], cr = [0]; // cr: standartlaşmış getirilerin birikimi
    for (let i = 0; i < n; i++) cr.push(cr[i] + (Number.isFinite(rs[i]) ? rs[i] : 0));
    for (let i = 0; i < n; i++) {
      const a = Number.isFinite(rs[i]) ? rs[i] : 0, Rq = i >= q + 21 ? cr[i + 1] - cr[i + 1 - q] : 0;
      S1.push(S1[i] + a); S2.push(S2[i] + a * a); Q1.push(Q1[i] + Rq); Q2.push(Q2[i] + Rq * Rq);
    }
    const sd0 = Math.sqrt((2 * (2 * q - 1) * (q - 1)) / (3 * q * N));
    for (let i = 21 + q + N; i < n; i++) {
      const a = i + 1 - N, m1 = (S1[i + 1] - S1[a]) / N, v1 = (S2[i + 1] - S2[a]) / N - m1 * m1, mq = (Q1[i + 1] - Q1[a]) / N, vq = (Q2[i + 1] - Q2[a]) / N - mq * mq;
      if (!(v1 > 1e-12)) continue;
      const ratio = vq / (q * v1); vr[i] = ratio; const zz = (ratio - 1) / sd0; z[i] = Math.max(-4, Math.min(4, zz));
      const dir = cr[i + 1] - cr[a]; // pencere boyunca net standartlaşmış hareket
      reg[i] = zz >= o.zUp ? (dir >= 0 ? 1 : -1) : zz <= o.zDn ? 2 : 0;
    }
    return { z, vr, reg, o };
  }
  /** Grafik çizim nesneleri (alt panel histogramı + eşik çizgileri). */
  function plots(candles, opt) {
    const R = compute(candles, opt), o = R.o, UP = '#35d6a0', DN = '#ff6384', RV = '#5cc8ff', NO = 'rgba(126,139,166,.55)';
    const colors = R.reg.map((g) => (g === 1 ? UP : g === -1 ? DN : g === 2 ? RV : NO));
    const n = candles.length, hl = (y, label) => ({ pane: 'sub', style: 'hline', values: new Array(n).fill(y), color: 'rgba(233,238,248,.35)', dash: true, label });
    return [{ pane: 'sub', style: 'histogram', label: 'Rejim (yeşil/kırmızı trend, mavi geri dönüş)', values: R.z, colors, color: NO }, hl(o.zUp, ''), hl(o.zDn, '')];
  }
  const api = { compute, plots, OPT };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BeaconRegime = api;
})(typeof self !== 'undefined' ? self : this);
