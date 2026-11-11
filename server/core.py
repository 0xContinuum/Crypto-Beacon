"""Saf mantık: ayarlar, Telegram kimlik doğrulama, kazanç dağıtımı, cüzdan ve içerik kontrolü.
Veritabanına ve ağa dokunmaz; hepsi birim testle doğrulanır."""
import hashlib
import hmac
import json
import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

MICRO = 1_000_000


def _ids(s):
    return {int(x) for x in re.findall(r"\d+", s or "")}


@dataclass
class Settings:
    bot_token: str = ""
    database_url: str = ""
    admin_ids: set = field(default_factory=lambda: {6394985954})
    adsgram_secret: str = ""
    adsgram_block_id: str = ""
    webhook_secret: str = ""
    app_url: str = ""          # statik sitenin adresi (CORS ve /start düğmesi)
    public_url: str = ""       # bu API'nin adresi (webhook kaydı)
    site_url: str = ""         # tanıtım sitesinin adresi (CORS)
    dev_mode: bool = False
    pro_seconds_per_ad: int = 3600
    pro_max_seconds: int = 6 * 3600
    pro_ads_per_day: int = 6
    support_ads_per_day: int = 20
    min_payout_micro: int = 100 * MICRO
    default_share_bps: int = 5000
    broadcaster_pro: bool = True
    posts_per_day: int = 10
    auto_hide_reports: int = 3
    clock: object = time.time
    tg: object = None          # test için: callable(method, payload)
    market_get: object = None  # test için: callable(url) -> json (CoinGecko yerine)
    market_gap: float = 2.5    # CoinGecko istekleri arası bekleme (sn)
    market_auto: bool = True   # arka planda endeksleri yenile

    @staticmethod
    def from_env():
        e = os.environ.get
        return Settings(
            bot_token=e("BOT_TOKEN", ""), database_url=e("DATABASE_URL", ""),
            admin_ids=_ids(e("ADMIN_IDS", "6394985954")) or {6394985954},
            adsgram_secret=e("ADSGRAM_SECRET", ""), adsgram_block_id=e("ADSGRAM_BLOCK_ID", ""),
            webhook_secret=e("WEBHOOK_SECRET", ""), app_url=e("APP_URL", "").rstrip("/"),
            public_url=e("PUBLIC_URL", "").rstrip("/"), site_url=e("SITE_URL", "").rstrip("/"), dev_mode=e("DEV_MODE", "") == "1")

    def now(self):
        return int(self.clock())


def day_of(ts):
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


# ——— Telegram kimlik doğrulama ———
class AuthError(Exception):
    pass


def verify_init_data(init_data, bot_token, now, max_age=86400):
    """Telegram Mini App initData imzasını doğrular, kullanıcı sözlüğünü döndürür."""
    if not init_data or not bot_token:
        raise AuthError("kimlik yok")
    pairs = urllib.parse.parse_qsl(init_data, keep_blank_values=True)
    data = dict(pairs)
    got = data.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    want = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not got or not hmac.compare_digest(got, want):
        raise AuthError("imza geçersiz")
    try:
        if now - int(data.get("auth_date", "0")) > max_age:
            raise AuthError("oturum süresi dolmuş")
        user = json.loads(data.get("user", "{}"))
        uid = int(user["id"])
    except (ValueError, KeyError, TypeError):
        raise AuthError("kullanıcı bilgisi okunamadı")
    return {"id": uid, "username": user.get("username") or "", "first_name": user.get("first_name") or ""}


def sign_init_data(user, bot_token, auth_date):
    """Yalnızca test için: geçerli imzalı initData üretir."""
    data = {"auth_date": str(auth_date), "user": json.dumps(user, separators=(",", ":")), "query_id": "AAH"}
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(data)


# ——— para ———
def usd_to_micro(x):
    try:
        d = Decimal(str(x).replace(",", "."))
    except InvalidOperation:
        raise ValueError("sayı geçersiz")
    if d.is_nan() or d.is_infinite():
        raise ValueError("sayı geçersiz")
    return int(d * MICRO)


