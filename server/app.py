"""Beacon sunucusu (Starlette). Kimlik: Telegram initData imzası. Veri: SQLite (yerel) veya Postgres (Neon).
Reklam atfı: Adsgram Reward URL bildirimi tek doğruluk kaynağıdır; istemci beyanı sayılmaz."""
import base64
import json
import os
import re
import secrets
import threading
import traceback
import urllib.request
import hmac

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route

from . import core as C
from . import mkt as M
from .db import DB

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,10}$")
TFS = {"15m", "1h", "4h", "1d", "1w"}


class ApiError(Exception):
    def __init__(self, status, msg, **extra):
        self.status, self.msg, self.extra = status, msg, extra


class Ctx:
    def __init__(self, request, body):
        self.request, self.body = request, body
        self.q = request.query_params
        self.p = request.path_params
        self.user = None
        self.is_admin = False
        self.bcast = None

    def int_arg(self, name, src=None, default=None):
        v = (src if src is not None else self.body).get(name, default)
        try:
            return int(v)
        except (TypeError, ValueError):
            raise ApiError(400, f"{name} geçersiz")


def create_app(S=None, db=None):
    S = S or C.Settings.from_env()
    db = db or DB(S.database_url or None)
    db.init_schema()
    routes, rl = [], {}
    now = S.now

    # ——— Telegram Bot API ———
    def tg(method, payload):
        if os.environ.get("TG_OFFLINE") == "1":
            return None
        if S.tg:
            return S.tg(method, payload)
        if not S.bot_token:
            return None
        try:
            req = urllib.request.Request(f"https://api.telegram.org/bot{S.bot_token}/{method}", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
            return json.loads(urllib.request.urlopen(req, timeout=10).read())
        except Exception:
            return None

    def tg_photo(chat_id, raw, caption=""):
        """Görseli bot sohbetine gönderir (multipart). Telegram içinde indirme/paylaşma bu yolla yapılır."""
        if os.environ.get("TG_OFFLINE") == "1":
            return None
        if S.tg:
            return S.tg("sendPhoto", {"chat_id": chat_id, "caption": caption, "photo": raw})
        if not S.bot_token:
            return None
        b = "----beacon" + secrets.token_hex(8)
        parts = []
        for k, v in (("chat_id", str(chat_id)), ("caption", caption)):
            parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="photo"; filename="beacon.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + raw + b"\r\n")
        parts.append(f"--{b}--\r\n".encode())
        try:
            req = urllib.request.Request(f"https://api.telegram.org/bot{S.bot_token}/sendPhoto", data=b"".join(parts), headers={"Content-Type": "multipart/form-data; boundary=" + b})
            return json.loads(urllib.request.urlopen(req, timeout=20).read())
        except Exception:
            return None

    def notify(uid, text):
        threading.Thread(target=lambda: tg("sendMessage", {"chat_id": uid, "text": text}), daemon=True).start()

    def notify_admins(text):
        for a in S.admin_ids:
            notify(a, text)

    # ——— yardımcılar ———
    def rate(uid, key, n, per):
        t = now()
        k = (uid, key)
        L = [x for x in rl.get(k, []) if t - x < per]
        if len(L) >= n:
            raise ApiError(429, "Çok sık deneme, biraz bekleyin")
        L.append(t)
        rl[k] = L

    def audit(actor, action, detail=""):
        db.x("INSERT INTO audit (actor, action, detail, created_at) VALUES (?,?,?,?)", (actor, action, str(detail)[:300], now()))

    def auth(request):
        h = request.headers.get("x-init-data", "")
        if S.dev_mode and h.startswith("dev:"):
            try:
                uid = int(h[4:])
            except ValueError:
                raise ApiError(401, "Giriş doğrulanamadı")
            user = {"id": uid, "username": f"dev{uid}", "first_name": "Dev"}
        elif h.startswith("web:"):
            try:
                user = C.read_web_token(h[4:], S.bot_token, now())
            except C.AuthError as e:
                raise ApiError(401, f"Giriş doğrulanamadı: {e}")
        else:
            try:
                user = C.verify_init_data(h, S.bot_token, now())
            except C.AuthError as e:
                raise ApiError(401, f"Giriş doğrulanamadı: {e}")
        t = now()
        db.x("INSERT INTO users (id, username, first_name, created_at, last_seen) VALUES (?,?,?,?,?) "
             "ON CONFLICT (id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, last_seen=excluded.last_seen",
             (user["id"], user["username"], user["first_name"], t, t))
        return user

    def route(path, methods=("GET",), role=None, public=False):
        def deco(fn):
            async def endpoint(request):
                try:
                    body = {}
                    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
                        raw = await request.body()
                        if len(raw) > 700_000:
                            raise ApiError(413, "İstek çok büyük")
                        if raw:
                            try:
                                body = json.loads(raw)
                            except ValueError:
                                raise ApiError(400, "Geçersiz JSON")
                            if not isinstance(body, dict):
                                raise ApiError(400, "Geçersiz JSON")

                    def work():
                        ctx = Ctx(request, body)
                        if not public:
                            ctx.user = auth(request)
                            ctx.is_admin = ctx.user["id"] in S.admin_ids
                            if role == "admin" and not ctx.is_admin:
                                raise ApiError(403, "Yetkiniz yok")
                            if role == "bcast":
                                b = db.one("SELECT * FROM broadcasters WHERE user_id=?", (ctx.user["id"],))
                                if not b or b["status"] != "active":
                                    raise ApiError(403, "Yayıncı değilsiniz")
                                ctx.bcast = b
                        return fn(ctx)

                    res = await run_in_threadpool(work)
                    return res if isinstance(res, Response) else JSONResponse(res)
                except ApiError as e:
                    return JSONResponse({"error": e.msg, **e.extra}, status_code=e.status)
                except Exception:
                    traceback.print_exc()
                    return JSONResponse({"error": "Sunucu hatası"}, status_code=500)
            routes.append(Route(path, endpoint, methods=list(methods)))
            return fn
        return deco

    # ——— Pro durumu ———
    def pro_state(uid, is_admin, user_row=None, bcast=None):
        t = now()
        if is_admin:
            return {"active": True, "source": "owner", "until": 0}
        g = db.one("SELECT until FROM grants WHERE user_id=?", (uid,))
        if g and (g["until"] == 0 or g["until"] > t):
            return {"active": True, "source": "grant", "until": g["until"]}
        if S.broadcaster_pro and bcast and bcast["status"] == "active":
            return {"active": True, "source": "broadcaster", "until": 0}
        u = user_row or db.one("SELECT pro_until FROM users WHERE id=?", (uid,))
        if u and u["pro_until"] > t:
            return {"active": True, "source": "ads", "until": u["pro_until"]}
        return {"active": False, "source": "", "until": 0}

    def ads_today(uid):
        rows = db.q("SELECT placement, COUNT(*) AS n FROM ad_sessions WHERE user_id=? AND day=? AND status='verified' GROUP BY placement", (uid, C.day_of(now())))
        pro = sum(r["n"] for r in rows if r["placement"].startswith("pro"))
        sup = sum(r["n"] for r in rows if r["placement"] == "support")
        return pro, sup

    def bcast_public(b, followers=None, me_follows=None, posts=None):
        o = {"id": b["user_id"], "name": b["display_name"], "bio": b["bio"], "group_title": b["group_title"], "group_link": b["group_link"], "status": b["status"]}
        if followers is not None: o["followers"] = followers
        if me_follows is not None: o["following"] = me_follows
        if posts is not None: o["posts"] = posts
        return o

    def ledger():
        days = {r["day"]: r for r in db.q("SELECT * FROM days")}
        counts = [(r["day"], r["src_id"], r["n"]) for r in db.q(
            "SELECT day, src_id, COUNT(*) AS n FROM ad_sessions WHERE status='verified' AND src_type='broadcaster' GROUP BY day, src_id")]
        totals = {r["day"]: r["n"] for r in db.q("SELECT day, COUNT(*) AS n FROM ad_sessions WHERE status='verified' GROUP BY day")}
        shares = {r["user_id"]: r["share_bps"] for r in db.q("SELECT user_id, share_bps FROM broadcasters")}
        adj = {r["bcast_id"]: int(r["s"]) for r in db.q("SELECT bcast_id, SUM(amount_micro) AS s FROM adjustments GROUP BY bcast_id")}
        pays = [(r["bcast_id"], r["status"], r["amount_micro"]) for r in db.q("SELECT bcast_id, status, amount_micro FROM payouts")]
        return C.build_ledger(days, counts, totals, shares, adj, pays, S.default_share_bps)

    EMPTY = {"accrued": 0, "collected": 0, "awaiting": 0, "adjust": 0, "paid": 0, "pending": 0, "available": 0, "by_day": [], "unapproved_ads": 0}

    # ——— genel ———
    @route("/healthz", public=True)
    def healthz(ctx):
        return {"ok": True}

    market = M.Market(db, get=S.market_get or M.http_get, gap=S.market_gap)
    if S.market_auto and not S.dev_mode:
        market.start()

    @route("/api/index/{name}", public=True)
    def index_series(ctx):
        name = ctx.request.path_params["name"].upper()
        if name not in M.NAMES:
            raise ApiError(404, "Bilinmeyen endeks")
        return JSONResponse(market.get_index(name), headers={"Cache-Control": "public, max-age=300"})

    @route("/api/public/feed", public=True)
    def public_feed(ctx):
        """Giriş gerektirmeyen son paylaşımlar (tanıtım sitesi için). Yalnızca yayındaki içerik, kısa özet."""
        rows = db.q(POST_SELECT + "WHERE p.status='published' AND b.status='active' ORDER BY p.published_at DESC, p.id DESC LIMIT 6")
        top = db.q("SELECT b.user_id, b.display_name, b.group_title, b.group_link, (SELECT COUNT(*) FROM follows f WHERE f.bcast_id=b.user_id) AS followers "
                   "FROM broadcasters b WHERE b.status='active' ORDER BY followers DESC, b.created_at LIMIT 8")
        n = db.one("SELECT COUNT(*) AS n FROM broadcasters WHERE status='active'")["n"]
        return JSONResponse({"posts": [{"id": r["id"], "title": r["title"], "excerpt": r["body"][:180] + ("…" if len(r["body"]) > 180 else ""), "symbol": r["symbol"], "tf": r["tf"],
                                        "published_at": r["published_at"], "author": r["display_name"], "group": r["group_title"], "views": r["views"], "likes": r["likes"]} for r in rows],
                             "broadcasters": [{"name": b["display_name"], "group": b["group_title"], "link": b["group_link"], "followers": b["followers"]} for b in top], "broadcaster_count": n},
                            headers={"Cache-Control": "public, max-age=60"})

    def client_ip(ctx):
        xf = ctx.request.headers.get("x-forwarded-for", "")
        return xf.split(",")[0].strip() if xf else (ctx.request.client.host if ctx.request.client else "?")

    # ——— bot ile web girişi (alan adı tanımı gerektirmez) ———
    LOGIN_TTL = 600

    def login_row(code):
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,40}", code or ""):
            return None
        r = db.one("SELECT * FROM login_codes WHERE code=?", (code,))
        return r if r and now() - r["created_at"] <= LOGIN_TTL else None

    @route("/api/auth/code", methods=("POST",), public=True)
    def auth_code(ctx):
        ip = client_ip(ctx)
        rate(ip, "logincode", 12, 600)
        db.x("DELETE FROM login_codes WHERE created_at < ?", (now() - 3600,))
        code = secrets.token_urlsafe(9)
        db.x("INSERT INTO login_codes (code, created_at) VALUES (?,?)", (code, now()))
        return {"code": code, "verify": code[:4].upper(), "ttl": LOGIN_TTL}

    @route("/api/auth/code/{code}", public=True)
    def auth_code_status(ctx):
        ip = client_ip(ctx)
        rate(ip, "loginpoll", 300, 600)
        r = login_row(ctx.p["code"])
        if not r or r["used"]:
            raise ApiError(404, "Kod geçersiz veya süresi dolmuş")
        if not r["user_id"]:
            return {"status": "pending"}
        if not db.x("UPDATE login_codes SET used=1 WHERE code=? AND used=0", (r["code"],)):
            raise ApiError(404, "Kod geçersiz veya süresi dolmuş")
        user = {"id": r["user_id"], "username": r["username"], "first_name": r["first_name"]}
        return {"status": "ok", "token": C.make_web_token(user, S.bot_token, now()), "user": user}

    @route("/api/auth/web", methods=("POST",), public=True)
    def auth_web(ctx):
        ip = client_ip(ctx)
        rate(ip, "webauth", 20, 600)
        try:
            user = C.verify_login_widget(ctx.body, S.bot_token, now())
        except C.AuthError as e:
            raise ApiError(401, f"Giriş doğrulanamadı: {e}")
        return {"token": C.make_web_token(user, S.bot_token, now()), "user": user}

    @route("/api/me/photo", methods=("POST",))
    def me_photo(ctx):
        """Telegram içinden: grafik görselini kullanıcının bot sohbetine gönderir (indirme/iletme için)."""
        uid = ctx.user["id"]
        rate(uid, "photo", 8, 3600)
        try:
            mime, raw = C.valid_image(str(ctx.body.get("image", "")), max_bytes=2_500_000)
        except ValueError as e:
            raise ApiError(400, str(e))
        if mime != "image/png":
            raise ApiError(400, "Yalnızca PNG")
        cap = C.clean(str(ctx.body.get("caption", "")), 200)
        r = tg_photo(uid, raw, cap)
        if S.tg is None and not (r and r.get("ok")):
            raise ApiError(502, "Görsel gönderilemedi. Önce bota /start yazın, sonra tekrar deneyin.")
        return {"ok": True}

    @route("/api/me")
    def me(ctx):
        uid = ctx.user["id"]
        b = db.one("SELECT * FROM broadcasters WHERE user_id=?", (uid,))
        pro = pro_state(uid, ctx.is_admin, bcast=b)
        pu, su = ads_today(uid)
        return {"id": uid, "username": ctx.user["username"], "first_name": ctx.user["first_name"], "is_admin": ctx.is_admin,
                "broadcaster": bcast_public(b) if b else None, "pro": pro,
                "ads": {"pro_used": pu, "pro_limit": S.pro_ads_per_day, "support_used": su, "support_limit": S.support_ads_per_day,
                        "pro_seconds_per_ad": S.pro_seconds_per_ad, "pro_max_seconds": S.pro_max_seconds},
                "config": {"adsgram_block_id": S.adsgram_block_id, "min_payout_micro": S.min_payout_micro, "demo": S.dev_mode}, "now": now()}

    # ——— akış ———
    def post_item(r, liked, full=False):
        body = r["body"]
        o = {"id": r["id"], "title": r["title"], "symbol": r["symbol"], "video": r.get("video") or "", "tf": r["tf"], "published_at": r["published_at"], "views": r["views"],
             "likes": r["likes"], "liked": r["id"] in liked, "has_image": bool(r["has_img"]),
             "author": {"id": r["author_id"], "name": r["display_name"], "group_title": r["group_title"]}}
        o["body" if full else "excerpt"] = body if full else (body[:360] + ("…" if len(body) > 360 else ""))
        return o

    POST_SELECT = ("SELECT p.id, p.title, p.body, p.symbol, p.tf, p.video, p.published_at, p.views, p.author_id, b.display_name, b.group_title, "
                   "CASE WHEN p.image <> '' THEN 1 ELSE 0 END AS has_img, (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes "
                   "FROM posts p JOIN broadcasters b ON b.user_id = p.author_id ")

    def liked_set(uid, ids):
        if not ids:
            return set()
        ph = ",".join("?" * len(ids))
        return {r["post_id"] for r in db.q(f"SELECT post_id FROM likes WHERE user_id=? AND post_id IN ({ph})", (uid, *ids))}

    @route("/api/feed")
    def feed(ctx):
        w, p = ["p.status='published'", "b.status='active'"], []
        if ctx.q.get("bcast"):
            w.append("p.author_id=?"); p.append(ctx.int_arg("bcast", ctx.q))
        if ctx.q.get("symbol"):
            sy = ctx.q["symbol"].upper()
            if not SYMBOL_RE.match(sy): raise ApiError(400, "sembol geçersiz")
            w.append("p.symbol=?"); p.append(sy)
        if ctx.q.get("following") == "1":
            w.append("p.author_id IN (SELECT bcast_id FROM follows WHERE user_id=?)"); p.append(ctx.user["id"])
        if ctx.q.get("before"):
            try:
                ts, pid = [int(x) for x in ctx.q["before"].split(":")]
            except ValueError:
                raise ApiError(400, "imleç geçersiz")
            w.append("(p.published_at < ? OR (p.published_at = ? AND p.id < ?))"); p += [ts, ts, pid]
        rows = db.q(POST_SELECT + "WHERE " + " AND ".join(w) + " ORDER BY p.published_at DESC, p.id DESC LIMIT 21", tuple(p))
        more = len(rows) > 20
        rows = rows[:20]
        liked = liked_set(ctx.user["id"], [r["id"] for r in rows])
        nxt = f"{rows[-1]['published_at']}:{rows[-1]['id']}" if more and rows else ""
        return {"items": [post_item(r, liked) for r in rows], "next": nxt}

    @route("/api/posts/{id:int}")
    def post_detail(ctx):
        pid, uid = ctx.p["id"], ctx.user["id"]
        r = db.one(POST_SELECT + "WHERE p.id=?", (pid,))
        st = db.one("SELECT status FROM posts WHERE id=?", (pid,))
        if not r or not st or (st["status"] != "published" and uid != r["author_id"] and not ctx.is_admin):
            raise ApiError(404, "Paylaşım bulunamadı")
        if st["status"] == "published" and uid != r["author_id"]:
            with db.tx():
                if db.x("INSERT INTO post_views (post_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING", (pid, uid)):
                    db.x("UPDATE posts SET views = views + 1 WHERE id=?", (pid,))
                    r["views"] += 1
        o = post_item(r, liked_set(uid, [pid]), full=True)
        o["status"] = st["status"]
        o["following"] = bool(db.one("SELECT 1 AS x FROM follows WHERE user_id=? AND bcast_id=?", (uid, r["author_id"])))
        return o

    @route("/api/posts/{id:int}/image", public=True)
    def post_image(ctx):
        r = db.one("SELECT p.image FROM posts p JOIN broadcasters b ON b.user_id=p.author_id WHERE p.id=? AND p.status='published' AND b.status='active' AND p.image<>''", (ctx.p["id"],))
        if not r:
            raise ApiError(404, "Görsel yok")
        mime, raw = C.valid_image(r["image"])
        return Response(raw, media_type=mime, headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})

    @route("/api/like", methods=("POST",))
    def like(ctx):
        pid, on = ctx.int_arg("post_id"), bool(ctx.body.get("on"))
        if not db.one("SELECT 1 AS x FROM posts WHERE id=? AND status='published'", (pid,)):
            raise ApiError(404, "Paylaşım bulunamadı")
        rate(ctx.user["id"], "like", 60, 60)
        if on:
            db.x("INSERT INTO likes (post_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING", (pid, ctx.user["id"]))
        else:
            db.x("DELETE FROM likes WHERE post_id=? AND user_id=?", (pid, ctx.user["id"]))
        return {"likes": db.one("SELECT COUNT(*) AS n FROM likes WHERE post_id=?", (pid,))["n"], "liked": on}

    @route("/api/follow", methods=("POST",))
    def follow(ctx):
        bid, on = ctx.int_arg("bcast_id"), bool(ctx.body.get("on"))
        if bid == ctx.user["id"]: raise ApiError(400, "Kendinizi takip edemezsiniz")
        if not db.one("SELECT 1 AS x FROM broadcasters WHERE user_id=? AND status='active'", (bid,)):
            raise ApiError(404, "Yayıncı bulunamadı")
        rate(ctx.user["id"], "follow", 60, 60)
        if on:
            db.x("INSERT INTO follows (user_id, bcast_id, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING", (ctx.user["id"], bid, now()))
        else:
            db.x("DELETE FROM follows WHERE user_id=? AND bcast_id=?", (ctx.user["id"], bid))
        return {"following": on, "followers": db.one("SELECT COUNT(*) AS n FROM follows WHERE bcast_id=?", (bid,))["n"]}

    @route("/api/report", methods=("POST",))
    def report(ctx):
        pid = ctx.int_arg("post_id")
        p = db.one("SELECT status, title FROM posts WHERE id=?", (pid,))
        if not p or p["status"] != "published": raise ApiError(404, "Paylaşım bulunamadı")
        rate(ctx.user["id"], "report", 10, 3600)
        db.x("INSERT INTO reports (post_id, user_id, reason, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
             (pid, ctx.user["id"], C.clean(ctx.body.get("reason"), 200), now()))
        n = db.one("SELECT COUNT(*) AS n FROM reports WHERE post_id=?", (pid,))["n"]
        if n >= S.auto_hide_reports:
            db.x("UPDATE posts SET status='hidden', reason=? WHERE id=? AND status='published'", (f"{n} şikayet", pid))
            audit(0, "auto_hide", f"post {pid}, {n} şikayet")
            notify_admins(f"⚠️ Paylaşım {n} şikayetle otomatik gizlendi: {p['title'][:60]}")
        return {"ok": True}

    @route("/api/broadcasters")
    def broadcasters(ctx):
        rows = db.q("SELECT b.*, (SELECT COUNT(*) FROM follows f WHERE f.bcast_id=b.user_id) AS followers, "
                    "(SELECT COUNT(*) FROM posts p WHERE p.author_id=b.user_id AND p.status='published') AS posts "
                    "FROM broadcasters b WHERE b.status='active' ORDER BY followers DESC, b.created_at")
        mine = {r["bcast_id"] for r in db.q("SELECT bcast_id FROM follows WHERE user_id=?", (ctx.user["id"],))}
        return {"items": [bcast_public(r, r["followers"], r["user_id"] in mine, r["posts"]) for r in rows]}

    @route("/api/broadcasters/{id:int}")
    def broadcaster(ctx):
        bid = ctx.p["id"]
        b = db.one("SELECT * FROM broadcasters WHERE user_id=? AND status='active'", (bid,))
        if not b: raise ApiError(404, "Yayıncı bulunamadı")
        f = db.one("SELECT COUNT(*) AS n FROM follows WHERE bcast_id=?", (bid,))["n"]
        mine = bool(db.one("SELECT 1 AS x FROM follows WHERE user_id=? AND bcast_id=?", (ctx.user["id"], bid)))
        n = db.one("SELECT COUNT(*) AS n FROM posts WHERE author_id=? AND status='published'", (bid,))["n"]
        return bcast_public(b, f, mine, n)

    # ——— reklam ———
    @route("/api/ads/start", methods=("POST",))
    def ads_start(ctx):
        uid, placement = ctx.user["id"], ctx.body.get("placement")
        if placement not in ("support", "pro_bcast", "pro_owner"):
            raise ApiError(400, "Yerleşim geçersiz")
        src_type, src_id, post_id = "owner", 0, 0
        if placement != "pro_owner":
            post_id = ctx.int_arg("post_id")
            p = db.one("SELECT p.author_id FROM posts p JOIN broadcasters b ON b.user_id=p.author_id WHERE p.id=? AND p.status='published' AND b.status='active'", (post_id,))
            if not p: raise ApiError(404, "Paylaşım bulunamadı")
            if p["author_id"] != uid:  # yayıncı kendi sayfasından izlerse gelir sahibe yazılır
                src_type, src_id = "broadcaster", p["author_id"]
        pu, su = ads_today(uid)
        if placement.startswith("pro"):
            b = db.one("SELECT * FROM broadcasters WHERE user_id=?", (uid,))
            ps = pro_state(uid, ctx.is_admin, bcast=b)
            if ps["active"] and ps["source"] != "ads": raise ApiError(400, "Hesabınızda Pro zaten açık")
            if pu >= S.pro_ads_per_day: raise ApiError(429, "Bugünkü reklam hakkınız doldu")
            if ps["until"] - now() >= S.pro_max_seconds - 60: raise ApiError(429, "Pro süresi üst sınırda")
        elif su >= S.support_ads_per_day:
            raise ApiError(429, "Bugünkü destek reklamı sınırına ulaştınız")
        sid = secrets.token_urlsafe(12)
        with db.tx():
            db.x("UPDATE ad_sessions SET status='expired' WHERE user_id=? AND status='pending'", (uid,))
            db.x("INSERT INTO ad_sessions (id, user_id, placement, post_id, src_type, src_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
                 (sid, uid, placement, post_id, src_type, src_id, "pending", now()))
        return {"session": sid}

    def verify_ad(uid):
        """Adsgram bildirimi geldi: kullanıcının bekleyen son oturumunu doğrular, Pro'yu verir."""
        t = now()
        with db.tx():
            s = db.one("SELECT * FROM ad_sessions WHERE user_id=? AND status='pending' AND created_at>=? ORDER BY created_at DESC LIMIT 1", (uid, t - 900))
            if not s:
                db.x("INSERT INTO ad_orphans (user_id, created_at) VALUES (?,?)", (uid, t))
                return None
            db.x("UPDATE ad_sessions SET status='verified', verified_at=?, day=? WHERE id=? AND status='pending'", (t, C.day_of(t), s["id"]))
            if s["placement"].startswith("pro"):
                u = db.one("SELECT pro_until FROM users WHERE id=?", (uid,))
                base = max(t, u["pro_until"] if u else 0)
                db.x("UPDATE users SET pro_until=? WHERE id=?", (min(base + S.pro_seconds_per_ad, t + S.pro_max_seconds), uid))
            return s["id"]

    @route("/api/adsgram/reward", public=True)
    def adsgram_reward(ctx):
        sec = ctx.q.get("secret", "")
        if not S.adsgram_secret and not S.dev_mode: raise ApiError(403, "Reward URL yapılandırılmamış")
        if S.adsgram_secret and not hmac.compare_digest(sec.encode(), S.adsgram_secret.encode()): raise ApiError(403, "Geçersiz gizli anahtar")
        try:
            uid = int(ctx.q.get("userid") or ctx.q.get("userId") or "")
        except ValueError:
            raise ApiError(400, "userid yok")
        verify_ad(uid)
        return PlainTextResponse("ok")

    @route("/api/dev/reward", methods=("POST",))
    def dev_reward(ctx):
        if not S.dev_mode: raise ApiError(404, "Bulunamadı")
        return {"session": verify_ad(ctx.user["id"])}

    @route("/api/ads/status")
    def ads_status(ctx):
        s = db.one("SELECT status, placement FROM ad_sessions WHERE id=? AND user_id=?", (ctx.q.get("session", ""), ctx.user["id"]))
        if not s: raise ApiError(404, "Oturum yok")
        b = db.one("SELECT * FROM broadcasters WHERE user_id=?", (ctx.user["id"],))
        return {"status": s["status"], "placement": s["placement"], "pro": pro_state(ctx.user["id"], ctx.is_admin, bcast=b)}

    # ——— yayıncı ———
    def own_post_dict(r):
        return {"id": r["id"], "title": r["title"], "symbol": r["symbol"], "tf": r["tf"], "status": r["status"], "reason": r["reason"],
                "created_at": r["created_at"], "published_at": r["published_at"], "views": r["views"], "has_image": bool(r["has_img"])}

    @route("/api/b/posts", methods=("POST",), role="bcast")
    def b_post_create(ctx):
        b, uid = ctx.bcast, ctx.user["id"]
        title, body = C.clean(ctx.body.get("title"), 120), C.clean(ctx.body.get("body"), 4000)
        sym, tf = str(ctx.body.get("symbol") or "").upper(), str(ctx.body.get("tf") or "")
        if len(title) < 5: raise ApiError(422, "Başlık en az 5 karakter olmalı")
        if len(body) < 40: raise ApiError(422, "Metin en az 40 karakter olmalı")
        if sym and not SYMBOL_RE.match(sym): raise ApiError(422, "Sembol geçersiz")
        if tf and tf not in TFS: raise ApiError(422, "Zaman dilimi geçersiz")
        bad = C.content_check(title, body)
        if bad:
            raise ApiError(422, "Yasak ifade var: " + ", ".join(f"“{x}”" for x in bad) + ". Al/sat çağrısı, hedef fiyat, garanti kazanç ve VIP/sinyal grubu tanıtımı yasaktır.", phrases=bad)
        video = ""
        if ctx.body.get("video"):
            video = C.youtube_id(ctx.body["video"])
            if not video:
                raise ApiError(422, "Video bağlantısı geçerli bir YouTube adresi olmalı")
        image = ""
        if ctx.body.get("image"):
            try:
                C.valid_image(ctx.body["image"])
            except ValueError as e:
                raise ApiError(422, str(e))
            image = ctx.body["image"]
        n = db.one("SELECT COUNT(*) AS n FROM posts WHERE author_id=? AND created_at>=?", (uid, now() - 86400))["n"]
        if n >= S.posts_per_day: raise ApiError(429, f"Günde en fazla {S.posts_per_day} paylaşım yapabilirsiniz")
        t = now()
        status = "published" if b["auto_approve"] else "pending"
        row = db.q("INSERT INTO posts (author_id, title, body, symbol, tf, image, video, status, created_at, published_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id",
                   (uid, title, body, sym, tf, image, video, status, t, t if status == "published" else 0))[0]
        if status == "pending":
            notify_admins(f"🆕 Onay bekleyen paylaşım: {title[:70]} ({b['display_name']})")
        return {"id": row["id"], "status": status}

    @route("/api/b/posts", role="bcast")
    def b_posts(ctx):
        rows = db.q("SELECT id, title, symbol, tf, status, reason, created_at, published_at, views, CASE WHEN image <> '' THEN 1 ELSE 0 END AS has_img FROM posts WHERE author_id=? AND status<>'removed' ORDER BY created_at DESC LIMIT 50", (ctx.user["id"],))
        return {"items": [own_post_dict(r) for r in rows]}

    @route("/api/b/posts/{id:int}", methods=("DELETE",), role="bcast")
    def b_post_delete(ctx):
        n = db.x("UPDATE posts SET status='removed', reason='yayıncı sildi' WHERE id=? AND author_id=? AND status<>'removed'", (ctx.p["id"], ctx.user["id"]))
        if not n: raise ApiError(404, "Paylaşım bulunamadı")
        return {"ok": True}

    @route("/api/b/profile", methods=("PUT",), role="bcast")
    def b_profile(ctx):
        name, bio, gt, gl = C.clean(ctx.body.get("display_name"), 40), C.clean(ctx.body.get("bio"), 300), C.clean(ctx.body.get("group_title"), 60), C.clean(ctx.body.get("group_link"), 80)
        if len(name) < 2: raise ApiError(422, "Görünen ad en az 2 karakter olmalı")
        if gl and not C.GROUP_LINK_RE.match(gl): raise ApiError(422, "Grup bağlantısı https://t.me/... biçiminde olmalı")
        db.x("UPDATE broadcasters SET display_name=?, bio=?, group_title=?, group_link=? WHERE user_id=?", (name, bio, gt, gl, ctx.user["id"]))
        return {"ok": True}

    @route("/api/b/wallet", methods=("POST",), role="bcast")
    def b_wallet(ctx):
        net, addr = str(ctx.body.get("network") or ""), str(ctx.body.get("address") or "").strip()
        if not C.valid_wallet(net, addr): raise ApiError(422, f"Adres {net or 'seçilen'} ağı için geçerli görünmüyor")
        if db.one("SELECT 1 AS x FROM payouts WHERE bcast_id=? AND status='pending'", (ctx.user["id"],)):
            raise ApiError(409, "Bekleyen ödeme talebiniz varken cüzdan değiştirilemez")
        db.x("UPDATE broadcasters SET wallet=?, network=? WHERE user_id=?", (addr, net, ctx.user["id"]))
        audit(ctx.user["id"], "wallet", f"{net} {addr[:6]}…")
        return {"ok": True}

    @route("/api/b/me", role="bcast")
    def b_me(ctx):
        b, uid, t = ctx.bcast, ctx.user["id"], now()
        L = ledger().get(uid, EMPTY)
        st = {r["status"]: r["n"] for r in db.q("SELECT status, COUNT(*) AS n FROM posts WHERE author_id=? GROUP BY status", (uid,))}
        views = db.one("SELECT COALESCE(SUM(views),0) AS v FROM posts WHERE author_id=?", (uid,))["v"]
        fol = db.one("SELECT COUNT(*) AS n FROM follows WHERE bcast_id=?", (uid,))["n"]
        d30 = C.day_of(t - 30 * 86400)
        ads = {r["placement"]: r["n"] for r in db.q("SELECT placement, COUNT(*) AS n FROM ad_sessions WHERE status='verified' AND src_type='broadcaster' AND src_id=? AND day>=? GROUP BY placement", (uid, d30))}
        by_day = db.q("SELECT day, COUNT(*) AS n FROM ad_sessions WHERE status='verified' AND src_type='broadcaster' AND src_id=? AND day>=? GROUP BY day ORDER BY day", (uid, d30))
        pays = db.q("SELECT id, amount_micro, network, wallet, status, txid, note, created_at, decided_at FROM payouts WHERE bcast_id=? ORDER BY id DESC LIMIT 20", (uid,))
        return {"profile": {**bcast_public(b), "wallet": b["wallet"], "network": b["network"], "share_bps": b["share_bps"], "auto_approve": bool(b["auto_approve"])},
                "stats": {"posts": st, "views": int(views), "followers": fol, "support_ads_30d": ads.get("support", 0), "pro_ads_30d": ads.get("pro_bcast", 0), "ads_by_day": by_day},
                "ledger": {k: v for k, v in L.items() if k != "by_day"}, "by_day": L["by_day"][:30], "payouts": pays, "min_payout_micro": S.min_payout_micro}

    @route("/api/b/payout", methods=("POST",), role="bcast")
    def b_payout(ctx):
        b, uid = ctx.bcast, ctx.user["id"]
        with db.tx():
            if not b["wallet"] or not C.valid_wallet(b["network"], b["wallet"]): raise ApiError(422, "Önce geçerli bir cüzdan adresi kaydedin")
            if db.one("SELECT 1 AS x FROM payouts WHERE bcast_id=? AND status='pending'", (uid,)): raise ApiError(409, "Bekleyen bir ödeme talebiniz var")
            av = ledger().get(uid, EMPTY)["available"]
            if av < S.min_payout_micro:
                raise ApiError(422, f"Ödenebilir bakiye en az {S.min_payout_micro / C.MICRO:.0f} USD olmalı", available=av)
            pid = db.q("INSERT INTO payouts (bcast_id, amount_micro, network, wallet, status, created_at) VALUES (?,?,?,?,?,?) RETURNING id",
                       (uid, av, b["network"], b["wallet"], "pending", now()))[0]["id"]
        notify_admins(f"💸 Ödeme talebi #{pid}: {b['display_name']} · {av / C.MICRO:.2f} USD ({b['network']})")
        return {"id": pid, "amount_micro": av}

    # ——— yönetim ———
    @route("/api/admin/overview", role="admin")
    def a_overview(ctx):
        t, today = now(), C.day_of(now())
        L = ledger()
        d7, d30 = C.day_of(t - 7 * 86400), C.day_of(t - 30 * 86400)
        cnt = lambda sql, p=(): db.one(sql, p)["n"]
        by_src = {}
        for r in db.q("SELECT src_type, src_id, SUM(CASE WHEN day=? THEN 1 ELSE 0 END) AS today, SUM(CASE WHEN day>=? THEN 1 ELSE 0 END) AS d7, SUM(CASE WHEN day>=? THEN 1 ELSE 0 END) AS d30, COUNT(*) AS total "
                      "FROM ad_sessions WHERE status='verified' GROUP BY src_type, src_id", (today, d7, d30)):
            by_src[(r["src_type"], r["src_id"])] = {k: int(r[k]) for k in ("today", "d7", "d30", "total")}
        zero = {"today": 0, "d7": 0, "d30": 0, "total": 0}
        rows = []
        for b in db.q("SELECT b.*, (SELECT COUNT(*) FROM follows f WHERE f.bcast_id=b.user_id) AS followers, (SELECT COUNT(*) FROM posts p WHERE p.author_id=b.user_id AND p.status='published') AS posts FROM broadcasters b ORDER BY b.created_at"):
            l = L.get(b["user_id"], EMPTY)
            rows.append({"id": b["user_id"], "name": b["display_name"], "status": b["status"], "auto_approve": bool(b["auto_approve"]), "share_bps": b["share_bps"],
                         "followers": b["followers"], "posts": b["posts"], "ads": by_src.get(("broadcaster", b["user_id"]), zero),
                         **{k: l[k] for k in ("accrued", "collected", "awaiting", "available", "pending", "paid", "unapproved_ads")}})
        rev = db.one("SELECT COALESCE(SUM(revenue_micro),0) AS r, COALESCE(SUM(CASE WHEN collected=1 THEN revenue_micro ELSE 0 END),0) AS c FROM days")
        accrued_all = sum(r["accrued"] for r in rows)
        return {"users": cnt("SELECT COUNT(*) AS n FROM users"), "dau": cnt("SELECT COUNT(*) AS n FROM users WHERE last_seen>=?", (t - 86400,)),
                "pending_posts": cnt("SELECT COUNT(*) AS n FROM posts WHERE status='pending'"), "hidden_posts": cnt("SELECT COUNT(*) AS n FROM posts WHERE status='hidden'"),
                "pending_payouts": db.one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_micro),0) AS s FROM payouts WHERE status='pending'"),
                "owner_ads": by_src.get(("owner", 0), zero), "orphans": cnt("SELECT COUNT(*) AS n FROM ad_orphans WHERE created_at>=?", (t - 7 * 86400,)),
                "approved_revenue_micro": int(rev["r"]), "collected_revenue_micro": int(rev["c"]), "broadcaster_accrued_micro": accrued_all,
                "owner_net_micro": int(rev["r"]) - accrued_all, "broadcasters": rows}

    @route("/api/admin/broadcasters", methods=("POST",), role="admin")
    def a_bcast_add(ctx):
        uid, name = ctx.int_arg("user_id"), C.clean(ctx.body.get("display_name"), 40)
        gt, gl = C.clean(ctx.body.get("group_title"), 60), C.clean(ctx.body.get("group_link"), 80)
        if uid <= 0 or len(name) < 2: raise ApiError(422, "Telegram kimliği ve ad gerekli")
        if gl and not C.GROUP_LINK_RE.match(gl): raise ApiError(422, "Grup bağlantısı https://t.me/... biçiminde olmalı")
        bps = ctx.int_arg("share_bps", default=S.default_share_bps)
        if not 0 <= bps <= 10000: raise ApiError(422, "Pay 0 ile 10000 arasında olmalı")
        db.x("INSERT INTO broadcasters (user_id, display_name, group_title, group_link, status, auto_approve, share_bps, created_at) VALUES (?,?,?,?,?,?,?,?) "
             "ON CONFLICT (user_id) DO UPDATE SET display_name=excluded.display_name, group_title=excluded.group_title, group_link=excluded.group_link, status='active'",
             (uid, name, gt, gl, "active", 1 if ctx.body.get("auto_approve") else 0, bps, now()))
        audit(ctx.user["id"], "bcast_add", f"{uid} {name}")
        notify(uid, "🎉 Beacon yayıncısı olarak eklendiniz. Uygulamayı açıp Hesap sekmesinden yayıncı panelinize ulaşabilirsiniz.")
        return {"ok": True}

    @route("/api/admin/broadcasters/{id:int}", methods=("PATCH",), role="admin")
    def a_bcast_patch(ctx):
        bid, sets, p = ctx.p["id"], [], []
        if "status" in ctx.body:
            if ctx.body["status"] not in ("active", "suspended"): raise ApiError(422, "Durum geçersiz")
            sets.append("status=?"); p.append(ctx.body["status"])
        if "auto_approve" in ctx.body: sets.append("auto_approve=?"); p.append(1 if ctx.body["auto_approve"] else 0)
        if "share_bps" in ctx.body:
            bps = ctx.int_arg("share_bps")
            if not 0 <= bps <= 10000: raise ApiError(422, "Pay 0 ile 10000 arasında olmalı")
            sets.append("share_bps=?"); p.append(bps)
        if not sets: raise ApiError(400, "Değişiklik yok")
        if not db.x(f"UPDATE broadcasters SET {', '.join(sets)} WHERE user_id=?", (*p, bid)): raise ApiError(404, "Yayıncı bulunamadı")
        audit(ctx.user["id"], "bcast_patch", f"{bid} {ctx.body}")
        return {"ok": True}

    def admin_post_rows(status):
        return db.q("SELECT p.id, p.title, p.body, p.symbol, p.tf, p.status, p.reason, p.created_at, p.author_id, b.display_name, CASE WHEN p.image <> '' THEN 1 ELSE 0 END AS has_img, "
                    "(SELECT COUNT(*) FROM reports r WHERE r.post_id=p.id) AS reports FROM posts p JOIN broadcasters b ON b.user_id=p.author_id WHERE p.status=? ORDER BY p.created_at LIMIT 50", (status,))

    @route("/api/admin/posts", role="admin")
    def a_posts(ctx):
        st = ctx.q.get("status", "pending")
        if st not in ("pending", "hidden"): raise ApiError(400, "Durum geçersiz")
        return {"items": [{**{k: r[k] for k in ("id", "title", "body", "symbol", "tf", "status", "reason", "created_at", "author_id", "display_name", "reports")}, "has_image": bool(r["has_img"])} for r in admin_post_rows(st)]}

    @route("/api/admin/posts/{id:int}/image", role="admin")
    def a_post_image(ctx):
        r = db.one("SELECT image FROM posts WHERE id=? AND image<>''", (ctx.p["id"],))
        if not r: raise ApiError(404, "Görsel yok")
        mime, raw = C.valid_image(r["image"])
        return Response(raw, media_type=mime, headers={"X-Content-Type-Options": "nosniff"})

    @route("/api/admin/posts/{id:int}/{action}", methods=("POST",), role="admin")
    def a_post_action(ctx):
        pid, act = ctx.p["id"], ctx.p["action"]
        p = db.one("SELECT author_id, title, status FROM posts WHERE id=?", (pid,))
        if not p: raise ApiError(404, "Paylaşım bulunamadı")
        reason = C.clean(ctx.body.get("reason"), 200)
        if act == "approve":
            db.x("UPDATE posts SET status='published', reason='', published_at=? WHERE id=?", (now(), pid))
            db.x("DELETE FROM reports WHERE post_id=?", (pid,))
            notify(p["author_id"], f"✅ Paylaşımınız yayında: {p['title'][:70]}")
        elif act == "reject":
            if not reason: raise ApiError(422, "Ret nedeni yazın")
            db.x("UPDATE posts SET status='rejected', reason=? WHERE id=?", (reason, pid))
            notify(p["author_id"], f"❌ Paylaşımınız yayınlanmadı: {p['title'][:60]}\nNeden: {reason}")
        elif act == "remove":
            db.x("UPDATE posts SET status='removed', reason=? WHERE id=?", (reason or "yönetici kaldırdı", pid))
            notify(p["author_id"], f"⚠️ Paylaşımınız kaldırıldı: {p['title'][:60]}")
        else:
            raise ApiError(404, "İşlem yok")
        audit(ctx.user["id"], "post_" + act, f"{pid} {reason}")
        return {"ok": True}

    @route("/api/admin/days", role="admin")
    def a_days(ctx):
        t = now()
        have = {r["day"]: r for r in db.q("SELECT * FROM days")}
        logged = {r["day"]: r for r in db.q("SELECT day, COUNT(*) AS n, SUM(CASE WHEN src_type='broadcaster' THEN 1 ELSE 0 END) AS b FROM ad_sessions WHERE status='verified' GROUP BY day")}
        out = []
        for i in range(1, 22):
            d = C.day_of(t - i * 86400)
            l, h = logged.get(d), have.get(d)
            out.append({"day": d, "logged": int(l["n"]) if l else 0, "bcast": int(l["b"]) if l else 0,
                        "entry": {k: h[k] for k in ("impressions", "cpm_micro", "revenue_micro", "collected", "note")} if h else None})
        return {"items": out}

    @route("/api/admin/days", methods=("POST",), role="admin")
    def a_day_set(ctx):
        day = str(ctx.body.get("day") or "")
        if not DAY_RE.match(day) or day >= C.day_of(now()): raise ApiError(422, "Gün YYYY-AA-GG biçiminde ve dünden önce olmalı")
        imp = ctx.int_arg("impressions")
        if imp < 0: raise ApiError(422, "Gösterim negatif olamaz")
        try:
            cpm = C.usd_to_micro(ctx.body.get("cpm"))
        except ValueError:
            raise ApiError(422, "CPM geçersiz")
        if cpm < 0 or cpm > 500 * C.MICRO: raise ApiError(422, "CPM makul aralıkta olmalı")
        rev = C.revenue_micro(imp, cpm)
        db.x("INSERT INTO days (day, impressions, cpm_micro, revenue_micro, collected, note, updated_at) VALUES (?,?,?,?,?,?,?) "
             "ON CONFLICT (day) DO UPDATE SET impressions=excluded.impressions, cpm_micro=excluded.cpm_micro, revenue_micro=excluded.revenue_micro, collected=excluded.collected, note=excluded.note, updated_at=excluded.updated_at",
             (day, imp, cpm, rev, 1 if ctx.body.get("collected") else 0, C.clean(ctx.body.get("note"), 120), now()))
        audit(ctx.user["id"], "day_set", f"{day} imp={imp} cpm={cpm} collected={bool(ctx.body.get('collected'))}")
        return {"ok": True, "revenue_micro": rev}

    @route("/api/admin/payouts", role="admin")
    def a_payouts(ctx):
        st = ctx.q.get("status", "pending")
        rows = db.q("SELECT p.*, b.display_name FROM payouts p JOIN broadcasters b ON b.user_id=p.bcast_id WHERE p.status=? ORDER BY p.id DESC LIMIT 50", (st,))
        L = ledger()
        for r in rows:
            r["ledger_available_if_rejected"] = L.get(r["bcast_id"], EMPTY)["available"] + (r["amount_micro"] if st == "pending" else 0)
        return {"items": rows}

    @route("/api/admin/payouts/{id:int}/{action}", methods=("POST",), role="admin")
    def a_payout_action(ctx):
        pid, act = ctx.p["id"], ctx.p["action"]
        with db.tx():
            p = db.one("SELECT * FROM payouts WHERE id=?", (pid,))
            if not p: raise ApiError(404, "Talep bulunamadı")
            if p["status"] != "pending": raise ApiError(409, "Talep zaten sonuçlanmış")
            if act == "pay":
                tx = C.clean(ctx.body.get("txid"), 120)
                if len(tx) < 8: raise ApiError(422, "İşlem kimliğini (txid) yazın")
                db.x("UPDATE payouts SET status='paid', txid=?, decided_at=? WHERE id=?", (tx, now(), pid))
                msg = f"💸 Ödemeniz gönderildi: {p['amount_micro'] / C.MICRO:.2f} USD ({p['network']}).\nİşlem: {tx}"
            elif act == "reject":
                note = C.clean(ctx.body.get("note"), 200)
                if not note: raise ApiError(422, "Ret nedeni yazın")
                db.x("UPDATE payouts SET status='rejected', note=?, decided_at=? WHERE id=?", (note, now(), pid))
                msg = f"Ödeme talebiniz reddedildi: {note}\nTutar bakiyenize döndü."
            else:
                raise ApiError(404, "İşlem yok")
            audit(ctx.user["id"], "payout_" + act, f"{pid} {p['amount_micro']}")
        notify(p["bcast_id"], msg)
        return {"ok": True}

    @route("/api/admin/adjust", methods=("POST",), role="admin")
    def a_adjust(ctx):
        bid = ctx.int_arg("bcast_id")
        try:
            amt = C.usd_to_micro(ctx.body.get("amount_usd"))
        except ValueError:
            raise ApiError(422, "Tutar geçersiz")
        note = C.clean(ctx.body.get("note"), 120)
        if not amt or not note: raise ApiError(422, "Tutar ve açıklama gerekli")
        if not db.one("SELECT 1 AS x FROM broadcasters WHERE user_id=?", (bid,)): raise ApiError(404, "Yayıncı bulunamadı")
        db.x("INSERT INTO adjustments (bcast_id, amount_micro, note, created_at) VALUES (?,?,?,?)", (bid, amt, note, now()))
        audit(ctx.user["id"], "adjust", f"{bid} {amt} {note}")
        return {"ok": True}

    @route("/api/admin/grants", role="admin")
    def a_grants(ctx):
        return {"items": db.q("SELECT g.*, u.username, u.first_name FROM grants g LEFT JOIN users u ON u.id=g.user_id ORDER BY g.user_id")}

    @route("/api/admin/grants", methods=("POST",), role="admin")
    def a_grant_set(ctx):
        uid, days = ctx.int_arg("user_id"), ctx.int_arg("days", default=30)
        if uid <= 0 or not 0 <= days <= 3650: raise ApiError(422, "Kimlik veya süre geçersiz")
        until = 0 if days == 0 else now() + days * 86400
        db.x("INSERT INTO grants (user_id, until, note) VALUES (?,?,?) ON CONFLICT (user_id) DO UPDATE SET until=excluded.until, note=excluded.note", (uid, until, C.clean(ctx.body.get("note"), 60)))
        audit(ctx.user["id"], "grant", f"{uid} {days}g")
        return {"ok": True}

    @route("/api/admin/grants/{id:int}", methods=("DELETE",), role="admin")
    def a_grant_del(ctx):
        db.x("DELETE FROM grants WHERE user_id=?", (ctx.p["id"],))
        audit(ctx.user["id"], "grant_del", ctx.p["id"])
        return {"ok": True}

    @route("/api/admin/audit", role="admin")
    def a_audit(ctx):
        return {"items": db.q("SELECT * FROM audit ORDER BY id DESC LIMIT 60")}

    # ——— Telegram bot (Adsgram moderasyonu botun /start'a yanıt vermesini ister) ———
    async def webhook(request):
        if S.webhook_secret and not hmac.compare_digest(request.headers.get("x-telegram-bot-api-secret-token", "").encode(), S.webhook_secret.encode()):
            return PlainTextResponse("forbidden", status_code=403)
        try:
            upd = await request.json()
            msg = upd.get("message") or {}
            text, chat = (msg.get("text") or ""), (msg.get("chat") or {}).get("id")
            cb = upd.get("callback_query")
            if cb and str(cb.get("data", "")).startswith("lg:"):
                code, who = cb["data"][3:], cb.get("from") or {}
                r = await run_in_threadpool(login_row, code)
                ok = False
                if r and not r["used"] and not r["user_id"] and who.get("id"):
                    await run_in_threadpool(db.x, "UPDATE login_codes SET user_id=?, username=?, first_name=? WHERE code=? AND user_id=0",
                                            (int(who["id"]), C.clean(who.get("username"), 40), C.clean(who.get("first_name"), 60), code))
                    ok = True
                await run_in_threadpool(tg, "answerCallbackQuery", {"callback_query_id": cb.get("id"), "text": "Giriş onaylandı" if ok else "Kod geçersiz veya süresi dolmuş"})
                m = cb.get("message") or {}
                if m.get("chat"):
                    await run_in_threadpool(tg, "editMessageText", {"chat_id": m["chat"]["id"], "message_id": m.get("message_id"),
                                            "text": "✅ Giriş onaylandı. Tarayıcıdaki Beacon sayfasına dönebilirsiniz." if ok else "Bu giriş kodunun süresi dolmuş. Siteden yeniden deneyin."})
                return PlainTextResponse("ok")
            if chat and text.startswith("/start login_"):
                code = text[len("/start login_"):].strip()
                r = await run_in_threadpool(login_row, code)
                if r and not r["used"] and not r["user_id"]:
                    await run_in_threadpool(tg, "sendMessage", {"chat_id": chat, "text": f"Beacon web girişi isteği.\n\nDoğrulama kodu: {code[:4].upper()}\nBu kod tarayıcıdaki kodla aynıysa ve girişi siz başlattıysanız onaylayın. Başlatmadıysanız hiçbir şey yapmayın.",
                                                                "reply_markup": {"inline_keyboard": [[{"text": "✅ Girişi onayla", "callback_data": "lg:" + code}]]}})
                else:
                    await run_in_threadpool(tg, "sendMessage", {"chat_id": chat, "text": "Bu giriş kodunun süresi dolmuş. Siteden yeniden deneyin."})
                return PlainTextResponse("ok")
            if chat and text.startswith(("/start", "/help")):
                kb = {"inline_keyboard": [[{"text": "Beacon'ı aç", "web_app": {"url": S.app_url}}]]} if S.app_url else None
                payload = {"chat_id": chat, "text": "Beacon: kripto analiz terminali ve topluluk. Grafikler, skor, formasyonlar ve yayıncıların analizleri tek uygulamada.\n\nYatırım tavsiyesi değildir."}
                if kb: payload["reply_markup"] = kb
                await run_in_threadpool(tg, "sendMessage", payload)
        except Exception:
            traceback.print_exc()
        return PlainTextResponse("ok")
    routes.append(Route("/tg/webhook", webhook, methods=["POST"]))

    origins = [u for u in (S.app_url, S.site_url) if u] or ["*"]
    app = Starlette(routes=routes, middleware=[Middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["x-init-data", "content-type"])])
    app.state.db, app.state.settings, app.state.market = db, S, market
    if S.bot_token and S.public_url and not S.dev_mode and not S.tg and not os.environ.get("VERCEL"):  # sunucusuz ortamda arka plan iş parçacığı yaşamaz: webhook elle kaydedilir
        threading.Thread(target=lambda: tg("setWebhook", {"url": S.public_url + "/tg/webhook", "secret_token": S.webhook_secret or None, "allowed_updates": ["message", "callback_query"]}), daemon=True).start()
    return app
    # Dosyanın en altına eklenecek:
app = default_app()


def default_app():
    return create_app()
