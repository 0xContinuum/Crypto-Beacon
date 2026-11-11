"""Piyasa endeksleri: TOTAL, TOTAL2, TOTAL3, BTC.D, USDT.D.
CoinGecko'nun herkese açık verisinden, ilk 100 coinin günlük piyasa değeri toplanarak hesaplanır (yaklaşık 1 yıl, günlük).
Gerçek TOTAL tüm coinleri kapsar; burada ilk 100 toplamı kullanıldığı için TradingView'dan birkaç puan farklı çıkabilir."""
import json
import os
import threading
import time
import traceback
import urllib.request

BASE = "https://api.coingecko.com/api/v3"
DAY = 86400000
NAMES = {"TOTAL": "Toplam piyasa değeri (ilk 100)", "TOTAL2": "BTC hariç (ilk 100)", "TOTAL3": "BTC ve ETH hariç (ilk 100)", "BTCD": "BTC dominansı %", "USDTD": "USDT dominansı %"}
KEEP = {"bitcoin": "btc", "ethereum": "eth", "tether": "usdt"}


def http_get(url):
    h = {"accept": "application/json", "user-agent": "beacon/1.0"}
    k = os.environ.get("COINGECKO_KEY")
    if k:
        h["x-cg-demo-api-key"] = k
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=25) as r:
        return json.loads(r.read())


def daily(points):
    """[[ms, değer], ...] → {gün_başı_ms: son değer}"""
    o = {}
    for t, v in points:
        if v is None:
            continue
        o[int(t) // DAY * DAY] = float(v)
    return o


def compute(caps):
    """caps: {coin_id: [[ms, piyasa_değeri], ...]} → {ad: [[t, açılış, yüksek, düşük, kapanış, 0], ...]}"""
    series = {cid: daily(p) for cid, p in caps.items() if p}
    if "bitcoin" not in series:
        return {}
    days = sorted(series["bitcoin"])
    last = {}
    tot, btc, eth, usdt = [], [], [], []
    for d in days:
        s = 0.0
        for cid, ser in series.items():
            if d in ser:
                last[cid] = (d, ser[d])
            if cid in last and d - last[cid][0] <= 3 * DAY:  # en çok 3 günlük boşluk doldurulur
                s += last[cid][1]
        b = series["bitcoin"][d]
        e = last.get("ethereum", (0, 0))[1]
        u = last.get("tether", (0, 0))[1]
        if s <= 0:
            continue
        tot.append((d, s)); btc.append((d, b)); eth.append((d, e)); usdt.append((d, u))
    out = {}
    def mk(pairs):
        rows, prev = [], None
        for t, v in pairs:
            o = prev if prev is not None else v
            rows.append([t, o, max(o, v), min(o, v), v, 0]); prev = v
        return rows
    out["TOTAL"] = mk(tot)
    out["TOTAL2"] = mk([(t, s - b) for (t, s), (_, b) in zip(tot, btc)])
    out["TOTAL3"] = mk([(t, s - b - e) for (t, s), (_, b), (_, e) in zip(tot, btc, eth)])
    out["BTCD"] = mk([(t, 100 * b / s) for (t, s), (_, b) in zip(tot, btc)])
    out["USDTD"] = mk([(t, 100 * u / s) for (t, s), (_, u) in zip(tot, usdt)])
    return out


class Market:
    def __init__(self, db, get=http_get, gap=2.5, clock=time.time, sleep=time.sleep):
        self.db, self.get, self.gap, self.clock, self.sleep = db, get, gap, clock, sleep
        self.lock = threading.Lock()
        self.busy = False
        self.cache = {}      # ad → rows
        self.meta = {"updated": 0, "coins": 0}
        db.x("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, updated BIGINT)")
        self._load()

    def _load(self):
        r = self.db.one("SELECT v, updated FROM kv WHERE k='mkt_index'")
        if r:
            try:
                d = json.loads(r["v"]); self.cache = d["rows"]; self.meta = {"updated": int(r["updated"]), "coins": d.get("coins", 0)}
            except Exception:
                traceback.print_exc()

    def _save(self, rows, coins):
        v = json.dumps({"rows": rows, "coins": coins}, separators=(",", ":"))
        t = int(self.clock())
        self.db.x("DELETE FROM kv WHERE k='mkt_index'")
        self.db.x("INSERT INTO kv (k, v, updated) VALUES ('mkt_index', ?, ?)", (v, t))
        with self.lock:
            self.cache = rows; self.meta = {"updated": t, "coins": coins}

    def stale(self, hours=12):
        return self.clock() - self.meta["updated"] > hours * 3600

    def refresh(self):
        """Bloklayıcı: tüm coinleri sırayla çeker (hız sınırına saygılı), her 10 coinde bir kısmi sonucu yayınlar."""
        if self.busy:
            return False
        self.busy = True
        try:
            mk = self.get(f"{BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false")
            ids = [c["id"] for c in mk if c.get("id")]
            for must in KEEP:
                if must not in ids:
                    ids.append(must)
            ids = sorted(ids, key=lambda i: (i not in KEEP, ids.index(i)))  # önce BTC/ETH/USDT
            caps = {}
            for n, cid in enumerate(ids):
                for attempt in range(3):
                    try:
                        d = self.get(f"{BASE}/coins/{cid}/market_chart?vs_currency=usd&days=365&interval=daily")
                        caps[cid] = d.get("market_caps") or []
                        break
                    except Exception as e:
                        wait = 30 if "429" in str(e) else 3
                        self.sleep(wait)
                else:
                    pass
                if n % 10 == 9 and "bitcoin" in caps:
                    self._save(compute(caps), len(caps))
                self.sleep(self.gap)
            if "bitcoin" in caps:
                self._save(compute(caps), len(caps))
            return True
        except Exception:
            traceback.print_exc()
            return False
        finally:
            self.busy = False

    def start(self):
        def loop():
            while True:
                try:
                    if self.stale():
                        self.refresh()
                except Exception:
                    traceback.print_exc()
                time.sleep(1800)
        threading.Thread(target=loop, daemon=True).start()

    def get_index(self, name):
        with self.lock:
            rows = self.cache.get(name)
            return {"name": name, "title": NAMES.get(name, name), "ready": bool(rows), "rows": rows or [], "coins": self.meta["coins"], "updated": self.meta["updated"], "busy": self.busy}
