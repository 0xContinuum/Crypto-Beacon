/*  Beacon Formül 2: mum mum çalışan (Pine benzeri) dil.
 *  Durum tutan değişkenler (var, :=), if/else, for, while, kendi fonksiyonlar, diziler, çoklu zaman dilimi (request.security),
 *  etiket/çizgi/kutu/tablo ve renk işlevleri desteklenir. eval/Function kullanılmaz; kod ayrıştırılıp güvenle yorumlanır.
 *  Gelecek veriye bakılmaz (yalnızca geçmiş mumlar ve işlemin yapıldığı mum), bu yüzden gösterge yeniden boyanmaz.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BeaconScript2 = factory(root.Beacon);
})(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';
  const I = B.indicators;
  const LIM = { chars: 30000, steps: 6e7, ms: 4000, depth: 40, objects: 500, plots: 24 };
  class ScriptError extends Error { constructor(msg, line, extra) { super(msg); this.line = line || 0; if (extra) Object.assign(this, extra); } }
  const fin = Number.isFinite;
  const COLORS = { aqua: '#00bcd4', black: '#363a45', blue: '#2962ff', fuchsia: '#e040fb', gray: '#787b86', green: '#4caf50', lime: '#00e676', maroon: '#880e4f', navy: '#311b92', olive: '#808000', orange: '#ff9800', purple: '#9c27b0', red: '#f23645', silver: '#b2b5be', teal: '#089981', white: '#ffffff', yellow: '#fdd835' };

  /* ——— renk yardımcıları ——— */
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  function parseColor(c) { const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c || ''); if (!m) return null; const v = parseInt(m[1], 16); return { r: v >> 16, g: (v >> 8) & 255, b: v & 255, a: m[2] ? parseInt(m[2], 16) : 255 }; }
  const mkColor = (r, g, b, a = 255) => '#' + hex2(r) + hex2(g) + hex2(b) + (a >= 255 ? '' : hex2(a));
  const withTransp = (c, t) => { const p = parseColor(c); if (!p) return null; return mkColor(p.r, p.g, p.b, 255 * (1 - (fin(t) ? Math.max(0, Math.min(100, t)) : 0) / 100)); };

  /* ——— sözcük çözümleme ——— */
  function lex(s, line) {
    const t = []; let i = 0; const err = (m) => { throw new ScriptError(m, line); };
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"' || ch === "'") {
        let j = i + 1, v = '';
        while (j < s.length && s[j] !== ch) { if (s[j] === '\\' && j + 1 < s.length) { const e = s[j + 1]; v += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; } else v += s[j++]; }
        if (j >= s.length) err('Metin kapanmamış'); t.push({ k: 'str', v }); i = j + 1; continue;
      }
      if (ch === '#') { const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/.exec(s.slice(i)); if (!m) err('Renk kodu okunamadı'); t.push({ k: 'str', v: ('#' + m[1] + (m[2] || '')).toLowerCase(), color: true }); i += m[0].length; continue; }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*/.exec(s.slice(i)); t.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
      const two = s.slice(i, i + 2);
      if ([':=', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '=>'].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
      if ('+-*/%<>()[],?:=!'.includes(ch)) { t.push({ k: 'op', v: ch }); i++; continue; }
      err(`Tanınmayan karakter: ${ch}`);
    }
    // array.new<float>(...) gibi tür parametrelerini at
    for (let k = 0; k < t.length - 1; k++) {
      if (t[k].k === 'id' && /(\.new|\.from)$|^(array|matrix|map)$/.test(t[k].v) && t[k + 1].k === 'op' && t[k + 1].v === '<') {
        let d = 0, j = k + 1; for (; j < t.length; j++) { if (t[j].k === 'op' && t[j].v === '<') d++; if (t[j].k === 'op' && t[j].v === '>') { d--; if (!d) break; } }
        if (j < t.length) t.splice(k + 1, j - k);
      }
    }
    return t;
  }

  /* ——— ifade ayrıştırıcı ——— */
  let NODE_ID = 0;
  function parseExpr(tokens, line, start = 0) {
    let p = start; const err = (m) => { throw new ScriptError(m, line); };
    const isOp = (v) => tokens[p] && tokens[p].k === 'op' && tokens[p].v === v, isId = (v) => tokens[p] && tokens[p].k === 'id' && tokens[p].v === v;
    const eat = (v) => { if (!isOp(v)) err(`"${v}" bekleniyordu`); p++; };
    function expr(d) {
      if (d > 60) err('İfade çok iç içe');
      const c = orE(d + 1);
      if (isOp('?')) { p++; const a = expr(d + 1); eat(':'); const b = expr(d + 1); return { t: 'tern', c, a, b }; }
      return c;
    }
    function orE(d) { let l = andE(d); while (isId('or') || isOp('||')) { p++; l = { t: 'bin', o: 'or', l, r: andE(d) }; } return l; }
    function andE(d) { let l = notE(d); while (isId('and') || isOp('&&')) { p++; l = { t: 'bin', o: 'and', l, r: notE(d) }; } return l; }
    function notE(d) { if (isId('not') || isOp('!')) { p++; return { t: 'un', o: 'not', x: notE(d) }; } return cmp(d); }
    function cmp(d) { let l = add(d); for (;;) { const t = tokens[p]; if (t && t.k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(t.v)) { p++; l = { t: 'bin', o: t.v, l, r: add(d) }; } else return l; } }
    function add(d) { let l = mul(d); while (isOp('+') || isOp('-')) { const o = tokens[p++].v; l = { t: 'bin', o, l, r: mul(d) }; } return l; }
    function mul(d) { let l = un(d); while (isOp('*') || isOp('/') || isOp('%')) { const o = tokens[p++].v; l = { t: 'bin', o, l, r: un(d) }; } return l; }
    function un(d) { if (isOp('-')) { p++; return { t: 'un', o: '-', x: un(d + 1) }; } if (isOp('+')) { p++; return un(d + 1); } return post(d); }
    function post(d) {
      let e = atom(d);
      while (isOp('[')) { p++; const k = expr(d + 1); eat(']'); e = { t: 'idx', b: e, k, id: ++NODE_ID }; }
      return e;
    }
    function atom(d) {
      const t = tokens[p]; if (!t) err('İfade yarım kaldı');
      if (t.k === 'num') { p++; return { t: 'lit', v: t.v }; }
      if (t.k === 'str') { p++; return { t: 'lit', v: t.v }; }
      if (t.k === 'id') {
        p++;
        if (isOp('(')) {
          p++; const args = [];
          if (!isOp(')')) {
            for (;;) {
              if (tokens[p] && tokens[p].k === 'id' && tokens[p + 1] && tokens[p + 1].k === 'op' && tokens[p + 1].v === '=') { const key = tokens[p].v; p += 2; args.push({ key, e: expr(d + 1) }); }
              else args.push({ e: expr(d + 1) });
              if (isOp(',')) { p++; continue; } break;
            }
          }
          eat(')'); return { t: 'call', n: t.v, args, id: ++NODE_ID };
        }
        return { t: 'var', n: t.v };
      }
      if (isOp('(')) { p++; const e = expr(d + 1); eat(')'); return e; }
      if (isOp('[')) { p++; const items = []; if (!isOp(']')) { for (;;) { items.push(expr(d + 1)); if (isOp(',')) { p++; continue; } break; } } eat(']'); return { t: 'arr', items }; }
      return err(`Beklenmeyen "${t.v}"`);
    }
    const e = expr(0);
    return { e, p };
  }

  /* ——— satırlar ve bloklar ——— */
  function logicalLines(src) {
    const out = []; let buf = null;
    const strip = (ln) => { let q = null; for (let i = 0; i < ln.length; i++) { const c = ln[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '/' && ln[i + 1] === '/') return ln.slice(0, i); } return ln; };
    const depth = (ln) => { let q = null, d = 0; for (let i = 0; i < ln.length; i++) { const c = ln[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; } return d; };
    const cont = (t) => /(^|[^=!<>:+\-*/%])[,+\-*/?:%]$|[=<>]=?$|(\band|\bor|\bnot)$/.test(t) && !/=>\s*$/.test(t) && !/(\bif|\bfor|\bwhile)\s.*$/.test(t.replace(/\(.*\)/, '')) ? !/:=$|[^=!<>]=$/.test(t) || /[=<>!]=$/.test(t) || false : false;
    String(src).replace(/\r/g, '').replace(/\t/g, '    ').split('\n').forEach((raw, k) => {
      const body = strip(raw), txt = body.trim();
      if (buf) { if (txt) { buf.text += ' ' + txt; buf.depth += depth(body); } if (buf.depth <= 0 && !/[,+\-*/?:]$|\b(and|or)$/.test(buf.text)) { out.push(buf); buf = null; } return; }
      if (!txt) return;
      const st = { line: k + 1, indent: body.length - body.trimStart().length, text: txt, depth: depth(body) };
      if (st.depth > 0 || (/[,+\-*/?]$|\b(and|or)$/.test(txt) && !/=>$/.test(txt)) || /:$/.test(txt) && !/^(else|switch|default)\b/.test(txt) && !/^(if|for|while)\b/.test(txt)) buf = st;
      else if (out.length && st.indent % 4 !== 0 && st.indent > out[out.length - 1].indent && !/^(else)\b/.test(txt)) out[out.length - 1].text += ' ' + txt;
      else out.push(st);
    });
    void cont;
    if (buf) out.push(buf);
    return out;
  }

  const TYPE_WORDS = /^(?:(?:var|varip|const|simple|series)\s+)*(?:(?:int|float|bool|string|color|label|line|box|table|linefill|chart\.point)(?:\[\])?\s+)?/;
  function compile(src) {
    if (typeof src !== 'string' || !src.trim()) throw new ScriptError('Kod boş', 0);
    if (src.length > LIM.chars) throw new ScriptError(`Kod en çok ${LIM.chars} karakter olabilir`, 0);
    const L = [];
    for (const st of logicalLines(src)) {
      if (/^(if|for|while|else)\b/.test(st.text)) { L.push(st); continue; }
      let d = 0, q = null, last0 = 0; const parts = [];
      for (let i = 0; i < st.text.length; i++) { const c = st.text[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; else if (c === ',' && !d) { parts.push(st.text.slice(last0, i)); last0 = i + 1; } }
      parts.push(st.text.slice(last0));
      parts.forEach((x) => { if (x.trim()) L.push(Object.assign({}, st, { text: x.trim() })); });
    }
    let uid = 0; const funcs = new Map();
    function block(i, indent) { // indent'ten büyük girintili satırları toplar
      const out = []; let j = i;
      while (j < L.length && L[j].indent > indent) { const r = stmt(j); out.push(r.s); j = r.next; }
      return { body: out, next: j };
    }
    function stmt(i) {
      const st = L[i], line = st.line, text = st.text; let m;
      const err = (msg) => { throw new ScriptError(msg, line); };
      const sub = () => block(i + 1, st.indent);
      const px = (str) => { const toks = lex(str, line); const r = parseExpr(toks, line); if (r.p < toks.length) err(`Beklenmeyen "${toks[r.p].v}"`); return r.e; };
      if ((m = /^if\s+(.+)$/.exec(text))) {
        const cond = px(m[1]), th = sub(); let j = th.next, els = null;
        if (j < L.length && L[j].indent === st.indent && /^else\b/.test(L[j].text)) {
          const em = /^else\s+if\s+(.+)$/.exec(L[j].text);
          if (em) { // else if → iç içe if
            const fake = L[j]; const saved = fake.text; fake.text = 'if ' + em[1]; const r = stmt(j); fake.text = saved; els = [r.s]; j = r.next;
          } else { const eb = block(j + 1, L[j].indent); els = eb.body; j = eb.next; }
        }
        return { s: { t: 'if', c: cond, then: th.body, els, line }, next: j };
      }
      if ((m = /^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+?)(?:\s+by\s+(.+))?$/.exec(text))) { const b = sub(); return { s: { t: 'for', v: m[1], a: px(m[2]), b: px(m[3]), by: m[4] ? px(m[4]) : null, body: b.body, line }, next: b.next }; }
      if ((m = /^for\s+(?:\[\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\]|([A-Za-z_]\w*))\s+in\s+(.+)$/.exec(text))) { const b = sub(); return { s: { t: 'forin', i: m[1] || null, v: m[2] || m[3], e: px(m[4]), body: b.body, line }, next: b.next }; }
      if ((m = /^while\s+(.+)$/.exec(text))) { const b = sub(); return { s: { t: 'while', c: px(m[1]), body: b.body, line }, next: b.next }; }
      if (/^break$/.test(text)) return { s: { t: 'break', line }, next: i + 1 };
      if (/^continue$/.test(text)) return { s: { t: 'continue', line }, next: i + 1 };
      if ((m = /^(?:export\s+)?(?:method\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>\s*(.*)$/.exec(text)) && !/^(if|for|while)\b/.test(text)) {
        const params = m[2].split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const pm = /^(?:(?:series|simple|const)\s+)?(?:(?:int|float|bool|string|color|label|line|box|table)(?:\[\])?\s+)?([A-Za-z_]\w*)(?:\s*=\s*(.+))?$/.exec(x); if (!pm) err('Fonksiyon parametresi okunamadı'); return { n: pm[1], def: pm[2] ? px(pm[2]) : null }; });
        let body, next = i + 1;
        if (m[3]) body = [{ t: 'expr', e: px(m[3]), line }]; else { const b = sub(); body = b.body; next = b.next; }
        funcs.set(m[1], { n: m[1], params, body, line });
        return { s: { t: 'nop', line }, next };
      }
      // atama kalıpları
      let t2 = text, isVar = false;
      if (/^(var|varip)\s+/.test(t2)) { isVar = true; t2 = t2.replace(/^(var|varip)\s+/, ''); }
      t2 = t2.replace(/^(?:array|matrix|map)\s*<[^>]*>\s+(?=[A-Za-z_])/, '').replace(TYPE_WORDS, '');
      if ((m = /^\[\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\]\s*=\s*(.+)$/.exec(t2))) return { s: { t: 'tuple', names: m[1].split(',').map((x) => x.trim()), e: px(m[2]), line }, next: i + 1 };
      if ((m = /^([A-Za-z_]\w*)\s*(:=|\+=|-=|\*=|\/=|%=)\s*(.+)$/.exec(t2))) return { s: { t: 're', n: m[1], op: m[2], e: px(m[3]), line }, next: i + 1 };
      if ((m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(t2)) && !/^=/.test(m[2])) return { s: { t: 'set', n: m[1], e: px(m[2]), v: isVar, uid: ++uid, line }, next: i + 1 };
      return { s: { t: 'expr', e: px(text), line }, next: i + 1 };
    }
    const base = L.length ? Math.min(...L.map((x) => x.indent)) : 0, prog = []; let i = 0;
    while (i < L.length) {
      if (L[i].indent > base) { i++; continue; }
      const r = stmt(i); prog.push(r.s); i = r.next;
    }
    return { prog, funcs };
  }

  /* ——— çalışma zamanı ——— */
  const PINE_TF = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1d': 'D', '1w': 'W', '1M': 'M' };
  const TF_BIN = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', D: '1d', '1D': '1d', W: '1w', '1W': '1w', M: '1M', '1M': '1M' };
  const TF_MS = { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5, '1M': 2592e6 };
  const binTf = (s) => { s = String(s).trim(); if (TF_BIN[s]) return TF_BIN[s]; const m = /^(\d+)([smhDWM]?)$/.exec(s); if (!m) return null; const n = +m[1], u = m[2]; if (!u) return TF_BIN[n] || null; if (u === 'm') return TF_BIN[n] || null; if (u === 'h') return TF_BIN[n * 60] || null; if (u === 'D') return n === 1 ? '1d' : null; if (u === 'W') return n === 1 ? '1w' : null; if (u === 'M') return n === 1 ? '1M' : null; return null; };

  function tfNeeds(src, chartTf) {
    const set = new Set(); const re = /"(\d{1,3}[mhDWM]?|[DWM]|1[DWM])"/g; let m;
    while ((m = re.exec(src))) { const b = binTf(m[1]); if (b && b !== chartTf && TF_MS[b] > (TF_MS[chartTf] || 0)) set.add(b); }
    return [...set];
  }

  function execute(code, candles, opts, cap) {
    opts = opts || {};
    const { prog, funcs } = code, n = candles.length, t0 = Date.now();
    const chartTf = opts.tf || (n > 1 ? Object.keys(TF_MS).find((k) => TF_MS[k] === candles[1].t - candles[0].t) : '1h') || '1h', chartMs = TF_MS[chartTf] || (n > 1 ? candles[1].t - candles[0].t : 36e5);
    const S = { // seriler
      open: candles.map((k) => k.o), high: candles.map((k) => k.h), low: candles.map((k) => k.l), close: candles.map((k) => k.c), volume: candles.map((k) => k.v), time: candles.map((k) => k.t),
    };
    S.hl2 = candles.map((k) => (k.h + k.l) / 2); S.hlc3 = candles.map((k) => (k.h + k.l + k.c) / 3); S.ohlc4 = candles.map((k) => (k.o + k.h + k.l + k.c) / 4); S.hlcc4 = candles.map((k) => (k.h + k.l + 2 * k.c) / 4);
    S.tr = I.trueRange(S.high, S.low, S.close); S.bar_index = candles.map((_, i) => i);
    { let acc = 0; S.obv = candles.map((k, i) => { if (i) acc += Math.sign(k.c - candles[i - 1].c) * k.v; return acc; }); }
    let bi = 0, line = 0, steps = 0;
    const err = (m, extra) => { throw new ScriptError(m, line, extra); };
    const tick = () => { if (++steps > LIM.steps || ((steps & 0xffff) === 0 && Date.now() - t0 > LIM.ms)) err('Kod çok uzun çalışıyor (üst sınır aşıldı). Döngüleri ve uzun periyotları azaltın.'); };

    const out = { list: [], draws: { labels: [], lines: [], boxes: [], tables: [] }, byNode: new Map(), indicator: { title: '', overlay: true } };
    const persist = new Map(); // callsite durumu: anahtar → {}
    const stateOf = (key) => { let s = persist.get(key); if (!s) { s = { pv: new Map(), vh: new Map(), inited: new Set(), a: [], b: [], x: {} }; persist.set(key, s); } return s; };
    class Frame { constructor(st, path) { this.vars = new Map(); this.st = st; this.path = path; } }
    const G = new Frame(stateOf('G'), 'G');

    /* değer yardımcıları */
    const isNa = (v) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
    const num = (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v === null || v === undefined ? NaN : typeof v === 'string' ? NaN : NaN);
    const truthy = (v) => (typeof v === 'number' ? v !== 0 && !Number.isNaN(v) : !!v && v !== null);
    const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e8) / 1e8));
    const str = (v) => (typeof v === 'string' ? v : isNa(v) ? 'NaN' : typeof v === 'number' ? fmtNum(v) : typeof v === 'boolean' ? String(v) : '[nesne]');
    const rec = (arr, i, v) => { while (arr.length < i) arr.push(NaN); arr[i] = v; };
    const last = (a, i, k) => (i - k >= 0 && a[i - k] !== undefined ? a[i - k] : NaN);

    /* ——— TA işlevleri ——— */
    const winOK = (a, i, p) => { if (i < p - 1) return false; for (let j = i - p + 1; j <= i; j++) if (!fin(a[j])) return false; return true; };
    const per = (v, nm) => { if (!Number.isInteger(v) || v < 1 || v > 5000) err(`${nm}: periyot 1 ile 5000 arasında tam sayı olmalı`); return v; };
    function emaStep(st, x, p, rma) {
      if (st.prev === undefined) { st.cnt = 0; st.sum = 0; st.prev = NaN; }
      if (!fin(x)) return NaN;
      if (st.cnt < p) { st.sum += x; st.cnt++; if (st.cnt === p) { st.prev = st.sum / p; return st.prev; } return NaN; }
      st.prev = rma ? (st.prev * (p - 1) + x) / p : x * (2 / (p + 1)) + st.prev * (1 - 2 / (p + 1)); return st.prev;
    }
    const TA = {
      sma: (a, st, i) => { const p = per(a[1], 'sma'); rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN; let s = 0; for (let j = i - p + 1; j <= i; j++) s += st.a[j]; return s / p; },
      ema: (a, st) => emaStep(st.x, a[0], per(a[1], 'ema'), false),
      rma: (a, st) => emaStep(st.x, a[0], per(a[1], 'rma'), true),
      atr: (a, st) => emaStep(st.x, S.tr[bi], per(a[0], 'atr'), true),
      rsi: (a, st, i) => {
        const p = per(a[1], 'rsi'), x = st.x, c = a[0];
        if (x.pc === undefined) { x.pc = c; x.cnt = 0; x.g = 0; x.l = 0; x.out = NaN; return NaN; }
        const d = c - x.pc; x.pc = c; if (!fin(d)) return NaN;
        const rs = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
        if (x.cnt < p) { x.cnt++; if (d > 0) x.g += d; else x.l -= d; if (x.cnt === p) { x.g /= p; x.l /= p; return rs(x.g, x.l); } return NaN; }
        x.g = (x.g * (p - 1) + (d > 0 ? d : 0)) / p; x.l = (x.l * (p - 1) + (d < 0 ? -d : 0)) / p; void i; return rs(x.g, x.l);
      },
      highest: (a, st, i) => { let src, p; if (a.length === 1) { src = S.high[bi]; p = per(a[0], 'highest'); } else { src = a[0]; p = per(a[1], 'highest'); } rec(st.a, i, src); if (!winOK(st.a, i, p)) return NaN; let m = -Infinity; for (let j = i - p + 1; j <= i; j++) if (st.a[j] > m) m = st.a[j]; return m; },
      lowest: (a, st, i) => { let src, p; if (a.length === 1) { src = S.low[bi]; p = per(a[0], 'lowest'); } else { src = a[0]; p = per(a[1], 'lowest'); } rec(st.a, i, src); if (!winOK(st.a, i, p)) return NaN; let m = Infinity; for (let j = i - p + 1; j <= i; j++) if (st.a[j] < m) m = st.a[j]; return m; },
      stdev: (a, st, i) => { const p = per(a[1], 'stdev'); rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN; let s = 0; for (let j = i - p + 1; j <= i; j++) s += st.a[j]; const m = s / p; let v = 0; for (let j = i - p + 1; j <= i; j++) v += (st.a[j] - m) ** 2; return Math.sqrt(v / p); },
      sum: (a, st, i) => { const p = per(a[1], 'sum'); rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN; let s = 0; for (let j = i - p + 1; j <= i; j++) s += st.a[j]; return s; },
      wma: (a, st, i) => { const p = per(a[1], 'wma'); rec(st.a, i, a[0]); return wmaAt(st.a, i, p); },
      hma: (a, st, i) => { const p = per(a[1], 'hma'), h = Math.max(1, Math.floor(p / 2)), r = Math.max(1, Math.floor(Math.sqrt(p))); rec(st.a, i, a[0]); rec(st.b, i, 2 * wmaAt(st.a, i, h) - wmaAt(st.a, i, p)); return wmaAt(st.b, i, r); },
      vwma: (a, st, i) => { const p = per(a[1], 'vwma'); rec(st.a, i, a[0] * S.volume[bi]); if (!winOK(st.a, i, p)) return NaN; let s = 0, v = 0; for (let j = i - p + 1; j <= i; j++) { s += st.a[j]; v += S.volume[j]; } return v ? s / v : NaN; },
      alma: (a, st, i) => {
        const p = per(a[1], 'alma'), off = a.length > 2 ? a[2] : 0.85, sg = a.length > 3 ? a[3] : 6; rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN;
        const m = Math.floor(off * (p - 1)), sd = p / sg; let s = 0, ws = 0; for (let k = 0; k < p; k++) { const w = Math.exp(-((k - m) ** 2) / (2 * sd * sd)); s += w * st.a[i - p + 1 + k]; ws += w; } return s / ws;
      },
      linreg: (a, st, i) => { const p = per(a[1], 'linreg'), off = a.length > 2 ? a[2] : 0; rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN; let sx = 0, sy = 0, sxy = 0, sxx = 0; for (let k = 0; k < p; k++) { const y = st.a[i - p + 1 + k]; sx += k; sy += y; sxy += k * y; sxx += k * k; } const sl = (p * sxy - sx * sy) / (p * sxx - sx * sx), ic = (sy - sl * sx) / p; return ic + sl * (p - 1 - off); },
      cci: (a, st, i) => { const p = per(a[1], 'cci'); rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN; let s = 0; for (let j = i - p + 1; j <= i; j++) s += st.a[j]; const m = s / p; let d = 0; for (let j = i - p + 1; j <= i; j++) d += Math.abs(st.a[j] - m); d /= p; return d ? (st.a[i] - m) / (0.015 * d) : 0; },
      mfi: (a, st, i) => { const p = a.length > 1 ? per(a[1], 'mfi') : 14; rec(st.a, i, a[0]); if (i < p || !winOK(st.a, i, p + 1)) return NaN; let pos = 0, neg = 0; for (let j = i - p + 1; j <= i; j++) { const mf = st.a[j] * S.volume[j]; if (st.a[j] > st.a[j - 1]) pos += mf; else if (st.a[j] < st.a[j - 1]) neg += mf; } return neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg); },
      stoch: (a, st, i) => { const p = per(a[3], 'stoch'); rec(st.a, i, a[0]); rec(st.b, i, a[1]); (st.c = st.c || []); rec(st.c, i, a[2]); if (i < p - 1) return NaN; let hh = -Infinity, ll = Infinity; for (let j = i - p + 1; j <= i; j++) { if (st.b[j] > hh) hh = st.b[j]; if (st.c[j] < ll) ll = st.c[j]; } return hh > ll ? (100 * (a[0] - ll)) / (hh - ll) : NaN; },
      change: (a, st, i) => { const k = a.length > 1 ? per(a[1], 'change') : 1; rec(st.a, i, a[0]); return i - k >= 0 ? a[0] - st.a[i - k] : NaN; },
      mom: (a, st, i) => { const k = per(a[1], 'mom'); rec(st.a, i, a[0]); return i - k >= 0 ? a[0] - st.a[i - k] : NaN; },
      roc: (a, st, i) => { const k = per(a[1], 'roc'); rec(st.a, i, a[0]); return i - k >= 0 ? (100 * (a[0] - st.a[i - k])) / st.a[i - k] : NaN; },
      rising: (a, st, i) => { const k = per(a[1], 'rising'); rec(st.a, i, a[0]); if (i < k) return false; for (let j = i - k + 1; j <= i; j++) if (!(st.a[j] > st.a[j - 1])) return false; return true; },
      falling: (a, st, i) => { const k = per(a[1], 'falling'); rec(st.a, i, a[0]); if (i < k) return false; for (let j = i - k + 1; j <= i; j++) if (!(st.a[j] < st.a[j - 1])) return false; return true; },
      cum: (a, st) => { st.x.s = (st.x.s || 0) + (fin(a[0]) ? a[0] : 0); return st.x.s; },
      crossover: (a, st) => { const x = st.x, r = x.pa !== undefined && a[0] > a[1] && x.pa <= x.pb; x.pa = a[0]; x.pb = a[1]; return r; },
      crossunder: (a, st) => { const x = st.x, r = x.pa !== undefined && a[0] < a[1] && x.pa >= x.pb; x.pa = a[0]; x.pb = a[1]; return r; },
      cross: (a, st) => { const x = st.x, r = x.pa !== undefined && ((a[0] > a[1] && x.pa <= x.pb) || (a[0] < a[1] && x.pa >= x.pb)); x.pa = a[0]; x.pb = a[1]; return r; },
      barssince: (a, st, i) => { if (truthy(a[0])) st.x.l = i; return st.x.l === undefined ? NaN : i - st.x.l; },
      valuewhen: (a, st, i) => { const oc = a.length > 2 ? a[2] : 0; (st.x.v = st.x.v || []); if (truthy(a[0])) st.x.v.push(a[1]); void i; return st.x.v.length > oc ? st.x.v[st.x.v.length - 1 - oc] : NaN; },
      highestbars: (a, st, i) => { const p = per(a[1], 'highestbars'); rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN; let m = -Infinity, k = 0; for (let j = i - p + 1; j <= i; j++) if (st.a[j] >= m) { m = st.a[j]; k = j; } return k - i; },
      lowestbars: (a, st, i) => { const p = per(a[1], 'lowestbars'); rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return NaN; let m = Infinity, k = 0; for (let j = i - p + 1; j <= i; j++) if (st.a[j] <= m) { m = st.a[j]; k = j; } return k - i; },
      pivothigh: (a, st, i) => pivot(a, st, i, true), pivotlow: (a, st, i) => pivot(a, st, i, false),
      fixnan: (a, st) => { if (fin(a[0])) st.x.l = a[0]; return st.x.l === undefined ? NaN : st.x.l; },
      macd: (a, st) => { const f = emaStep(st.x.f || (st.x.f = {}), a[0], a[1], false), s = emaStep(st.x.s || (st.x.s = {}), a[0], a[2], false), line = fin(f) && fin(s) ? f - s : NaN, sg = emaStep(st.x.g || (st.x.g = {}), line, a[3], false); return [line, sg, fin(line) && fin(sg) ? line - sg : NaN]; },
      bb: (a, st, i) => { const p = per(a[1], 'bb'); rec(st.a, i, a[0]); if (!winOK(st.a, i, p)) return [NaN, NaN, NaN]; let s = 0; for (let j = i - p + 1; j <= i; j++) s += st.a[j]; const m = s / p; let v = 0; for (let j = i - p + 1; j <= i; j++) v += (st.a[j] - m) ** 2; const d = a[2] * Math.sqrt(v / p); return [m, m + d, m - d]; },
      supertrend: (a, st) => {
        const x = st.x, f = a[0], atr = emaStep(x.at || (x.at = {}), S.tr[bi], per(a[1], 'supertrend'), true), hl2 = S.hl2[bi], c = S.close[bi];
        let up = hl2 + f * atr, lo = hl2 - f * atr; const pl = x.pl === undefined || !fin(x.pl) ? 0 : x.pl, pu = x.pu === undefined || !fin(x.pu) ? 0 : x.pu, pc = bi ? S.close[bi - 1] : NaN;
        lo = lo > pl || pc < pl ? lo : pl; up = up < pu || pc > pu ? up : pu;
        let dir; if (!fin(x.patr)) dir = 1; else if (x.pst === x.pu) dir = c > up ? -1 : 1; else dir = c < lo ? 1 : -1;
        const stv = dir === -1 ? lo : up; x.patr = atr; x.pl = lo; x.pu = up; x.pst = stv; return [fin(atr) ? stv : NaN, dir];
      },
    };
    function wmaAt(a, i, p) { if (!winOK(a, i, p)) return NaN; let s = 0; for (let j = 0; j < p; j++) s += a[i - j] * (p - j); return s / ((p * (p + 1)) / 2); }
    function pivot(a, st, i, hi) {
      const L = per(a[1], 'pivot'), R = per(a[2], 'pivot'); rec(st.a, i, a[0]); const c = i - R; if (c - L < 0) return NaN;
      const v = st.a[c]; if (!fin(v)) return NaN; for (let j = c - L; j <= c + R; j++) { if (j === c) continue; if (!fin(st.a[j])) return NaN; if (hi ? st.a[j] > v : st.a[j] < v) return NaN; } return v;
    }
    const TA_ALIAS = { 'ta.sma': 'sma', 'ta.ema': 'ema', 'ta.rma': 'rma', 'ta.atr': 'atr', 'ta.rsi': 'rsi', 'ta.highest': 'highest', 'ta.lowest': 'lowest', 'ta.stdev': 'stdev', 'math.sum': 'sum', 'ta.wma': 'wma', 'ta.hma': 'hma', 'ta.vwma': 'vwma', 'ta.alma': 'alma', 'ta.linreg': 'linreg', 'ta.cci': 'cci', 'ta.mfi': 'mfi', 'ta.stoch': 'stoch', 'ta.change': 'change', 'ta.mom': 'mom', 'ta.roc': 'roc', 'ta.rising': 'rising', 'ta.falling': 'falling', 'ta.cum': 'cum', 'ta.crossover': 'crossover', 'ta.crossunder': 'crossunder', 'ta.cross': 'cross', 'ta.barssince': 'barssince', 'ta.valuewhen': 'valuewhen', 'ta.highestbars': 'highestbars', 'ta.lowestbars': 'lowestbars', 'ta.pivothigh': 'pivothigh', 'ta.pivotlow': 'pivotlow', 'ta.fixnan': 'fixnan', 'ta.macd': 'macd', 'ta.bb': 'bb', 'ta.supertrend': 'supertrend', 'ta.sum': 'sum' };
    ['sma', 'ema', 'rma', 'atr', 'rsi', 'highest', 'lowest', 'stdev', 'wma', 'hma', 'vwma', 'alma', 'cci', 'mfi', 'stoch', 'change', 'mom', 'roc', 'crossover', 'crossunder', 'cross', 'barssince', 'valuewhen', 'pivothigh', 'pivotlow', 'fixnan', 'macd', 'supertrend', 'linreg', 'cum', 'rising', 'falling', 'highestbars', 'lowestbars'].forEach((k) => { if (!TA_ALIAS[k]) TA_ALIAS[k] = k; });

    /* ——— sabitler ve yerleşik değişkenler ——— */
    const NS_CONST = /^(shape|location|size|position|text|label|line|xloc|yloc|extend|display|format|currency|scale|hline|alert|barmerge|session|order|font|plot|adjustment|backadjustment|settlement_as_close|dividends|earnings|splits)\./;
    const has0 = () => false;
    function builtinVar(name) {
      if (name in S) return S[name][bi];
      switch (name) {
        case 'na': return NaN; case 'true': return true; case 'false': return false;
        case 'last_bar_index': return n - 1; case 'last_bar_time': return S.time[n - 1];
        case 'barstate.islast': return bi === n - 1; case 'barstate.isfirst': return bi === 0; case 'barstate.isconfirmed': return true; case 'barstate.ishistory': return bi < n - 1; case 'barstate.isrealtime': return bi === n - 1; case 'barstate.islastconfirmedhistory': return bi === n - 1;
        case 'syminfo.tickerid': case 'syminfo.ticker': return opts.symbol || 'BTCUSDT'; case 'syminfo.mintick': return 1e-8; case 'syminfo.basecurrency': return (opts.symbol || 'BTCUSDT').replace(/USDT$/, ''); case 'syminfo.currency': return 'USDT'; case 'syminfo.type': return 'crypto'; case 'syminfo.pointvalue': return 1;
        case 'timeframe.period': return PINE_TF[chartTf] || chartTf; case 'timeframe.multiplier': return chartMs >= 6048e5 ? 1 : chartMs >= 864e5 ? chartMs / 864e5 : chartMs >= 36e5 ? chartMs / 6e4 : chartMs / 6e4; case 'timeframe.isintraday': return chartMs < 864e5; case 'timeframe.isdaily': return chartMs === 864e5; case 'timeframe.isweekly': return chartMs === 6048e5; case 'timeframe.ismonthly': return chartMs >= 2592e6; case 'timeframe.isdwm': return chartMs >= 864e5;
        case 'chart.bg_color': return '#0b0f19'; case 'chart.fg_color': return '#e9eef8'; case 'chart.is_standard': return true;
        case 'year': return new Date(S.time[bi]).getUTCFullYear(); case 'month': return new Date(S.time[bi]).getUTCMonth() + 1; case 'dayofmonth': return new Date(S.time[bi]).getUTCDate(); case 'dayofweek': return new Date(S.time[bi]).getUTCDay() + 1; case 'hour': return new Date(S.time[bi]).getUTCHours(); case 'minute': return new Date(S.time[bi]).getUTCMinutes(); case 'second': return 0; case 'weekofyear': return Math.ceil(((S.time[bi] - Date.UTC(new Date(S.time[bi]).getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
        case 'timenow': return S.time[n - 1]; case 'math.pi': return Math.PI; case 'math.e': return Math.E; case 'strategy.long': return 'long'; case 'strategy.short': return 'short';
        case 'strategy.position_size': case 'strategy.equity': case 'strategy.netprofit': case 'strategy.opentrades': case 'strategy.closedtrades': case 'strategy.initial_capital': return 0;
        default: break;
      }
      if (COLORS[name] && !has0(name)) return COLORS[name];
      const cm = /^color\.(\w+)$/.exec(name); if (cm && COLORS[cm[1]]) return COLORS[cm[1]];
      if (NS_CONST.test(name)) return name.split('.').slice(1).join('.');
      return undefined;
    }

    /* ——— değişken erişimi ——— */
    function lookup(name, F) {
      if (F.vars.has(name)) return F.vars.get(name);
      if (F.st.pv.has(name)) return F.st.pv.get(name);
      if (F !== G) { if (G.vars.has(name)) return G.vars.get(name); if (G.st.pv.has(name)) return G.st.pv.get(name); }
      const b = builtinVar(name); if (b !== undefined) return b;
      return err(`Tanımsız değişken: ${name}`);
    }
    const has = (name, F) => F.vars.has(name) || F.st.pv.has(name) || (F !== G && (G.vars.has(name) || G.st.pv.has(name)));
    function histOf(name, F, k) {
      if (name in S) return last(S[name], bi, k);
      if (k === 0) return lookup(name, F);
      let fr = F; if (!(F.vars.has(name) || F.st.pv.has(name)) && F !== G) fr = G;
      const h = fr.st.vh.get(name); return h && h[bi - k] !== undefined ? h[bi - k] : NaN;
    }
    function recordHist(F) { const vh = F.st.vh; for (const [k, v] of F.vars) { let h = vh.get(k); if (!h) { h = []; vh.set(k, h); } h[bi] = v; } for (const [k, v] of F.st.pv) { let h = vh.get(k); if (!h) { h = []; vh.set(k, h); } h[bi] = v; } }
    const nodeHist = new Map();

    /* ——— ifade değerlendirme ——— */
    function bin(o, a, b) {
      if (o === 'and') return truthy(a) && truthy(b); if (o === 'or') return truthy(a) || truthy(b);
      if (o === '+' && (typeof a === 'string' || typeof b === 'string')) return str(a) + str(b);
      if (o === '==') { if (typeof a === 'string' || typeof b === 'string') return a === b; return fin(num(a)) && fin(num(b)) ? num(a) === num(b) : false; }
      if (o === '!=') { if (typeof a === 'string' || typeof b === 'string') return a !== b; return !(fin(num(a)) && fin(num(b)) && num(a) === num(b)); }
      if (typeof a === 'string' && typeof b === 'string' && ['<', '>', '<=', '>='].includes(o)) return o === '<' ? a < b : o === '>' ? a > b : o === '<=' ? a <= b : a >= b;
      if (typeof a === 'object' && a !== null || typeof b === 'object' && b !== null) err('Nesneler üzerinde işlem yapılamaz');
      const x = num(a), y = num(b);
      switch (o) {
        case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return y === 0 ? NaN : x / y; case '%': return y === 0 ? NaN : x % y;
        case '<': return x < y; case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y;
        default: return err('Bilinmeyen işleç ' + o);
      }
    }
    function ev(e, F) {
      tick();
      switch (e.t) {
        case 'lit': return e.v;
        case 'var': return lookup(e.n, F);
        case 'un': { const v = ev(e.x, F); return e.o === 'not' ? !truthy(v) : -num(v); }
        case 'bin': { if (e.o === 'and') { const l = ev(e.l, F); return truthy(l) ? truthy(ev(e.r, F)) : (ev(e.r, F), false); } if (e.o === 'or') { const l = ev(e.l, F); return truthy(l) ? (ev(e.r, F), true) : truthy(ev(e.r, F)); } return bin(e.o, ev(e.l, F), ev(e.r, F)); }
        case 'tern': { const c = ev(e.c, F); const a = ev(e.a, F), b = ev(e.b, F); return truthy(c) ? a : b; }
        case 'arr': return e.items.map((x) => ev(x, F));
        case 'idx': {
          const kk = num(ev(e.k, F)); if (!Number.isInteger(kk) || kk < 0) err('Geçmiş erişimi: indeks 0 ya da pozitif tam sayı olmalı (geleceğe bakılamaz)');
          if (e.b.t === 'var') return histOf(e.b.n, F, kk);
          const v = ev(e.b, F); const key = e.id + '|' + F.path; let h = nodeHist.get(key); if (!h) { h = []; nodeHist.set(key, h); } h[bi] = v;
          return kk === 0 ? v : (h[bi - kk] !== undefined ? h[bi - kk] : NaN);
        }
        case 'call': return call(e, F);
        default: return err('Geçersiz ifade');
      }
    }

    /* ——— çıktı yardımcıları ——— */
    const colorOf = (v) => { if (isNa(v)) return null; if (typeof v === 'string' && parseColor(v)) return v.length === 7 || v.length === 9 ? v : null; return null; };
    const entryFor = (key, mk) => { let e = out.byNode.get(key); if (!e) { if (out.list.length >= LIM.plots + 40) err('Çok fazla çizim öğesi'); e = mk(); out.list.push(e); out.byNode.set(key, e); } return e; };
    const argsToObj = (names, pos, named) => { const o = {}; names.forEach((nm, k) => { if (pos[k] !== undefined) o[nm] = pos[k]; }); Object.assign(o, named); return o; };
    function setAt(arr, idx, v) { if (idx >= 0 && idx < n) { while (arr.length < idx) arr.push(undefined); arr[idx] = v; } }

    function objRef(v, type) { if (!v || typeof v !== 'object' || v._o !== type) err(`${type} nesnesi bekleniyordu`); return v; }
    const toIdx = (x, xloc) => { // bar_index ya da zaman → mum indeksi
      if (!fin(x)) return NaN;
      if (xloc === 'bar_time' || x > 1e11) { let lo = 0, hi = n - 1; if (x <= S.time[0]) return (x - S.time[0]) / chartMs; if (x >= S.time[n - 1]) return n - 1 + (x - S.time[n - 1]) / chartMs; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.time[m] <= x) lo = m; else hi = m - 1; } return lo; }
      return x;
    };

    /* ——— security ——— */
    const secCache = new Map();
    function security(e, F) {
      if (cap && cap.nosec) return NaN;
      const [symE, tfE, exE] = [e.args[0], e.args[1], e.args[2]];
      if (!symE || !tfE || !exE) err('request.security(sembol, zaman_dilimi, ifade) üç argüman ister');
      const sym = str(ev(symE.e, F)), tfS = str(ev(tfE.e, F));
      if (sym && sym !== (opts.symbol || 'BTCUSDT') && !/^(BINANCE:)?[A-Z0-9]+USDT(\.P)?$/.test(sym)) err('Başka sembolün verisi desteklenmiyor (' + sym + ')');
      if (sym && sym.replace(/^BINANCE:/, '').replace(/\.P$/, '') !== (opts.symbol || 'BTCUSDT')) err('Başka sembolün verisi desteklenmiyor (' + sym + ')');
      const bt = tfS === '' ? chartTf : binTf(tfS); if (!bt) err('Zaman dilimi tanınmadı: ' + tfS);
      if (bt === chartTf) return ev(exE.e, F);
      if (TF_MS[bt] < chartMs) { (out.warnings = out.warnings || new Set()).add('Daha küçük zaman dilimi (' + tfS + ') desteklenmiyor; bu değer boş bırakıldı'); return NaN; }
      let c = secCache.get(e.id + '|' + bt);
      if (!c) {
        const hc = opts.getCandles ? opts.getCandles(bt) : null;
        if (!hc || !hc.length) err('Zaman dilimi verisi yüklenmedi: ' + bt, { needTf: bt });
        const caps = execute(code, hc, Object.assign({}, opts, { tf: bt }), { node: exE.e, nosec: true }).captured;
        c = { hc, caps }; secCache.set(e.id + '|' + bt, c);
      }
      // son tamamlanmış üst zaman dilimi mumu (geleceğe bakmaz)
      const msH = TF_MS[bt], t = S.time[bi]; let lo = 0, hi = c.hc.length - 1, h = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (c.hc[m].t <= t) { h = m; lo = m + 1; } else hi = m - 1; }
      if (h < 0) return NaN;
      const closesHere = t + chartMs >= c.hc[h].t + msH; const idx = closesHere ? h : h - 1;
      return idx >= 0 ? c.caps[idx] : NaN;
    }

    /* ——— çağrılar ——— */
    const MATH = {
      'math.abs': (a) => Math.abs(num(a[0])), 'math.max': (a) => Math.max(...a.map(num)), 'math.min': (a) => Math.min(...a.map(num)), 'math.sqrt': (a) => (num(a[0]) >= 0 ? Math.sqrt(num(a[0])) : NaN), 'math.log': (a) => (num(a[0]) > 0 ? Math.log(num(a[0])) : NaN), 'math.log10': (a) => (num(a[0]) > 0 ? Math.log10(num(a[0])) : NaN),
      'math.exp': (a) => Math.exp(num(a[0])), 'math.pow': (a) => { const r = Math.pow(num(a[0]), num(a[1])); return fin(r) ? r : NaN; }, 'math.floor': (a) => Math.floor(num(a[0])), 'math.ceil': (a) => Math.ceil(num(a[0])),
      'math.round': (a) => { if (a.length > 1) { const p = 10 ** num(a[1]); return Math.round(num(a[0]) * p) / p; } return Math.round(num(a[0])); }, 'math.sign': (a) => Math.sign(num(a[0])), 'math.avg': (a) => a.map(num).reduce((x, y) => x + y, 0) / a.length,
      'math.sin': (a) => Math.sin(num(a[0])), 'math.cos': (a) => Math.cos(num(a[0])), 'math.tan': (a) => Math.tan(num(a[0])), 'math.atan': (a) => Math.atan(num(a[0])), 'math.asin': (a) => Math.asin(num(a[0])), 'math.acos': (a) => Math.acos(num(a[0])),
      'math.todegrees': (a) => (num(a[0]) * 180) / Math.PI, 'math.toradians': (a) => (num(a[0]) * Math.PI) / 180, 'math.random': () => 0.5,
      'math.min_': null,
    };
    ['abs', 'max', 'min', 'sqrt', 'log', 'exp', 'pow', 'floor', 'ceil', 'round', 'sign', 'avg'].forEach((k) => { MATH[k] = MATH['math.' + k]; });
    const fmtBy = (v, f) => { if (!f || typeof f !== 'string') return fmtNum(v); const m = /\.(#+|0+)/.exec(f); const d = m ? m[1].length : 0; const s = v.toFixed(d); return m && m[1][0] === '#' ? String(parseFloat(s)) : s; };
    const STR = {
      'str.tostring': (a) => (typeof a[0] === 'string' ? a[0] : isNa(a[0]) ? 'NaN' : typeof a[0] === 'boolean' ? String(a[0]) : fmtBy(num(a[0]), a[1])), 'str.tonumber': (a) => { const v = parseFloat(a[0]); return fin(v) ? v : NaN; },
      'str.length': (a) => str(a[0]).length, 'str.contains': (a) => str(a[0]).includes(str(a[1])), 'str.upper': (a) => str(a[0]).toUpperCase(), 'str.lower': (a) => str(a[0]).toLowerCase(), 'str.startswith': (a) => str(a[0]).startsWith(str(a[1])), 'str.endswith': (a) => str(a[0]).endsWith(str(a[1])),
      'str.substring': (a) => str(a[0]).substring(num(a[1]), a.length > 2 ? num(a[2]) : undefined), 'str.replace_all': (a) => str(a[0]).split(str(a[1])).join(str(a[2])), 'str.trim': (a) => str(a[0]).trim(), 'str.repeat': (a) => str(a[0]).repeat(Math.max(0, Math.min(100, num(a[1])))),
      'str.format': (a) => str(a[0]).replace(/\{(\d+)(?:,[^}]*)?\}/g, (_, k) => (a[+k + 1] === undefined ? '' : typeof a[+k + 1] === 'number' ? fmtNum(a[+k + 1]) : str(a[+k + 1]))),
    };
    const COLORFN = {
      'color.new': (a) => (a[0] === null ? null : withTransp(a[0], num(a[1]))), 'color.rgb': (a) => mkColor(num(a[0]), num(a[1]), num(a[2]), 255 * (1 - (a.length > 3 && fin(num(a[3])) ? num(a[3]) : 0) / 100)),
      'color.r': (a) => (parseColor(a[0]) || { r: NaN }).r, 'color.g': (a) => (parseColor(a[0]) || { g: NaN }).g, 'color.b': (a) => (parseColor(a[0]) || { b: NaN }).b, 'color.t': (a) => { const p = parseColor(a[0]); return p ? 100 * (1 - p.a / 255) : NaN; },
      'color.from_gradient': (a) => { const v = num(a[0]), lo = num(a[1]), hi = num(a[2]), c1 = parseColor(a[3]), c2 = parseColor(a[4]); if (!c1 || !c2 || !fin(v)) return null; const t = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return mkColor(c1.r + (c2.r - c1.r) * t, c1.g + (c2.g - c1.g) * t, c1.b + (c2.b - c1.b) * t, c1.a + (c2.a - c1.a) * t); },
    };
    const ARR = {
      'array.new': (a) => { const k = Math.max(0, Math.min(100000, num(a[0]) || 0)); return new Array(k).fill(a.length > 1 ? a[1] : NaN); },
      'array.new_float': null, 'array.new_int': null, 'array.new_bool': null, 'array.new_string': null, 'array.new_color': null,
      'array.from': (a) => a.slice(), 'array.size': (a) => a[0].length, 'array.push': (a) => { if (a[0].length >= 100000) err('Dizi çok büyük'); a[0].push(a[1]); return NaN; }, 'array.pop': (a) => (a[0].length ? a[0].pop() : err('Boş diziden pop')), 'array.shift': (a) => (a[0].length ? a[0].shift() : err('Boş diziden shift')),
      'array.unshift': (a) => { a[0].unshift(a[1]); return NaN; }, 'array.get': (a) => { const k = num(a[1]); if (!(k >= 0 && k < a[0].length)) err(`Dizi indeksi sınır dışı: ${k} (boyut ${a[0].length})`); return a[0][k]; }, 'array.set': (a) => { const k = num(a[1]); if (!(k >= 0 && k < a[0].length)) err(`Dizi indeksi sınır dışı: ${k}`); a[0][k] = a[2]; return NaN; },
      'array.clear': (a) => { a[0].length = 0; return NaN; }, 'array.first': (a) => (a[0].length ? a[0][0] : err('Boş dizi')), 'array.last': (a) => (a[0].length ? a[0][a[0].length - 1] : err('Boş dizi')), 'array.remove': (a) => { const k = num(a[1]); if (!(k >= 0 && k < a[0].length)) err('Dizi indeksi sınır dışı'); return a[0].splice(k, 1)[0]; },
      'array.insert': (a) => { a[0].splice(num(a[1]), 0, a[2]); return NaN; }, 'array.includes': (a) => a[0].includes(a[1]), 'array.indexof': (a) => a[0].indexOf(a[1]), 'array.sum': (a) => a[0].reduce((x, y) => x + num(y), 0), 'array.avg': (a) => (a[0].length ? a[0].reduce((x, y) => x + num(y), 0) / a[0].length : NaN),
      'array.max': (a) => (a[0].length ? Math.max(...a[0].map(num)) : NaN), 'array.min': (a) => (a[0].length ? Math.min(...a[0].map(num)) : NaN), 'array.copy': (a) => a[0].slice(), 'array.slice': (a) => a[0].slice(num(a[1]), num(a[2])), 'array.reverse': (a) => { a[0].reverse(); return NaN; },
      'array.sort': (a) => { const d = a[1] === 'descending'; a[0].sort((x, y) => (d ? num(y) - num(x) : num(x) - num(y))); return NaN; }, 'array.concat': (a) => { a[0].push(...a[1]); return a[0]; }, 'array.fill': (a) => { a[0].fill(a[1]); return NaN; }, 'array.median': (a) => { const s = a[0].map(num).sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; },
      'array.stdev': (a) => { const v = a[0].map(num), m = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length); },
      'map.new': () => new Map(), 'map.put': (a) => { a[0].set(a[1], a[2]); return NaN; }, 'map.get': (a) => (a[0].has(a[1]) ? a[0].get(a[1]) : NaN), 'map.contains': (a) => a[0].has(a[1]), 'map.remove': (a) => { const v = a[0].get(a[1]); a[0].delete(a[1]); return v; }, 'map.size': (a) => a[0].size, 'map.clear': (a) => { a[0].clear(); return NaN; }, 'map.keys': (a) => [...a[0].keys()], 'map.values': (a) => [...a[0].values()],
    };
    ['float', 'int', 'bool', 'string', 'color'].forEach((k) => { ARR['array.new_' + k] = ARR['array.new']; });

    function drawLimit(arr) { if (arr.length > LIM.objects) { const x = arr.shift(); if (x) x._dead = true; } }
    const LABEL_ARGS = ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip', 'text_font_family'];
    const LINE_ARGS = ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width'];
    const BOX_ARGS = ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color'];

    function call(e, F) {
      let nm = e.n; const pos = [], named = {};
      line = line || 0;
      // kullanıcı fonksiyonu
      if (funcs.has(nm)) {
        const fn = funcs.get(nm), key = F.path + '/' + e.id;
        if (F.path.split('/').length > LIM.depth) err('Fonksiyon çağrıları çok iç içe');
        const fr = new Frame(stateOf(key), key);
        e.args.forEach((a, k) => { const v = ev(a.e, F); if (a.key) { if (!fn.params.some((p) => p.n === a.key)) err(`${nm}(): "${a.key}" adında parametre yok`); fr.vars.set(a.key, v); } else { if (k >= fn.params.length) err(`${nm}() fazla argüman aldı`); fr.vars.set(fn.params[k].n, v); } });
        for (const p of fn.params) if (!fr.vars.has(p.n)) { if (p.def) fr.vars.set(p.n, ev(p.def, fr)); else fr.vars.set(p.n, NaN); }
        const r = execBody(fn.body, fr); recordHist(fr);
        return r.val === undefined ? NaN : r.val;
      }
      // nesne metodu: arr.push(x) / ln.set_x2(...)
      const dot = nm.indexOf('.');
      if (dot > 0 && has(nm.slice(0, dot), F) && !builtinNs(nm.slice(0, dot))) {
        const recv = lookup(nm.slice(0, dot), F), meth = nm.slice(dot + 1);
        const t = Array.isArray(recv) ? 'array' : recv instanceof Map ? 'map' : recv && recv._o ? recv._o : null;
        if (!t) err(`"${nm.slice(0, dot)}" üzerinde ${meth}() çağrılamaz`);
        nm = t + '.' + meth; pos.push(recv);
      }
      // security: ifade bu çağrı içinde değerlendirilir
      if (nm === 'request.security') return security(e, F);
      if (/^request\./.test(nm)) err(nm + '() desteklenmiyor');
      for (const a of e.args) { const v = ev(a.e, F); if (a.key) named[a.key] = v; else pos.push(v); }
      return builtin(nm, pos, named, e, F);
    }
    function builtinNs(s) { return ['ta', 'math', 'str', 'color', 'array', 'map', 'label', 'line', 'box', 'table', 'strategy', 'request', 'input', 'timeframe', 'syminfo', 'barstate', 'plot', 'location', 'shape', 'size', 'position', 'chart', 'alert', 'matrix', 'ticker', 'session', 'runtime', 'log'].includes(s); }

    function builtin(nm, a, named, e, F) {
      const key = F.path + '/' + e.id;
      const ta = TA_ALIAS[nm];
      if (ta) {
        const st = stateOf(key), args = a.slice();
        if (ta === 'atr' && args.length === 0) err('ta.atr(uzunluk) bir argüman ister');
        if (ta === 'macd') { while (args.length < 4) args.push([NaN, 12, 26, 9][args.length]); if (args.length > 4) args.length = 4; }
        if (ta === 'bb' && args.length < 3) args.push(2);
        return TA[ta](args, st, bi);
      }
      if (nm === 'ta.tr') return S.tr[bi];
      if (MATH[nm]) return MATH[nm](a); if (STR[nm]) return STR[nm](a); if (COLORFN[nm]) return COLORFN[nm](a);
      if (ARR[nm]) { return ARR[nm](a); }
      switch (nm) {
        case 'nz': return isNa(a[0]) || (typeof a[0] === 'number' && !fin(a[0])) ? (a.length > 1 ? a[1] : 0) : a[0];
        case 'na': return isNa(a[0]);
        case 'int': return Math.trunc(num(a[0])); case 'float': return num(a[0]); case 'bool': return truthy(a[0]); case 'string': return str(a[0]);
        case 'indicator': case 'study': out.indicator.title = str(a[0] !== undefined ? a[0] : named.title); if (named.overlay === false) out.indicator.overlay = false; else if (named.overlay === true) out.indicator.overlay = true; return NaN;
        case 'strategy': return NaN;
        case 'alert': case 'alertcondition': case 'strategy.exit': case 'strategy.close': case 'strategy.close_all': case 'strategy.cancel': case 'strategy.cancel_all': case 'strategy.order': case 'strategy.risk.max_drawdown': case 'strategy.risk.allow_entry_in': case 'runtime.error': case 'log.info': case 'log.warning': case 'log.error': return NaN;
        case 'strategy.entry': {
          const o = argsToObj(['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert'], a, named); if (o.when !== undefined && !truthy(o.when)) return NaN;
          const long = o.direction === 'long' || o.direction === 'strategy.long';
          const en = entryFor('strategy_' + (long ? 'long' : 'short'), () => ({ pane: 'mark', label: long ? 'Al sinyali' : 'Sat sinyali', color: long ? COLORS.teal : COLORS.red, dir: long ? 'up' : 'down', shape: 'label', on: [], texts: [], colors: [] }));
          setAt(en.on, bi, 1); setAt(en.texts, bi, long ? 'AL' : 'SAT'); return NaN;
        }
        case 'input': case 'input.int': case 'input.float': case 'input.bool': case 'input.string': case 'input.color': case 'input.source': case 'input.timeframe': case 'input.symbol': case 'input.session': case 'input.text_area': case 'input.price': case 'input.time': {
          const d = named.defval !== undefined ? named.defval : a[0]; return d === undefined ? NaN : d;
        }
        case 'plot': case 'hline': {
          const isH = nm === 'hline';
          const o = isH ? argsToObj(['price', 'title', 'color', 'linestyle', 'linewidth', 'editable', 'display'], a, named) : argsToObj(['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset', 'join', 'editable', 'show_last', 'display'], a, named);
          const en = entryFor(key, () => ({ pane: out.indicator.overlay || o.force_overlay ? 'price' : 'sub', label: str(o.title || (isH ? 'Yatay çizgi' : 'Çizgi ' + (out.list.length + 1))).slice(0, 24), color: null, values: [], colors: [], width: isH ? 1 : 1.6, style: isH ? 'hline' : (typeof o.style === 'string' ? o.style.replace(/^style_/, '') : 'line'), dash: isH && /dash|dott/.test(String(o.linestyle || '')) }));
          const v = num(isH ? o.price : o.series), off = fin(num(o.offset)) ? num(o.offset) : 0;
          if (isH) { for (let k = 0; k < n; k++) { en.values[k] = v; } } else setAt(en.values, bi + off, fin(v) ? v : NaN);
          const c = colorOf(o.color); if (c) { en.color = en.color || c; setAt(en.colors, bi + off, c); }
          if (fin(num(o.linewidth))) en.width = Math.max(1, num(o.linewidth) * 0.9);
          return { _o: 'plot', e: en };
        }
        case 'plotshape': case 'plotchar': case 'plotarrow': {
          const o = nm === 'plotshape' ? argsToObj(['series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size'], a, named)
            : nm === 'plotchar' ? argsToObj(['series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size'], a, named)
              : argsToObj(['series', 'title', 'colorup', 'colordown', 'offset'], a, named);
          const style = String(o.style || ''), loc = String(o.location || (nm === 'plotarrow' ? 'abovebar' : 'abovebar'));
          const sv = o.series, active = nm === 'plotarrow' ? fin(num(sv)) && num(sv) !== 0 : loc === 'absolute' ? fin(num(sv)) : truthy(sv);
          let dir = /down/.test(style) ? 'down' : /up/.test(style) ? 'up' : loc === 'belowbar' ? 'up' : loc === 'abovebar' ? 'down' : null;
          if (nm === 'plotarrow') dir = num(sv) > 0 ? 'up' : 'down';
          if (!dir) dir = /▼|↓|⬇/.test(String(o.char || o.text || '')) ? 'down' : 'up';
          const shape = nm === 'plotchar' ? 'char' : /^label/.test(style) ? 'label' : /circle|diamond|cross|square|flag|xcross/.test(style) ? 'dot' : 'tri';
          const en = entryFor(key, () => ({ pane: 'mark', label: str(o.title || 'İşaret').slice(0, 24), color: null, dir, shape, absolute: loc === 'absolute', on: [], texts: [], colors: [], ys: [] }));
          if (active) {
            const idx = bi + (fin(num(o.offset)) ? num(o.offset) : 0); setAt(en.on, idx, 1); setAt(en.texts, idx, (nm === 'plotchar' ? str(o.char !== undefined && o.text === undefined ? o.char : o.text || o.char || '') : nm === 'plotarrow' ? '' : str(o.text || '')).split('\n')[0].slice(0, 24));
            const c = colorOf(nm === 'plotarrow' ? (num(sv) > 0 ? o.colorup || COLORS.teal : o.colordown || COLORS.red) : o.color); if (c) { en.color = en.color || c; setAt(en.colors, idx, c); } if (loc === 'absolute') setAt(en.ys, idx, num(sv));
            if (en.dirs === undefined) en.dirs = []; setAt(en.dirs, idx, dir);
          }
          return NaN;
        }
        case 'bgcolor': case 'barcolor': {
          const o = argsToObj(['color', 'offset', 'editable', 'show_last', 'title', 'display'], a, named); const c = colorOf(o.color);
          const en = entryFor(key, () => ({ pane: nm === 'bgcolor' ? 'bg' : 'barcolor', label: nm, colors: [] })); if (c) setAt(en.colors, bi + (fin(num(o.offset)) ? num(o.offset) : 0), c); return NaN;
        }
        case 'plotcandle': case 'plotbar': {
          const o = argsToObj(['open', 'high', 'low', 'close', 'title', 'color', 'wickcolor', 'editable', 'show_last', 'bordercolor'], a, named);
          const same = num(o.open) === S.open[bi] && num(o.high) === S.high[bi] && num(o.low) === S.low[bi] && num(o.close) === S.close[bi];
          if (!same) err('Özel OHLC mum çizimi desteklenmiyor (yalnızca mevcut mumlara renk verilebilir)');
          const en = entryFor(key, () => ({ pane: 'barcolor', label: nm, colors: [] })); const c = colorOf(o.color); if (c) setAt(en.colors, bi, c); return NaN;
        }
        case 'fill': {
          const p1 = a[0], p2 = a[1];
          if (!p1 || !p2 || p1._o !== 'plot' || p2._o !== 'plot') err('fill() iki plot/hline nesnesi ister');
          const c = typeof a[2] === 'string' ? a[2] : named.color !== undefined ? named.color : (a[4] !== undefined ? a[4] : named.top_color);
          const en = entryFor(key, () => ({ pane: 'fill', label: 'fill', a: p1.e, b: p2.e, colors: [] })); const cc = colorOf(c); if (cc) setAt(en.colors, bi, cc); return NaN;
        }
        case 'label.new': {
          const o = argsToObj(LABEL_ARGS, a, named); const x = toIdx(num(o.x), o.xloc), y = num(o.y);
          const lb = { _o: 'label', i: x, y, text: str(o.text || ''), color: colorOf(o.color), textcolor: colorOf(o.textcolor), style: String(o.style || 'label_down'), yloc: String(o.yloc || 'price'), size: String(o.size || 'normal'), bar: bi };
          out.draws.labels.push(lb); drawLimit(out.draws.labels); return lb;
        }
        case 'label.set_text': objRef(a[0], 'label').text = str(a[1]); return NaN;
        case 'label.set_x': objRef(a[0], 'label').i = toIdx(num(a[1])); return NaN; case 'label.set_y': objRef(a[0], 'label').y = num(a[1]); return NaN;
        case 'label.set_xy': { const l = objRef(a[0], 'label'); l.i = toIdx(num(a[1])); l.y = num(a[2]); return NaN; }
        case 'label.set_color': objRef(a[0], 'label').color = colorOf(a[1]); return NaN; case 'label.set_textcolor': objRef(a[0], 'label').textcolor = colorOf(a[1]); return NaN; case 'label.set_style': objRef(a[0], 'label').style = String(a[1]); return NaN; case 'label.set_size': return NaN;
        case 'label.delete': objRef(a[0], 'label')._dead = true; return NaN;
        case 'label.get_x': return objRef(a[0], 'label').i; case 'label.get_y': return objRef(a[0], 'label').y; case 'label.get_text': return objRef(a[0], 'label').text;
        case 'line.new': {
          const o = argsToObj(LINE_ARGS, a, named); const ln = { _o: 'line', i1: toIdx(num(o.x1), o.xloc), y1: num(o.y1), i2: toIdx(num(o.x2), o.xloc), y2: num(o.y2), color: colorOf(o.color), style: String(o.style || 'solid'), width: fin(num(o.width)) ? num(o.width) : 1, extend: String(o.extend || 'none'), bar: bi };
          out.draws.lines.push(ln); drawLimit(out.draws.lines); return ln;
        }
        case 'line.set_x1': objRef(a[0], 'line').i1 = toIdx(num(a[1])); return NaN; case 'line.set_y1': objRef(a[0], 'line').y1 = num(a[1]); return NaN; case 'line.set_x2': objRef(a[0], 'line').i2 = toIdx(num(a[1])); return NaN; case 'line.set_y2': objRef(a[0], 'line').y2 = num(a[1]); return NaN;
        case 'line.set_xy1': { const l = objRef(a[0], 'line'); l.i1 = toIdx(num(a[1])); l.y1 = num(a[2]); return NaN; } case 'line.set_xy2': { const l = objRef(a[0], 'line'); l.i2 = toIdx(num(a[1])); l.y2 = num(a[2]); return NaN; }
        case 'line.set_color': objRef(a[0], 'line').color = colorOf(a[1]); return NaN; case 'line.set_width': objRef(a[0], 'line').width = num(a[1]); return NaN; case 'line.set_style': objRef(a[0], 'line').style = String(a[1]); return NaN; case 'line.set_extend': objRef(a[0], 'line').extend = String(a[1]); return NaN;
        case 'line.delete': objRef(a[0], 'line')._dead = true; return NaN;
        case 'line.get_x1': return objRef(a[0], 'line').i1; case 'line.get_x2': return objRef(a[0], 'line').i2; case 'line.get_y1': return objRef(a[0], 'line').y1; case 'line.get_y2': return objRef(a[0], 'line').y2;
        case 'line.get_price': { const l = objRef(a[0], 'line'), x = num(a[1]); return l.i2 === l.i1 ? l.y1 : l.y1 + ((l.y2 - l.y1) * (x - l.i1)) / (l.i2 - l.i1); }
        case 'box.new': {
          const o = argsToObj(BOX_ARGS, a, named); const bx = { _o: 'box', i1: toIdx(num(o.left), o.xloc), y1: num(o.top), i2: toIdx(num(o.right), o.xloc), y2: num(o.bottom), border: colorOf(o.border_color), bg: colorOf(o.bgcolor), extend: String(o.extend || 'none'), text: str(o.text || ''), bar: bi };
          out.draws.boxes.push(bx); drawLimit(out.draws.boxes); return bx;
        }
        case 'box.set_left': objRef(a[0], 'box').i1 = toIdx(num(a[1])); return NaN; case 'box.set_right': objRef(a[0], 'box').i2 = toIdx(num(a[1])); return NaN; case 'box.set_top': objRef(a[0], 'box').y1 = num(a[1]); return NaN; case 'box.set_bottom': objRef(a[0], 'box').y2 = num(a[1]); return NaN;
        case 'box.set_lefttop': { const b = objRef(a[0], 'box'); b.i1 = toIdx(num(a[1])); b.y1 = num(a[2]); return NaN; } case 'box.set_rightbottom': { const b = objRef(a[0], 'box'); b.i2 = toIdx(num(a[1])); b.y2 = num(a[2]); return NaN; }
        case 'box.set_bgcolor': objRef(a[0], 'box').bg = colorOf(a[1]); return NaN; case 'box.set_border_color': objRef(a[0], 'box').border = colorOf(a[1]); return NaN; case 'box.set_extend': objRef(a[0], 'box').extend = String(a[1]); return NaN; case 'box.set_text': objRef(a[0], 'box').text = str(a[1]); return NaN;
        case 'box.delete': objRef(a[0], 'box')._dead = true; return NaN; case 'box.get_top': return objRef(a[0], 'box').y1; case 'box.get_bottom': return objRef(a[0], 'box').y2; case 'box.get_left': return objRef(a[0], 'box').i1; case 'box.get_right': return objRef(a[0], 'box').i2;
        case 'table.new': { const o = argsToObj(['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width'], a, named); const t = { _o: 'table', pos: String(o.position || 'top_right'), cols: Math.min(20, num(o.columns) || 1), rows: Math.min(50, num(o.rows) || 1), bg: colorOf(o.bgcolor), cells: new Map() }; out.draws.tables.push(t); return t; }
        case 'table.cell': { const o = argsToObj(['table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip'], a, named); const t = objRef(o.table_id, 'table'); t.cells.set(num(o.column) + ',' + num(o.row), { text: str(o.text || ''), color: colorOf(o.text_color), bg: colorOf(o.bgcolor) }); return NaN; }
        case 'table.set_cell_text': return NaN; case 'table.merge_cells': case 'table.delete': case 'table.clear': return NaN;
        case 'timeframe.in_seconds': { const b = binTf(str(a.length ? a[0] : PINE_TF[chartTf])); return b ? TF_MS[b] / 1000 : NaN; }
        case 'timeframe.change': return bi === 0 ? true : Math.floor(S.time[bi] / (TF_MS[binTf(str(a[0])) || chartTf] || chartMs)) !== Math.floor(S.time[bi - 1] / (TF_MS[binTf(str(a[0])) || chartTf] || chartMs));
        case 'ticker.new': case 'ticker.modify': case 'ticker.heikinashi': return opts.symbol || 'BTCUSDT';
        case 'array.size_': return NaN;
        default: return err(`Bilinmeyen işlev: ${nm}()`);
      }
    }

    /* ——— deyim yürütme ——— */
    function execBody(stmts, F) {
      let val;
      for (const s of stmts) {
        line = s.line || line; tick();
        switch (s.t) {
          case 'nop': break;
          case 'expr': val = ev(s.e, F); break;
          case 'set': {
            if (s.v) { if (!F.st.inited.has(s.uid)) { F.st.inited.add(s.uid); const v = ev(s.e, F); F.st.pv.set(s.n, v); val = v; } else val = F.st.pv.get(s.n); }
            else { const v = ev(s.e, F); F.vars.set(s.n, v); val = v; }
            break;
          }
          case 're': {
            let v = ev(s.e, F);
            const cur = has(s.n, F) ? lookup(s.n, F) : err(`Tanımsız değişken: ${s.n}`);
            if (s.op !== ':=') v = bin(s.op[0], cur, v);
            if (F.st.pv.has(s.n)) F.st.pv.set(s.n, v); else F.vars.set(s.n, v); val = v; break;
          }
          case 'tuple': { const v = ev(s.e, F); if (!Array.isArray(v)) err('Çoklu atama için birden çok değer döndüren bir işlev gerekir'); s.names.forEach((nm2, k) => { if (nm2 !== '_') F.vars.set(nm2, v[k] === undefined ? NaN : v[k]); }); break; }
          case 'if': { const c = ev(s.c, F); if (truthy(c)) { const r = execBody(s.then, F); if (r.sig) return r; val = r.val; } else if (s.els) { const r = execBody(s.els, F); if (r.sig) return r; val = r.val; } break; }
          case 'for': {
            const a = num(ev(s.a, F)), b = num(ev(s.b, F)); let by = s.by ? num(ev(s.by, F)) : (a <= b ? 1 : -1); if (!by) err('for: adım 0 olamaz');
            for (let k = a; by > 0 ? k <= b : k >= b; k += by) { F.vars.set(s.v, k); const r = execBody(s.body, F); if (r.sig === 'break') break; if (r.val !== undefined) val = r.val; }
            break;
          }
          case 'forin': { const arr = ev(s.e, F); if (!Array.isArray(arr)) err('for ... in bir dizi ister'); for (let k = 0; k < arr.length; k++) { if (s.i) F.vars.set(s.i, k); F.vars.set(s.v, arr[k]); const r = execBody(s.body, F); if (r.sig === 'break') break; } break; }
          case 'while': { let g = 0; while (truthy(ev(s.c, F))) { if (++g > 1e6) err('while döngüsü çok uzun sürdü'); const r = execBody(s.body, F); if (r.sig === 'break') break; } break; }
          case 'break': return { sig: 'break', val }; case 'continue': return { sig: 'continue', val };
          default: err('Geçersiz deyim');
        }
      }
      return { val };
    }

    /* ——— mum döngüsü ——— */
    const captured = [];
    for (bi = 0; bi < n; bi++) {
      G.vars.clear(); // global değişkenler her mumda yeniden hesaplanır; var olanlar st.pv'de kalır
      execBody(prog, G);
      recordHist(G);
      if (cap && cap.node) captured[bi] = (() => { try { return ev(cap.node, G); } catch (e) { return NaN; } })();
    }
    out.captured = captured;
    return out;
  }

  /* ——— sonuç: grafik nesneleri ——— */
  function finalize(raw, candles) {
    const n = candles.length, list = raw.list;
    const idxOf = new Map(list.map((e, k) => [e, k]));
    const res = [];
    for (const e of list) {
      if (e.pane === 'fill') { const a = idxOf.get(e.a), b = idxOf.get(e.b); if (a === undefined || b === undefined) continue; res.push({ pane: 'fill', label: 'fill', a, b, colors: padTo(e.colors, n) }); continue; }
      if (e.pane === 'bg' || e.pane === 'barcolor') { res.push({ pane: e.pane, label: e.label, colors: padTo(e.colors, n) }); continue; }
      if (e.pane === 'mark') { res.push({ pane: 'mark', label: e.label, color: e.color || (e.dir === 'down' ? COLORS.red : COLORS.teal), dir: e.dir, shape: e.shape, absolute: !!e.absolute, on: padTo(e.on, n, 0).map((x) => (x ? 1 : 0)), texts: padTo(e.texts, n, ''), colors: padTo(e.colors, n), ys: e.ys ? padTo(e.ys, n) : undefined, dirs: e.dirs ? padTo(e.dirs, n) : undefined, text: (e.texts || []).find((x) => x) || '' }); continue; }
      res.push({ pane: e.pane, label: e.label, color: e.color || '#ffc25c', values: padTo(e.values, n, NaN), colors: e.colors.some((c) => c) ? padTo(e.colors, n) : null, width: e.width, style: e.style, dash: e.dash });
    }
    const d = raw.draws, live = (x) => x.filter((o) => !o._dead);
    const dr = { labels: live(d.labels).map(({ _o, _dead, ...r }) => r), lines: live(d.lines).map(({ _o, _dead, ...r }) => r), boxes: live(d.boxes).map(({ _o, _dead, ...r }) => r), tables: d.tables.map((t) => ({ pos: t.pos, cols: t.cols, rows: t.rows, bg: t.bg, cells: [...t.cells.entries()].map(([k, v]) => { const [c, r] = k.split(',').map(Number); return Object.assign({ c, r }, v); }) })) };
    if (dr.labels.length || dr.lines.length || dr.boxes.length || dr.tables.some((t) => t.cells.length)) res.push({ pane: 'draw', label: 'çizimler', draws: dr });
    res.title = raw.indicator.title; res.overlay = raw.indicator.overlay;
    return res;
  }
  function padTo(a, n, fill) { const o = new Array(n); for (let i = 0; i < n; i++) o[i] = a && a[i] !== undefined ? a[i] : (fill === undefined ? null : fill); return o; }

  const cache = new Map();
  function parse(src) { let c = cache.get(src); if (!c) { c = compile(src); if (cache.size > 30) cache.clear(); cache.set(src, c); } return c; }
  function run(src, candles, opts) { const code = parse(src); return finalize(execute(code, candles, opts), candles); }
  /** Bu kodun mum mum çalışan motora ihtiyacı var mı? (blok, var, :=, fonksiyon tanımı, nesne çağrıları) */
  function needsBarMode(src) {
    return /(^|\n)\s*(var|varip|if|for|while|else|switch)\b/.test(src) || /:=|\+=|-=|=>|\b(label|line|box|table|array|map|request|strategy|alert)\.[a-z_]+\s*\(|\b(bgcolor|barcolor|fill|hline|plotcandle|plotbar|plotshape|plotchar|plotarrow)\s*\(|(^|[^A-Za-z_.])(ta\.|math\.|str\.|color\.|input\.|timeframe\.|syminfo\.|barstate\.)|\[\s*[A-Za-z_(]/.test(src);
  }
  return { run, parse, compile, execute, finalize, needsBarMode, tfNeeds, binTf, ScriptError, LIM, lex };
});
