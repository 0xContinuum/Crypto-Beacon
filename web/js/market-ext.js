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

  function compute(cs) {
    if (!cs || cs.length < 400) return null;
    return { t: cs.map((k) => k.t), moon: moonTest(cs), bow: bowTension(cs), storm: stormGauge(cs), funding: null };
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
  function cards(X, ctx) {
    const { t, xMin, beam, foam, bull, bear } = ctx, out = [], mo = X.moon, bw = X.bow, N = t.length;

    // 0) Fırtına Barometresi
    const sg = X.storm;
    if (sg && Number.isFinite(sg.now) && sg.mult) {
      const st = sg.st, pc = sg.pct, badge = !Number.isFinite(pc) ? '–' : pc < 25 ? 'Sakin' : pc < 60 ? 'Normal' : pc < 85 ? 'Hareketli' : 'Fırtına';
      const tn = badge === 'Fırtına' ? 'down' : badge === 'Hareketli' ? 'warn' : 'flat', P = (m) => '$' + Math.round(sg.price * m).toLocaleString('tr-TR');
      const okSt = st && st.n >= 200;
      out.push({
        id: 'storm', title: 'Fırtına Barometresi', value: '±%' + fmt1(sg.now), unit: sg.H + ' günde, %80 olasılıkla', badge, tone: tn,
        info: `Önümüzdeki ${sg.H} günde BTC'nin ne kadar oynayabileceğini tahmin eder; YÖN SÖYLEMEZ. Oynaklık kümelenir: hareketli dönemi hareketli, sakin dönemi sakin günler izler. Günlük en yüksek/en düşük aralıktan, o güne kadarki veriyle (genişleyen pencere, geleceğe bakmadan) 1, 7, 30 ve 90 günlük oynaklıktan regresyonla öngörülür; bant geçmiş tahmin hatalarının yüzdeliklerinden gelir. Şu anki tahmin: %80 olasılıkla ${P(sg.mult.lo80)} – ${P(sg.mult.hi80)}, %95 olasılıkla ${P(sg.mult.lo95)} – ${P(sg.mult.hi95)} (fiyat ${P(1)}). Son 365 günün %${Math.round(pc || 0)}'inden daha yüksek bir genişlikte. ${okSt ? `Örneklem dışı sınama (${st.n} gün): %80 bant gerçek hareketleri %${Math.round(st.cov80 * 100)}, %95 bant %${Math.round(st.cov95 * 100)} oranında içine aldı (hedef 80/95). Tahmin ile gerçekleşen arasındaki korelasyon ${fmt2(st.corr)}; ortalama oynaklığı varsaymaya göre hata ${Math.round(st.r2vsMean * 100)}%, son 30 günü varsaymaya göre ${Math.round(st.r2vsNaive * 100)}% azaldı. "Hareketli" ucun üçte biri, "sakin" ucun üçte birinden ortalama ${fmt1(st.ratio)} kat büyük hareket yaptı.` : 'Sınama için veri yetersiz.'} Beklenmedik haber şokları bandın dışına taşabilir; bu bir risk büyüklüğü ve pozisyon boyutu aracıdır, al-sat sinyali değildir.`,
        cfg: { xMin, fmt: (v) => '±' + v.toFixed(0) + '%', series: [{ x: t, y: sg.real7.map((v, k) => (Number.isFinite(sg.half80[k]) ? v : NaN)), color: 'rgba(233,238,248,.35)', w: 1 }, { x: t, y: sg.half80, color: beam, w: 1.8 }], now: { x: t[N - 1], y: sg.now } },
        legend: [['Beklenen genişlik (%80)', beam], ['Gerçekleşen 7G hareket', 'rgba(233,238,248,.5)']] });
    }

    // 1) Ay Fazı Sınaması
    const alpha = 0.05 / 2; // iki döngü test edildi: Bonferroni
    const sig = mo.ph.p < alpha, sigAn = mo.an.p < alpha, pTxt = (p) => 'p = ' + fmt2(p);
    const bestBin = mo.ph.means.reduce((b, v, i, a) => (Math.abs(v) > Math.abs(a[b]) ? i : b), 0);
    out.push({
      id: 'moon', title: 'Ay Fazı Sınaması', value: sig ? 'Etki saptandı' : 'Etki yok', unit: pTxt(mo.ph.p), badge: mo.name + ' · %' + Math.round(mo.illum * 100), tone: sig ? 'warn' : 'flat',
      info: `Ay'ın 8 evresinin her birinde BTC'nin sonraki ${mo.H} günlük getirisi ortalaması çizilir (sarı). Kesikli bantlar, evreler rastgele kaydırılsaydı beklenen %95 aralıktır: sarı çizgi bantların içindeyse fark tesadüftür. Sınama ${mo.n} günde, 1.500 karıştırmayla yapıldı. Faz döngüsü: ${pTxt(mo.ph.p)}; Ay'ın yakınlık döngüsü (27,55 gün): ${pTxt(mo.an.p)}. İki döngü sınandığı için eşik 0,025'tir${sig || sigAn ? '; eşiği geçen sonuç bile çoklu sınama ve veri azlığı nedeniyle tek başına işlem gerekçesi sayılmaz' : '; ikisi de eşiği geçmedi, yani bu veride gök döngüsü ile fiyat arasında kanıtlanabilir bir bağ yok'}. En büyük sapma ${PHASES[bestBin]} evresinde (${fmt2(mo.ph.means[bestBin])}%). Evre hesabı ortalama gök elemanlarına dayanır; gün düzeyinde yeterince doğrudur.`,
      cfg: { xMin: 0, fmt: (v) => v.toFixed(1) + '%', xl: (x) => PHASES[Math.round(x * 8) % 8],
        series: [{ x: mo.x, y: mo.hi, color: 'rgba(233,238,248,.45)', w: 1, dash: [4, 4] }, { x: mo.x, y: mo.lo, color: 'rgba(233,238,248,.45)', w: 1, dash: [4, 4] }, { x: mo.x, y: mo.mean, color: beam, w: 2 }],
        refs: [{ y: 0, color: 'rgba(233,238,248,.4)', label: '0' }], now: { x: mo.nowBin / mo.B, y: mo.mean[mo.nowBin] } },
      legend: [['Evreye göre ort. getiri', beam], ['Tesadüf bandı (%95)', 'rgba(233,238,248,.6)']] });

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

  return { compute, cards, loadFunding, moonAt, PHASES, stormGauge, moonTest, bowTension };
});
