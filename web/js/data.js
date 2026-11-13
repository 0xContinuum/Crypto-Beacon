/*  Beacon veri katmanı: Binance herkese açık mum verisi (anahtarsız, yalnızca okuma).
 *  Sunucu yok; tarayıcı doğrudan çağırır. Birinci uç noktaya ulaşılamazsa yedeğe geçer.
 */
(function (root) {
  'use strict';
  const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
  const COINS = [
    { s: 'BTC', n: 'Bitcoin', free: true }, { s: 'ETH', n: 'Ethereum', free: true }, { s: 'SOL', n: 'Solana', free: true },
    { s: 'BNB', n: 'BNB' }, { s: 'XRP', n: 'XRP' }, { s: 'ADA', n: 'Cardano' }, { s: 'DOGE', n: 'Dogecoin' },
    { s: 'AVAX', n: 'Avalanche' }, { s: 'LINK', n: 'Chainlink' }, { s: 'GRAM', n: 'Gram (eski Toncoin)' },
  ];
  const TFS = ['15m', '1h', '4h', '1d', '1w'];
  const FAPI = ['https://fapi.binance.com'];

  /* İlk 100 (yaklaşık piyasa değeri sırası). Canlı Binance listesiyle süzülür; ulaşılamazsa olduğu gibi kullanılır. */
  const TOP = ('BTC Bitcoin|ETH Ethereum|XRP XRP|BNB BNB|SOL Solana|DOGE Dogecoin|TRX TRON|ADA Cardano|LINK Chainlink|AVAX Avalanche|XLM Stellar|BCH Bitcoin Cash|SUI Sui|HBAR Hedera|LTC Litecoin|GRAM Gram (eski Toncoin)|DOT Polkadot|UNI Uniswap|AAVE Aave|NEAR NEAR Protocol|ICP Internet Computer|ETC Ethereum Classic|APT Aptos|ONDO Ondo|POL Polygon|ARB Arbitrum|OP Optimism|FIL Filecoin|ATOM Cosmos|VET VeChain|ALGO Algorand|INJ Injective|RENDER Render|TAO Bittensor|SEI Sei|TIA Celestia|IMX Immutable|STX Stacks|CRV Curve|LDO Lido DAO|MKR Maker|GRT The Graph|FET Artificial Superintelligence Alliance|JUP Jupiter|PEPE Pepe|SHIB Shiba Inu|WIF dogwifhat|BONK Bonk|FLOKI Floki|ENA Ethena|PENDLE Pendle|RUNE THORChain|SAND The Sandbox|MANA Decentraland|AXS Axie Infinity|GALA Gala|CHZ Chiliz|EGLD MultiversX|THETA Theta Network|FLOW Flow|XTZ Tezos|NEO NEO|IOTA IOTA|ZEC Zcash|DASH Dash|COMP Compound|SNX Synthetix|1INCH 1inch|ENS Ethereum Name Service|DYDX dYdX|KAVA Kava|ZIL Zilliqa|QNT Quant|AR Arweave|ROSE Oasis Network|MINA Mina|CFX Conflux|WLD Worldcoin|PYTH Pyth Network|JTO Jito|STRK Starknet|W Wormhole|ZK ZKsync|EIGEN EigenLayer|NOT Notcoin|TRUMP Official Trump|VIRTUAL Virtuals Protocol|PENGU Pudgy Penguins|S Sonic|BERA Berachain|IP Story|KAITO Kaito|WLFI World Liberty Financial|PUMP Pump.fun|ASTER Aster|HYPE Hyperliquid|XMR Monero|EOS EOS|KAS Kaspa|CAKE PancakeSwap|SUSHI SushiSwap|YFI yearn.finance|BAT Basic Attention Token|LRC Loopring|ANKR Ankr|GMX GMX|ORDI ORDI|SSV SSV Network|BLUR Blur|MASK Mask Network|APE ApeCoin|CKB Nervos Network|RVN Ravencoin|ICX ICON|KSM Kusama|OM MANTRA').split('|').map((x) => { const i = x.indexOf(' '); return { s: x.slice(0, i), n: x.slice(i + 1) }; });
  const NAME_OF = new Map(TOP.map((c) => [c.s, c.n]));
  const STABLE = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'EUR', 'GBP', 'TRY', 'BRL', 'AEUR', 'USD1', 'XUSD', 'USDE', 'UST', 'USTC', 'EURI', 'RLUSD', 'BFUSD']);
  const INDEXES = [
    { s: '$TOTAL', n: 'TOTAL · Toplam piyasa değeri (ilk 100)', free: true }, { s: '$TOTAL2', n: 'TOTAL2 · BTC hariç' }, { s: '$TOTAL3', n: 'TOTAL3 · BTC ve ETH hariç' },
    { s: '$BTCD', n: 'BTC.D · Bitcoin dominansı %', free: true }, { s: '$USDTD', n: 'USDT.D · Tether dominansı %' },
  ];
  const INDEX_ON = !!(root.BEACON_CONFIG && root.BEACON_CONFIG.indexes); // şimdilik kapalı: veri kaynağı belirlenince açılır
  const FREE = new Set(['BTC', 'ETH', 'SOL', 'BTC.P']);
  const cat = { ready: false, live: false, spot: new Set(), perp: new Set() }; // canlı Binance USDT pariteleri (taban adları)
  const kindOf = (s) => (s[0] === '$' ? 'index' : s.endsWith('.P') ? 'perp' : 'spot');
  const baseOf = (s) => (kindOf(s) === 'perp' ? s.slice(0, -2) : s);

  function meta(sym) {
    const c = COINS.find((x) => x.s === sym); if (c) return Object.assign({ kind: 'spot', base: sym }, c);
    const k = kindOf(sym);
    if (k === 'index') { const i = INDEXES.find((x) => x.s === sym) || INDEXES[0]; return { s: sym, n: i.n, kind: k, base: sym, free: !!i.free }; }
    const b = baseOf(sym);
    return { s: sym, n: NAME_OF.get(b) || b, kind: k, base: b, free: FREE.has(sym) };
  }
  const label = (sym) => { const m = meta(sym); return m.kind === 'index' ? sym.slice(1).replace('BTCD', 'BTC.D').replace('USDTD', 'USDT.D') : m.kind === 'perp' ? m.base + 'USDT.P' : sym + '/USDT'; };
  const tfsFor = (sym, extra) => (kindOf(sym) === 'index' ? ['1d', '1w'] : extra && extra.length ? TFS.concat(extra) : TFS);

  /** Seçicideki liste: tür = 'spot' | 'perp' | 'index'. Boş sorguda ilk 100; sorguda tüm canlı pariteler de aranır. */
  function list(kind, q) {
    q = (q || '').trim().toLowerCase();
    if (kind === 'index') return !INDEX_ON ? [] : INDEXES.filter((i) => !q || (i.s + ' ' + i.n).toLowerCase().includes(q)).map((i) => meta(i.s));
    const live = kind === 'perp' ? cat.perp : cat.spot, sfx = kind === 'perp' ? '.P' : '';
    const have = (b) => !cat.live || live.has(b);
    let base = TOP.filter((c) => have(c.s));
    if (cat.live) { const known = new Set(TOP.map((c) => c.s)); const extra = [...live].filter((b) => !known.has(b) && !STABLE.has(b) && !/(UP|DOWN|BULL|BEAR)$/.test(b)).sort().map((b) => ({ s: b, n: b })); base = base.slice(0, 100).concat(q ? extra : []); }
    else base = base.slice(0, 100);
    if (q) {
      const score = (c) => { const t = c.s.toLowerCase(), n = c.n.toLowerCase(); return t === q ? 0 : t.startsWith(q) ? 1 : n.startsWith(q) ? 2 : n.split(/[\s.]/).some((w) => w.startsWith(q)) ? 3 : t.includes(q) || n.includes(q) ? 4 : 9; };
      base = base.map((c) => [score(c), c]).filter(([k]) => k < 9).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    }
    return base.slice(0, q ? 80 : 100).map((c) => meta(c.s + sfx));
  }

  async function loadCatalog() {
    const KEY = 'bcn_cat'; let c = null;
    try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* yok */ }
    if (c && Date.now() - c.at < 12 * 3600000 && c.spot.length) { cat.spot = new Set(c.spot); cat.perp = new Set(c.perp); cat.live = true; cat.ready = true; return cat; }
    const grab = async (hosts, path) => {
      for (const h of hosts) {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
        try { const r = await fetch(h + path, { signal: ctl.signal }); clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); if (Array.isArray(j)) return j; } catch (e) { clearTimeout(to); }
      }
      return null;
    };
    const bases = (rows) => rows ? rows.map((x) => x.symbol).filter((x) => /^[A-Z0-9]+USDT$/.test(x)).map((x) => x.slice(0, -4)) : null;
    const [sp, pp] = await Promise.all([grab(HOSTS, '/api/v3/ticker/price'), grab(FAPI, '/fapi/v1/ticker/price')]);
    const s = bases(sp), p = bases(pp);
    if (s && s.length) { cat.spot = new Set(s); cat.live = true; }
    if (p && p.length) cat.perp = new Set(p); else if (s) cat.perp = new Set(TOP.map((c) => c.s).filter((b) => b !== 'GRAM'));
    cat.ready = true;
    if (cat.live) { try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), spot: [...cat.spot], perp: [...cat.perp] })); } catch (e) { /* yok */ } }
    return cat;
  }

  /* ——— endeksler (sunucu, günlük) ——— */
  const apiBase = () => ((root.BEACON_CONFIG && root.BEACON_CONFIG.apiUrl) || '').replace(/\/$/, '');
  function weekly(c) {
    const D7 = 7 * 86400000, out = [];
    for (const k of c) {
      const w = k.t - (((Math.floor(k.t / 86400000) + 3) % 7) * 86400000); // Pazartesi 00:00 UTC
      const l = out[out.length - 1];
      if (l && l.t === w) { l.h = Math.max(l.h, k.h); l.l = Math.min(l.l, k.l); l.c = k.c; } else out.push({ t: w, o: k.o, h: k.h, l: k.l, c: k.c, v: 0 });
    }
    void D7; return out;
  }
  async function fetchIndex(sym, tf) {
    if (tf !== '1d' && tf !== '1w') throw new Error('Bu endeks yalnızca günlük ve haftalık gösterilir');
    if (!apiBase()) throw new Error('Endeksler için sunucu adresi gerekli');
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(`${apiBase()}/api/index/${sym.slice(1)}`, { signal: ctl.signal }); clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.ready) throw new Error('Endeks verisi hazırlanıyor, birkaç dakika sonra deneyin');
      const c = parse(j.rows); return tf === '1w' ? weekly(c) : c;
    } catch (e) { clearTimeout(to); throw e; }
  }

  /* spot ve perpetual için adres */
  function route(sym) { const k = kindOf(sym); return k === 'perp' ? { hosts: FAPI, path: '/fapi/v1/klines', base: baseOf(sym) } : { hosts: HOSTS, path: '/api/v3/klines', base: sym }; }
  const cache = new Map(); // "BTC|1h" -> { candles, at }
  let hostIdx = 0;

  function parse(rows) {
    return rows.map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
      .filter((k) => Number.isFinite(k.c) && k.h >= k.l);
  }

  /* ——— Özel zaman dilimleri: kimlik "c<n><birim>" (m dakika, h saat, d gün, w hafta, M ay). Binance'te yoksa temel mumlardan birleştirilir. ——— */
  const NATIVE = { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5, '6h': 216e5, '8h': 288e5, '12h': 432e5, '1d': 864e5, '3d': 2592e5, '1w': 6048e5, '1M': 2592e6 };
  const UNIT_MS = { m: 6e4, h: 36e5, d: 864e5, w: 6048e5, M: 2592e6 }, UNIT_TR = { m: 'd', h: 's', d: 'G', w: 'H', M: 'A' };
  const RANGE = { m: [1, 720], h: [1, 72], d: [2, 60], w: [2, 26], M: [1, 24] };
  const CTF_MAX = 8;
  const specCache = new Map();
  function parseTf(id) {
    if (specCache.has(id)) return specCache.get(id);
    let r = null; const m = /^c(\d{1,3})([mhdwM])$/.exec(String(id));
    if (m) {
      const n = +m[1], u = m[2], [lo, hi] = RANGE[u];
      const ms = n * UNIT_MS[u], std = TFS.some((t) => NATIVE[t] === ms);
      if (n >= lo && n <= hi && !std) {
        r = { id, n, u, ms, label: n + UNIT_TR[u], native: null, base: null, k: 1 };
        const nat = Object.keys(NATIVE).find((x) => NATIVE[x] === ms && (u === 'M' ? x === '1M' : x !== '1M'));
        if (nat) r.native = nat;
        else if (u === 'M') { r.base = '1M'; r.k = n; }
        else if (u === 'w') { r.base = '1w'; r.k = n; }
        else if (u === 'd') { r.base = '1d'; r.k = n; }
        else {
          const cands = Object.keys(NATIVE).filter((x) => NATIVE[x] < (u === 'h' ? 864e5 : 36e5) && ms % NATIVE[x] === 0).sort((a, b) => NATIVE[b] - NATIVE[a]);
          if (cands.length) { r.base = cands[0]; r.k = ms / NATIVE[cands[0]]; } else r = null;
        }
      }
    }
    specCache.set(id, r); return r;
  }
  const isCustomTf = (id) => typeof id === 'string' && id[0] === 'c' && !!parseTf(id);
  const apiTf = (tf) => { const p = isCustomTf(tf) ? parseTf(tf) : null; return p ? p.native || p.base : tf; };
  const monthEnd = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
  /** Temel mumları n'li gruplara birleştirir. Gruplar sabit bir takvime oturur (geçmiş mumlar yarın değişmez). */
  function aggregate(base, spec) {
    const out = []; const wk = 6048e5, off = 4 * 864e5;
    const keyOf = (t) => {
      if (spec.u === 'M') { const d = new Date(t); return Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / spec.n); }
      if (spec.u === 'w') return Math.floor((t - off) / (spec.n * wk));
      return Math.floor(t / spec.ms);
    };
    const startOf = (key) => (spec.u === 'M' ? Date.UTC(Math.floor((key * spec.n) / 12), (key * spec.n) % 12, 1) : spec.u === 'w' ? key * spec.n * wk + off : key * spec.ms);
    const endOf = (key) => (spec.u === 'M' ? Date.UTC(Math.floor(((key + 1) * spec.n) / 12), ((key + 1) * spec.n) % 12, 1) : startOf(key) + (spec.u === 'w' ? spec.n * wk : spec.ms));
    let cur = null, ck = null;
    for (const k of base) {
      const key = keyOf(k.t);
      if (key !== ck) { if (cur) out.push(cur); ck = key; cur = { t: startOf(key), o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, e: endOf(key), _first: k.t }; }
      else { if (k.h > cur.h) cur.h = k.h; if (k.l < cur.l) cur.l = k.l; cur.c = k.c; cur.v += k.v; }
    }
    if (cur) out.push(cur);
    if (out.length > 1 && out[0]._first > out[0].t + 1) out.shift(); // başlangıçta eksik kalan ilk grup
    for (const k of out) delete k._first;
    return out;
  }
  const withEnd = (arr, spec) => { if (spec.u === 'M') for (const k of arr) k.e = monthEnd(k.t); return arr; };
  async function loadCustom(sym, tf, fresh) {
    const spec = parseTf(tf);
    if (spec.native) { const c = await fetchKlines(sym, spec.native, 1000); return withEnd(c, spec); }
    const pages = Math.max(1, Math.min(6, Math.ceil((700 * spec.k) / 1000)));
    let base = await loadLong(sym, spec.base, pages);
    if (fresh !== false) { try { const tail = await fetchKlines(sym, spec.base, 5); base = base.slice(); for (const k of tail) { const l = base[base.length - 1]; if (k.t === l.t) base[base.length - 1] = k; else if (k.t > l.t) base.push(k); } } catch (e) { /* önbellekteki yeterli */ } }
    return aggregate(base, spec);
  }

  async function fetchKlines(sym, tf, limit) {
    if (kindOf(sym) === 'index') return fetchIndex(sym, tf);
    const R = route(sym); let lastErr;
    for (let a = 0; a < R.hosts.length; a++) {
      const host = R.hosts[(hostIdx + a) % R.hosts.length];
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(`${host}${R.path}?symbol=${R.base}USDT&interval=${apiTf(tf)}&limit=${limit}`, { signal: ctl.signal });
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows.length) throw new Error('boş yanıt');
        if (R.hosts === HOSTS) hostIdx = (hostIdx + a) % HOSTS.length;
        return parse(rows);
      } catch (e) { clearTimeout(to); lastErr = e; }
    }
    throw lastErr || new Error('ulaşılamadı');
  }

  /** Tam geçmiş (1000 mum). Önbellekteyse ve taze ise onu döndürür. */
  async function load(sym, tf, maxAgeMs = 0) {
    const key = sym + '|' + tf, c = cache.get(key);
    if (c && Date.now() - c.at < maxAgeMs) return c.candles;
    const candles = isCustomTf(tf) ? await loadCustom(sym, tf) : await fetchKlines(sym, tf, 1000);
    cache.set(key, { candles, at: Date.now() });
    return candles;
  }

  /** Uzun geçmiş: geriye doğru sayfalayarak (1000'er) en fazla `pages` sayfa. Piyasa göstergeleri için. */
  async function loadLong(sym, tf, pages = 5) {
    const key = sym + '|' + tf + '|long', c = cache.get(key);
    if (c && Date.now() - c.at < 6 * 3600000) return c.candles;
    if (kindOf(sym) === 'index') { const x = await fetchIndex(sym, tf); cache.set(key, { candles: x, at: Date.now() }); return x; }
    const R = route(sym); let out = [], end = '';
    for (let p = 0; p < pages; p++) {
      let rows = null, err;
      for (let a = 0; a < R.hosts.length && !rows; a++) {
        const host = R.hosts[(hostIdx + a) % R.hosts.length], ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
        try {
          const r = await fetch(`${host}${R.path}?symbol=${R.base}USDT&interval=${tf}&limit=1000${end}`, { signal: ctl.signal });
          clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status);
          rows = await r.json();
        } catch (e) { clearTimeout(to); err = e; }
      }
      if (!rows) { if (!out.length) throw err || new Error('ulaşılamadı'); break; }
      if (!rows.length) break;
      const part = parse(rows); out = part.concat(out);
      if (rows.length < 1000) break;
      end = '&endTime=' + (part[0].t - 1);
    }
    cache.set(key, { candles: out, at: Date.now() });
    return out;
  }

  /** Yalnızca son birkaç mumu çekip önbelleğe birleştirir. */
  async function refresh(sym, tf) {
    const key = sym + '|' + tf, c = cache.get(key);
    if (!c) return load(sym, tf);
    if (kindOf(sym) === 'index') { if (Date.now() - c.at < 300000) return c.candles; return load(sym, tf); }
    if (isCustomTf(tf)) { const cc = await loadCustom(sym, tf); cache.set(key, { candles: cc, at: Date.now() }); return cc; }
    const fresh = await fetchKlines(sym, tf, 4);
    const arr = c.candles.slice();
    for (const k of fresh) {
      const last = arr[arr.length - 1];
      if (k.t === last.t) arr[arr.length - 1] = k;
      else if (k.t > last.t) arr.push(k);
    }
    const out = arr.length > 1100 ? arr.slice(arr.length - 1000) : arr;
    cache.set(key, { candles: out, at: Date.now() });
    return out;
  }

  /** Eşzamanlılık sınırlı toplu yükleme (tarayıcı için). */
  async function loadMany(jobs, onItem, conc = 4) {
    let k = 0;
    const worker = async () => {
      while (k < jobs.length) {
        const j = jobs[k++];
        try { onItem(j, await load(j.sym, j.tf, 60000), null); } catch (e) { onItem(j, null, e); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, worker));
  }

  /** Son kapanmış mum sayısı: son mum henüz oluşuyorsa hariç tutulur. */
  function closedCount(candles, tfMs, now = Date.now()) {
    const n = candles.length;
    const l = candles[n - 1]; return (l.e || l.t + tfMs) > now ? n - 1 : n;
  }

  root.BeaconData = { indexesOn: () => INDEX_ON, COINS, TOP, INDEXES, meta, label, list, tfsFor, kindOf, parseTf, isCustomTf, aggregate, CTF_MAX, UNIT_TR, RANGE, loadCatalog, catalog: cat, weekly, TFS, load, loadLong, refresh, loadMany, closedCount, _cache: cache };
})(typeof self !== 'undefined' ? self : this);
