"""Beacon motorunun bağımsız Python referansı.
JS motorundan ayrı yazıldı; aynı sentetik seriyi işleyip çıktıyı ref_out.json'a yazar.
tests/engine.test.js iki sonucu karşılaştırır. Kullanım: python3 tests/ref.py
"""
import json, math, os, random

NAN = float("nan")
fin = lambda x: x is not None and not math.isnan(x) and not math.isinf(x)

# ---- sentetik seri (rejim değiştiren rastgele yürüyüş) ----
def make_candles(n=1500, seed=7):
    rnd = random.Random(seed)
    price, out, drift = 100.0, [], 0.0
    for i in range(n):
        if i % 250 == 0:
            drift = rnd.choice([-0.0015, 0.0, 0.002, 0.0008, -0.0008])
        vol = 0.006 + 0.004 * rnd.random()
        ret = drift + vol * rnd.gauss(0, 1)
        o, c = price, price * (1 + ret)
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.002)))
        l = min(o, c) * (1 - abs(rnd.gauss(0, 0.002)))
        v = 1000 * (1 + rnd.random()) * (1 + 3 * abs(ret) / vol)
        out.append(dict(t=1700000000000 + i * 3600000, o=o, h=h, l=l, c=c, v=v))
        price = c
    return out

# ---- göstergeler ----
def ema(x, n):
    res = [NAN] * len(x)
    s = next((i for i, v in enumerate(x) if fin(v)), None)
    if s is None or len(x) - s < n:
        return res
    k = 2.0 / (n + 1)
    res[s + n - 1] = sum(x[s:s + n]) / n
    for i in range(s + n, len(x)):
        res[i] = res[i - 1] + k * (x[i] - res[i - 1])
    return res

def wilder(x, n):
    res = [NAN] * len(x)
    s = next((i for i, v in enumerate(x) if fin(v)), None)
    if s is None or len(x) - s < n:
        return res
    res[s + n - 1] = sum(x[s:s + n]) / n
    for i in range(s + n, len(x)):
        res[i] = res[i - 1] + (x[i] - res[i - 1]) / n
    return res

def rsi(c, n=14):
    res = [NAN] * len(c)
    gains = [max(c[i] - c[i - 1], 0.0) for i in range(1, len(c))]
    losses = [max(c[i - 1] - c[i], 0.0) for i in range(1, len(c))]
    ag, al = sum(gains[:n]) / n, sum(losses[:n]) / n
    def f(g, l):
        if l == 0:
            return 50.0 if g == 0 else 100.0
        return 100.0 - 100.0 / (1.0 + g / l)
    res[n] = f(ag, al)
    for i in range(n, len(gains)):
        ag = (ag * (n - 1) + gains[i]) / n
        al = (al * (n - 1) + losses[i]) / n
        res[i + 1] = f(ag, al)
    return res

def tr_series(h, l, c):
    return [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, len(c))]

def atr(h, l, c, n=14):
    return wilder(tr_series(h, l, c), n)

def adx(h, l, c, n=14):
    L = len(c)
    res = [NAN] * L
    tr = tr_series(h, l, c)
    pdm = [0.0] * L
    mdm = [0.0] * L
    for i in range(1, L):
        up, dn = h[i] - h[i - 1], l[i - 1] - l[i]
        if up > dn and up > 0: pdm[i] = up
        if dn > up and dn > 0: mdm[i] = dn
    T, P, M = sum(tr[1:n + 1]), sum(pdm[1:n + 1]), sum(mdm[1:n + 1])
    dx = {}
    def dxv(T, P, M):
        a, b = 100 * P / T, 100 * M / T
        return 0.0 if a + b == 0 else 100 * abs(a - b) / (a + b)
    dx[n] = dxv(T, P, M)
    for i in range(n + 1, L):
        T = T - T / n + tr[i]; P = P - P / n + pdm[i]; M = M - M / n + mdm[i]
        dx[i] = dxv(T, P, M)
    cur = sum(dx[i] for i in range(n, 2 * n)) / n
    res[2 * n - 1] = cur
    for i in range(2 * n, L):
        cur = (cur * (n - 1) + dx[i]) / n
        res[i] = cur
    return res

def macd_hist(c):
    a, b = ema(c, 12), ema(c, 26)
    line = [x - y if fin(x) and fin(y) else NAN for x, y in zip(a, b)]
    sig = ema(line, 9)
    return [x - y if fin(x) and fin(y) else NAN for x, y in zip(line, sig)]

def bollinger(c, n=20, k=2.0):
    up, lo, w = [NAN] * len(c), [NAN] * len(c), [NAN] * len(c)
    for i in range(n - 1, len(c)):
        win = c[i - n + 1:i + 1]
        m = sum(win) / n
        sd = math.sqrt(sum((x - m) ** 2 for x in win) / n)
        up[i], lo[i], w[i] = m + k * sd, m - k * sd, 2 * k * sd / m
    return up, lo, w

def cmf(h, l, c, v, n=20):
    res = [NAN] * len(c)
    mf = []
    for i in range(len(c)):
        rng = h[i] - l[i]
        mf.append(0.0 if rng == 0 else (2 * c[i] - l[i] - h[i]) / rng * v[i])
    for i in range(n - 1, len(c)):
        tv = sum(v[i - n + 1:i + 1])
        res[i] = 0.0 if tv == 0 else sum(mf[i - n + 1:i + 1]) / tv
    return res

# ---- skor ----
WARM = 210
clip = lambda x, a=-1.0, b=1.0: min(b, max(a, x))

