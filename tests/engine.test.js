// Çalıştırma:  python3 tests/ref.py && node tests/engine.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const B = require('../web/js/engine.js');
const { indicators: I } = B;

let pass = 0;
const ok = (cond, msg) => { assert(cond, 'BAŞARISIZ: ' + msg); pass++; console.log('PASS ' + msg); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/* 1) El hesabı: EMA */
{
  const c = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39];
  const e = I.ema(c, 10);
  ok(isNaN(e[8]) && near(e[9], 22.221), 'EMA ilk değer = ilk 10 mumun ortalaması');
  ok(near(e[10], 22.15 * (2 / 11) + 22.221 * (9 / 11)), 'EMA özyineleme formülü');
}

/* 2) Bilinen değerler: Wilder RSI(14) örnek veri seti */
{
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    46.00, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];
  const expect = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77];
  const r = I.rsi(c, 14);
  // İlk değer ham veriden elle: 14 değişimin kazançlar toplamı 3.34, kayıplar toplamı 1.40
  ok(near(r[14], 100 - 100 / (1 + 3.34 / 1.40), 1e-9), 'RSI ilk değer elle hesapla aynı (70.464)');
  // Yayımlanan tablodaki değerler iki ondalığa yuvarlanmış ara ortalamalarla hesaplanmış olabilir; bu yüzden 0.1 içinde
  // uyum arıyoruz. Asıl kesin kanıtlar: yukarıdaki elle hesap ve aşağıdaki bağımsız Python karşılaştırması.
  const err = expect.map((e, k) => Math.abs(r[14 + k] - e));
  ok(Math.max(...err) < 0.1, 'RSI(14) yayımlanmış örnek değerlerle 0.1 içinde (en büyük sapma ' + Math.max(...err).toFixed(3) + ')');
}

/* 3) ATR / True Range el hesabı */
{
  const h = [10, 12, 13], l = [8, 9, 11], c = [9, 11, 12];
  const tr = I.trueRange(h, l, c);
  ok(tr[0] === 2 && tr[1] === 3 && tr[2] === 2, 'True Range (gap dahil)');
}

/* 4) Bağımsız Python referansıyla çapraz doğrulama */
const refPath = path.join(__dirname, 'ref_out.json');
const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
const candles = ref.candles;
const a = B.analyze(candles);
{
  const map = { e20: 'ema20', e50: 'ema50', e200: 'ema200', rsi: 'rsi', atr: 'atr', adx: 'adx', mh: 'macdHist', bu: 'bbUp', bl: 'bbLo', cmf: 'cmf', score: 'score' };
  for (const k in map) {
    let bad = 0, cmp = 0;
    ref.arrays[k].forEach((rv, i) => {
      const jv = a[map[k]][i];
      if (rv === null) { if (Number.isFinite(jv) && k !== 'score') bad++; return; }
      cmp++;
      if (!near(jv, rv, 1e-8)) bad++;
    });
    ok(bad === 0 && cmp > 1000, `${map[k]}: JS = Python (${cmp} değer)`);
  }
  const sigs = B.findSignals(a, candles);
  ok(sigs.length === ref.signals.length && sigs.every((s, k) => s.i === ref.signals[k].i && s.side === ref.signals[k].side),
    `tetikler aynı (${sigs.length} adet)`);
  ok(sigs.length >= 5, 'sentetik seride yeterli tetik var (test anlamlı)');
  const sim = B.simulate(candles, sigs, '1h');
  ok(sim.trades.length === ref.trades.length, `işlem sayısı aynı (${sim.trades.length})`);
  let tbad = 0;
  sim.trades.forEach((t, k) => {
    const r = ref.trades[k];
    if (t.side !== r.side || t.i !== r.i || t.j !== r.j || t.status !== r.status) tbad++;
    else if (t.status === 'closed' && (t.exit !== r.exit || t.exitIdx !== r.exitIdx || !near(t.R, r.R, 1e-9))) tbad++;
  });
  ok(tbad === 0, 'işlem çıkışları ve R değerleri birebir aynı');
  ok(near(sim.stats.sumR, ref.stats.sumR, 1e-9), `toplam R aynı (${sim.stats.sumR.toFixed(4)})`);
  ok(new Set(sim.trades.map((t) => t.exit)).size >= 3, 'farklı çıkış türleri test edildi: ' + JSON.stringify(sim.stats.byExit));
}

