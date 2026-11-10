/*  Beacon: arayüz ve uygulama mantığı */
(function () {
  'use strict';
  const B = window.Beacon, F = window.BeaconFormation, SC = window.BeaconScript, D = window.BeaconData, CFG = window.BEACON_CONFIG || {};
  const { fmtPrice } = window.BeaconFmt;
  const $ = (id) => document.getElementById(id);
  const tg = window.Telegram && window.Telegram.WebApp;
  const DEMO = /[?&]demo=1/.test(location.search);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MIN = 60000;
  const TFL = (tf) => B.TF[tf].label;
  const isNum = Number.isFinite;

  /* ——— Telegram ——— */
  if (tg) {
    try {
      tg.ready(); tg.expand();
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      tg.setHeaderColor && tg.setHeaderColor('#060a12');
      tg.setBackgroundColor && tg.setBackgroundColor('#060a12');
      tg.setBottomBarColor && tg.setBottomBarColor('#060a12');
    } catch (e) { /* eski istemci */ }
  }
  const haptic = (k) => { try { if (!tg || !tg.HapticFeedback) return; k === 'ok' ? tg.HapticFeedback.notificationOccurred('success') : tg.HapticFeedback.impactOccurred('light'); } catch (e) {} };

  /* ——— kalıcı durum (localStorage + Telegram CloudStorage) ——— */
  const DEF = { legal: false, sym: 'BTC', tf: '1h', layers: { markers: true, pos: true, form: true, ema: true, vol: true, bb: false, rsi: false }, form: { pivot: 10, tol: 1.5, history: true, maxForms: 120 }, proUntil: 0, ads: { d: '', n: 0 }, custom: [], ts: 0 };
  let S = JSON.parse(JSON.stringify(DEF));
  try { const r = JSON.parse(localStorage.getItem('bcn') || 'null'); if (r) S = Object.assign(S, r, { layers: Object.assign({}, DEF.layers, r.layers || {}) }); } catch (e) {}
  S.form = Object.assign({}, DEF.form, S.form);
  if (S.sym === 'TON') S.sym = 'GRAM'; // Toncoin'in yeni adı
  function save() {
    S.ts = Date.now();
    const j = JSON.stringify(S);
    try { localStorage.setItem('bcn', j); } catch (e) {}
    try { tg && tg.CloudStorage && tg.CloudStorage.setItem('bcn', j, () => {}); } catch (e) {}
  }
  try {
    tg && tg.CloudStorage && tg.CloudStorage.getItem('bcn', (err, v) => {
      if (err || !v) return;
      try { const c = JSON.parse(v); if (c && c.ts > S.ts) { S = Object.assign(S, c, { layers: Object.assign({}, DEF.layers, c.layers || {}) }); S.form = Object.assign({}, DEF.form, S.form); applyState(); if (cur) refreshFormation(); } } catch (e) {}
    });
  } catch (e) {}

  /* kimlik: Telegram'ın verdiği bilgi, doğrulanmaz (bkz. config.js güvenlik notu) */
  const uid = (() => { try { const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; return u ? Number(u.id) || 0 : 0; } catch (e) { return 0; } })();
  const API = window.BeaconApi || { on: false };
  const srv = () => !!API.on;
  const isOwner = () => (srv() ? !!(API.me && API.me.is_admin) : !!uid && (CFG.ownerIds || []).map(Number).includes(uid));
  const myGrant = () => (uid ? (CFG.grants || []).find((g) => Number(g.id) === uid && (!g.until || Date.parse(g.until + 'T23:59:59Z') > Date.now())) || null : null);
  const srvPro = () => { const p = API.me && API.me.pro; return !!p && p.active && (!p.until || p.until * 1000 > Date.now()); };
  const isPro = () => (srv() ? srvPro() : isOwner() || !!myGrant() || S.proUntil > Date.now());
  const today = () => new Date().toISOString().slice(0, 10);
  const adsUsed = () => (srv() ? (API.me ? API.me.ads.pro_used : 0) : S.ads.d === today() ? S.ads.n : 0);
  const coinOf = (s) => D.COINS.find((c) => c.s === s) || D.COINS[0];
  const allowed = (s) => coinOf(s).free || isPro();

  /* ——— küçük yardımcılar ——— */
  const sgn = (x, d = 0) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
  const sgnR = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2) + 'R';
  const pct = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
  const dt = (t) => new Date(t).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : 'dim');
  function ago(t) {
    const m = Math.max(0, Math.round((Date.now() - t) / MIN));
    if (m < 60) return m + ' dk önce';
    const h = Math.round(m / 60);
    return h < 48 ? h + ' sa önce' : Math.round(h / 24) + ' gün önce';
  }
  let toastT = 0;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2800); }
  function tween(a, b, ms, cb) {
    if (REDUCED || !isNum(a)) { cb(b); return; }
    const t0 = performance.now();
    const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); cb(a + (b - a) * e); if (k < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }
  const VCOL = { bull2: 'var(--bull)', bull1: 'var(--bull)', flat: 'var(--mist)', bear1: 'var(--bear)', bear2: 'var(--bear)', na: 'var(--fog)' };

  /* ——— Beacon kadranı (SVG) ——— */
  const CX = 130, CY = 130, DEG = 1.1;
  const polar = (deg, r) => [CX + r * Math.sin(deg * Math.PI / 180), CY - r * Math.cos(deg * Math.PI / 180)];
  const ticks = [];
  (function buildDial() {
    const svg = $('dial'); let h = '';
    const [ax, ay] = polar(-110, 108), [bx, by] = polar(110, 108);
    h += `<path d="M${ax} ${ay} A108 108 0 1 1 ${bx} ${by}" fill="none" stroke="#121b2e" stroke-width="2" stroke-linecap="round"/>`;
    for (let s = -100; s <= 100; s += 5) {
      const maj = s % 25 === 0, [x1, y1] = polar(s * DEG, maj ? 82 : 88), [x2, y2] = polar(s * DEG, 100);
      h += `<line class="tickl${maj ? ' maj' : ''}" data-s="${s}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    }
    h += `<path d="M130 22l4 6-4 6-4-6z" fill="#ffc25c" opacity=".0"/>`;
    h += `<g id="ptr" style="transform:rotate(-110deg)"><path d="M130 20L123.5 8.5h13z" fill="#ffc25c"/></g>`;
    svg.innerHTML = h;
    svg.querySelectorAll('.tickl').forEach((n) => { n.style.transitionDelay = (Math.abs(+n.dataset.s) * 7) + 'ms'; ticks.push(n); });
  })();
  let shownScore = NaN, firstDial = true;
  function setDial(score) {
    if (!isNum(score)) return;
    const v = B.verdict(score);
    $('ptr').style.transform = `rotate(${(Math.max(-100, Math.min(100, score)) * DEG).toFixed(1)}deg)`;
    for (const n of ticks) {
      const s = +n.dataset.s, lit = score >= 0 ? s > 0 && s <= score : s < 0 && s >= score;
      n.style.stroke = lit ? (s > 0 ? 'var(--bull)' : 'var(--bear)') : '';
    }
    const from = isNum(shownScore) ? shownScore : 0;
    tween(from, score, 700, (x) => { $('score').textContent = x >= 0.5 ? '+' + Math.round(x) : x <= -0.5 ? '−' + Math.round(-x) : '0'; });
    shownScore = score;
    const ve = $('verd'); ve.textContent = v.text; ve.style.color = VCOL[v.key];
    if (firstDial && !REDUCED) { firstDial = false; const fx = $('beamfx'); fx.classList.add('go'); }
  }
  const FACT = [['T', 'Trend'], ['M', 'Momentum'], ['V', 'Hacim'], ['K', 'Yapı']];
  $('facts').innerHTML = FACT.map(([k, n]) => `<div class="fact"><span>${n}</span><div class="bar"><i id="fb-${k}"></i></div><span class="v num" id="fv-${k}">–</span></div>`).join('');
  function setFacts(parts) {
    for (const [k] of FACT) {
      const v = parts[k], i = $('fb-' + k);
      if (!isNum(v)) continue;
      const w = Math.min(1, Math.abs(v)) * 50;
      i.style.width = w + '%'; i.style.left = (v >= 0 ? 50 : 50 - w) + '%'; i.style.background = v >= 0 ? 'var(--bull)' : 'var(--bear)';
      const e = $('fv-' + k); e.textContent = sgn(Math.round(v * 100)); e.className = 'v num ' + cls(v);
    }
  }

  /* ——— analiz ——— */
  function calc(candles, tf) {
    const cfg = B.TF[tf], nc = D.closedCount(candles, cfg.ms);
    if (nc < B.P.warm + 20) return null;
    const closed = nc === candles.length ? candles : candles.slice(0, nc);
    const a = B.analyze(closed), sigs = B.findSignals(a, closed);
    return { cfg, nc, closed, a, sigs, i: nc - 1, score: a.score[nc - 1] };
  }

  /* ——— Radar ——— */
  const chart = new window.BeaconChart($('cv'), { onHover });
  chart.setLayers(S.layers);
  let cur = null, reqId = 0, liveOk = false;

  function setLive(ok, text) {
    liveOk = ok; const el = $('live'); el.className = 'live ' + (ok ? 'ok' : 'err');
    el.querySelector('span').textContent = text || (ok ? 'canlı' : 'bağlantı yok');
  }
  function chartError(msg) {
    $('skel').style.display = 'none';
    const m = $('chartMsg'); m.innerHTML = '';
    const p = document.createElement('div'); p.textContent = msg; m.appendChild(p);
    const b = document.createElement('button'); b.textContent = 'Tekrar dene'; b.onclick = () => loadRadar(); p.appendChild(document.createElement('br')); p.appendChild(b);
    m.classList.add('on');
  }

  async function loadRadar() {
    const id = ++reqId, { sym, tf } = S;
    $('chartMsg').classList.remove('on');
    if (!cur || cur.key !== sym + '|' + tf) $('skel').style.display = '';
    try {
      const candles = await D.load(sym, tf, 20000);
      if (id !== reqId) return;
      applyRadar(sym, tf, candles);
      setLive(true);
    } catch (e) {
      if (id !== reqId) return;
      setLive(false);
      if (!cur || cur.key !== sym + '|' + tf) chartError('Fiyat verisine ulaşılamadı. Bağlantınızı kontrol edin; bazı ağlar borsa adreslerini engelleyebilir.');
    }
    loadHorizons(sym, id);
  }

  function applyRadar(sym, tf, candles) {
    const r = calc(candles, tf);
    if (!r) { chartError('Bu zaman dilimi için yeterli geçmiş veri yok.'); return; }
    const sim = B.simulate(candles, r.sigs, tf);
    const last = sim.trades[sim.trades.length - 1] || null;
    const a = r.a;
    cur = { key: sym + '|' + tf, sym, tf, candles, r, trade: last, sim };
    const sc = F.scan(r.closed, S.form); cur.formation = sc.current; cur.hist = sc.history;
    cur.data = {
      key: cur.key, candles, tfMs: r.cfg.ms,
      ema20: a.ema20, ema50: a.ema50, ema200: a.ema200, rsi: a.rsi, bbUp: a.bbUp, bbLo: a.bbLo,
      markers: r.sigs.map((s) => ({ i: s.i, side: s.side })), position: last, formation: cur.formation, formHistory: S.form.history ? cur.hist : [],
      custom: customPlots(candles),
    };
    chart.setData(cur.data);
    $('skel').style.display = 'none'; $('chartMsg').classList.remove('on');

    const lc = candles[candles.length - 1];
    const ref = [...candles].reverse().find((k) => k.t <= Date.now() - 86400000) || candles[0];
    const ch = lc.c / ref.c - 1, pe = $('price');
    if (pe.dataset.v && +pe.dataset.v !== lc.c) { pe.style.color = lc.c > +pe.dataset.v ? 'var(--bull)' : 'var(--bear)'; setTimeout(() => { pe.style.color = ''; }, 500); }
    pe.dataset.v = lc.c; pe.textContent = fmtPrice(lc.c);
    const ce = $('chg'); ce.textContent = pct(ch, 2) + ' · 24s'; ce.className = 'num ' + cls(ch);

    setDial(r.score); setFacts({ T: a.T[r.i], M: a.M[r.i], V: a.V[r.i], K: a.K[r.i] });
    const reg = a.regime[r.i], rt = reg === 2 ? 'Güçlü trend ortamı' : reg === 1 ? 'Trend ortamı' : 'Yatay, trendsiz ortam';
    $('regime').textContent = rt + (a.squeeze[r.i] ? ' · volatilite sıkışmış' : '');
    renderTrigger(); renderFormation();
  }

  function renderTrigger() {
    const el = $('trig'), t = cur && cur.trade;
    if (!t) { el.innerHTML = '<div class="trig-h"><span class="badge flat">Tetik yok</span></div><p class="note" style="margin-top:10px">Bu pencerede henüz tetik oluşmadı. Tetik için skorun ±40 eşiğini kapanmış mumda kesmesi gerekir.</p>'; return; }
    const long = t.side === 'long', st = t.status, fp = fmtPrice;
    const exitTxt = { SL: 'Geçersizlik seviyesi tetiklendi', BE: 'Hedef 1 sonrası girişte kapandı', TP2: 'Hedef 2 ulaşıldı', TIME: 'Süre doldu, kapanışla çıkıldı' };
    const stTxt = st === 'closed' ? exitTxt[t.exit] : st === 'open_be' ? 'Hedef 1 geçildi · stop girişte' : 'Senaryo geçerli';
    el.innerHTML =
      `<div class="trig-h"><span class="badge ${long ? 'long' : 'short'}">${long ? 'Yükseliş tetiği' : 'Düşüş tetiği'}</span><span class="dim num" style="font-size:12.5px">${TFL(cur.tf)} · ${ago(t.t)}</span></div>` +
      `<div class="lvls num"><div><span>Giriş ref.</span><b>${fp(t.entry)}</b></div><div><span>Geçersizlik</span><b class="down">${fp(t.sl)}</b></div><div><span>Hedef 1</span><b class="up">${fp(t.tp1)}</b></div><div><span>Hedef 2</span><b class="up">${fp(t.tp2)}</b></div></div>` +
      `<div class="trig-st">${stTxt} <span class="num ${cls(t.R)}">${st === 'closed' ? '· ' : '· şu an '}${sgnR(t.R)}</span></div>` +
      `<p class="note" style="margin-top:8px">${dt(t.t)} mumunun açılışı referans alındı. Seviyeler ATR'ye dayanır; bir senaryodur, işlem çağrısı değildir.</p>`;
  }

  const fp2 = (x) => (isNum(x) ? fmtPrice(x) : '–');
  function renderFormation() {
    const el = $('form'), f = cur && cur.formation;
    const nh = S.form.history && cur && cur.hist ? cur.hist.length : 0;
    const histNote = nh ? ` Grafikte ${nh} geçmiş formasyonun çizgileri soluk renkte duruyor; destek ve direnç bölgesi olarak kullanabilirsiniz.` : '';
    if (!f) { el.innerHTML = '<div class="trig-h"><span class="badge flat">Aktif formasyon yok</span></div><p class="note" style="margin-top:10px">Son pivotlar bilinen bir yapı oluşturmuyor. Hassasiyeti ayarlardan değiştirebilirsiniz.' + histNote + '</p>'; return; }
    const tone = /Yukarı/.test(f.status) ? 'up' : /Aşağı/.test(f.status) ? 'down' : '';
    const lv = [];
    if (f.levels.upper != null) lv.push(['Üst çizgi', f.levels.upper]);
    if (f.levels.lower != null) lv.push(['Alt çizgi', f.levels.lower]);
    if (f.levels.neck != null) lv.push(['Boyun çizgisi', f.levels.neck]);
    const pt = cur.candles[f.lastPivot] ? cur.candles[f.lastPivot].t : Date.now();
    el.innerHTML =
      `<div class="trig-h"><span class="badge" style="color:${f.color};background:${f.color}22">${f.name}</span><span class="dim num" style="font-size:12.5px">${TFL(cur.tf)} · son pivot ${ago(pt)}</span></div>` +
      `<div class="trig-st"><span class="${tone}">${f.status}</span> <span class="dim" style="font-weight:500">· ${f.bias}</span></div>` +
      `<div class="fm-lv num" style="grid-template-columns:repeat(${lv.length},1fr)">${lv.map(([n, v]) => `<div><span>${n}</span><b>${fp2(v)}</b></div>`).join('')}</div>` +
      '<p class="note">Çizgiler son iki tepe ve son iki dipten otomatik çizilir. Formasyonlar öznel yapılardır, kırılımlar yanıltıcı olabilir. İşlem çağrısı değildir.' + histNote + '</p>';
  }
  function refreshFormation() {
    if (!cur || !cur.data) return;
    const sc = F.scan(cur.r.closed, S.form); cur.formation = sc.current; cur.hist = sc.history;
    cur.data.formation = cur.formation; cur.data.formHistory = S.form.history ? cur.hist : [];
    chart.setData(cur.data); renderFormation();
  }

  function onHover(i) {
    const tip = $('tip');
    if (i < 0 || !cur) { tip.classList.remove('on'); return; }
    const k = cur.candles[i]; if (!k) return;
    const ch = k.c / k.o - 1, sc = cur.r.a.score[i];
    tip.innerHTML = `<span>${dt(k.t)}</span><span>A <b>${fmtPrice(k.o)}</b></span><span>Y <b>${fmtPrice(k.h)}</b></span><span>D <b>${fmtPrice(k.l)}</b></span><span>K <b>${fmtPrice(k.c)}</b></span><span class="${cls(ch)}">${pct(ch, 2)}</span>${isNum(sc) ? `<span>Skor <b>${sgn(Math.round(sc))}</b></span>` : ''}`;
    tip.classList.add('on');
  }

  /* vade kartları */
  let hzBusy = 0;
  async function loadHorizons(sym, id) {
    const my = ++hzBusy, scores = {};
    await Promise.all(D.TFS.map(async (tf) => {
      try { const c = await D.load(sym, tf, 40000), r = calc(c, tf); if (r && isNum(r.score)) scores[tf] = r.score; } catch (e) {}
    }));
    if (my !== hzBusy || sym !== S.sym) return;
    const put = (h, s, d, m, tfs) => {
      const v = B.horizonScore(scores, h), vd = B.verdict(v);
      $(s).textContent = isNum(v) ? sgn(Math.round(v)) : '–'; $(s).className = 's num ' + (isNum(v) ? cls(v) : 'dim');
      $(d).textContent = vd.text; $(d).style.color = VCOL[vd.key];
      $(m).textContent = tfs.map((t) => TFL(t) + ' ' + (isNum(scores[t]) ? sgn(Math.round(scores[t])) : '–')).join('   ');
    };
    put('short', 'hsS', 'hdS', 'hmS', ['15m', '1h']); put('long', 'hsL', 'hdL', 'hmL', ['4h', '1d', '1w']);
  }

  /* ——— Tarayıcı ——— */
  let sortBy = 'def'; const scan = {};
  function heatBg(s) { const k = Math.min(1, Math.abs(s) / 80); return `rgba(${s >= 0 ? '53,214,160' : '255,99,132'},${(0.08 + 0.62 * k).toFixed(2)})`; }
  const LOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';
  function renderHeat() {
    const pro = isPro(); let coins = D.COINS.slice();
    if (sortBy !== 'def') {
      const key = (c) => { const v = B.horizonScore(scan[c.s] || {}, sortBy); return isNum(v) ? Math.abs(v) : -1; };
      coins.sort((a, b) => key(b) - key(a));
    }
    let h = `<div class="hrow head"><span></span>${D.TFS.map((t) => `<span>${TFL(t)}</span>`).join('')}</div>`;
    for (const c of coins) {
      const ok = c.free || pro;
      h += `<div class="hrow"><div class="hname"><div>${c.s}<small>${c.n}</small></div></div>`;
      for (const tf of D.TFS) {
        const v = (scan[c.s] || {})[tf];
        if (!ok) h += `<button class="cell lock" data-lock="1" aria-label="${c.s} Pro ile açılır">${LOCK}</button>`;
        else if (isNum(v)) h += `<button class="cell num" data-s="${c.s}" data-tf="${tf}" style="background:${heatBg(v)}" aria-label="${c.n} ${TFL(tf)} skor ${sgn(Math.round(v))}">${sgn(Math.round(v))}</button>`;
        else h += `<div class="cell na">${(scan.__err || {})[c.s + tf] ? '–' : '·'}</div>`;
      }
      h += '</div>';
    }
    $('heat').innerHTML = h;
  }
  let scanRaf = 0;
  const rescan = () => { if (!scanRaf) scanRaf = requestAnimationFrame(() => { scanRaf = 0; renderHeat(); }); };
  async function buildScan() {
    renderHeat();
    const pro = isPro(), jobs = [];
    D.COINS.forEach((c) => { if (c.free || pro) D.TFS.forEach((tf) => jobs.push({ sym: c.s, tf })); });
    scan.__err = {};
    await D.loadMany(jobs, (j, candles, err) => {
      if (err) { scan.__err[j.sym + j.tf] = 1; rescan(); return; }
      const r = calc(candles, j.tf);
      (scan[j.sym] = scan[j.sym] || {})[j.tf] = r ? r.score : NaN;
      rescan();
    });
    renderHeat();
  }
  $('heat').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    haptic();
    if (b.dataset.lock) { toast('Bu coin Pro ile açılır'); go('pro'); return; }
    S.sym = b.dataset.s; S.tf = b.dataset.tf; save(); applyState(); go('radar'); loadRadar();
  });
  $('sortChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    sortBy = b.dataset.sort; haptic();
    $('sortChips').querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderHeat();
  });

  /* ——— Performans ——— */
  let perfTf = '1h', lastEq = null;
  const EXIT = { SL: 'Stop', BE: 'Girişte', TP2: 'Hedef 2', TIME: 'Süre' };
  async function buildPerf() {
    const sym = S.sym; $('perfTitle').textContent = `${sym}/USDT · ${TFL(perfTf)} geriye dönük test`;
    if (!allowed(sym)) { $('kpis').innerHTML = '<p class="note">Bu coin Pro ile açılır.</p>'; return; }
    $('kpis').innerHTML = '<p class="note">Hesaplanıyor…</p>';
    let candles;
    try { candles = await D.load(sym, perfTf, 60000); } catch (e) { $('kpis').innerHTML = '<p class="note">Veriye ulaşılamadı.</p>'; return; }
    if (sym !== S.sym) return;
    const r = calc(candles, perfTf); if (!r) { $('kpis').innerHTML = '<p class="note">Yeterli veri yok.</p>'; return; }
    const sim = B.simulate(r.closed, r.sigs, perfTf), st = sim.stats, tr = sim.trades.filter((t) => t.status === 'closed');
    let eq = 1, peak = 1, dd = 0; for (const t of tr) { eq *= 1 + 0.01 * t.R; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
    const k = (l, v, c) => `<div class="kpi"><span>${l}</span><b class="num ${c || ''}">${v}</b></div>`;
    const none = st.n === 0;
    $('kpis').innerHTML =
      k('İşlem', st.n) + k('Kazanma oranı', none ? '–' : (st.winRate * 100).toFixed(0) + '%') +
      k('Profit factor', none ? '–' : (isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : '∞'), none ? '' : st.profitFactor >= 1 ? 'up' : 'down') +
      k('Toplam R', none ? '–' : sgnR(st.sumR).replace('R', ''), none ? '' : cls(st.sumR)) + k('Ort. R', none ? '–' : sgn(st.avgR, 2), none ? '' : cls(st.avgR)) +
      k('Maks. düşüş', none ? '–' : st.maxDD.toFixed(1) + 'R') +
      k('%1 risk ile', none ? '–' : pct(eq - 1), none ? '' : cls(eq - 1)) + k('Al ve tut', isNum(st.buyHold) ? pct(st.buyHold) : '–', cls(st.buyHold)) +
      k('Piyasada', (st.exposure * 100).toFixed(0) + '%');
    const days = Math.round((r.closed[r.nc - 1].t - r.closed[B.P.warm].t) / 86400000);
    $('eqNote').textContent = `Test penceresi: son ${days} gün (ilk ${B.P.warm} mum indikatör ısınması). Her işlemde sermayenin %1'i riske edilmiş varsayıldığında en kötü düşüş ${(dd * 100).toFixed(1)}%.`;
    $('perfWarn').textContent = st.n < 30
      ? `Yalnızca ${st.n} işlem var. Bu örneklem istatistiksel olarak anlamlı değildir; kazanma oranı ve getiri şansa bağlı olabilir.`
      : 'Bu sonuçlar tek bir geçmiş pencereye aittir ve farklı piyasa koşullarında değişir. Geçmiş performans gelecekteki sonucu garanti etmez.';
    $('tradeList').innerHTML = tr.slice(-15).reverse().map((t) => `<li><span class="num">${dt(t.t)}</span><span class="badge ${t.side}">${t.side === 'long' ? 'Yükseliş' : 'Düşüş'} · ${EXIT[t.exit] || ''}</span><b class="num ${cls(t.R)}">${sgnR(t.R)}</b></li>`).join('') || '<li><span class="dim">Bu pencerede kapanmış işlem yok.</span></li>';
    lastEq = tr.map((t) => t.R); drawEq();
  }
  function drawEq() {
    const cv = $('eq'), r = cv.getBoundingClientRect(); if (!r.width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1), W = r.width, H = 150;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const font = '500 11px Inter, system-ui, sans-serif'; c.font = font;
    if (!lastEq || !lastEq.length) { c.fillStyle = '#7e8ba6'; c.textAlign = 'center'; c.fillText('Kapanmış işlem yok', W / 2, H / 2); return; }
    const pts = [0]; lastEq.forEach((x) => pts.push(pts[pts.length - 1] + x));
    const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), sp = Math.max(1, hi - lo);
    const X = (i) => 6 + (pts.length === 1 ? 0 : i / (pts.length - 1)) * (W - 56), Y = (v) => 10 + (hi + sp * 0.05 - v) / (sp * 1.1) * (H - 20);
    c.strokeStyle = '#1a2438'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(W, Y(0)); c.stroke(); c.setLineDash([]);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,194,92,.22)'); g.addColorStop(1, 'rgba(255,194,92,0)');
    c.beginPath(); pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)))); c.lineTo(X(pts.length - 1), Y(0)); c.lineTo(X(0), Y(0)); c.closePath(); c.fillStyle = g; c.fill();
    c.beginPath(); pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)))); c.strokeStyle = '#ffc25c'; c.lineWidth = 1.8; c.lineJoin = 'round'; c.stroke();
    const e = pts[pts.length - 1]; c.fillStyle = '#ffc25c'; c.beginPath(); c.arc(X(pts.length - 1), Y(e), 3.5, 0, 7); c.fill();
    c.fillStyle = e >= 0 ? '#35d6a0' : '#ff6384'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = '600 12px Inter, system-ui, sans-serif'; c.fillText(sgnR(e), X(pts.length - 1) + 9, Y(e));
  }
  window.addEventListener('resize', () => { if (view === 'perf') drawEq(); });
  $('perfTf').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tf]'); if (!b) return;
    perfTf = b.dataset.tf; haptic(); $('perfTf').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); buildPerf();
  });

  /* ——— Pro ve Adsgram ——— */
  let adCtl = null, adBusy = false;
  function adController() {
    if (adCtl) return adCtl;
    if (window.Adsgram && CFG.adsgramBlockId) { try { adCtl = window.Adsgram.init({ blockId: String(CFG.adsgramBlockId) }); } catch (e) { adCtl = null; } }
    return adCtl;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function watchAd() {
    if (adBusy) return;
    if (srv()) return watchAdServer();
    if (adsUsed() >= CFG.adsPerDay) { toast('Bugünkü reklam hakkınız doldu'); return; }
    if (S.proUntil - Date.now() >= (CFG.proMaxMinutes - 1) * MIN) { toast('Pro süresi üst sınırda'); return; }
    adBusy = true; renderPro(); haptic();
    let ok = false;
    try {
      if (DEMO) { toast('Demo reklam oynatılıyor…'); await sleep(1800); ok = true; }
      else {
        const c = adController();
        if (!c) toast(CFG.adsgramBlockId ? 'Reklam servisi yüklenemedi, biraz sonra tekrar deneyin' : 'Reklam birimi tanımlı değil');
        else { const r = await c.show(); ok = !!(r && r.done); if (!ok) toast('Reklam tamamlanmadı, Pro eklenmedi'); }
      }
    } catch (e) { toast('Reklam gösterilemedi' + (e && e.description ? ': ' + e.description : '')); }
    adBusy = false;
    if (ok) {
      const now = Date.now();
      S.proUntil = Math.min(Math.max(now, S.proUntil) + CFG.proMinutesPerAd * MIN, now + CFG.proMaxMinutes * MIN);
      S.ads = { d: today(), n: adsUsed() + 1 }; save(); haptic('ok'); toast(`Pro ${CFG.proMinutesPerAd >= 60 ? CFG.proMinutesPerAd / 60 + ' saat' : CFG.proMinutesPerAd + ' dakika'} uzatıldı`);
      if (view === 'scan') buildScan();
    }
    renderPro();
  }
  /* sunucu modu: reklam oturumu sunucuda açılır, Adsgram Reward URL bildirimi doğrulanınca Pro verilir */
  async function adForSession(placement, postId) {
    const r = await API.call('POST', '/api/ads/start', { placement, post_id: postId || 0 });
    let shown = false;
    if (DEMO) { await sleep(1500); await API.call('POST', '/api/dev/reward', {}); shown = true; }
    else {
      const c = adController();
      if (!c) throw new Error(CFG.adsgramBlockId || (API.me && API.me.config.adsgram_block_id) ? 'Reklam servisi yüklenemedi' : 'Reklam birimi tanımlı değil');
      const x = await c.show(); shown = !!(x && x.done);
    }
    if (!shown) throw new Error('Reklam tamamlanmadı');
    for (let i = 0; i < 8; i++) {
      const st = await API.call('GET', '/api/ads/status?session=' + encodeURIComponent(r.session));
      if (st.status === 'verified') return true;
      await sleep(1200);
    }
    throw new Error('Reklam doğrulanamadı, biraz sonra tekrar deneyin');
  }
  async function watchAdServer() {
    adBusy = true; renderPro(); haptic();
    try { await adForSession('pro_owner'); await API.refreshMe(); haptic('ok'); toast('Pro süresi uzatıldı'); if (view === 'scan') buildScan(); }
    catch (e) { toast(e.message || 'Reklam gösterilemedi'); }
    adBusy = false; renderPro();
  }
  function renderProServer() {
    const me = API.me;
    if (API.web) {
      $('adBtn').hidden = true; $('starsBtn').hidden = true;
      if (!me) { $('proState').textContent = 'Kapalı'; $('proState').className = 'st num'; $('proSub').textContent = 'Pro için Telegram ile giriş yapın. Pro süresi Telegram uygulamasında reklam izleyerek kazanılır; hesabınız aynıdır.'; return; }
    }
    if (!me) return;
    $('myId').textContent = String(me.id);
    $('ownerSec').hidden = true; $('legacyOwner').hidden = true;
    const p = me.pro, a = me.ads, st = $('proState'), fixed = p.active && p.source !== 'ads';
    $('adBtn').hidden = fixed || !!API.web; $('starsBtn').hidden = fixed || !!API.web;
    const hrs = Math.round(a.pro_seconds_per_ad / 3600 * 10) / 10, cap = Math.round(a.pro_max_seconds / 3600);
    $('dayCap').textContent = a.pro_limit; $('capH').textContent = cap;
    if (fixed) {
      st.textContent = p.source === 'owner' ? 'Sahip' : 'Pro'; st.className = 'st num on';
      $('proSub').textContent = p.source === 'owner' ? 'Tüm coinler ve özellikler süresiz açık.' : p.source === 'broadcaster' ? 'Yayıncı hesabınız Pro içerir.' : 'Hesabınıza tanımlı · ' + (p.until ? 'bitiş ' + new Date(p.until * 1000).toLocaleDateString('tr-TR') : 'süresiz');
      return;
    }
    const left = p.until * 1000 - Date.now(), on = p.active && left > 0;
    if (on) { const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / MIN), s = Math.floor((left % MIN) / 1000); st.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; st.className = 'st num on'; }
    else { st.textContent = 'Kapalı'; st.className = 'st num'; }
    const done = a.pro_used >= a.pro_limit, full = on && left >= (a.pro_max_seconds - 60) * 1000;
    $('proSub').textContent = on ? `Pro aktif · bugün ${a.pro_used}/${a.pro_limit} reklam` : `Kısa bir reklam izleyin, ${hrs} saat boyunca tüm coinleri açın. Bugün ${a.pro_used}/${a.pro_limit}.`;
    if (API.web && !fixed) $('proSub').textContent = on ? 'Pro aktif. Süreyi Telegram uygulamasında reklam izleyerek uzatabilirsiniz.' : 'Pro kapalı. Telegram uygulamasında kısa bir reklam izleyerek açabilirsiniz; hesabınız aynıdır.';
    $('adBtn').disabled = adBusy || done || full;
    $('adBtnTxt').textContent = adBusy ? 'Reklam yükleniyor…' : done ? 'Bugünkü hak doldu' : full ? 'Süre üst sınırda' : `Reklam izle · +${hrs} saat Pro`;
  }
  function renderPro() {
    if (srv()) return renderProServer();
    $('myId').textContent = uid ? String(uid) : 'Telegram dışında açık';
    $('ownerSec').hidden = !isOwner();
    const owner = isOwner(), grant = myGrant(), fixed = owner || !!grant;
    $('adBtn').hidden = fixed; $('starsBtn').hidden = fixed;
    if (fixed) {
      const st0 = $('proState'); st0.textContent = owner ? 'Sahip' : 'Pro'; st0.className = 'st num on';
      $('proSub').textContent = owner ? 'Tüm coinler ve özellikler süresiz açık.' : 'Hesabınıza tanımlı · ' + (grant.until ? 'bitiş ' + new Date(grant.until + 'T12:00:00').toLocaleDateString('tr-TR') : 'süresiz');
      return;
    }
    const left = S.proUntil - Date.now(), on = left > 0, st = $('proState');
    if (on) { const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / MIN), s = Math.floor((left % MIN) / 1000), p2 = (x) => String(x).padStart(2, '0'); st.textContent = h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`; st.className = 'st num on'; }
    else { st.textContent = 'Kapalı'; st.className = 'st num'; }
    const used = adsUsed();
    $('proSub').textContent = on ? `Pro aktif · bugün ${used}/${CFG.adsPerDay} reklam` : `Kısa bir reklam izleyin, ${CFG.proMinutesPerAd >= 60 ? CFG.proMinutesPerAd / 60 + ' saat' : CFG.proMinutesPerAd + ' dakika'} boyunca tüm coinleri açın. Bugün ${used}/${CFG.adsPerDay}.`;
    const btn = $('adBtn'), cap = left >= (CFG.proMaxMinutes - 1) * MIN, done = used >= CFG.adsPerDay;
    btn.disabled = adBusy || cap || done;
    $('adBtnTxt').textContent = adBusy ? 'Reklam yükleniyor…' : done ? 'Bugünkü hak doldu' : cap ? 'Süre üst sınırda' : `Reklam izle · +${CFG.proMinutesPerAd >= 60 ? CFG.proMinutesPerAd / 60 + ' sa' : CFG.proMinutesPerAd + ' dk'} Pro`;
    $('dayCap').textContent = CFG.adsPerDay; $('capH').textContent = Math.round(CFG.proMaxMinutes / 60);
  }
  let wasPro = isPro();
  setInterval(() => {
    renderPro();
    const now = isPro();
    if (wasPro && !now) {
      toast('Pro süresi bitti'); applyCustom(); if (view === 'market' && window.BeaconMarketUI) window.BeaconMarketUI.onView();
      if (!allowed(S.sym)) { S.sym = 'BTC'; save(); applyState(); loadRadar(); }
      if (view === 'scan') renderHeat();
    }
    wasPro = now;
  }, 1000);
  $('adBtn').onclick = watchAd;

  /* ——— gezinme, sac, modal ——— */
  let view = 'radar';
  function go(v) {
    view = v;
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
    $('dock').querySelectorAll('button').forEach((b) => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
    if (tg && tg.BackButton) { try { v === 'radar' ? tg.BackButton.hide() : tg.BackButton.show(); } catch (e) {} }
    if (v === 'radar') chart.resize();
    if (v === 'scan') buildScan();
    if (v === 'perf') buildPerf();
    if (v === 'pro') renderPro();
    if (v === 'market' && window.BeaconMarketUI) window.BeaconMarketUI.onView();
    if (window.BeaconCommunity) window.BeaconCommunity.onView(v);
  }
  $('dock').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { haptic(); go(b.dataset.v); } });
  try { tg && tg.BackButton && tg.BackButton.onClick(() => go('radar')); } catch (e) {}

  function openSheet(id) { const el = $(id); el.classList.add('on'); const f = el.querySelector('button'); f && f.focus(); }
  function closeSheet(id) { $(id).classList.remove('on'); }
  document.querySelectorAll('.scrim').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s && s.id !== 'legal') closeSheet(s.id); }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.scrim.on').forEach((s) => { if (s.id !== 'legal' || S.legal) closeSheet(s.id); }); });

  $('symBtn').onclick = () => {
    haptic();
    $('coinList').innerHTML = D.COINS.map((c) => {
      const ok = c.free || isPro();
      return `<button class="crow" data-s="${c.s}"><div><b>${c.s}</b><small>${c.n}</small></div><span class="r">${c.s === S.sym ? '<span style="color:var(--beam)">seçili</span>' : ok ? '' : LOCK + ' Pro'}</span></button>`;
    }).join('');
    openSheet('symSheet');
  };
  $('coinList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    closeSheet('symSheet'); haptic();
    if (!allowed(b.dataset.s)) { toast('Bu coin Pro ile açılır'); go('pro'); return; }
    if (b.dataset.s === S.sym) return;
    S.sym = b.dataset.s; save(); applyState(); $('price').dataset.v = ''; $('price').textContent = '–'; $('chg').textContent = '–';
    if (view === 'perf') buildPerf(); else if (view !== 'radar') go('radar');
    loadRadar();
  });
  $('legalBtn').onclick = () => openSheet('legal');
  $('legalOk').onclick = () => { S.legal = true; save(); closeSheet('legal'); haptic('ok'); };

  /* formasyon ayarları */
  const fmtTol = (v) => String(v).replace('.', ',');
  function syncForm() { $('pivR').value = S.form.pivot; $('tolR').value = S.form.tol; $('pivV').textContent = S.form.pivot; $('tolV').textContent = fmtTol(S.form.tol); $('histC').checked = !!S.form.history; $('histR').value = S.form.maxForms; $('histV').textContent = S.form.maxForms; $('histRow').style.opacity = S.form.history ? 1 : 0.4; $('histR').disabled = !S.form.history; }
  $('formCfg').onclick = () => { haptic(); syncForm(); openSheet('formSheet'); };
  $('pivR').addEventListener('input', (e) => { S.form.pivot = +e.target.value; $('pivV').textContent = S.form.pivot; refreshFormation(); });
  $('tolR').addEventListener('input', (e) => { S.form.tol = Math.round(+e.target.value * 10) / 10; $('tolV').textContent = fmtTol(S.form.tol); refreshFormation(); });
  $('pivR').addEventListener('change', save); $('tolR').addEventListener('change', save);
  $('histC').addEventListener('change', (e) => { S.form.history = e.target.checked; save(); syncForm(); refreshFormation(); });
  $('histR').addEventListener('input', (e) => { S.form.maxForms = +e.target.value; $('histV').textContent = S.form.maxForms; refreshFormation(); });
  $('histR').addEventListener('change', save);
  $('formReset').onclick = () => { S.form = Object.assign({}, DEF.form); save(); syncForm(); refreshFormation(); haptic(); };
  $('formOk').onclick = () => { save(); closeSheet('formSheet'); };

  /* kimlik kopyala, sahip için hibe satırı üretici */
  $('copyId').onclick = async () => {
    if (!uid) { toast('Kimlik yalnızca Telegram içinde görünür'); return; }
    try { await navigator.clipboard.writeText(String(uid)); toast('Kimlik kopyalandı'); haptic('ok'); } catch (e) { toast('Kopyalanamadı, sayıyı elle seçin'); }
  };
  $('gMake').onclick = () => {
    const id = String($('gId').value).trim();
    if (!/^\d{5,15}$/.test(id)) { toast('Geçerli bir Telegram kimliği girin (yalnızca rakam)'); return; }
    const days = +$('gDays').value, note = $('gNote').value.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40);
    const parts = [`id: ${id}`];
    if (days > 0) parts.push(`until: '${new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)}'`);
    if (note) parts.push(`note: '${note}'`);
    const out = $('gOut'); out.textContent = `{ ${parts.join(', ')} },`; out.hidden = false;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out.textContent).then(() => toast('Satır kopyalandı')).catch(() => toast('Satır hazır, elle kopyalayın'));
  };

  /* radar kontrolleri */
  function setTf(tf) { S.tf = tf; save(); applyState(); loadRadar(); }
  $('tfSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-tf]'); if (b && b.dataset.tf !== S.tf) { haptic(); setTf(b.dataset.tf); } });
  $('layers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-l]'); if (!b) return;
    const k = b.dataset.l; S.layers[k] = !S.layers[k]; save(); haptic(); b.setAttribute('aria-pressed', S.layers[k]); chart.setLayers(S.layers);
  });
  $('zoomIn').onclick = () => chart.zoom(1.3); $('zoomOut').onclick = () => chart.zoom(1 / 1.3);
  $('hzShort').onclick = () => { haptic(); setTf('1h'); window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }); };
  $('hzLong').onclick = () => { haptic(); setTf('1d'); window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }); };

  function applyState() {
    $('symName').textContent = S.sym;
    $('tfSeg').querySelectorAll('[data-tf]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tf === S.tf));
    $('layers').querySelectorAll('[data-l]').forEach((b) => b.setAttribute('aria-pressed', !!S.layers[b.dataset.l]));
    chart.setLayers(S.layers);
    renderPro();
  }

  /* ——— güncelleme döngüsü ——— */
  let polling = false, lastHz = 0;
  async function poll() {
    if (polling || document.hidden || !cur || view !== 'radar') return;
    polling = true;
    const { sym, tf } = S;
    try {
      const c = await D.refresh(sym, tf);
      if (sym === S.sym && tf === S.tf) { applyRadar(sym, tf, c); setLive(true); }
      if (Date.now() - lastHz > 45000) { lastHz = Date.now(); loadHorizons(sym, reqId); }
    } catch (e) { setLive(false); }
    polling = false;
  }
  setInterval(poll, 6000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('online', poll);


  /* ——— Pro: kendi göstergelerim (formül dili, güvenli ayrıştırıcı) ——— */
  const FX_MAX = 8;
  function customPlots(candles) {
    if (!SC || !isPro() || !Array.isArray(S.custom)) return [];
    const out = [];
    for (const f of S.custom) { if (!f.on) continue; try { for (const p of SC.run(f.code, candles)) out.push(p); } catch (e) { f.err = e.message; } }
    return out.slice(0, 10);
  }
  function applyCustom() { if (!cur || !cur.data) return; cur.data.custom = customPlots(cur.candles); chart.setData(cur.data); }
  let fxEditing = null;
  function fxRender() {
    const pro = isPro(), list = S.custom || [];
    $('fxIntro').textContent = pro ? 'Kendi formülünüzü yazın, grafiğe ekleyin. Formüller cihazınızda çalışır ve geleceğe bakmaz.' : 'Kendi göstergelerinizi yazmak Pro ile açılır. Aşağıda örnekleri görebilirsiniz; Pro sayfasından reklam izleyerek açabilirsiniz.';
    $('fxList').innerHTML = list.map((f, i) => `<div class="fxrow"><label class="sw"><input type="checkbox" data-fx-on="${i}" ${f.on ? 'checked' : ''} ${pro ? '' : 'disabled'}><span></span></label><div class="fxn"><b>${escH(f.name)}</b>${f.err ? `<div class="down" style="font-size:12px">${escH(f.err)}</div>` : ''}</div><button class="chip" data-fx-edit="${i}">Düzenle</button><button class="chip" data-fx-del="${i}" aria-label="Sil">Sil</button></div>`).join('') || '<p class="note" style="margin:10px 0">Henüz göstergeniz yok.</p>';
    $('fxNew').hidden = !!fxEditing || list.length >= FX_MAX; $('fxList').hidden = !!fxEditing; $('fxEdit').hidden = !fxEditing;
  }
  const escH = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fxOpenEditor(i) {
    if (!isPro()) { toast('Gösterge yazmak Pro ile açılır'); closeSheet('fxSheet'); go('pro'); return; }
    fxEditing = { i }; const f = i >= 0 ? S.custom[i] : null;
    $('fxName').value = f ? f.name : 'Göstergem'; $('fxCode').value = f ? f.code : SC.TEMPLATES[0].code; $('fxErr').hidden = true;
    $('fxTpls').innerHTML = SC.TEMPLATES.map((t, k) => `<button class="chip" data-tpl="${k}">${escH(t.name)}</button>`).join('');
    fxRender();
  }
  $('fxBtn').onclick = () => { haptic(); fxEditing = null; fxRender(); openSheet('fxSheet'); };
  $('fxNew').onclick = () => fxOpenEditor(-1);
  $('fxCancel').onclick = () => { fxEditing = null; fxRender(); };
  $('fxTpls').addEventListener('click', (e) => { const b = e.target.closest('[data-tpl]'); if (b) { const t = SC.TEMPLATES[+b.dataset.tpl]; $('fxCode').value = t.code; if (!$('fxName').value || $('fxName').value === 'Göstergem') $('fxName').value = t.name; } });
  $('fxSave').onclick = () => {
    const code = $('fxCode').value, name = ($('fxName').value || 'Göstergem').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 30) || 'Göstergem';
    try { if (cur) SC.run(code, cur.candles); else SC.parse(code); }
    catch (e) { const er = $('fxErr'); er.textContent = (e.line ? `Satır ${e.line}: ` : '') + (e.message || 'Hata'); er.hidden = false; return; }
    S.custom = S.custom || []; const item = { id: Date.now(), name, code, on: true };
    if (fxEditing.i >= 0) S.custom[fxEditing.i] = Object.assign(S.custom[fxEditing.i], item, { id: S.custom[fxEditing.i].id }); else S.custom.push(item);
    fxEditing = null; save(); haptic('ok'); fxRender(); applyCustom(); toast('Gösterge grafiğe eklendi');
  };
  $('fxList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-fx-edit]'), del = e.target.closest('[data-fx-del]');
    if (ed) return fxOpenEditor(+ed.dataset.fxEdit);
    if (del && confirm('Gösterge silinsin mi?')) { S.custom.splice(+del.dataset.fxDel, 1); save(); fxRender(); applyCustom(); }
  });
  $('fxList').addEventListener('change', (e) => { const c = e.target.closest('[data-fx-on]'); if (c) { S.custom[+c.dataset.fxOn].on = c.checked; S.custom[+c.dataset.fxOn].err = ''; save(); applyCustom(); fxRender(); } });

  /* ——— açılış ——— */
  if (!allowed(S.sym)) S.sym = 'BTC';
  applyState();
  if (!S.legal) openSheet('legal');
  loadRadar();
  if (srv() && (!API.web || API.hasToken())) API.refreshMe().then(() => { applyState(); if (window.BeaconCommunity) window.BeaconCommunity.init(); }).catch((e) => toast(e.message || 'Sunucuya bağlanılamadı'));

  /* test için dışa açılan küçük yüzey */
  /* ——— tam ekran grafik ——— */
  function setFs(on) {
    const v = $('v-radar'); v.classList.toggle('fs', on); document.body.classList.toggle('fsmode', on);
    $('fsBtn').setAttribute('aria-pressed', on); window.scrollTo(0, 0); setTimeout(() => chart.resize(), 60);
    try { if (tg && tg.BackButton && view === 'radar') { on ? tg.BackButton.show() : tg.BackButton.hide(); } } catch (e) {}
  }
  const isFs = () => $('v-radar').classList.contains('fs');
  $('fsBtn').onclick = () => { haptic(); setFs(!isFs()); };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isFs() && !document.querySelector('.scrim.on')) setFs(false); });
  try { tg && tg.BackButton && tg.BackButton.onClick(() => { if (isFs()) setFs(false); }); } catch (e) {}

  /* ——— görsel olarak indir / paylaş (Beacon adı ve logosuyla) ——— */
  const BOT = CFG.telegramBot || 'BeaconCrypto_Bot';
  function composeImage(src, title, sub, note) {
    const s = Math.max(1, Math.round(src.width / Math.max(1, src.clientWidth || src.width))), U = (n) => n * s;
    const W = src.width, bar = U(64), foot = U(62), H = src.height + bar + foot, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), font = (w, px) => `${w} ${U(px)}px Inter, system-ui, sans-serif`;
    const fit = (t, maxW) => { if (g.measureText(t).width <= maxW) return t; while (g.measureText(t + '…').width > maxW && t.length > 3) t = t.slice(0, -1); return t + '…'; };
    g.fillStyle = '#060a12'; g.fillRect(0, 0, W, H);
    const logo = (x, y, k) => { g.save(); g.translate(x, y); g.scale(k, k); g.fillStyle = '#0d1422'; g.strokeStyle = '#1a2438'; g.lineWidth = 1; g.beginPath(); g.roundRect(0, 0, 32, 32, 8); g.fill(); g.stroke(); g.fillStyle = '#ffc25c'; g.fill(new Path2D('M16 5l4 7h-8z')); g.fillStyle = '#e9eef8'; g.fill(new Path2D('M13 14h6l2 13H11z')); g.restore(); };
    logo(U(14), U(12), U(40) / 32);
    g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillStyle = '#ffc25c'; g.font = font(700, 22); g.fillText('Beacon', W - U(16), U(32));
    const maxW = W - U(64) - U(110) - U(16);
    g.textAlign = 'left'; g.fillStyle = '#e9eef8'; g.font = font(700, 20); g.fillText(fit(title, maxW), U(64), U(25));
    g.fillStyle = '#7e8ba6'; g.font = font(500, 14); g.fillText(fit(sub, W - U(64) - U(16)), U(64), U(48));
    g.drawImage(src, 0, bar);
    // silik büyük filigran (kırpılsa bile marka kalsın)
    g.save(); g.globalAlpha = 0.06; logo(W / 2 - U(70), bar + src.height / 2 - U(105), U(140) / 32); g.fillStyle = '#e9eef8'; g.textAlign = 'center'; g.font = font(700, 34); g.fillText('Beacon', W / 2, bar + src.height / 2 + U(70)); g.restore();
    g.fillStyle = '#0d1422'; g.fillRect(0, H - foot, W, foot); g.textAlign = 'left'; g.fillStyle = '#7e8ba6'; g.font = font(500, 13);
    g.fillText(fit(note || 'Beacon analiz aracıdır. Yatırım tavsiyesi değildir.', W - U(32)), U(16), H - foot + U(19));
    const link = 't.me/' + BOT; g.fillStyle = '#ffc25c'; g.font = font(600, 13); g.fillText(link, U(16), H - foot + U(44));
    const lw = g.measureText(link).width; g.fillStyle = '#a7b2c8'; g.font = font(500, 13);
    g.fillText('  ·  ' + new Date().toLocaleString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), U(16) + lw, H - foot + U(44));
    return c;
  }
  let shareBlob = null, shareName = 'beacon.png', shareText = '';
  function shareImage(src, title, sub, name) {
    const c = composeImage(src, title, sub); shareName = (name || 'beacon') + '.png'; shareText = title + ' · ' + sub + ' · Beacon t.me/' + BOT;
    c.toBlob((b) => { shareBlob = b; $('shareImg').src = URL.createObjectURL(b); openSheet('shareSheet'); }, 'image/png');
  }
  $('shClose').onclick = () => closeSheet('shareSheet');
  $('shDl').onclick = () => { if (!shareBlob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(shareBlob); a.download = shareName; document.body.appendChild(a); a.click(); a.remove(); toast('Görsel indirildi'); };
  $('shShare').onclick = async () => {
    if (!shareBlob) return; const f = new File([shareBlob], shareName, { type: 'image/png' });
    try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], text: shareText }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    toast('Bu cihazda doğrudan paylaşım yok: önce İndir, sonra paylaşın');
  };
  $('shCopy').onclick = async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': shareBlob })]); toast('Görsel kopyalandı'); } catch (e) { toast('Kopyalanamadı: İndir\'i kullanın'); } };
  $('shareBtn').onclick = () => { haptic(); const cv = $('cv'); if (!cv) return; shareImage(cv, S.sym + '/USDT · ' + TFL(S.tf), 'Skor ' + $('score').textContent + ' · ' + $('verd').textContent + ' · ' + $('price').textContent, 'beacon-' + S.sym + '-' + S.tf); };

  window.__beacon = { shareImage, setFs, applyCustom, customPlots, toast, haptic, openSheet, closeSheet, renderPro, adForSession, go, state: () => S, chart, calc, buildScan, buildPerf, uid, isOwner, isPro, cur: () => cur };
})();
