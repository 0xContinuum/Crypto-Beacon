// Faz 2 veri katmanı. Çalıştırma: node tests/faz2.test.js
const assert = require('assert');
global.self = global; global.Beacon = require('../web/js/engine.js');
const store = {}; global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.BEACON_CONFIG = { apiUrl: 'https://api.test' };
require('../web/js/data.js'); const D = global.BeaconData, B = global.Beacon;
let pass = 0; const ok = (c, m) => { assert(c, 'BAŞARISIZ: ' + m); pass++; console.log('PASS ' + m); };
const urls = [];
const DAY = 86400000, T0 = Date.UTC(2025, 0, 1);
const idxRows = Array.from({ length: 300 }, (_, i) => { const v = 58 + 6 * Math.sin(i / 20); return [T0 + i * DAY, v - 0.2, v + 0.5, v - 0.5, v, 0]; });
global.fetch = async (url) => {
  urls.push(url);
  if (/fapi\/v1\/ticker\/price/.test(url)) return { ok: true, json: async () => [{ symbol: 'BTCUSDT' }, { symbol: 'PEPEUSDT' }, { symbol: '1000PEPEUSDT' }, { symbol: 'BTCUSDT_250627' }, { symbol: 'ETHUSDT' }] };
  if (/api\/v3\/ticker\/price/.test(url)) return { ok: true, json: async () => [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }, { symbol: 'SOLUSDT' }, { symbol: 'PEPEUSDT' }, { symbol: 'USDCUSDT' }, { symbol: 'XYZUSDT' }, { symbol: 'BTCUPUSDT' }, { symbol: 'ETHBTC' }] };
  if (/api\.test\/api\/index\/BTCD/.test(url)) return { ok: true, json: async () => ({ ready: true, rows: idxRows }) };
  if (/api\.test\/api\/index\/TOTAL3/.test(url)) return { ok: true, json: async () => ({ ready: false, rows: [] }) };
  if (/klines/.test(url)) return { ok: true, json: async () => Array.from({ length: 5 }, (_, i) => [T0 + i * 3600000, '1', '2', '0.5', '1.5', '10']) };
  return { ok: false, status: 404, json: async () => ({}) };
};

(async () => {
  /* meta ve etiketler */
  ok(D.meta('BTC').kind === 'spot' && D.meta('BTC.P').kind === 'perp' && D.meta('BTC.P').base === 'BTC' && D.meta('$BTCD').kind === 'index', 'sembol türleri doğru ayrışır');
  ok(D.label('BTC') === 'BTC/USDT' && D.label('BTC.P') === 'BTCUSDT.P' && D.label('$BTCD') === 'BTC.D' && D.label('$USDTD') === 'USDT.D' && D.label('$TOTAL2') === 'TOTAL2', 'etiketler');
  ok(D.meta('BTC').free && D.meta('BTC.P').free && D.meta('$TOTAL').free && D.meta('$BTCD').free && !D.meta('LINK').free && !D.meta('ETH.P').free && !D.meta('$USDTD').free, 'ücretsiz/Pro ayrımı');
  ok(D.tfsFor('$BTCD').join() === '1d,1w' && D.tfsFor('BTC').length === 5, 'endeks yalnızca 1g/1h');

  /* listeler ve arama (canlı liste yokken statik ilk 100) */
  ok(D.list('spot').length === 100 && D.list('perp').length === 100 && D.list('index').length === 5, 'ilk 100 spot, 100 perpetual, 5 endeks');
  ok(D.list('perp')[0].s === 'BTC.P', 'perpetual kimlikleri .P ile biter');
  ok(D.list('spot', 'solana')[0].s === 'SOL' && D.list('spot', 'sol')[0].s === 'SOL', 'isimle ve sembolle arama');
  ok(D.list('spot', 'bitcoin').map((c) => c.s).slice(0, 2).join() === 'BTC,BCH', 'arama sıralaması: tam eşleşme önde');
  ok(D.list('index', 'dominans').map((c) => c.s).join() === '$BTCD,$USDTD' && D.list('index', 'total').length === 3, 'endekslerde arama');
  ok(D.list('spot', 'zzzz').length === 0, 'eşleşme yoksa boş');

  /* canlı katalog */
  await D.loadCatalog();
  ok(D.catalog.live && D.catalog.spot.has('SOL') && !D.catalog.spot.has('BTCUSDT'), 'canlı katalog taban adlarını alır');
  ok(D.list('spot').every((c) => D.catalog.spot.has(c.s)) && D.list('spot').length < 100, 'canlı listede olmayan coin görünmez');
  ok(D.list('spot', 'xyz').map((c) => c.s).join() === 'XYZ', 'ilk 100 dışındaki canlı pariteler aramada bulunur');
  ok(D.list('spot', 'usdc').length === 0 && D.list('spot', 'btcup').length === 0, 'stabil ve kaldıraçlı tokenlar listelenmez');
  ok(D.list('perp', 'pepe').map((c) => c.s).includes('1000PEPE.P') && !D.list('perp', 'btc').some((c) => /_/.test(c.s)), 'perpetual: 1000x kontratlar bulunur, vadeli kontratlar elenir');
  const before = urls.length; D.catalog.ready = false; await D.loadCatalog(); ok(urls.length === before, 'katalog 12 saat önbellekten gelir');

  /* perpetual ve endeks verisi */
  await D.load('BTC.P', '1h'); ok(urls.some((u) => u.startsWith('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&')), 'perpetual mumları fapi adresinden çekilir');
  await D.load('1000PEPE.P', '4h'); ok(urls.some((u) => u.includes('symbol=1000PEPEUSDT&')), '1000PEPE.P doğru sembole çevrilir');
  const d = await D.load('$BTCD', '1d'); ok(d.length === 300 && d[0].v === 0 && d[5].h >= d[5].l, 'endeks günlük mumları sunucudan gelir');
  const w = await D.load('$BTCD', '1w'); ok(w.length > 40 && w.length < 50 && w.every((k) => new Date(k.t).getUTCDay() === 1), 'haftalık endeks mumları pazartesi başlar');
  let e; try { await D.load('$BTCD', '1h'); } catch (x) { e = x; } ok(e && /günlük/.test(e.message), 'endekste gün içi zaman dilimi reddedilir');
  e = null; try { await D.load('$TOTAL3', '1d'); } catch (x) { e = x; } ok(e && /hazırlanıyor/.test(e.message), 'sunucu hazır değilse anlaşılır mesaj');
  const n = urls.length; await D.refresh('$BTCD', '1d'); ok(urls.length === n, 'endeks yenilemesi 5 dk içinde yeniden çağırmaz');

  /* motor, hacmi olmayan endeks mumlarıyla çalışır */
  const a = B.analyze(d), sc = a.score[a.score.length - 1]; ok(Number.isFinite(sc) && Math.abs(sc) <= 100, 'skor motoru endeks verisinde sonlu skor üretir (' + Math.round(sc) + ')');
  console.log(`\nTÜM FAZ 2 VERİ TESTLERİ GEÇTİ (${pass})`);
})().catch((e) => { console.error(e); process.exit(1); });
