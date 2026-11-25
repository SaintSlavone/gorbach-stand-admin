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

from crm import CRM
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
        for filename in ("kb.json", "old.sqlite", "admin.sqlite"):
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

    def test_crm_bootstrap_preserves_staff_revision_on_restart(self):
        store = KnowledgeStore(self.directory / "kb.json")
        store.path.write_text(json.dumps({"about": "Imported content", "faq": []}), encoding="utf-8")
        crm = CRM(self.directory, store)
        initial = crm.current_knowledge()
        self.assertEqual(initial["about"], "Imported content")
        edited = crm.save_knowledge({"about": "Staff content", "faq": [], "version": initial["version"]}, "admin")
        restarted = CRM(self.directory, store)
        self.assertEqual(restarted.current_knowledge()["version"], edited["version"])
        self.assertEqual(restarted.current_knowledge()["about"], "Staff content")
        self.assertEqual(json.loads(store.path.read_text(encoding="utf-8"))["about"], "Imported content")

    def test_crm_stateful_handoff_and_section_revisions(self):
        calls = []

        class Bot:
            enabled = True

            def reply(self, knowledge, history, text, classify=False):
                calls.append((knowledge, history, text, classify))
                return "[[UNKNOWN]] I can help with shading."

        store = KnowledgeStore(self.directory / "kb.json")
        crm = CRM(self.directory, store)
        crm.add_staff("sales", "mock-secret")
        auth = "Basic " + base64.b64encode(b"sales:mock-secret").decode()
        with serving(StandServer(("127.0.0.1", 0), store, Bot(), crm=crm)) as base:
            def call(path, body=None, staff=False):
                headers = {"Content-Type": "application/json"}
                if staff:
                    headers["Authorization"] = auth
                url = Request(base + path, json.dumps(body).encode() if body is not None else None, headers)
                try:
                    response = urlopen(url)
                except HTTPError as exc:
                    response = exc
                with response:
                    raw = response.read()
                    return response.status, json.loads(raw) if raw else None

            self.assertEqual(call("/api/admin/leads")[0], 401)
            status, first = call("/api/admin/kb", staff=True)
            self.assertEqual(status, 200)
            self.assertGreater(len(first["sections"]), 1)
            initial = call("/api/start", {"page": "http://stand/", "lang": "cs"})[1]
            self.assertEqual(len(initial["chips"]), 3)
            self.assertIn("AI", initial["messages"][0]["text"])
            sid = initial["sid"]
            section = {"id": "fresh", "title": "Fresh section", "lang": "en", "text": "New fact"}
            update = {"sections": [section, *first["sections"]], "version": first["version"]}
            self.assertEqual(call("/api/admin/kb", update, staff=True)[0], 200)
            self.assertEqual(call("/api/admin/kb", update, staff=True)[0], 409)
            self.assertEqual(call("/api/admin/kb", staff=True)[1]["sections"][0], section)
            first_unknown = call("/api/msg", {"sid": sid, "text": "Question about a dog"})[1]
            self.assertIsNone(first_unknown["review"])
            friendly = call("/api/msg", {"sid": sid, "text": "Привет"})[1]
            self.assertEqual(friendly["lang"], "ru")
            self.assertIn("ИИ", friendly["messages"][-1]["text"])
            capability = call("/api/msg", {"sid": sid, "text": "Ты понимаешь русский?"})[1]
            self.assertIn("говорю по-русски", capability["messages"][-1]["text"])
            self.assertEqual(len(calls), 1)
            self.assertNotIn(section, calls[0][0]["sections"])
            latest = call("/api/start", {"page": "http://stand/", "lang": "en"})[1]["sid"]
            call("/api/msg", {"sid": latest, "text": "Unrelated question"})
            self.assertIn(section, calls[-1][0]["sections"])
            call("/api/msg", {"sid": sid, "text": "Fact about dogs?"})
            second_unknown = call("/api/msg", {"sid": sid, "text": "Another question about dogs?"})[1]
            self.assertIn("специалисту", second_unknown["messages"][-1]["text"])
            call("/api/msg", {"sid": sid, "text": "English?"})
            call("/api/msg", {"sid": sid, "text": "Jane Doe"})
            review = call("/api/msg", {"sid": sid, "text": "jane@example.test"})[1]["review"]
            self.assertEqual((review["purpose"], review["name"]), ("handoff", "Jane Doe"))
            lead = call("/api/submit", {"sid": sid})[1]["lead_id"]
            self.assertEqual(call("/api/submit", {"sid": sid})[1]["lead_id"], lead)
            self.assertEqual(call("/api/history?sid=" + sid)[1]["lead_id"], lead)
            leads = call("/api/admin/leads", staff=True)[1]["leads"]
            self.assertEqual(json.loads(leads[0]["fields"])["question"], "Another question about dogs?")
            self.assertEqual(call("/api/admin/stats", staff=True)[1]["leads"], 1)
            self.assertEqual(call("/api/admin/leads", {"action": "delete", "id": lead, "confirm": True}, staff=True)[0], 200)
            self.assertEqual(call("/api/history?sid=" + sid)[0], 404)

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
