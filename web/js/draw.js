/*  Beacon çizim ve ölçüm araçları.
 *  Çizimler (zaman, fiyat) koordinatlarıyla saklanır; bu yüzden zaman dilimi değişse de yerinde kalır ve cihazlar arası eşitlenir.
 *  Fare ve dokunma birlikte çalışır: sürükleyerek ya da nokta nokta dokunarak çizilir.
 */
(function (root) {
  'use strict';
  const COLORS = ['#ffc25c', '#e9eef8', '#35d6a0', '#ff6384', '#5aa9ff', '#b48cff'];
  const FREE_TOOLS = new Set(['trend', 'hline', 'measure']);
  const FREE_MAX = 8, SYM_MAX = 100, TOTAL_MAX = 400;
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const FIB_COL = ['#9aa4b8', '#ff6384', '#ff9f5a', '#35d6a0', '#2bc4d6', '#5aa9ff', '#9aa4b8'];
  const TOOLS = {
    trend: { name: 'Trend çizgisi', need: 2 }, ray: { name: 'Işın', need: 2 }, hline: { name: 'Yatay çizgi', need: 1 }, vline: { name: 'Dikey çizgi', need: 1 },
    channel: { name: 'Paralel kanal', need: 3 }, fib: { name: 'Fibonacci seviyeleri', need: 2 }, pos: { name: 'Risk/ödül pozisyonu', need: 2 },
    rect: { name: 'Dikdörtgen', need: 2 }, text: { name: 'Not', need: 1 }, measure: { name: 'Cetvel', need: 2 },
  };
  const GROUPS = [
    { id: 'lines', name: 'Çizgiler', tools: ['trend', 'ray', 'hline', 'vline', 'channel'] },
    { id: 'plan', name: 'Fibonacci ve plan', tools: ['fib', 'pos'] },
    { id: 'shape', name: 'Şekil ve not', tools: ['rect', 'text'] },
  ];
  const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    cursor: I('<path d="M12 3v5M12 16v5M3 12h5M16 12h5"/><circle cx="12" cy="12" r="1.3"/>'),
    trend: I('<path d="M5 18L19 6"/><circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="6" r="1.8"/>'),
    ray: I('<path d="M5 17L21 7"/><circle cx="5" cy="17" r="1.8"/><path d="M17 4.6l3.6 2.2-2.2 3.6"/>'),
    hline: I('<path d="M3 12h18"/><path d="M17 8.5h4M17 15.5h4" opacity=".5"/>'),
    vline: I('<path d="M12 3v18"/><path d="M8.5 7v-3M8.5 20v-3" opacity=".5"/>'),
    channel: I('<path d="M4 16L19 8M4 21L19 13"/><path d="M4 16v5M19 8v5" opacity=".45"/>'),
    fib: I('<path d="M4 5h16M4 10h16M4 14h16M4 19h16"/><path d="M4 5v14" opacity=".5"/>'),
    pos: I('<rect x="4" y="4" width="16" height="7" rx="1" opacity=".55"/><rect x="4" y="13" width="16" height="7" rx="1"/><path d="M4 12h16"/>'),
    rect: I('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
    text: I('<path d="M5 6V5h14v1M12 5v14M9 19h6"/>'),
    measure: I('<rect x="3" y="9" width="18" height="6" rx="1.5" transform="rotate(-35 12 12)"/><path d="M9 14l1.4-1.2M12 12l1-.9M15 10l1.4-1.2" transform="rotate(0)" opacity=".6"/>'),
    mag: I('<path d="M6 4v8a6 6 0 0012 0V4"/><path d="M6 8h4M14 8h4"/>'),
    lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
    eye: I('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>'),
    trash: I('<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>'),
    undo: I('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12" transform="translate(0 -6)"/>'),
    pen: I('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/>'),
    dup: I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>'),
    close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  };

  /* ——— saf geometri (testlenebilir) ——— */
  const segDist = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  const rayDist = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, ((px - x1) * dx + (py - y1) * dy) / l2); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  const fibPrice = (p0, p1, l) => p1 + (p0 - p1) * l;
  const inRect = (x, y, a, b, c, d, tol = 0) => x >= Math.min(a, c) - tol && x <= Math.max(a, c) + tol && y >= Math.min(b, d) - tol && y <= Math.max(b, d) + tol;
  const lineYAt = (x1, y1, x2, y2, x) => (x2 === x1 ? y1 : y1 + ((y2 - y1) * (x - x1)) / (x2 - x1));
  const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const alpha = (hex, a) => { const m = /^#([0-9a-f]{6})/i.exec(hex || ''); if (!m) return hex; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; };
  const geom = { segDist, rayDist, fibPrice, inRect, lineYAt, FIB };

  function init(o) {
    const chart = o.chart, host = o.host, getS = o.state, save = o.save, F = root.BeaconFmt || { fmtPrice: String, fmtDuration: String };
    const S0 = () => { const S = getS(); S.draw = Array.isArray(S.draw) ? S.draw : []; S.dr = Object.assign({ mag: false, lock: false, hide: false, open: root.innerWidth >= 900, col: COLORS[0] }, S.dr); return S; };
    const ctl = { tool: null, cur: null, sel: null, drag: null, measure: null, undo: [], hoverPt: null };
    const cv = chart.cv;

    /* ——— koordinat dönüşümleri ——— */
    const cs = () => chart.d.candles, tfMs = () => chart.d.tfMs || 36e5;
    function tOfIdx(i) { const c = cs(), n = c.length; if (i <= 0) return c[0].t + i * tfMs(); if (i >= n - 1) return c[n - 1].t + (i - (n - 1)) * tfMs(); const lo = Math.floor(i); return c[lo].t + (i - lo) * (c[lo + 1].t - c[lo].t); }
    function idxOfT(t) {
      const c = cs(), n = c.length; if (t <= c[0].t) return (t - c[0].t) / tfMs(); if (t >= c[n - 1].t) return n - 1 + (t - c[n - 1].t) / tfMs();
      let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m].t <= t) lo = m; else hi = m; } return lo + (t - c[lo].t) / (c[hi].t - c[lo].t);
    }
    const sc = (pt) => ({ x: chart.x(idxOfT(pt.t)), y: chart.yOf(pt.p) });
    function toData(px, py, free) {
      const g = chart._geo; if (!g || !chart.d) return null;
      let i = chart.idxF(px), p = chart.priceAt(Math.max(g.priceTop, Math.min(g.priceBot, py)));
      if (S0().dr.mag && !free) {
        const ii = Math.max(0, Math.min(chart.n - 1, Math.round(i))), k = cs()[ii]; let best = null, bd = 22;
        for (const v of [k.o, k.h, k.l, k.c]) { const d = Math.abs(chart.yOf(v) - py); if (d < bd) { bd = d; best = v; } }
        i = ii; if (best !== null) p = best;
      }
      return { t: Math.round(tOfIdx(i)), p };
    }
    const mine = () => { const S = S0(); return S.draw.filter((d) => d.sym === S.sym); };
    const get = (id) => S0().draw.find((d) => d.id === id);
    const tol = (e) => (e && e.pointerType === 'touch' ? 14 : 9);

    /* ——— geri alma ——— */
    const snap = () => { ctl.undo.push(JSON.stringify(S0().draw)); if (ctl.undo.length > 25) ctl.undo.shift(); };
    function undo() { const p = ctl.undo.pop(); if (!p) return o.toast && o.toast('Geri alınacak bir şey yok'); S0().draw = JSON.parse(p); if (ctl.sel && !get(ctl.sel)) ctl.sel = null; save(); refresh(); }
    function refresh() { renderBar(); renderRail(); chart.invalidate(); }

    /* ——— çizim kuralları ——— */
    const defSt = (type) => ({ c: S0().dr.col || COLORS[0], w: type === 'fib' || type === 'rect' ? 1 : 2, ds: type === 'ray' || type === 'channel' ? 0 : 0 });
    function canUse(tool) {
      if (!FREE_TOOLS.has(tool) && !o.isPro()) { o.toast('Bu çizim aracı Pro ile açılır'); o.goPro(); return false; }
      return true;
    }
    function canAdd() {
      const S = S0();
      if (S.draw.length >= TOTAL_MAX) { o.toast('Çizim sınırına ulaşıldı (' + TOTAL_MAX + ')'); return false; }
      if (mine().length >= SYM_MAX) { o.toast('Bu coin için en çok ' + SYM_MAX + ' çizim'); return false; }
      if (!o.isPro() && S.draw.length >= FREE_MAX) { o.toast('Ücretsiz hesapta en çok ' + FREE_MAX + ' çizim. Pro ile sınırsız'); o.goPro(); return false; }
      return true;
    }
    function setTool(t) {
      if (t && t !== 'cursor' && !canUse(t)) return;
      ctl.tool = t === 'cursor' ? null : t; ctl.cur = null; ctl.measure = ctl.tool === 'measure' ? ctl.measure : null; ctl.drag = null;
      if (ctl.tool) ctl.sel = null; cv.style.cursor = ctl.tool ? 'crosshair' : ''; refresh();
    }

    /* ——— ekran koordinatları ——— */
    function screen(d) { return d.pts.map(sc); }
    function newDrawing(tool, pt) {
      const n = TOOLS[tool].need, pts = []; for (let k = 0; k < Math.max(n, tool === 'pos' ? 3 : n); k++) pts.push({ t: pt.t, p: pt.p });
      return { id: uid(), sym: S0().sym, type: tool, pts, st: defSt(tool), tx: '', lk: false, u: 0 };
    }
    function finishPos(d) { const e = d.pts[0].p, s = d.pts[1].p; d.pts[2] = { t: d.pts[1].t, p: e + (e - s) * 2 }; }

    /* ——— isabet testi ——— */
    function hit(d, x, y, t) {
      const s = screen(d), ty = d.type, g = chart._geo, pw = g.pw;
      if (!s.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return null;
      if (ty === 'trend') return segDist(x, y, s[0].x, s[0].y, s[1].x, s[1].y) <= t;
      if (ty === 'ray') return rayDist(x, y, s[0].x, s[0].y, s[1].x, s[1].y) <= t;
      if (ty === 'hline') return Math.abs(y - s[0].y) <= t;
      if (ty === 'vline') return Math.abs(x - s[0].x) <= t;
      if (ty === 'channel') { const dy = s[2].y - lineYAt(s[0].x, s[0].y, s[1].x, s[1].y, s[2].x); return segDist(x, y, s[0].x, s[0].y, s[1].x, s[1].y) <= t || segDist(x, y, s[0].x, s[0].y + dy, s[1].x, s[1].y + dy) <= t || (x >= Math.min(s[0].x, s[1].x) && x <= Math.max(s[0].x, s[1].x) && ((y - lineYAt(s[0].x, s[0].y, s[1].x, s[1].y, x)) * (y - lineYAt(s[0].x, s[0].y + dy, s[1].x, s[1].y + dy, x)) <= 0)); }
      if (ty === 'fib') { const ys = FIB.map((l) => chart.yOf(fibPrice(d.pts[0].p, d.pts[1].p, l))); return x >= Math.min(s[0].x, s[1].x) - t && x <= Math.max(s[0].x, s[1].x) + t && y >= Math.min(...ys) - t && y <= Math.max(...ys) + t; }
      if (ty === 'rect') return inRect(x, y, s[0].x, s[0].y, s[1].x, s[1].y, t);
      if (ty === 'pos') return inRect(x, y, s[0].x, Math.min(s[1].y, s[2].y), s[1].x, Math.max(s[1].y, s[2].y), t);
      if (ty === 'text') { const w = (d.tx.length * 6.6) + 16; return inRect(x, y, s[0].x - w / 2, s[0].y - 12, s[0].x + w / 2, s[0].y + 12, t / 2); }
      void pw; return false;
    }
    function handles(d) {
      const s = screen(d), g = chart._geo, ty = d.type;
      if (ty === 'hline') return [{ x: g.pw - 34, y: s[0].y, k: 0 }];
      if (ty === 'vline') return [{ x: s[0].x, y: g.priceTop + 34, k: 0 }];
      if (ty === 'text') return [{ x: s[0].x, y: s[0].y, k: 0 }];
      return s.map((q, k) => ({ x: q.x, y: q.y, k }));
    }

    /* ——— çizim ——— */
    const fp = (p) => F.fmtPrice(p);
    function render(c, g, phase) {
      if (!chart.d || chart.n < 2) return;
      const S = S0(), pw = g.pw, col = chart.col;
      if (phase === 'axis') {
        if (S.dr.hide) return;
        c.save(); c.font = `600 10.5px ${col.font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const d of mine()) if (d.type === 'hline') { const y = chart.yOf(d.pts[0].p); if (y < g.priceTop || y > g.priceBot) continue; c.fillStyle = d.st.c; const w = chart.axisW - 6; c.fillRect(pw + 1, y - 9, w, 18); c.fillStyle = '#0b0f19'; c.fillText(fp(d.pts[0].p), pw + 1 + w / 2, y); }
        c.restore(); return;
      }
      if (S.dr.hide && !ctl.cur && !ctl.measure) return;
      const list = S.dr.hide ? [] : mine();
      c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
      for (const d of list) paint(c, d, g, d.id === ctl.sel);
      if (ctl.cur) paint(c, ctl.cur.d, g, true, true);
      if (ctl.measure) paint(c, ctl.measure, g, true, true);
      c.restore();
    }
    function line(c, x1, y1, x2, y2, st) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = st.c; c.lineWidth = st.w; c.setLineDash(st.ds ? [7, 5] : []); c.stroke(); c.setLineDash([]); }
    function pill(c, txt, x, y, bg, fg, align) {
      c.font = `600 10.5px ${chart.col.font}`; const w = c.measureText(txt).width + 12; const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      c.fillStyle = bg; c.beginPath(); c.roundRect ? c.roundRect(x0, y - 10, w, 20, 5) : c.rect(x0, y - 10, w, 20); c.fill();
      c.fillStyle = fg; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, x0 + 6, y + 0.5);
    }
    function paint(c, d, g, selected, building) {
      const s = screen(d), pw = g.pw, st = d.st, ty = d.type;
      if (!s.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return;
      const ext = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, k = 6000 / L; return { x: a.x + dx * k, y: a.y + dy * k }; };
      if (ty === 'trend') line(c, s[0].x, s[0].y, s[1].x, s[1].y, st);
      else if (ty === 'ray') { const e = ext(s[0], s[1]); line(c, s[0].x, s[0].y, e.x, e.y, st); }
      else if (ty === 'hline') line(c, 0, s[0].y, pw, s[0].y, st);
      else if (ty === 'vline') line(c, s[0].x, 0, s[0].x, g.paneBottom, st);
      else if (ty === 'channel') {
        const dy = s[2].y - lineYAt(s[0].x, s[0].y, s[1].x, s[1].y, s[2].x);
        c.beginPath(); c.moveTo(s[0].x, s[0].y); c.lineTo(s[1].x, s[1].y); c.lineTo(s[1].x, s[1].y + dy); c.lineTo(s[0].x, s[0].y + dy); c.closePath(); c.fillStyle = alpha(st.c, 0.09); c.fill();
        line(c, s[0].x, s[0].y, s[1].x, s[1].y, st); line(c, s[0].x, s[0].y + dy, s[1].x, s[1].y + dy, st); line(c, s[0].x, s[0].y + dy / 2, s[1].x, s[1].y + dy / 2, { c: st.c, w: 1, ds: 1 });
      } else if (ty === 'fib') {
        const x0 = Math.min(s[0].x, s[1].x), x1 = Math.max(s[0].x, s[1].x), ys = FIB.map((l) => chart.yOf(fibPrice(d.pts[0].p, d.pts[1].p, l)));
        for (let k = 0; k < FIB.length - 1; k++) { c.fillStyle = alpha(FIB_COL[k + 1], 0.07); c.fillRect(x0, Math.min(ys[k], ys[k + 1]), x1 - x0, Math.abs(ys[k + 1] - ys[k])); }
        c.font = `600 10px ${chart.col.font}`; c.textBaseline = 'bottom'; c.textAlign = 'left';
        FIB.forEach((l, k) => { line(c, x0, ys[k], x1, ys[k], { c: FIB_COL[k], w: 1, ds: 0 }); c.fillStyle = FIB_COL[k]; c.fillText(`${l} · ${fp(fibPrice(d.pts[0].p, d.pts[1].p, l))}`, x0 + 4, ys[k] - 2); });
        line(c, s[0].x, s[0].y, s[1].x, s[1].y, { c: st.c, w: 1, ds: 1 });
      } else if (ty === 'rect') {
        c.fillStyle = alpha(st.c, 0.12); c.fillRect(Math.min(s[0].x, s[1].x), Math.min(s[0].y, s[1].y), Math.abs(s[1].x - s[0].x), Math.abs(s[1].y - s[0].y));
        c.strokeStyle = st.c; c.lineWidth = st.w; c.setLineDash(st.ds ? [7, 5] : []); c.strokeRect(Math.min(s[0].x, s[1].x), Math.min(s[0].y, s[1].y), Math.abs(s[1].x - s[0].x), Math.abs(s[1].y - s[0].y)); c.setLineDash([]);
      } else if (ty === 'text') {
        if (d.tx) pill(c, d.tx, s[0].x, s[0].y, alpha(st.c, 0.9), '#0b0f19', 'center');
        else pill(c, 'Not…', s[0].x, s[0].y, alpha(st.c, 0.5), '#0b0f19', 'center');
      } else if (ty === 'pos') {
        const e = d.pts[0].p, stp = d.pts[1].p, tg = d.pts[2].p, x0 = s[0].x, x1 = s[1].x, long = tg >= e, risk = Math.abs(e - stp), rew = Math.abs(tg - e), rr = risk ? rew / risk : 0;
        const ye = s[0].y, ys = chart.yOf(stp), yt = chart.yOf(tg);
        c.fillStyle = 'rgba(53,214,160,.16)'; c.fillRect(Math.min(x0, x1), Math.min(ye, yt), Math.abs(x1 - x0), Math.abs(yt - ye));
        c.fillStyle = 'rgba(255,99,132,.16)'; c.fillRect(Math.min(x0, x1), Math.min(ye, ys), Math.abs(x1 - x0), Math.abs(ys - ye));
        line(c, x0, ye, x1, ye, { c: '#e9eef8', w: 1.2, ds: 0 }); line(c, x0, yt, x1, yt, { c: '#35d6a0', w: 1.2, ds: 0 }); line(c, x0, ys, x1, ys, { c: '#ff6384', w: 1.2, ds: 0 });
        const mx = (x0 + x1) / 2;
        pill(c, `Hedef ${rew / e >= 0 ? (long ? '+' : '−') : ''}${(rew / e * 100).toFixed(2)}% · ${fp(tg)}`, mx, yt + (yt < ye ? -14 : 14), '#1c8f6c', '#fff', 'center');
        pill(c, `Stop ${(risk / e * 100).toFixed(2)}% · ${fp(stp)}`, mx, ys + (ys < ye ? -14 : 14), '#b63a52', '#fff', 'center');
        pill(c, `${long ? 'Uzun' : 'Kısa'} · Risk/Ödül ${rr.toFixed(2)}`, mx, ye, 'rgba(11,15,25,.85)', '#e9eef8', 'center');
      } else if (ty === 'measure') {
        const dp = d.pts[1].p - d.pts[0].p, pc = (dp / d.pts[0].p) * 100, up = dp >= 0, colr = up ? '#35d6a0' : '#ff6384';
        const nb = Math.round(Math.abs(idxOfT(d.pts[1].t) - idxOfT(d.pts[0].t))), ms = Math.abs(d.pts[1].t - d.pts[0].t);
        c.fillStyle = alpha(colr, 0.12); c.fillRect(Math.min(s[0].x, s[1].x), Math.min(s[0].y, s[1].y), Math.abs(s[1].x - s[0].x), Math.abs(s[1].y - s[0].y));
        line(c, s[0].x, s[0].y, s[1].x, s[1].y, { c: colr, w: 1.4, ds: 0 });
        const ax = s[1].x, ay = s[1].y, an = Math.atan2(s[1].y - s[0].y, s[1].x - s[0].x); c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax - 9 * Math.cos(an - 0.45), ay - 9 * Math.sin(an - 0.45)); c.moveTo(ax, ay); c.lineTo(ax - 9 * Math.cos(an + 0.45), ay - 9 * Math.sin(an + 0.45)); c.strokeStyle = colr; c.lineWidth = 1.4; c.stroke();
        const days = ms / 864e5, dur = days >= 1 ? (days >= 10 ? Math.round(days) : days.toFixed(1)) + ' gün' : F.fmtDuration(ms).replace(/^00:/, '');
        const mx = Math.max(70, Math.min(pw - 70, (s[0].x + s[1].x) / 2)), my = up ? Math.min(s[0].y, s[1].y) - 34 : Math.max(s[0].y, s[1].y) + 34;
        pill(c, `${up ? '+' : '−'}${fp(Math.abs(dp))} (${up ? '+' : '−'}${Math.abs(pc).toFixed(2)}%)`, mx, my, colr, '#0b0f19', 'center');
        pill(c, `${nb} mum · ${dur}`, mx, my + (up ? 22 : -22), 'rgba(11,15,25,.88)', '#e9eef8', 'center');
      }
      if (selected && !building) { c.setLineDash([]); for (const h of handles(d)) { c.beginPath(); c.arc(h.x, h.y, 5.5, 0, 6.3); c.fillStyle = '#0b0f19'; c.fill(); c.strokeStyle = d.st.c || '#ffc25c'; c.lineWidth = 2; c.stroke(); } }
      else if (building) { for (const q of s) { c.beginPath(); c.arc(q.x, q.y, 3.5, 0, 6.3); c.fillStyle = '#ffc25c'; c.fill(); } }
      if (d.lk && selected && !building) { const h = handles(d)[0]; if (h) { c.font = '11px sans-serif'; c.fillStyle = '#ffc25c'; c.textAlign = 'left'; c.fillText('🔒', h.x + 8, h.y - 8); } }
    }

    /* ——— işaretçi olayları (chart.js çağırır) ——— */
    function inPlot(x, y) { const g = chart._geo; return !!g && x >= 0 && x <= g.pw && y >= g.priceTop && y <= g.priceBot; }
    function pickAt(x, y, e) {
      const S = S0(); if (S.dr.hide) return null; const t = tol(e), L = mine();
      if (ctl.sel) { const d = get(ctl.sel); if (d && d.sym === S.sym) { for (const h of handles(d)) if (Math.hypot(h.x - x, h.y - y) <= t + 4) return { d, k: h.k, mode: 'handle' }; } }
      for (let i = L.length - 1; i >= 0; i--) if (hit(L[i], x, y, t)) return { d: L[i], mode: 'body' };
      return null;
    }
    ctl.down = function (x, y, e) {
      if (!chart.d || chart.n < 2) return false;
      S0();
      if (ctl.tool) {
        if (!inPlot(x, y)) return false;
        const pt = toData(x, y); if (!pt) return false;
        if (!ctl.cur) {
          if (ctl.tool !== 'measure' && !canAdd()) { ctl.tool = null; refresh(); return false; }
          const d = newDrawing(ctl.tool, pt); if (ctl.tool === 'measure') { ctl.measure = d; } ctl.cur = { d, k: TOOLS[ctl.tool].need === 1 ? 0 : 1, sx: x, sy: y, fresh: true };
        } else { ctl.cur.d.pts[ctl.cur.k] = pt; ctl.cur.sx = x; ctl.cur.sy = y; ctl.cur.fresh = false; }
        chart.invalidate(); return true;
      }
      const h = pickAt(x, y, e);
      if (!h) { if (ctl.sel) { ctl.sel = null; refresh(); } return false; }
      if (ctl.sel !== h.d.id) { ctl.sel = h.d.id; renderBar(); }
      if (S0().dr.lock || h.d.lk) { chart.invalidate(); return true; } // kilitli: seçilir ama taşınmaz
      snap();
      ctl.drag = { mode: h.mode, k: h.k, d: h.d, sx: x, sy: y, start: h.d.pts.map((p) => ({ x: sc(p).x, y: sc(p).y })), moved: false };
      chart.invalidate(); return true;
    };
    ctl.move = function (x, y, e) {
      if (ctl.cur) { const pt = toData(x, y); if (pt) { applyPoint(ctl.cur.d, ctl.cur.k, pt); } chart.invalidate(); return; }
      const dr = ctl.drag; if (!dr) return; dr.moved = true;
      if (dr.mode === 'handle') { const pt = toData(x, y); if (pt) applyPoint(dr.d, dr.k, pt); }
      else { dr.d.pts.forEach((p, k) => { const q = toData(dr.start[k].x + (x - dr.sx), dr.start[k].y + (y - dr.sy), true); if (q) { p.t = q.t; p.p = q.p; } }); }
      chart.invalidate(); void e;
    };
    function applyPoint(d, k, pt) {
      const ty = d.type;
      if (ty === 'hline') { d.pts[0].p = pt.p; return; }
      if (ty === 'vline') { d.pts[0].t = pt.t; return; }
      if (ty === 'pos') {
        if (k === 0) { d.pts[0] = { t: pt.t, p: pt.p }; return; }
        if (k === 1) { d.pts[1] = { t: pt.t, p: pt.p }; d.pts[2].t = pt.t; if (ctl.cur && ctl.cur.d === d) finishPos(d); return; }
        d.pts[2] = { t: d.pts[1].t, p: pt.p }; return;
      }
      d.pts[k] = { t: pt.t, p: pt.p };
      if (d.pts.length > k + 1 && ctl.cur && ctl.cur.d === d) for (let j = k + 1; j < d.pts.length; j++) if (ty !== 'pos') d.pts[j] = { t: pt.t, p: pt.p };
    }
    ctl.up = function (x, y, e) {
      if (ctl.cur) {
        const cur = ctl.cur, d = cur.d, need = TOOLS[d.type].need, pt = toData(x, y); if (pt) applyPoint(d, cur.k, pt);
        const moved = Math.hypot(x - cur.sx, y - cur.sy) > 10;
        if (need === 1) return commit(d);
        if (cur.fresh && !moved) { cur.fresh = false; return chart.invalidate(); } // ilk dokunuş: ikinci noktayı bekle
        cur.k++; cur.fresh = false;
        if (cur.k >= need) return commit(d);
        // 3. nokta için başlangıç değeri
        d.pts[cur.k] = { t: d.pts[cur.k - 1].t, p: d.pts[cur.k - 1].p }; chart.invalidate(); void e; return;
      }
      const dr = ctl.drag; if (!dr) return; ctl.drag = null;
      if (!dr.moved) { ctl.undo.pop(); refresh(); return; }
      save(); refresh();
    };
    ctl.hover = function (x, y, e) {
      if (ctl.cur && !ctl.cur.fresh) { const pt = toData(x, y); if (pt) applyPoint(ctl.cur.d, ctl.cur.k, pt); chart.invalidate(); return true; }
      if (!ctl.tool) { const h = pickAt(x, y, e); cv.style.cursor = h ? (h.mode === 'handle' ? 'grab' : 'pointer') : ''; return false; }
      return false;
    };
    function commit(d) {
      const need = TOOLS[d.type].need, s = screen(d);
      if (d.type === 'pos') finishPos(d);
      const tiny = need >= 2 && Math.hypot(s[0].x - s[1].x, s[0].y - s[1].y) < 4 && d.type !== 'pos';
      ctl.cur = null;
      if (tiny) { ctl.measure = null; refresh(); return chart.invalidate(); }
      if (d.type === 'measure') { ctl.measure = d; refresh(); return chart.invalidate(); } // geçici: kaydedilmez, sonraki dokunuşta silinir
      if (d.type === 'text') { const t = (root.prompt ? root.prompt('Not metni', '') : '') || ''; const tx = t.replace(/[\u0000-\u001f]/g, '').slice(0, 80); if (!tx) { ctl.tool = null; refresh(); return; } d.tx = tx; }
      snap(); S0().draw.push(d); ctl.sel = d.id; ctl.tool = null; cv.style.cursor = ''; save(); refresh();
    }
    ctl.render = render;
    ctl.reload = function () { if (ctl.sel && !get(ctl.sel)) ctl.sel = null; refresh(); };
    ctl.undoLast = undo;

    /* ——— araç çubuğu ——— */
    const rail = document.createElement('div'), fly = document.createElement('div'), bar = document.createElement('div'), tgl = document.createElement('button');
    rail.className = 'drail'; rail.setAttribute('role', 'toolbar'); rail.setAttribute('aria-label', 'Çizim araçları'); fly.className = 'dfly'; fly.hidden = true; bar.className = 'dbar'; bar.hidden = true;
    tgl.className = 'dtoggle'; tgl.setAttribute('aria-label', 'Çizim araçlarını aç/kapat'); tgl.innerHTML = ICON.pen;
    host.appendChild(tgl); host.appendChild(rail); host.appendChild(fly); host.appendChild(bar);
    const lastOf = {}; GROUPS.forEach((g) => { lastOf[g.id] = g.tools[0]; });
    function renderRail() {
      const S = S0(), open = S.dr.open; rail.hidden = !open; tgl.setAttribute('aria-pressed', open); chart.padL = open ? 54 : 8; if (!open) fly.hidden = true;
      const b = (attrs, icon, label, on, extra) => `<button class="dtool${on ? ' on' : ''}${extra || ''}" ${attrs} aria-label="${label}" title="${label}">${icon}</button>`;
      let h = b('data-tool="cursor"', ICON.cursor, 'İmleç', !ctl.tool);
      for (const g of GROUPS) { const t = lastOf[g.id], on = g.tools.includes(ctl.tool); h += b(`data-group="${g.id}"`, ICON[on ? ctl.tool : t], g.name, on, ' grp'); }
      h += b('data-tool="measure"', ICON.measure, 'Cetvel', ctl.tool === 'measure');
      h += '<i class="dsep"></i>';
      h += b('data-act="mag"', ICON.mag, 'Mıknatıs: mumlara yapıştır', S.dr.mag, '') .replace('class="dtool', `aria-pressed="${!!S.dr.mag}" class="dtool`);
      h += b('data-act="lock"', ICON.lock, 'Çizimleri kilitle', S.dr.lock, '').replace('class="dtool', `aria-pressed="${!!S.dr.lock}" class="dtool`);
      h += b('data-act="hide"', ICON.eye, 'Çizimleri gizle', S.dr.hide, '').replace('class="dtool', `aria-pressed="${!!S.dr.hide}" class="dtool`);
      h += b('data-act="undo"', ICON.undo, 'Geri al', false);
      h += b('data-act="clear"', ICON.trash, 'Bu coindeki çizimleri sil', false);
      rail.innerHTML = h;
    }
    function renderBar() {
      const d = ctl.sel ? get(ctl.sel) : null; if (!d || d.sym !== S0().sym) { bar.hidden = true; return; }
      bar.hidden = false; const sw = COLORS.map((c) => `<button class="dsw${d.st.c === c ? ' on' : ''}" data-col="${c}" style="--c:${c}" aria-label="Renk ${c}"></button>`).join('');
      const nb = (a, ic, l, on) => `<button class="dbtn${on ? ' on' : ''}" data-bar="${a}" aria-label="${l}" title="${l}">${ic}</button>`;
      bar.innerHTML = sw + '<i class="dsep v"></i>' + (d.type !== 'pos' && d.type !== 'fib' && d.type !== 'text' && d.type !== 'measure' ? `<button class="dbtn w" data-bar="w" aria-label="Kalınlık" title="Kalınlık">${d.st.w}px</button>` + nb('ds', `<span class="dash"></span>`, 'Kesikli çizgi', d.st.ds) : '')
        + (d.type === 'text' ? nb('edit', ICON.pen, 'Metni düzenle') : '') + nb('lk', ICON.lock, d.lk ? 'Kilidi aç' : 'Kilitle', d.lk) + nb('dup', ICON.dup, 'Kopyala') + nb('del', ICON.trash, 'Sil');
    }
    function toggleFly(gid, anchor) {
      if (!fly.hidden && fly.dataset.g === gid) { fly.hidden = true; return; }
      const g = GROUPS.find((x) => x.id === gid); fly.dataset.g = gid;
      fly.innerHTML = `<div class="dflyh">${g.name}</div>` + g.tools.map((t) => `<button class="dfi${ctl.tool === t ? ' on' : ''}" data-tool="${t}" data-g="${gid}">${ICON[t]}<span>${TOOLS[t].name}</span>${FREE_TOOLS.has(t) || o.isPro() ? '' : '<em>Pro</em>'}</button>`).join('');
      fly.style.top = Math.max(4, anchor.offsetTop - 4) + 'px'; fly.hidden = false;
    }
    rail.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.group) { toggleFly(b.dataset.group, b); return; }
      fly.hidden = true;
      if (b.dataset.tool) { setTool(b.dataset.tool); return; }
      const S = S0(), a = b.dataset.act;
      if (a === 'mag' || a === 'lock' || a === 'hide') { S.dr[a] = !S.dr[a]; if (a === 'lock' || a === 'hide') ctl.sel = null; save(); refresh(); if (a === 'mag') o.toast(S.dr.mag ? 'Mıknatıs açık' : 'Mıknatıs kapalı'); if (a === 'hide') o.toast(S.dr.hide ? 'Çizimler gizli' : 'Çizimler görünür'); }
      else if (a === 'undo') undo();
      else if (a === 'clear') { const n = mine().length; if (!n) return o.toast('Bu coinde çizim yok'); if (!root.confirm(`Bu coindeki ${n} çizim silinsin mi?`)) return; snap(); S.draw = S.draw.filter((d) => d.sym !== S.sym); ctl.sel = null; save(); refresh(); }
    });
    fly.addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (!b) return; lastOf[b.dataset.g] = b.dataset.tool; fly.hidden = true; setTool(b.dataset.tool); });
    tgl.addEventListener('click', () => { const S = S0(); S.dr.open = !S.dr.open; if (!S.dr.open) setTool('cursor'); save(); refresh(); });
    bar.addEventListener('click', (e) => {
      const d = ctl.sel ? get(ctl.sel) : null; if (!d) return; const col = e.target.closest('[data-col]'), b = e.target.closest('[data-bar]');
      if (col) { snap(); d.st.c = col.dataset.col; S0().dr.col = d.st.c; save(); refresh(); return; }
      if (!b) return; const a = b.dataset.bar; snap();
      if (a === 'w') d.st.w = d.st.w >= 4 ? 1 : d.st.w + 1; else if (a === 'ds') d.st.ds = d.st.ds ? 0 : 1; else if (a === 'lk') d.lk = !d.lk;
      else if (a === 'edit') { const t = (root.prompt ? root.prompt('Not metni', d.tx) : null); if (t !== null && t !== undefined) d.tx = t.replace(/[\u0000-\u001f]/g, '').slice(0, 80) || d.tx; }
      else if (a === 'dup') { if (!canAdd()) { ctl.undo.pop(); return; } const c2 = JSON.parse(JSON.stringify(d)); c2.id = uid(); c2.pts.forEach((p) => { p.t += tfMs() * 3; p.p *= 1.002; }); c2.u = 0; S0().draw.push(c2); ctl.sel = c2.id; }
      else if (a === 'del') { S0().draw = S0().draw.filter((x) => x.id !== d.id); ctl.sel = null; }
      save(); refresh();
    });
    root.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector('.scrim.on')) return;
      if (!host.offsetParent && !host.closest('.fs')) return;
      if (e.key === 'Escape') { if (ctl.cur || ctl.tool || ctl.measure) { ctl.cur = null; ctl.measure = null; setTool('cursor'); } else if (ctl.sel) { ctl.sel = null; refresh(); } }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && ctl.sel) { const d = get(ctl.sel); if (d && !d.lk && !S0().dr.lock) { snap(); S0().draw = S0().draw.filter((x) => x.id !== d.id); ctl.sel = null; save(); refresh(); e.preventDefault(); } }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
    });
    chart.drawCtl = ctl; root.BeaconDraw.ctl = ctl; refresh();
    ctl.state = () => ({ tool: ctl.tool, sel: ctl.sel, count: mine().length });
    ctl.setTool = setTool; ctl.rail = rail; ctl.bar = bar; ctl.toData = toData; ctl.toScreen = sc;
    return ctl;
  }

  root.BeaconDraw = { init, geom, TOOLS, FREE_TOOLS, COLORS, reload() { if (root.BeaconDraw.ctl) root.BeaconDraw.ctl.reload(); } };
})(typeof self !== 'undefined' ? self : this);
