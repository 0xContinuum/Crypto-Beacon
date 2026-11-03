/*  Beacon veri katmanı: Binance herkese açık mum verisi (anahtarsız, yalnızca okuma).
 *  Sunucu yok; tarayıcı doğrudan çağırır. Birinci uç noktaya ulaşılamazsa yedeğe geçer.
 */
(function (root) {
  'use strict';
  const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
  const COINS = [
    { s: 'BTC', n: 'Bitcoin', free: true }, { s: 'ETH', n: 'Ethereum', free: true }, { s: 'SOL', n: 'Solana', free: true },
    { s: 'BNB', n: 'BNB' }, { s: 'XRP', n: 'XRP' }, { s: 'ADA', n: 'Cardano' }, { s: 'DOGE', n: 'Dogecoin' },
    { s: 'AVAX', n: 'Avalanche' }, { s: 'LINK', n: 'Chainlink' }, { s: 'TON', n: 'Toncoin' },
  ];
  const TFS = ['15m', '1h', '4h', '1d'];
  const cache = new Map(); // "BTC|1h" -> { candles, at }
  let hostIdx = 0;

  function parse(rows) {
    return rows.map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
      .filter((k) => Number.isFinite(k.c) && k.h >= k.l);
  }

  async function fetchKlines(sym, tf, limit) {
    let lastErr;
    for (let a = 0; a < HOSTS.length; a++) {
      const host = HOSTS[(hostIdx + a) % HOSTS.length];
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(`${host}/api/v3/klines?symbol=${sym}USDT&interval=${tf}&limit=${limit}`, { signal: ctl.signal });
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows.length) throw new Error('boş yanıt');
        hostIdx = (hostIdx + a) % HOSTS.length;
        return parse(rows);
      } catch (e) { clearTimeout(to); lastErr = e; }
    }
    throw lastErr || new Error('ulaşılamadı');
  }

  /** Tam geçmiş (1000 mum). Önbellekteyse ve taze ise onu döndürür. */
  async function load(sym, tf, maxAgeMs = 0) {
    const key = sym + '|' + tf, c = cache.get(key);
    if (c && Date.now() - c.at < maxAgeMs) return c.candles;
    const candles = await fetchKlines(sym, tf, 1000);
    cache.set(key, { candles, at: Date.now() });
    return candles;
  }

  /** Yalnızca son birkaç mumu çekip önbelleğe birleştirir. */
  async function refresh(sym, tf) {
    const key = sym + '|' + tf, c = cache.get(key);
    if (!c) return load(sym, tf);
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
    return candles[n - 1].t + tfMs > now ? n - 1 : n;
  }

  root.BeaconData = { COINS, TFS, load, refresh, loadMany, closedCount, _cache: cache };
})(typeof self !== 'undefined' ? self : this);
