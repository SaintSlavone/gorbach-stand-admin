"""Dependency-free Gorbach chat stand."""

import argparse
import base64
import hmac
import json
import os
from pathlib import Path
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from knowledge import DataError, KnowledgeStore
from model import Gemini, ModelError, chat_message

ROOT = Path(__file__).resolve().parent
STATIC = {
    "/": ("index.html", "text/html"),
    "/site.css": ("site.css", "text/css"),
    "/widget/gorbach.js": ("widget/gorbach.js", "application/javascript"),
    "/admin/": ("admin/index.html", "text/html"),
    "/admin/admin.js": ("admin/admin.js", "application/javascript"),
}


class Limits:
    def __init__(self, day_limit):
        self.day_limit = day_limit
        self.day = None
        self.count = 0
        self.clients = {}
        self.lock = threading.Lock()

    def reserve(self, address, route):
        now = time.monotonic()
        today = datetime.now(timezone.utc).date()
        with self.lock:
            if today != self.day:
                self.day, self.count = today, 0
            if len(self.clients) >= 4096:
                self.clients = {key: hits for key, hits in self.clients.items() if hits[-1] > now - 60}
            key = (address, route)
            if key not in self.clients and len(self.clients) >= 4096:
                return False
            hits = self.clients.setdefault(key, deque())
            while hits and hits[0] <= now - 60:
                hits.popleft()
            if len(hits) >= (12 if route == "message" else 60):
                return False
            hits.append(now)
            if route == "message":
                if self.count >= self.day_limit:
                    return False
                self.count += 1
            return True


class StandServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store, model, password="", origin="", day_limit=1500, enabled=True):
        self.store = store
        self.model = model
        self.password = password
        self.origin = origin
        self.enabled = enabled
        self.limits = Limits(day_limit)
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(address, Handler)

    @property
    def bot_enabled(self):
        return self.enabled and self.model.enabled


