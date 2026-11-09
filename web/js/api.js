/* Beacon sunucu istemcisi. apiUrl boşsa on=false ve uygulama eski sunucusuz modda kalır. */
(function () {
  'use strict';
  const CFG = window.BEACON_CONFIG || {};
  const tg = window.Telegram && window.Telegram.WebApp;
  const dev = (/[?&]dev=(\d{3,15})/.exec(location.search) || [])[1];
  const base = String(CFG.apiUrl || '').replace(/\/+$/, '');
  const A = { on: !!base, me: null, base };
  const initData = () => (dev ? 'dev:' + dev : (tg && tg.initData) || '');
  A.call = async function (method, path, body) {
    const h = { 'X-Init-Data': initData() };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    let r;
    try { r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new Error('Sunucuya ulaşılamadı'); }
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) { const er = new Error(d.error || 'İstek başarısız (' + r.status + ')'); er.status = r.status; er.data = d; throw er; }
    return d;
  };
  A.refreshMe = async function () { A.me = await A.call('GET', '/api/me'); return A.me; };
  A.imageUrl = (id) => base + '/api/posts/' + id + '/image';
  window.BeaconApi = A;
})();
