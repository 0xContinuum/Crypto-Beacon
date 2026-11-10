// Sahte Binance mum verisi (testler ve tanıtım videosu için, tamamen sentetik)
const MS = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 };
const BASE = { BTC: 67000, ETH: 3400, SOL: 160, BNB: 590, XRP: 0.55, ADA: 0.45, DOGE: 0.16, AVAX: 36, LINK: 15, GRAM: 6.5 };

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }
function series(sym, tf, n) {
  const ms = MS[tf], now = Date.now(), last = Math.floor(now / ms) * ms;
  const seed = [...sym + tf].reduce((a, c) => a * 31 + c.charCodeAt(0), 7), r = rng(seed);
  let p = BASE[sym] || 100, drift = 0; const out = [];
  for (let i = 0; i < n; i++) {
    if (i % 180 === 0) drift = [-0.0012, 0.0016, 0, 0.0009, -0.0007][Math.floor(r() * 5)];
    const vol = 0.005 + 0.004 * r(), ret = drift + vol * gauss(r), o = p, c = p * (1 + ret);
    out.push([last - (n - 1 - i) * ms, o, Math.max(o, c) * (1 + Math.abs(gauss(r)) * 0.002), Math.min(o, c) * (1 - Math.abs(gauss(r)) * 0.002), c, 1000 * (1 + r()) * (1 + 3 * Math.abs(ret) / vol)]);
    p = c;
  }
  return out.map((k) => k.map(String));
}

function klinesRoute(page, perTf) {
  return page.route(/api\/v3\/klines/, (r) => {
    const u = new URL(r.request().url()), sym = u.searchParams.get('symbol').replace('USDT', ''), tf = u.searchParams.get('interval'), lim = +u.searchParams.get('limit');
    const end = u.searchParams.get('endTime');
    let rows = series(sym, tf, tf === '1d' ? 4000 : Math.max(lim, 1000));
    if (end) rows = rows.filter((k) => +k[0] <= +end);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows.slice(-lim)) });
  });
}
module.exports = { series, klinesRoute, MS, BASE };