/* 5) Look-ahead testi: geleceği değiştirmek geçmişi değiştirmemeli */
{
  const ks = [300, 555, 800, 1111, 1400];
  let bad = 0;
  for (const k of ks) {
    const part = B.analyze(candles.slice(0, k));
    for (const key of ['ema50', 'rsi', 'atr', 'adx', 'macdHist', 'cmf', 'score']) {
      for (let i = 0; i < k; i++) {
        const x = part[key][i], y = a[key][i];
        if (Number.isFinite(x) !== Number.isFinite(y) || (Number.isFinite(x) && !near(x, y, 1e-12))) bad++;
      }
    }
    const sp = B.findSignals(part, candles.slice(0, k)).map((s) => s.i + s.side);
    const sf = B.findSignals(a, candles).filter((s) => s.i < k).map((s) => s.i + s.side);
    if (JSON.stringify(sp) !== JSON.stringify(sf)) bad++;
  }
  ok(bad === 0, 'geleceği kesmek geçmiş değerleri ve tetikleri değiştirmiyor (look-ahead yok)');
  // gelecek mumları bozunca da aynı
  const tampered = candles.map((x, i) => (i >= 900 ? { ...x, o: x.o * 3, h: x.h * 3, l: x.l * 3, c: x.c * 3 } : x));
  const ta = B.analyze(tampered);
  let same = true;
  for (let i = 0; i < 900; i++) if (!(near(ta.score[i], a.score[i], 1e-12) || (isNaN(ta.score[i]) && isNaN(a.score[i])))) same = false;
  ok(same, 'sonraki 600 mumu değiştirmek ilk 900 mumun skorunu etkilemiyor');
}

/* 6) Tek işlem kuralları, el yapımı mumlarla (1s: atrMult 1.6, maxBars 72) */
{
  const K = (o, h, l, c) => ({ t: 0, o, h, l, c, v: 1 });
  const sig = (side = 'long') => ({ i: 0, side, atr: 10, px: 100 });
  const cost = (0.003 * 100) / 16; // (2*fee + 2*slip) * entry / risk, risk = 16
  const base = K(100, 100, 100, 100);

  let t = B.runTrade([base, K(100, 110, 95, 105), K(105, 125, 100, 120), K(120, 121, 99, 100)], sig(), '1h');
  ok(t.exit === 'BE' && near(t.gross, 0.75) && near(t.R, 0.75 - cost), 'TP1 sonrası stop girişe çekilir, BE çıkışı +0.75R');

  t = B.runTrade([base, K(100, 110, 95, 105), K(105, 125, 100, 120), K(120, 150, 105, 148)], sig(), '1h');
  ok(t.exit === 'TP2' && near(t.gross, 2.25) && near(t.R, 2.25 - cost), 'TP2 çıkışı toplam +2.25R');

  t = B.runTrade([base, K(100, 130, 80, 100)], sig(), '1h');
  ok(t.exit === 'SL' && near(t.gross, -1) && near(t.R, -1 - cost), 'aynı mumda stop ve hedef: stop önce sayılır (muhafazakâr)');

  const flat = [base]; for (let k = 0; k < 80; k++) flat.push(K(100, 101, 99, 100));
  t = B.runTrade(flat, sig(), '1h');
  ok(t.exit === 'TIME' && t.exitIdx === 1 + 72 && near(t.R, -cost), 'zaman stopu 72. mumda kapanıştan çıkar');

  t = B.runTrade([base, K(100, 105, 70, 80), K(80, 101, 79, 90)], sig('short'), '1h');
  ok(t.exit === 'BE' && near(t.gross, 0.75), 'short: TP1 sonrası stop girişe çekilir');

  t = B.runTrade([base], sig(), '1h');
  ok(t.status === 'pending', 'sonraki mum yoksa tetik "beklemede"');
  t = B.runTrade([base, K(100, 105, 95, 102)], sig(), '1h');
  ok(t.status === 'open' && near(t.R, (102 - 100) / 16), 'açık pozisyonun anlık R değeri hesaplanır');
}

/* 7) İstatistikler */
{
  const mk = (R, bars = 5) => ({ status: 'closed', R, bars, j: 0, exitIdx: 0, exit: R > 0 ? 'TP2' : 'SL' });
  const cs = Array.from({ length: 300 }, (_, i) => ({ c: 100 + i }));
  const s = B.stats([mk(2), mk(-1), mk(-1), mk(3), mk(-1)], cs);
  ok(s.n === 5 && near(s.winRate, 0.4) && near(s.sumR, 2) && near(s.avgR, 0.4), 'işlem sayısı, kazanma oranı, toplam ve ortalama R');
  ok(near(s.profitFactor, 5 / 3), 'profit factor = kazançlar / kayıplar');
  ok(near(s.maxDD, 2) && s.maxLossStreak === 2, 'en büyük düşüş ve art arda kayıp');
}

/* 8) Özellik testleri: yükselen/alçalan piyasada skorun işareti */
{
  const mkTrend = (dir) => Array.from({ length: 400 }, (_, i) => {
    const c = 100 * Math.exp(dir * 0.004 * i + 0.01 * Math.sin(i / 3)); const o = c / (1 + dir * 0.002);
    return { t: i, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 100 + (i % 7) };
  });
  const up = B.analyze(mkTrend(1)), dn = B.analyze(mkTrend(-1));
  ok(up.score[399] > 40 && dn.score[399] < -40, `istikrarlı trendde skor işareti doğru (↑ ${up.score[399].toFixed(0)}, ↓ ${dn.score[399].toFixed(0)})`);
  ok(B.verdict(70).key === 'bull2' && B.verdict(-30).key === 'bear1' && B.verdict(0).key === 'flat', 'skor etiketleri');
  ok(near(B.horizonScore({ '15m': 50, '1h': 20 }, 'short'), 0.4 * 50 + 0.6 * 20), 'vade skoru ağırlıklı ortalama');
}

console.log(`\nTÜM TESTLER GEÇTİ (${pass})`);
