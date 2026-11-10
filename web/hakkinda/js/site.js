(function () {
  'use strict';
  const CFG = window.SITE_CFG || {}, B = window.Beacon, D = window.BeaconData, M = window.BeaconMarket;
  const $ = (id) => document.getElementById(id), REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  document.querySelectorAll('[data-tg]').forEach((a) => { if (CFG.telegram) a.href = CFG.telegram; a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  const fp = (p) => (p >= 1000 ? p.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) : p >= 1 ? p.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : p.toLocaleString('tr-TR', { maximumFractionDigits: 4 }));
  const css = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

  /* ——— hero grafiği ——— */
  const cv = $('hero-cv'); let hero = null;
  function drawHero() {
    if (!hero) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const N = 96, cs = hero.candles.slice(-N), off = hero.candles.length - cs.length, ax = 58;
    let lo = Infinity, hi = -Infinity; for (const k of cs) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; }
    const sp = (hi - lo) * 0.08, top = hi + sp, bot = lo - sp, pw = W - ax, bw = pw / N;
    const Y = (p) => 4 + (top - p) / (top - bot) * (H - 8), X = (i) => (i + 0.5) * bw;
    c.font = '500 11px Inter, system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'right';
    for (let k = 0; k <= 4; k++) { const p = bot + (top - bot) * k / 4, y = Math.round(Y(p)) + 0.5; c.strokeStyle = '#121b2e'; c.beginPath(); c.moveTo(0, y); c.lineTo(pw, y); c.stroke(); c.fillStyle = '#7e8ba6'; c.fillText(fp(p), W - 4, y); }
    const line = (arr, col, w) => { c.beginPath(); let s = false; cs.forEach((_, i) => { const v = arr[off + i]; if (!Number.isFinite(v)) { s = false; return; } const x = X(i), y = Y(v); s ? c.lineTo(x, y) : c.moveTo(x, y); s = true; }); c.strokeStyle = col; c.lineWidth = w; c.stroke(); };
    line(hero.a.ema50, '#ffc25c', 1.6); line(hero.a.ema20, 'rgba(233,238,248,.75)', 1.2);
    const w = Math.max(1, Math.floor(bw * 0.62));
    cs.forEach((k, i) => { const up = k.c >= k.o, x = Math.round(X(i)), col = up ? '#35d6a0' : '#ff6384'; c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x + .5, Y(k.h)); c.lineTo(x + .5, Y(k.l)); c.stroke(); const yo = Y(k.o), yc = Y(k.c); c.fillRect(x - Math.floor(w / 2), Math.min(yo, yc), w, Math.max(1, Math.abs(yo - yc))); });
  }
  function heroInfo() {
    const cs = hero.candles, last = cs[cs.length - 1], ref = cs[Math.max(0, cs.length - 25)], ch = last.c / ref.c - 1;
    $('cpPx').textContent = '$' + fp(last.c); const e = $('cpCh'); e.textContent = (ch >= 0 ? '+' : '−') + Math.abs(ch * 100).toFixed(2).replace('.', ',') + '% · 24s'; e.style.color = ch >= 0 ? 'var(--bull)' : 'var(--bear)';
    const s = hero.score, v = B.verdict(s); $('cpScore').textContent = Number.isFinite(s) ? (s > 0 ? '+' : s < 0 ? '−' : '') + Math.abs(Math.round(s)) : '–'; $('cpVerdict').textContent = v.text;
    $('cpMeter').style.left = (Number.isFinite(s) ? 50 + s / 2 : 50) + '%';
  }
  async function loadHero() {
    try {
      const cs = await D.load('BTC', '1h', 20000), n = D.closedCount(cs, 36e5), sm = B.summary(cs.slice(0, n));
      hero = { candles: cs, a: B.analyze(cs), score: sm.score }; heroInfo(); drawHero();
      if (!REDUCED) $('beam').classList.add('go');
    } catch (e) { $('cpVerdict').textContent = 'Veri alınamadı'; }
  }
  addEventListener('resize', drawHero); loadHero(); setInterval(async () => { if (document.hidden) return; try { await D.refresh('BTC', '1h'); loadHero(); } catch (e) {} }, 30000);

  /* ——— canlı fiyat şeridi (her coin ayrı istenir; biri başarısız olursa diğerleri görünür) ——— */
  async function ticker() {
    const syms = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'GRAM'], hosts = ['https://data-api.binance.vision', 'https://api.binance.com'];
    const get = async (s) => { for (const h of hosts) { try { const r = await fetch(`${h}/api/v3/ticker/24hr?symbol=${s}USDT`); if (r.ok) return r.json(); } catch (e) {} } return null; };
    const res = await Promise.all(syms.map(get)), el = $('ticker');
    el.innerHTML = res.map((r, i) => (r ? `<span><b>${syms[i]}</b>${fp(+r.lastPrice)}<span class="${+r.priceChangePercent >= 0 ? 'up' : 'dn'}">${(+r.priceChangePercent >= 0 ? '+' : '−') + Math.abs(+r.priceChangePercent).toFixed(2).replace('.', ',')}%</span></span>` : '')).join('');
  }
  ticker(); setInterval(() => { if (!document.hidden) ticker(); }, 30000);

  /* ——— piyasa kartları (görünür olunca yüklenir) ——— */
  function spark(canvas, series, opt) {
    const dpr = Math.min(2, devicePixelRatio || 1), W = canvas.clientWidth, H = canvas.clientHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); const ax = 50, pw = W - ax; let lo = Infinity, hi = -Infinity; const n = series[0].y.length, from = Math.max(0, n - opt.days);
    for (const s of series) for (let i = from; i < n; i++) { const v = s.y[i]; if (Number.isFinite(v) && (!opt.log || v > 0)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    for (const r of opt.refs || []) { lo = Math.min(lo, r.y); hi = Math.max(hi, r.y); }
    const T = opt.log ? Math.log : (v) => v, a = T(lo), b = T(hi), pad = (b - a) * 0.07, Y = (v) => 4 + (1 - (T(v) - (a - pad)) / (b - a + 2 * pad)) * (H - 22), X = (i) => ((i - from) / (n - 1 - from)) * (pw - 4) + 2;
    c.font = '500 10.5px Inter, system-ui, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let k = 0; k <= 3; k++) { const v = opt.log ? Math.exp(a + (b - a) * k / 3) : lo + (hi - lo) * k / 3, y = Math.round(Y(v)) + 0.5; c.strokeStyle = '#121b2e'; c.beginPath(); c.moveTo(0, y); c.lineTo(pw, y); c.stroke(); c.fillStyle = '#7e8ba6'; c.fillText(opt.fmt(v), W - 4, y); }
    for (const r of opt.refs || []) { const y = Math.round(Y(r.y)) + 0.5; c.strokeStyle = r.c; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, y); c.lineTo(pw, y); c.stroke(); c.setLineDash([]); }
    for (const s of series) { c.beginPath(); let st = false; for (let i = from; i < n; i++) { const v = s.y[i]; if (!Number.isFinite(v)) { st = false; continue; } st ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); st = true; } c.strokeStyle = s.c; c.lineWidth = s.w || 1.6; c.setLineDash(s.d || []); c.stroke(); c.setLineDash([]); }
    c.fillStyle = '#7e8ba6'; c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText(opt.t0, 2, H - 14); c.textAlign = 'right'; c.fillText(opt.t1, pw, H - 14);
  }
  let mk = null;
  function drawMarket() {
    if (!mk) return; const r = mk, t = r.t, n = t.length, days = 1460, mo = (ts) => new Date(ts).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' });
    const x = (v) => v.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    const cls = (s) => (s === 'Aşırı' || s === 'Tetiklendi' ? 'dn' : s === 'Yüksek' || s === 'Yaklaştı' ? 'warn' : s === 'Düşük' ? 'up' : '');
    $('mkGrid').innerHTML = `<div class="mk"><h3>Mayer Çarpanı <span class="st ${cls(r.mayer.state)}">${r.mayer.state}</span></h3><div class="val num">${x(r.mayer.now)}×</div><canvas id="mkA" role="img" aria-label="Mayer çarpanı grafiği"></canvas><p>Fiyatın 200 günlük ortalamaya oranı. Bu veride ortalama ${x(r.mayer.avg)}×. 2,4 üstü geçmişte aşırı ısınma dönemlerinde görüldü.</p></div>
      <div class="mk"><h3>Pi Cycle Top <span class="st ${cls(r.pi.state)}">${r.pi.state}</span></h3><div class="val num">${x(r.pi.now)}</div><canvas id="mkB" role="img" aria-label="Pi Cycle grafiği"></canvas><p>111 günlük ortalama, 350 günlük ortalamanın 2 katına ulaştığında (oran 1) geçmiş iki döngü tepesine denk geldi. Örnek sayısı az; kesin sinyal değildir.</p></div>`;
    spark($('mkA'), [{ y: r.mayer.ratio, c: '#ffc25c' }], { days, fmt: (v) => v.toFixed(1), refs: [{ y: 0.8, c: '#35d6a0' }, { y: 2.4, c: '#ff6384' }], t0: mo(t[n - days]), t1: mo(t[n - 1]) });
    spark($('mkB'), [{ y: r.c, c: 'rgba(233,238,248,.85)', w: 1.2 }, { y: r.pi.s111, c: '#ffc25c' }, { y: r.pi.pi2, c: '#ff6384', d: [5, 4] }], { days, log: true, fmt: (v) => (v >= 1000 ? Math.round(v / 1000) + ' B' : Math.round(v)), t0: mo(t[n - days]), t1: mo(t[n - 1]) });
  }
  const mkEl = $('mkGrid');
  const io = new IntersectionObserver(async (es) => {
    if (!es.some((e) => e.isIntersecting)) return; io.disconnect();
    try { mk = M.compute(await D.loadLong('BTC', '1d', 5)); if (!mk) throw 0; drawMarket(); }
    catch (e) { mkEl.innerHTML = '<div class="mk"><h3>Veri alınamadı</h3><p>Borsa verisine ulaşılamadı. Sayfayı yenileyerek tekrar deneyin.</p></div>'; }
  }, { rootMargin: '300px' });
  io.observe(mkEl); addEventListener('resize', drawMarket);

  /* ——— topluluk: sunucu adresi tanımlıysa gerçek veri ——— */
  if (CFG.apiUrl) {
    fetch(CFG.apiUrl.replace(/\/+$/, '') + '/api/public/feed').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
      if (!d.broadcasters.length && !d.posts.length) return;
      const ago = (t) => new Date(t * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
      $('comm').innerHTML = (d.posts.length ? `<div class="posts">${d.posts.slice(0, 4).map((p) => `<div class="postrow"><div class="by">${esc(p.author)} · ${esc(p.group)} · ${ago(p.published_at)}</div><h3>${esc(p.title)}</h3><p>${esc(p.excerpt)}</p></div>`).join('')}</div>` : '') +
        `<div class="bl">${d.broadcasters.map((b) => `<a class="chipx" ${b.link ? `href="${esc(b.link)}" target="_blank" rel="noopener noreferrer"` : ''}>${esc(b.name)} · ${b.followers} takipçi</a>`).join('')}</div>`;
    }).catch(() => {});
  }
})();
