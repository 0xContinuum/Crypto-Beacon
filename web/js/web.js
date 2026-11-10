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
  window.BeaconLogin = async (u) => {
    try {
      const r = await fetch(API.base + '/api/auth/web', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(u) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Giriş başarısız');
      API.setToken(d.token); location.reload();
    } catch (e) { window.__beacon && window.__beacon.toast(e.message || 'Giriş başarısız'); }
  };
  function logged() {
    const me = API.me; who.textContent = me ? (me.first_name || me.username || String(me.id)) : '';
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = 'Çıkış'; b.onclick = () => { API.setToken(''); location.reload(); }; box.appendChild(b);
  }
  if (API.hasToken()) {
    const t = setInterval(() => { if (API.me) { clearInterval(t); logged(); } }, 300); setTimeout(() => clearInterval(t), 8000);
  } else if (bot) {
    const s = document.createElement('script'); s.async = true; s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', bot); s.setAttribute('data-size', 'medium'); s.setAttribute('data-radius', '10'); s.setAttribute('data-onauth', 'BeaconLogin(user)'); s.setAttribute('data-request-access', 'write');
    $('tgLogin').appendChild(s);
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
