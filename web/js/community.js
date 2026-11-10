/* Beacon Topluluk: akış, yayıncılar, yayıncı paneli, yönetim. Yalnızca apiUrl tanımlıyken çalışır. */
(function () {
  'use strict';
  const API = window.BeaconApi, BX = () => window.__beacon;
  if (!API || !API.on) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (m) => '$' + (m / 1e6).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (t) => (t ? new Date(t * 1000).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
  const toast = (m) => BX().toast(m);
  const guard = async (fn) => { try { return await fn(); } catch (e) { toast(e.message || 'Hata'); return null; } };
  const NET = { TON: 'TON', TRC20: 'USDT · TRC20', BEP20: 'USDT · BEP20' };
  const STATUS = { pending: 'Onay bekliyor', published: 'Yayında', rejected: 'Reddedildi', hidden: 'Gizlendi', removed: 'Kaldırıldı' };
  document.body.classList.add('srv');

  /* dock'a iki sekme ekle */
  const ICON = {
    feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    acct: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  };
  const dock = $('dock');
  const proBtn = dock.querySelector('[data-v="pro"]');
  proBtn.insertAdjacentHTML('beforebegin', `<button data-v="feed">${ICON.feed}Topluluk</button>`);
  dock.insertAdjacentHTML('beforeend', `<button data-v="acct">${ICON.acct}Hesap</button>`);

  /* Performans sekmesi 6'lı dock'a sığmadığı için Tarayıcı'dan bağlantıyla açılır */
  const scanV = $('v-scan');
  if (scanV) scanV.insertAdjacentHTML('afterbegin', '<div class="pad" style="padding-bottom:0"><button class="chip" id="toPerf">Geriye dönük test sonuçları →</button></div>');
  $('toPerf').onclick = () => BX().go('perf');

  /* ——— akış ——— */
  let feedMode = 'all', items = [], next = '';
  const card = (p) => `<article class="post" data-id="${p.id}" tabindex="0">
    <div class="ph"><b>${esc(p.author.name)}</b><span class="dim">${esc(p.author.group_title)}</span><span class="dim r">${when(p.published_at)}</span></div>
    <h3>${esc(p.title)}</h3>
    ${p.has_image ? `<img loading="lazy" alt="" src="${API.imageUrl(p.id)}">` : ''}
    <p>${esc(p.excerpt)}</p>
    <div class="pf">${p.symbol ? `<span class="tag">${esc(p.symbol)}${p.tf ? ' · ' + esc(p.tf) : ''}</span>` : ''}${p.video ? '<span class="tag">▶ Video</span>' : ''}<span class="dim">♥ ${p.likes}</span><span class="dim">👁 ${p.views}</span></div></article>`;

  const needLogin = (box) => { box.innerHTML = `<div class="empty"><b>Topluluk için giriş yapın</b><p class="note">Sağ üstteki "Telegram ile giriş" düğmesini kullanın. Hesabınız Telegram uygulamasındakiyle aynıdır.</p></div>`; };
  async function loadFeed(more) {
    const box = $('feedBox');
    if (API.web && !API.me) return needLogin(box);
    if (feedMode === 'bcast') return loadBroadcasters();
    if (!more) { items = []; next = ''; box.innerHTML = '<p class="note pad">Yükleniyor…</p>'; }
    const q = (feedMode === 'following' ? '&following=1' : '') + (more && next ? '&before=' + next : '');
    const r = await guard(() => API.call('GET', '/api/feed?x=1' + q));
    if (!r) { if (!more) box.innerHTML = '<p class="note pad">Akış yüklenemedi.</p>'; return; }
    items = items.concat(r.items); next = r.next;
    box.innerHTML = items.length ? items.map(card).join('') + (next ? '<div class="pad"><button class="cta ghost" id="moreBtn">Daha fazla</button></div>' : '')
      : `<div class="empty"><b>${feedMode === 'following' ? 'Henüz kimseyi takip etmiyorsunuz' : 'Henüz paylaşım yok'}</b><p class="note">${feedMode === 'following' ? 'Yayıncılar sekmesinden takip edebilirsiniz.' : 'Yayıncılar analizlerini burada paylaşacak.'}</p></div>`;
  }
  async function loadBroadcasters() {
    const box = $('feedBox');
    const r = await guard(() => API.call('GET', '/api/broadcasters'));
    if (!r) return;
    box.innerHTML = r.items.length ? r.items.map((b) => `<div class="bc"><div><b>${esc(b.name)}</b><div class="dim sm">${esc(b.group_title)} · ${b.followers} takipçi · ${b.posts} paylaşım</div><div class="note">${esc(b.bio)}</div></div>
      <div class="bcb"><button class="chip" data-follow="${b.id}" aria-pressed="${b.following}">${b.following ? 'Takipte' : 'Takip et'}</button>${b.group_link ? `<a class="chip" href="${esc(b.group_link)}" target="_blank" rel="noopener noreferrer">Grup</a>` : ''}</div></div>`).join('')
      : '<div class="empty"><b>Henüz yayıncı yok</b></div>';
  }
  $('feedSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    feedMode = b.dataset.f; $('feedSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); loadFeed();
  });
  $('feedBox').addEventListener('click', async (e) => {
    const f = e.target.closest('[data-follow]');
    if (f) { const on = f.getAttribute('aria-pressed') !== 'true'; const r = await guard(() => API.call('POST', '/api/follow', { bcast_id: +f.dataset.follow, on })); if (r) loadBroadcasters(); return; }
    if (e.target.id === 'moreBtn') return loadFeed(true);
    const a = e.target.closest('.post'); if (a) openPost(+a.dataset.id);
  });

  /* ——— paylaşım detayı ——— */
  function sheet(html) {
    let s = $('dynSheet');
    if (!s) { s = document.createElement('div'); s.className = 'scrim'; s.id = 'dynSheet'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); document.body.appendChild(s); s.addEventListener('click', (e) => { if (e.target === s) s.classList.remove('on'); }); }
    s.innerHTML = '<div class="panel"><div class="grab"></div>' + html + '</div>'; s.classList.add('on'); return s;
  }
  const closeDyn = () => { const s = $('dynSheet'); s && s.classList.remove('on'); };
  async function openPost(id) {
    const p = await guard(() => API.call('GET', '/api/posts/' + id)); if (!p) return;
    const me = API.me, mine = p.author.id === me.id;
    const s = sheet(`<h3>${esc(p.title)}</h3><div class="dim sm">${esc(p.author.name)} · ${esc(p.author.group_title)} · ${when(p.published_at)}</div>
      ${p.has_image ? `<img class="big" alt="" src="${API.imageUrl(id)}">` : ''}
      ${p.video ? `<div class="vid"><button class="vplay" id="pPlay" style="background-image:url(https://i.ytimg.com/vi/${esc(p.video)}/hqdefault.jpg)" aria-label="Videoyu oynat"><span>▶</span></button><p class="note">Oynatmadan önce kısa bir reklam gösterilebilir; geliri yayıncıyla paylaşılır.</p></div>` : ''}
      <div class="body">${esc(p.body)}</div>
      <div class="acts"><button class="chip" id="pLike" aria-pressed="${p.liked}">♥ ${p.likes}</button><button class="chip" id="pFollow" aria-pressed="${p.following}">${p.following ? 'Takipte' : 'Takip et'}</button><button class="chip" id="pRep">Şikayet</button></div>
      <p class="note disc">Bu paylaşım yayıncının görüşüdür. Yatırım tavsiyesi değildir; Beacon içeriği doğrulamaz.</p>
      <div class="adbox"><b>Yayıncıyı destekle</b><p class="note">Kısa bir reklam izleyin; reklam geliri bu yayıncıyla paylaşılır. Tamamen isteğe bağlıdır.</p>
      <button class="cta" id="pSup" style="margin-top:8px;min-height:46px">Reklam izle · yayıncıyı destekle</button>
      ${me.pro.source === 'ads' || !me.pro.active ? `<button class="cta ghost" id="pPro" style="margin-top:8px;min-height:46px">Reklam izle · +${Math.round(me.ads.pro_seconds_per_ad / 360) / 10} saat Pro</button>` : ''}</div>`);
    if (API.web) { const ab = s.querySelector('.adbox'); if (ab) ab.innerHTML = '<b>Yayıncıyı destekle</b><p class="note">Reklam gelirinin yayıncıya yazılması için bu paylaşımı Telegram uygulamasında açıp reklam izleyin.</p>'; }
    const on = (i, fn) => { const el = s.querySelector('#' + i); if (el) el.onclick = fn; };
    on('pLike', async () => { const r = await guard(() => API.call('POST', '/api/like', { post_id: id, on: !p.liked })); if (r) { p.liked = r.liked; p.likes = r.likes; const b = s.querySelector('#pLike'); b.textContent = '♥ ' + r.likes; b.setAttribute('aria-pressed', r.liked); } });
    on('pFollow', async () => { if (mine) return toast('Kendinizi takip edemezsiniz'); const r = await guard(() => API.call('POST', '/api/follow', { bcast_id: p.author.id, on: !p.following })); if (r) { p.following = r.following; const b = s.querySelector('#pFollow'); b.textContent = r.following ? 'Takipte' : 'Takip et'; b.setAttribute('aria-pressed', r.following); } });
    on('pRep', async () => { if (!confirm('Bu paylaşımı şikayet etmek istiyor musunuz?')) return; const r = await guard(() => API.call('POST', '/api/report', { post_id: id, reason: 'kullanıcı şikayeti' })); if (r) toast('Şikayetiniz alındı'); });
    const ad = (placement) => async (ev) => { const b = ev.currentTarget; b.disabled = true; const r = await guard(() => BX().adForSession(placement, id)); b.disabled = false; if (r) { toast(placement === 'support' ? 'Teşekkürler, yayıncı desteklendi' : 'Pro süresi uzatıldı'); await API.refreshMe(); BX().renderPro(); } };
    on('pSup', ad('support')); on('pPro', ad('pro_bcast'));
    on('pPlay', async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      if (!API.web) { try { await BX().adForSession('support', id); await API.refreshMe(); } catch (e) { /* reklam yoksa video yine açılır */ } }
      const box = btn.parentElement; box.innerHTML = `<iframe class="vframe" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(p.video)}?autoplay=1&rel=0" title="Video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    });
  }

  /* ——— hesap ——— */
  async function loadAcct() {
    const me = API.me, box = $('acctBox');
    if (API.web && !me) return needLogin(box);
    if (!me) { box.innerHTML = '<p class="note pad">Yükleniyor…</p>'; return; }
    let h = `<section class="sec"><h2>Hesap</h2><div class="idrow"><span>${esc(me.first_name || me.username || 'Kullanıcı')}</span><code class="num">${me.id}</code></div>
      <p class="note" style="margin-top:8px">${me.is_admin ? 'Sahip hesabı' : me.broadcaster ? 'Yayıncı' : 'Okuyucu'} · Pro: ${me.pro.active ? 'açık' : 'kapalı'}</p></section>`;
    if (me.broadcaster) h += '<div id="bPanel"></div>';
    if (me.is_admin) h += '<div id="aPanel"></div>';
    if (!me.broadcaster && !me.is_admin) h += `<section class="sec"><h2>Yayıncı olmak ister misiniz?</h2><p class="note">Telegram topluluğunuz varsa, analizlerinizi Beacon'da paylaşabilir ve paylaşımlarınızın reklam gelirinin %50'sini kazanabilirsiniz. Başvuru için Beacon sahibine kimliğinizi (${me.id}) iletin.</p></section>`;
    h += '<section class="sec"><h2>Kurallar</h2><ul class="note rules"><li>Al/sat çağrısı, hedef fiyat, garanti kazanç ve VIP/sinyal grubu tanıtımı yasaktır.</li><li>Paylaşımlar yayından önce incelenir; şikayet alan içerik otomatik gizlenir.</li><li>Kazançlar Adsgram\'ın ödemesi hesaba geçtikten sonra ödenebilir hale gelir. Reklam sonuçları sahte izleme tespit edilirse iptal edilir.</li><li>Beacon yatırım tavsiyesi vermez; paylaşımlar yayıncıların görüşüdür.</li></ul></section>';
    box.innerHTML = h;
    if (me.broadcaster) loadB(); if (me.is_admin) loadA();
  }

  /* yayıncı paneli */
  async function loadB() {
    const r = await guard(() => API.call('GET', '/api/b/me')); if (!r) return;
    const L = r.ledger, P = r.profile, st = r.stats;
    const posts = await guard(() => API.call('GET', '/api/b/posts'));
    $('bPanel').innerHTML = `<section class="sec"><h2>Kazanç</h2>
      <div class="kpis"><div class="kpi"><span>Çekilebilir</span><b class="num up">${usd(L.available)}</b></div><div class="kpi"><span>Onay bekleyen</span><b class="num">${usd(L.awaiting)}</b></div><div class="kpi"><span>Ödenen</span><b class="num">${usd(L.paid)}</b></div></div>
      <p class="note" style="margin-top:12px">Payınız %${P.share_bps / 100}. Bir günün geliri Adsgram'dan tahsil edilip sahip tarafından girildikten sonra "çekilebilir" olur. Son 30 gün: ${st.support_ads_30d} destek + ${st.pro_ads_30d} Pro reklamı. Değerler tahminidir; kesin tutar gün kapanışında hesaplanır.${L.unapproved_ads ? ` Henüz kapanmamış günlerde ${L.unapproved_ads} reklam var.` : ''}</p>
      ${L.pending ? `<p class="warn" style="margin-top:10px">Bekleyen ödeme talebi: ${usd(L.pending)}</p>` : ''}
      <button class="cta" id="bPay" ${L.available < r.min_payout_micro || L.pending ? 'disabled' : ''}>Ödeme talep et (en az ${usd(r.min_payout_micro)})</button></section>
      <section class="sec"><h2>İstatistik</h2><div class="kpis"><div class="kpi"><span>Takipçi</span><b class="num">${st.followers}</b></div><div class="kpi"><span>Görüntülenme</span><b class="num">${st.views}</b></div><div class="kpi"><span>Yayında</span><b class="num">${st.posts.published || 0}</b></div></div></section>
      <section class="sec"><h2>Yeni paylaşım</h2><div class="form"><input id="cT" maxlength="120" placeholder="Başlık"><textarea id="cB" rows="6" maxlength="4000" placeholder="Analiz metni (en az 40 karakter). Al/sat çağrısı ve hedef fiyat yazmayın."></textarea>
        <div class="grant"><input id="cS" maxlength="10" placeholder="Sembol (BTC)"><select id="cF"><option value="">Zaman dilimi</option><option>15m</option><option>1h</option><option>4h</option><option>1d</option><option>1w</option></select></div>
        <input id="cV" maxlength="120" placeholder="YouTube video bağlantısı (isteğe bağlı)"><div class="acts"><button class="chip" id="cImg">Radar grafiğini ekle</button><button class="chip" id="cFile">Görsel yükle</button><input type="file" id="cFileIn" accept="image/*" hidden></div><img id="cPrev" class="big" alt="" hidden></div>
        <button class="cta" id="cSend">${P.auto_approve ? 'Yayınla' : 'Onaya gönder'}</button></section>
      <section class="sec"><h2>Paylaşımlarım</h2>${(posts && posts.items.length) ? posts.items.map((p) => `<div class="row"><div><b>${esc(p.title)}</b><div class="dim sm">${STATUS[p.status] || p.status} · 👁 ${p.views} · ${when(p.created_at)}</div>${p.reason ? `<div class="down sm">${esc(p.reason)}</div>` : ''}</div><button class="chip" data-del="${p.id}">Sil</button></div>`).join('') : '<p class="note">Henüz paylaşımınız yok.</p>'}</section>
      <section class="sec"><h2>Cüzdan ve ödemeler</h2><div class="grant"><select id="wN"><option value="">Ağ seçin</option>${Object.entries(NET).map(([k, v]) => `<option value="${k}" ${P.network === k ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="chip" id="wSave">Kaydet</button><input id="wA" placeholder="Cüzdan adresi" value="${esc(P.wallet)}"></div>
        <p class="note" style="margin-top:8px">Adresi dikkatle girin; yanlış adrese yapılan ödeme geri alınamaz.</p>
        ${r.payouts.map((x) => `<div class="row"><div><b>${usd(x.amount_micro)}</b> <span class="dim sm">${NET[x.network] || x.network}</span><div class="dim sm">${x.status === 'paid' ? 'Ödendi · ' + esc(x.txid) : x.status === 'rejected' ? 'Reddedildi · ' + esc(x.note) : 'Bekliyor'} · ${when(x.created_at)}</div></div></div>`).join('')}</section>
      <section class="sec"><h2>Profil</h2><div class="form"><input id="pN" maxlength="40" placeholder="Görünen ad" value="${esc(P.name)}"><input id="pG" maxlength="60" placeholder="Grup adı" value="${esc(P.group_title)}"><input id="pL" maxlength="80" placeholder="https://t.me/grubunuz" value="${esc(P.group_link)}"><textarea id="pBio" rows="3" maxlength="300" placeholder="Kısa tanıtım">${esc(P.bio)}</textarea></div><button class="cta ghost" id="pSave" style="min-height:46px">Profili kaydet</button></section>`;
    const b = $('bPanel'); let img = '';
    b.querySelector('#bPay').onclick = async () => { if (!confirm('Ödenebilir bakiyenin tamamı için talep oluşturulsun mu?')) return; const x = await guard(() => API.call('POST', '/api/b/payout', {})); if (x) { toast('Talep gönderildi'); loadB(); } };
    b.querySelector('#cImg').onclick = () => {
      const src = document.querySelector('#v-radar canvas'); if (!src) return toast('Önce Radar sekmesinde bir grafik açın');
      const w = Math.min(900, src.width), k = w / src.width, c = document.createElement('canvas'); c.width = w; c.height = Math.round(src.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#060a12'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
      img = c.toDataURL('image/jpeg', 0.72); const pv = $('cPrev'); pv.src = img; pv.hidden = false; toast('Grafik eklendi');
    };
    b.querySelector('#cFile').onclick = () => $('cFileIn').click();
    b.querySelector('#cFileIn').onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const bmp = await createImageBitmap(f), k = Math.min(1, 1100 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#060a12'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
        let q = 0.85, d = c.toDataURL('image/jpeg', q); while (d.length * 0.75 > 235000 && q > 0.35) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
        if (d.length * 0.75 > 235000) return toast('Görsel çok büyük, daha küçük bir görsel seçin');
        img = d; const pv = $('cPrev'); pv.src = img; pv.hidden = false; toast('Görsel eklendi');
      } catch (err) { toast('Görsel okunamadı'); }
    };
    b.querySelector('#cSend').onclick = async () => {
      const x = await guard(() => API.call('POST', '/api/b/posts', { title: $('cT').value, body: $('cB').value, symbol: $('cS').value.trim(), tf: $('cF').value, image: img, video: $('cV').value.trim() }));
      if (x) { toast(x.status === 'pending' ? 'Onaya gönderildi' : 'Yayınlandı'); loadB(); }
    };
    b.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]'); if (!d) return; if (!confirm('Paylaşım silinsin mi?')) return;
      if (await guard(() => API.call('DELETE', '/api/b/posts/' + d.dataset.del))) loadB();
    });
    b.querySelector('#wSave').onclick = async () => { if (await guard(() => API.call('POST', '/api/b/wallet', { network: $('wN').value, address: $('wA').value }))) toast('Cüzdan kaydedildi'); };
    b.querySelector('#pSave').onclick = async () => { if (await guard(() => API.call('PUT', '/api/b/profile', { display_name: $('pN').value, group_title: $('pG').value, group_link: $('pL').value, bio: $('pBio').value }))) toast('Profil kaydedildi'); };
  }

  /* yönetim */
  async function loadA() {
    const [o, q, pay, days, gr] = await Promise.all(['overview', 'posts', 'payouts', 'days', 'grants'].map((k) => guard(() => API.call('GET', '/api/admin/' + k))));
    if (!o) return;
    const A = $('aPanel');
    const ad = (a) => `${a.today} / ${a.d7} / ${a.d30}`;
    A.innerHTML = `<section class="sec"><h2>Yönetim · özet</h2>
      <div class="kpis"><div class="kpi"><span>Kullanıcı</span><b class="num">${o.users}</b></div><div class="kpi"><span>24s aktif</span><b class="num">${o.dau}</b></div><div class="kpi"><span>Onay bekleyen</span><b class="num">${o.pending_posts}</b></div></div>
      <div class="kpis" style="margin-top:14px"><div class="kpi"><span>Onaylı gelir</span><b class="num">${usd(o.approved_revenue_micro)}</b></div><div class="kpi"><span>Yayıncı payı</span><b class="num">${usd(o.broadcaster_accrued_micro)}</b></div><div class="kpi"><span>Net sizin</span><b class="num up">${usd(o.owner_net_micro)}</b></div></div>
      <p class="note" style="margin-top:12px">Sizin reklamlarınız (bugün/7g/30g): ${ad(o.owner_ads)}. Eşleşmeyen bildirim (7g): ${o.orphans}. Bekleyen ödeme: ${o.pending_payouts.n} (${usd(o.pending_payouts.s)}).</p></section>
      <section class="sec"><h2>Yayıncılar · reklam videosu (bugün / 7g / 30g)</h2>${o.broadcasters.map((b) => `<div class="row"><div><b>${esc(b.name)}</b> <span class="dim sm">#${b.id} · ${b.status === 'active' ? 'aktif' : 'askıda'}${b.auto_approve ? ' · otomatik onay' : ''} · pay %${b.share_bps / 100}</span>
        <div class="sm">Video: <b class="num">${ad(b.ads)}</b> · toplam ${b.ads.total}</div><div class="dim sm">Hak ediş ${usd(b.accrued)} · tahsil ${usd(b.collected)} · çekilebilir ${usd(b.available)} · ödenen ${usd(b.paid)}</div></div>
        <div class="bcb"><button class="chip" data-sus="${b.id}" data-st="${b.status === 'active' ? 'suspended' : 'active'}">${b.status === 'active' ? 'Askıya al' : 'Aktifleştir'}</button><button class="chip" data-auto="${b.id}" data-on="${b.auto_approve ? 0 : 1}">${b.auto_approve ? 'Onayı aç' : 'Oto-onay'}</button></div></div>`).join('') || '<p class="note">Henüz yayıncı yok.</p>'}
        <div class="form" style="margin-top:14px"><b class="sm">Yayıncı ekle</b><div class="grant"><input id="nbI" inputmode="numeric" placeholder="Telegram kimliği"><input id="nbN" placeholder="Görünen ad"></div><input id="nbG" placeholder="Grup adı"><input id="nbL" placeholder="https://t.me/grup"></div><button class="cta ghost" id="nbAdd" style="min-height:46px">Yayıncı olarak ekle</button></section>
      <section class="sec"><h2>Onay kuyruğu (${q ? q.items.length : 0})</h2>${q && q.items.length ? q.items.map((p) => `<div class="mod"><b>${esc(p.title)}</b><div class="dim sm">${esc(p.display_name)} · ${p.symbol || '–'} ${p.tf || ''} · ${when(p.created_at)}</div>${p.has_image ? `<div class="note">Görsel var</div>` : ''}<div class="body">${esc(p.body)}</div><div class="bcb"><button class="chip" data-ap="${p.id}">Onayla</button><button class="chip" data-rj="${p.id}">Reddet</button></div></div>`).join('') : '<p class="note">Bekleyen paylaşım yok.</p>'}</section>
      <section class="sec"><h2>Ödeme talepleri</h2>${pay && pay.items.length ? pay.items.map((p) => `<div class="mod"><b>${usd(p.amount_micro)}</b> · ${esc(p.display_name)}<div class="dim sm">${NET[p.network] || p.network}</div><code class="addr">${esc(p.wallet)}</code><div class="bcb"><button class="chip" data-pay="${p.id}">Ödendi işaretle</button><button class="chip" data-prj="${p.id}">Reddet</button></div></div>`).join('') : '<p class="note">Bekleyen talep yok.</p>'}<p class="note" style="margin-top:8px">Önce cüzdana ödemeyi kendiniz gönderin, sonra işlem kimliğini (txid) yazarak "Ödendi" işaretleyin.</p></section>
      <section class="sec"><h2>Günlük gelir girişi</h2><p class="note">Adsgram panelinden dünkü gösterim ve CPM değerini girin. "Tahsil edildi", Adsgram ödemesi hesabınıza geçince işaretlenir; yayıncı bakiyeleri ancak o zaman çekilebilir olur.</p>
        ${days ? days.items.slice(0, 10).map((d) => `<div class="row"><div><b>${d.day}</b> <span class="dim sm">kayıt ${d.logged} · yayıncı ${d.bcast}</span><div class="dim sm">${d.entry ? `${d.entry.impressions} gösterim · CPM ${(d.entry.cpm_micro / 1e6).toFixed(2)} · ${usd(d.entry.revenue_micro)} · ${d.entry.collected ? 'tahsil edildi' : 'tahsil bekliyor'}` : 'girilmedi'}</div></div><button class="chip" data-day="${d.day}">Düzenle</button></div>`).join('') : ''}</section>
      <section class="sec"><h2>Pro hibesi ve düzeltme</h2><div class="grant"><input id="gI" inputmode="numeric" placeholder="Telegram kimliği"><select id="gD"><option value="30">30 gün</option><option value="90">90 gün</option><option value="365">1 yıl</option><option value="0">Süresiz</option></select><input id="gN" placeholder="Not"></div><button class="cta ghost" id="gAdd" style="min-height:46px">Pro ver</button>
        ${gr ? gr.items.map((g) => `<div class="row"><div><b>${g.user_id}</b> <span class="dim sm">${esc(g.username || '')} · ${g.until ? new Date(g.until * 1000).toLocaleDateString('tr-TR') : 'süresiz'} ${esc(g.note)}</span></div><button class="chip" data-gdel="${g.user_id}">Kaldır</button></div>`).join('') : ''}
        <div class="grant" style="margin-top:14px"><input id="adI" inputmode="numeric" placeholder="Yayıncı kimliği"><input id="adA" placeholder="Tutar USD (± )"><input id="adN" placeholder="Açıklama"></div><button class="cta ghost" id="adGo" style="min-height:46px">Bakiye düzeltmesi ekle</button></section>`;
    const reload = () => loadA();
    A.onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
      if (d.sus) return (await guard(() => API.call('PATCH', '/api/admin/broadcasters/' + d.sus, { status: d.st }))) && reload();
      if (d.auto) return (await guard(() => API.call('PATCH', '/api/admin/broadcasters/' + d.auto, { auto_approve: d.on === '1' }))) && reload();
      if (d.ap) return (await guard(() => API.call('POST', `/api/admin/posts/${d.ap}/approve`, {}))) && reload();
      if (d.rj) { const r = prompt('Ret nedeni:'); if (r) return (await guard(() => API.call('POST', `/api/admin/posts/${d.rj}/reject`, { reason: r }))) && reload(); return; }
      if (d.pay) { const x = prompt('İşlem kimliği (txid):'); if (x) return (await guard(() => API.call('POST', `/api/admin/payouts/${d.pay}/pay`, { txid: x }))) && reload(); return; }
      if (d.prj) { const r = prompt('Ret nedeni:'); if (r) return (await guard(() => API.call('POST', `/api/admin/payouts/${d.prj}/reject`, { note: r }))) && reload(); return; }
      if (d.day) { const imp = prompt(d.day + ' · Adsgram gösterim sayısı:'); if (imp == null) return; const cpm = prompt('CPM (USD):'); if (cpm == null) return; const col = confirm('Adsgram ödemesi hesabınıza geçti mi? (Tamam = tahsil edildi)'); return (await guard(() => API.call('POST', '/api/admin/days', { day: d.day, impressions: +imp, cpm, collected: col }))) && reload(); }
      if (d.gdel) return (await guard(() => API.call('DELETE', '/api/admin/grants/' + d.gdel))) && reload();
      if (t.id === 'nbAdd') return (await guard(() => API.call('POST', '/api/admin/broadcasters', { user_id: +$('nbI').value, display_name: $('nbN').value, group_title: $('nbG').value, group_link: $('nbL').value }))) && reload();
      if (t.id === 'gAdd') return (await guard(() => API.call('POST', '/api/admin/grants', { user_id: +$('gI').value, days: +$('gD').value, note: $('gN').value }))) && reload();
      if (t.id === 'adGo') return (await guard(() => API.call('POST', '/api/admin/adjust', { bcast_id: +$('adI').value, amount_usd: $('adA').value, note: $('adN').value }))) && reload();
    };
  }

  window.BeaconCommunity = {
    init() { if (BX() && document.querySelector('#v-feed.on')) loadFeed(); },
    onView(v) { if (v === 'feed') loadFeed(); if (v === 'acct') { if (API.web && !API.hasToken()) return loadAcct(); API.refreshMe().then(loadAcct).catch((e) => toast(e.message)); } },
  };
})();
