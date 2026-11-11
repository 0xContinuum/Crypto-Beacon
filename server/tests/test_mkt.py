import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from server import mkt as M
from server.db import DB

D = M.DAY
T0 = 1_700_000_000_000 // D * D


def pts(vals):
    return [[T0 + i * D + 5000, v] for i, v in enumerate(vals)]


class T(unittest.TestCase):
    def test_compute(self):
        caps = {"bitcoin": pts([100, 110, 120]), "ethereum": pts([50, 50, 60]), "tether": pts([40, 40, 40]), "x": pts([10, 10, 10])}
        o = M.compute(caps)
        self.assertEqual([r[4] for r in o["TOTAL"]], [200, 210, 230])
        self.assertEqual([r[4] for r in o["TOTAL2"]], [100, 100, 110])
        self.assertEqual([r[4] for r in o["TOTAL3"]], [50, 50, 50])
        self.assertAlmostEqual(o["BTCD"][2][4], 100 * 120 / 230)
        self.assertAlmostEqual(o["USDTD"][0][4], 20.0)
        r = o["TOTAL"][1]; self.assertEqual((r[1], r[4]), (200, 210)); self.assertTrue(r[2] >= r[3])

    def test_gap_fill_and_new_coin(self):
        caps = {"bitcoin": pts([100, 100, 100, 100, 100, 100]), "ethereum": [[T0 + 5000, 10]], "late": [[T0 + 4 * D, 5], [T0 + 5 * D, 5]]}
        o = M.compute(caps)["TOTAL"]
        self.assertEqual(o[0][4], 110); self.assertEqual(o[3][4], 110); self.assertEqual(o[4][4], 105)  # eth 3 günden sonra düşer; late sonradan gelir
        self.assertEqual(o[5][4], 105)

    def test_refresh_and_cache(self):
        calls = []
        def get(url):
            calls.append(url)
            if "coins/markets" in url:
                return [{"id": "bitcoin"}, {"id": "ethereum"}, {"id": "solana"}]
            cid = url.split("/coins/")[1].split("/")[0]
            return {"market_caps": pts([100, 101, 102] if cid == "bitcoin" else [10, 11, 12])}
        db = DB("sqlite:///:memory:"); db.init_schema()
        m = M.Market(db, get=get, gap=0, sleep=lambda s: None)
        self.assertTrue(m.stale()); self.assertFalse(m.get_index("TOTAL")["ready"])
        self.assertTrue(m.refresh())
        g = m.get_index("TOTAL"); self.assertTrue(g["ready"]); self.assertEqual(len(g["rows"]), 3); self.assertGreaterEqual(g["coins"], 3)
        self.assertIn("tether", " ".join(calls))           # BTC/ETH/USDT her zaman çekilir
        m2 = M.Market(db, get=get, gap=0); self.assertTrue(m2.get_index("BTCD")["ready"])  # yeniden başlatınca veritabanından yüklenir

    def test_failures_are_skipped(self):
        def get(url):
            if "coins/markets" in url: return [{"id": "bitcoin"}, {"id": "bad"}]
            if "/bad/" in url: raise OSError("HTTP 500")
            return {"market_caps": pts([100, 100])}
        db = DB("sqlite:///:memory:"); db.init_schema()
        m = M.Market(db, get=get, gap=0, sleep=lambda s: None)
        self.assertTrue(m.refresh()); self.assertTrue(m.get_index("TOTAL")["ready"])


if __name__ == "__main__":
    unittest.main()