def revenue_micro(impressions, cpm_micro):
    """Adsgram günlük gelir = gösterim × CPM / 1000 (tam sayı, aşağı yuvarlanır)."""
    return impressions * cpm_micro // 1000


def earning(day_rev_micro, impressions, total_logged, n_bcast, share_bps):
    """Bir yayıncının bir güne ait kazancı.
    Payda en az Adsgram gösterimi kadardır: bizim kayıt sayımız Adsgram'ı aşsa bile dağıtılan toplam gerçek geliri aşmaz."""
    denom = max(impressions, total_logged, 1)
    gross = day_rev_micro * n_bcast // denom
    return gross * share_bps // 10000


def build_ledger(days, counts, totals, shares, adjustments, payouts, default_bps=5000):
    """days: {gün: {revenue_micro, impressions, collected}}; counts: [(gün, yayıncı, n)];
    totals: {gün: toplam doğrulanmış reklam}; shares: {yayıncı: bps};
    adjustments: {yayıncı: toplam}; payouts: [(yayıncı, durum, tutar)].
    Dönüş: {yayıncı: {accrued, collected, awaiting, adjust, paid, pending, available, by_day}}"""
    out = {}
    for day, bid, n in counts:
        d = days.get(day)
        row = out.setdefault(bid, {"accrued": 0, "collected": 0, "by_day": [], "unapproved_ads": 0})
        if not d:
            row["unapproved_ads"] += n
            continue
        e = earning(d["revenue_micro"], d["impressions"], totals.get(day, n), n, shares.get(bid, default_bps))
        row["accrued"] += e
        if d["collected"]:
            row["collected"] += e
        row["by_day"].append({"day": day, "ads": n, "earned": e, "collected": bool(d["collected"])})
    for bid in set(shares) | set(adjustments) | {p[0] for p in payouts}:
        out.setdefault(bid, {"accrued": 0, "collected": 0, "by_day": [], "unapproved_ads": 0})
    for bid, row in out.items():
        row["adjust"] = adjustments.get(bid, 0)
        row["paid"] = sum(a for b, s, a in payouts if b == bid and s == "paid")
        row["pending"] = sum(a for b, s, a in payouts if b == bid and s == "pending")
        row["awaiting"] = row["accrued"] - row["collected"]
        row["available"] = row["collected"] + row["adjust"] - row["paid"] - row["pending"]
        row["by_day"].sort(key=lambda r: r["day"], reverse=True)
    return out


# ——— cüzdan ———
WALLET_RE = {
    "TON": re.compile(r"^(UQ|EQ)[A-Za-z0-9_\-]{46}$"),
    "TRC20": re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$"),
    "BEP20": re.compile(r"^0x[0-9a-fA-F]{40}$"),
}


def valid_wallet(network, address):
    r = WALLET_RE.get(network)
    return bool(r and r.match(address or ""))


# ——— içerik ———
HARD_BLOCK = [
    r"garanti(li)?\s+(kazan|kâr|kar|getiri)", r"kesin\s+(kazan|kâr|kar|yüksel|düş)", r"risksiz", r"\b\d{2,}\s?x\b", r"\bx\d{2,}\b",
    r"\bvip\b", r"ücretli\s+sinyal", r"sinyal\s+grubu", r"özel\s+(grup|kanal|sinyal)", r"al[ıi]m\s+sinyali", r"sat[ıi][şs]\s+sinyali",
    r"\b(al|sat)\s*[!:]", r"hemen\s+(al|sat)", r"\bbuy\s+now\b", r"\bsell\s+now\b", r"kald[ıi]ra[çc]\s*\d+\s*x?", r"\b(long|short)\s+gir",
    r"hedef\s+fiyat", r"stop\s+loss\s*[:=]", r"\btp\s*[:=]", r"\bsl\s*[:=]", r"para\s+kat[ıi]p", r"mesaj\s+at[ıi]n", r"\bdm\b",
]
HARD_RE = [re.compile(p, re.I) for p in HARD_BLOCK]
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f‪-‮⁦-⁩]")


def clean(s, limit):
    return CTRL.sub("", (s or "").strip())[:limit]


