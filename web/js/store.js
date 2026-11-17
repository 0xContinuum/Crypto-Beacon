/* Gösterge Mağazası — liste, detay, beğeni, ekleme/satın alma, sahip formu. Sunucu gerektirir. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const H = () => window.__beacon;
  const API = () => window.BeaconApi;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AUD = { public: 'Herkese açık', broadcasters: 'Yayıncılara özel', pro: "Pro'ya özel" };
  const ASSET = (a) => (a === 'TON' ? 'GRAM' : a);
  const st = { items: [], admin: false, codes: {}, loaded: false, form: null, detail: null, pending: {} };

  function priceLabel(it) {
    if (!it.paid) return 'Ücretsiz';
    return it.price.replace('.', ',') + ' ' + ASSET(it.asset) + ' · ' + (it.duration_days ? it.duration_days + ' gün' : 'süresiz');
  }
  function untilLabel(it) {
    if (!it.owned || !it.paid) return '';
    if (!it.until) return it.until === 0 && !st.admin ? 'Süresiz' : '';
    const d = Math.max(0, Math.ceil((it.until - Date.now() / 1000) / 86400));
    return d + ' gün kaldı';
  }
  const active = () => (Array.isArray(H().state().st) ? H().state().st : []);
  const isOn = (id) => active().includes(id);

  function mk() {
    if ($('stSheet')) return;
    const w = document.createElement('div');
    w.innerHTML = `<div class="scrim" id="stSheet" role="dialog" aria-modal="true" aria-label="Gösterge Mağazası"><div class="panel">
      <div class="grab"></div><h3>Gösterge Mağazası</h3>
      <p class="note" id="stIntro">Hazır göstergeleri grafiğinize ekleyin.</p>
      <div id="stList"></div>
      <button class="cta" id="stNew" hidden>Yeni gösterge ekle</button>
      <button class="cta ghost" id="stClose" style="margin-top:8px">Kapat</button></div></div>
      <div class="scrim" id="stDet" role="dialog" aria-modal="true" aria-label="Gösterge detayı"><div class="panel" id="stDetBody"></div></div>
      <div class="scrim" id="stForm" role="dialog" aria-modal="true" aria-label="Gösterge düzenle"><div class="panel" id="stFormBody"></div></div>`;
    while (w.firstChild) document.body.appendChild(w.firstChild);
    ['stSheet', 'stDet', 'stForm'].forEach((id) => $(id).addEventListener('click', (e) => { if (e.target.id === id) H().closeSheet(id); }));
    $('stClose').onclick = () => H().closeSheet('stSheet');
    $('stNew').onclick = () => openForm(null);
    $('stList').addEventListener('click', onList);
  }

  async function load() {
    const api = API();
    if (!api || !api.on || !api.me) { st.items = []; st.loaded = true; return; }
    try { const r = await api.call('GET', '/api/store'); st.items = r.items || []; st.admin = !!r.admin; } catch (e) { H().toast(e.message || 'Mağaza yüklenemedi'); }
    st.loaded = true;
  }

  function card(it) {
    const on = isOn(it.id), hidden = it.status !== 'active';
    let act;
    if (!it.allowed) act = `<button class="cta ghost sm" disabled>Kilitli · ${esc(AUD[it.audience])}</button>`;
    else if (it.owned) act = `<button class="cta sm" data-st-toggle="${it.id}">${on ? 'Grafikten kaldır' : 'Grafiğe ekle'}</button>`;
    else if (it.paid) act = `<button class="cta sm" data-st-buy="${it.id}">Satın al · ${esc(it.price.replace('.', ','))} ${esc(ASSET(it.asset))}</button>`;
    else act = `<button class="cta sm" data-st-claim="${it.id}">Ücretsiz ekle</button>`;
    return `<div class="stc" data-id="${it.id}">
      <div class="sth"><b>${esc(it.title)}</b>${hidden ? '<span class="pill">Gizli</span>' : ''}</div>
      <div class="note">${esc(it.summary)}</div>
      <div class="stb"><span class="stbadge">${esc(AUD[it.audience] || it.audience)}</span><span class="stbadge ${it.paid ? 'paid' : ''}">${esc(priceLabel(it))}</span>${untilLabel(it) ? `<span class="stbadge">${esc(untilLabel(it))}</span>` : ''}</div>
      <div class="str"><button class="stlike ${it.liked ? 'on' : ''}" data-st-like="${it.id}" aria-label="Beğen" aria-pressed="${it.liked}">${it.liked ? '♥' : '♡'} <span class="num">${it.likes}</span></button>
      <button class="chip" data-st-det="${it.id}">Detay</button>${st.admin ? `<button class="chip" data-st-edit="${it.id}">Düzenle</button>` : ''}</div>
      ${act}</div>`;
  }
  function render() {
    mk();
    const api = API(), ok = api && api.on && api.me;
    $('stNew').hidden = !(ok && st.admin);
    $('stIntro').textContent = ok ? 'Hazır göstergeleri grafiğinize ekleyin. Ücretli göstergeler satın alma süresi boyunca açıktır.' : 'Mağaza için sunucu bağlantısı ve Telegram girişi gerekir.';
    $('stList').innerHTML = !ok ? '' : st.items.length ? st.items.map(card).join('') : '<p class="note" style="margin:10px 0">Henüz gösterge yok.</p>';
  }

  async function fetchCode(id) {
    if (st.codes[id]) return st.codes[id];
    const r = await API().call('GET', '/api/store/' + id + '/code');
    st.codes[id] = r.code; return r.code;
  }
  async function ensureCodes() {
    const ids = active(); let ch = false;
    for (const id of ids) {
      if (st.codes[id] || st.pending[id]) continue;
      st.pending[id] = 1;
      try { await fetchCode(id); ch = true; } catch (e) { st.codes[id] = null; }
      delete st.pending[id];
    }
    if (ch) H().applyCustom();
  }
  function setActive(id, on) {
    const S = H().state(); let a = active().filter((x) => x !== id);
    if (on) a.push(id);
    S.st = a.slice(-12); H().save();
  }
  async function toggle(id) {
    const on = isOn(id);
    if (!on) { try { await fetchCode(id); } catch (e) { H().toast(e.message); return; } }
    setActive(id, !on); H().applyCustom(); render(); if (st.detail === id) renderDetail(id);
    H().toast(on ? 'Gösterge kaldırıldı' : 'Gösterge grafiğe eklendi');
  }
  async function claim(id) {
    try { await API().call('POST', '/api/store/' + id + '/claim', {}); await load(); await toggle(id); } catch (e) { H().toast(e.message); }
  }
  async function like(id) {
    const it = st.items.find((x) => x.id === id); if (!it) return;
    try { const r = await API().call('POST', '/api/store/' + id + '/like', {}); it.liked = r.liked; it.likes = r.likes; render(); if (st.detail === id) renderDetail(id); } catch (e) { H().toast(e.message); }
  }
  async function buy(id) {
    const it = st.items.find((x) => x.id === id); if (!it) return;
    try {
      const r = await API().call('POST', '/api/store/' + id + '/buy', {});
      const url = r.pay_url; H().toast('Ödeme sayfası açılıyor…');
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg && /t\.me\//.test(url) && tg.openTelegramLink) tg.openTelegramLink(url); else if (tg && tg.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener');
      poll(r.order);
    } catch (e) { H().toast(e.message); }
  }
  let pollT = 0;
  function poll(order) {
    clearTimeout(pollT); const t0 = Date.now();
    const step = async () => {
      if (Date.now() - t0 > 300000) return;
      try {
        const o = await API().call('GET', '/api/store/order/' + order);
        if (o.status === 'paid') { await load(); render(); if (st.detail) renderDetail(st.detail); H().haptic('ok'); H().toast('Ödeme alındı, gösterge açıldı'); return; }
        if (o.status === 'expired' || o.status === 'failed') { H().toast('Ödeme tamamlanmadı'); return; }
      } catch (e) { /* tekrar dene */ }
      pollT = setTimeout(step, 3000);
    };
    pollT = setTimeout(step, 3000);
  }

  async function renderDetail(id) {
    mk(); st.detail = id;
    const b = $('stDetBody'); H().openSheet('stDet');
    let it = st.items.find((x) => x.id === id);
    b.innerHTML = '<div class="grab"></div><p class="note">Yükleniyor…</p>';
    try { const d = await API().call('GET', '/api/store/' + id); it = Object.assign(it || {}, d); } catch (e) { b.innerHTML = '<div class="grab"></div><p class="note">' + esc(e.message) + '</p>'; return; }
    let act = '';
    if (!it.allowed) act = `<button class="cta ghost" disabled>Kilitli · ${esc(AUD[it.audience])}</button>`;
    else if (it.owned) act = `<button class="cta" data-st-toggle="${it.id}">${isOn(it.id) ? 'Grafikten kaldır' : 'Grafiğe ekle'}</button>`;
    else if (it.paid) act = `<button class="cta" data-st-buy="${it.id}">Satın al · ${esc(it.price.replace('.', ','))} ${esc(ASSET(it.asset))}</button>`;
    else act = `<button class="cta" data-st-claim="${it.id}">Ücretsiz ekle</button>`;
    b.innerHTML = `<div class="grab"></div><h3>${esc(it.title)}</h3>
      <div class="stb"><span class="stbadge">${esc(AUD[it.audience])}</span><span class="stbadge ${it.paid ? 'paid' : ''}">${esc(priceLabel(it))}</span></div>
      ${it.image ? `<img class="stimg" src="${esc(it.image)}" alt="${esc(it.title)} görseli">` : ''}
      <div class="stdesc">${esc(it.description || it.summary)}</div>
      <div class="str"><button class="stlike ${it.liked ? 'on' : ''}" data-st-like="${it.id}" aria-label="Beğen">${it.liked ? '♥' : '♡'} <span class="num">${it.likes}</span></button></div>
      ${act}<button class="cta ghost" id="stDetClose" style="margin-top:8px">Kapat</button>
      <p class="note" style="margin-top:10px">Gösterge geçmiş mumlarla hesaplanır; yatırım tavsiyesi değildir.</p>`;
    $('stDetClose').onclick = () => H().closeSheet('stDet');
    b.onclick = (e) => onList(e);
  }

  function onList(e) {
    const t = e.target.closest('button'); if (!t) return;
    const g = (k) => { const v = t.getAttribute(k); return v == null ? null : Number(v); };
    let v;
    if ((v = g('data-st-like')) != null) like(v);
    else if ((v = g('data-st-det')) != null) renderDetail(v);
    else if ((v = g('data-st-toggle')) != null) toggle(v);
    else if ((v = g('data-st-claim')) != null) claim(v);
    else if ((v = g('data-st-buy')) != null) buy(v);
    else if ((v = g('data-st-edit')) != null) openForm(v);
  }

  /* ——— sahip formu ——— */
  function resize(file) {
    return new Promise((res, rej) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        let q = 0.82, d = c.toDataURL('image/jpeg', q);
        while (d.length > 290000 && q > 0.3) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
        d.length > 290000 ? rej(new Error('Görsel çok büyük')) : res(d);
      };
      img.onerror = () => rej(new Error('Görsel okunamadı')); img.src = u;
    });
  }
  async function openForm(id) {
    mk(); let d = { title: '', summary: '', description: '', code: '', audience: 'public', price: '0', asset: 'USDT', duration_days: 0, status: 'active', image: '' };
    if (id != null) { try { d = Object.assign(d, await API().call('GET', '/api/admin/store/' + id)); } catch (e) { H().toast(e.message); return; } }
    st.form = { id, image: undefined, had: !!d.image };
    const b = $('stFormBody'), opt = (a, cur) => Object.keys(a).map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${a[k]}</option>`).join('');
    b.innerHTML = `<div class="grab"></div><h3>${id == null ? 'Yeni gösterge' : 'Göstergeyi düzenle'}</h3>
      <input id="sfT" maxlength="60" placeholder="Başlık" aria-label="Başlık" value="${esc(d.title)}">
      <input id="sfS" maxlength="160" placeholder="Kısa özet (liste için)" aria-label="Kısa özet" value="${esc(d.summary)}">
      <textarea id="sfD" rows="4" maxlength="4000" placeholder="Açıklama" aria-label="Açıklama">${esc(d.description)}</textarea>
      <label class="note">Görsel <input type="file" id="sfI" accept="image/*"></label><div id="sfIp" class="note">${d.image ? 'Mevcut görsel korunur. Yeni seçerseniz değişir.' : ''} ${d.image ? '<button class="chip" id="sfIc">Görseli kaldır</button>' : ''}</div>
      <textarea id="sfC" rows="7" spellcheck="false" autocapitalize="off" placeholder="Beacon / Formül 2 kodu${id != null ? ' (boş bırakırsanız eski kod korunur)' : ''}" aria-label="Kod">${id != null ? '' : esc(d.code)}</textarea>
      <div class="sfrow"><label class="note">Kimler görür<select id="sfA">${opt(AUD, d.audience)}</select></label>
      <label class="note">Durum<select id="sfSt">${opt({ active: 'Yayında', hidden: 'Gizli' }, d.status)}</select></label></div>
      <div class="sfrow"><label class="note">Fiyat (0 = ücretsiz)<input id="sfP" inputmode="decimal" value="${esc(d.price || '0')}"></label>
      <label class="note">Para birimi<select id="sfAs">${opt({ USDT: 'USDT', TON: 'GRAM (TON)' }, d.asset)}</select></label>
      <label class="note">Süre (gün, 0 = süresiz)<input id="sfDu" inputmode="numeric" value="${d.duration_days}"></label></div>
      <div id="sfE" class="fxerr" role="alert" hidden></div>
      <button class="cta" id="sfSave">Kaydet</button>
      ${id != null ? '<button class="cta ghost" id="sfDel" style="margin-top:8px">Sil</button>' : ''}
      <button class="cta ghost" id="sfCancel" style="margin-top:8px">Vazgeç</button>`;
    H().openSheet('stForm');
    $('sfI').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { st.form.image = await resize(f); $('sfIp').textContent = 'Görsel hazır'; } catch (er) { H().toast(er.message); } };
    if ($('sfIc')) $('sfIc').onclick = () => { st.form.image = ''; $('sfIp').textContent = 'Görsel kaldırılacak'; };
    $('sfCancel').onclick = () => H().closeSheet('stForm');
    if ($('sfDel')) $('sfDel').onclick = async () => { if (!confirm('Gösterge silinsin mi?')) return; try { await API().call('DELETE', '/api/admin/store/' + id); H().closeSheet('stForm'); await load(); render(); } catch (e) { H().toast(e.message); } };
    $('sfSave').onclick = async () => {
      const body = { title: $('sfT').value.trim(), summary: $('sfS').value.trim(), description: $('sfD').value, code: $('sfC').value, audience: $('sfA').value, status: $('sfSt').value, price: $('sfP').value.replace(',', '.').trim(), asset: $('sfAs').value, duration_days: parseInt($('sfDu').value, 10) || 0 };
      if (st.form.image !== undefined) body.image = st.form.image;
      try {
        if (id == null) await API().call('POST', '/api/admin/store', body); else await API().call('PUT', '/api/admin/store/' + id, body);
        delete st.codes[id]; H().closeSheet('stForm'); await load(); render(); H().toast('Kaydedildi');
      } catch (e) { $('sfE').textContent = e.message; $('sfE').hidden = false; }
    };
  }

  async function open() { mk(); H().openSheet('stSheet'); render(); await load(); render(); }

  window.BeaconStore = {
    open, ensureCodes, code: (id) => st.codes[id] || null, active, load,
    _state: st
  };
  document.addEventListener('DOMContentLoaded', () => { const b = $('stBtn'); if (b) b.onclick = () => { H().haptic(); open(); }; });
  if (document.readyState !== 'loading') { const b = $('stBtn'); if (b) b.onclick = () => { H().haptic(); open(); }; }
})();
