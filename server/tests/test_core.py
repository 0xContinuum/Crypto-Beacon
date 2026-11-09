import sys, os, unittest, base64
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from server import core as C


class Auth(unittest.TestCase):
    TOKEN = "123456:TEST-TOKEN"

    def test_gecerli_imza(self):
        d = C.sign_init_data({"id": 42, "first_name": "Ali", "username": "ali"}, self.TOKEN, 1000)
        u = C.verify_init_data(d, self.TOKEN, 1500)
        self.assertEqual((u["id"], u["username"]), (42, "ali"))

    def test_yanlis_token(self):
        d = C.sign_init_data({"id": 42}, self.TOKEN, 1000)
        with self.assertRaises(C.AuthError): C.verify_init_data(d, "baska:token", 1500)

    def test_degistirilmis_veri(self):
        d = C.sign_init_data({"id": 42}, self.TOKEN, 1000).replace("%22id%22%3A42", "%22id%22%3A6394985954")
        with self.assertRaises(C.AuthError): C.verify_init_data(d, self.TOKEN, 1500)

    def test_suresi_dolmus(self):
        d = C.sign_init_data({"id": 42}, self.TOKEN, 1000)
        with self.assertRaises(C.AuthError): C.verify_init_data(d, self.TOKEN, 1000 + 86401)

    def test_bos(self):
        with self.assertRaises(C.AuthError): C.verify_init_data("", self.TOKEN, 1)
        with self.assertRaises(C.AuthError): C.verify_init_data("a=b", "", 1)

    def test_hash_eksik(self):
        with self.assertRaises(C.AuthError): C.verify_init_data("auth_date=1&user=%7B%22id%22%3A1%7D", self.TOKEN, 2)


class Money(unittest.TestCase):
    def test_usd(self):
        self.assertEqual(C.usd_to_micro("2.02"), 2_020_000)
        self.assertEqual(C.usd_to_micro("2,02"), 2_020_000)
        self.assertEqual(C.usd_to_micro(100), 100_000_000)
        with self.assertRaises(ValueError): C.usd_to_micro("abc")
        with self.assertRaises(ValueError): C.usd_to_micro("nan")

    def test_gelir(self):
        # kullanıcının Adsgram ekranı: 6 gösterim, CPM 2.02 -> 0.01212 USD
        self.assertEqual(C.revenue_micro(6, 2_020_000), 12_120)

    def test_kazanc_payda_gosterimden_kucuk_olmaz(self):
        # gelir 100 USD, Adsgram 1000 gösterim, yayıncı 100 reklam, pay %50 -> 100*100/1000=10 USD brüt, 5 USD net
        self.assertEqual(C.earning(100 * C.MICRO, 1000, 800, 100, 5000), 5 * C.MICRO)
        # biz Adsgram'dan fazla kayıt tutmuşsak payda bizim toplamımız olur: toplam dağıtım geliri aşmaz
        e1 = C.earning(100 * C.MICRO, 100, 200, 120, 5000); e2 = C.earning(100 * C.MICRO, 100, 200, 80, 5000)
        self.assertLessEqual((e1 + e2) * 2, 100 * C.MICRO)

    def test_sifir_gosterim(self):
        self.assertEqual(C.earning(0, 0, 0, 0, 5000), 0)


