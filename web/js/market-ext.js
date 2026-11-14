/*  Beacon Piyasa Eklentisi: iki özgün gösterge, mevcut kart şemasıyla uyumlu.
 *
 *  1) Ay Fazı Sınaması  — Ay'ın iki döngüsünün (faz ve yakınlık) BTC'nin 7 günlük getirisine etkisini
 *                         KENDİ verinizde permütasyon testiyle ölçer. Etki yoksa "Etki yok" der.
 *  2) Yay Gerilimi      — volatilite sıkışması + hacim kuruması + (varsa) funding aşırılığı.
 *                         Fiyatın bir yöne gitmek zorunda kaldığı anları arar; geçmiş isabeti dürüstçe gösterir.
 *
 *  Kullanım:  X = BeaconMarketX.compute(candles);  cards = BeaconMarketX.cards(X, ctx);
 *  Funding (ücretsiz, Binance genel API) isteğe bağlıdır: BeaconMarketX.loadFunding().then(f => X.funding = f)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BeaconMarketX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 864e5, fin = Number.isFinite;
  const mod = (x, m) => ((x % m) + m) % m;
  const fmt1 = (v) => v.toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const fmt2 = (v) => v.toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; };
  function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ——— Ay'ın konumu (Meeus ortalama elemanları; günlük test için yeterince duyarlı) ——— */
  const PHASES = ['Yeni Ay', 'Büyüyen Hilal', 'İlk Dördün', 'Büyüyen Şişkin', 'Dolunay', 'Küçülen Şişkin', 'Son Dördün', 'Küçülen Hilal'];
  function moonAt(ms) {
    const d = ms / DAY + 2440587.5 - 2451545.0; // J2000'den beri gün
    return { ph: mod(297.8501921 + 12.19074912 * d, 360) / 360, an: mod(134.9634114 + 13.06499295 * d, 360) / 360 }; // ph: 0 yeni, .5 dolunay; an: 0 ayın yeryüzüne en yakın noktası
  }

  /* ——— döngü sınaması: konuma göre 7 günlük getiri farkı var mı? ———
     İstatistik: gruplar arası kareler toplamı. Boş hipotez: etiketler döngüsel kaydırılır (getirilerin kendi
     bağımlılığı bozulmaz). p = kaydırılmış istatistiklerin gözlenenden büyük/eşit olma oranı. */
  function testCycle(pos, fwd, B, N, seed) {
    const m = fwd.length, bin = new Int16Array(m), mu = mean(fwd), R = rng(seed);
    for (let i = 0; i < m; i++) bin[i] = Math.floor(mod(pos[i] * B + 0.5, B)); // 0. kutu Yeni Ay ±1/16 döngü
    const run = (shift) => {
      const s = new Float64Array(B), cnt = new Int32Array(B);
      for (let i = 0; i < m; i++) { const b = bin[(i + shift) % m]; s[b] += fwd[i]; cnt[b]++; }
      let ss = 0; const means = new Array(B);
      for (let b = 0; b < B; b++) { means[b] = cnt[b] ? s[b] / cnt[b] : 0; ss += cnt[b] * (means[b] - mu) ** 2; }
      return { ss, means, cnt };
    };
    const obs = run(0); let ge = 0; const per = Array.from({ length: B }, () => []);
    for (let k = 0; k < N; k++) {
      const r = run(30 + Math.floor(R() * (m - 60)));
      if (r.ss >= obs.ss) ge++;
      for (let b = 0; b < B; b++) per[b].push(r.means[b]);
    }
    const q = (arr, p) => { arr.sort((a, b) => a - b); return arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]; };
    return { p: (ge + 1) / (N + 1), means: obs.means, cnt: Array.from(obs.cnt), lo: per.map((a) => q(a, 0.025)), hi: per.map((a) => q(a, 0.975)) };
  }

  function moonTest(cs) {
    const H = 7, n = cs.length, m = n - H, pPh = new Array(m), pAn = new Array(m), fwd = new Array(m);
    for (let i = 0; i < m; i++) { const mo = moonAt(cs[i].t + DAY / 2); pPh[i] = mo.ph; pAn[i] = mo.an; fwd[i] = Math.log(cs[i + H].c / cs[i].c) * 100; }
    const B = 8, ph = testCycle(pPh, fwd, B, 1500, 1337), an = testCycle(pAn, fwd, B, 1500, 7331);
    const now = moonAt(Date.now()), nowBin = Math.floor(mod(now.ph * B + 0.5, B)), nowBinAn = Math.floor(mod(now.an * B + 0.5, B));
    const wrap = (a) => a.concat(a[0]); // döngüyü kapat
    return { B, H, n: m, ph, an, nowBin, nowBinAn, nowPh: now.ph, nowAn: now.an, illum: (1 - Math.cos(2 * Math.PI * now.ph)) / 2, name: PHASES[Math.floor(mod(now.ph * 8 + 0.5, 8))],
      x: Array.from({ length: B + 1 }, (_, k) => k / B), mean: wrap(ph.means), lo: wrap(ph.lo), hi: wrap(ph.hi) };
  }

  /* ——— Yay Gerilimi ——— */
  function pctRank(a, i, win, minN) {
    const s = Math.max(0, i - win + 1); let less = 0, eq = 0, cnt = 0; const cur = a[i];
    if (!fin(cur)) return NaN;
    for (let j = s; j <= i; j++) { const v = a[j]; if (!fin(v)) continue; cnt++; if (v < cur) less++; else if (v === cur) eq++; }
    return cnt < minN ? NaN : ((less + eq / 2) / cnt) * 100;
  }
  function roll(a, w, f) { const o = new Array(a.length).fill(NaN); for (let i = w - 1; i < a.length; i++) { let ok = true; const seg = []; for (let j = i - w + 1; j <= i; j++) { if (!fin(a[j])) { ok = false; break; } seg.push(a[j]); } if (ok) o[i] = f(seg); } return o; }
  function ema(a, p) { const k = 2 / (p + 1), o = new Array(a.length).fill(NaN); let prev = NaN; for (let i = 0; i < a.length; i++) { if (!fin(a[i])) continue; prev = fin(prev) ? a[i] * k + prev * (1 - k) : a[i]; o[i] = prev; } return o; }

  function bowTension(cs) {
    const n = cs.length, c = cs.map((k) => k.c), h = cs.map((k) => k.h), l = cs.map((k) => k.l), v = cs.map((k) => k.v);
    const tr = c.map((_, i) => (i ? Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])) : h[i] - l[i]));
    const bbw = roll(c, 20, (s) => { const mu = mean(s); let q = 0; for (const x of s) q += (x - mu) ** 2; return (4 * Math.sqrt(q / 20)) / mu; });
    const atrS = roll(tr, 7, mean), atrL = roll(tr, 60, mean), atrR = atrS.map((x, i) => x / atrL[i]);
    const volS = roll(v, 5, mean), volL = roll(v, 50, mean), volRatio = volS.map((x, i) => x / volL[i]);
    const rngS = roll(c.map((x, i) => (h[i] - l[i]) / x), 5, mean);
    const WIN = 365, MIN = 120, tension = new Array(n).fill(NaN), parts = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pctRank(bbw, i, WIN, MIN), b = pctRank(atrR, i, WIN, MIN), d = pctRank(volRatio, i, WIN, MIN), e = pctRank(rngS, i, WIN, MIN);
      if (![a, b, d, e].every(fin)) continue;
      tension[i] = 100 - (0.4 * a + 0.3 * b + 0.15 * d + 0.15 * e); parts[i] = { bbw: 100 - a, atr: 100 - b, vol: 100 - d, rng: 100 - e };
    }
    // yön: 50 günlük ortalamanın üstü/altı + ortalamanın eğimi (−2…+2)
    const e50 = ema(c, 50), trend = c.map((x, i) => (i >= 20 && fin(e50[i]) ? Math.sign(x - e50[i]) + Math.sign(e50[i] - e50[i - 20]) : 0));
    // geçmiş: gerilim 85'i yukarı geçtiği anlar (15 gün ara)
    const TH = 85, FW = 10, ev = []; let last = -99;
    for (let i = 1; i < n; i++) if (fin(tension[i]) && tension[i] >= TH && !(tension[i - 1] >= TH) && i - last > 15) { ev.push(i); last = i; }
    const exc = (i) => { let hi = -Infinity, lo = Infinity; for (let j = i + 1; j <= i + FW; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j]; } return Math.max(hi / c[i] - 1, 1 - lo / c[i]) * 100; };
    const base = []; for (let i = 0; i + FW < n; i++) if (fin(tension[i])) base.push(exc(i));
    const done = ev.filter((i) => i + FW < n), ex = done.map(exc);
    let hit = 0, hitN = 0; for (const i of done) if (trend[i] !== 0) { hitN++; if (Math.sign(c[i + FW] - c[i]) === Math.sign(trend[i])) hit++; }
    return { tension, parts, trend, events: ev, FW, TH, stats: { total: ev.length, resolved: done.length, avgExc: mean(ex), baseExc: mean(base), hit, hitN } };
  }


  /* ——— Fırtına Barometresi: önümüzdeki 7 günün beklenen hareket büyüklüğü ———
     Yönü söylemez; "ne kadar oynar" sorusunu yanıtlar. Oynaklık kümelenir (sakin dönemi sakin, hareketli dönemi hareketli izler),
     bu yüzden oynaklık yön tahmininden çok daha öngörülebilirdir.
     Yöntem: günlük Parkinson varyansından (ln(H/L))²/(4ln2) HAR tipi regresyon: gelecek 7 günün log oynaklığı ~ bugün, 7, 30 ve 90 günlük log oynaklık.
     Katsayılar her gün YALNIZCA o güne kadar bilinen veriyle yeniden uydurulur (genişleyen pencere); bant, geçmiş standartlaştırılmış 7 günlük getirilerin
     yüzdeliklerinden gelir. Hiçbir adımda geleceğe bakılmaz. */
  function solve4(A, b) { // NxN doğrusal sistem (Gauss, kısmi pivot)
    const n = b.length, M = A.map((r, i) => r.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let v = M[i][n]; for (let k = i + 1; k < n; k++) v -= M[i][k] * x[k]; x[i] = v / M[i][i]; } return x;
  }
  function stormGauge(cs, opt) {
    const H = 7, n = cs.length, LN2 = Math.log(2), MINTRAIN = (opt && opt.minTrain) || 250, W0 = 89;
    const c = cs.map((k) => k.c), v = cs.map((k) => { const r = Math.log(k.h / Math.max(k.l, 1e-12)); return Math.max(r * r / (4 * LN2), 1e-10); });
    const cum = [0]; for (let i = 0; i < n; i++) cum.push(cum[i] + v[i]);
    const rv = (i, k) => Math.sqrt((cum[i + 1] - cum[i + 1 - k]) / k); // i dahil son k gün
    const feat = (i) => [1, Math.log(rv(i, 1)), Math.log(rv(i, 7)), Math.log(rv(i, 30)), Math.log(rv(i, 90))];
    const yOf = (i) => Math.log(Math.sqrt((cum[i + H + 1] - cum[i + 1]) / H)); // i+1..i+H (i+H anında bilinir)
    const K = 5, XtX = Array.from({ length: K }, () => new Array(K).fill(0)), Xty = new Array(K).fill(0), zs = [];
    const yhat = new Array(n).fill(NaN), q = { lo80: new Array(n).fill(NaN), hi80: new Array(n).fill(NaN), lo95: new Array(n).fill(NaN), hi95: new Array(n).fill(NaN) }, z7 = new Array(n).fill(NaN);
    let rows = 0; const sorted = [];
    const quant = (p) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)))];
    for (let t = W0; t < n; t++) {
      const s = t - H; // t anında eğitime giren son satır (hedefi t'de bilinen)
      if (s >= W0) {
        const x = feat(s), y = yOf(s); rows++;
        for (let a = 0; a < K; a++) { Xty[a] += x[a] * y; for (let b = 0; b < K; b++) XtX[a][b] += x[a] * x[b]; }
        // s günündeki tahminin standartlaştırılmış 7 günlük getirisi (s'nin tahmini kendi anında yapılmıştı)
        if (Number.isFinite(yhat[s]) && s + H < n + 0) { const z = Math.log(c[s + H] / c[s]) / (Math.exp(yhat[s]) * Math.sqrt(H)); if (Number.isFinite(z)) { z7[s] = z; let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < z) lo = m + 1; else hi = m; } sorted.splice(lo, 0, z); } }
      }
      if (rows >= MINTRAIN) {
        const A = XtX.map((r, i) => r.map((x, j) => x + (i === j && i > 0 ? 1e-6 : 0))), beta = solve4(A, Xty);
        if (beta) {
          const x = feat(t); yhat[t] = x.reduce((a, b, i) => a + b * beta[i], 0);
          if (sorted.length >= 120) { q.lo80[t] = quant(0.10); q.hi80[t] = quant(0.90); q.lo95[t] = quant(0.025); q.hi95[t] = quant(0.975); }
        }
      }
    }
    const sig7 = yhat.map((y) => (Number.isFinite(y) ? Math.exp(y) * Math.sqrt(H) : NaN)); // beklenen 7 günlük hareket ölçeği (log getiri)
    const half80 = sig7.map((s, i) => (Number.isFinite(s) && Number.isFinite(q.hi80[i]) ? ((Math.exp(q.hi80[i] * s) - Math.exp(q.lo80[i] * s)) / 2) * 100 : NaN));
    const real7 = c.map((x, i) => (i >= H ? Math.abs(Math.log(x / c[i - H])) * 100 : NaN)); // i'de biten gerçekleşen 7 günlük hareket
    // ——— dürüst değerlendirme: yalnızca tahminin yapıldığı anda bilinen bilgiyle üretilmiş tahminler ———
    const idx = []; for (let t = W0; t + H < n; t++) if (Number.isFinite(yhat[t]) && Number.isFinite(q.hi80[t])) idx.push(t);
    const st = { n: idx.length, cov80: NaN, cov95: NaN, corr: NaN, r2vsMean: NaN, r2vsNaive: NaN, ratio: NaN, covLow: NaN, covHigh: NaN };
    if (idx.length >= 200) {
      const ys = idx.map((t) => yOf(t)), yh = idx.map((t) => yhat[t]), my = mean(ys), mh = mean(yh);
      let sxy = 0, sxx = 0, syy = 0; for (let k = 0; k < idx.length; k++) { sxy += (yh[k] - mh) * (ys[k] - my); sxx += (yh[k] - mh) ** 2; syy += (ys[k] - my) ** 2; }
      st.corr = sxy / Math.sqrt(sxx * syy);
      // karşılaştırma 1: o güne kadarki ortalama log oynaklık; karşılaştırma 2: son 30 günün oynaklığı
      let sseM = 0, sseN = 0, sseH = 0, run = 0, cnt = 0; const trainY = []; let nextTrain = W0;
      for (let k = 0; k < idx.length; k++) {
        const t = idx[k]; while (nextTrain + H <= t) { run += yOf(nextTrain); cnt++; nextTrain++; }
        const base = cnt ? run / cnt : my; sseM += (ys[k] - base) ** 2; sseN += (ys[k] - Math.log(rv(t, 30))) ** 2; sseH += (ys[k] - yh[k]) ** 2; trainY.push(base);
      }
      st.r2vsMean = 1 - sseH / sseM; st.r2vsNaive = 1 - sseH / sseN;
      const inB = (t, lo, hi) => { const r = Math.log(c[t + H] / c[t]), S = sig7[t]; return r >= Math.log(Math.exp(lo * S)) && r <= Math.log(Math.exp(hi * S)) ? 1 : 0; };
      let a80 = 0, a95 = 0; for (const t of idx) { a80 += inB(t, q.lo80[t], q.hi80[t]); a95 += inB(t, q.lo95[t], q.hi95[t]); }
      st.cov80 = a80 / idx.length; st.cov95 = a95 / idx.length;
      const ord = idx.slice().sort((a, b) => yhat[a] - yhat[b]), third = Math.floor(ord.length / 3), lowT = ord.slice(0, third), highT = ord.slice(-third);
      const covOf = (arr) => mean(arr.map((t) => inB(t, q.lo80[t], q.hi80[t])));
      st.covLow = covOf(lowT); st.covHigh = covOf(highT);
      const ab = (t) => Math.abs(Math.log(c[t + H] / c[t])) * 100; st.ratio = mean(highT.map(ab)) / mean(lowT.map(ab)); st.absLow = mean(lowT.map(ab)); st.absHigh = mean(highT.map(ab));
    }
    const last = n - 1, now = half80[last], recent = half80.slice(Math.max(0, n - 365)).filter(Number.isFinite), pct = Number.isFinite(now) && recent.length > 30 ? (recent.filter((x) => x <= now).length / recent.length) * 100 : NaN;
    const mult = Number.isFinite(sig7[last]) ? { lo80: Math.exp(q.lo80[last] * sig7[last]), hi80: Math.exp(q.hi80[last] * sig7[last]), lo95: Math.exp(q.lo95[last] * sig7[last]), hi95: Math.exp(q.hi95[last] * sig7[last]) } : null;
    return { yhat, sig7, half80, real7, q, st, now, pct, mult, price: c[last], H };
  }


  /* ——— Düşüş Tabanı: önümüzdeki 30 günde bugünkü fiyattan en kötü düşüş (ve en iyi yükseliş) ———
     Fırtına Barometresi bitiş fiyatına bakar; bu ise yolun en uç noktasına bakar: "stop/likidasyon nereye kadar gelebilir?"
     Hedef: ln(en düşük / bugünkü kapanış) ve ln(en yüksek / bugünkü kapanış), 30 gün boyunca.
     Ölçek: Fırtına ile aynı HAR oynaklık tahmini (30 gün ufuklu, genişleyen pencere); sınır: geçmiş standartlaştırılmış uç hareketlerin yüzdelikleri. */
  function dropGauge(cs, opt) {
    const H = (opt && opt.H) || 30, n = cs.length, LN2 = Math.log(2), MINTRAIN = (opt && opt.minTrain) || 250, W0 = 89, K = 5;
    const c = cs.map((k) => k.c), v = cs.map((k) => { const r = Math.log(k.h / Math.max(k.l, 1e-12)); return Math.max(r * r / (4 * LN2), 1e-10); });
    const cum = [0]; for (let i = 0; i < n; i++) cum.push(cum[i] + v[i]);
    const rv = (i, k) => Math.sqrt((cum[i + 1] - cum[i + 1 - k]) / k);
    const feat = (i) => [1, Math.log(rv(i, 1)), Math.log(rv(i, 7)), Math.log(rv(i, 30)), Math.log(rv(i, 90))];
    const yOf = (i) => Math.log(Math.sqrt((cum[i + H + 1] - cum[i + 1]) / H));
    const XtX = Array.from({ length: K }, () => new Array(K).fill(0)), Xty = new Array(K).fill(0);
    const yhat = new Array(n).fill(NaN), mk = () => new Array(n).fill(NaN), q = { dn90: mk(), dn95: mk(), up90: mk(), up95: mk() };
    const sD = [], sU = []; let rows = 0;
    const ins = (arr, z) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < z) lo = m + 1; else hi = m; } arr.splice(lo, 0, z); };
    const quant = (arr, p) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(p * arr.length)))];
    const ext = (i) => { let lo = Infinity, hi = -Infinity; for (let j = i + 1; j <= i + H; j++) { if (cs[j].l < lo) lo = cs[j].l; if (cs[j].h > hi) hi = cs[j].h; } return [Math.log(Math.min(lo, c[i]) / c[i]), Math.log(Math.max(hi, c[i]) / c[i])]; };
    for (let t = W0; t < n; t++) {
      const s = t - H;
      if (s >= W0) {
        const x = feat(s), y = yOf(s); rows++;
        for (let a = 0; a < K; a++) { Xty[a] += x[a] * y; for (let b = 0; b < K; b++) XtX[a][b] += x[a] * x[b]; }
        if (Number.isFinite(yhat[s])) { const [d, u] = ext(s), sc = Math.exp(yhat[s]) * Math.sqrt(H); if (Number.isFinite(d / sc)) { ins(sD, d / sc); ins(sU, u / sc); } }
      }
      if (rows >= MINTRAIN) {
        const A = XtX.map((r, i) => r.map((x, j) => x + (i === j && i > 0 ? 1e-6 : 0))), beta = solve4(A, Xty);
        if (beta) { yhat[t] = feat(t).reduce((a, b, i) => a + b * beta[i], 0); if (sD.length >= 120) { q.dn90[t] = quant(sD, 0.10); q.dn95[t] = quant(sD, 0.05); q.up90[t] = quant(sU, 0.90); q.up95[t] = quant(sU, 0.95); } }
      }
    }
    const sig = yhat.map((y) => (Number.isFinite(y) ? Math.exp(y) * Math.sqrt(H) : NaN));
    const dn = (k, arr) => (Number.isFinite(sig[k]) && Number.isFinite(arr[k]) ? (Math.exp(arr[k] * sig[k]) - 1) * 100 : NaN); // % (negatif)
    const dn90 = c.map((_, k) => dn(k, q.dn90)), dn95 = c.map((_, k) => dn(k, q.dn95)), up90 = c.map((_, k) => (Number.isFinite(sig[k]) && Number.isFinite(q.up90[k]) ? (Math.exp(q.up90[k] * sig[k]) - 1) * 100 : NaN));
    const worst = c.map((_, k) => { if (k < H) return NaN; let lo = Infinity; for (let j = k - H + 1; j <= k; j++) if (cs[j].l < lo) lo = cs[j].l; return (Math.min(lo, c[k - H]) / c[k - H] - 1) * 100; }); // k'de biten pencerenin gerçekleşen en kötü düşüşü
    // ——— dürüst değerlendirme (tahmin anında bilinenle) ———
    const idx = []; for (let t = W0; t + H < n; t++) if (Number.isFinite(dn90[t])) idx.push(t);
    const st = { n: idx.length, cov90: NaN, cov95: NaN, covUp90: NaN, covLow: NaN, covMid: NaN, covHigh: NaN, staticLow: NaN, staticHigh: NaN, ratio: NaN };
    if (idx.length >= 200) {
      const hit = (t, lim) => (ext(t)[0] >= Math.log(1 + lim / 100) ? 1 : 0);
      st.cov90 = mean(idx.map((t) => hit(t, dn90[t]))); st.cov95 = mean(idx.map((t) => hit(t, dn95[t])));
      st.covUp90 = mean(idx.map((t) => (ext(t)[1] <= Math.log(1 + up90[t] / 100) ? 1 : 0)));
      const ord = idx.slice().sort((a, b) => yhat[a] - yhat[b]), th = Math.floor(ord.length / 3), lowT = ord.slice(0, th), highT = ord.slice(-th), midT = ord.slice(th, ord.length - th);
      st.covLow = mean(lowT.map((t) => hit(t, dn90[t]))); st.covMid = mean(midT.map((t) => hit(t, dn90[t]))); st.covHigh = mean(highT.map((t) => hit(t, dn90[t])));
      // karşılaştırma: tek bir sabit sınır (tüm geçmişin %10'luk dilimi) sakin/hareketli dönemlerde ne yapardı
      const all = idx.map((t) => ext(t)[0]).sort((a, b) => a - b), fx = all[Math.floor(0.10 * all.length)];
      st.staticLow = mean(lowT.map((t) => (ext(t)[0] >= fx ? 1 : 0))); st.staticHigh = mean(highT.map((t) => (ext(t)[0] >= fx ? 1 : 0)));
      st.ratio = mean(highT.map((t) => -ext(t)[0])) / mean(lowT.map((t) => -ext(t)[0]));
    }
    const last = n - 1, now = dn90[last], rec = dn90.slice(Math.max(0, n - 365)).filter(Number.isFinite), pct = Number.isFinite(now) && rec.length > 30 ? (rec.filter((x) => x >= now).length / rec.length) * 100 : NaN; // yüksek yüzdelik = sınır daha derin = risk yüksek
    const lv = (arr) => (Number.isFinite(sig[last]) && Number.isFinite(arr[last]) ? c[last] * Math.exp(arr[last] * sig[last]) : NaN);
    return { yhat, dn90, dn95, up90, worst, st, now, pct, price: c[last], H, lvl: { dn90: lv(q.dn90), dn95: lv(q.dn95), up90: lv(q.up90) } };
  }

  /* ——— Funding geçmişi: Binance vadeli genel API, sayfalı (8 saatlik değerler, yüzde) ——— */
  const FUND_HOSTS = ['https://fapi.binance.com', 'https://fapi1.binance.com', 'https://fapi2.binance.com'];
  async function loadFundingSeries(sinceMs) {
    const t0 = sinceMs || Date.UTC(2019, 8, 10), STEP = 330 * 864e5, now = Date.now(), wins = []; for (let a = t0; a < now; a += STEP) wins.push(a);
    const one = async (a) => {
      for (const h of FUND_HOSTS) {
        try { const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000), r = await fetch(`${h}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1000&startTime=${a}&endTime=${a + STEP}`, { signal: ctl.signal }); clearTimeout(to); if (r.ok) return await r.json(); } catch (e) {}
      } return null;
    };
    const parts = await Promise.all(wins.map(one)); if (parts.filter(Boolean).length < Math.ceil(wins.length * 0.6)) return null;
    const m = new Map(); for (const p of parts) for (const x of p || []) { const v = parseFloat(x.fundingRate); if (Number.isFinite(v)) m.set(x.fundingTime, v * 100); }
    const rows = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v })); return rows.length > 300 ? rows : null;
  }
  /** 8 saatlik funding satırlarını gün mumlarına hizalar: günlük ortalama (8 saat başına %) ve 7 günlük ortalama. */
  function fundDaily(rows, t) {
    const day = (x) => Math.floor(x / 864e5), sum = new Map(), cnt = new Map();
    for (const r of rows) { const d = day(r.t); sum.set(d, (sum.get(d) || 0) + r.v); cnt.set(d, (cnt.get(d) || 0) + 1); }
    const f1 = t.map((x) => { const d = day(x); return cnt.get(d) ? sum.get(d) / cnt.get(d) : NaN; });
    const f7 = f1.map((_, i) => { let s = 0, k = 0; for (let j = Math.max(0, i - 6); j <= i; j++) if (Number.isFinite(f1[j])) { s += f1[j]; k++; } return k >= 4 ? s / k : NaN; });
    return { f1, f7 };
  }
  /** Betimleyici sınama: funding aşırı olduğunda sonraki H günün getirisi (yüzdelikler yalnızca geçmiş 365 günden → geleceğe bakmaz). */
  function fundStats(f7, c, H) {
    H = H || 14; const n = c.length, hi = [], lo = [], all = []; let lastHi = -99, lastLo = -99, epHi = 0, epLo = 0;
    for (let i = 365; i + H < n; i++) {
      if (!Number.isFinite(f7[i])) continue;
      const win = []; for (let j = i - 365; j < i; j++) if (Number.isFinite(f7[j])) win.push(f7[j]); if (win.length < 200) continue; win.sort((a, b) => a - b);
      const r = c[i + H] / c[i] - 1; all.push(r);
      if (f7[i] >= win[Math.floor(0.9 * win.length)]) { hi.push(r); if (i - lastHi > H) epHi++; lastHi = i; }
      if (f7[i] <= win[Math.floor(0.1 * win.length)]) { lo.push(r); if (i - lastLo > H) epLo++; lastLo = i; }
    }
    const med = (a) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }, pos = (a) => (a.length ? a.filter((x) => x > 0).length / a.length : NaN);
    return { H, nAll: all.length, meanAll: mean(all) * 100, medAll: med(all) * 100, posAll: pos(all), hi: { n: hi.length, ep: epHi, mean: mean(hi) * 100, med: med(hi) * 100, pos: pos(hi) }, lo: { n: lo.length, ep: epLo, mean: mean(lo) * 100, med: med(lo) * 100, pos: pos(lo) } };
  }

  /* ——— Döngü Isısı: önceki döngüde dip/tepe bölgelerini gösterir ———
     Yalnızca fiyat verisi: (1) fiyat/200G ortalama, (2) fiyat/365G ortalama, (3) son 4 yılın zirvesinden uzaklık.
     Her ölçü, son 4 yıllık (en çok 1461 gün) penceresindeki yüzdeliğe çevrilir (yalnızca geçmiş veriyle; geleceğe bakmaz) ve ortalaması alınır: 0-100.
     ≥90: tepe bölgesi, ≤10: dip bölgesi. Gösterge, yarılanma döngülerindeki gerçek tepe/dipleri otomatik bulup bölgelerle karşılaştırır. */
  const HALVINGS = [Date.UTC(2012, 10, 28), Date.UTC(2016, 6, 9), Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20)];
  /** BTC'nin tamamlanmış yarılanma döngülerindeki gerçek tepe ve dipleri (veri başlangıcı döngü başını içermiyorsa 2017 tepe/dibi ayrıca denenir). */
  function btcCycles(cs) {
    const n = cs.length, out = [];
    const dip = (ti) => { let bi = -1, ll = Infinity; for (let i = ti; i < n && cs[i].t <= cs[ti].t + 540 * 864e5; i++) if (cs[i].l < ll) { ll = cs[i].l; bi = i; } return bi; };
    if (cs[0].t > HALVINGS[1] && cs[0].t < HALVINGS[2]) { // veri 2017'de başlar: 2017 tepesi / 2018 dibi
      let ti = -1, hh = 0; for (let i = 0; i < n; i++) if (cs[i].t < HALVINGS[2] && cs[i].h > hh) { hh = cs[i].h; ti = i; }
      if (ti > 0) { const bi = dip(ti); if (bi > 0) out.push({ top: ti, bot: bi }); }
    }
    for (let k = 1; k + 1 < HALVINGS.length; k++) {
      const a = HALVINGS[k], b = HALVINGS[k + 1]; if (cs[0].t > a) continue;
      let ti = -1, hh = 0; for (let i = 0; i < n; i++) if (cs[i].t >= a && cs[i].t < b && cs[i].h > hh) { hh = cs[i].h; ti = i; }
      if (ti < 0) continue; const bi = dip(ti); if (bi > 0) out.push({ top: ti, bot: bi });
    }
    return out;
  }
  function zoneGauge(cs, opt) {
    const TOP = (opt && opt.top) || 90, BOT = (opt && opt.bot) || 10, WIN = 1461, MINOBS = 250, n = cs.length, c = cs.map((k) => k.c);
    const sma = (k) => { const o = new Array(n).fill(NaN); let s = 0; for (let i = 0; i < n; i++) { s += c[i]; if (i >= k) s -= c[i - k]; if (i >= k - 1) o[i] = s / k; } return o; };
    const m200 = sma(200), m365 = sma(365);
    const dd = new Array(n).fill(NaN); for (let i = 199; i < n; i++) { let mx = 0; for (let j = Math.max(0, i - WIN + 1); j <= i; j++) if (cs[j].h > mx) mx = cs[j].h; dd[i] = Math.log(c[i] / mx); }
    const mets = [c.map((x, i) => (Number.isFinite(m200[i]) ? Math.log(x / m200[i]) : NaN)), c.map((x, i) => (Number.isFinite(m365[i]) ? Math.log(x / m365[i]) : NaN)), dd];
    const heat = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      let tot = 0, k = 0;
      for (const m of mets) { if (!Number.isFinite(m[i])) continue; let below = 0, obs = 0; for (let j = Math.max(0, i - WIN + 1); j <= i; j++) if (Number.isFinite(m[j])) { obs++; if (m[j] <= m[i]) below++; } if (obs >= MINOBS) { tot += (below / obs) * 100; k++; } }
      if (k) heat[i] = tot / k;
    }
    // bölgeler (ardışık günler birleştirilir)
    const zones = (pred) => { const z = []; let a = -1; for (let i = 0; i <= n; i++) { const on = i < n && Number.isFinite(heat[i]) && pred(heat[i]); if (on && a < 0) a = i; if (!on && a >= 0) { z.push([a, i - 1]); a = -1; } } return z; };
    const topZ = zones((h) => h >= TOP), botZ = zones((h) => h <= BOT);
    // gerçek tepe/dipler: tamamlanmış yarılanma döngüleri (BTC)
    const near = (zs, i, before, after) => { for (const [x, y] of zs) if (y >= i - before && x <= i + after) return { hit: true, lead: i - Math.max(x, i - before) }; return { hit: false, lead: NaN }; };
    const cycles = btcCycles(cs).map((cy) => { const hT = Number.isFinite(heat[cy.top]), hB = Number.isFinite(heat[cy.bot]);
      return { top: cy.top, bot: cy.bot, topP: cs[cy.top].h, botP: cs[cy.bot].l, topHeat: heat[cy.top], botHeat: heat[cy.bot], topHit: hT ? near(topZ, cy.top, 90, 20) : { hit: false, lead: NaN, na: true }, botHit: hB ? near(botZ, cy.bot, 90, 20) : { hit: false, lead: NaN, na: true } }; }).filter((cy) => Number.isFinite(cy.topHeat) || Number.isFinite(cy.botHeat));
    // kesinlik: bölge günlerinin kaçı gerçek uca ±90 gün yakın
    const ext = (key) => cycles.filter((cy) => !(key === 'top' ? cy.topHit.na : cy.botHit.na)).map((cy) => cy[key]), within = (zs, pts) => { let tot = 0, ok = 0; for (const [x, y] of zs) for (let i = x; i <= y; i++) { tot++; if (pts.some((p) => Math.abs(i - p) <= 90)) ok++; } return tot ? ok / tot : NaN; };
    const covered = heat.filter(Number.isFinite).length, last = n - 1;
    return { heat, topZ, botZ, cycles, TOP, BOT, now: heat[last], precTop: within(topZ, ext('top')), precBot: within(botZ, ext('bot')), share: { top: topZ.reduce((s2, [a, b]) => s2 + b - a + 1, 0) / Math.max(1, covered), bot: botZ.reduce((s2, [a, b]) => s2 + b - a + 1, 0) / Math.max(1, covered) }, price: c[last], nowZone: Number.isFinite(heat[last]) ? (heat[last] >= TOP ? 'top' : heat[last] <= BOT ? 'bot' : 'mid') : null };
  }


  /* ——— Seviye Değme Olasılığı: "BTC önümüzdeki 7/14/30 günde şu seviyeye dokunur mu?" ———
     Düşüş Tabanı ile aynı oynaklık tahminini (HAR, genişleyen pencere) ve geçmiş standartlaştırılmış uç hareketlerin dağılımını kullanır;
     fakat tek bir yüzdelik yerine bütün seviyeler için olasılık eğrisi verir (ör. "−%15'e değme olasılığı %12").
     Güvenilirlik sınaması: her gün için o gün bilinenle yapılan olasılık, sonradan gerçekleşen değme sıklığıyla karşılaştırılır. */
  const TOUCH_LV = [-30, -20, -10, -5, 5, 10, 20, 30];
  function touchModel(cs, H, wantLevels) {
    const n = cs.length, LN2 = Math.log(2), MINTRAIN = 250, W0 = 89, K = 5, c = cs.map((k) => k.c);
    const v = cs.map((k) => { const r = Math.log(k.h / Math.max(k.l, 1e-12)); return Math.max(r * r / (4 * LN2), 1e-10); });
    const cum = [0]; for (let i = 0; i < n; i++) cum.push(cum[i] + v[i]);
    const rv = (i, k) => Math.sqrt((cum[i + 1] - cum[i + 1 - k]) / k), feat = (i) => [1, Math.log(rv(i, 1)), Math.log(rv(i, 7)), Math.log(rv(i, 30)), Math.log(rv(i, 90))], yOf = (i) => Math.log(Math.sqrt((cum[i + H + 1] - cum[i + 1]) / H));
    const XtX = Array.from({ length: K }, () => new Array(K).fill(0)), Xty = new Array(K).fill(0), yhat = new Array(n).fill(NaN), sD = [], sU = []; let rows = 0;
    const ins = (arr, z) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < z) lo = m + 1; else hi = m; } arr.splice(lo, 0, z); };
    const cntLE = (arr, z) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= z) lo = m + 1; else hi = m; } return lo; }; // ≤ z olanların sayısı
    const ext = (i) => { let lo = Infinity, hi = -Infinity; for (let j = i + 1; j <= i + H; j++) { if (cs[j].l < lo) lo = cs[j].l; if (cs[j].h > hi) hi = cs[j].h; } return [Math.log(Math.min(lo, c[i]) / c[i]), Math.log(Math.max(hi, c[i]) / c[i])]; };
    const pDown = (sc, d) => cntLE(sD, Math.log(1 + d / 100) / sc) / sD.length;               // d<0: en düşük ≤ seviye olasılığı
    const pUp = (sc, u) => { const z = Math.log(1 + u / 100) / sc; let lo = 0, hi = sU.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sU[m] < z) lo = m + 1; else hi = m; } return (sU.length - lo) / sU.length; };
    const cal = wantLevels ? TOUCH_LV.map(() => ({ p: 0, r: 0, k: 0 })) : null; let last = null;
    for (let t = W0; t < n; t++) {
      const s2 = t - H;
      if (s2 >= W0) { const x = feat(s2), y = yOf(s2); rows++; for (let a = 0; a < K; a++) { Xty[a] += x[a] * y; for (let b = 0; b < K; b++) XtX[a][b] += x[a] * x[b]; } if (Number.isFinite(yhat[s2])) { const [d, u] = ext(s2), sc = Math.exp(yhat[s2]) * Math.sqrt(H); ins(sD, d / sc); ins(sU, u / sc); } }
      if (rows >= MINTRAIN) { const A = XtX.map((r, i) => r.map((x, j) => x + (i === j && i > 0 ? 1e-6 : 0))), beta = solve4(A, Xty); if (beta) yhat[t] = feat(t).reduce((a, b, i) => a + b * beta[i], 0); }
      if (Number.isFinite(yhat[t]) && sD.length >= 120) {
        const sc = Math.exp(yhat[t]) * Math.sqrt(H);
        if (cal && t + H < n) { const [d, u] = ext(t); TOUCH_LV.forEach((L, k) => { const pr = L < 0 ? pDown(sc, L) : pUp(sc, L), hit = L < 0 ? (d <= Math.log(1 + L / 100) ? 1 : 0) : (u >= Math.log(1 + L / 100) ? 1 : 0); cal[k].p += pr; cal[k].r += hit; cal[k].k++; }); }
        if (t === n - 1) last = { sc, pDown: (d) => pDown(sc, d), pUp: (u) => pUp(sc, u) };
      }
    }
    return { H, yhat, last, cal: cal ? cal.map((x, k) => ({ L: TOUCH_LV[k], pred: x.p / x.k, real: x.r / x.k, n: x.k })) : null, nSamples: sD.length };
  }
  function touchMap(cs) {
    const Hs = [7, 14, 30], ms = Hs.map((H) => touchModel(cs, H, true)), price = cs[cs.length - 1].c; if (!ms[2].last) return null;
    const grid = []; for (let d = -40; d <= 60; d++) grid.push(d);
    const curves = ms.map((m) => grid.map((d) => (d === 0 ? 1 : m.last ? (d < 0 ? m.last.pDown(d) : m.last.pUp(d)) : NaN)));
    const at = (m, L) => (L < 0 ? m.last.pDown(L) : m.last.pUp(L)), key = ms[2], sig = Math.exp(key.yhat[cs.length - 1]) * Math.sqrt(30);
    const hist = []; for (let i = Math.max(0, cs.length - 365); i < cs.length; i++) if (Number.isFinite(key.yhat[i])) hist.push(key.yhat[i]); const pct = hist.length > 30 ? (hist.filter((x) => x <= key.yhat[cs.length - 1]).length / hist.length) * 100 : NaN;
    const gap = Math.max(...ms.flatMap((m) => m.cal.map((x) => Math.abs(x.pred - x.real)))), gapAvg = mean(ms.flatMap((m) => m.cal.map((x) => Math.abs(x.pred - x.real))));
    return { Hs, grid, curves, price, ms, at: (hi, L) => at(ms[hi], L), pct, gap, gapAvg, sig };
  }

  /* ——— Uyarlanabilir sinyaller ———
     Sabit eşikler (ör. Pi Cycle'ın "oran 1'e değince") piyasa yapısı değişince çalışmaz: döngü tepeleri küçüldükçe oran 1'e hiç ulaşmayabilir.
     Burada eşik, ölçünün KENDİ son 4 yıllık geçmişindeki yüzdeliktir (yalnızca geçmiş veri). Böylece sinyal "bu dönemin standartlarına göre uç" demektir. */
  const WINR = 1461, MINR = 250;
  function trailRank(m, i, win, minObs) { // m[i]'nin son win değerdeki yüzdeliği (0-100); geçmiş + bugün
    if (!Number.isFinite(m[i])) return NaN; let below = 0, obs = 0; for (let j = Math.max(0, i - win + 1); j <= i; j++) if (Number.isFinite(m[j])) { obs++; if (m[j] <= m[i]) below++; } return obs >= (minObs || MINR) ? (below / obs) * 100 : NaN;
  }
  function trailQuant(m, i, win, p, minObs) { const a = []; for (let j = Math.max(0, i - win + 1); j <= i; j++) if (Number.isFinite(m[j])) a.push(m[j]); if (a.length < (minObs || MINR)) return NaN; a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }
  const smaArr = (c, k) => { const o = new Array(c.length).fill(NaN); let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= k) s -= c[i - k]; if (i >= k - 1) o[i] = s / k; } return o; };
  /** Sinyal günlerini (ardışık olanlar tek olay sayılır, gap gün ara) listeler. */
  function episodes(flags, gap) { const ev = []; let last = -1e9; for (let i = 0; i < flags.length; i++) if (flags[i] && i - last > gap) { ev.push(i); last = i; } else if (flags[i]) last = i; return ev; }
  /** Sinyallerin gerçek tepe/diplere karnesi: ±45 gün içinde sinyal var mı, gün farkı; hiçbir uca ±90 günden yakın olmayan "yanlış" olay sayısı. */
  function recordOf(cs, topEv, botEv) {
    const cyc = btcCycles(cs), W = 45, find = (ev, i) => { let best = null; for (const e of ev) if (Math.abs(e - i) <= W && (best === null || Math.abs(e - i) < Math.abs(best - i))) best = e; return best; };
    const rows = cyc.map((c) => { const t = find(topEv, c.top), b = find(botEv, c.bot); return { top: c.top, bot: c.bot, topSig: t, botSig: b, topOff: t == null ? NaN : t - c.top, botOff: b == null ? NaN : b - c.bot }; });
    const ex = (key) => cyc.map((c) => c[key]), far = (ev, pts) => ev.filter((e) => !pts.some((p) => Math.abs(e - p) <= 90)).length;
    return { rows, nTop: topEv.length, nBot: botEv.length, falseTop: far(topEv, ex('top')), falseBot: far(botEv, ex('bot')), cycles: cyc.length };
  }
  function piAdaptive(cs) {
    const n = cs.length, c = cs.map((k) => k.c), s111 = smaArr(c, 111), s350 = smaArr(c, 350);
    const rt = c.map((_, i) => (Number.isFinite(s111[i]) && Number.isFinite(s350[i]) ? s111[i] / (2 * s350[i]) : NaN)), rb = c.map((_, i) => (Number.isFinite(s111[i]) && Number.isFinite(s350[i]) ? s111[i] / s350[i] : NaN));
    const rankT = rt.map((_, i) => trailRank(rt, i, WINR)), rankB = rb.map((_, i) => trailRank(rb, i, WINR));
    const thr = rt.map((_, i) => (i % 3 === 0 || i === n - 1 ? trailQuant(rt, i, WINR, 0.97) : NaN)); // görüntü için seyrek (3 günde bir) hesaplanır
    for (let i = 0; i < n; i++) if (Number.isNaN(thr[i]) && i > 0 && Number.isFinite(thr[i - 1])) thr[i] = thr[i - 1]; // son bilinen eşik taşınır (geleceğe bakmaz)
    const topEv = episodes(rankT.map((r) => r >= 97), 90), botEv = episodes(rankB.map((r) => r <= 3), 90);
    const fixed = []; for (let i = 1; i < n; i++) if (Number.isFinite(rt[i]) && rt[i] >= 1 && !(rt[i - 1] >= 1)) fixed.push(i);
    const fixedRec = recordOf(cs, fixed, []), rec = recordOf(cs, topEv, botEv), last = n - 1;
    return { rt, rb, rankT, rankB, thr, topEv, botEv, fixed, rec, fixedRec, now: { rankT: rankT[last], rankB: rankB[last], rt: rt[last], thr: thr[last] } };
  }
  function volAdaptive(cs) {
    const n = cs.length, c = cs.map((k) => k.c), dv = cs.map((k) => k.c * k.v), m30 = smaArr(dv, 30), m365 = smaArr(dv, 365);
    const rel = dv.map((_, i) => (Number.isFinite(m30[i]) && Number.isFinite(m365[i]) && m365[i] > 0 ? Math.log(m30[i] / m365[i]) : NaN));
    const hi365 = c.map((_, i) => { if (i < 364) return NaN; let h = 0; for (let j = i - 364; j <= i; j++) if (cs[j].h > h) h = cs[j].h; return h; });
    const dd = c.map((x, i) => (Number.isFinite(hi365[i]) ? Math.log(x / hi365[i]) : NaN)), ret90 = c.map((x, i) => (i >= 90 ? Math.log(x / c[i - 90]) : NaN));
    const rankV = rel.map((_, i) => trailRank(rel, i, WINR)), rankD = dd.map((_, i) => trailRank(dd, i, WINR)), rankR = ret90.map((_, i) => trailRank(ret90, i, WINR));
    const thr = rel.map((_, i) => (i % 3 === 0 || i === n - 1 ? trailQuant(rel, i, WINR, 0.9) : NaN)); for (let i = 0; i < n; i++) if (Number.isNaN(thr[i]) && i > 0 && Number.isFinite(thr[i - 1])) thr[i] = thr[i - 1];
    const topEv = episodes(rankV.map((v, i) => v >= 90 && rankR[i] >= 90 && dd[i] >= Math.log(0.9)), 60), botEv = episodes(rankV.map((v, i) => v >= 90 && rankD[i] <= 10), 60);
    const rec = recordOf(cs, topEv, botEv), last = n - 1;
    return { rel, thr, rankV, rankD, rankR, topEv, botEv, rec, now: { rankV: rankV[last], rankD: rankD[last], rankR: rankR[last], dd: dd[last] } };
  }
  function sigCard(id, title, g, t, cc, ctx, o) {
    const { xMin, beam, bull, bear } = ctx, P = (x) => '$' + Math.round(x).toLocaleString('tr-TR'), dstr2 = (i) => new Date(t[i]).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' }), N = t.length;
    const rows = g.rec.rows.map((r) => `${dstr2(r.top)} tepesi: ${r.topSig == null ? 'sinyal yok' : (r.topOff === 0 ? 'tepe günü' : Math.abs(r.topOff) + ' gün ' + (r.topOff < 0 ? 'önce' : 'sonra')) + ' sinyal'}; ${dstr2(r.bot)} dibi: ${r.botSig == null ? 'sinyal yok' : (r.botOff === 0 ? 'dip günü' : Math.abs(r.botOff) + ' gün ' + (r.botOff < 0 ? 'önce' : 'sonra')) + ' sinyal'}`).join(' | ');
    const lastTop = g.topEv.length ? dstr2(g.topEv[g.topEv.length - 1]) : 'yok', lastBot = g.botEv.length ? dstr2(g.botEv[g.botEv.length - 1]) : 'yok';
    const body = o.body(g, P), st = o.state(g);
    return { id, title, value: st.value, unit: st.unit, badge: st.badge, tone: st.tone,
      info: `${o.about} Son tepe sinyali: ${lastTop}; son dip sinyali: ${lastBot}. Toplam ${g.rec.nTop} tepe, ${g.rec.nBot} dip sinyali verildi; bunların ${g.rec.falseTop} ve ${g.rec.falseBot} tanesi hiçbir gerçek tepe/dibe ±90 gün yakın değildi (yanlış alarm). Karne (her döngüde gerçek uca ±45 gün): ${rows || 'veride tamamlanmış döngü yok'}. ${body} Eşikler her gün yalnızca o güne kadarki son 4 yıllık geçmişe göre hesaplanır, geleceğe bakılmaz. Az sayıda döngüye dayanır; bu bir yön tahmini değil, uç bölge uyarısıdır.`,
      cfg: { xMin, fmt: o.fmt, under: { x: t, y: cc }, series: o.series(g, t), refs: o.refs || [], marks: g.topEv.map((k) => ({ x: t[k], color: bear })).concat(g.botEv.map((k) => ({ x: t[k], color: bull }))), now: o.now(g, t, N) },
      legend: o.legend.concat([['Tepe sinyali', bear], ['Dip sinyali', bull], ['BTC fiyatı (altta)', '#fff']]) };
  }
  function piAdaptiveCard(g, t, cc, ctx) {
    const { beam } = ctx, f2 = (v) => fmt2(v), N = t.length, fr = g.fixedRec;
    return sigCard('piad', 'Uyarlanabilir Pi Cycle', g, t, cc, ctx, {
      about: `Pi Cycle'ın 111/(2×350) gün ortalama oranını kullanır ama sabit "oran 1" eşiği yerine, oranın kendi son 4 yıllık geçmişindeki 97. yüzdeliğini eşik yapar: son döngülerde zirvelerin küçülmesiyle oran 1'e ulaşmayabilir, ama kendi dönemine göre yine uç olur. Dip için 111/350 oranının 3. yüzdeliği kullanılır. Klasik sabit eşik (oran ≥ 1) bu veride ${g.fixed.length} kez kesişti ve gerçek tepelere karnesi: ${fr.rows.filter((r) => r.topSig != null).length}/${fr.cycles} tepe yakalandı, ${fr.falseTop} yanlış alarm.`,
      fmt: (v) => f2(v), legend: [['Pi oranı', beam], ['Uyarlanabilir eşik', ctx.bear]],
      state: (x) => { const a = x.now.rankT, b = x.now.rankB; const top = a >= 97, bot = b <= 3; return { value: Number.isFinite(a) ? 'Oran ' + f2(x.now.rt) : '–', unit: Number.isFinite(a) ? 'eşik ' + f2(x.now.thr) + ' · ' + Math.round(a) + '. yüzdelik' : '', badge: top ? 'Tepe uyarısı' : bot ? 'Dip uyarısı' : 'Sinyal yok', tone: top ? 'down' : bot ? 'up' : 'flat' }; },
      body: (x) => `Şu an oran ${f2(x.now.rt)}, uyarlanabilir eşik ${f2(x.now.thr)}; oranın son 4 yıllık yüzdeliği ${Number.isFinite(x.now.rankT) ? Math.round(x.now.rankT) : '–'}.`,
      series: (x, tt) => [{ nm: 'Pi oranı (111G ÷ 2×350G)', f: (v) => f2(v), x: tt, y: x.rt, color: ctx.beam, w: 1.6 }, { nm: 'Uyarlanabilir eşik (97. yüzdelik)', f: (v) => f2(v), x: tt, y: x.thr, color: ctx.bear, w: 1.4, dash: [5, 4] }],
      refs: [{ y: 1, color: 'rgba(233,238,248,.4)', label: 'klasik 1' }], now: (x, tt, n) => (Number.isFinite(x.now.rt) ? { x: tt[n - 1], y: x.now.rt } : null) });
  }
  function volAdaptiveCard(g, t, cc, ctx) {
    const f2 = (v) => fmt2(v);
    return sigCard('volad', 'Hacim Coşku ve Teslimiyet', g, t, cc, ctx, {
      about: `Dolar hacmindeki yoğunluğu ölçer: son 30 günün ortalama dolar hacminin son 365 güne oranı (logaritmik). Hacim kendi 4 yıllık geçmişinin en yüksek %10'una çıkınca iki durum aranır: fiyat son 90 günde de kendi geçmişinin en güçlü %10'unda ve 365 günlük zirveye %10 yakınsa TEPE (coşku); fiyat 365 günlük zirveden kendi geçmişinin en derin %10'unda uzaktaysa DİP (teslimiyet, panik satışı).`,
      fmt: (v) => f2(v), legend: [['Hacim yoğunluğu (log oran)', ctx.beam], ['Uyarlanabilir eşik (90. yüzdelik)', ctx.bear]],
      state: (x) => { const v = x.now.rankV, top = v >= 90 && x.now.rankR >= 90 && x.now.dd >= Math.log(0.9), bot = v >= 90 && x.now.rankD <= 10; return { value: Number.isFinite(v) ? Math.round(v) + '. yüzdelik' : '–', unit: 'hacim yoğunluğu', badge: top ? 'Coşku' : bot ? 'Teslimiyet' : v >= 90 ? 'Yüksek hacim' : 'Sakin', tone: top ? 'down' : bot ? 'up' : 'flat' }; },
      body: (x) => `Şu an hacim yoğunluğu son 4 yılın ${Number.isFinite(x.now.rankV) ? Math.round(x.now.rankV) : '–'}. yüzdeliğinde, fiyatın 365 günlük zirveye uzaklığı ${Number.isFinite(x.now.dd) ? Math.round((Math.exp(x.now.dd) - 1) * 100) : '–'}%. Hacim verisi borsa hacmidir; borsalar arası kaymalar ölçüyü etkileyebilir.`,
      series: (x, tt) => [{ nm: 'Hacim yoğunluğu (log oran)', f: (v) => f2(v), x: tt, y: x.rel, color: ctx.beam, w: 1.6 }, { nm: 'Uyarlanabilir eşik (90. yüzdelik)', f: (v) => f2(v), x: tt, y: x.thr, color: ctx.bear, w: 1.4, dash: [5, 4] }],
      refs: [{ y: 0, color: 'rgba(233,238,248,.3)', label: '0' }], now: (x, tt, n) => (Number.isFinite(x.rel[n - 1]) ? { x: tt[n - 1], y: x.rel[n - 1] } : null) });
  }

  function compute(cs) {
    if (!cs || cs.length < 400) return null;
    return { t: cs.map((k) => k.t), bow: bowTension(cs), storm: stormGauge(cs), drop: dropGauge(cs), zone: zoneGauge(cs), touch: touchMap(cs), piad: piAdaptive(cs), volad: volAdaptive(cs), funding: null, fund: null };
  }

  /* ——— ücretsiz funding verisi (Binance vadeli genel API; erişilemezse null) ——— */
  async function loadFunding() {
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1000', { signal: ctl.signal }); clearTimeout(to);
      if (!r.ok) return null;
      const a = (await r.json()).map((x) => parseFloat(x.fundingRate) * 100).filter(fin);
      if (a.length < 120) return null;
      const recent = a.slice(-90), mu = mean(a), sd = Math.sqrt(mean(a.map((x) => (x - mu) ** 2))) || 1e-9;
      return { avg30: mean(recent), z: (mean(recent) - mu) / sd, last: a[a.length - 1], n: a.length };
    } catch (e) { return null; }
  }

  /* ——— kartlar (market-ui.js'teki cards() ile aynı şema) ——— */
  function zoneCard(zg, t, cc, ctx, coin) {
    const { xMin, beam, bull, bear } = ctx, N = t.length, c2 = cc;
    if (zg && Number.isFinite(zg.now)) {
      const dstr2 = (i) => new Date(t[i]).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' }), P = (x) => '$' + Math.round(x).toLocaleString('tr-TR');
      const badge = zg.nowZone === 'top' ? 'Tepe bölgesi' : zg.nowZone === 'bot' ? 'Dip bölgesi' : 'Orta bölge', tn = zg.nowZone === 'top' ? 'down' : zg.nowZone === 'bot' ? 'up' : 'flat';
      const lines = zg.cycles.map((cy) => { const tp = cy.topHit.na ? `${dstr2(cy.top)} tepesi (${P(cy.topP)}): ölçü için geçmiş veri yetmedi` : `${dstr2(cy.top)} tepesi (${P(cy.topP)}): ısı ${Math.round(cy.topHeat)}, ${cy.topHit.hit ? 'tepe bölgesi tepeden ' + Math.max(0, cy.topHit.lead) + ' gün önce başlayıp tepeyi kapsadı' : 'tepe bölgesi işaretlemedi'}`, bt = `${dstr2(cy.bot)} dibi (${P(cy.botP)}): ısı ${Math.round(cy.botHeat)}, ${cy.botHit.hit ? 'dip bölgesi dipten ' + Math.max(0, cy.botHit.lead) + ' gün önce başlayıp dibi kapsadı' : 'dip bölgesi işaretlemedi'}`; return tp + '; ' + bt; }).join(' | ');
      const pr = (v) => (Number.isFinite(v) ? '%' + Math.round(v * 100) : '–');
      return {
        id: 'zone', coin, title: 'Döngü Dip/Tepe Bölgeleri', value: Math.round(zg.now) + '/100', unit: 'döngü ısısı', badge, tone: tn,
        info: `${coin} fiyatının son 4 yıllık döngüsünde nerede durduğunu 0-100 ile ölçer: 100 tepeye, 0 dibe yakın demektir. Üç fiyat ölçüsünün (200 gün ve 365 gün ortalamalarına göre uzaklık, son 4 yılın zirvesinden uzaklık) kendi son 4 yıllık geçmişindeki yüzdeliklerinin ortalamasıdır; her gün yalnızca o güne kadarki veri kullanıldığı için grafik, göstergenin o gün gerçekte ne göstereceğidir (geriye dönük süslenmedi). ${zg.TOP} üstü kırmızı tepe bölgesi, ${zg.BOT} altı yeşil dip bölgesi olarak boyanır; kesikli çizgiler yarılanma döngülerinde otomatik bulunan gerçek tepe ve diplerdir. Önceki döngüler: ${lines || 'veride tamamlanmış döngü bulunamadı'}. Bölge günlerinin gerçek uca ±90 gün yakın olanı: tepe ${pr(zg.precTop)}, dip ${pr(zg.precBot)} (günlerin yaklaşık %${Math.round(zg.share.top * 100)}'i tepe, %${Math.round(zg.share.bot * 100)}'i dip bölgesinde). Bölgeler uç noktayı tam gün olarak değil bölge olarak yakalar ve erken başlayabilir; her döngü farklı olduğundan, yalnızca iki tamamlanmış döngü vardır. Şu an ısı ${Math.round(zg.now)}. Bu bir yön tahmini değil, döngü içindeki konum ölçüsüdür.`,
        cfg: { xMin, log: true, fmt: (v) => P(v).replace('$', ''), series: [{ nm: coin, f: (v) => P(v), x: t, y: cc, color: 'rgba(233,238,248,.9)', w: 1.3 }],
          zones: zg.topZ.map(([a, b]) => ({ x0: t[a], x1: t[b], color: 'rgba(255,99,132,.22)' })).concat(zg.botZ.map(([a, b]) => ({ x0: t[a], x1: t[b], color: 'rgba(53,214,160,.22)' }))),
          marks: zg.cycles.map((cy) => ({ x: t[cy.top], color: bear })).concat(zg.cycles.map((cy) => ({ x: t[cy.bot], color: bull }))),
          under: { x: t, y: zg.heat, log: false, lo: 0, hi: 100, nm: 'Döngü ısısı', tip: (v) => Math.round(v) + '/100', fmt: (v) => Math.round(v), color: beam, refs: [{ y: zg.TOP, color: bear }, { y: zg.BOT, color: bull }] }, now: { x: t[N - 1], y: cc[N - 1] } },
        legend: [['Tepe bölgesi', 'rgba(255,99,132,.7)'], ['Dip bölgesi', 'rgba(53,214,160,.7)'], ['Gerçek tepe/dip (kesikli)', 'rgba(233,238,248,.5)'], ['Döngü ısısı (altta)', beam]] };
    }
    return null;
  }

  function cards(X, ctx) {
    const { t, xMin, beam, foam, bull, bear } = ctx, out = [], bw = X.bow, N = t.length;

    // 0) Fırtına Barometresi
    const sg = X.storm;
    if (sg && Number.isFinite(sg.now) && sg.mult) {
      const st = sg.st, pc = sg.pct, badge = !Number.isFinite(pc) ? '–' : pc < 25 ? 'Sakin' : pc < 60 ? 'Normal' : pc < 85 ? 'Hareketli' : 'Fırtına';
      const tn = badge === 'Fırtına' ? 'down' : badge === 'Hareketli' ? 'warn' : 'flat', P = (m) => '$' + Math.round(sg.price * m).toLocaleString('tr-TR');
      const okSt = st && st.n >= 200;
      out.push({
        id: 'storm', title: 'Fırtına Barometresi', value: '±%' + fmt1(sg.now), unit: sg.H + ' günde, %80 olasılıkla', badge, tone: tn,
        info: `Önümüzdeki ${sg.H} günde BTC'nin ne kadar oynayabileceğini tahmin eder; YÖN SÖYLEMEZ. Oynaklık kümelenir: hareketli dönemi hareketli, sakin dönemi sakin günler izler. Günlük en yüksek/en düşük aralıktan, o güne kadarki veriyle (genişleyen pencere, geleceğe bakmadan) 1, 7, 30 ve 90 günlük oynaklıktan regresyonla öngörülür; bant geçmiş tahmin hatalarının yüzdeliklerinden gelir. Şu anki tahmin: %80 olasılıkla ${P(sg.mult.lo80)} – ${P(sg.mult.hi80)}, %95 olasılıkla ${P(sg.mult.lo95)} – ${P(sg.mult.hi95)} (fiyat ${P(1)}). Son 365 günün %${Math.round(pc || 0)}'inden daha yüksek bir genişlikte. ${okSt ? `Örneklem dışı sınama (${st.n} gün): %80 bant gerçek hareketleri %${Math.round(st.cov80 * 100)}, %95 bant %${Math.round(st.cov95 * 100)} oranında içine aldı (hedef 80/95). Tahmin ile gerçekleşen arasındaki korelasyon ${fmt2(st.corr)}; ortalama oynaklığı varsaymaya göre hata ${Math.round(st.r2vsMean * 100)}%, son 30 günü varsaymaya göre ${Math.round(st.r2vsNaive * 100)}% azaldı. "Hareketli" ucun üçte biri, "sakin" ucun üçte birinden ortalama ${fmt1(st.ratio)} kat büyük hareket yaptı.` : 'Sınama için veri yetersiz.'} Beklenmedik haber şokları bandın dışına taşabilir; bu bir risk büyüklüğü ve pozisyon boyutu aracıdır, al-sat sinyali değildir.`,
        cfg: { xMin, fmt: (v) => '±' + v.toFixed(0) + '%', under: { x: t, y: ctx.c },
          series: [{ nm: 'Gerçekleşen ' + sg.H + 'G hareket', f: (v) => '±%' + fmt1(v), x: t, y: sg.real7.map((v, k) => (Number.isFinite(sg.half80[k - sg.H]) ? v : NaN)), color: 'rgba(233,238,248,.4)', w: 1 }, { nm: 'Tahmin (' + sg.H + ' gün önceden)', f: (v) => '±%' + fmt1(v), x: t, y: sg.half80.map((v, k) => (k >= sg.H ? sg.half80[k - sg.H] : NaN)), color: beam, w: 1.8 }], now: { x: t[N - 1], y: sg.now } },
        legend: [['Tahmin edilen genişlik (%80)', beam], ['Gerçekleşen 7G hareket', 'rgba(233,238,248,.5)'], ['BTC fiyatı (altta)', '#fff']] });
    }

    // 1) Düşüş Tabanı
    const dg = X.drop;
    if (dg && Number.isFinite(dg.now) && Number.isFinite(dg.lvl.dn90)) {
      const st = dg.st, pc = dg.pct, badge = !Number.isFinite(pc) ? '–' : pc < 25 ? 'Düşük risk' : pc < 60 ? 'Normal' : pc < 85 ? 'Yüksek risk' : 'Aşırı risk', P = (x) => '$' + Math.round(x).toLocaleString('tr-TR');
      const okSt = st && st.n >= 200;
      out.push({
        id: 'drop', title: 'Düşüş Tabanı', value: '%' + fmt1(dg.now), unit: dg.H + ' günde en kötü düşüş, %90 olasılıkla bundan az', badge, tone: badge === 'Aşırı risk' ? 'down' : badge === 'Yüksek risk' ? 'warn' : 'flat',
        info: `Bugünkü fiyattan (${P(dg.price)}) başlayıp önümüzdeki ${dg.H} gün içinde fiyatın İNEBİLECEĞİ en düşük seviyeyi tahmin eder: %90 olasılıkla ${P(dg.lvl.dn90)} altına inmez, %95 olasılıkla ${P(dg.lvl.dn95)} altına inmez. Yukarıda aynı pencerede %90 olasılıkla ${P(dg.lvl.up90)} üstüne çıkmaz. Fırtına Barometresi sürenin sonundaki mesafeye bakar; bu ise yol boyunca değen en uç noktaya bakar, yani stop, kaldıraç ve likidasyon mesafesini seçerken işe yarar. Yön söylemez. Ölçek, 1/7/30/90 günlük oynaklıktan her gün yalnızca o güne kadarki veriyle uydurulan regresyondan, sınır ise geçmiş uç hareketlerin yüzdeliklerinden gelir. ${okSt ? `Örneklem dışı sınama (${st.n} gün): gerçek en kötü düşüş %90 sınırını ${'%' + Math.round(st.cov90 * 100)}, %95 sınırını ${'%' + Math.round(st.cov95 * 100)} oranında aşmadı (hedef 90/95). Sakin dönemlerde ${'%' + Math.round(st.covLow * 100)}, hareketli dönemlerde ${'%' + Math.round(st.covHigh * 100)}; tek bir sabit sınır kullanılsaydı aynı dönemlerde ${'%' + Math.round(st.staticLow * 100)} ve ${'%' + Math.round(st.staticHigh * 100)} tutardı, yani sabit sınır sakinde gereksiz geniş, hareketlide yetersiz kalırdı.` : 'Sınama için veri yetersiz.'} Ani haber şokları sınırın dışına taşabilir; bu bir risk büyüklüğü aracıdır, al-sat sinyali değildir.`,
        cfg: { xMin, fmt: (v) => v.toFixed(0) + '%', under: { x: t, y: ctx.c },
          series: [{ nm: 'Gerçekleşen en kötü düşüş', f: (v) => '%' + fmt1(v), x: t, y: dg.worst.map((v, k) => (k >= dg.H && Number.isFinite(dg.dn90[k - dg.H]) ? v : NaN)), color: 'rgba(233,238,248,.4)', w: 1 }, { nm: 'Tahmin edilen taban (%90)', f: (v) => '%' + fmt1(v), x: t, y: dg.dn90.map((v, k) => (k >= dg.H ? dg.dn90[k - dg.H] : NaN)), color: bear, w: 1.8 }], now: { x: t[N - 1], y: dg.now } },
        legend: [['Tahmin edilen taban (%90)', bear], ['Gerçekleşen en kötü düşüş', 'rgba(233,238,248,.5)'], ['BTC fiyatı (altta)', '#fff']] });
    }

    // 1b) Funding Rates + BTC
    if (X.fund && X.fund.length) {
      const fd = fundDaily(X.fund, t), f7 = fd.f7, last = (() => { for (let k = N - 1; k >= 0; k--) if (Number.isFinite(f7[k])) return k; return -1; })();
      if (last >= 0) {
        const cur = f7[last], ann = cur * 3 * 365, hist = f7.filter(Number.isFinite).sort((a, b) => a - b), pc = (hist.filter((x) => x <= cur).length / hist.length) * 100, fs = fundStats(f7, ctx.c, 14);
        const badge = pc >= 90 ? 'Uzunlar kalabalık' : pc <= 10 ? 'Kısalar kalabalık' : cur < 0 ? 'Negatif' : 'Dengeli', tn = pc >= 90 ? 'down' : pc <= 10 ? 'up' : 'flat';
        const fm = (v) => (v >= 0 ? '+' : '') + fmt2(v) + '%', blk = (nm, o) => (o.n ? `${nm}: ${o.n} gün (yaklaşık ${o.ep} ayrı dönem), ${fs.H} gün sonra ortalama ${fm(o.mean)}, ortanca ${fm(o.med)}, pozitif kapanış %${Math.round(o.pos * 100)}` : `${nm}: yeterli gün yok`);
        out.push({
          id: 'fund', title: 'Funding Rates', value: fm(ann).replace('%', '') + '%', unit: 'yıllık · 7 gün ort. 8 saatte ' + fmt2(cur * 1) + '%', badge, tone: tn,
          info: `Funding, vadeli (perpetual) piyasada uzun ve kısa pozisyon sahiplerinin 8 saatte bir birbirine ödediği orandır. Pozitifse uzunlar kısalara öder: piyasa yukarı yönde kalabalıktır; negatifse tersi. Beklenen taban değer 8 saatte %0,01'dir (yıllık yaklaşık %11). Şu an 7 günlük ortalama ${fmt2(cur)}% (8 saatte), kendi tarihinin %${Math.round(pc)}'lik diliminde. Grafikte funding'in günlük değeri (soluk) ve 7 günlük ortalaması (kalın) altta BTC fiyatıyla birlikte görünür. Betimleyici sınama (yüzdelikler yalnızca önceki 365 günden alındı, geleceğe bakılmadı): tüm günlerde ${fs.H} gün sonra ortalama ${fm(fs.meanAll)} (pozitif kapanış %${Math.round(fs.posAll * 100)}). ${blk('Funding çok yüksekken (üst %10)', fs.hi)}. ${blk('Funding çok düşükken (alt %10)', fs.lo)}. Ardışık günler bağımsız değildir; gerçek örnek sayısı gün sayısından çok daha azdır, bu yüzden bu sayılar tek başına işlem gerekçesi değil, kalabalıklaşmanın tarihçesidir. Funding aşırıyken yön tersine dönebileceği gibi, güçlü trendlerde aylarca aşırı kalabilir. Veri: Binance BTCUSDT vadeli.`,
          cfg: { xMin, fmt: (v) => fmt2(v) + '%', under: { x: t, y: ctx.c },
            series: [{ nm: 'Funding (günlük, 8 saatte)', f: (v) => fmt2(v) + '%', x: t, y: fd.f1, color: 'rgba(233,238,248,.3)', w: 1 }, { nm: 'Funding (7 gün ort.)', f: (v) => fmt2(v) + '%', x: t, y: f7, color: beam, w: 1.8 }],
            refs: [{ y: 0, color: 'rgba(233,238,248,.45)', label: '0' }, { y: 0.01, color: 'rgba(233,238,248,.25)', label: 'taban' }], now: { x: t[last], y: cur } },
          legend: [['Funding 7 gün ort.', beam], ['Funding günlük', 'rgba(233,238,248,.5)'], ['BTC fiyatı (altta)', '#fff']] });
      }
    }
    // 1c) Döngü Dip/Tepe Bölgeleri
    { const zc = zoneCard(X.zone, t, ctx.c, ctx, 'BTC'); if (zc) out.push(zc); }

    // 1d) Seviye Değme Olasılığı
    const tm = X.touch;
    if (tm && ctx.showTouch) { // şimdilik herkese kapalı (ctx.showTouch ile açılır)
      const P = (x) => '$' + Math.round(x).toLocaleString('tr-TR'), pc = (v) => '%' + Math.round(v * 100), pct = tm.pct, badge = !Number.isFinite(pct) ? '–' : pct < 25 ? 'Sakin' : pct < 60 ? 'Normal' : pct < 85 ? 'Hareketli' : 'Fırtına';
      const dn = tm.at(2, -10), up = tm.at(2, 10), row = (L) => `${L > 0 ? '+' : '−'}%${Math.abs(L)} (${P(tm.price * (1 + L / 100))}): 7 günde ${pc(tm.at(0, L))}, 14 günde ${pc(tm.at(1, L))}, 30 günde ${pc(tm.at(2, L))}`;
      const calTxt = tm.ms[2].cal.map((x) => `${x.L > 0 ? '+' : '−'}%${Math.abs(x.L)}: tahmin ${pc(x.pred)}, gerçekleşen ${pc(x.real)}`).join('; ');
      out.push({
        id: 'touch', title: 'Seviye Değme Olasılığı', value: '↓' + pc(dn) + ' · ↑' + pc(up), unit: '30G · ±%10 değme', badge, tone: badge === 'Fırtına' ? 'down' : badge === 'Hareketli' ? 'warn' : 'flat',
        info: `Fiyatın önümüzdeki 7, 14 ve 30 gün içinde, bugünkü fiyattan (${P(tm.price)}) belli bir mesafedeki seviyeye HERHANGİ BİR ANDA dokunma olasılığıdır; kapanış değil, mum fitili de sayılır. Yönü söylemez: yukarı ve aşağı seviyeler ayrı ayrı olasılıklandırılır. Yatay eksen mesafe (% olarak), dikey eksen olasılıktır; kesikli çizgi %50. Örnek seviyeler: ${[-20, -10, -5, 5, 10, 20].map(row).join('. ')}. Yöntem: Düşüş Tabanı ile aynı oynaklık tahmini (1/7/30/90 günlük oynaklıktan regresyon, her gün yalnızca o güne kadarki veriyle) ve geçmiş uç hareketlerin dağılımı. Güvenilirlik sınaması (30 günlük ufuk, ${tm.ms[2].cal[0].n} gün, her gün o günkü bilgiyle): ${calTxt}. Ortalama sapma ${Math.round(tm.gapAvg * 100)} puan, en büyük sapma ${Math.round(tm.gap * 100)} puan. Sınama pencereleri örtüştüğü için tek tek seviyelerde birkaç puanlık sapma gürültüdür; uzak seviyelerde olay az olduğundan tahminler daha da gürültülüdür; ani haber şokları ve rejim değişimleri model dışıdır. Bu bir risk haritasıdır, al-sat sinyali değildir.`,
        cfg: { xMin: -40, fmt: (v) => Math.round(v * 100) + '%', xl: (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + '%' + Math.abs(Math.round(x)) + ' · ' + P(tm.price * (1 + x / 100)), fixX: true,
          series: [{ nm: '30 günde', f: (v) => '%' + Math.round(v * 100), x: tm.grid, y: tm.curves[2], color: beam, w: 2 }, { nm: '14 günde', f: (v) => '%' + Math.round(v * 100), x: tm.grid, y: tm.curves[1], color: 'rgba(233,238,248,.75)', w: 1.4 }, { nm: '7 günde', f: (v) => '%' + Math.round(v * 100), x: tm.grid, y: tm.curves[0], color: 'rgba(233,238,248,.4)', w: 1.2 }],
          refs: [{ y: 0.5, color: 'rgba(233,238,248,.3)', label: '50' }, { y: 0.1, color: 'rgba(233,238,248,.2)', label: '10' }], marks: [{ x: 0, color: 'rgba(233,238,248,.45)' }] },
        legend: [['30 günde', beam], ['14 günde', 'rgba(233,238,248,.75)'], ['7 günde', 'rgba(233,238,248,.4)']] });
    }

    if (X.piad) out.push(piAdaptiveCard(X.piad, t, ctx.c, ctx));
    if (X.volad) out.push(volAdaptiveCard(X.volad, t, ctx.c, ctx));

    // 2) Yay Gerilimi (varsayılan kapalı: sentetik sınamada iddiası tutmadı; ctx.showBow ile açılır)
    if (!ctx.showBow) return out;
    const i = N - 1, now = bw.tension[i], s = bw.stats, f = X.funding;
    let bias = bw.trend[i] || 0, fNote = 'Funding verisi alınamadı; yön yalnızca trendden okunur.';
    if (f) { const adj = f.z > 1.5 ? -1 : f.z < -1.5 ? 1 : 0; bias += adj; fNote = `Funding (90 gün ort. %${fmt2(f.avg30)}) kendi tarihine göre ${fmt1(f.z)} σ: ${adj < 0 ? 'uzun pozisyonlar kalabalık, yön eğilimi aşağıya çekildi' : adj > 0 ? 'kısa pozisyonlar kalabalık, yön eğilimi yukarıya çekildi' : 'aşırı bir kalabalıklaşma yok'}.`; }
    const dir = bias >= 2 ? 'Yukarı eğilim' : bias <= -2 ? 'Aşağı eğilim' : 'Yön belirsiz';
    const state = !fin(now) ? 'Veri yok' : now >= 85 ? 'Kopma eşiği' : now >= 60 ? 'Yay geriliyor' : 'Gevşek';
    const tone = !fin(now) || now < 60 ? 'flat' : now < 85 ? 'warn' : bias >= 2 ? 'up' : bias <= -2 ? 'down' : 'warn';
    const pr = bw.parts[i];
    out.push({
      id: 'bow', title: 'Yay Gerilimi', value: fin(now) ? Math.round(now) + '/100' : '–', unit: dir, badge: state, tone,
      info: `Volatilite sıkışması (%40), kısa/uzun ATR oranı (%30), hacim kuruması (%15) ve günlük aralık daralması (%15), her biri son 365 günün yüzdeliğine göre 0-100'e çevrilip birleştirilir. Yüksek değer, piyasanın uzun süredir sıkıştığı ve sonunda genişlemesi beklenen durumdur; yönü söylemez. ${pr ? `Şu an: sıkışma ${Math.round(pr.bbw)}, ATR ${Math.round(pr.atr)}, hacim ${Math.round(pr.vol)}, aralık ${Math.round(pr.rng)}. ` : ''}Geçmişte gerilim 85'i ${s.total} kez yukarı geçti; sonraki ${bw.FW} günde en uzak sapma ortalama %${fmt1(s.avgExc)} oldu (her gün için ortalama %${fmt1(s.baseExc)}). Yön eğiliminin isabeti ${s.hitN ? s.hit + '/' + s.hitN + ' (%' + Math.round((s.hit / s.hitN) * 100) + ')' : 'ölçülemedi'}; örnek küçüktür, bu yüzden bir tahmin değil bir tarihçedir. ${fNote} Yön eğilimi 50 günlük ortalamanın konumu ve eğiminden gelir.`,
      cfg: { xMin, fmt: (v) => Math.round(v), series: [{ x: t, y: bw.tension, color: beam, w: 1.6 }], refs: [{ y: 85, color: bear, label: '85' }, { y: 60, color: 'rgba(233,238,248,.4)', label: '60' }],
        marks: bw.events.map((k) => ({ x: t[k], color: bear })), now: fin(now) ? { x: t[i], y: now } : null },
      legend: [['Gerilim', beam], ['85 aşımı', bear]] });
    return out;
  }

  return { compute, cards, zoneCard, touchMap, piAdaptive, volAdaptive, btcCycles, loadFunding, loadFundingSeries, fundDaily, fundStats, zoneGauge, moonAt, PHASES, stormGauge, dropGauge, moonTest, bowTension };
});
