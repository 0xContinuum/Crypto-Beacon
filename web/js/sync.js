/*  Cihazlar arası eşitleme (saf işlevler, DOM'a dokunmaz).
 *  Eşitlenenler: göstergeler (custom), çizimler (draw), özel zaman aralıkları (ctf), takip listeleri (wl).
 *  Kural: her öğenin "u" (son değişiklik zamanı) vardır; aynı öğede en yeni kazanır. Silinenler "tomb" ile işaretlenir.
 *  ctf ve wl bütün olarak en yeni olandan alınır.
 */
(function (root) {
  'use strict';
  const idOf = (x) => String(x.id);
  const stable = (v) => JSON.stringify(v);
  const KEYS = { custom: (f) => f.name + '\u0001' + f.code + '\u0001' + (f.on ? 1 : 0), draw: (d) => stable([d.type, d.sym, d.pts, d.st, d.tx, d.lk, d.hd]) };

  /** Yerel durumu eşitleme paketine çevirir. */
  function pack(S) {
    return {
      custom: (S.custom || []).map((f) => ({ id: idOf(f), name: f.name || '', code: f.code || '', on: f.on !== false, u: f.u || 1 })),
      draw: (S.draw || []).map((d) => ({ id: idOf(d), sym: d.sym, type: d.type, pts: d.pts, st: d.st || {}, tx: d.tx || '', lk: !!d.lk, hd: !!d.hd, u: d.u || 1 })),
      ctf: { u: S.ctfU || 0, v: Array.isArray(S.ctf) ? S.ctf : [] },
      wl: { u: S.wlU || 0, v: S.wl && Array.isArray(S.wl.lists) ? S.wl : { act: 0, lists: [] } },
      tomb: { custom: Object.assign({}, (S.tomb || {}).custom), draw: Object.assign({}, (S.tomb || {}).draw) },
    };
  }

  function mergeList(a, b, ta, tb) {
    const items = new Map(), tomb = {};
    for (const t of [ta || {}, tb || {}]) for (const id in t) tomb[id] = Math.max(tomb[id] || 0, t[id]);
    for (const x of (a || []).concat(b || [])) { const k = idOf(x), cur = items.get(k); if (!cur || (x.u || 0) > (cur.u || 0)) items.set(k, x); }
    const out = [];
    for (const [k, x] of items) { if ((tomb[k] || 0) >= (x.u || 0) && tomb[k]) continue; out.push(x); }
    // sıra: yerel sıra korunur, yeniler sona eklenir
    const order = new Map((a || []).map((x, i) => [idOf(x), i]));
    out.sort((p, q) => (order.has(idOf(p)) ? order.get(idOf(p)) : 1e9) - (order.has(idOf(q)) ? order.get(idOf(q)) : 1e9));
    // kalan mezar taşları: yalnızca hâlâ silinmiş olanlar, en yeni 500
    const keep = Object.entries(tomb).filter(([k, ts]) => !out.some((x) => idOf(x) === k && (x.u || 0) > ts)).sort((p, q) => q[1] - p[1]).slice(0, 500);
    return { items: out, tomb: Object.fromEntries(keep) };
  }

  /** local ve remote paketlerini birleştirir. */
  function merge(local, remote) {
    if (!remote) return { merged: local, local: false, push: true };
    const c = mergeList(local.custom, remote.custom, (local.tomb || {}).custom, ((remote.tomb || {}).custom)), d = mergeList(local.draw, remote.draw, (local.tomb || {}).draw, ((remote.tomb || {}).draw));
    const pick = (x, y) => (y && (y.u || 0) > (x.u || 0) ? y : x);
    const merged = { custom: c.items, draw: d.items, ctf: pick(local.ctf, remote.ctf), wl: pick(local.wl, remote.wl), tomb: { custom: c.tomb, draw: d.tomb } };
    const norm = (p) => stable([p.custom.map((x) => [idOf(x), x.u]).sort(), p.draw.map((x) => [idOf(x), x.u]).sort(), p.ctf, p.wl, p.tomb]);
    const m = norm(merged);
    return { merged, local: m !== norm(local), push: m !== norm(Object.assign({ custom: [], draw: [], ctf: { u: 0, v: [] }, wl: { u: 0, v: { act: 0, lists: [] } }, tomb: { custom: {}, draw: {} } }, remote)) };
  }

  /** Birleşmiş paketi yerel duruma yazar (yerel-yalnız alanlar, örn. gösterge hatası, korunur). */
  function apply(S, m) {
    const old = new Map((S.custom || []).map((f) => [idOf(f), f]));
    S.custom = m.custom.map((x) => { const o = old.get(idOf(x)); return Object.assign(o && o.u === x.u ? o : {}, { id: isNaN(+x.id) ? x.id : +x.id, name: x.name, code: x.code, on: x.on, u: x.u }); });
    S.draw = m.draw.map((x) => Object.assign({}, x));
    S.ctf = m.ctf.v.slice(); S.ctfU = m.ctf.u;
    S.wl = JSON.parse(JSON.stringify(m.wl.v)); S.wlU = m.wl.u;
    S.tomb = { custom: Object.assign({}, m.tomb.custom), draw: Object.assign({}, m.tomb.draw) };
  }

  /** Yerel değişiklikleri izler: değişen öğenin u'sunu günceller, silinenlere mezar taşı koyar. */
  function tracker() {
    const T = { custom: new Map(), draw: new Map(), ctf: null, wl: null };
    const snap = (S) => {
      for (const kind of ['custom', 'draw']) for (const x of S[kind] || []) if (!x.u) x.u = S.ts || 1; // eski kayıtlar
      T.custom = new Map((S.custom || []).map((f) => [idOf(f), KEYS.custom(f)]));
      T.draw = new Map((S.draw || []).map((d) => [idOf(d), KEYS.draw(d)]));
      T.ctf = stable(S.ctf || []); T.wl = stable(S.wl || null);
    };
    return {
      reset: snap,
      scan(S, now) {
        now = now || Date.now(); S.tomb = S.tomb || {}; let changed = false;
        for (const kind of ['custom', 'draw']) {
          const list = S[kind] || [], prev = T[kind], cur = new Map(); S.tomb[kind] = S.tomb[kind] || {};
          for (const x of list) {
            const id = idOf(x), sg = KEYS[kind](x); cur.set(id, sg);
            if (!x.u) { x.u = now; changed = true; } else if (!prev.has(id) || prev.get(id) !== sg) { x.u = now; changed = true; }
          }
          for (const id of prev.keys()) if (!cur.has(id)) { S.tomb[kind][id] = now; changed = true; }
          T[kind] = cur;
        }
        const c = stable(S.ctf || []); if (c !== T.ctf) { S.ctfU = now; T.ctf = c; changed = true; }
        const w = stable(S.wl || null); if (w !== T.wl) { S.wlU = now; T.wl = w; changed = true; }
        return changed;
      },
    };
  }

  const api = { pack, merge, apply, tracker, mergeList };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BeaconSync = api;
})(typeof self !== 'undefined' ? self : this);
