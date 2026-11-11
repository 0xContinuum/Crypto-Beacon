/*  Beacon Formül: Pro kullanıcıların kendi göstergelerini yazması için güvenli mini dil.
 *  eval/Function kullanılmaz: kod ayrıştırılır ve yalnızca aşağıdaki işlevlerle çalıştırılır.
 *  Gelecek veriye erişim yoktur (shift yalnızca geçmişe bakar), bu yüzden gösterge yeniden boyanmaz.
 *
 *    ema20 = ema(close, 20)
 *    plot(ema20, "EMA 20", "#ffc25c")        // fiyat üzerine çizgi
 *    pane(rsi(close, 14), "RSI", "#35d6a0")   // alt panele çizgi
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BeaconScript = factory(root.Beacon);
})(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';
  const I = B.indicators, LIM = { chars: 6000, stmts: 150, depth: 24, plots: 8, marks: 8, args: 8, period: 500 };
  const PALETTE = ['#ffc25c', '#6ea8ff', '#35d6a0', '#ff6384', '#c58cff', '#e9eef8'];
  class ScriptError extends Error { constructor(msg, line) { super(msg); this.line = line || 0; } }

  /* ——— sözcük çözümleme ——— */
  function lex(src, line) {
    const t = []; let i = 0;
    const err = (m) => { throw new ScriptError(m, line); };
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (src.startsWith('//', i)) break;
      if (/[0-9.]/.test(ch)) {
        const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i)); if (!m) err('Sayı okunamadı');
        t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i)); t.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
      if (ch === '"') { const j = src.indexOf('"', i + 1); if (j < 0 || j - i > 60) err('Metin kapanmamış (en çok 60 karakter)'); t.push({ k: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue; }
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!='].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
      if ('+-*/%^<>()[]?:,='.includes(ch)) { t.push({ k: 'op', v: ch }); i++; continue; }
      err(`Tanınmayan karakter: ${ch}`);
    }
    return t;
  }

  /* ——— ayrıştırma ——— */
  function parseLine(tokens, line) {
    let p = 0;
    const err = (m) => { throw new ScriptError(m, line); };
    const peek = () => tokens[p], isOp = (v) => tokens[p] && tokens[p].k === 'op' && tokens[p].v === v, isId = (v) => tokens[p] && tokens[p].k === 'id' && tokens[p].v === v;
    const eat = (v) => { if (!isOp(v)) err(`"${v}" bekleniyordu`); p++; };
    function expr(d) {
      if (d > LIM.depth) err('İfade çok iç içe');
      const c = orE(d + 1);
      if (isOp('?')) { p++; const a = expr(d + 1); eat(':'); const b = expr(d + 1); return { t: 'if', c, a, b }; }
      return c;
    }
    function orE(d) { let l = andE(d); while (isId('or')) { p++; l = { t: 'bin', o: 'or', l, r: andE(d) }; } return l; }
    function andE(d) { let l = notE(d); while (isId('and')) { p++; l = { t: 'bin', o: 'and', l, r: notE(d) }; } return l; }
    function notE(d) { if (isId('not')) { p++; return { t: 'not', x: notE(d) }; } return cmp(d); }
    function cmp(d) { const l = add(d); const t = peek(); if (t && t.k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(t.v)) { p++; return { t: 'bin', o: t.v, l, r: add(d) }; } return l; }
    function add(d) { let l = mul(d); while (isOp('+') || isOp('-')) { const o = tokens[p++].v; l = { t: 'bin', o, l, r: mul(d) }; } return l; }
    function mul(d) { let l = un(d); while (isOp('*') || isOp('/') || isOp('%')) { const o = tokens[p++].v; l = { t: 'bin', o, l, r: un(d) }; } return l; }
    function pow(d) { const l = prim(d); if (isOp('^')) { p++; return { t: 'bin', o: '^', l, r: un(d + 1) }; } return l; }
    function un(d) { if (isOp('-')) { p++; return { t: 'neg', x: un(d + 1) }; } return pow(d); }
    function prim(d) { // x[n]: n mum önceki değer (yalnızca geçmişe bakılır)
      let e = atom(d);
      while (isOp('[')) { p++; const k = expr(d + 1); eat(']'); e = { t: 'call', n: 'shift', a: [e, k] }; }
      return e;
    }
    function atom(d) {
      const t = peek(); if (!t) err('İfade yarım kaldı');
      if (t.k === 'num') { p++; return { t: 'num', v: t.v }; }
      if (t.k === 'str') { p++; return { t: 'str', v: t.v }; }
      if (t.k === 'id') {
        p++;
        if (isOp('(')) { p++; const args = []; if (!isOp(')')) { do { args.push(expr(d + 1)); if (args.length > LIM.args) err('Çok fazla argüman'); } while (isOp(',') && ++p); } eat(')'); return { t: 'call', n: t.v, a: args }; }
        return { t: 'var', n: t.v };
      }
      if (isOp('(')) { p++; const e = expr(d + 1); eat(')'); return e; }
      return err(`Beklenmeyen "${t.v}"`);
    }
    let st;
    if (tokens[0] && tokens[0].k === 'id' && tokens[1] && tokens[1].k === 'op' && tokens[1].v === '=') { p = 2; st = { t: 'set', n: tokens[0].v, e: expr(0), line }; }
    else st = { t: 'do', e: expr(0), line };
    if (p < tokens.length) err(`Beklenmeyen "${tokens[p].v}"`);
    return st;
  }

  function parse(src) {
    if (typeof src !== 'string' || !src.trim()) throw new ScriptError('Formül boş', 0);
    if (src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').length > LIM.chars) throw new ScriptError(`Formül en çok ${LIM.chars} karakter olabilir`, 0);
    const out = [], lines = src.split('\n');
    lines.forEach((ln, k) => { const t = lex(ln, k + 1); if (t.length) out.push(parseLine(t, k + 1)); });
    if (!out.length) throw new ScriptError('Formül boş', 0);
    if (out.length > LIM.stmts) throw new ScriptError(`En çok ${LIM.stmts} satır yazılabilir`, 0);
    return out;
  }

  /* ——— çalıştırma ——— */
  const BUILTIN = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'tr', 'obv', 'bar_index', 'true', 'false', 'na'];
  const isS = Array.isArray;
  function wmaArr(x, p) {
    const o = new Array(x.length).fill(NaN), den = (p * (p + 1)) / 2;
    for (let i = p - 1; i < x.length; i++) { let s = 0, ok = true; for (let j = 0; j < p; j++) { const v = x[i - j]; if (!Number.isFinite(v)) { ok = false; break; } s += v * (p - j); } if (ok) o[i] = s / den; }
    return o;
  }
  function run(src, candles) {
    const prog = parse(src), n = candles.length;
    const col = (f) => candles.map(f);
    const env = Object.assign(Object.create(null), {
      open: col((k) => k.o), high: col((k) => k.h), low: col((k) => k.l), close: col((k) => k.c), volume: col((k) => k.v),
      hl2: col((k) => (k.h + k.l) / 2), hlc3: col((k) => (k.h + k.l + k.c) / 3), ohlc4: col((k) => (k.o + k.h + k.l + k.c) / 4),
    });
    env.tr = I.trueRange(env.high, env.low, env.close);
    env.bar_index = candles.map((_, i) => i); env.true = 1; env.false = 0; env.na = NaN;
    { let acc = 0; env.obv = candles.map((k, i) => { if (i) acc += Math.sign(k.c - candles[i - 1].c) * k.v; return acc; }); }
    const plots = []; let line = 0, marks = 0;
    const err = (m) => { throw new ScriptError(m, line); };
    const bin = (a, b, f) => { if (!isS(a) && !isS(b)) return f(a, b); const o = new Array(n); for (let i = 0; i < n; i++) o[i] = f(isS(a) ? a[i] : a, isS(b) ? b[i] : b); return o; };
    const map = (a, f) => (isS(a) ? a.map(f) : f(a));
    const series = (a, what) => { if (typeof a === 'string') err(`${what}: metin verilemez`); return isS(a) ? a : new Array(n).fill(a); };
    const per = (a, what) => { if (isS(a) || typeof a !== 'number' || !Number.isInteger(a) || a < 1 || a > LIM.period) err(`${what}: periyot 1 ile ${LIM.period} arasında tam sayı olmalı`); return a; };
    const arity = (a, lo, hi, nm) => { if (a.length < lo || a.length > hi) err(`${nm}() ${lo === hi ? lo : lo + '-' + hi} argüman alır`); };
    const B01 = (x) => (x ? 1 : 0);
    const F = Object.assign(Object.create(null), {
      sma: (a) => { arity(a, 2, 2, 'sma'); return I.sma(series(a[0], 'sma'), per(a[1], 'sma')); },
      ema: (a) => { arity(a, 2, 2, 'ema'); return I.ema(series(a[0], 'ema'), per(a[1], 'ema')); },
      rma: (a) => { arity(a, 2, 2, 'rma'); return I.rma(series(a[0], 'rma'), per(a[1], 'rma')); },
      rsi: (a) => { arity(a, 1, 2, 'rsi'); return I.rsi(series(a[0], 'rsi'), a.length > 1 ? per(a[1], 'rsi') : 14); },
      atr: (a) => { arity(a, 0, 1, 'atr'); return I.atr(env.high, env.low, env.close, a.length ? per(a[0], 'atr') : 14); },
      highest: (a) => { arity(a, 2, 2, 'highest'); return I.rollMax(series(a[0], 'highest'), per(a[1], 'highest')); },
      lowest: (a) => { arity(a, 2, 2, 'lowest'); return I.rollMin(series(a[0], 'lowest'), per(a[1], 'lowest')); },
      stdev: (a) => {
        arity(a, 2, 2, 'stdev'); const x = series(a[0], 'stdev'), p = per(a[1], 'stdev'), o = new Array(n).fill(NaN);
        for (let i = p - 1; i < n; i++) { let s = 0, ok = true; for (let j = i - p + 1; j <= i; j++) { if (!Number.isFinite(x[j])) { ok = false; break; } s += x[j]; } if (!ok) continue; const m = s / p; let v = 0; for (let j = i - p + 1; j <= i; j++) v += (x[j] - m) ** 2; o[i] = Math.sqrt(v / p); }
        return o;
      },
      sum: (a) => { arity(a, 2, 2, 'sum'); const x = series(a[0], 'sum'), p = per(a[1], 'sum'), o = new Array(n).fill(NaN); for (let i = p - 1; i < n; i++) { let s = 0, ok = true; for (let j = i - p + 1; j <= i; j++) { if (!Number.isFinite(x[j])) { ok = false; break; } s += x[j]; } if (ok) o[i] = s; } return o; },
      shift: (a) => { arity(a, 2, 2, 'shift'); const x = series(a[0], 'shift'), k = a[1]; if (isS(k) || !Number.isInteger(k) || k < 0 || k > LIM.period) err('shift: kaydırma 0 ile 500 arasında tam sayı olmalı (geleceğe bakılamaz)'); return x.map((_, i) => (i - k >= 0 ? x[i - k] : NaN)); },
      change: (a) => { arity(a, 1, 2, 'change'); const x = series(a[0], 'change'), k = a.length > 1 ? per(a[1], 'change') : 1; return x.map((v, i) => (i - k >= 0 ? v - x[i - k] : NaN)); },
      abs: (a) => { arity(a, 1, 1, 'abs'); return map(a[0], Math.abs); },
      sqrt: (a) => { arity(a, 1, 1, 'sqrt'); return map(a[0], (v) => (v >= 0 ? Math.sqrt(v) : NaN)); },
      log: (a) => { arity(a, 1, 1, 'log'); return map(a[0], (v) => (v > 0 ? Math.log(v) : NaN)); },
      max: (a) => { arity(a, 2, 2, 'max'); return bin(a[0], a[1], Math.max); },
      min: (a) => { arity(a, 2, 2, 'min'); return bin(a[0], a[1], Math.min); },
      floor: (a) => { arity(a, 1, 1, 'floor'); return map(a[0], Math.floor); },
      ceil: (a) => { arity(a, 1, 1, 'ceil'); return map(a[0], Math.ceil); },
      round: (a) => { arity(a, 1, 1, 'round'); return map(a[0], Math.round); },
      nz: (a) => { arity(a, 1, 2, 'nz'); const r = a.length > 1 ? a[1] : 0; return bin(a[0], r, (x, y) => (Number.isFinite(x) ? x : y)); },
      isna: (a) => { arity(a, 1, 1, 'isna'); return map(a[0], (v) => B01(!Number.isFinite(v))); },
      wma: (a) => { arity(a, 2, 2, 'wma'); return wmaArr(series(a[0], 'wma'), per(a[1], 'wma')); },
      hma: (a) => { arity(a, 2, 2, 'hma'); const x = series(a[0], 'hma'), p = per(a[1], 'hma'), h = Math.max(1, Math.floor(p / 2)), r = Math.max(1, Math.floor(Math.sqrt(p))), w1 = wmaArr(x, h), w2 = wmaArr(x, p); return wmaArr(x.map((_, i) => 2 * w1[i] - w2[i]), r); },
      vwma: (a) => { arity(a, 2, 2, 'vwma'); const x = series(a[0], 'vwma'), p = per(a[1], 'vwma'), pv = I.sma(x.map((v, i) => v * env.volume[i]), p), vv = I.sma(env.volume, p); return pv.map((v, i) => (vv[i] ? v / vv[i] : NaN)); },
      alma: (a) => {
        arity(a, 2, 4, 'alma'); const x = series(a[0], 'alma'), p = per(a[1], 'alma'), off = a.length > 2 ? a[2] : 0.85, sg = a.length > 3 ? a[3] : 6;
        if (isS(off) || isS(sg) || !(sg > 0)) err('alma: ofset ve sigma sayı olmalı (sigma > 0)');
        const m = Math.floor(off * (p - 1)), sd = p / sg, w = []; let ws = 0; for (let k = 0; k < p; k++) { const e = Math.exp(-((k - m) ** 2) / (2 * sd * sd)); w.push(e); ws += e; }
        const o = new Array(n).fill(NaN); for (let i = p - 1; i < n; i++) { let s = 0, ok = true; for (let k = 0; k < p; k++) { const v = x[i - p + 1 + k]; if (!Number.isFinite(v)) { ok = false; break; } s += w[k] * v; } if (ok) o[i] = s / ws; } return o;
      },
      cci: (a) => {
        arity(a, 2, 2, 'cci'); const x = series(a[0], 'cci'), p = per(a[1], 'cci'), m = I.sma(x, p), o = new Array(n).fill(NaN);
        for (let i = p - 1; i < n; i++) { if (!Number.isFinite(m[i])) continue; let d = 0; for (let j = i - p + 1; j <= i; j++) d += Math.abs(x[j] - m[i]); d /= p; o[i] = d ? (x[i] - m[i]) / (0.015 * d) : 0; } return o;
      },
      mfi: (a) => {
        arity(a, 1, 2, 'mfi'); const x = series(a[0], 'mfi'), p = a.length > 1 ? per(a[1], 'mfi') : 14, o = new Array(n).fill(NaN);
        for (let i = p; i < n; i++) { let pos = 0, neg = 0, ok = true; for (let j = i - p + 1; j <= i; j++) { if (!Number.isFinite(x[j]) || !Number.isFinite(x[j - 1])) { ok = false; break; } const mf = x[j] * env.volume[j]; if (x[j] > x[j - 1]) pos += mf; else if (x[j] < x[j - 1]) neg += mf; } if (ok) o[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg); } return o;
      },
      macd: (a) => { arity(a, 1, 3, 'macd'); return I.macd(series(a[0], 'macd'), a[1] ? per(a[1], 'macd') : 12, a[2] ? per(a[2], 'macd') : 26).line; },
      macdsig: (a) => { arity(a, 1, 4, 'macdsig'); return I.macd(series(a[0], 'macdsig'), a[1] ? per(a[1], 'macdsig') : 12, a[2] ? per(a[2], 'macdsig') : 26, a[3] ? per(a[3], 'macdsig') : 9).sig; },
      macdhist: (a) => { arity(a, 1, 4, 'macdhist'); return I.macd(series(a[0], 'macdhist'), a[1] ? per(a[1], 'macdhist') : 12, a[2] ? per(a[2], 'macdhist') : 26, a[3] ? per(a[3], 'macdhist') : 9).hist; },
      bbmid: (a) => { arity(a, 1, 2, 'bbmid'); return I.sma(series(a[0], 'bbmid'), a.length > 1 ? per(a[1], 'bbmid') : 20); },
      bbup: (a) => { arity(a, 1, 3, 'bbup'); return I.bollinger(series(a[0], 'bbup'), a[1] ? per(a[1], 'bbup') : 20, a.length > 2 && !isS(a[2]) ? a[2] : 2).up; },
      bblo: (a) => { arity(a, 1, 3, 'bblo'); return I.bollinger(series(a[0], 'bblo'), a[1] ? per(a[1], 'bblo') : 20, a.length > 2 && !isS(a[2]) ? a[2] : 2).lo; },
      stoch: (a) => {
        arity(a, 4, 4, 'stoch'); const x = series(a[0], 'stoch'), p = per(a[3], 'stoch'), hh = I.rollMax(series(a[1], 'stoch'), p), ll = I.rollMin(series(a[2], 'stoch'), p);
        return x.map((v, i) => (hh[i] > ll[i] ? (100 * (v - ll[i])) / (hh[i] - ll[i]) : NaN));
      },
      barssince: (a) => { arity(a, 1, 1, 'barssince'); const x = series(a[0], 'barssince'); let last = -1; return x.map((v, i) => { if (v) last = i; return last < 0 ? NaN : i - last; }); },
      hold: (a) => { // hold(başlangıç, koşul1, değer1, koşul2, değer2, ...): koşul gerçekleşince değeri tutar, sonraki koşula kadar korur (Pine: var + :=)
        if (a.length < 3 || a.length % 2 === 0) err('hold(başlangıç, koşul, değer, ...) çiftler halinde yazılır');
        const init = a[0], cs = [], vs = []; for (let k = 1; k < a.length; k += 2) { cs.push(series(a[k], 'hold')); vs.push(series(a[k + 1], 'hold')); }
        let cur = isS(init) ? NaN : init; const o = new Array(n); for (let i = 0; i < n; i++) { for (let k = 0; k < cs.length; k++) if (cs[k][i]) cur = vs[k][i]; o[i] = cur; } return o;
      },
      crossover: (a) => { arity(a, 2, 2, 'crossover'); const x = series(a[0], 'crossover'), y = series(a[1], 'crossover'); return x.map((v, i) => (i && v > y[i] && x[i - 1] <= y[i - 1] ? 1 : 0)); },
      crossunder: (a) => { arity(a, 2, 2, 'crossunder'); const x = series(a[0], 'crossunder'), y = series(a[1], 'crossunder'); return x.map((v, i) => (i && v < y[i] && x[i - 1] >= y[i - 1] ? 1 : 0)); },
    });
    const OPS = Object.assign(Object.create(null), {
      '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => (y === 0 ? NaN : x / y), '%': (x, y) => (y === 0 ? NaN : x % y), '^': (x, y) => { const r = Math.pow(x, y); return Number.isFinite(r) ? r : NaN; },
      '<': (x, y) => B01(x < y), '>': (x, y) => B01(x > y), '<=': (x, y) => B01(x <= y), '>=': (x, y) => B01(x >= y), '==': (x, y) => B01(x === y), '!=': (x, y) => B01(x !== y),
      and: (x, y) => B01(x && y), or: (x, y) => B01(x || y),
    });
    function ev(e) {
      switch (e.t) {
        case 'num': return e.v;
        case 'str': return e.v;
        case 'var': if (e.n in env) return env[e.n]; return err(`Tanımsız değişken: ${e.n}`);
        case 'neg': return map(ev(e.x), (v) => -v);
        case 'not': return map(ev(e.x), (v) => B01(!v));
        case 'bin': { const l = ev(e.l), r = ev(e.r); if (typeof l === 'string' || typeof r === 'string') err('Metinle işlem yapılamaz'); return bin(l, r, OPS[e.o]); }
        case 'if': {
          const c = ev(e.c), a = ev(e.a), b = ev(e.b);
          if (typeof a === 'string' || typeof b === 'string') err('Koşulda metin kullanılamaz');
          if (!isS(c) && !isS(a) && !isS(b)) return c ? a : b;
          const o = new Array(n); for (let i = 0; i < n; i++) o[i] = (isS(c) ? c[i] : c) ? (isS(a) ? a[i] : a) : (isS(b) ? b[i] : b);
          return o;
        }
        case 'call': {
          if (e.n === 'plot' || e.n === 'pane' || e.n === 'mark') err(`${e.n}() başka bir ifadenin içinde kullanılamaz`);
          const f = F[e.n]; if (!f) err(`Bilinmeyen işlev: ${e.n}()`);
          return f(e.a.map(ev));
        }
        default: return err('Geçersiz ifade');
      }
    }
    for (const st of prog) {
      line = st.line;
      if (st.t === 'set') {
        if (BUILTIN.includes(st.n) || F[st.n] || st.n === 'plot' || st.n === 'pane' || st.n === 'mark') err(`"${st.n}" ayrılmış bir ad`);
        env[st.n] = ev(st.e);
      } else {
        const c = st.e;
        if (c.t !== 'call' || (c.n !== 'plot' && c.n !== 'pane' && c.n !== 'mark')) err('Satır bir atama (ad = ifade) ya da plot()/pane()/mark() olmalı');
        if (c.n === 'mark') {
          if (c.a.length < 1 || c.a.length > 4) err('mark(koşul, "up" ya da "down", "yazı", "#renk")');
          if (marks >= LIM.marks) err(`En çok ${LIM.marks} işaret eklenebilir`);
          const cond = series(ev(c.a[0]), 'mark'), dir = c.a[1] != null ? ev(c.a[1]) : 'up', text = c.a[2] != null ? ev(c.a[2]) : '', color = c.a[3] != null ? ev(c.a[3]) : (dir === 'down' ? '#ff6384' : '#35d6a0');
          if (dir !== 'up' && dir !== 'down') err('mark: yön "up" ya da "down" olmalı');
          if (typeof text !== 'string' || typeof color !== 'string') err('mark: yazı ve renk metin olmalı');
          if (!/^#[0-9a-fA-F]{6}$/.test(color)) err('Renk #rrggbb biçiminde olmalı');
          marks++; plots.push({ label: text.slice(0, 20) || (dir === 'up' ? 'Al' : 'Sat'), color, pane: 'mark', dir, text: text.slice(0, 20), on: cond.map((x) => (x ? 1 : 0)) });
          continue;
        }
        if (c.a.length < 1 || c.a.length > 3) err(`${c.n}(ifade, "etiket", "#renk")`);
        if (plots.filter((q) => q.pane !== 'mark').length >= LIM.plots) err(`En çok ${LIM.plots} çizgi eklenebilir`);
        const v = series(ev(c.a[0]), c.n), label = c.a[1] != null ? ev(c.a[1]) : 'Çizgi ' + (plots.length + 1);
        const color = c.a[2] != null ? ev(c.a[2]) : PALETTE[plots.length % PALETTE.length];
        if (typeof label !== 'string' || typeof color !== 'string') err('Etiket ve renk metin olmalı: "EMA", "#ffc25c"');
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) err('Renk #rrggbb biçiminde olmalı');
        plots.push({ label: label.slice(0, 24), color, pane: c.n === 'pane' ? 'sub' : 'price', values: v.map((x) => (Number.isFinite(x) ? x : NaN)) });
      }
    }
    if (!plots.length) throw new ScriptError('Çizilecek bir şey yok: plot(...), pane(...) veya mark(...) ekleyin', 0);
    return plots;
  }

  const TEMPLATES = [
    { name: 'Çift EMA', code: '// iki ortalamanın kesişimi\nhizli = ema(close, 9)\nyavas = ema(close, 21)\nplot(hizli, "EMA 9", "#ffc25c")\nplot(yavas, "EMA 21", "#6ea8ff")' },
    { name: 'Donchian kanalı', code: 'ust = highest(high, 20)\nalt = lowest(low, 20)\nplot(ust, "Üst 20", "#35d6a0")\nplot(alt, "Alt 20", "#ff6384")\nplot((ust + alt) / 2, "Orta", "#7e8ba6")' },
    { name: 'Hacim ağırlıklı sapma', code: '// fiyatın 50 mumluk ortalamadan yüzde sapması\nort = sma(close, 50)\npane((close / ort - 1) * 100, "Sapma %", "#c58cff")' },
    { name: 'Stokastik RSI', code: 'r = rsi(close, 14)\nlo = lowest(r, 14)\nhi = highest(r, 14)\nk = (r - lo) / (hi - lo) * 100\npane(k, "StochRSI", "#ffc25c")\npane(sma(k, 3), "Sinyal", "#6ea8ff")' },
  ];
  const FUNCS = ['sma', 'ema', 'rma', 'rsi', 'atr', 'highest', 'lowest', 'stdev', 'sum', 'shift', 'change', 'abs', 'sqrt', 'log', 'max', 'min', 'floor', 'ceil', 'round', 'nz', 'isna', 'wma', 'hma', 'vwma', 'alma', 'cci', 'mfi', 'macd', 'macdsig', 'macdhist', 'bbmid', 'bbup', 'bblo', 'stoch', 'barssince', 'hold', 'crossover', 'crossunder'];
  function checkLine(src) { try { const t = lex(src, 1); if (t.length) parseLine(t, 1); return null; } catch (e) { return e.message; } }
  function identifiers(src) { try { return lex(src, 1).filter((t) => t.k === 'id').map((t) => t.v); } catch (e) { return []; } }
  return { run, parse, ScriptError, LIM, TEMPLATES, FUNCS, BUILTIN, checkLine, identifiers };
});
