/*  Beacon grafiği: bağımlılıksız canvas mum grafiği.
 *  Mum, hacim, EMA, Bollinger, RSI paneli, tetik işaretleri, stop/hedef bölgeleri,
 *  sürükleyerek kaydırma, sıkıştırarak yakınlaştırma, crosshair, kapanışa geri sayım.
 */
(function (root) {
  'use strict';
  const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtPrice(p) {
    if (!Number.isFinite(p)) return '–';
    const a = Math.abs(p);
    const d = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.1 ? 5 : 6;
    return p.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtAxis(p, step) {
    const d = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) - 1e-9)));
    return p.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  function fmtDuration(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    if (h >= 24) return Math.floor(h / 24) + 'g ' + (h % 24) + 's';
    return h ? `${h}:${pad2(m)}:${pad2(r)}` : `${pad2(m)}:${pad2(r)}`;
  }

  class BeaconChart {
    constructor(canvas, opts = {}) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.d = null;
      this.barW = 7; this.shift = 0; this.rightPad = 6;
      this.layers = { ema: true, bb: false, vol: true, rsi: false, markers: true, pos: true };
      this.hover = -1; this.my = 0;
      this.onHover = opts.onHover || function () {};
      this.sweep = 1; this._raf = 0; this._pts = new Map();
      this.reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.readColors();
      this._bind();
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas.parentElement || canvas);
      this._clock = setInterval(() => { if (this.d && !document.hidden) this.invalidate(); }, 1000);
      this.resize();
    }

    readColors() {
      const cs = getComputedStyle(document.documentElement), g = (n, f) => (cs.getPropertyValue(n).trim() || f);
      this.col = { bull: g('--bull', '#35d6a0'), bear: g('--bear', '#ff6384'), beam: g('--beam', '#ffc25c'),
        foam: g('--foam', '#e9eef8'), fog: g('--fog', '#7e8ba6'), rule: g('--rule', '#1a2438'), grid: g('--grid', '#121b2e'),
        font: g('--font', 'Inter, system-ui, sans-serif') };
    }

    setData(d) {
      const first = !this.d;
      const keepKey = this.d && this.d.key === d.key;
      this.d = d;
      if (!keepKey) { this.shift = 0; this.hover = -1; this.onHover(-1); if (!this.reduced) this.sweep = 0; }
      this._clampShift();
      if (first || !keepKey) this._startSweep();
      this.invalidate();
    }

    setLayers(l) { Object.assign(this.layers, l); this.invalidate(); }
    zoom(f) { this._zoomAt(f, this.W - this.axisW - 20); this.invalidate(); }
    reset() { this.barW = this.W < 420 ? 7 : 9; this.shift = 0; this.invalidate(); }

    resize() {
      const p = this.cv.parentElement || this.cv, r = p.getBoundingClientRect();
      this.W = Math.max(120, Math.floor(r.width)); this.H = Math.max(120, Math.floor(r.height));
      this.dpr = Math.min(3, root.devicePixelRatio || 1);
      this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
      this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
      this.axisW = this.W < 420 ? 66 : 74; this.timeH = 22;
      if (!this._sized) { this._sized = true; this.barW = this.W < 420 ? 7 : 9; }
      this.invalidate();
    }

    invalidate() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); }); }

    _startSweep() {
      if (this.reduced) { this.sweep = 1; return; }
      const t0 = performance.now();
      const step = (t) => { this.sweep = Math.min(1, (t - t0) / 1100); this.invalidate(); if (this.sweep < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }

    /* ——— geometri ——— */
    get n() { return this.d ? this.d.candles.length : 0; }
    get plotW() { return this.W - this.axisW; }
    get R() { return this.n - 1 + this.rightPad - this.shift; }
    x(i) { return this.plotW - this.barW * (this.R - i) - this.barW / 2; }
    idxAt(px) { return Math.round(this.R - (this.plotW - px - this.barW / 2) / this.barW); }
    _clampShift() { const max = Math.max(0, this.n - 1 + this.rightPad - 12); this.shift = Math.max(0, Math.min(max, this.shift)); }

    _zoomAt(f, ax) {
      const nb = Math.max(2.5, Math.min(26, this.barW * f)); if (nb === this.barW) return;
      const ia = this.R - (this.plotW - ax - this.barW / 2) / this.barW;
      this.barW = nb;
      const R2 = ia + (this.plotW - ax - nb / 2) / nb;
      this.shift = this.n - 1 + this.rightPad - R2; this._clampShift();
    }

    /* ——— etkileşim ——— */
    _bind() {
      const cv = this.cv; let moved = false, sx = 0, sy = 0, pinch = 0, lastTap = 0;
      const dist = () => { const a = [...this._pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        this._pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        moved = false; sx = e.offsetX; sy = e.offsetY;
        if (this._pts.size === 2) pinch = dist();
      });
      cv.addEventListener('pointermove', (e) => {
        const p = this._pts.get(e.pointerId);
        if (!p) { if (e.pointerType === 'mouse') this._cross(e.offsetX, e.offsetY); return; }
        const px = p.x; p.x = e.offsetX; p.y = e.offsetY;
        if (this._pts.size === 2) {
          const d = dist(); if (pinch > 0) { const a = [...this._pts.values()]; this._zoomAt(d / pinch, (a[0].x + a[1].x) / 2); } pinch = d; moved = true;
        } else if (Math.abs(e.offsetX - sx) > 4 || moved) {
          moved = true; this.shift += (e.offsetX - px) / this.barW; this._clampShift();
          if (this.hover >= 0 && e.pointerType !== 'mouse') { this.hover = -1; this.onHover(-1); }
        }
        this.invalidate();
      });
      const up = (e) => {
        const had = this._pts.delete(e.pointerId);
        if (!had) return;
        if (!moved && this._pts.size === 0 && Math.abs(e.offsetX - sx) < 6 && Math.abs(e.offsetY - sy) < 6) {
          const now = performance.now();
          if (now - lastTap < 320) { this.reset(); this.hover = -1; this.onHover(-1); lastTap = 0; }
          else { lastTap = now; if (e.pointerType !== 'mouse') this._cross(e.offsetX, e.offsetY, true); }
        }
        if (this._pts.size < 2) pinch = 0;
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && this.hover >= 0) { this.hover = -1; this.onHover(-1); this.invalidate(); } });
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this._zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.offsetX); this.invalidate(); }, { passive: false });
    }

    _cross(px, py, toggle) {
      if (!this.d || px > this.plotW || px < 0) return;
      const i = Math.max(0, Math.min(this.n - 1, this.idxAt(px)));
      if (toggle && this.hover === i) { this.hover = -1; this.onHover(-1); this.invalidate(); return; }
      this.hover = i; this.my = py; this.onHover(i); this.invalidate();
    }

    /* ——— çizim ——— */
    draw() {
      const c = this.ctx, d = this.d;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.W, this.H);
      if (!d || this.n < 2) return;
      const L = this.layers, col = this.col, W = this.W, H = this.H, pw = this.plotW;
      const rsiOn = L.rsi && d.rsi;
      const paneBottom = H - this.timeH;
      const rsiH = rsiOn ? Math.round((paneBottom) * 0.22) : 0;
      const priceTop = 8, priceBot = paneBottom - rsiH - (rsiOn ? 6 : 0);
      const i0 = Math.max(0, Math.floor(this.R - pw / this.barW) - 1), i1 = Math.min(this.n - 1, Math.ceil(this.R));
      const cs = d.candles;

      /* y ölçeği */
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i <= i1; i++) { if (cs[i].l < lo) lo = cs[i].l; if (cs[i].h > hi) hi = cs[i].h; }
      const ov = (arr) => { if (!arr) return; for (let i = i0; i <= i1; i++) { const v = arr[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } };
      if (L.ema) { ov(d.ema20); ov(d.ema50); } if (L.bb) { ov(d.bbUp); ov(d.bbLo); }
      const pos = L.pos ? d.position : null;
      const posActive = pos && (pos.status === 'open' || pos.status === 'open_be' || pos.status === 'pending');
      if (posActive) { for (const v of [pos.sl, pos.tp1, pos.entry]) { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } }
      const span = Math.max(hi - lo, hi * 1e-5), top = hi + span * 0.06, bot = lo - span * (L.vol ? 0.2 : 0.06);
      const y = (p) => priceTop + (top - p) / (top - bot) * (priceBot - priceTop);

      /* ızgara */
      c.lineWidth = 1; c.font = `500 11px ${col.font}`; c.textBaseline = 'middle';
      const step = niceStep((top - bot) / 5);
      c.strokeStyle = col.grid; c.fillStyle = col.fog; c.textAlign = 'right';
      for (let p = Math.ceil(bot / step) * step; p < top; p += step) {
        const yy = Math.round(y(p)) + 0.5; if (yy < priceTop || yy > priceBot) continue;
        c.beginPath(); c.moveTo(0, yy); c.lineTo(pw, yy); c.stroke();
        c.fillText(fmtAxis(p, step), W - 6, yy);
      }
      const tfMs = d.tfMs, stepBars = [1, 2, 3, 4, 6, 8, 12, 24, 48, 96].find((s) => s * this.barW >= 70) || 192;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let i = Math.ceil(i0 / stepBars) * stepBars; i <= i1 + this.rightPad; i += stepBars) {
        const xx = Math.round(this.x(i)) + 0.5; if (xx < 20 || xx > pw - 14) continue;
        const t = new Date(cs[cs.length - 1].t + (i - (cs.length - 1)) * tfMs);
        let label, strong = false;
        if (tfMs < 86400000) { if (t.getHours() === 0 && t.getMinutes() === 0) { label = t.getDate() + ' ' + MONTHS[t.getMonth()]; strong = true; } else label = pad2(t.getHours()) + ':' + pad2(t.getMinutes()); }
        else if (t.getDate() <= stepBars * (tfMs / 86400000) && t.getDate() <= 7 && stepBars > 1) { label = MONTHS[t.getMonth()]; strong = true; }
        else label = String(t.getDate());
        c.strokeStyle = col.grid; c.beginPath(); c.moveTo(xx, priceTop); c.lineTo(xx, paneBottom); c.stroke();
        c.fillStyle = strong ? col.foam : col.fog; c.font = `${strong ? 600 : 500} 11px ${col.font}`;
        c.fillText(label, xx, H - this.timeH / 2);
      }

      /* Bollinger */
      if (L.bb && d.bbUp) {
        c.beginPath(); let started = false;
        for (let i = i0; i <= i1; i++) { const v = d.bbUp[i]; if (!Number.isFinite(v)) continue; const xx = this.x(i), yy = y(v); if (!started) { c.moveTo(xx, yy); started = true; } else c.lineTo(xx, yy); }
        for (let i = i1; i >= i0; i--) { const v = d.bbLo[i]; if (Number.isFinite(v)) c.lineTo(this.x(i), y(v)); }
        c.closePath(); c.fillStyle = 'rgba(126,139,166,.09)'; c.fill();
      }

      /* kırpma: grafik alanı */
      c.save(); c.beginPath(); c.rect(0, 0, pw, paneBottom); c.clip();

      /* pozisyon bölgesi */
      if (pos && pos.entry) {
        const x0 = (pos.j >= this.n ? this.x(this.n - 1) + this.barW / 2 : this.x(pos.j) - this.barW / 2);
        const x1 = pos.exitIdx != null && pos.status === 'closed' ? this.x(pos.exitIdx) + this.barW / 2 : pw;
        if (x1 > 0 && x0 < pw) {
          const ye = y(pos.entry), ys = y(pos.sl), yt2 = y(pos.tp2), yt1 = y(pos.tp1);
          const xa = Math.max(0, x0), w = Math.max(2, x1 - xa);
          c.fillStyle = 'rgba(255,99,132,.12)'; c.fillRect(xa, Math.min(ye, ys), w, Math.abs(ys - ye));
          c.fillStyle = 'rgba(53,214,160,.10)'; c.fillRect(xa, Math.min(ye, yt2), w, Math.abs(yt2 - ye));
          const line = (yy, color, dash, lw = 1) => { c.strokeStyle = color; c.lineWidth = lw; c.setLineDash(dash); c.beginPath(); c.moveTo(xa, Math.round(yy) + 0.5); c.lineTo(xa + w, Math.round(yy) + 0.5); c.stroke(); c.setLineDash([]); };
          line(ye, col.foam, [4, 4]); line(ys, col.bear, [], 1.2); line(yt1, col.bull, [2, 3]); line(yt2, col.bull, [], 1.2);
          c.lineWidth = 1; c.font = `600 10px ${col.font}`; c.textAlign = 'right'; c.textBaseline = 'bottom';
          const tag = (txt, yy, color) => { c.fillStyle = color; c.fillText(txt, xa + w - 4, yy - 2); };
          if (w > 70) { tag('Stop', ys + (ys > ye ? 12 : 0), col.bear); tag('Hedef 1', yt1, col.bull); tag('Hedef 2', yt2 + (yt2 > ye ? 12 : 0), col.bull); }
        }
      }

      /* hacim */
      if (L.vol) {
        let vm = 0; for (let i = i0; i <= i1; i++) if (cs[i].v > vm) vm = cs[i].v;
        const vh = (priceBot - priceTop) * 0.16;
        for (let i = i0; i <= i1; i++) {
          const k = cs[i], hh = vm ? (k.v / vm) * vh : 0;
          c.fillStyle = k.c >= k.o ? 'rgba(53,214,160,.22)' : 'rgba(255,99,132,.22)';
          c.fillRect(this.x(i) - this.barW * 0.35, priceBot - hh, this.barW * 0.7, hh);
        }
      }

      /* EMA */
      const poly = (arr, color, lw, dash) => {
        c.beginPath(); let st = false;
        for (let i = i0; i <= i1; i++) { const v = arr[i]; if (!Number.isFinite(v)) { st = false; continue; } const xx = this.x(i), yy = y(v); if (!st) { c.moveTo(xx, yy); st = true; } else c.lineTo(xx, yy); }
        c.strokeStyle = color; c.lineWidth = lw; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
      };
      if (L.ema) { if (d.ema200) poly(d.ema200, 'rgba(233,238,248,.45)', 1.2, [5, 4]); if (d.ema50) poly(d.ema50, col.beam, 1.5); if (d.ema20) poly(d.ema20, 'rgba(233,238,248,.8)', 1.2); }

      /* mumlar */
      const bw = Math.max(1, Math.floor(this.barW * 0.66));
      for (let i = i0; i <= i1; i++) {
        const k = cs[i], up = k.c >= k.o, xx = Math.round(this.x(i)), color = up ? col.bull : col.bear;
        c.strokeStyle = color; c.fillStyle = color;
        c.beginPath(); c.moveTo(xx + 0.5, Math.round(y(k.h))); c.lineTo(xx + 0.5, Math.round(y(k.l))); c.stroke();
        const yo = Math.round(y(k.o)), yc = Math.round(y(k.c)), bt = Math.min(yo, yc), bh = Math.max(1, Math.abs(yo - yc));
        if (up) { c.globalAlpha = 0.92; c.fillRect(xx - Math.floor(bw / 2), bt, bw, bh); c.globalAlpha = 1; }
        else c.fillRect(xx - Math.floor(bw / 2), bt, bw, bh);
      }

      /* tetik işaretleri */
      if (L.markers && d.markers) {
        for (const m of d.markers) {
          if (m.i < i0 || m.i > i1) continue;
          const xx = this.x(m.i), k = cs[m.i], long = m.side === 'long', s = Math.max(5, Math.min(9, this.barW * 0.9));
          const yy = long ? y(k.l) + 8 + s : y(k.h) - 8 - s, color = long ? col.bull : col.bear;
          c.save(); c.shadowColor = color; c.shadowBlur = 12; c.fillStyle = color; c.beginPath();
          if (long) { c.moveTo(xx, yy - s); c.lineTo(xx - s, yy + s * 0.7); c.lineTo(xx + s, yy + s * 0.7); }
          else { c.moveTo(xx, yy + s); c.lineTo(xx - s, yy - s * 0.7); c.lineTo(xx + s, yy - s * 0.7); }
          c.closePath(); c.fill(); c.restore();
        }
      }

      /* son fiyat çizgisi */
      const lastK = cs[cs.length - 1], ly = y(lastK.c), up = lastK.c >= lastK.o, lcol = up ? col.bull : col.bear;
      c.strokeStyle = lcol; c.globalAlpha = 0.55; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(0, Math.round(ly) + 0.5); c.lineTo(pw, Math.round(ly) + 0.5); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;

      /* fener süpürmesi: yalnızca veri değişince bir kez */
      if (this.sweep < 1) {
        const sx = -80 + (pw + 160) * (1 - Math.pow(1 - this.sweep, 3)), g = c.createLinearGradient(sx - 70, 0, sx + 70, 0);
        g.addColorStop(0, 'rgba(255,194,92,0)'); g.addColorStop(0.5, 'rgba(255,194,92,.16)'); g.addColorStop(1, 'rgba(255,194,92,0)');
        c.fillStyle = g; c.fillRect(sx - 70, 0, 140, paneBottom);
      }
      c.restore();

      /* son fiyat etiketi + geri sayım */
      if (ly > priceTop - 4 && ly < priceBot + 4) {
        c.fillStyle = lcol; c.fillRect(pw, ly - 10, this.axisW, 20);
        c.fillStyle = '#06101a'; c.font = `700 11px ${col.font}`; c.textAlign = 'right'; c.textBaseline = 'middle';
        let lt = fmtPrice(lastK.c);
        if (c.measureText(lt).width > this.axisW - 8) lt = lastK.c.toLocaleString('tr-TR', { maximumFractionDigits: lastK.c >= 1000 ? 0 : 2 });
        c.fillText(lt, W - 5, ly);
        const left = lastK.t + tfMs - Date.now();
        if (left > 0) { c.fillStyle = col.fog; c.font = `500 10px ${col.font}`; c.fillText(fmtDuration(left), W - 5, ly + 17); }
      }

      /* RSI paneli */
      if (rsiOn) {
        const t0 = priceBot + 6, t1 = paneBottom, ry = (v) => t0 + (100 - v) / 100 * (t1 - t0);
        c.strokeStyle = col.rule; c.beginPath(); c.moveTo(0, t0 - 3.5); c.lineTo(W, t0 - 3.5); c.stroke();
        c.fillStyle = 'rgba(126,139,166,.07)'; c.fillRect(0, ry(70), pw, ry(30) - ry(70));
        c.strokeStyle = col.grid; for (const v of [30, 70]) { c.beginPath(); c.moveTo(0, Math.round(ry(v)) + 0.5); c.lineTo(pw, Math.round(ry(v)) + 0.5); c.stroke(); }
        c.fillStyle = col.fog; c.font = `500 10px ${col.font}`; c.textAlign = 'right'; c.textBaseline = 'middle';
        for (const v of [30, 70]) c.fillText(String(v), W - 6, ry(v));
        c.save(); c.beginPath(); c.rect(0, t0, pw, t1 - t0); c.clip();
        c.beginPath(); let st = false;
        for (let i = i0; i <= i1; i++) { const v = d.rsi[i]; if (!Number.isFinite(v)) { st = false; continue; } const xx = this.x(i), yy = ry(v); if (!st) { c.moveTo(xx, yy); st = true; } else c.lineTo(xx, yy); }
        c.strokeStyle = col.beam; c.lineWidth = 1.4; c.stroke(); c.lineWidth = 1; c.restore();
        c.font = `600 10px ${col.font}`; c.fillStyle = col.beam; c.textAlign = 'left'; c.fillText('RSI 14', 6, t0 + 9);
      }

      /* crosshair */
      if (this.hover >= 0) {
        const hx = Math.round(this.x(this.hover)) + 0.5;
        c.strokeStyle = 'rgba(233,238,248,.35)'; c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(hx, priceTop); c.lineTo(hx, paneBottom); c.stroke();
        if (this.my >= priceTop && this.my <= priceBot) {
          c.beginPath(); c.moveTo(0, Math.round(this.my) + 0.5); c.lineTo(pw, Math.round(this.my) + 0.5); c.stroke();
          const pv = top - (this.my - priceTop) / (priceBot - priceTop) * (top - bot);
          c.setLineDash([]); c.fillStyle = col.foam; c.fillRect(pw, this.my - 10, this.axisW, 20);
          c.fillStyle = '#06101a'; c.font = `700 11px ${col.font}`; c.textAlign = 'right'; c.textBaseline = 'middle'; let ct = fmtPrice(pv);
          if (c.measureText(ct).width > this.axisW - 8) ct = pv.toLocaleString('tr-TR', { maximumFractionDigits: pv >= 1000 ? 0 : 2 });
          c.fillText(ct, W - 5, this.my);
        }
        c.setLineDash([]);
      }
    }

    destroy() { clearInterval(this._clock); this._ro.disconnect(); }
  }

  root.BeaconChart = BeaconChart;
  root.BeaconFmt = { fmtPrice, fmtDuration };
})(typeof self !== 'undefined' ? self : this);
