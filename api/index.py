"""Vercel giriş noktası: Beacon API (Starlette ASGI).
Başlatma hata verirse 500 yerine nedenini gösteren küçük bir teşhis uygulaması çalışır (sırlar maskelenir)."""
import json
import os
import re
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    if not os.environ.get("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL ortam değişkeni tanımlı değil (Vercel > Settings > Environment Variables). Vercel'de dosya sistemi salt okunur olduğu için SQLite çalışmaz; Neon Postgres adresi gerekir.")
    from server.app import create_app  # noqa: E402

    app = create_app()
except Exception as exc:  # noqa: BLE001
    tb = traceback.format_exc()
    for k in ("DATABASE_URL", "BOT_TOKEN", "WEBHOOK_SECRET", "ADSGRAM_SECRET", "COINGECKO_KEY"):
        v = os.environ.get(k)
        if v:
            tb = tb.replace(v, "***")
    tb = re.sub(r"(postgres(?:ql)?://)[^\s'\"]+", r"\1***", tb)
    body = json.dumps({"error": "startup_failed", "type": type(exc).__name__, "message": re.sub(r"(postgres(?:ql)?://)[^\s'\"]+", r"\1***", str(exc)), "trace": tb[-3000:],
                       "env_present": {k: bool(os.environ.get(k)) for k in ("DATABASE_URL", "BOT_TOKEN", "WEBHOOK_SECRET", "PUBLIC_URL")}}, ensure_ascii=False).encode()

    async def app(scope, receive, send):  # noqa: D401
        if scope["type"] != "http":
            return
        await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"application/json; charset=utf-8"), (b"access-control-allow-origin", b"*")]})
        await send({"type": "http.response.body", "body": body})
