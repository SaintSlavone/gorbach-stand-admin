"""Dependency-free Gorbach chat stand."""

import argparse
import base64
from email import policy
from email.parser import BytesParser
import hmac
import json
import os
from pathlib import Path
import threading
import time
import sqlite3
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

from conversation import Conversation, language
from crm import CRM, CRMError
from flow import COPY, starters, survey_validate
from knowledge import LIMITS, DataError, KnowledgeStore
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

    def __init__(self, address, store, model, password="", origin="", day_limit=1500, enabled=True, crm=None, public=True):
        self.store = store
        self.model = model
        self.password = password
        self.origin = origin
        self.enabled = enabled
        self.crm = crm
        self.public = public
        self.conversation = Conversation(crm, self) if crm else None
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
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type != "application/octet-stream" else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.path.startswith("/admin") or self.path.startswith("/api/admin/"):
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        if self.path.startswith("/api/") and not self.path.startswith("/api/admin/"):
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
        if not password and not self.server.crm:
            self.fail(503, "admin_disabled", "Administrace není nakonfigurována.")
            return False
        if not self.server.limits.reserve(self.client_address[0], "admin"):
            self.fail(429, "rate", "Zkuste to prosím za chvíli.", (("Retry-After", "60"),))
            return False
        auth = self.headers.get("Authorization", "")
        try:
            credential = base64.b64decode(auth.split(" ", 1)[1], validate=True) if auth.startswith("Basic ") else b""
            user, separator, supplied = credential.partition(b":")
            if user == b"admin" and separator and password and hmac.compare_digest(supplied, password.encode()):
                self.staff = "admin"
                return True
            if separator and self.server.crm and len(user) <= 320 and len(supplied) <= 4096 and self.server.crm.staff_valid(user.decode(), supplied.decode()):
                self.staff = user.decode()
                return True
        except (ValueError, sqlite3.Error):
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

    def read_upload(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            content_type = self.headers.get("Content-Type", "")
            if not 0 < length <= 10 * 1024**2 + 64 * 1024 or not content_type.startswith("multipart/form-data"):
                raise CRMError("size" if length > 10 * 1024**2 else "invalid_attachment")
            message = BytesParser(policy=policy.default).parsebytes(
                f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii") + self.rfile.read(length)
            )
            parts = {}
            for part in message.iter_parts():
                key = part.get_param("name", header="content-disposition")
                if key in parts or key not in ("sid", "file"):
                    raise CRMError("invalid_attachment")
                parts[key] = part
            return (parts["sid"].get_payload(decode=True).decode(), parts["file"].get_filename() or "",
                    parts["file"].get_payload(decode=True))
        except (ValueError, KeyError, OSError) as exc:
            raise CRMError("invalid_attachment") from exc

    def guarded(self, action):
        try:
            return action()
        except CRMError as exc:
            self.fail(exc.status, exc.code, "Požadavek se nepodařilo dokončit.")
        except (OSError, DataError, sqlite3.Error):
            self.fail(503, "unavailable", "Služba je dočasně nedostupná.")

    def stateful(self, endpoint, raw):
        if not self.allowed_origin(widget=True):
            return self.fail(403, "origin", "Nepovolený původ požadavku.")
        conversation = self.server.conversation
        if endpoint == "status":
            lang = language(raw.get("lang"))
            return self.response(200, {"enabled": self.server.enabled, "public": self.server.public,
                                       "start": {"greeting": COPY[lang]["greeting"], "chips": starters(lang)}})
        if not self.server.enabled:
            raise CRMError("disabled", 503)
        if not self.server.limits.reserve(self.client_address[0], endpoint if endpoint != "msg" else "turn"):
            raise CRMError("rate", 429)
        if endpoint == "file":
            return self.response(200, conversation.upload(*self.read_upload()))
        if not isinstance(raw, dict):
            raise CRMError("invalid_body")
        if endpoint == "start":
            result = conversation.start(raw)
        elif endpoint == "msg":
            result = conversation.turn(raw, self.client_address[0])
        else:
            result = getattr(conversation, endpoint)(raw.get("sid"))
        return self.response(200, result)

    def admin_crm(self, path, args=None, raw=None):
        if not self.admin_allowed():
            return
        if raw is not None and not self.allowed_origin():
            return self.fail(403, "origin", "Nepovolený původ požadavku.")
        if raw is not None and not isinstance(raw, dict):
            raise CRMError("bad_request")
        crm = self.server.crm
        if path in ("leads", "dialogs", "stats") and raw is None:
            return self.response(200, {"ok": True, **crm.dashboard(path, args)})
        if path == "leads" and raw is not None:
            crm.change_lead(raw)
            return self.response(200, {"ok": True})
        if path == "survey":
            with crm.connection(write=raw is not None) as db:
                if raw is not None:
                    crm.save_revision(db, "survey", survey_validate(raw.get("content")), self.staff, raw.get("version"))
                row = crm.revision(db, "survey")
                return self.response(200, {"ok": True, "version": row["id"], "content": json.loads(row["content"])})
        if path.startswith("files/") and raw is None:
            name, blob = self.server.conversation.download(path.removeprefix("files/"))
            return self.response(200, blob, "application/octet-stream", (("Content-Disposition", "attachment; filename*=UTF-8''" + quote(name, safe="")),))
        self.fail(404, "not_found", "Stránka nebyla nalezena.")

    def do_OPTIONS(self):
        if urlsplit(self.path).path in ("/api/cbot/status", "/api/cbot/msg", "/api/status", "/api/start",
                                       "/api/msg", "/api/history", "/api/reset", "/api/submit", "/api/file") and self.allowed_origin(widget=True):
            self.response(204, extra=(("Access-Control-Allow-Methods", "GET, POST"), ("Access-Control-Allow-Headers", "Content-Type")))
        else:
            self.fail(403, "origin", "Nepovolený původ požadavku.")

    def do_GET(self):
        url = urlsplit(self.path)
        path = url.path
        args = parse_qs(url.query)
        if self.server.crm and path in ("/api/status", "/api/history"):
            return self.guarded(lambda: self.stateful(path.split("/")[-1], {key: value[0] for key, value in args.items()}))
        if self.server.crm and path.startswith("/api/admin/") and path != "/api/admin/kb":
            return self.guarded(lambda: self.admin_crm(path.removeprefix("/api/admin/"), args))
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
                data = self.server.crm.current_knowledge() if self.server.crm else self.server.store.read()
                return self.response(200, {"ok": True, **data, "limits": LIMITS, "bot_enabled": self.server.bot_enabled})
            except (DataError, OSError, sqlite3.Error):
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
        if self.server.crm and path in ("/api/start", "/api/msg", "/api/reset", "/api/submit", "/api/file"):
            def stateful():
                if not self.allowed_origin(widget=True):
                    raise CRMError("origin", 403)
                endpoint = path.split("/")[-1]
                return self.stateful(endpoint, self.read_json(128 * 1024) if endpoint != "file" else {})
            return self.guarded(stateful)
        if self.server.crm and path in ("/api/admin/leads", "/api/admin/survey"):
            return self.guarded(lambda: self.admin_crm(path.removeprefix("/api/admin/"), raw=self.read_json(768 * 1024)))
        if path == "/api/admin/kb":
            if not self.admin_allowed():
                return
            if not self.allowed_origin():
                return self.fail(403, "origin", "Nepovolený původ požadavku.")
            try:
                body = self.read_json(768 * 1024)
                saved = self.server.crm.save_knowledge(body, self.staff) if self.server.crm else self.server.store.save(body)
            except CRMError as exc:
                return self.fail(exc.status, exc.code, "Znalosti se od načtení změnily.")
            except DataError as exc:
                return self.fail(400, "bad_request", str(exc))
            except (OSError, sqlite3.Error):
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
            data = self.server.crm.current_knowledge() if self.server.crm else self.server.store.read()
            reply = self.server.model.reply(data, history, text)
        except (ModelError, DataError, OSError, sqlite3.Error):
            return self.fail(503, "unavailable", "Odpověď se nepodařilo získat. Zkuste to prosím znovu.")
        finally:
            self.server.slots.release()
        self.response(200, {"ok": True, "reply": reply})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.getenv("GORBACH_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("GORBACH_PORT", "8790")))
    parser.add_argument("--import-sqlite", type=Path, help="Copy the latest existing knowledge revision into a new JSON file")
    parser.add_argument("--add-staff", metavar="LOGIN", help="Add a staff account using GORBACH_STAFF_PASSWORD")
    args = parser.parse_args()
    store = KnowledgeStore(Path(os.getenv("GORBACH_KB_FILE", ROOT / ".gorbach" / "knowledge.json")))
    if args.import_sqlite:
        store.import_sqlite(args.import_sqlite)
        return
    crm = CRM(Path(os.getenv("GORBACH_DATA_DIR", ROOT / ".gorbach")), store)
    if args.add_staff:
        crm.add_staff(args.add_staff, os.getenv("GORBACH_STAFF_PASSWORD", ""))
        return
    model = Gemini(os.getenv("GEMINI_API_KEY", ""), os.getenv("GEMINI_MODEL", "gemini-3.8-flash"))
    server = StandServer((args.host, args.port), store, model, os.getenv("ADMIN_PASSWORD", ""),
                         os.getenv("GORBACH_CLIENT_ORIGIN", ""), int(os.getenv("GORBACH_DAY_LIMIT_MSGS", "1500")),
                         os.getenv("GORBACH_CHAT_ENABLED", "true").lower() == "true", crm,
                         os.getenv("GORBACH_CHAT_PUBLIC", "true").lower() == "true")
    print(f"Gorbach stand listening on {args.host}:{server.server_port}", flush=True)
    with server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
