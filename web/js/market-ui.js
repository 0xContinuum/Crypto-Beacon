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
  let R = null, range = 'all', loading = false, failed = false, lastCards = [], fullId = '';
  const FREE = new Set(['pi', 'mayer']);
  const css = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

  /* ——— küçük çizgi grafik ——— */
  function mini(cv, cfg, big) {
    const FS = big ? 1.35 : 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const font = css('--font', 'Inter, system-ui, sans-serif'), fog = css('--fog', '#7e8ba6'), grid = css('--grid', '#121b2e');
    const axisW = 52 * FS, padB = 18 * FS, pw = W - axisW, ph = H - padB, log = cfg.log;
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
    for (const m of cfg.marks || []) { if (!inR(m.x)) continue; const x = Math.round(X(m.x)) + 0.5; c.strokeStyle = m.color; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, ph); c.stroke(); c.setLineDash([]); }
    for (const s of cfg.series) {
      c.beginPath(); let st = false;
      for (let i = 0; i < s.x.length; i++) { const v = s.y[i]; if (!inR(s.x[i]) || !Number.isFinite(v) || (log && v <= 0)) { st = false; continue; } const x = X(s.x[i]), y = Y(v); st ? c.lineTo(x, y) : c.moveTo(x, y); st = true; }
      c.strokeStyle = s.color; c.lineWidth = s.w || 1.5; c.setLineDash(s.dash || []); c.stroke(); c.setLineDash([]);
    }
    if (cfg.now) { const x = X(cfg.now.x), y = Y(cfg.now.y); c.fillStyle = css('--beam', '#ffc25c'); c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); }
    c.textBaseline = 'top'; c.fillStyle = fog; c.textAlign = 'left'; c.fillText(cfg.xl ? cfg.xl(x0) : dstr(x0), 2, ph + 5); c.textAlign = 'right'; c.fillText(cfg.xl ? cfg.xl(x1) : dstr(x1), pw, ph + 5);
  }

  /* ——— kart tanımları ——— */
  function cards(r) {
    const t = r.t, c = r.c, tMax = r.asOf, yrs = range === '1y' ? 1 : range === '4y' ? 4 : 99, xMin = tMax - yrs * 365.25 * 864e5, beam = css('--beam', '#ffc25c'), foam = 'rgba(233,238,248,.85)', bull = css('--bull', '#35d6a0'), bear = css('--bear', '#ff6384');
    const price = { x: t, y: c, color: foam, w: 1.3 }, nowAt = (arr) => ({ x: t[t.length - 1], y: arr[arr.length - 1] });
    const tone = (ok, warn) => (ok ? 'down' : warn ? 'warn' : 'up');
    return [
      { id: 'pi', title: 'Pi Cycle Top', value: r.pi.now.toFixed(2), unit: 'oran', badge: r.pi.state, tone: tone(r.pi.state === 'Tetiklendi', r.pi.state === 'Yaklaştı'),
        info: `111 günlük ortalamanın, 350 günlük ortalamanın 2 katına oranı. Oran 1'e ulaştığında (111G, 2×350G'yi yukarı keser) Bitcoin'in geçmiş iki büyük döngü tepesine denk gelmiştir (2017 ve 2021). Veri örneği az olduğu için kesin bir sinyal değildir. Son kesişim: ${r.pi.crosses.length ? ds(r.pi.crosses[r.pi.crosses.length - 1]) : 'bu veride yok'}.`,
        cfg: { log: true, xMin, series: [price, { x: t, y: r.pi.s111, color: beam, w: 1.5 }, { x: t, y: r.pi.pi2, color: bear, w: 1.5, dash: [5, 4] }], marks: r.pi.crosses.map((x) => ({ x, color: bear })) }, legend: [['Fiyat', foam], ['111G', beam], ['2×350G', bear]] },
      { id: 'mayer', title: 'Mayer Çarpanı', value: fmtX(r.mayer.now), unit: '', badge: r.mayer.state, tone: tone(r.mayer.state === 'Aşırı' || r.mayer.state === 'Yüksek', false),
        info: `Fiyatın 200 günlük ortalamaya oranı. Tarihsel ortalama bu veride ${fmtX(r.mayer.avg)}. 2,4 üstü geçmişte aşırı ısınma, 0,8 altı ise derin düşüş dönemlerinde görülmüştür; eşikler yalnızca tarihsel referanstır.`,
        cfg: { xMin, fmt: (v) => v.toFixed(1), series: [{ x: t, y: r.mayer.ratio, color: beam, w: 1.6 }], refs: [{ y: 0.8, color: bull, label: '0,8' }, { y: 1, color: 'rgba(233,238,248,.4)', label: '1' }, { y: 2.4, color: bear, label: '2,4' }], now: nowAt(r.mayer.ratio) }, legend: [['Fiyat / 200G', beam]] },
      { id: 'w200', title: '200 Hafta Ortalama', value: r.w200.available ? fmtX(r.w200.now) : 'veri yok', unit: r.w200.available ? '$' + fmtUsd(r.w200.maNow) : '', badge: r.w200.available ? r.w200.state : 'Yetersiz geçmiş', tone: tone(r.w200.now > 3, r.w200.now >= 1.5),
        info: 'Fiyatın 200 haftalık (1400 günlük) ortalamaya oranı. Bitcoin geçmişte çoğu zaman bu ortalamanın üzerinde kalmış, ayı piyasası diplerinde ona yaklaşmış ya da kısa süre altına inmiştir. Ortalama, borsa verisinin başladığı 2017\'den itibaren hesaplanabildiği için çizgi 2021 civarında başlar.',
        cfg: { log: true, xMin, series: [price, { x: t, y: r.w200.ma, color: beam, w: 1.8 }] }, legend: [['Fiyat', foam], ['200 hafta ort.', beam]] },
      { id: 'ma2y', title: '2 Yıllık Ortalama Çarpanı', value: r.ma2y.available ? fmtX(r.ma2y.now) : 'veri yok', unit: '', badge: r.ma2y.available ? r.ma2y.state : 'Yetersiz geçmiş', tone: tone(r.ma2y.now >= 5, r.ma2y.now >= 3),
        info: 'Fiyat, 730 günlük ortalama ve onun 5 katı. Fiyat alt çizginin altındayken tarihsel olarak uzun vadeli düşük bölge, 5× çizgisine yaklaşırken aşırı ısınma görülmüştür. Geçmiş döngüler gelecekte aynen tekrar etmeyebilir.',
        cfg: { log: true, xMin, series: [price, { x: t, y: r.ma2y.ma, color: bull, w: 1.5 }, { x: t, y: r.ma2y.x5, color: bear, w: 1.5 }] }, legend: [['Fiyat', foam], ['2Y ort.', bull], ['2Y ort. ×5', bear]] },
      { id: 'rainbow', title: 'Regresyon Bantları', value: r.rainbow.name, unit: (r.rainbow.now >= 0 ? '+' : '−') + Math.abs(r.rainbow.now).toFixed(2) + ' σ', badge: r.rainbow.name, tone: tone(r.rainbow.idx >= 6, r.rainbow.idx >= 5),
        info: 'Beacon kendi uyumunu kullanır: fiyatın logaritması, Bitcoin\'in doğumundan beri geçen günün logaritmasına doğrusal olarak uydurulur; bantlar bu çizginin ±σ katlarıdır. Başka sitelerdeki "gökkuşağı" çizelgelerinden farklıdır, yalnızca 2017 sonrası veriyle hesaplanır ve gelecek için tahmin değildir.',
        cfg: { log: true, xMin, series: [{ x: t, y: c, color: '#ffffff', w: 1.4 }], bands: r.rainbow.bands, bandX: t, bandColors: r.rainbow.colors, now: nowAt(c) }, legend: r.rainbow.names.map((n, i) => [n, r.rainbow.colors[i]]).filter((_, i) => i % 2 === 0) },
      (() => {
        const h = r.halving, cyc = h.cycles, col = ['rgba(233,238,248,.55)', beam];
        const series = cyc.map((cy, i) => ({ x: cy.vals.map((_, k) => k), y: cy.vals, color: col[i % 2], w: i === cyc.length - 1 ? 2 : 1.3, dash: i === cyc.length - 1 ? null : [5, 4] }));
        return { id: 'halving', title: 'Halving Döngüsü', value: h.daysSince + '. gün', unit: 'ATH\'den ' + (h.drawdown * 100).toFixed(1).replace('.', ',') + '%', badge: h.state, tone: tone(false, h.drawdown > -0.1),
          info: `Son halving 20 Nisan 2024. Çizgiler, halving gününün fiyatına göre çarpan olarak gösterilir: soluk çizgi önceki (2020) döngü, sarı çizgi bugünkü döngü. Şu an halving fiyatının ${fmtX(h.multiple)} seviyesinde. ATH ${h.athDays} gün önce görüldü ($${fmtUsd(h.ath)}). Sonraki halving tahmini 2028 baharı (${h.daysToNext} gün). Döngüler tekrar etmek zorunda değildir.`,
          cfg: { log: true, xMin: 0, xl: (x) => Math.round(x) + '. gün', fmt: (v) => v.toFixed(v < 10 ? 1 : 0) + '×', series, now: series.length ? { x: series[series.length - 1].x.length - 1, y: series[series.length - 1].y[series[series.length - 1].y.length - 1] } : null }, legend: cyc.map((cy, i) => [new Date(cy.start).getFullYear() + ' döngüsü', col[i % 2]]) };
      })(),
      ...(r.x && window.BeaconMarketX ? window.BeaconMarketX.cards(r.x, { t, xMin, beam, foam, bull, bear }) : []),
    ];
  }

  function render() {
    const box = $('mkBox'); if (!box) return;
    if (loading && !R) { box.innerHTML = '<div class="skelcard"></div><div class="skelcard"></div><div class="skelcard"></div>'; return; }
    if (failed && !R) { box.innerHTML = '<div class="empty"><b>Veri alınamadı</b><p class="note">Borsa verisine ulaşılamadı.</p><button class="cta ghost" id="mkRetry" style="max-width:220px;margin:12px auto 0">Tekrar dene</button></div>'; return; }
    if (!R) return;
    const pro = BX().isPro(), cs = cards(R); lastCards = cs;
    box.innerHTML = `<p class="note pad">Bitcoin'in günlük fiyatından hesaplanan döngü göstergeleri. Son veri: ${ds(R.asOf)}. Zincir üstü veriler (MVRV, NUPL vb.) fiyattan hesaplanamadığı için dahil değildir.</p>` +
      cs.map((k) => { const lock = !pro && !FREE.has(k.id); return `<article class="mk ${lock ? 'locked' : ''}" data-id="${k.id}" ${lock ? '' : 'tabindex="0" role="button" aria-label="' + k.title + ' grafiğini tam ekran aç"'}><header><h3>${k.title}${FREE.has(k.id) ? '' : ' <span class="pill">Pro</span>'}</h3><span class="badge ${lock ? 'flat' : k.tone}">${lock ? 'Kilitli' : esc(k.badge)}</span></header>
        <div class="mkv"><b class="num">${lock ? '••••' : esc(k.value)}</b><span class="dim">${lock ? '' : esc(k.unit)}</span></div>
        <div class="mkc"><canvas aria-label="${k.title} grafiği"></canvas>${lock ? '<button class="cta unlock" data-unlock>Pro ile aç</button>' : ''}</div>
        <div class="lg">${k.legend.map(([n, c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join('')}</div>
        <p class="note">${lock ? 'Bu gösterge Pro ile açılır. Reklam izleyerek Pro kazanabilirsiniz.' : esc(k.info)}</p></article>`; }).join('') +
      '<p class="note pad">Bu göstergeler eğitim amaçlıdır; yatırım tavsiyesi değildir. Geçmiş davranış gelecekte tekrar etmeyebilir.</p>';
    requestAnimationFrame(() => cs.forEach((k) => { const cv = box.querySelector(`[data-id="${k.id}"] canvas`); if (cv) mini(cv, k.cfg); }));
  }

  async function load() {
    if (loading) return; loading = true; failed = false; render();
    try {
      const cs = await D.loadLong('BTC', '1d', 5); R = M.compute(cs); if (!R) throw new Error('veri az');
      try { R.x = window.BeaconMarketX ? window.BeaconMarketX.compute(cs) : null; } catch (e) { R.x = null; }
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
    requestAnimationFrame(() => mini($('mfCv'), k.cfg, true));
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
    if (e.target.closest('#mkRetry')) load();
    if (e.target.closest('[data-unlock]')) BX().go('pro');
    const r = e.target.closest('#mkRange [data-r]');
    if (r) { range = r.dataset.r; $('mkRange').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === r)); render(); }
  });
  window.addEventListener('resize', () => { if (R && document.getElementById('v-market').classList.contains('on')) render(); });
  window.BeaconMarketUI = { onView() { if (R) render(); else load(); }, _state: () => R };
})();