class Ledger(unittest.TestCase):
    DAYS = {"2026-11-01": {"revenue_micro": 100 * C.MICRO, "impressions": 1000, "collected": 1},
            "2026-11-02": {"revenue_micro": 50 * C.MICRO, "impressions": 500, "collected": 0}}

    def test_bakiye(self):
        counts = [("2026-11-01", 7, 100), ("2026-11-02", 7, 100), ("2026-11-03", 7, 10), ("2026-11-01", 8, 50)]
        totals = {"2026-11-01": 300, "2026-11-02": 200, "2026-11-03": 10}
        L = C.build_ledger(self.DAYS, counts, totals, {7: 5000, 8: 5000}, {7: 1_000_000}, [(7, "paid", 2_000_000), (7, "pending", 1_000_000)])
        a = L[7]
        self.assertEqual(a["accrued"], 5_000_000 + 5_000_000)          # 100 reklam * 0.1 USD/reklam * %50, iki gün
        self.assertEqual(a["collected"], 5_000_000)                    # yalnızca Adsgram'dan tahsil edilen gün
        self.assertEqual(a["awaiting"], 5_000_000)
        self.assertEqual(a["unapproved_ads"], 10)                      # geliri girilmemiş günün reklamları
        self.assertEqual(a["available"], 5_000_000 + 1_000_000 - 2_000_000 - 1_000_000)
        self.assertEqual(L[8]["accrued"], 2_500_000)

    def test_sahip_payi_yayincilara_gitmez(self):
        # toplam 300 reklam, 150'si yayıncılarda; yayıncılar brüt gelirin yarısını alır, ondan %50 -> %25
        counts = [("2026-11-01", 1, 100), ("2026-11-01", 2, 50)]
        L = C.build_ledger(self.DAYS, counts, {"2026-11-01": 300}, {}, {}, [])
        tot = L[1]["accrued"] + L[2]["accrued"]
        self.assertEqual(tot, 100 * C.MICRO * 150 // 1000 * 5000 // 10000)
        self.assertLess(tot, 100 * C.MICRO * 0.5)

    def test_yayinci_olup_reklami_olmayan(self):
        L = C.build_ledger({}, [], {}, {9: 5000}, {}, [])
        self.assertEqual(L[9]["available"], 0)


class Wallet(unittest.TestCase):
    def test_agler(self):
        self.assertTrue(C.valid_wallet("TON", "UQ" + "a" * 46))
        self.assertFalse(C.valid_wallet("TON", "TXyz"))
        self.assertTrue(C.valid_wallet("TRC20", "T" + "A" * 33))
        self.assertFalse(C.valid_wallet("TRC20", "0x" + "a" * 40))
        self.assertTrue(C.valid_wallet("BEP20", "0x" + "a" * 40))
        self.assertFalse(C.valid_wallet("ETH", "0x" + "a" * 40))
        self.assertFalse(C.valid_wallet("TON", None))


class Content(unittest.TestCase):
    def test_yasak_ifadeler(self):
        for t in ["Garanti kazanç var", "VIP grubumuza katılın", "hemen al", "Hedef fiyat 100k", "Kaldıraç 20x ile", "100x olur", "SL: 60000", "ücretli sinyal veriyoruz"]:
            self.assertTrue(C.content_check("", t), t)

    def test_normal_analiz_gecer(self):
        self.assertEqual(C.content_check("BTC günlük analiz", "Fiyat 200 günlük ortalamanın üstünde. Direnç 78 bin civarı, destek 74 bin. Bu bir yatırım tavsiyesi değildir."), [])
        self.assertEqual(C.content_check("Halving döngüsü", "Dört yıllık döngüde önceki tepeler incelendi; al kelimesi geçen bir cümle: dikkatli al gözle."), [])

    def test_temizle(self):
        self.assertEqual(C.clean("  a‮b\x00c  ", 10), "abc")
        self.assertEqual(len(C.clean("x" * 500, 20)), 20)


class Image(unittest.TestCase):
    JPG = b"\xff\xd8\xff" + b"0" * 100

    def test_gecerli(self):
        m, raw = C.valid_image("data:image/jpeg;base64," + base64.b64encode(self.JPG).decode())
        self.assertEqual(m, "image/jpeg")

    def test_sahte_tur(self):
        with self.assertRaises(ValueError): C.valid_image("data:image/png;base64," + base64.b64encode(self.JPG).decode())

    def test_buyuk_ve_bozuk(self):
        with self.assertRaises(ValueError): C.valid_image("data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"0" * 300_000).decode())
        with self.assertRaises(ValueError): C.valid_image("data:text/html;base64,PHNjcmlwdD4=")
        with self.assertRaises(ValueError): C.valid_image("")


class Misc(unittest.TestCase):
    def test_gun(self):
        self.assertEqual(C.day_of(0), "1970-01-01")
        self.assertEqual(C.day_of(86399), "1970-01-01"); self.assertEqual(C.day_of(86400), "1970-01-02")

    def test_grup_linki(self):
        self.assertTrue(C.GROUP_LINK_RE.match("https://t.me/kriptotr"))
        self.assertFalse(C.GROUP_LINK_RE.match("http://t.me/kriptotr"))
        self.assertFalse(C.GROUP_LINK_RE.match("https://evil.com/t.me/abc"))
        self.assertFalse(C.GROUP_LINK_RE.match("javascript:alert(1)"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