def content_check(title, body):
    """Kesin yasak ifadeleri döndürür. Boş liste = ilk filtreyi geçti (admin onayı yine de gerekir)."""
    text = f"{title}\n{body}"
    return sorted({m.group(0).strip() for r in HARD_RE for m in [r.search(text)] if m})


def valid_image(data_url, max_bytes=250_000):
    """data:image/(jpeg|png|webp);base64,... doğrular; (mime, bytes) döndürür."""
    import base64
    m = re.match(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$", data_url or "")
    if not m:
        raise ValueError("görsel biçimi geçersiz")
    raw = base64.b64decode(m.group(2), validate=True)
    if len(raw) > max_bytes:
        raise ValueError("görsel çok büyük")
    magic = {"image/jpeg": raw[:3] == b"\xff\xd8\xff", "image/png": raw[:8] == b"\x89PNG\r\n\x1a\n", "image/webp": raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"}
    if not magic[m.group(1)]:
        raise ValueError("görsel içeriği türüyle uyuşmuyor")
    return m.group(1), raw


YT_RE = re.compile(r"^(?:https?://)?(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$")


def youtube_id(s):
    """YouTube bağlantısından (veya doğrudan 11 karakterlik kimlikten) video kimliği; yoksa ''."""
    s = (s or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    m = YT_RE.match(s)
    return m.group(1) if m else ""


GROUP_LINK_RE = re.compile(r"^https://t\.me/[A-Za-z0-9_+\-/]{3,64}$")


# ——— web girişi (Telegram Login Widget) ———
def _b64(b):
    import base64
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(t):
    import base64
    return base64.urlsafe_b64decode(t + "=" * (-len(t) % 4))


def verify_login_widget(data, bot_token, now, max_age=3600):
    """Telegram Login Widget verisini doğrular (anahtar = SHA256(bot_token))."""
    if not bot_token or not isinstance(data, dict):
        raise AuthError("giriş verisi yok")
    d = {k: str(v) for k, v in data.items() if k != "hash" and v is not None}
    got = str(data.get("hash", ""))
    check = "\n".join(f"{k}={d[k]}" for k in sorted(d))
    want = hmac.new(hashlib.sha256(bot_token.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    if not got or not hmac.compare_digest(got, want):
        raise AuthError("imza geçersiz")
    try:
        if now - int(d.get("auth_date", "0")) > max_age:
            raise AuthError("oturum süresi dolmuş")
        uid = int(d["id"])
    except (ValueError, KeyError):
        raise AuthError("kullanıcı bilgisi okunamadı")
    return {"id": uid, "username": d.get("username", ""), "first_name": d.get("first_name", "")}


def sign_login_widget(user, bot_token, auth_date):
    """Yalnızca test için."""
    d = {**{k: str(v) for k, v in user.items()}, "auth_date": str(auth_date)}
    check = "\n".join(f"{k}={d[k]}" for k in sorted(d))
    d["hash"] = hmac.new(hashlib.sha256(bot_token.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    return d


def _web_key(bot_token):
    return hashlib.sha256(b"beacon-web-session:" + bot_token.encode()).digest()


def make_web_token(user, bot_token, now, ttl=30 * 86400):
    body = _b64(json.dumps({"id": user["id"], "u": user.get("username", ""), "f": user.get("first_name", ""), "exp": now + ttl}, separators=(",", ":")).encode())
    return body + "." + hmac.new(_web_key(bot_token), body.encode(), hashlib.sha256).hexdigest()


def read_web_token(token, bot_token, now):
    try:
        body, sig = token.split(".", 1)
        if not bot_token or not hmac.compare_digest(sig, hmac.new(_web_key(bot_token), body.encode(), hashlib.sha256).hexdigest()):
            raise AuthError("oturum geçersiz")
        d = json.loads(_unb64(body))
        if d["exp"] < now:
            raise AuthError("oturum süresi dolmuş")
        return {"id": int(d["id"]), "username": d.get("u", ""), "first_name": d.get("f", "")}
    except AuthError:
        raise
    except Exception:
        raise AuthError("oturum geçersiz")