def analyze(cd):
    o = [x["o"] for x in cd]; h = [x["h"] for x in cd]; l = [x["l"] for x in cd]
    c = [x["c"] for x in cd]; v = [x["v"] for x in cd]
    n = len(cd)
    e20, e50, e200 = ema(c, 20), ema(c, 50), ema(c, 200)
    rs, at, ad, mh = rsi(c), atr(h, l, c), adx(h, l, c), macd_hist(c)
    bu, bl, bw = bollinger(c)
    cm = cmf(h, l, c, v)
    score = [NAN] * n
    for i in range(WARM, n):
        w20h = max(h[i - 19:i + 1]); w20l = min(l[i - 19:i + 1])
        p20h = max(h[i - 20:i]);     p20l = min(l[i - 20:i])
        needed = [e20[i], e50[i], e200[i], e50[i - 10], rs[i], at[i], ad[i], mh[i], cm[i]]
        if not all(fin(x) for x in needed) or not at[i] > 0:
            continue
        align = ((1 if c[i] > e20[i] else -1) + (1 if e20[i] > e50[i] else -1) + (1 if e50[i] > e200[i] else -1)) / 3
        T = 0.6 * align + 0.4 * math.tanh((e50[i] - e50[i - 10]) / (3 * at[i]))
        M = 0.5 * math.tanh(mh[i] / (0.25 * at[i])) + 0.5 * clip((rs[i] - 50) / 25)
        V = clip(cm[i] * 2.5)
        pos = (c[i] - w20l) / (w20h - w20l) if w20h > w20l else 0.5
        brk = 1 if c[i] > p20h else (-1 if c[i] < p20l else 0)
        K = 0.5 * (pos - 0.5) * 2 + 0.5 * brk
        score[i] = 100 * clip(0.35 * T + 0.25 * M + 0.20 * V + 0.20 * K)
    return dict(e20=e20, e50=e50, e200=e200, rsi=rs, atr=at, adx=ad, mh=mh, bu=bu, bl=bl, cmf=cm, score=score,
                c=c)

# ---- tetik ve simülasyon ----
TF = {"atrMult": 1.6, "maxBars": 72}   # test 1s zaman dilimiyle yapılır
def signals(a, cd):
    out, last = [], -10 ** 9
    for i in range(WARM + 1, len(cd)):
        s, p = a["score"][i], a["score"][i - 1]
        if not (fin(s) and fin(p)) or i - last < 6:
            continue
        side = None
        if s >= 40 > p and a["c"][i] > a["e50"][i] and a["adx"][i] >= 18: side = "long"
        elif s <= -40 < p and a["c"][i] < a["e50"][i] and a["adx"][i] >= 18: side = "short"
        if side:
            last = i
            out.append(dict(i=i, side=side, atr=a["atr"][i]))
    return out

def trade(cd, sg, fee=0.001, slip=0.0005):
    j = sg["i"] + 1
    if j >= len(cd): return None
    d = 1 if sg["side"] == "long" else -1
    entry = cd[j]["o"]; risk = TF["atrMult"] * sg["atr"]
    stop = entry - d * risk; tp1 = entry + d * 1.5 * risk; tp2 = entry + d * 3 * risk
    R, rem, half = 0.0, 1.0, False
    exit_, ex = None, None
    for k in range(j, min(len(cd) - 1, j + TF["maxBars"]) + 1):
        hi, lo = cd[k]["h"], cd[k]["l"]
        touched_stop = (lo <= stop) if d == 1 else (hi >= stop)
        if not half:
            if touched_stop: R -= rem; exit_, ex = "SL", k; break
            if (hi >= tp1) if d == 1 else (lo <= tp1):
                R += 0.75; rem = 0.5; half = True; stop = entry
        else:
            if touched_stop: exit_, ex = "BE", k; break
            if (hi >= tp2) if d == 1 else (lo <= tp2):
                R += rem * 3; exit_, ex = "TP2", k; break
        if k == j + TF["maxBars"]:
            R += rem * d * (cd[k]["c"] - entry) / risk; exit_, ex = "TIME", k; break
    if exit_ is None: return dict(side=sg["side"], i=sg["i"], j=j, status="open")
    cost = (2 * fee + 2 * slip) * entry / risk
    return dict(side=sg["side"], i=sg["i"], j=j, exit=exit_, exitIdx=ex, R=R - cost, entry=entry, status="closed")

def backtest(cd, sgs):
    trades, last_exit = [], -1
    for s in sgs:
        if s["i"] < last_exit: continue
        t = trade(cd, s)
        if t is None: continue
        trades.append(t); last_exit = t.get("exitIdx", len(cd) - 1)
    return trades

def nz(a): return [None if not fin(x) else x for x in a]

if __name__ == "__main__":
    cd = make_candles()
    a = analyze(cd)
    sg = signals(a, cd)
    tr = backtest(cd, sg)
    closed = [t for t in tr if t["status"] == "closed"]
    out = dict(candles=cd,
               arrays={k: nz(a[k]) for k in ["e20", "e50", "e200", "rsi", "atr", "adx", "mh", "bu", "bl", "cmf", "score"]},
               signals=sg, trades=tr,
               stats=dict(n=len(closed), sumR=sum(t["R"] for t in closed)))
    path = os.path.join(os.path.dirname(__file__), "ref_out.json")
    json.dump(out, open(path, "w"))
    print("mum:", len(cd), "| tetik:", len(sg), "| işlem:", len(tr), "| kapanan:", len(closed), "| toplam R: %.4f" % out["stats"]["sumR"])
