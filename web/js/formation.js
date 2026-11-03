/*  Formasyon Merkezi: "Gelişmiş Formasyon Merkezi V2 [AlperA]" Pine göstergesinin JavaScript karşılığı.
 *  Orijinal Pine kodu © AlperA2259, Mozilla Public License 2.0.
 *
 *  Aynı mantık: pivot tespiti, son iki tepe ve son iki dip, yataylık toleransı, üçgenler ve takozlar.
 *  Pine sürümünden farklar (bilerek):
 *   - Pine her mumda yeni çizgi çizer ve eskileri silmez; burada yalnızca güncel formasyon döner.
 *   - Eğim mum başına hesaplanır (Pine iki pivot arasındaki fiyat farkını kullanıyor; pivotlar arası mesafe farklıysa yanlış kıyaslar).
 *   - Kırılım durumu gerçekten hesaplanır ("Takipte" sabit metin değildi).
 *   - İkili tepe/dip eklendi (Pine'da seçenek vardı ama mantığı yoktu).
 *   - Yataylık toleransı içindeki bir kenar takoz sayılmaz (Pine'da üst çizgi %0,2 yükselse bile yükselen üçgen "yükselen takoz" olarak ezilir).
 *   - Bayat formasyon gösterilmez: en yeni pivot 6×hassasiyet mumdan eskiyse veya formasyon 40×hassasiyet mumdan uzunsa yok sayılır.
 *  Pivot yalnızca sağındaki `n` mum kapanınca onaylanır, yani geriye dönük değişmez (repaint yok).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BeaconFormation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DEF = { pivot: 10, tol: 1.5 };

  function pivots(cs, n) {
    const ph = [], pl = [];
    for (let i = n; i < cs.length - n; i++) {
      let h = true, l = true;
      for (let k = 1; k <= n && (h || l); k++) {
        if (!(cs[i].h > cs[i - k].h) || !(cs[i].h >= cs[i + k].h)) h = false;
        if (!(cs[i].l < cs[i - k].l) || !(cs[i].l <= cs[i + k].l)) l = false;
      }
      if (h) ph.push({ i, p: cs[i].h });
      if (l) pl.push({ i, p: cs[i].l });
    }
    return { ph, pl };
  }

  const L = (i0, p0, i1, p1, ext) => ({ i0, p0, i1, p1, ext: ext !== false });
  const at = (ln, i) => (ln.i1 === ln.i0 ? ln.p0 : ln.p0 + ((ln.p1 - ln.p0) / (ln.i1 - ln.i0)) * (i - ln.i0));

  /** Güncel formasyonu döndürür, yoksa null. `cs` yalnızca kapanmış mumlardan oluşmalı. */
  function detect(cs, opts) {
    const o = Object.assign({}, DEF, opts || {});
    const n = Math.max(2, Math.round(o.pivot)), tol = o.tol;
    if (cs.length < 2 * n + 3) return null;
    const { ph, pl } = pivots(cs, n);
    if (ph.length < 2 || pl.length < 2) return null;
    const A = ph[ph.length - 2], B = ph[ph.length - 1], C = pl[pl.length - 2], D = pl[pl.length - 1];
    const last = cs.length - 1, close = cs[last].c;
    if (last - Math.max(B.i, D.i) > 6 * n) return null;
    if (last - Math.min(A.i, C.i) > 40 * n) return null;

    const uS = (B.p - A.p) / (B.i - A.i), lS = (D.p - C.p) / (D.i - C.i);
    const flatTop = (Math.abs(A.p - B.p) / A.p) * 100 <= tol;
    const flatBot = (Math.abs(C.p - D.p) / C.p) * 100 <= tol;
    let r = null;

    /* 1) üçgenler (Pine ile aynı öncelik sırası) */
    if (flatTop && D.p > C.p) r = { key: 'asc', name: 'Yükselen Üçgen', color: '#35d6a0', bias: 'Yukarı kırılıma yatkın yapı', up: L(A.i, A.p, last, A.p), lo: L(C.i, C.p, D.i, D.p) };
    else if (flatBot && B.p < A.p) r = { key: 'desc', name: 'Alçalan Üçgen', color: '#ff6384', bias: 'Aşağı kırılıma yatkın yapı', up: L(A.i, A.p, B.i, B.p), lo: L(C.i, C.p, last, C.p) };
    else if (B.p < A.p && D.p > C.p) r = { key: 'sym', name: 'Simetrik Üçgen', color: '#ff9f43', bias: 'Yönsüz, kırılımı bekler', up: L(A.i, A.p, B.i, B.p), lo: L(C.i, C.p, D.i, D.p) };

    /* 2) takozlar (Pine'da üçgenin üstüne yazar) */
    if (B.p < A.p && D.p < C.p && !flatBot && Math.abs(uS) > Math.abs(lS)) r = { key: 'fwedge', name: 'Alçalan Takoz', color: '#b6f24a', bias: 'Genelde olumlu kabul edilen yapı', up: L(A.i, A.p, B.i, B.p), lo: L(C.i, C.p, D.i, D.p) };
    else if (B.p > A.p && D.p > C.p && !flatTop && lS > uS) r = { key: 'rwedge', name: 'Yükselen Takoz', color: '#e0607e', bias: 'Genelde olumsuz kabul edilen yapı', up: L(A.i, A.p, B.i, B.p), lo: L(C.i, C.p, D.i, D.p) };

    if (r) {
      const u = at(r.up, last), l = at(r.lo, last);
      if (!(u > l)) return null; // çizgiler kesişti: formasyon süresi doldu
      r.status = close > u ? 'Yukarı kırılım' : close < l ? 'Aşağı kırılım' : 'Takipte';
      r.lines = [r.up, r.lo];
      r.levels = { upper: u, lower: l };
    } else {
      /* 3) ikili tepe / dip */
      let top = null, bot = null;
      if (flatTop) {
        let neck = Infinity; for (let k = A.i; k <= B.i; k++) if (cs[k].l < neck) neck = cs[k].l;
        const avg = (A.p + B.p) / 2;
        if (((avg - neck) / avg) * 100 >= 2 * tol && close <= Math.max(A.p, B.p) * (1 + tol / 100))
          top = { key: 'dtop', name: 'İkili Tepe', color: '#ff6384', bias: 'Boyun çizgisi kırılırsa aşağı yönlü', neck, at: B.i,
            status: close < neck ? 'Boyun çizgisi aşağı kırıldı' : 'Takipte', lines: [L(A.i, A.p, B.i, B.p, false), L(A.i, neck, last, neck)], levels: { upper: Math.max(A.p, B.p), neck } };
      }
      if (flatBot) {
        let neck = -Infinity; for (let k = C.i; k <= D.i; k++) if (cs[k].h > neck) neck = cs[k].h;
        const avg = (C.p + D.p) / 2;
        if (((neck - avg) / avg) * 100 >= 2 * tol && close >= Math.min(C.p, D.p) * (1 - tol / 100))
          bot = { key: 'dbot', name: 'İkili Dip', color: '#35d6a0', bias: 'Boyun çizgisi kırılırsa yukarı yönlü', neck, at: D.i,
            status: close > neck ? 'Boyun çizgisi yukarı kırıldı' : 'Takipte', lines: [L(C.i, C.p, D.i, D.p, false), L(C.i, neck, last, neck)], levels: { lower: Math.min(C.p, D.p), neck } };
      }
      r = top && bot ? (top.at >= bot.at ? top : bot) : top || bot;
      if (!r) return null;
    }
    r.asOf = last; r.firstBar = Math.min(A.i, C.i); r.lastPivot = Math.max(B.i, D.i);
    return r;
  }

  return { detect, pivots, DEF };
});
