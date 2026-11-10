/* Beacon sunucu istemcisi. apiUrl boşsa on=false ve uygulama eski sunucusuz modda kalır. */
(function () {
  'use strict';
  const CFG = window.BEACON_CONFIG || {};
  const tg = window.Telegram && window.Telegram.WebApp;
  const dev = (/[?&]dev=(\d{3,15})/.exec(location.search) || [])[1];
  const base = String(CFG.apiUrl || '').replace(/\/+$/, '');
  const A = { on: !!base, me: null, base };
  const inTg = !!(tg && tg.initData);
  A.web = !inTg && !dev;                       // tarayıcıda (Telegram dışında) açıldı
  const TK = 'bcn_web';
  const getTok = () => { try { return localStorage.getItem(TK) || ''; } catch (e) { return ''; } };
  A.hasToken = () => !!getTok();
  A.setToken = (t) => { try { t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK); } catch (e) {} };
  const initData = () => (dev ? 'dev:' + dev : inTg ? tg.initData : getTok() ? 'web:' + getTok() : '');
  A.call = async function (method, path, body) {
    const h = { 'X-Init-Data': initData() };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    let r;
    try { r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new Error('Sunucuya ulaşılamadı'); }
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (r.status === 401 && A.web && getTok()) A.setToken('');
    if (!r.ok) { const er = new Error(d.error || 'İstek başarısız (' + r.status + ')'); er.status = r.status; er.data = d; throw er; }
    return d;
  };
  A.refreshMe = async function () { A.me = await A.call('GET', '/api/me'); return A.me; };
  A.imageUrl = (id) => base + '/api/posts/' + id + '/image';
  window.BeaconApi = A;
})();
