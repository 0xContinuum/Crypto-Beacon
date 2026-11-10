/*  Beacon motoru: göstergeler, bileşik skor, tetik kuralları ve geriye dönük test.
 *
 *  Tasarım kuralları
 *  - Her değer yalnızca o muma kadar olan veriden hesaplanır (look-ahead yok). tests/ bunu doğrular.
 *  - Tetikler KAPANMIŞ mumda üretilir, giriş bir sonraki mumun açılışındadır.
 *  - Aynı mumda hem stop hem hedef görülürse stop önce gerçekleşmiş sayılır (muhafazakâr).
 *  - Komisyon ve kayma her iki yön için düşülür.
 *  Bu bir yatırım tavsiyesi değildir; kural tabanlı teknik analiz çıktısıdır.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Beacon = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isNum = Number.isFinite;
  const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
  const nanArr = (n) => new Array(n).fill(NaN);

  /* ——— Zaman dilimleri ve kurallar ——— */
  const TF = {
    '15m': { ms: 900000,   label: '15d', atrMult: 1.5, maxBars: 64, horizon: 'short', api: '15m' },
    '1h':  { ms: 3600000,  label: '1s',  atrMult: 1.6, maxBars: 72, horizon: 'short', api: '1h' },
    '4h':  { ms: 14400000, label: '4s',  atrMult: 1.8, maxBars: 60, horizon: 'long',  api: '4h' },
    '1d':  { ms: 86400000, label: '1G',  atrMult: 2.0, maxBars: 30, horizon: 'long',  api: '1d' },
    '1w':  { ms: 604800000, label: '1H', atrMult: 2.2, maxBars: 20, horizon: 'long',  api: '1w' },
  };
  const P = {
    entry: 40,        // |skor| bu eşiği aşağıdan/yukarıdan keserse tetik
    adxMin: 18,       // trend filtresi
    cooldown: 6,      // iki tetik arası en az mum
    tp1R: 1.5, tp2R: 3,
    warm: 210,        // EMA200 + ek ısınma
    fee: 0.001,       // taraf başına komisyon (spot varsayılanı)
    slip: 0.0005,     // taraf başına kayma
    weights: { T: 0.35, M: 0.25, V: 0.20, K: 0.20 },
    horizon: { short: { '15m': 0.4, '1h': 0.6 }, long: { '4h': 0.30, '1d': 0.40, '1w': 0.30 } },
  };

  /* ——— Göstergeler ——— */
  function firstFinite(a) { for (let i = 0; i < a.length; i++) if (isNum(a[i])) return i; return -1; }

  function sma(a, n) {
    const out = nanArr(a.length), s = firstFinite(a);
    if (s < 0) return out;
    let sum = 0;
    for (let i = s; i < a.length; i++) {
      sum += a[i];
      if (i - s >= n) sum -= a[i - n];
      if (i - s >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function ema(a, n) {
    const out = nanArr(a.length), s = firstFinite(a);
    if (s < 0 || a.length - s < n) return out;
    let sum = 0;
    for (let i = s; i < s + n; i++) sum += a[i];
    let prev = sum / n;
    out[s + n - 1] = prev;
    const k = 2 / (n + 1);
    for (let i = s + n; i < a.length; i++) { prev = a[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }

  function rma(a, n) { // Wilder yumuşatma
    const out = nanArr(a.length), s = firstFinite(a);
    if (s < 0 || a.length - s < n) return out;
    let sum = 0;
    for (let i = s; i < s + n; i++) sum += a[i];
    let prev = sum / n;
    out[s + n - 1] = prev;
    for (let i = s + n; i < a.length; i++) { prev = (prev * (n - 1) + a[i]) / n; out[i] = prev; }
    return out;
  }

  const rsToRsi = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));

  function rsi(c, n = 14) {
    const out = nanArr(c.length);
    if (c.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    out[n] = rsToRsi(g, l);
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
      l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
      out[i] = rsToRsi(g, l);
    }
    return out;
  }

  function trueRange(h, l, c) {
    const tr = new Array(c.length);
    tr[0] = h[0] - l[0];
    for (let i = 1; i < c.length; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    return tr;
  }

  function atr(h, l, c, n = 14) { return rma(trueRange(h, l, c), n); }

  function adx(h, l, c, n = 14) {
    const len = c.length, out = nanArr(len);
    if (len < 2 * n + 1) return out;
    const tr = trueRange(h, l, c), pdm = [0], mdm = [0];
    for (let i = 1; i < len; i++) {
      const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
      pdm[i] = up > dn && up > 0 ? up : 0;
      mdm[i] = dn > up && dn > 0 ? dn : 0;
    }
    let trS = 0, pS = 0, mS = 0;
    for (let i = 1; i <= n; i++) { trS += tr[i]; pS += pdm[i]; mS += mdm[i]; }
    const dx = nanArr(len);
    const calc = (i) => {
      const pdi = 100 * pS / trS, mdi = 100 * mS / trS, s = pdi + mdi;
      dx[i] = s === 0 ? 0 : 100 * Math.abs(pdi - mdi) / s;
    };
    calc(n);
    for (let i = n + 1; i < len; i++) {
      trS = trS - trS / n + tr[i]; pS = pS - pS / n + pdm[i]; mS = mS - mS / n + mdm[i];
      calc(i);
    }
    let sum = 0;
    for (let i = n; i < 2 * n; i++) sum += dx[i];
    let a = sum / n;
    out[2 * n - 1] = a;
    for (let i = 2 * n; i < len; i++) { a = (a * (n - 1) + dx[i]) / n; out[i] = a; }
    return out;
  }

  function macd(c, f = 12, s = 26, sg = 9) {
    const ef = ema(c, f), es = ema(c, s);
    const line = c.map((_, i) => (isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : NaN));
    const sig = ema(line, sg);
    const hist = line.map((x, i) => (isNum(x) && isNum(sig[i]) ? x - sig[i] : NaN));
    return { line, sig, hist };
  }

  function bollinger(c, n = 20, k = 2) {
    const mid = sma(c, n), up = nanArr(c.length), lo = nanArr(c.length), w = nanArr(c.length);
    for (let i = n - 1; i < c.length; i++) {
      let v = 0;
      for (let j = i - n + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / n);
      up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd; w[i] = (up[i] - lo[i]) / mid[i];
    }
    return { mid, up, lo, w };
  }

  function cmf(h, l, c, v, n = 20) {
    const out = nanArr(c.length), mfv = new Array(c.length);
    for (let i = 0; i < c.length; i++) {
      const r = h[i] - l[i];
      mfv[i] = (r === 0 ? 0 : ((c[i] - l[i]) - (h[i] - c[i])) / r) * v[i];
    }
    for (let i = n - 1; i < c.length; i++) {
      let a = 0, b = 0;
      for (let j = i - n + 1; j <= i; j++) { a += mfv[j]; b += v[j]; }
      out[i] = b === 0 ? 0 : a / b;
    }
    return out;
  }

  function rollMax(a, n) { const o = nanArr(a.length); for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) if (a[j] > m) m = a[j]; o[i] = m; } return o; }
  function rollMin(a, n) { const o = nanArr(a.length); for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) if (a[j] < m) m = a[j]; o[i] = m; } return o; }

  function percentRankPast(a, i, win) { // geçmiş `win` değer arasında, i'den küçük olanların oranı (i dahil değil)
    if (i < win || !isNum(a[i])) return NaN;
    let cnt = 0;
    for (let j = i - win; j < i; j++) { if (!isNum(a[j])) return NaN; if (a[j] < a[i]) cnt++; }
    return cnt / win;
  }

  /* ——— Analiz: tüm seriler + Beacon skoru ——— */
  function analyze(candles) {
    const n = candles.length;
    const o = candles.map((x) => x.o), h = candles.map((x) => x.h), l = candles.map((x) => x.l),
      c = candles.map((x) => x.c), v = candles.map((x) => x.v);
    const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
    const rs = rsi(c, 14), at = atr(h, l, c, 14), ad = adx(h, l, c, 14), mc = macd(c), bb = bollinger(c, 20, 2);
    const cm = cmf(h, l, c, v, 20), dHi = rollMax(h, 20), dLo = rollMin(l, 20);
    const score = nanArr(n), T = nanArr(n), M = nanArr(n), V = nanArr(n), K = nanArr(n);
    const regime = nanArr(n), squeeze = new Array(n).fill(false);
    const W = P.weights;

    for (let i = P.warm; i < n; i++) {
      const vals = [e20[i], e50[i], e200[i], e50[i - 10], rs[i], at[i], ad[i], mc.hist[i], cm[i], dHi[i], dLo[i], dHi[i - 1], dLo[i - 1]];
      if (!vals.every(isNum) || !(at[i] > 0)) continue;
      const align = ((c[i] > e20[i] ? 1 : -1) + (e20[i] > e50[i] ? 1 : -1) + (e50[i] > e200[i] ? 1 : -1)) / 3;
      const slope = Math.tanh((e50[i] - e50[i - 10]) / (3 * at[i]));
      T[i] = 0.6 * align + 0.4 * slope;
      M[i] = 0.5 * Math.tanh(mc.hist[i] / (0.25 * at[i])) + 0.5 * clamp((rs[i] - 50) / 25);
      V[i] = clamp(cm[i] * 2.5);
      const pos = dHi[i] > dLo[i] ? (c[i] - dLo[i]) / (dHi[i] - dLo[i]) : 0.5;
      const brk = c[i] > dHi[i - 1] ? 1 : c[i] < dLo[i - 1] ? -1 : 0; // önceki 20 mumun kanalı (şu anki mum hariç)
      K[i] = 0.5 * (pos - 0.5) * 2 + 0.5 * brk;
      score[i] = 100 * clamp(W.T * T[i] + W.M * M[i] + W.V * V[i] + W.K * K[i]);
      regime[i] = ad[i] >= 25 ? 2 : ad[i] >= P.adxMin ? 1 : 0;
      const pr = percentRankPast(bb.w, i, 120);
      squeeze[i] = isNum(pr) && pr <= 0.15;
    }
    return { n, o, h, l, c, v, ema20: e20, ema50: e50, ema200: e200, rsi: rs, atr: at, adx: ad,
      macdHist: mc.hist, bbUp: bb.up, bbMid: bb.mid, bbLo: bb.lo, bbW: bb.w, cmf: cm,
      score, T, M, V, K, regime, squeeze, warm: P.warm };
  }

  /* ——— Tetik kuralları (kapanmış mumda) ——— */
  function findSignals(a, candles) {
    const sigs = [];
    let last = -1e9;
    for (let i = P.warm + 1; i < a.n; i++) {
      const s = a.score[i], p = a.score[i - 1];
      if (!isNum(s) || !isNum(p) || i - last < P.cooldown) continue;
      let side = null;
      if (s >= P.entry && p < P.entry && a.c[i] > a.ema50[i] && a.adx[i] >= P.adxMin) side = 'long';
      else if (s <= -P.entry && p > -P.entry && a.c[i] < a.ema50[i] && a.adx[i] >= P.adxMin) side = 'short';
      if (!side) continue;
      last = i;
      sigs.push({ i, t: candles[i].t, side, score: s, atr: a.atr[i], px: a.c[i], squeeze: a.squeeze[i] });
    }
    return sigs;
  }

  /* ——— Tek işlem simülasyonu ——— */
  function runTrade(candles, sig, tf, opts) {
    const o = Object.assign({ fee: P.fee, slip: P.slip }, opts || {});
    const n = candles.length, cfg = TF[tf], j = sig.i + 1;
    if (j >= n) return { side: sig.side, i: sig.i, status: 'pending', sig };
    const dir = sig.side === 'long' ? 1 : -1;
    const entry = candles[j].o, risk = cfg.atrMult * sig.atr;
    let sl = entry - dir * risk;
    const tp1 = entry + dir * P.tp1R * risk, tp2 = entry + dir * P.tp2R * risk, sl0 = sl;
    let state = 0, gross = 0, rem = 1, exit = null, exitIdx = -1;
    const end = Math.min(n - 1, j + cfg.maxBars);
    for (let k = j; k <= end; k++) {
      const hi = candles[k].h, lo = candles[k].l;
      const hitSL = dir === 1 ? lo <= sl : hi >= sl;
      if (state === 0) {
        if (hitSL) { gross -= rem; exit = 'SL'; exitIdx = k; break; }
        if (dir === 1 ? hi >= tp1 : lo <= tp1) { gross += 0.5 * P.tp1R; rem = 0.5; state = 1; sl = entry; }
      } else {
        if (hitSL) { exit = 'BE'; exitIdx = k; break; }
        if (dir === 1 ? hi >= tp2 : lo <= tp2) { gross += rem * P.tp2R; exit = 'TP2'; exitIdx = k; break; }
      }
      if (k === j + cfg.maxBars) { gross += rem * dir * (candles[k].c - entry) / risk; exit = 'TIME'; exitIdx = k; break; }
    }
    const cost = ((2 * o.fee + 2 * o.slip) * entry) / risk;
    const base = { side: sig.side, i: sig.i, j, t: candles[j].t, entry, sl: sl0, tp1, tp2, risk, sig };
    if (exit) return Object.assign(base, { status: 'closed', exit, exitIdx, tExit: candles[exitIdx].t, bars: exitIdx - j + 1, R: gross - cost, gross });
    const lastC = candles[n - 1].c;
    return Object.assign(base, { status: state ? 'open_be' : 'open', exit: null, exitIdx: n - 1, bars: n - j,
      R: gross + rem * dir * (lastC - entry) / risk, gross, px: lastC, slNow: sl });
  }

  /* ——— Geriye dönük test ——— */
  function simulate(candles, signals, tf, opts) {
    const trades = [];
    let lastExit = -1;
    for (const s of signals) {
      if (s.i < lastExit) continue; // aynı anda tek pozisyon
      const t = runTrade(candles, s, tf, opts);
      if (t.status === 'pending') continue;
      trades.push(t);
      lastExit = t.exitIdx;
    }
    return { trades, stats: stats(trades, candles) };
  }

  function stats(trades, candles) {
    const closed = trades.filter((t) => t.status === 'closed');
    const n = closed.length;
    const rs = closed.map((t) => t.R);
    const win = rs.filter((r) => r > 0), loss = rs.filter((r) => r <= 0);
    const sumWin = win.reduce((a, b) => a + b, 0), sumLoss = -loss.reduce((a, b) => a + b, 0);
    let cum = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
    const equity = [{ i: closed.length ? closed[0].j : 0, R: 0 }];
    for (const t of closed) {
      cum += t.R; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum);
      streak = t.R > 0 ? 0 : streak + 1; maxStreak = Math.max(maxStreak, streak);
      equity.push({ i: t.exitIdx, R: cum });
    }
    const usable = Math.max(1, candles.length - P.warm);
    const held = closed.reduce((a, t) => a + t.bars, 0);
    const first = candles[P.warm], lastC = candles[candles.length - 1];
    return {
      n, wins: win.length, winRate: n ? win.length / n : NaN, avgR: n ? cum / n : NaN, sumR: cum,
      profitFactor: n ? (sumLoss === 0 ? (sumWin > 0 ? Infinity : 0) : sumWin / sumLoss) : NaN,
      maxDD: dd, maxLossStreak: maxStreak, exposure: held / usable,
      buyHold: first && lastC ? lastC.c / first.c - 1 : NaN, equity,
      byExit: closed.reduce((m, t) => { m[t.exit] = (m[t.exit] || 0) + 1; return m; }, {}),
    };
  }

  /* ——— Yardımcılar (arayüz için) ——— */
  function horizonScore(scores, horizon) { // scores: {tf: skor}
    const w = P.horizon[horizon];
    let a = 0, b = 0;
    for (const k in w) if (isNum(scores[k])) { a += w[k] * scores[k]; b += w[k]; }
    return b ? a / b : NaN;
  }

  function verdict(s) {
    if (!isNum(s)) return { key: 'na', text: 'Hesaplanıyor' };
    if (s >= 60) return { key: 'bull2', text: 'Güçlü yükseliş eğilimi' };
    if (s >= 25) return { key: 'bull1', text: 'Yükseliş eğilimi' };
    if (s > -25) return { key: 'flat', text: 'Kararsız, yatay' };
    if (s > -60) return { key: 'bear1', text: 'Düşüş eğilimi' };
    return { key: 'bear2', text: 'Güçlü düşüş eğilimi' };
  }

  function summary(candles) { // kapanmış mumlar üzerinde son durum
    const a = analyze(candles), i = a.n - 1;
    const sigs = findSignals(a, candles);
    return { a, i, score: a.score[i], parts: { T: a.T[i], M: a.M[i], V: a.V[i], K: a.K[i] },
      regime: a.regime[i], squeeze: a.squeeze[i], rsi: a.rsi[i], adx: a.adx[i], atr: a.atr[i], signals: sigs };
  }

  return { TF, P, indicators: { sma, ema, rma, rsi, atr, adx, macd, bollinger, cmf, rollMax, rollMin, trueRange, percentRankPast },
    analyze, findSignals, runTrade, simulate, stats, horizonScore, verdict, summary };
});