class Handler(BaseHTTPRequestHandler):
    server_version = "Gorbach"
    sys_version = ""

    def setup(self):
        self.request.settimeout(35)
        super().setup()

    def log_message(self, *args):
        pass

    def response(self, status, data=b"", content_type="application/json", extra=()):
        if isinstance(data, dict):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.path.startswith("/admin") or self.path.startswith("/api/admin/"):
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        if self.path.startswith("/api/cbot/"):
            self.send_header("Vary", "Origin")
            origin = self.headers.get("Origin")
            if origin and origin == self.server.origin:
                self.send_header("Access-Control-Allow-Origin", origin)
        for name, value in extra:
            self.send_header(name, value)
        self.end_headers()
        if data:
            self.wfile.write(data)

    def fail(self, status, key, message, extra=()):
        self.response(status, {"ok": False, "error": key, "message": message}, extra=extra)

    def admin_allowed(self):
        password = self.server.password
        if not password:
            self.fail(503, "admin_disabled", "Administrace není nakonfigurována.")
            return False
        if not self.server.limits.reserve(self.client_address[0], "admin"):
            self.fail(429, "rate", "Zkuste to prosím za chvíli.", (("Retry-After", "60"),))
            return False
        auth = self.headers.get("Authorization", "")
        try:
            credential = base64.b64decode(auth.split(" ", 1)[1], validate=True) if auth.startswith("Basic ") else b""
            user, separator, supplied = credential.partition(b":")
            if user == b"admin" and separator and hmac.compare_digest(supplied, password.encode()):
                return True
        except ValueError:
            pass
        if auth:
            self.fail(403, "auth", "Neplatné přihlašovací údaje.")
        else:
            self.response(401, extra=(("WWW-Authenticate", 'Basic realm="Gorbach", charset="UTF-8"'),))
        return False

    def allowed_origin(self, widget=False):
        origin = self.headers.get("Origin")
        if not origin:
            return self.headers.get("Sec-Fetch-Site") != "cross-site"
        try:
            parsed = urlsplit(origin)
        except ValueError:
            return False
        return (
            parsed.scheme in ("http", "https")
            and parsed.netloc == self.headers.get("Host")
            and not (parsed.path or parsed.query or parsed.fragment)
        ) or bool(widget and origin == self.server.origin)

    def read_json(self, maximum):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.headers.get_content_type() != "application/json" or not 0 < length <= maximum:
                raise ValueError
            return json.loads(self.rfile.read(length).decode())
        except (ValueError, OSError) as exc:
            raise DataError("Neplatný požadavek.") from exc

    def do_OPTIONS(self):
        if urlsplit(self.path).path in ("/api/cbot/status", "/api/cbot/msg") and self.allowed_origin(widget=True):
            self.response(204, extra=(("Access-Control-Allow-Methods", "GET, POST"), ("Access-Control-Allow-Headers", "Content-Type")))
        else:
            self.fail(403, "origin", "Nepovolený původ požadavku.")

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/cbot/status":
            if not self.allowed_origin(widget=True):
                return self.fail(403, "origin", "Nepovolený původ požadavku.")
            if not self.server.limits.reserve(self.client_address[0], "status"):
                return self.fail(429, "rate", "Zkuste to prosím za chvíli.", (("Retry-After", "60"),))
            return self.response(200, {"ok": True, "enabled": self.server.bot_enabled})
        if path == "/admin":
            return self.response(302, extra=(("Location", "/admin/"),))
        if path == "/api/admin/kb":
            if not self.admin_allowed():
                return
            try:
                return self.response(200, {"ok": True, **self.server.store.read(), "bot_enabled": self.server.bot_enabled})
            except (DataError, OSError):
                return self.fail(503, "knowledge", "Znalosti nejsou dostupné.")
        if path in STATIC:
            file, content_type = STATIC[path]
            try:
                data = (ROOT / "public" / file).read_bytes()
            except FileNotFoundError:
                return self.fail(404, "not_found", "Stránka nebyla nalezena.")
            return self.response(200, data, content_type)
        self.fail(404, "not_found", "Stránka nebyla nalezena.")

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/admin/kb":
            if not self.admin_allowed():
                return
            if not self.allowed_origin():
                return self.fail(403, "origin", "Nepovolený původ požadavku.")
            try:
                saved = self.server.store.save(self.read_json(768 * 1024))
            except DataError as exc:
                return self.fail(400, "bad_request", str(exc))
            except OSError:
                return self.fail(503, "knowledge", "Změny se nepodařilo uložit.")
            return self.response(200, {"ok": True, **saved})
        if path != "/api/cbot/msg":
            return self.fail(404, "not_found", "Stránka nebyla nalezena.")
        if not self.allowed_origin(widget=True):
            return self.fail(403, "origin", "Nepovolený původ požadavku.")
        try:
            text, history = chat_message(self.read_json(128 * 1024))
        except DataError as exc:
            return self.fail(400, "bad_request", str(exc))
        if not self.server.bot_enabled:
            return self.fail(503, "disabled", "Asistent není dostupný.")
        if not self.server.slots.acquire(blocking=False):
            return self.fail(503, "unavailable", "Asistent je zaneprázdněn. Zkuste to prosím za chvíli.")
        try:
            if not self.server.limits.reserve(self.client_address[0], "message"):
                return self.fail(429, "rate", "Zkuste to prosím za chvíli.", (("Retry-After", "60"),))
            reply = self.server.model.reply(self.server.store.read(), history, text)
        except (ModelError, DataError, OSError):
            return self.fail(503, "unavailable", "Odpověď se nepodařilo získat. Zkuste to prosím znovu.")
        finally:
            self.server.slots.release()
        self.response(200, {"ok": True, "reply": reply})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.getenv("GORBACH_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("GORBACH_PORT", "8790")))
    parser.add_argument("--import-sqlite", type=Path, help="Copy the latest existing knowledge revision into a new JSON file")
    args = parser.parse_args()
    store = KnowledgeStore(Path(os.getenv("GORBACH_KB_FILE", ROOT / ".gorbach" / "knowledge.json")))
    if args.import_sqlite:
        store.import_sqlite(args.import_sqlite)
        return
    model = Gemini(os.getenv("GEMINI_API_KEY", ""), os.getenv("GEMINI_MODEL", "gemini-3.8-flash"))
    server = StandServer((args.host, args.port), store, model, os.getenv("ADMIN_PASSWORD", ""),
                         os.getenv("GORBACH_CLIENT_ORIGIN", ""), int(os.getenv("GORBACH_DAY_LIMIT_MSGS", "1500")),
                         os.getenv("GORBACH_CHAT_ENABLED", "true").lower() == "true")
    print(f"Gorbach stand listening on {args.host}:{server.server_port}", flush=True)
    with server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
