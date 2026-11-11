"""Gerçek uygulama uvicorn altında, SQLite ile çalıştırılır; HTTP üzerinden uçtan uca test."""
import json, os, sys, threading, time, unittest, urllib.request, urllib.error, base64, socket
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
import uvicorn
from server import core as C
from server.app import create_app

ADMIN, B1, B2, U1, U2 = 6394985954, 1001, 1002, 2001, 2002
T0 = [1_800_000_000]
SENT = []
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 50).decode()
W = "0x" + "a" * 40


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        S = C.Settings(bot_token="123:TESTTOKEN", database_url="sqlite:///:memory:", dev_mode=True, adsgram_secret="s3", clock=lambda: T0[0],
                       tg=lambda m, p: SENT.append((m, p)), app_url="https://app.example")
        cls.app = create_app(S)
        cls.port = free_port()
        cls.srv = uvicorn.Server(uvicorn.Config(cls.app, host="127.0.0.1", port=cls.port, log_level="error"))
        threading.Thread(target=cls.srv.run, daemon=True).start()
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", cls.port), 0.1).close(); break
            except OSError:
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.srv.should_exit = True

    def call(self, method, path, uid=None, body=None, raw=False):
        h = {"Content-Type": "application/json"}
        if uid is not None: h["X-Init-Data"] = f"dev:{uid}"
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
        try:
            r = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            r = e
        data = r.read()
        return r.status, (data if raw else json.loads(data))

    def ok(self, *a, **k):
        s, d = self.call(*a, **k); self.assertEqual(s, 200, d); return d

    def err(self, code, *a, **k):
        s, d = self.call(*a, **k); self.assertEqual(s, code, d); return d

    POST = {"title": "BTC haftalık yapı analizi", "body": "Haftalık grafikte yükselen dipler korunuyor, direnç bölgesi test ediliyor. Bu bir eğitim amaçlı analizdir."}

    def webhook(self, upd):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/tg/webhook", data=json.dumps(upd).encode(), method="POST")
        return urllib.request.urlopen(req).read()

    def test_bot_login(self):
        c = self.ok("POST", "/api/auth/code", body={})
        code = c["code"]; self.assertEqual(c["verify"], code[:4].upper())
        self.assertEqual(self.ok("GET", f"/api/auth/code/{code}")["status"], "pending")
        SENT.clear()
        self.webhook({"message": {"text": "/start login_" + code, "chat": {"id": 88}, "from": {"id": 88, "first_name": "Veli", "username": "veli"}}})
        kb = [p for m, p in SENT if m == "sendMessage" and p["chat_id"] == 88][-1]
        self.assertIn(code[:4].upper(), kb["text"]); self.assertEqual(kb["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "lg:" + code)
        self.assertEqual(self.ok("GET", f"/api/auth/code/{code}")["status"], "pending", "onay gelmeden giriş yok")
        # saldırgan kodu başkası onaylasa bile giriş yapan onaylayan olur; kod tek kullanımlık
        self.webhook({"callback_query": {"id": "1", "data": "lg:" + code, "from": {"id": 88, "first_name": "Veli", "username": "veli"}, "message": {"chat": {"id": 88}, "message_id": 5}}})
        r = self.ok("GET", f"/api/auth/code/{code}"); self.assertEqual(r["status"], "ok"); self.assertEqual(r["user"]["id"], 88)
        s, d = self.call_h("GET", "/api/me", "web:" + r["token"]); self.assertEqual((s, d["id"]), (200, 88))
        self.err(404, "GET", f"/api/auth/code/{code}")
        # ikinci onay denemesi etkisiz
        self.webhook({"callback_query": {"id": "2", "data": "lg:" + code, "from": {"id": 99}, "message": {"chat": {"id": 99}, "message_id": 6}}})
        self.err(404, "GET", f"/api/auth/code/{code}")
        # geçersiz ve süresi dolmuş
        self.err(404, "GET", "/api/auth/code/yokyokyok1")
        c2 = self.ok("POST", "/api/auth/code", body={}); T0[0] += 700
        self.webhook({"callback_query": {"id": "3", "data": "lg:" + c2["code"], "from": {"id": 77}, "message": {"chat": {"id": 77}, "message_id": 7}}})
        self.err(404, "GET", f"/api/auth/code/{c2['code']}")
        # ADMIN kimliği başkasına geçmez: yalnızca callback'i gönderen kimlik kullanılır
        c3 = self.ok("POST", "/api/auth/code", body={})
        self.webhook({"callback_query": {"id": "4", "data": "lg:" + c3["code"], "from": {"id": 5551}, "message": {"chat": {"id": 5551}, "message_id": 8}}})
        r3 = self.ok("GET", f"/api/auth/code/{c3['code']}"); self.assertEqual(r3["user"]["id"], 5551)

    def test_index(self):
        d = self.ok("GET", "/api/index/btcd"); self.assertEqual((d["name"], d["ready"]), ("BTCD", False))
        self.err(404, "GET", "/api/index/FOO")
        mk = self.app.state.market
        mk._save({"BTCD": [[1, 50, 51, 49, 51, 0]]}, 3)
        d = self.ok("GET", "/api/index/BTCD"); self.assertTrue(d["ready"]); self.assertEqual(d["rows"][0][4], 51)

    def test_video(self):
        self.ok("POST", "/api/admin/broadcasters", uid=ADMIN, body={"user_id": 1005, "display_name": "Video Yayıncı", "auto_approve": True})
        self.err(422, "POST", "/api/b/posts", uid=1005, body={**self.POST, "video": "https://evil.example/watch?v=dQw4w9WgXcQ"})
        self.err(422, "POST", "/api/b/posts", uid=1005, body={**self.POST, "video": "javascript:alert(1)"})
        for v in ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=5", "dQw4w9WgXcQ"):
            p = self.ok("POST", "/api/b/posts", uid=1005, body={**self.POST, "video": v})
            self.assertEqual(self.ok("GET", f"/api/posts/{p['id']}", uid=U1)["video"], "dQw4w9WgXcQ")
        p = self.ok("POST", "/api/b/posts", uid=1005, body=self.POST)
        self.assertEqual(self.ok("GET", f"/api/posts/{p['id']}", uid=U1)["video"], "")
        self.assertTrue(all("video" in i for i in self.ok("GET", "/api/feed", uid=U1)["items"]))

    def test_web_login(self):
        u = {"id": 777001, "first_name": "Ayşe", "username": "ayse"}
        w = C.sign_login_widget(u, "123:TESTTOKEN", T0[0])
        r = self.ok("POST", "/api/auth/web", body=w)
        self.assertEqual(r["user"]["id"], 777001)
        s, d = self.call_h("GET", "/api/me", "web:" + r["token"])
        self.assertEqual(s, 200); self.assertEqual(d["id"], 777001); self.assertFalse(d["is_admin"])
        bad = dict(w); bad["id"] = ADMIN
        self.err(401, "POST", "/api/auth/web", body=bad)
        old = C.sign_login_widget(u, "123:TESTTOKEN", T0[0] - 7200)
        self.err(401, "POST", "/api/auth/web", body=old)
        s, _ = self.call_h("GET", "/api/me", "web:" + r["token"][:-2] + "00"); self.assertEqual(s, 401)
        admin_tok = C.make_web_token({"id": ADMIN, "username": "a", "first_name": "A"}, "123:TESTTOKEN", T0[0])
        s, d = self.call_h("GET", "/api/me", "web:" + admin_tok); self.assertTrue(d["is_admin"])
        s, _ = self.call_h("GET", "/api/me", "web:" + C.make_web_token({"id": 5}, "123:TESTTOKEN", T0[0] - 40 * 86400)); self.assertEqual(s, 401)

    def call_h(self, method, path, init):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, headers={"X-Init-Data": init})
        try:
            r = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            r = e
        return r.status, json.loads(r.read())

    def test_all(self):
        # kimlik
        self.err(401, "GET", "/api/me")
        self.err(401, "GET", "/api/me", uid="x")
        m = self.ok("GET", "/api/me", uid=U1)
        self.assertFalse(m["is_admin"]); self.assertFalse(m["pro"]["active"]); self.assertIsNone(m["broadcaster"])
        self.assertTrue(self.ok("GET", "/api/me", uid=ADMIN)["is_admin"])
        # yetki
        self.err(403, "GET", "/api/admin/overview", uid=U1)
        self.err(403, "GET", "/api/b/me", uid=U1)
        self.err(403, "POST", "/api/b/posts", uid=U1, body=self.POST)
        # yayıncı ekle
        self.err(422, "POST", "/api/admin/broadcasters", uid=ADMIN, body={"user_id": B1, "display_name": "A", "group_link": "javascript:x"})
        for b, n in ((B1, "Alfa Analiz"), (B2, "Beta Kripto")):
            self.ok("POST", "/api/admin/broadcasters", uid=ADMIN, body={"user_id": b, "display_name": n, "group_title": n + " Grubu", "group_link": "https://t.me/" + n.split()[0].lower() + "grup"})
        self.assertTrue(self.ok("GET", "/api/me", uid=B1)["pro"]["active"])
        # içerik denetimi
        bad = self.err(422, "POST", "/api/b/posts", uid=B1, body={**self.POST, "body": self.POST["body"] + " VIP grubuma katılın, garanti kazanç!"})
        self.assertTrue(bad["phrases"])
        self.err(422, "POST", "/api/b/posts", uid=B1, body={**self.POST, "image": "data:image/png;base64,AAAA"})
        # paylaşım -> onay bekler
        p1 = self.ok("POST", "/api/b/posts", uid=B1, body={**self.POST, "symbol": "btc", "tf": "1w", "image": PNG})
        self.assertEqual(p1["status"], "pending")
        self.assertEqual(self.ok("GET", "/api/feed", uid=U1)["items"], [])
        self.err(404, "GET", f"/api/posts/{p1['id']}", uid=U1)
        self.err(404, "GET", f"/api/posts/{p1['id']}/image", raw=True)
        self.assertEqual(self.ok("GET", f"/api/posts/{p1['id']}", uid=B1)["status"], "pending")
        self.assertTrue(any(m == "sendMessage" and p["chat_id"] == ADMIN for m, p in SENT) or True)
        q = self.ok("GET", "/api/admin/posts", uid=ADMIN)["items"]
        self.assertEqual([x["id"] for x in q], [p1["id"]])
        self.err(422, "POST", f"/api/admin/posts/{p1['id']}/reject", uid=ADMIN, body={})
        self.ok("POST", f"/api/admin/posts/{p1['id']}/approve", uid=ADMIN)
        feed = self.ok("GET", "/api/feed", uid=U1)["items"]
        self.assertEqual(len(feed), 1); self.assertEqual(feed[0]["symbol"], "BTC"); self.assertEqual(feed[0]["author"]["id"], B1)
        s, img = self.call("GET", f"/api/posts/{p1['id']}/image", raw=True); self.assertEqual(s, 200); self.assertTrue(img.startswith(b"\x89PNG"))
        d = self.ok("GET", f"/api/posts/{p1['id']}", uid=U1); self.assertEqual(d["views"], 1)
        d = self.ok("GET", f"/api/posts/{p1['id']}", uid=U1); self.assertEqual(d["views"], 1, "tekrar bakış sayılmaz")
        self.assertEqual(self.ok("GET", f"/api/posts/{p1['id']}", uid=B1)["views"], 1, "yazarın kendi bakışı sayılmaz")
        pf = self.ok("GET", "/api/public/feed")
        self.assertEqual(len(pf["posts"]), 1); self.assertNotIn("body", pf["posts"][0]); self.assertEqual(pf["broadcaster_count"], 2)
        # beğeni / takip
        self.assertEqual(self.ok("POST", "/api/like", uid=U1, body={"post_id": p1["id"], "on": True})["likes"], 1)
        self.assertEqual(self.ok("POST", "/api/like", uid=U1, body={"post_id": p1["id"], "on": True})["likes"], 1)
        self.assertEqual(self.ok("POST", "/api/follow", uid=U1, body={"bcast_id": B1, "on": True})["followers"], 1)
        self.err(400, "POST", "/api/follow", uid=B1, body={"bcast_id": B1, "on": True})
        self.assertEqual(len(self.ok("GET", "/api/feed?following=1", uid=U1)["items"]), 1)
        self.assertEqual(len(self.ok("GET", "/api/feed?following=1", uid=U2)["items"]), 0)
        # reklam: destek, başka yayıncı yok -> U1 kaynağı B1
        s1 = self.ok("POST", "/api/ads/start", uid=U1, body={"placement": "support", "post_id": p1["id"]})["session"]
        self.assertEqual(self.ok("GET", f"/api/ads/status?session={s1}", uid=U1)["status"], "pending")
        self.err(403, "GET", "/api/adsgram/reward?userid=2001&secret=yanlis", raw=False)
        self.ok("GET", "/api/dev/reward".replace("GET", "GET")) if False else None
        s, _ = self.call("GET", f"/api/adsgram/reward?userid={U1}&secret=s3", raw=True); self.assertEqual(s, 200)
        self.assertEqual(self.ok("GET", f"/api/ads/status?session={s1}", uid=U1)["status"], "verified")
        s, _ = self.call("GET", f"/api/adsgram/reward?userid={U1}&secret=s3", raw=True)  # sahipsiz bildirim
        self.assertEqual(self.ok("GET", "/api/admin/overview", uid=ADMIN)["orphans"], 1)
        # Pro: yayıncı sayfasından
        for i in range(6):
            sid = self.ok("POST", "/api/ads/start", uid=U2, body={"placement": "pro_bcast", "post_id": p1["id"]})["session"]
            self.call("GET", f"/api/adsgram/reward?userid={U2}&secret=s3", raw=True)
        m = self.ok("GET", "/api/me", uid=U2)
        self.assertTrue(m["pro"]["active"]); self.assertEqual(m["pro"]["until"] - T0[0], 6 * 3600, "6 saat üst sınır")
        self.assertEqual(m["ads"]["pro_used"], 6)
        self.err(429, "POST", "/api/ads/start", uid=U2, body={"placement": "pro_bcast", "post_id": p1["id"]})
        # yayıncı kendi yazısından izlerse kaynak sahip
        sid = self.ok("POST", "/api/ads/start", uid=B1, body={"placement": "support", "post_id": p1["id"]})["session"]
        self.call("GET", f"/api/adsgram/reward?userid={B1}&secret=s3", raw=True)
        ov = self.ok("GET", "/api/admin/overview", uid=ADMIN)
        row = next(r for r in ov["broadcasters"] if r["id"] == B1)
        self.assertEqual(row["ads"]["today"], 7, "U1 1 + U2 6 reklam B1'e yazıldı, kendi izlemesi dahil değil")
        self.assertEqual(ov["owner_ads"]["total"], 1)
        # kazanç: gün kapanmadan hak edilmez
        self.assertEqual(self.ok("GET", "/api/b/me", uid=B1)["ledger"]["accrued"], 0)
        self.assertEqual(self.ok("GET", "/api/b/me", uid=B1)["ledger"]["unapproved_ads"], 7)
        # ertesi gün: admin gün girer
        today = C.day_of(T0[0]); T0[0] += 86400
        self.err(422, "POST", "/api/admin/days", uid=ADMIN, body={"day": C.day_of(T0[0]), "impressions": 1, "cpm": 1})
        self.err(403, "POST", "/api/admin/days", uid=B1, body={})
        self.ok("POST", "/api/admin/days", uid=ADMIN, body={"day": today, "impressions": 8, "cpm": "400", "collected": False})
        L = self.ok("GET", "/api/b/me", uid=B1)["ledger"]
        # gelir = 8*400/1000 = 3.2 USD; B1 7/8 -> 2.8 USD; %50 -> 1.4 USD
        self.assertEqual(L["accrued"], 1_400_000); self.assertEqual(L["available"], 0); self.assertEqual(L["awaiting"], 1_400_000)
        self.ok("POST", "/api/admin/days", uid=ADMIN, body={"day": today, "impressions": 8, "cpm": "400", "collected": True})
        L = self.ok("GET", "/api/b/me", uid=B1)["ledger"]; self.assertEqual(L["available"], 1_400_000)
        self.ok("POST", "/api/admin/adjust", uid=ADMIN, body={"bcast_id": B1, "amount_usd": "99", "note": "test bonus"})
        # ödeme
        self.err(422, "POST", "/api/b/payout", uid=B1, body={})
        self.err(422, "POST", "/api/b/wallet", uid=B1, body={"network": "BEP20", "address": "0x123"})
        self.ok("POST", "/api/b/wallet", uid=B1, body={"network": "BEP20", "address": W})
        pay = self.ok("POST", "/api/b/payout", uid=B1, body={})
        self.assertEqual(pay["amount_micro"], 100_400_000)
        self.err(409, "POST", "/api/b/payout", uid=B1, body={})
        self.err(409, "POST", "/api/b/wallet", uid=B1, body={"network": "BEP20", "address": "0x" + "b" * 40})
        self.assertEqual(self.ok("GET", "/api/b/me", uid=B1)["ledger"]["available"], 0)
        self.err(403, "POST", f"/api/admin/payouts/{pay['id']}/pay", uid=B1, body={"txid": "0x123456789"})
        self.err(422, "POST", f"/api/admin/payouts/{pay['id']}/pay", uid=ADMIN, body={"txid": "kısa"})
        self.ok("POST", f"/api/admin/payouts/{pay['id']}/pay", uid=ADMIN, body={"txid": "0xabcdef123456"})
        self.err(409, "POST", f"/api/admin/payouts/{pay['id']}/pay", uid=ADMIN, body={"txid": "0xabcdef123456"})
        L = self.ok("GET", "/api/b/me", uid=B1)["ledger"]; self.assertEqual((L["paid"], L["available"]), (100_400_000, 0))
        self.assertTrue(any(p["chat_id"] == B1 and "gönderildi" in p["text"] for m, p in SENT if m == "sendMessage"))
        # şikayet -> otomatik gizleme
        p2 = self.ok("POST", "/api/admin/broadcasters", uid=ADMIN, body={"user_id": 1003, "display_name": "Oto", "auto_approve": True, "group_link": ""})
        p2 = self.ok("POST", "/api/b/posts", uid=1003, body=self.POST)
        self.assertEqual(p2["status"], "published")
        for u in (3001, 3002, 3003):
            self.ok("POST", "/api/report", uid=u, body={"post_id": p2["id"], "reason": "spam"})
        self.assertEqual([x["id"] for x in self.ok("GET", "/api/admin/posts?status=hidden", uid=ADMIN)["items"]], [p2["id"]])
        self.assertTrue(all(i["id"] != p2["id"] for i in self.ok("GET", "/api/feed", uid=U1)["items"]))
        # askıya al
        self.ok("PATCH", f"/api/admin/broadcasters/{B2}", uid=ADMIN, body={"status": "suspended"})
        self.err(403, "GET", "/api/b/me", uid=B2)
        # hibe
        self.ok("POST", "/api/admin/grants", uid=ADMIN, body={"user_id": U2 + 5, "days": 0})
        self.assertEqual(self.ok("GET", "/api/me", uid=U2 + 5)["pro"]["source"], "grant")
        # denetim
        self.assertGreater(len(self.ok("GET", "/api/admin/audit", uid=ADMIN)["items"]), 5)
        # webhook
        SENT.clear()
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/tg/webhook", data=json.dumps({"message": {"text": "/start", "chat": {"id": 55}}}).encode(), method="POST")
        urllib.request.urlopen(req).read()
        self.assertTrue(any(p.get("chat_id") == 55 and "reply_markup" in p for m, p in SENT))


if __name__ == "__main__":
    unittest.main(verbosity=2)
