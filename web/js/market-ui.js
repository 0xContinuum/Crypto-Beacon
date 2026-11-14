/*  Piyasa ekranı: kartlar ve küçük grafikler (BeaconMarket hesaplarını gösterir). */
(function () {
  'use strict';
  const M = window.BeaconMarket, D = window.BeaconData; if (!M || !D) return;
  const $ = (id) => document.getElementById(id), BX = () => window.__beacon;
  const fmtUsd = (v) => (v >= 1000 ? Math.round(v).toLocaleString('tr-TR') : v.toLocaleString('tr-TR', { maximumFractionDigits: 2 }));
  const fmtX = (v) => (Number.isFinite(v) ? v.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + '×' : '–');
  const dstr = (t) => new Date(t).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' });
  const ds = (t) => new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let zoneCoin = 'BTC', ZC = {}, zoneBusy = false, cvdd = undefined; let R = null, range = 'all', loading = false, failed = false, lastCards = [], fullId = '';
  const FREE = new Set(['pi', 'mayer']);
  const css = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

  /* ——— küçük çizgi grafik ——— */
  function mini(cv, cfg, big, hov) {
    cv._m = { cfg, big };
    const FS = big ? 1.35 : 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const font = css('--font', 'Inter, system-ui, sans-serif'), fog = css('--fog', '#7e8ba6'), grid = css('--grid', '#121b2e');
    const axisW = 52 * FS, padB = 18 * FS, pw = W - axisW, phAll = H - padB, under = cfg.under && cfg.under.x && cfg.under.x.length, ph = under ? Math.round((phAll - 8) * 0.6) : phAll, log = cfg.log;
    let x0 = Infinity, x1 = -Infinity, lo = Infinity, hi = -Infinity;
    const inR = (x) => x >= cfg.xMin;
    for (const s of cfg.series) for (let i = 0; i < s.x.length; i++) { if (!inR(s.x[i])) continue; if (s.x[i] < x0) x0 = s.x[i]; if (s.x[i] > x1) x1 = s.x[i]; }
    for (const s of cfg.series) { if (s.noScale) continue; for (let i = 0; i < s.x.length; i++) { const v = s.y[i]; if (!inR(s.x[i]) || !Number.isFinite(v) || (log && v <= 0)) continue; if (v < lo) lo = v; if (v > hi) hi = v; } }
    for (const r of cfg.refs || []) { if (r.y < lo) lo = r.y; if (r.y > hi) hi = r.y; }
    if (!(hi > lo)) { lo = 0; hi = 1; }
    const T = log ? Math.log : (v) => v, a = T(lo), b = T(hi), sp = (b - a) * 0.06;
    const X = (x) => ((x - x0) / (x1 - x0 || 1)) * (pw - 4) + 2, Y = (v) => 4 + (1 - (T(Math.max(v, log ? 1e-9 : -1e18)) - (a - sp)) / (b - a + 2 * sp)) * (ph - 8);
    c.clearRect(0, 0, W, H); c.font = `500 ${10 * FS}px ${font}`; c.textBaseline = 'middle'; c.textAlign = 'right';
    // ızgara
    const ticks = []; if (log) { for (let p = Math.pow(10, Math.floor(Math.log10(lo))); p <= hi * 1.01; p *= 10) for (const m of [1, 2, 5]) if (p * m >= lo && p * m <= hi) ticks.push(p * m); } else { const st = (hi - lo) / 4; for (let k = 0; k <= 4; k++) ticks.push(lo + st * k); }
    for (const v of ticks.slice(0, 7)) { const y = Math.round(Y(v)) + 0.5; c.strokeStyle = grid; c.beginPath(); c.moveTo(0, y); c.lineTo(pw, y); c.stroke(); c.fillStyle = fog; c.fillText(cfg.fmt ? cfg.fmt(v) : fmtUsd(v), W - 4, y); }
    for (const z of cfg.zones || []) { if (z.x1 < x0 || z.x0 > x1) continue; const xa = Math.max(0, X(Math.max(z.x0, x0))), xb = Math.min(pw, X(Math.min(z.x1, x1))); c.fillStyle = z.color; c.fillRect(xa, 0, Math.max(1.5, xb - xa), ph); }
    // bantlar
    if (cfg.bands) {
      const B = cfg.bands, colors = cfg.bandColors, idx = []; for (let i = 0; i < cfg.bandX.length; i++) if (inR(cfg.bandX[i])) idx.push(i);
      const edge = (k, i) => (k < 0 ? lo / 4 : k >= B.length ? hi * 4 : B[k][i]);
      for (let k = -1; k < B.length; k++) {
        c.beginPath();
        idx.forEach((i, n) => { const x = X(cfg.bandX[i]), y = Y(edge(k + 1, i)); n ? c.lineTo(x, y) : c.moveTo(x, y); });
        for (let n = idx.length - 1; n >= 0; n--) c.lineTo(X(cfg.bandX[idx[n]]), Y(edge(k, idx[n])));
        c.closePath(); c.fillStyle = colors[Math.min(k + 1, colors.length - 1)] + '38'; c.fill();
      }
    }
    for (const r of cfg.refs || []) { const y = Math.round(Y(r.y)) + 0.5; c.strokeStyle = r.color; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, y); c.lineTo(pw, y); c.stroke(); c.setLineDash([]); c.fillStyle = r.color; c.textAlign = 'left'; c.fillText(r.label, 4, y - 7); c.textAlign = 'right'; }
    for (const m of cfg.marks || []) { if (!inR(m.x)) continue; const x = Math.round(X(m.x)) + 0.5; c.strokeStyle = m.color; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, phAll); c.stroke(); c.setLineDash([]); }
    for (const s of cfg.series) {
      c.beginPath(); let st = false;
      for (let i = 0; i < s.x.length; i++) { const v = s.y[i]; if (!inR(s.x[i]) || !Number.isFinite(v) || (log && v <= 0)) { st = false; continue; } const x = X(s.x[i]), y = Y(v); st ? c.lineTo(x, y) : c.moveTo(x, y); st = true; }
      c.strokeStyle = s.color; c.lineWidth = s.w || 1.5; c.setLineDash(s.dash || []); c.stroke(); c.setLineDash([]);
    }
    if (cfg.now) { const x = X(cfg.now.x), y = Y(cfg.now.y); c.fillStyle = css('--beam', '#ffc25c'); c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); }
    let Y2 = null;
    if (under) { // altta ikinci panel (varsayılan: BTC fiyatı, log), aynı tarih ekseni
      const u = cfg.under, t0 = ph + 8, t1 = phAll, lg = u.log !== false, tf = lg ? Math.log : (v) => v; let l2 = Infinity, h2 = -Infinity;
      for (let i = 0; i < u.x.length; i++) if (inR(u.x[i]) && Number.isFinite(u.y[i]) && (!lg || u.y[i] > 0)) { const v = tf(u.y[i]); if (v < l2) l2 = v; if (v > h2) h2 = v; }
      if (Number.isFinite(u.lo)) l2 = tf(u.lo); if (Number.isFinite(u.hi)) h2 = tf(u.hi);
      const sp2 = (h2 - l2) * 0.06 || 1; Y2 = (v) => t0 + 2 + (1 - (tf(Math.max(v, lg ? 1e-9 : -1e18)) - (l2 - sp2)) / (h2 - l2 + 2 * sp2)) * (t1 - t0 - 4);
      c.strokeStyle = css('--rule', '#1a2438'); c.beginPath(); c.moveTo(0, t0 - 4.5); c.lineTo(W, t0 - 4.5); c.stroke();
      for (const r of u.refs || []) { const y = Math.round(Y2(r.y)) + 0.5; c.strokeStyle = r.color; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, y); c.lineTo(pw, y); c.stroke(); c.setLineDash([]); }
      c.beginPath(); let st = false; for (let i = 0; i < u.x.length; i++) { if (!inR(u.x[i]) || !Number.isFinite(u.y[i]) || (lg && !(u.y[i] > 0))) { st = false; continue; } const x = X(u.x[i]), y = Y2(u.y[i]); st ? c.lineTo(x, y) : c.moveTo(x, y); st = true; }
      c.strokeStyle = u.color || 'rgba(233,238,248,.85)'; c.lineWidth = 1.2; c.stroke();
      const uf = u.fmt || fmtUsd; c.fillStyle = fog; c.textAlign = 'right'; c.textBaseline = 'middle'; for (const v of [lg ? Math.exp(h2) : h2, lg ? Math.exp(l2) : l2]) c.fillText(uf(v), W - 4, Y2(v));
      c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(u.nm || 'BTC fiyatı', 4, t0 + 1);
    }
    if (hov != null && hov >= 0 && hov <= pw) { // imleç: o günün değerleri
      const xv = x0 + ((hov - 2) / (pw - 4)) * (x1 - x0), near = (xs) => { let lo2 = 0, hi2 = xs.length - 1; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (xs[m] < xv) lo2 = m + 1; else hi2 = m; } return lo2 > 0 && Math.abs(xs[lo2 - 1] - xv) < Math.abs(xs[lo2] - xv) ? lo2 - 1 : lo2; };
      const lines = []; let tx = null;
      for (const sr of cfg.series) { if (!sr.nm || sr.noTip) continue; const k = near(sr.x), v = sr.y[k]; if (!Number.isFinite(v)) continue; tx = tx == null ? sr.x[k] : tx; const xx = X(sr.x[k]), yy = Y(v); c.fillStyle = sr.color; c.beginPath(); c.arc(xx, yy, 3, 0, 7); c.fill(); lines.push([sr.nm, sr.f ? sr.f(v) : fmtUsd(v), sr.color]); }
      if (cfg.under) { const k = near(cfg.under.x); if (tx == null) tx = cfg.under.x[k]; if (Y2) { c.fillStyle = '#fff'; c.beginPath(); c.arc(X(cfg.under.x[k]), Y2(cfg.under.y[k]), 3, 0, 7); c.fill(); } lines.push([cfg.under.nm || 'BTC', cfg.under.tip ? cfg.under.tip(cfg.under.y[k]) : '$' + fmtUsd(cfg.under.y[k]), cfg.under.color || '#fff']); }
      if (tx != null) {
        const hx = Math.round(X(tx)) + 0.5; c.strokeStyle = 'rgba(233,238,248,.45)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(hx, 0); c.lineTo(hx, phAll); c.stroke(); c.setLineDash([]);
        const f2 = 10.5 * FS, lh = 14 * FS, title = cfg.xl ? cfg.xl(tx) : ds(tx); c.font = `600 ${f2}px ${font}`; let bw = c.measureText(title).width; for (const [n, v] of lines) bw = Math.max(bw, c.measureText(n + ': ' + v).width); bw += 14;
        const bh = (lines.length + 1) * lh + 8, bx = hx > pw / 2 ? hx - bw - 8 : hx + 8, by = 4; c.fillStyle = 'rgba(6,10,18,.92)'; c.strokeStyle = 'rgba(233,238,248,.25)'; c.beginPath(); c.roundRect ? c.roundRect(bx, by, bw, bh, 6) : c.rect(bx, by, bw, bh); c.fill(); c.stroke();
        c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = '#e9eef8'; c.fillText(title, bx + 7, by + 5); let yy = by + 5 + lh;
        for (const [n, v, col] of lines) { c.fillStyle = col; c.fillText(n + ': ' + v, bx + 7, yy); yy += lh; }
      }
    }
    c.textBaseline = 'top'; c.fillStyle = fog; c.textAlign = 'left'; c.font = `500 ${10 * FS}px ${font}`; c.fillText(cfg.xl ? cfg.xl(x0) : dstr(x0), 2, phAll + 5); c.textAlign = 'right'; c.fillText(cfg.xl ? cfg.xl(x1) : dstr(x1), pw, phAll + 5);
  }
  function hoverable(cv) { // fare/dokunma ile gün seçimi
    if (cv._hv) return; cv._hv = 1;
    const go = (e) => { const r = cv.getBoundingClientRect(); if (cv._m) mini(cv, cv._m.cfg, cv._m.big, e.clientX - r.left); };
    cv.addEventListener('pointermove', go); cv.addEventListener('pointerdown', go);
    cv.addEventListener('pointerleave', () => { if (cv._m) mini(cv, cv._m.cfg, cv._m.big, null); });
    cv.style.touchAction = 'pan-y';
  }

  /* ——— kart tanımları ——— */
  function cards(r) {
    const t = r.t, c = r.c, tMax = r.asOf, yrs = range === '1y' ? 1 : range === '4y' ? 4 : 99, xMin = tMax - yrs * 365.25 * 864e5, beam = css('--beam', '#ffc25c'), foam = 'rgba(233,238,248,.85)', bull = css('--bull', '#35d6a0'), bear = css('--bear', '#ff6384');
    const price = { nm: 'BTC', f: (v) => '$' + fmtUsd(v), x: t, y: c, color: foam, w: 1.3 }, nowAt = (arr) => ({ x: t[t.length - 1], y: arr[arr.length - 1] });
    const tone = (ok, warn) => (ok ? 'down' : warn ? 'warn' : 'up');
    return [
      { id: 'pi', title: 'Pi Cycle Top', value: r.pi.now.toFixed(2), unit: 'oran', badge: r.pi.state, tone: tone(r.pi.state === 'Tetiklendi', r.pi.state === 'Yaklaştı'),
        info: `111 günlük ortalamanın, 350 günlük ortalamanın 2 katına oranı. Oran 1'e ulaştığında (111G, 2×350G'yi yukarı keser) Bitcoin'in geçmiş iki büyük döngü tepesine denk gelmiştir (2017 ve 2021). Veri örneği az olduğu için kesin bir sinyal değildir. Son kesişim: ${r.pi.crosses.length ? ds(r.pi.crosses[r.pi.crosses.length - 1]) : 'bu veride yok'}.`,
        cfg: { log: true, xMin, series: [price, { nm: '111G ort.', f: (v) => '$' + fmtUsd(v), x: t, y: r.pi.s111, color: beam, w: 1.5 }, { nm: '2×350G ort.', f: (v) => '$' + fmtUsd(v), x: t, y: r.pi.pi2, color: bear, w: 1.5, dash: [5, 4] }], marks: r.pi.crosses.map((x) => ({ x, color: bear })) }, legend: [['Fiyat', foam], ['111G', beam], ['2×350G', bear]] },
      { id: 'mayer', title: 'Mayer Çarpanı', value: fmtX(r.mayer.now), unit: '', badge: r.mayer.state, tone: tone(r.mayer.state === 'Aşırı' || r.mayer.state === 'Yüksek', false),
        info: `Fiyatın 200 günlük ortalamaya oranı. Tarihsel ortalama bu veride ${fmtX(r.mayer.avg)}. 2,4 üstü geçmişte aşırı ısınma, 0,8 altı ise derin düşüş dönemlerinde görülmüştür; eşikler yalnızca tarihsel referanstır.`,
        cfg: { xMin, fmt: (v) => v.toFixed(1), series: [{ nm: 'Fiyat / 200G', f: (v) => fmtX(v), x: t, y: r.mayer.ratio, color: beam, w: 1.6 }], refs: [{ y: 0.8, color: bull, label: '0,8' }, { y: 1, color: 'rgba(233,238,248,.4)', label: '1' }, { y: 2.4, color: bear, label: '2,4' }], now: nowAt(r.mayer.ratio) }, legend: [['Fiyat / 200G', beam]] },
      { id: 'w200', title: '200 Hafta Ortalama', value: r.w200.available ? fmtX(r.w200.now) : 'veri yok', unit: r.w200.available ? '$' + fmtUsd(r.w200.maNow) : '', badge: r.w200.available ? r.w200.state : 'Yetersiz geçmiş', tone: tone(r.w200.now > 3, r.w200.now >= 1.5),
        info: 'Fiyatın 200 haftalık (1400 günlük) ortalamaya oranı. Bitcoin geçmişte çoğu zaman bu ortalamanın üzerinde kalmış, ayı piyasası diplerinde ona yaklaşmış ya da kısa süre altına inmiştir. Ortalama, borsa verisinin başladığı 2017\'den itibaren hesaplanabildiği için çizgi 2021 civarında başlar.',
        cfg: { log: true, xMin, series: [price, { nm: '200 hafta ort.', f: (v) => '$' + fmtUsd(v), x: t, y: r.w200.ma, color: beam, w: 1.8 }] }, legend: [['Fiyat', foam], ['200 hafta ort.', beam]] },
      { id: 'ma2y', title: '2 Yıllık Ortalama Çarpanı', value: r.ma2y.available ? fmtX(r.ma2y.now) : 'veri yok', unit: '', badge: r.ma2y.available ? r.ma2y.state : 'Yetersiz geçmiş', tone: tone(r.ma2y.now >= 5, r.ma2y.now >= 3),
        info: 'Fiyat, 730 günlük ortalama ve onun 5 katı. Fiyat alt çizginin altındayken tarihsel olarak uzun vadeli düşük bölge, 5× çizgisine yaklaşırken aşırı ısınma görülmüştür. Geçmiş döngüler gelecekte aynen tekrar etmeyebilir.',
        cfg: { log: true, xMin, series: [price, { nm: '2Y ort.', f: (v) => '$' + fmtUsd(v), x: t, y: r.ma2y.ma, color: bull, w: 1.5 }, { nm: '2Y ort. ×5', f: (v) => '$' + fmtUsd(v), x: t, y: r.ma2y.x5, color: bear, w: 1.5 }] }, legend: [['Fiyat', foam], ['2Y ort.', bull], ['2Y ort. ×5', bear]] },
      { id: 'rainbow', title: 'Regresyon Bantları', value: r.rainbow.name, unit: (r.rainbow.now >= 0 ? '+' : '−') + Math.abs(r.rainbow.now).toFixed(2) + ' σ', badge: r.rainbow.name, tone: tone(r.rainbow.idx >= 6, r.rainbow.idx >= 5),
        info: 'Beacon kendi uyumunu kullanır: fiyatın logaritması, Bitcoin\'in doğumundan beri geçen günün logaritmasına doğrusal olarak uydurulur; bantlar bu çizginin ±σ katlarıdır. Başka sitelerdeki "gökkuşağı" çizelgelerinden farklıdır, yalnızca 2017 sonrası veriyle hesaplanır ve gelecek için tahmin değildir.',
        cfg: { log: true, xMin, series: [{ nm: 'BTC', f: (v) => '$' + fmtUsd(v), x: t, y: c, color: '#ffffff', w: 1.4 }], bands: r.rainbow.bands, bandX: t, bandColors: r.rainbow.colors, now: nowAt(c) }, legend: r.rainbow.names.map((n, i) => [n, r.rainbow.colors[i]]).filter((_, i) => i % 2 === 0) },
      (() => {
        const h = r.halving, cyc = h.cycles, col = ['rgba(233,238,248,.55)', beam];
        const series = cyc.map((cy, i) => ({ nm: new Date(cy.start).getFullYear() + ' döngüsü', f: (v) => fmtX(v), x: cy.vals.map((_, k) => k), y: cy.vals, color: col[i % 2], w: i === cyc.length - 1 ? 2 : 1.3, dash: i === cyc.length - 1 ? null : [5, 4] }));
        return { id: 'halving', title: 'Halving Döngüsü', value: h.daysSince + '. gün', unit: 'ATH\'den ' + (h.drawdown * 100).toFixed(1).replace('.', ',') + '%', badge: h.state, tone: tone(false, h.drawdown > -0.1),
          info: `Son halving 20 Nisan 2024. Çizgiler, halving gününün fiyatına göre çarpan olarak gösterilir: soluk çizgi önceki (2020) döngü, sarı çizgi bugünkü döngü. Şu an halving fiyatının ${fmtX(h.multiple)} seviyesinde. ATH ${h.athDays} gün önce görüldü ($${fmtUsd(h.ath)}). Sonraki halving tahmini 2028 baharı (${h.daysToNext} gün). Döngüler tekrar etmek zorunda değildir.`,
          cfg: { log: true, xMin: 0, xl: (x) => Math.round(x) + '. gün', fmt: (v) => v.toFixed(v < 10 ? 1 : 0) + '×', series, now: series.length ? { x: series[series.length - 1].x.length - 1, y: series[series.length - 1].y[series[series.length - 1].y.length - 1] } : null }, legend: cyc.map((cy, i) => [new Date(cy.start).getFullYear() + ' döngüsü', col[i % 2]]) };
      })(),
      ...extraCards(r, { t, c, xMin, beam, foam, bull, bear }),
    ];
  }

  const COINS4 = ['BTC', 'ETH', 'XRP', 'SOL'];
  function extraCards(r, ctx) {
    const X = window.BeaconMarketX; if (!(r.x && X)) return [];
    const out = X.cards(r.x, ctx).filter((k) => k.id !== 'zone'), at = out.findIndex((k) => k.id === 'drop' ? false : false);
    let zc = null;
    if (zoneCoin === 'BTC') zc = X.zoneCard(r.x.zone, ctx.t, ctx.c, ctx, 'BTC');
    else if (ZC[zoneCoin]) zc = X.zoneCard(ZC[zoneCoin].zg, ZC[zoneCoin].t, ZC[zoneCoin].c, ctx, zoneCoin);
    if (!zc) zc = { id: 'zone', title: 'Döngü Dip/Tepe Bölgeleri · ' + zoneCoin, value: '…', unit: 'yükleniyor', badge: 'Yükleniyor', tone: 'flat', info: 'Veri indiriliyor.', cfg: { xMin: ctx.xMin, log: true, series: [{ nm: 'BTC', x: ctx.t, y: ctx.c, color: 'rgba(233,238,248,.3)', w: 1 }] }, legend: [] };
    zc.coinBar = true; const k0 = out.findIndex((k) => k.id === 'drop'); out.splice(k0 >= 0 ? k0 + 1 : out.length, 0, zc);
    if (cvdd !== undefined) {
      let cc = null; if (cvdd && cvdd.rows) { if (!cvdd.g) cvdd.g = X.cvddGauge(r.cs, cvdd.rows); cc = X.cvddCard(cvdd.g, ctx.t, ctx.c, ctx, r.x.zone && r.x.zone.cycles); }
      out.push(cc || { id: 'cvdd', title: 'CVDD · Zincir Üstü Dip/Tepe', value: '–', unit: 'veri alınamadı', badge: 'Veri yok', tone: 'flat', info: 'CVDD için zincir üstü veri (Coin Metrics topluluk verisi) bu ağdan alınamadı. Bağlantınızı kontrol edip sayfayı yenileyin; bazı ağlar bu adresi engelleyebilir.', cfg: { xMin: ctx.xMin, log: true, series: [{ nm: 'BTC', f: (v) => '$' + fmtUsd(v), x: ctx.t, y: ctx.c, color: 'rgba(233,238,248,.3)', w: 1 }] }, legend: [] });
    }
    return out;
  }
  async function loadZoneCoin(coin) {
    if (ZC[coin] || zoneBusy) return; zoneBusy = true; render();
    try { const cs = await D.loadLong(coin, '1d', 5), X = window.BeaconMarketX, zg = X.zoneGauge(cs); ZC[coin] = { zg, t: cs.map((k) => k.t), c: cs.map((k) => k.c) }; }
    catch (e) { BX().toast && BX().toast(coin + ' verisine ulaşılamadı'); zoneCoin = 'BTC'; }
    zoneBusy = false; render(); if (fullId) drawFull();
  }
  function render() {
    const box = $('mkBox'); if (!box) return;
    if (loading && !R) { box.innerHTML = '<div class="skelcard"></div><div class="skelcard"></div><div class="skelcard"></div>'; return; }
    if (failed && !R) { box.innerHTML = '<div class="empty"><b>Veri alınamadı</b><p class="note">Borsa verisine ulaşılamadı.</p><button class="cta ghost" id="mkRetry" style="max-width:220px;margin:12px auto 0">Tekrar dene</button></div>'; return; }
    if (!R) return;
    const pro = BX().isPro(), cs = cards(R); lastCards = cs;
    const coinBar = () => `<div class="zcoins" role="group" aria-label="Coin seç">${COINS4.map((x) => `<button type="button" data-zcoin="${x}" aria-pressed="${x === zoneCoin}">${x}</button>`).join('')}</div>`;
    box.innerHTML = `<p class="note pad">Bitcoin'in günlük fiyatından hesaplanan döngü göstergeleri, funding ve CVDD (zincir üstü, Coin Metrics topluluk verisi). Son veri: ${ds(R.asOf)}. MVRV, NUPL gibi diğer zincir üstü ölçüler dahil değildir.</p>` +
      cs.map((k) => { const lock = !pro && !FREE.has(k.id); return `<article class="mk ${lock ? 'locked' : ''}" data-id="${k.id}" ${lock ? '' : 'tabindex="0" role="button" aria-label="' + k.title + ' grafiğini tam ekran aç"'}><header><h3>${k.title}${FREE.has(k.id) ? '' : ' <span class="pill">Pro</span>'}</h3><span class="badge ${lock ? 'flat' : k.tone}">${lock ? 'Kilitli' : esc(k.badge)}</span></header>${k.coinBar && !lock ? coinBar() : ''}
        <div class="mkv"><b class="num">${lock ? '••••' : esc(k.value)}</b><span class="dim">${lock ? '' : esc(k.unit)}</span></div>
        <div class="mkc"><canvas aria-label="${k.title} grafiği"></canvas>${lock ? '<button class="cta unlock" data-unlock>Pro ile aç</button>' : ''}</div>
        <div class="lg">${k.legend.map(([n, c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join('')}</div>
        <p class="note">${lock ? 'Bu gösterge Pro ile açılır. Reklam izleyerek Pro kazanabilirsiniz.' : esc(k.info)}</p></article>`; }).join('') +
      '<p class="note pad">Bu göstergeler eğitim amaçlıdır; yatırım tavsiyesi değildir. Geçmiş davranış gelecekte tekrar etmeyebilir.</p>';
    requestAnimationFrame(() => cs.forEach((k) => { const cv = box.querySelector(`[data-id="${k.id}"] canvas`); if (cv) { mini(cv, k.cfg); hoverable(cv); } }));
  }

  async function load() {
    if (loading) return; loading = true; failed = false; render();
    try {
      const cs = await D.loadLong('BTC', '1d', 5); R = M.compute(cs); if (!R) throw new Error('veri az');
      R.cs = cs; if (cvdd === undefined && window.BeaconMarketX && window.BeaconMarketX.loadCvddData) window.BeaconMarketX.loadCvddData().then((rows) => { cvdd = rows ? { rows } : null; render(); if (fullId) drawFull(); }).catch(() => { cvdd = null; render(); });
      try { R.x = window.BeaconMarketX ? window.BeaconMarketX.compute(cs) : null; } catch (e) { R.x = null; }
      if (R.x && window.BeaconMarketX.loadFundingSeries) window.BeaconMarketX.loadFundingSeries().then((fs) => { if (R && R.x && fs) { R.x.fund = fs; render(); if (fullId) drawFull(); } });
      if (R.x) window.BeaconMarketX.loadFunding().then((f) => { if (R && R.x) { R.x.funding = f; render(); if (fullId) drawFull(); } }); // funding gelirse yön eğilimi güncellenir
    }
    catch (e) { failed = true; }
    loading = false; render();
  }

  /* ——— tam ekran gösterge ——— */
  function drawFull() {
    const k = lastCards.find((x) => x.id === fullId); if (!k) return;
    $('mfTitle').textContent = k.title; $('mfVal').textContent = k.value + (k.unit ? '  ' + k.unit : ''); $('mfBadge').textContent = k.badge; $('mfBadge').className = 'badge ' + k.tone;
    $('mfInfo').textContent = k.info; $('mfLegend').innerHTML = k.legend.map(([n, c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join('');
    $('mfRange').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === range));
    requestAnimationFrame(() => { mini($('mfCv'), k.cfg, true); hoverable($('mfCv')); $('mfCv').style.touchAction = 'none'; });
  }
  function openFull(id) { fullId = id; $('mkFull').classList.add('on'); document.body.classList.add('fsmode'); drawFull(); }
  function closeFull() { fullId = ''; $('mkFull').classList.remove('on'); document.body.classList.remove('fsmode'); }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fullId && !document.querySelector('.scrim.on')) closeFull(); });
  window.addEventListener('resize', () => { if (fullId) drawFull(); });
  document.addEventListener('click', (e) => {
    const card = e.target.closest('#mkBox .mk:not(.locked)');
    if (card && !e.target.closest('button, a')) openFull(card.dataset.id);
    if (e.target.closest('#mfClose')) closeFull();
    const fr = e.target.closest('#mfRange [data-r]');
    if (fr) { range = fr.dataset.r; $('mkRange').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === range)); render(); drawFull(); }
    if (e.target.closest('#mfShare')) { const k = lastCards.find((x) => x.id === fullId); if (k) BX().shareImage($('mfCv'), 'BTC · ' + k.title, k.value + (k.unit ? ' ' + k.unit : '') + ' · ' + k.badge, 'beacon-' + k.id); }
    const zb = e.target.closest('[data-zcoin]'); if (zb) { e.stopPropagation(); zoneCoin = zb.dataset.zcoin; if (zoneCoin !== 'BTC' && !ZC[zoneCoin]) loadZoneCoin(zoneCoin); else render(); return; }
    if (e.target.closest('#mkRetry')) load();
    if (e.target.closest('[data-unlock]')) BX().go('pro');
    const r = e.target.closest('#mkRange [data-r]');
    if (r) { range = r.dataset.r; $('mkRange').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === r)); render(); }
  });
  window.addEventListener('resize', () => { if (R && document.getElementById('v-market').classList.contains('on')) render(); });
  window.BeaconMarketUI = { onView() { if (R) render(); else load(); }, _state: () => R };
})();
