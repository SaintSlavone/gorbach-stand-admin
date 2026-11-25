import base64
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from knowledge import KnowledgeStore
from model import Gemini
from server import StandServer


@contextmanager
def serving(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class StandTest(unittest.TestCase):
    def setUp(self):
        self.directory = Path(__file__).resolve().parents[1] / ".gorbach" / f"test-{uuid4().hex}"
        self.directory.mkdir(parents=True)
        self.addCleanup(self.clean_directory)

    def clean_directory(self):
        for filename in ("kb.json", "old.sqlite"):
            (self.directory / filename).unlink(missing_ok=True)
        self.directory.rmdir()

    def test_chat_and_editor(self):
        calls = []

        class Provider(BaseHTTPRequestHandler):
            def do_POST(self):
                calls.append((self.path, self.headers.get("x-goog-api-key"), json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                payload = json.dumps({"candidates": [{"finishReason": "STOP", "content": {"parts": [
                    {"thought": True, "text": "private thought"}, {"text": "**Verified answer**"}
                ]}}]}).encode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        store = KnowledgeStore(self.directory / "kb.json")
        with serving(ThreadingHTTPServer(("127.0.0.1", 0), Provider)) as upstream:
            bot = Gemini("mock-key", "gemini-3.8-flash", base_url=upstream)
            with serving(StandServer(("127.0.0.1", 0), store, bot, password="mock-pass",
                                     origin="https://gorbach-zaluzie.cz")) as base:
                auth = "Basic " + base64.b64encode(b"admin:mock-pass").decode()

                def call(path, body=None, headers=None):
                    headers = {"Content-Type": "application/json", **(headers or {})}
                    query = Request(base + path, json.dumps(body).encode() if body is not None else None, headers)
                    try:
                        response = urlopen(query)
                    except HTTPError as exc:
                        response = exc
                    with response:
                        raw = response.read()
                        return response.status, json.loads(raw) if raw else None

                self.assertEqual(call("/api/cbot/status"), (200, {"ok": True, "enabled": True}))
                self.assertEqual(call("/api/admin/kb")[0], 401)
                self.assertIn("Venkovní žaluzie", call("/api/admin/kb", headers={"Authorization": auth})[1]["about"])
                self.assertEqual(call("/api/admin/kb", {"about": "bad", "faq": []},
                                      {"Authorization": auth, "Origin": "https://example.invalid"})[0], 403)
                status, _ = call("/api/admin/kb", {"about": "Exact company knowledge", "faq": [{"q": "Test", "a": "Answer"}]},
                                 {"Authorization": auth, "Origin": base})
                self.assertEqual(status, 200)
                status, reply = call("/api/cbot/msg", {"text": "English?", "history": [
                    {"role": "user", "text": "private@example.com"},
                    {"role": "assistant", "text": "Previous answer"},
                ]})
                self.assertEqual((status, reply), (200, {"ok": True, "reply": "Verified answer"}))
                self.assertEqual(calls[0][0], "/v1beta/models/gemini-3.8-flash:generateContent")
                self.assertEqual(calls[0][1], "mock-key")
                payload = calls[0][2]
                self.assertEqual([entry["role"] for entry in payload["contents"]], ["user", "model", "user"])
                self.assertIn("Exact company knowledge", json.dumps(payload))
                self.assertNotIn("private@example.com", json.dumps(payload))
                self.assertEqual(call("/api/cbot/msg", {"text": "Test", "history": [{"role": [], "text": "x"}]})[0], 400)
                self.assertEqual(call("/api/msg", {"text": "Test"})[0], 404)

    def test_import_uses_only_latest_knowledge_and_never_overwrites(self):
        database = self.directory / "old.sqlite"
        with sqlite3.connect(database) as source:
            source.execute("CREATE TABLE revisions (id INTEGER PRIMARY KEY, kind TEXT, content TEXT)")
            source.executemany("INSERT INTO revisions(kind, content) VALUES (?, ?)", [
                ("knowledge", json.dumps([{"title": "First", "text": "Old"}])),
                ("knowledge", json.dumps([{"title": "Second", "text": "Latest knowledge"}])),
                ("survey", "{}"),
            ])
        source.close()
        before = database.read_bytes()
        store = KnowledgeStore(self.directory / "kb.json")
        store.import_sqlite(database)
        self.assertEqual(store.read()["about"], "Second\nLatest knowledge")
        with self.assertRaises(FileExistsError):
            store.import_sqlite(database)
        self.assertEqual(database.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
