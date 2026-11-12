/*  Beacon Pine Çevirici: TradingView Pine Script (v4/v5/v6) kodunu Beacon Formül diline çevirir.
 *  Kural tabanlıdır: sunucu, yapay zekâ ya da ücretli hizmet kullanmaz; tarayıcıda çalışır.
 *  İlke: bilmediği satırı tahmin etmez. Çevrilemeyen satır yorum olarak çıktıda kalır ve nedeni raporlanır.
 *  Çeviri sonunda üretilen kod gerçekten çalıştırılarak denenir; hata veren satır yorumlanır.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./script.js'));
  else root.BeaconPine = factory(root.BeaconScript);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';
  class Skip extends Error {}
  const skip = (m) => { throw new Skip(m); };

  const COLORS = { aqua: '#00bcd4', black: '#000000', blue: '#2962ff', fuchsia: '#e040fb', gray: '#787b86', green: '#4caf50', lime: '#00e676', maroon: '#880e4f', navy: '#311b92', olive: '#808000', orange: '#ff9800', purple: '#9c27b0', red: '#f23645', silver: '#b2b5be', teal: '#089981', white: '#ffffff', yellow: '#fdd835' };
  const TA = ['sma', 'ema', 'rma', 'rsi', 'atr', 'highest', 'lowest', 'stdev', 'change', 'wma', 'hma', 'vwma', 'alma', 'cci', 'mfi', 'crossover', 'crossunder', 'barssince', 'stoch'];
  const CALLMAP = Object.create(null);
  for (const f of TA) { CALLMAP['ta.' + f] = f; CALLMAP[f] = f; }
  Object.assign(CALLMAP, { 'ta.sum': 'sum', sum: 'sum', 'ta.tr': 'tr', 'math.abs': 'abs', abs: 'abs', 'math.max': 'max', max: 'max', 'math.min': 'min', min: 'min', 'math.sqrt': 'sqrt', sqrt: 'sqrt', 'math.log': 'log', log: 'log', 'math.floor': 'floor', 'math.ceil': 'ceil', 'math.round': 'round', nz: 'nz' });
  const IDMAP = { 'syminfo.mintick': '0.00000001', 'ta.tr': 'tr', 'ta.obv': 'obv', obv: 'obv', 'math.pi': '3.14159265359', 'ta.hl2': 'hl2' };
  const SERIES = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'tr', 'bar_index', 'true', 'false', 'na'];
  const RESERVED = new Set([].concat(S.FUNCS, S.BUILTIN, ['plot', 'pane', 'mark']));

  /* ——— sözcük çözümleme ——— */
  function tokenize(s) {
    const t = []; let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"' || ch === "'") {
        let j = i + 1, v = '';
        while (j < s.length && s[j] !== ch) { if (s[j] === '\\' && j + 1 < s.length) { const e = s[j + 1]; v += e === 'n' ? '\n' : e === 't' ? ' ' : e; j += 2; } else v += s[j++]; }
        if (j >= s.length) skip('metin kapanmamış');
        t.push({ k: 'str', v }); i = j + 1; continue;
      }
      if (ch === '#') { const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/.exec(s.slice(i)); if (!m) skip('renk kodu okunamadı'); t.push({ k: 'hex', v: '#' + m[1].toLowerCase() }); i += m[0].length; continue; }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); t.push({ k: 'num', v: m[0] }); i += m[0].length; continue; }
      if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*/.exec(s.slice(i)); t.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
      const two = s.slice(i, i + 2);
      if ([':=', '==', '!=', '<=', '>=', '&&', '||', '=>'].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
      if ('+-*/%<>()[],?:=!'.includes(ch)) { t.push({ k: 'op', v: ch }); i++; continue; }
      skip(`tanınmayan karakter: ${ch}`);
    }
    return t;
  }

  /* ——— ağaç: çağrı (ad, argümanlar), grup, indeks ——— */
  function build(tokens) {
    let p = 0;
    function seq(closers) {
      const items = [];
      while (p < tokens.length) {
        const t = tokens[p];
        if (t.k === 'op' && closers.includes(t.v)) return items;
        if (t.k === 'op' && (t.v === ')' || t.v === ']')) skip('parantez eşleşmiyor');
        if (t.k === 'op' && t.v === '(') {
          p++; const prev = items[items.length - 1];
          if (prev && prev.k === 'id' && !['and', 'or', 'not'].includes(prev.v)) {
            const args = [];
            if (!(tokens[p] && tokens[p].k === 'op' && tokens[p].v === ')')) {
              for (;;) {
                const a = seq([',', ')']);
                if (a.length >= 2 && a[0].k === 'id' && a[1].k === 'op' && a[1].v === '=') args.push({ key: a[0].v, val: a.slice(2) }); else args.push({ val: a });
                if (tokens[p] && tokens[p].v === ',') { p++; continue; } break;
              }
            }
            if (!tokens[p] || tokens[p].v !== ')') skip('parantez kapanmamış'); p++;
            items[items.length - 1] = { k: 'call', name: prev.v, args };
          } else { const g = seq([')']); if (!tokens[p]) skip('parantez kapanmamış'); p++; items.push({ k: 'group', items: g }); }
          continue;
        }
        if (t.k === 'op' && t.v === '[') {
          p++; const prev = items[items.length - 1], inner = seq([']', ',']);
          if (!tokens[p]) skip('köşeli parantez kapanmamış');
          if (prev && (prev.k === 'id' || prev.k === 'call' || prev.k === 'group' || prev.k === 'idx') && tokens[p].v === ']') { p++; items.push({ k: 'idx', items: inner }); continue; }
          while (tokens[p] && tokens[p].v !== ']') p++; p++; items.push({ k: 'arr' }); continue;
        }
        items.push(t); p++;
      }
      return items;
    }
    const items = seq([]);
    return items;
  }
  const flat = (items, out = []) => { for (const it of items) { out.push(it); if (it.items) flat(it.items, out); if (it.args) for (const a of it.args) flat(a.val, out); } return out; };

  /* ——— çeviri bağlamı ——— */
  function convert1(source) {
    const rawLines = String(source || '').replace(/\r/g, '').replace(/\t/g, '    ').split('\n');
    const out = [], report = [], warnings = [];
    const funcs = new Map(), scopeStack = [], defined = new Map(), bad = new Map(), colors = new Map(), strings = new Map(), badFuncs = new Set(), plotHandles = new Set(), holds = new Map(), defAt = new Map();
    let title = '', overlay = true, plotCount = 0, markCount = 0, isStrategy = false;

    /* mantıksal satırlar: yorumlar atılır, açık parantezli satırlar birleştirilir */
    const stmts = [];
    {
      let buf = null;
      const stripC = (ln) => { let q = null; for (let i = 0; i < ln.length; i++) { const c = ln[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '/' && ln[i + 1] === '/') return ln.slice(0, i); } return ln; };
      const depthOf = (ln) => { let q = null, d = 0; for (let i = 0; i < ln.length; i++) { const c = ln[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; } return d; };
      rawLines.forEach((raw, k) => {
        const body = stripC(raw), txt = body.trim();
        if (buf) { if (txt) { buf.text += ' ' + txt; buf.depth += depthOf(body); } if (buf.depth <= 0 && !/[,+\-*/?:]$|\b(and|or)$/.test(buf.text.trim())) { stmts.push(buf); buf = null; } return; }
        if (!txt) return;
        const st = { line: k + 1, indent: body.length - body.trimStart().length, text: txt, depth: depthOf(body) };
        if (st.depth > 0 || /[,+\-*/?:]$|\b(and|or)$/.test(txt)) buf = st; else stmts.push(st);
      });
      if (buf) stmts.push(buf);
    }
    const baseIndent = stmts.length ? Math.min(...stmts.map((s) => s.indent)) : 0;
    const assignedVars = new Set();
    for (const st of stmts) { const m = /^([A-Za-z_]\w*)\s*:=/.exec(st.text); if (m) assignedVars.add(m[1]); }

    /* ——— yardımcılar ——— */
    const renameOf = (n) => (RESERVED.has(n) ? n + '_v' : n);
    const addOut = (text, rep) => { out.push({ text, rep }); return out.length - 1; };
    const note = (st, status, text) => { const r = { line: st.line, src: st.text.slice(0, 90), status, text }; report.push(r); return r; };
    const commentSkip = (st, reason, quiet) => { const r = note(st, 'skip', reason); if (!quiet) addOut(`// ✗ ${st.text.slice(0, 50).replace(/\s+/g, ' ')} (${reason.slice(0, 60)})`, r); };
    const argOf = (c, key, pos) => { const named = c.args.find((a) => a.key === key); if (named) return named.val; const posList = c.args.filter((a) => !a.key); return posList[pos] ? posList[pos].val : null; };
    const strOf = (items) => { if (!items) return null; if (items.length === 1 && items[0].k === 'str') return items[0].v; if (items.length === 1 && items[0].k === 'id' && strings.has(items[0].v)) return strings.get(items[0].v); return null; };

    function mapIdent(name, forbid) {
      if (name.includes('.')) { if (IDMAP[name]) return IDMAP[name]; return skip(`${name} desteklenmiyor`); }
      if (forbid && forbid.has(name)) skip(`"${name}" önceki mumdaki kendi değerine bağlı (bu kalıp Aşama 2'de)`);
      if (bad.has(name)) { const e = new Skip(`bağlı olduğu bir satır çevrilemedi: ${bad.get(name)}`); e.root = bad.get(name); e.dep = true; throw e; }
      if (defined.has(name)) return defined.get(name);
      if (SERIES.includes(name)) return name;
      if (assignedVars.has(name)) skip(`"${name}" durum değişkeni, koşuldan önce kullanılıyor`);
      if (strings.has(name) || colors.has(name)) skip(`"${name}" metin/renk değişkeni, hesapta kullanılamaz`);
      return skip(`"${name}" tanımlı değil`);
    }
    /* metin sabitleri: "HMA" == "HMA" gibi karşılaştırmalar ve sabit koşullu ?: önceden çözülür */
    const strVal = (items) => {
      if (!items || items.length !== 1) return null; const t = items[0];
      if (t.k === 'str') return t.v;
      if (t.k === 'id') { const sc = scopeStack[scopeStack.length - 1]; if (sc && sc.has(t.v)) return sc.get(t.v).str !== undefined ? sc.get(t.v).str : null; if (strings.has(t.v) && strings.get(t.v) != null) return strings.get(t.v); }
      return null;
    };
    function fold(items) {
      let it = items.slice();
      for (let i = 1; i < it.length - 1; i++) {
        const o = it[i]; if (o.k !== 'op' || (o.v !== '==' && o.v !== '!=')) continue;
        const a = strVal([it[i - 1]]), b = strVal([it[i + 1]]); if (a === null || b === null) continue;
        it.splice(i - 1, 3, { k: 'id', v: (a === b) === (o.v === '==') ? 'true' : 'false' }); i--;
      }
      if (it.length > 2 && it[0].k === 'id' && (it[0].v === 'true' || it[0].v === 'false') && it[1].k === 'op' && it[1].v === '?') {
        let depth = 0, col = -1; for (let i = 2; i < it.length; i++) { const t = it[i]; if (t.k !== 'op') continue; if (t.v === '?') depth++; else if (t.v === ':') { if (depth === 0) { col = i; break; } depth--; } }
        if (col > 0) return fold(it[0].v === 'true' ? it.slice(2, col) : it.slice(col + 1));
      }
      return it;
    }
    function render(items, forbid) {
      items = fold(items);
      let s = '';
      items.forEach((it, i) => {
        const prev = items[i - 1];
        if (it.k === 'num') s += it.v;
        else if (it.k === 'str') skip('metin ifadesi hesapta kullanılamaz');
        else if (it.k === 'hex') skip('renk değeri hesapta kullanılamaz');
        else if (it.k === 'id') { if (it.v === 'na' || it.v === 'true' || it.v === 'false') s += it.v; else if (it.v === 'and' || it.v === 'or') s += ` ${it.v} `; else if (it.v === 'not') s += 'not '; else { const sc = scopeStack[scopeStack.length - 1]; if (sc && sc.has(it.v)) { const e = sc.get(it.v); if (e.s === undefined) skip('metin değeri hesapta kullanılamaz'); s += e.s; } else s += mapIdent(it.v, forbid); } }
        else if (it.k === 'call') s += renderCall(it, forbid);
        else if (it.k === 'group') s += '(' + render(it.items, forbid) + ')';
        else if (it.k === 'idx') s += '[' + render(it.items, forbid) + ']';
        else if (it.k === 'arr') skip('dizi (array) desteklenmiyor');
        else if (it.k === 'op') {
          const v = it.v, unary = !prev || prev.k === 'op';
          if (v === '-' && unary) s += '-';
          else if (v === '!') s += 'not ';
          else if (v === '&&') s += ' and ';
          else if (v === '||') s += ' or ';
          else if (v === '=' || v === ':=' || v === '=>') skip('beklenmeyen atama işareti');
          else s += ` ${v} `;
        }
      });
      return s.replace(/\s+/g, ' ').trim();
    }
    function inline(n, args, forbid) {
      const fn = funcs.get(n);
      if (scopeStack.length >= 6) skip(`${n}(): fonksiyon çağrıları çok iç içe`);
      if (args.some((a) => a.key)) skip(`${n}() adlandırılmış argümanlarla çağrılamaz`);
      if (args.length > fn.params.length) skip(`${n}() fazla argüman aldı`);
      const sc = new Map();
      fn.params.forEach((pn, k) => {
        if (!args[k]) skip(`${n}(): "${pn}" argümanı eksik`);
        const sv = strVal(args[k].val); sc.set(pn, sv !== null ? { str: sv } : { s: '(' + render(args[k].val, forbid) + ')' });
      });
      scopeStack.push(sc);
      try {
        let out = null;
        fn.body.forEach((line, k) => {
          const m = /^([A-Za-z_]\w*)\s*=\s*([^=].*)$/.exec(line), last = k === fn.body.length - 1;
          if (!last) { if (!m) skip(`${n}() gövdesinde desteklenmeyen satır`); const it = build(tokenize(m[2])), sv = strVal(it); sc.set(m[1], sv !== null ? { str: sv } : { s: '(' + render(it, forbid) + ')' }); }
          else out = '(' + render(build(tokenize(m ? m[2] : line)), forbid) + ')';
        });
        return out;
      } finally { scopeStack.pop(); }
    }
    function renderCall(c, forbid) {
      const n = c.name, args = c.args;
      if (funcs.has(n)) return inline(n, args, forbid);
      if (badFuncs.has(n)) skip(`kendi yazdığınız fonksiyon: ${n}() çevrilemedi`);
      if (args.some((a) => a.key)) skip(`${n}() adlandırılmış argümanlarla desteklenmiyor`);
      const R = (a) => render(a.val, forbid);
      if (n === 'na') { if (args.length !== 1) skip('na() tek argüman alır'); return `isna(${R(args[0])})`; }
      if (n === 'ta.cross' || n === 'cross') { const a = R(args[0]), b = R(args[1]); return `(crossover(${a}, ${b}) or crossunder(${a}, ${b}))`; }
      if (n === 'math.pow') { if (args.length !== 2) skip('pow() 2 argüman alır'); return `((${R(args[0])}) ^ (${R(args[1])}))`; }
      if (n === 'math.avg') return `((${args.map(R).join(' + ')}) / ${args.length})`;
      if (n === 'ta.tr') return 'tr';
      if ((n === 'ta.highest' || n === 'highest') && args.length === 1) return `highest(high, ${R(args[0])})`;
      if ((n === 'ta.lowest' || n === 'lowest') && args.length === 1) return `lowest(low, ${R(args[0])})`;
      if ((n === 'ta.stdev' || n === 'ta.change') && args.length < 1) skip(`${n}() argüman bekler`);
      const m = CALLMAP[n];
      if (!m) skip(`${n}() desteklenmiyor`);
      return `${m}(${args.map(R).join(', ')})`;
    }
    const exprOf = (items, forbid) => render(items, forbid);

    /* renk: ilk çözülebilen renk (color.xxx, #hex ya da renk değişkeni) */
    function colorOf(items) {
      if (!items) return null;
      for (const it of flat(items)) {
        if (it.k === 'hex') return it.v;
        if (it.k === 'id') { const m = /^color\.(\w+)$/.exec(it.v); if (m && COLORS[m[1]]) return COLORS[m[1]]; if (colors.has(it.v)) { const c = colors.get(it.v); if (c) return c; } }
      }
      return null;
    }
    const looksColor = (items) => flat(items).some((it) => it.k === 'hex' || (it.k === 'id' && (/^color\./.test(it.v) || colors.has(it.v))) || (it.k === 'call' && /^color\./.test(it.name)));

    /* c ? v : na biçiminde ise koşulu al */
    function unwrapCond(items) {
      let q = -1, col = -1, d = 0;
      for (let i = 0; i < items.length; i++) { const t = items[i]; if (t.k === 'op' && t.v === '?' && q < 0) q = i; if (t.k === 'op' && t.v === ':') col = i; }
      if (q > 0 && col > q && items.length - col === 2 && items[col + 1].k === 'id' && items[col + 1].v === 'na') return items.slice(0, q);
      return items;
    }
    const cleanText = (t) => (t || '').split('\n')[0].replace(/"/g, '').trim().slice(0, 20);
    function pickDir(hints) {
      const h = hints.join(' ').toLowerCase();
      if (/down|below.?false|abovebar|label_down|arrowdown|▼|↓|⬇|bear|short|sell|düş|kaç|sat\b/.test(h)) return 'down';
      if (/up|belowbar|label_up|arrowup|▲|↑|⬆|bull|long|buy|al\b/.test(h)) return 'up';
      return 'up';
    }
    const idText = (items) => (items ? flat(items).filter((x) => x.k === 'id').map((x) => x.v).join(' ') : '');

    function emitMark(st, condItems, dirHints, text, colorItems, forbid) {
      if (markCount >= S.LIM.marks) skip(`en çok ${S.LIM.marks} işaret eklenebilir`);
      const cond = exprOf(unwrapCond(condItems), forbid), col = colorOf(colorItems) || (pickDir(dirHints) === 'down' ? COLORS.red : COLORS.teal), dir = pickDir(dirHints);
      markCount++;
      const r = note(st, 'ok', `işaret (${dir === 'up' ? 'yukarı' : 'aşağı'})`);
      addOut(`mark(${cond}, "${dir}", "${cleanText(text)}", "${col}")`, r);
    }

    /* ——— tek bir ifade satırı (çağrılar) ——— */
    function doCall(st, items, forbid) {
      const c = items[0];
      if (items.length !== 1 || c.k !== 'call') skip('anlaşılamayan satır');
      const n = c.name;
      if (n === 'indicator' || n === 'study') {
        title = strOf(argOf(c, 'title', 0)) || title; const ov = argOf(c, 'overlay', 99); if (ov && ov[0] && ov[0].v === 'false') overlay = false;
        note(st, 'info', 'gösterge tanımı (çıktıda gerekmez)'); return;
      }
      if (n === 'strategy') { isStrategy = true; return skip('strateji: al-sat emirleri Beacon\'da çalışmaz; yalnızca göstergeye dönüşen kısımlar çevrilir'); }
      if (/^strategy\./.test(n)) return skip('strateji emri desteklenmiyor');
      if (n === 'plot') {
        const series = argOf(c, 'series', 0), ttl = strOf(argOf(c, 'title', 1)), colItems = argOf(c, 'color', 2), sty = idText(argOf(c, 'style', 4));
        if (!series) skip('plot() boş');
        if (plotCount >= S.LIM.plots) skip(`en çok ${S.LIM.plots} çizgi eklenebilir`);
        const e = exprOf(series, forbid), col = colorOf(colItems); plotCount++;
        const r = note(st, 'ok', /histogram|columns|area|cross|circles/.test(sty) ? 'çizgi olarak çizilir (stil desteklenmiyor)' : 'çizgi');
        addOut(`${overlay ? 'plot' : 'pane'}(${e}${ttl ? `, "${ttl.replace(/"/g, '').slice(0, 24)}"` : ', "Çizgi"'}${col ? `, "${col}"` : ''})`, r); return;
      }
      if (n === 'plotshape' || n === 'plotchar' || n === 'plotarrow') {
        const series = argOf(c, 'series', 0), ttl = strOf(argOf(c, 'title', 1));
        const style = n === 'plotshape' ? idText(argOf(c, 'style', 2)) : '', loc = idText(argOf(c, 'location', n === 'plotshape' ? 3 : 3));
        const colItems = argOf(c, 'color', 4), txt = strOf(argOf(c, 'text', n === 'plotshape' ? 6 : 99)) || (n === 'plotchar' ? strOf(argOf(c, 'char', 2)) : '') || '';
        if (!series) skip(`${n}() boş`);
        emitMark(st, series, [style, loc, txt, ttl || ''], txt || '', colItems, forbid); return;
      }
      if (n === 'label.new') return skip('etiket yalnızca bir if bloğunun içinde çevrilir');
      if (/^(bgcolor|barcolor)$/.test(n)) return skip(n === 'bgcolor' ? 'arka plan renklendirme desteklenmiyor' : 'mum renklendirme desteklenmiyor');
      if (n === 'fill') return skip('iki çizgi arası dolgu desteklenmiyor');
      if (n === 'hline') return skip('yatay çizgi (hline) desteklenmiyor; plot(sabit) ile çizebilirsiniz');
      if (/^(plotcandle|plotbar)$/.test(n)) return skip('özel mum çizimi desteklenmiyor');
      if (/^(alertcondition|alert)$/.test(n)) return skip('uyarılar şimdilik desteklenmiyor');
      if (/^(line|box|table|label|polyline|linefill)\./.test(n)) return skip(`${n.split('.')[0]} nesneleri desteklenmiyor`);
      if (/^(request|array|map|matrix|str|log|runtime)\./.test(n)) return skip(`${n}() desteklenmiyor`);
      return skip(`${n}() desteklenmiyor`);
    }

    /* label.new → mark (koşullu blok içinde) */
    function labelToMark(st, items, condItems, forbid) {
      const c = items[0];
      if (!c || c.k !== 'call' || c.name !== 'label.new') skip('anlaşılamayan satır');
      const txt = strOf(argOf(c, 'text', 2)) || '', style = idText(argOf(c, 'style', 6)), yloc = idText(argOf(c, 'yloc', 4)), colItems = argOf(c, 'color', 5);
      emitMark(st, condItems, [style, yloc, txt], txt, colItems, forbid);
    }

    /* ——— girdiler ——— */
    function handleInput(st, name, c) {
      const kind = c.name === 'input' ? 'auto' : c.name.slice(6), defv = argOf(c, 'defval', 0), ttl = strOf(argOf(c, 'title', 1));
      if (!defv) skip('girdi varsayılanı okunamadı');
      if (kind === 'color') { colors.set(name, colorOf(defv)); note(st, 'info', 'renk girdisi (renk çizim satırlarında kullanılır)'); return; }
      if (kind === 'string' || (defv.length === 1 && defv[0].k === 'str')) { const v = strOf(defv); strings.set(name, v); note(st, 'info', `metin girdisi "${v}" (seçenekler çevrilmez, varsayılan sabit alındı)`); return; }
      if (kind === 'timeframe' || kind === 'symbol') { bad.set(name, 'zaman dilimi/sembol girdisi'); return skip('zaman dilimi/sembol girdisi desteklenmiyor'); }
      if (kind === 'source') { const e = exprOf(defv); defined.set(name, renameOf(name)); const r = note(st, 'ok', 'kaynak girdisi (sabit olarak alındı)'); addOut(`${renameOf(name)} = ${e}`, r); defAt.set(name, out.length); return; }
      if (kind === 'bool' || (defv.length === 1 && defv[0].k === 'id' && /^(true|false)$/.test(defv[0].v))) { const v = defv[0].v === 'true' ? 1 : 0; defined.set(name, renameOf(name)); const r = note(st, 'ok', 'girdi → sabit'); addOut(`${renameOf(name)} = ${v}${ttl ? ' // ' + ttl.slice(0, 50) : ''}`, r); defAt.set(name, out.length); return; }
      const e = exprOf(defv); defined.set(name, renameOf(name)); const r = note(st, 'ok', 'girdi → sabit (değeri satırda değiştirebilirsiniz)');
      addOut(`${renameOf(name)} = ${e}${ttl ? ' // ' + ttl.replace(/\s+/g, ' ').slice(0, 50) : ''}`, r); defAt.set(name, out.length);
    }

    /* ——— blok: kendi fonksiyonu, if, for ——— */
    function blockEnd(i) { let j = i + 1; while (j < stmts.length && stmts[j].indent > stmts[i].indent) j++; return j; }

    function setHold(st, vname, condItems, valItems, forbidAll) {
      const cond = exprOf(condItems, forbidAll), val = exprOf(valItems, forbidAll);
      let h = holds.get(vname);
      if (!h) {
        const init = h0.get(vname) || '0'; const r = note(st, 'ok', 'durum değişkeni (var + :=) → hold()');
        h = { name: vname, init, pairs: [], idx: -1, rep: r }; holds.set(vname, h);
        h.pairs.push([cond, val]); h.idx = addOut('', r); defined.set(vname, renameOf(vname)); defAt.set(vname, out.length);
      } else {
        for (const id of S.identifiers(cond + ' ' + val)) if ((defAt.get(id) || 0) > h.idx + 1 && !SERIES.includes(id) && !S.FUNCS.includes(id)) skip('koşul değişkeni durum satırından sonra tanımlı');
        h.pairs.push([cond, val]); note(st, 'ok', 'durum değişkenine koşul eklendi');
      }
      out[h.idx].text = `${renameOf(vname)} = hold(${h.init}, ${h.pairs.map((p) => p.join(', ')).join(', ')})`;
    }
    const h0 = new Map();

    function processBlock(i, forbidAll) {
      const st = stmts[i], end = blockEnd(i), body = stmts.slice(i + 1, end);
      let head = st.text;
      if (/^(for|while|switch)\b/.test(head)) { commentSkip(st, 'döngü/switch (Aşama 2)'); return end; }
      if (/^else\b/.test(head)) { commentSkip(st, 'else dalı (Aşama 2)'); return end; }
      const cm = /^if\s+(.*)$/.exec(head);
      if (!cm) { commentSkip(st, 'anlaşılamayan blok'); return end; }
      let condItems;
      const body0 = body.map((b) => b);
      try {
        condItems = build(tokenize(cm[1]));
        exprOf(condItems, forbidAll); // doğrula (kendine bağımlı mı?)
      } catch (e) {
        if (!(e instanceof Skip)) throw e;
        commentSkip(st, e.message, e.dep); for (const b of body0) note(b, 'skip', e.message); return end;
      }
      if (!body.length) { commentSkip(st, 'boş blok'); return end; }
      const wasHeader = note(st, 'info', 'koşul bloğu');
      for (const b of body) {
        try {
          const am = /^([A-Za-z_]\w*)\s*:=\s*(.+)$/.exec(b.text);
          if (am) {
            if (!assignedVars.has(am[1]) || !h0.has(am[1])) skip(`"${am[1]}" var ile tanımlanmamış`);
            setHold(b, am[1], condItems, build(tokenize(am[2])), forbidAll);
          } else if (/^label\.new\s*\(/.test(b.text)) labelToMark(b, build(tokenize(b.text)), condItems, forbidAll);
          else skip('blok içindeki bu satır desteklenmiyor (' + b.text.slice(0, 30) + ')');
        } catch (e) { if (!(e instanceof Skip)) throw e; commentSkip(b, e.message, e.dep); }
      }
      void wasHeader; return end;
    }

    /* ——— ana döngü ——— */
    let i = 0;
    const forbidAll = new Set(assignedVars);
    while (i < stmts.length) {
      const st = stmts[i]; let text = st.text;
      try {
        if (st.indent > baseIndent) { i++; continue; }
        if (/^(import|library)\b/.test(text)) { note(st, 'info', 'içe aktarma yok sayıldı'); i++; continue; }
        if (/^(export\s+)?(method\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*=>/.test(text)) {
          const hm = /^(?:export\s+)?(?:method\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>\s*(.*)$/.exec(text), fn = hm[1], end = blockEnd(i);
          const params = hm[2].split(',').map((x) => x.trim().replace(/^(?:series\s+|simple\s+|const\s+)?(?:int|float|bool|string|color)\s+/, '')).filter(Boolean);
          const body = (hm[3] ? [hm[3]] : []).concat(stmts.slice(i + 1, end).map((b) => b.text));
          if (!body.length || params.some((x) => !/^[A-Za-z_]\w*$/.test(x))) { badFuncs.add(fn); commentSkip(st, 'fonksiyon tanımı okunamadı'); }
          else { funcs.set(fn, { params, body }); note(st, 'info', `fonksiyon ${fn}() çağrıldığı yerde açılır`); }
          for (let k = i + 1; k < end; k++) note(stmts[k], 'info', 'fonksiyon gövdesi');
          i = end; continue;
        }
        if (/^(if|for|while|switch|else)\b/.test(text)) { i = processBlock(i, forbidAll); continue; }
        text = text.replace(/^(var|varip)\s+/, (m0, k0) => { st.isVar = true; return ''; });
        text = text.replace(/^(?:series\s+|simple\s+|const\s+)?(?:int|float|bool|string|color|label|line|box|table)\s+(?=[A-Za-z_])/, '');
        const tup = /^\[\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\]\s*=\s*(.+)$/.exec(text);
        if (tup) {
          const names = tup[1].split(',').map((x) => x.trim()), toks = build(tokenize(tup[2])), c = toks[0];
          if (toks.length !== 1 || c.k !== 'call') skip('çoklu atama okunamadı');
          const nm = c.name.replace(/^ta\./, ''), fns = nm === 'macd' ? ['macd', 'macdsig', 'macdhist'] : nm === 'bb' ? ['bbmid', 'bbup', 'bblo'] : null;
          if (!fns) { for (const x of names) bad.set(x, c.name + '() çoklu değer'); skip(`${c.name}() çoklu değer döndürüyor (desteklenmiyor)`); }
          const args = c.args.map((a) => render(a.val, null)).join(', ');
          names.forEach((x, k) => { if (x === '_') return; defined.set(x, renameOf(x)); const r = note(st, 'ok', c.name + ' bileşeni'); addOut(`${renameOf(x)} = ${fns[k]}(${args})`, r); defAt.set(x, out.length); });
          i++; continue;
        }
        const vm = /^([A-Za-z_]\w*)\s*(:=|=)\s*(.+)$/.exec(text);
        if (vm && !/^=/.test(vm[3])) {
          const name = vm[1], op = vm[2], rhsTxt = vm[3];
          if (op === ':=') skip('yeniden atama (:=) bir if bloğunun dışında (Aşama 2)');
          const items = build(tokenize(rhsTxt)), first = items[0];
          if (st.isVar && assignedVars.has(name)) { // durum değişkeni: ilk if bloğunda hold() olarak yazılır
            let init; try { init = exprOf(items); } catch (e) { if (!(e instanceof Skip)) throw e; init = '0'; }
            h0.set(name, init); note(st, 'info', 'durum değişkeni tanımı'); i++; continue;
          }
          if (first && first.k === 'call' && items.length === 1) {
            if (first.name === 'input' || /^input\./.test(first.name)) { handleInput(st, name, first); i++; continue; }
            if (/^request\./.test(first.name)) { bad.set(name, 'başka zaman dilimi/sembol verisi (request.security)'); skip('başka zaman dilimi verisi (request.security) desteklenmiyor'); }
            if (first.name === 'plot') { plotHandles.add(name); doCall(st, items, null); i++; continue; }
            if (/^(table|label|line|box|polyline)\./.test(first.name)) { bad.set(name, 'çizim nesnesi'); skip('çizim nesnesi desteklenmiyor'); }
          }
          if (items.length === 1 && items[0].k === 'str') { strings.set(name, items[0].v); note(st, 'info', 'metin değişkeni'); i++; continue; }
          if (looksColor(items)) { colors.set(name, colorOf(items)); note(st, 'info', 'renk tanımı (çıktıda gerekmez)'); i++; continue; }
          const e = exprOf(items, null);
          const line = `${renameOf(name)} = ${e}`, err = S.checkLine(line);
          if (err) skip(err);
          defined.set(name, renameOf(name)); bad.delete(name);
          const r = note(st, 'ok', 'hesaplama'); addOut(line, r); defAt.set(name, out.length); i++; continue;
        }
        const items = build(tokenize(text));
        doCall(st, items, null); i++; continue;
      } catch (e) {
        if (!(e instanceof Skip)) throw e;
        const m = /^([A-Za-z_]\w*)\s*(=|:=)/.exec(text); if (m && !holds.has(m[1])) bad.set(m[1], e.root || e.message);
        commentSkip(st, e.message, e.dep); i++;
      }
    }

    /* ——— üretilen kodu gerçekten çalıştırarak doğrula; hata veren satırı yorumla ——— */
    const synth = []; { let p = 100, seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; for (let k = 0; k < 800; k++) { const o = p; p *= 1 + (rnd() - 0.5) * 0.04; synth.push({ t: k * 3600000, o, h: Math.max(o, p) * (1 + rnd() * 0.01), l: Math.min(o, p) * (1 - rnd() * 0.01), c: p, v: 100 + rnd() * 900 }); } }
    const build2 = () => { const head = [`// ${title || 'Pine göstergesi'} (Pine'dan Beacon dilimize çevrildi)`]; return head.concat(out.map((o) => o.text).filter((t) => t !== '')).join('\n'); };
    let code = '', lastErr = null;
    for (let tries = 0; tries < 40; tries++) {
      code = build2();
      try { S.run(code, synth); lastErr = null; break; } catch (e) {
        lastErr = e;
        if (!e.line || e.line < 2) break;
        // satır numarası: başlık yorumu + boş satırlar çıkarıldığı için out dizisiyle eşle
        const nonEmpty = out.map((o, k) => [o, k]).filter(([o]) => o.text !== '');
        const target = nonEmpty[e.line - 2]; if (!target) break;
        const [o] = target; if (o.text.startsWith('//')) break;
        const why = e.message, orig = o.text; o.text = `// ✗ ${orig.slice(0, 60)} (${why})`;
        if (o.rep) { o.rep.status = 'skip'; o.rep.text = why; }
        const nm = /^([A-Za-z_]\w*)\s*=/.exec(orig); if (nm) bad.set(nm[1], why);
      }
    }
    if (lastErr && /Çizilecek bir şey yok/.test(lastErr.message)) warnings.push('Çıktıda çizilebilir bir çizgi ya da işaret kalmadı. Aşağıdaki atlanan satırların nedenlerine bakın.');
    else if (lastErr) warnings.push('Çıktı çalıştırılamadı: ' + lastErr.message);
    if (isStrategy) warnings.push('Bu kod bir strateji. Al-sat emirleri çevrilmez; yalnızca gösterge kısımları çevrildi.');
    const ok = report.filter((r) => r.status === 'ok').length, skipped = report.filter((r) => r.status === 'skip').length;
    if (skipped && !ok) warnings.push('Çevrilebilen satır bulunamadı.');
    return { code, title: title || 'Pine göstergesi', report, ok, skipped, warnings, drawable: !lastErr };
  }

  /* rapor: aynı nedeni gruplar */
  function groupReport(report) {
    const g = new Map();
    for (const r of report) { if (r.status !== 'skip') continue; const k = r.text; if (!g.has(k)) g.set(k, []); g.get(k).push(r.line); }
    return [...g.entries()].map(([text, lines]) => ({ text, lines })).sort((a, b) => b.lines.length - a.lines.length);
  }
  /* v1 (vektörel, hafif) tam çevirirse onu kullan; eksik kalırsa mum mum çalışan Formül 2 motoruna geç */
  function synth(n, ms) { const c = []; let p = 100; for (let i = 0; i < n; i++) { p += Math.sin(i / 7) * 2 + Math.cos(i / 3); c.push({ t: 1.7e12 + i * ms, o: p - 1, h: p + 2, l: p - 2, c: p + Math.sin(i), v: 100 + (i % 13) }); } return c; }
  function convert(source) {
    const r1 = convert1(source);
    if (r1.ok && r1.skipped === 0 && r1.drawable) return r1;
    const S2 = typeof require === 'function' && typeof module === 'object' ? require('./script2.js') : (typeof window !== 'undefined' ? window.BeaconScript2 : null);
    if (!S2) return r1;
    const code = '//@beacon2\n' + String(source || '');
    try {
      const base = synth(500, 36e5), htf = (tf) => synth(200, S2.LIM && 0 || ({ '1d': 864e5, '1w': 6048e5, '4h': 144e5, '2h': 72e5, '1M': 2592e6 }[tf] || 864e5));
      const res = S2.run(code, base, { tf: '1h', getCandles: htf });
      const tit = /(?:indicator|strategy|study)\s*\(\s*(?:title\s*=\s*)?"([^"]{1,60})"/.exec(String(source || ''));
      const drawn = res.length > 0;
      if (!drawn) return r1;
      const warnings = (r1.warnings || []).filter((w) => !/Aşama|çevrilemedi/.test(w)).slice();
      warnings.push('Bu kod Formül 2 motoruyla çalışıyor (durum değişkenleri, döngüler, çizimler dahil).');
      return { code, title: (tit && tit[1]) || r1.title, report: [], ok: true, skipped: 0, warnings, drawable: true, engine: 2 };
    } catch (e) {
      r1.warnings = (r1.warnings || []).concat(['Formül 2 denemesi: ' + (e.message || e) + (e.line ? ' (satır ' + e.line + ')' : '')]);
      return r1;
    }
  }
  return { convert, convert1, groupReport };
});
