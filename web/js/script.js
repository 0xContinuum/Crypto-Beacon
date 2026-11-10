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
  const I = B.indicators, LIM = { chars: 1500, stmts: 40, depth: 24, plots: 6, period: 500 };
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
      if ('+-*/%^<>()?:,='.includes(ch)) { t.push({ k: 'op', v: ch }); i++; continue; }
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
    function prim(d) {
      const t = peek(); if (!t) err('İfade yarım kaldı');
      if (t.k === 'num') { p++; return { t: 'num', v: t.v }; }
      if (t.k === 'str') { p++; return { t: 'str', v: t.v }; }
      if (t.k === 'id') {
        p++;
        if (isOp('(')) { p++; const args = []; if (!isOp(')')) { do { args.push(expr(d + 1)); if (args.length > 6) err('Çok fazla argüman'); } while (isOp(',') && ++p); } eat(')'); return { t: 'call', n: t.v, a: args }; }
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
    if (src.length > LIM.chars) throw new ScriptError(`Formül en çok ${LIM.chars} karakter olabilir`, 0);
    const out = [], lines = src.split('\n');
    lines.forEach((ln, k) => { const t = lex(ln, k + 1); if (t.length) out.push(parseLine(t, k + 1)); });
    if (!out.length) throw new ScriptError('Formül boş', 0);
    if (out.length > LIM.stmts) throw new ScriptError(`En çok ${LIM.stmts} satır yazılabilir`, 0);
    return out;
  }

  /* ——— çalıştırma ——— */
  const BUILTIN = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'tr'];
  const isS = Array.isArray;
  function run(src, candles) {
    const prog = parse(src), n = candles.length;
    const col = (f) => candles.map(f);
    const env = Object.assign(Object.create(null), {
      open: col((k) => k.o), high: col((k) => k.h), low: col((k) => k.l), close: col((k) => k.c), volume: col((k) => k.v),
      hl2: col((k) => (k.h + k.l) / 2), hlc3: col((k) => (k.h + k.l + k.c) / 3), ohlc4: col((k) => (k.o + k.h + k.l + k.c) / 4),
    });
    env.tr = I.trueRange(env.high, env.low, env.close);
    const plots = []; let line = 0;
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
          if (e.n === 'plot' || e.n === 'pane') err(`${e.n}() başka bir ifadenin içinde kullanılamaz`);
          const f = F[e.n]; if (!f) err(`Bilinmeyen işlev: ${e.n}()`);
          return f(e.a.map(ev));
        }
        default: return err('Geçersiz ifade');
      }
    }
    for (const st of prog) {
      line = st.line;
      if (st.t === 'set') {
        if (BUILTIN.includes(st.n) || F[st.n] || st.n === 'plot' || st.n === 'pane') err(`"${st.n}" ayrılmış bir ad`);
        env[st.n] = ev(st.e);
      } else {
        const c = st.e;
        if (c.t !== 'call' || (c.n !== 'plot' && c.n !== 'pane')) err('Satır bir atama (ad = ifade) ya da plot()/pane() olmalı');
        if (c.a.length < 1 || c.a.length > 3) err(`${c.n}(ifade, "etiket", "#renk")`);
        if (plots.length >= LIM.plots) err(`En çok ${LIM.plots} çizgi eklenebilir`);
        const v = series(ev(c.a[0]), c.n), label = c.a[1] != null ? ev(c.a[1]) : 'Çizgi ' + (plots.length + 1);
        const color = c.a[2] != null ? ev(c.a[2]) : PALETTE[plots.length % PALETTE.length];
        if (typeof label !== 'string' || typeof color !== 'string') err('Etiket ve renk metin olmalı: "EMA", "#ffc25c"');
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) err('Renk #rrggbb biçiminde olmalı');
        plots.push({ label: label.slice(0, 24), color, pane: c.n === 'pane' ? 'sub' : 'price', values: v.map((x) => (Number.isFinite(x) ? x : NaN)) });
      }
    }
    if (!plots.length) throw new ScriptError('Çizilecek bir şey yok: plot(...) veya pane(...) ekleyin', 0);
    return plots;
  }

  const TEMPLATES = [
    { name: 'Çift EMA', code: '// iki ortalamanın kesişimi\nhizli = ema(close, 9)\nyavas = ema(close, 21)\nplot(hizli, "EMA 9", "#ffc25c")\nplot(yavas, "EMA 21", "#6ea8ff")' },
    { name: 'Donchian kanalı', code: 'ust = highest(high, 20)\nalt = lowest(low, 20)\nplot(ust, "Üst 20", "#35d6a0")\nplot(alt, "Alt 20", "#ff6384")\nplot((ust + alt) / 2, "Orta", "#7e8ba6")' },
    { name: 'Hacim ağırlıklı sapma', code: '// fiyatın 50 mumluk ortalamadan yüzde sapması\nort = sma(close, 50)\npane((close / ort - 1) * 100, "Sapma %", "#c58cff")' },
    { name: 'Stokastik RSI', code: 'r = rsi(close, 14)\nlo = lowest(r, 14)\nhi = highest(r, 14)\nk = (r - lo) / (hi - lo) * 100\npane(k, "StochRSI", "#ffc25c")\npane(sma(k, 3), "Sinyal", "#6ea8ff")' },
  ];
  return { run, parse, ScriptError, LIM, TEMPLATES };
});
