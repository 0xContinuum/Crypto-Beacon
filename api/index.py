"""Vercel giriş noktası: Beacon API (Starlette ASGI)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.app import create_app  # noqa: E402

app = create_app()
