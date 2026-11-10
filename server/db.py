"""Veritabanı katmanı: test ve yerel için SQLite, canlı için Postgres (Neon).
SQL `?` yer tutucularıyla yazılır; Postgres'te otomatik `%s`'e çevrilir.
Zaman damgaları epoch saniye (BIGINT), para mikro-USD (BIGINT) tutulur: kayan nokta hatası olmaz."""
import os
import sqlite3
import threading
from decimal import Decimal
from contextlib import contextmanager

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY, username TEXT DEFAULT '', first_name TEXT DEFAULT '', created_at BIGINT, last_seen BIGINT, pro_until BIGINT DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS broadcasters (user_id BIGINT PRIMARY KEY, display_name TEXT, bio TEXT DEFAULT '', group_title TEXT DEFAULT '', group_link TEXT DEFAULT '', status TEXT DEFAULT 'active', auto_approve INTEGER DEFAULT 0, share_bps INTEGER DEFAULT 5000, wallet TEXT DEFAULT '', network TEXT DEFAULT '', created_at BIGINT)",
    "CREATE TABLE IF NOT EXISTS posts ({PK}, author_id BIGINT, title TEXT, body TEXT, symbol TEXT DEFAULT '', tf TEXT DEFAULT '', image TEXT DEFAULT '', video TEXT DEFAULT '', status TEXT, reason TEXT DEFAULT '', created_at BIGINT, published_at BIGINT DEFAULT 0, views INTEGER DEFAULT 0)",
    "CREATE INDEX IF NOT EXISTS posts_feed ON posts (status, published_at)",
    "CREATE INDEX IF NOT EXISTS posts_author ON posts (author_id, status)",
    "CREATE TABLE IF NOT EXISTS likes (post_id BIGINT, user_id BIGINT, PRIMARY KEY (post_id, user_id))",
    "CREATE TABLE IF NOT EXISTS follows (user_id BIGINT, bcast_id BIGINT, created_at BIGINT, PRIMARY KEY (user_id, bcast_id))",
    "CREATE TABLE IF NOT EXISTS reports (post_id BIGINT, user_id BIGINT, reason TEXT DEFAULT '', created_at BIGINT, PRIMARY KEY (post_id, user_id))",
    "CREATE TABLE IF NOT EXISTS post_views (post_id BIGINT, user_id BIGINT, PRIMARY KEY (post_id, user_id))",
    "CREATE TABLE IF NOT EXISTS ad_sessions (id TEXT PRIMARY KEY, user_id BIGINT, placement TEXT, post_id BIGINT DEFAULT 0, src_type TEXT, src_id BIGINT DEFAULT 0, status TEXT, created_at BIGINT, verified_at BIGINT DEFAULT 0, day TEXT DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS ads_user ON ad_sessions (user_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS ads_day ON ad_sessions (day, src_type, src_id)",
    "CREATE TABLE IF NOT EXISTS ad_orphans ({PK}, user_id BIGINT, created_at BIGINT)",
    "CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, impressions BIGINT, cpm_micro BIGINT, revenue_micro BIGINT, collected INTEGER DEFAULT 0, note TEXT DEFAULT '', updated_at BIGINT)",
    "CREATE TABLE IF NOT EXISTS payouts ({PK}, bcast_id BIGINT, amount_micro BIGINT, network TEXT, wallet TEXT, status TEXT, txid TEXT DEFAULT '', note TEXT DEFAULT '', created_at BIGINT, decided_at BIGINT DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS adjustments ({PK}, bcast_id BIGINT, amount_micro BIGINT, note TEXT DEFAULT '', created_at BIGINT)",
    "CREATE TABLE IF NOT EXISTS grants (user_id BIGINT PRIMARY KEY, until BIGINT DEFAULT 0, note TEXT DEFAULT '')",
    "CREATE TABLE IF NOT EXISTS audit ({PK}, actor BIGINT, action TEXT, detail TEXT DEFAULT '', created_at BIGINT)",
]


def plain(v):
    """Postgres SUM(BIGINT) Decimal döndürür; JSON'a çevrilemez. Tam sayıya (veya float'a) indirger."""
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


class DB:
    def __init__(self, url=None):
        self.url = url or os.environ.get("DATABASE_URL") or "sqlite:///beacon.db"
        self.pg = self.url.startswith(("postgres://", "postgresql://"))
        self.lock = threading.RLock()
        self.depth = 0
        self.conn = None
        self._connect()

    def _connect(self):
        if self.pg:
            import psycopg
            from psycopg.rows import dict_row
            # prepare_threshold=None: Neon'un havuzlayıcısı (pgbouncer) ile hazır ifade çakışması olmasın
            self.conn = psycopg.connect(self.url, autocommit=True, row_factory=dict_row, prepare_threshold=None, connect_timeout=15)
        else:
            path = self.url.replace("sqlite:///", "", 1)
            self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA journal_mode=WAL")

    def _sql(self, sql):
        return sql.replace("?", "%s") if self.pg else sql

    def _run(self, sql, params):
        sql = self._sql(sql)
        if self.pg:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            return cur
        return self.conn.execute(sql, params)

    def _exec(self, sql, params):
        try:
            return self._run(sql, params)
        except Exception as e:  # Neon boşta kalan bağlantıyı kapatabilir: bir kez yeniden bağlan
            if self.pg and self.depth == 0 and e.__class__.__name__ in ("OperationalError", "InterfaceError", "AdminShutdown", "ConnectionTimeout"):
                import time
                last = e
                for wait in (0, 1.5):
                    time.sleep(wait)
                    try:
                        self._connect()
                        return self._run(sql, params)
                    except Exception as e2:
                        last = e2
                raise last
            raise

    def q(self, sql, params=()):
        with self.lock:
            cur = self._exec(sql, params)
            return [{k: plain(v) for k, v in dict(r).items()} for r in cur.fetchall()] if cur.description else []

    def one(self, sql, params=()):
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def x(self, sql, params=()):
        with self.lock:
            return self._exec(sql, params).rowcount

    @contextmanager
    def tx(self):
        with self.lock:
            if self.depth:  # iç içe: dıştaki işleme katıl
                self.depth += 1
                try:
                    yield self
                finally:
                    self.depth -= 1
                return
            self.depth = 1
            try:
                if self.pg:
                    with self.conn.transaction():
                        yield self
                else:
                    self.conn.execute("BEGIN IMMEDIATE")
                    try:
                        yield self
                        self.conn.execute("COMMIT")
                    except BaseException:
                        self.conn.execute("ROLLBACK")
                        raise
            finally:
                self.depth = 0

    def init_schema(self):
        pk = "BIGSERIAL PRIMARY KEY" if self.pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
        pk = "id " + pk
        for s in SCHEMA:
            self.x(s.replace("{PK}", pk))
        self._migrate()

    def _has_col(self, table, col):
        if self.pg:
            return bool(self.one("SELECT 1 AS x FROM information_schema.columns WHERE table_name=? AND column_name=?", (table, col)))
        return any(r["name"] == col for r in self.q(f"PRAGMA table_info({table})"))

    def _migrate(self):
        """Var olan veritabanlarına sonradan eklenen sütunlar."""
        if not self._has_col("posts", "video"):
            self.x("ALTER TABLE posts ADD COLUMN video TEXT DEFAULT ''")
