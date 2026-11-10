/* Tarayıcı (Telegram dışı) kabuğu: "Telegram'da aç" bağlantısı ve Telegram ile giriş. */
(function () {
  'use strict';
  const API = window.BeaconApi || { on: false, web: true }, CFG = window.BEACON_CONFIG || {};
  const tg = window.Telegram && window.Telegram.WebApp;
  if ((tg && tg.initData) || /[?&]dev=/.test(location.search)) return;
  document.body.classList.add('web');
  const $ = (id) => document.getElementById(id), box = $('webTools'); if (!box) return;
  box.hidden = false;
  const bot = CFG.telegramBot || '';
  const open = $('openTg'); if (bot) open.href = 'https://t.me/' + bot; else open.hidden = true;
  if (!API.on) return;
  const who = $('whoami');
  const $$ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const toast = (m) => window.__beacon && window.__beacon.toast(m);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Bot üzerinden giriş: alan adı tanımı gerektirmez. Kod üretilir, kullanıcı botta onaylar, sayfa onayı bekler. */
  async function botLogin() {
    let c; try { c = await API.call('POST', '/api/auth/code', {}); } catch (e) { return toast(e.message || 'Sunucuya ulaşılamadı'); }
    const link = 'https://t.me/' + bot + '?start=login_' + c.code;
    const sc = $$('div', 'scrim on'); sc.setAttribute('role', 'dialog'); sc.setAttribute('aria-modal', 'true');
    sc.innerHTML = `<div class="panel"><div class="grab"></div><h3>Telegram ile giriş</h3>
      <p>1. Aşağıdaki düğmeyle botu açın ve <b>Başlat</b>'a basın.<br>2. Botun yazdığı doğrulama kodu burada görünenle aynıysa <b>Girişi onayla</b>'ya dokunun.</p>
      <div class="vcode num" aria-label="Doğrulama kodu">${c.verify}</div>
      <a class="cta" href="${link}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Telegram'da aç</a>
      <p class="note" id="lgSt" style="margin-top:10px">Onay bekleniyor…</p>
      <button class="cta ghost" id="lgX" style="min-height:46px">Vazgeç</button></div>`;
    document.body.appendChild(sc); let stop = false; const close = () => { stop = true; sc.remove(); };
    sc.querySelector('#lgX').onclick = close; sc.addEventListener('click', (e) => { if (e.target === sc) close(); });
    window.open(link, '_blank', 'noopener');
    const until = Date.now() + c.ttl * 1000;
    while (!stop && Date.now() < until) {
      await sleep(2000); if (stop) return;
      try {
        const r = await API.call('GET', '/api/auth/code/' + encodeURIComponent(c.code));
        if (r.status === 'ok') { API.setToken(r.token); location.reload(); return; }
      } catch (e) { if (e.status === 404) break; }
    }
    if (!stop) { const st = sc.querySelector('#lgSt'); if (st) st.textContent = 'Süre doldu. Pencereyi kapatıp yeniden deneyin.'; }
  }
  function logged() {
    const me = API.me; who.textContent = me ? (me.first_name || me.username || String(me.id)) : '';
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = 'Çıkış'; b.onclick = () => { API.setToken(''); location.reload(); }; box.appendChild(b);
  }
  if (API.hasToken()) {
    const t = setInterval(() => { if (API.me) { clearInterval(t); logged(); } }, 300); setTimeout(() => clearInterval(t), 8000);
  } else if (bot) {
    const b = document.createElement('button'); b.className = 'chip login'; b.id = 'loginBtn'; b.textContent = 'Telegram ile giriş'; b.onclick = botLogin; $('tgLogin').appendChild(b);
  }
})();

/* Web reklamı: yalnızca tarayıcıda, yalnızca webAds tanımlıysa, yalnızca onaydan sonra. */
(function () {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp;
  if ((tg && tg.initData) || /[?&]dev=/.test(location.search)) return;
  const cfg = (window.BEACON_CONFIG || {}).webAds; if (!cfg || !cfg.slots) return;
  const slots = [...document.querySelectorAll('.adslot')].filter((el) => cfg.slots[el.dataset.slot]); if (!slots.length) return;
  const KEY = 'bcn_ads_consent', box = document.getElementById('consent');
  let state = null; try { state = localStorage.getItem(KEY); } catch (e) {}
  function load() {
    if (cfg.provider === 'adsense' && cfg.client) {
      const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.client); document.head.appendChild(s);
      slots.forEach((el) => {
        el.innerHTML = '<small>Reklam</small>'; const ins = document.createElement('ins'); ins.className = 'adsbygoogle'; ins.style.display = 'block';
        ins.setAttribute('data-ad-client', cfg.client); ins.setAttribute('data-ad-slot', cfg.slots[el.dataset.slot]); ins.setAttribute('data-ad-format', 'auto'); ins.setAttribute('data-full-width-responsive', 'true');
        el.appendChild(ins); el.classList.add('on'); try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      });
    } else if (cfg.provider === 'html') {
      slots.forEach((el) => { el.innerHTML = '<small>Reklam</small>'; const d = document.createElement('div'); d.appendChild(document.createRange().createContextualFragment(cfg.slots[el.dataset.slot])); el.appendChild(d); el.classList.add('on'); });
    }
  }
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch (e) {} box.classList.remove('on'); if (v === 'yes') load(); };
  document.getElementById('cOk').onclick = () => set('yes'); document.getElementById('cNo').onclick = () => set('no');
  if (state === 'yes') load(); else if (state !== 'no') box.classList.add('on');
})();
