"""SQLite data and staff operations for the Gorbach stand."""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import json
from pathlib import Path
import re
import secrets
import sqlite3
import time

from knowledge import DataError, SEED, from_sections, validate

STATUSES = ("Nová", "V řešení", "Hotovo")
FILE_AGE = 180 * 86400000

SCHEMA = """
CREATE TABLE IF NOT EXISTS staff(login TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,content TEXT NOT NULL,editor TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP,provenance TEXT NOT NULL DEFAULT 'staff');
CREATE TABLE IF NOT EXISTS dialogs(id TEXT PRIMARY KEY,lang TEXT NOT NULL,page TEXT NOT NULL,created TEXT NOT NULL,product TEXT DEFAULT '',start_chip TEXT DEFAULT '',exit_field TEXT DEFAULT '',knowledge_version INTEGER,utm TEXT NOT NULL DEFAULT '{}',unsupported_streak INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,dialog TEXT REFERENCES dialogs(id) ON DELETE CASCADE,role TEXT NOT NULL,body TEXT NOT NULL,chips TEXT DEFAULT '[]',unknown INTEGER DEFAULT 0,cost REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,dialog TEXT UNIQUE NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,kind TEXT NOT NULL,product TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Nová',created TEXT NOT NULL,contact TEXT NOT NULL,summary TEXT NOT NULL,fields TEXT DEFAULT '{}',delivery TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS quote_sessions(dialog TEXT PRIMARY KEY REFERENCES dialogs(id) ON DELETE CASCADE,version INTEGER NOT NULL REFERENCES revisions(id),state TEXT NOT NULL,screen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS handoff_sessions(dialog TEXT PRIMARY KEY REFERENCES dialogs(id) ON DELETE CASCADE,question TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',contact TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lead_sequence(day TEXT PRIMARY KEY,n INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS messages_by_dialog ON messages(dialog);
"""
FILES_SCHEMA = """CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,dialog TEXT NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,name TEXT NOT NULL,bytes BLOB,storage_name TEXT UNIQUE,mime TEXT,sha256 TEXT,size INTEGER NOT NULL,created INTEGER NOT NULL,field_instance TEXT,CHECK ((storage_name IS NULL) <> (bytes IS NULL)))"""


def now():
    return datetime.now(timezone.utc).isoformat()


def millis():
    return int(time.time() * 1000)


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class CRMError(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status


class CRM:
    def __init__(self, root, store):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "admin.sqlite"
        self.store = store
        self.survey_seed = json.loads(SEED.with_name("survey.json").read_text(encoding="utf-8"))
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
            db.execute("BEGIN IMMEDIATE")
            db.execute(FILES_SCHEMA)
            for table, additions in {
                "dialogs": {"utm": "TEXT DEFAULT '{}'", "unsupported_streak": "INTEGER DEFAULT 0"},
                "messages": {"chips": "TEXT DEFAULT '[]'"},
                "revisions": {"provenance": "TEXT DEFAULT 'legacy'"},
            }.items():
                columns = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
                for column, declaration in additions.items():
                    if column not in columns:
                        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
            columns = {row["name"] for row in db.execute("PRAGMA table_info(files)")}
            if "storage_name" not in columns:
                db.execute("ALTER TABLE files RENAME TO legacy_files")
                db.execute(FILES_SCHEMA)
                db.execute("INSERT INTO files(id,dialog,name,bytes,size,created) SELECT id,dialog,name,bytes,length(bytes),? FROM legacy_files", (millis(),))
                db.execute("DROP TABLE legacy_files")
            elif "field_instance" not in columns:
                db.execute("ALTER TABLE files ADD COLUMN field_instance TEXT")
            db.execute("CREATE INDEX IF NOT EXISTS files_by_dialog ON files(dialog)")
            if self.revision(db, "survey") is None:
                self.save_revision(db, "survey", self.survey_seed, "seed", 0)
            self.sync_knowledge(db)

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def revision(db, kind):
        return db.execute("SELECT * FROM revisions WHERE kind=? ORDER BY id DESC LIMIT 1", (kind,)).fetchone()

    @staticmethod
    def save_revision(db, kind, content, editor, version):
        latest = CRM.revision(db, kind)
        if version != (latest["id"] if latest else 0):
            raise CRMError("conflict", 409)
        return db.execute(
            "INSERT INTO revisions(kind,content,editor,provenance) VALUES (?,?,?,'staff')",
            (kind, dump(content), editor),
        ).lastrowid

    def sync_knowledge(self, db):
        latest = self.revision(db, "knowledge")
        initialized = db.execute("SELECT 1 FROM settings WHERE key='python_knowledge'").fetchone()
        if initialized and latest:
            return latest["id"]
        db.execute("INSERT OR IGNORE INTO settings VALUES ('python_knowledge','1')")
        if not self.store.path.exists() and latest:
            return latest["id"]
        content = (validate(self.store.read()) if self.store.path.exists()
                   else json.loads(SEED.read_text(encoding="utf-8")))
        if latest and self.knowledge_content(latest["content"]) == content:
            return latest["id"]
        return self.save_revision(db, "knowledge", content, "knowledge", latest["id"] if latest else 0)

    @staticmethod
    def knowledge_content(content):
        parsed = json.loads(content)
        return {**from_sections(parsed), "sections": parsed} if isinstance(parsed, list) else validate(parsed)

    def current_knowledge(self):
        with self.connection(write=True) as db:
            version = self.sync_knowledge(db)
            row = db.execute("SELECT content,created FROM revisions WHERE id=?", (version,)).fetchone()
            return {**self.knowledge_content(row["content"]), "version": version, "updated_at": row["created"]}

    def save_knowledge(self, raw, staff):
        if isinstance(raw, dict) and "sections" in raw:
            sections = raw["sections"]
            if not isinstance(sections, list) or not 1 <= len(sections) <= 150:
                raise DataError("Neplatné sekce znalostí.")
            content = []
            for entry in sections:
                if not isinstance(entry, dict) or entry.get("lang") not in ("cs", "en", "de", "ru", "uk"):
                    raise DataError("Neplatný jazyk sekce.")
                title, body = entry.get("title"), entry.get("text")
                if not isinstance(title, str) or not title.strip() or len(title) > 300 or not isinstance(body, str) or not body.strip():
                    raise DataError("Vyplňte název a text sekce.")
                content.append({**entry, "title": title.strip(), "text": body.strip()})
            from_sections(content)
        else:
            content = validate(raw)
        with self.connection(write=True) as db:
            current = self.sync_knowledge(db)
            version = self.save_revision(db, "knowledge", content, staff, raw.get("version", current))
            return {**self.knowledge_content(dump(content)), "version": version, "updated_at": now()}

    def staff_valid(self, login, password):
        with self.connection() as db:
            row = db.execute("SELECT salt,hash FROM staff WHERE login=?", (login,)).fetchone()
        digest = hashlib.scrypt(password.encode(), salt=(row["salt"] if row else "unregistered").encode(), n=16384, r=8, p=1, dklen=64)
        return bool(row and hmac.compare_digest(digest.hex(), row["hash"]))

    def add_staff(self, login, password):
        if not login or len(login) > 80 or ":" in login or len(password) < 8:
            raise DataError("Use a staff login and a password of at least eight characters.")
        salt = secrets.token_hex(16)
        digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
        with self.connection(write=True) as db:
            db.execute("INSERT INTO staff(login,salt,hash) VALUES (?,?,?)", (login, salt, digest.hex()))

    def dashboard(self, section, args):
        q = args.get("q", [""])[0][:120]
        with self.connection() as db:
            if section == "leads":
                filters, params = [], []
                for key in ("status", "kind", "product", "lang"):
                    if args.get(key, [""])[0]:
                        filters.append(("d.lang" if key == "lang" else "l." + key) + "=?")
                        params.append(args[key][0])
                if args.get("date", [""])[0]:
                    filters.append("substr(l.created,1,10)=?")
                    params.append(args["date"][0])
                if q:
                    filters.append("(l.summary LIKE ? OR l.contact LIKE ? OR l.id LIKE ?)")
                    params.extend([f"%{q}%"] * 3)
                where = " WHERE " + " AND ".join(filters) if filters else ""
                rows = db.execute("SELECT l.*,d.lang,d.page FROM leads l JOIN dialogs d ON d.id=l.dialog" + where + " ORDER BY l.created DESC LIMIT 200", params)
                return {"leads": [dict(row) for row in rows], "statuses": STATUSES}
            if section == "dialogs":
                if args.get("sid"):
                    sid = args["sid"][0]
                    dialog = db.execute("SELECT * FROM dialogs WHERE id=?", (sid,)).fetchone()
                    if not dialog:
                        raise CRMError("unknown_session", 404)
                    return {"dialog": dict(dialog), "messages": [dict(row) for row in db.execute(
                        "SELECT role,body,unknown FROM messages WHERE dialog=? ORDER BY id", (sid,)
                    )], "files": self.files(db, sid)}
                rows = db.execute("""
                    SELECT d.*,(SELECT COUNT(*) FROM messages m WHERE m.dialog=d.id) AS messages
                    FROM dialogs d WHERE ?='' OR d.page LIKE ? OR d.id LIKE ? OR EXISTS
                    (SELECT 1 FROM messages m WHERE m.dialog=d.id AND m.body LIKE ?)
                    ORDER BY d.created DESC LIMIT 200""", (q, f"%{q}%", f"%{q}%", f"%{q}%"))
                return {"dialogs": [dict(row) for row in rows]}
            dialogs = db.execute("SELECT COUNT(*) FROM dialogs").fetchone()[0]
            leads = db.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
            return {"dialogs": dialogs, "leads": leads, "conversion": round(100 * leads / dialogs, 1) if dialogs else 0,
                    "messages": db.execute("SELECT COUNT(*) FROM messages").fetchone()[0],
                    "unknown": db.execute("SELECT COUNT(*) FROM messages WHERE unknown=1").fetchone()[0],
                    "cost": db.execute("SELECT COALESCE(SUM(cost),0) FROM messages").fetchone()[0],
                    "groups": {key: [dict(row) for row in db.execute(
                        f"SELECT {key} AS label,COUNT(*) AS count FROM dialogs WHERE {key}<>'' GROUP BY {key} ORDER BY count DESC LIMIT 100"
                    )] for key in ("product", "lang", "page", "start_chip", "exit_field")}}

    @staticmethod
    def files(db, sid):
        return [dict(row) for row in db.execute(
            "SELECT id,name,size,field_instance FROM files WHERE dialog=? AND created>? ORDER BY created,id",
            (sid, millis() - FILE_AGE),
        )]

    def change_lead(self, raw):
        names = []
        if not isinstance(raw.get("id"), str):
            raise CRMError("bad_request")
        with self.connection(write=True) as db:
            lead = db.execute("SELECT dialog FROM leads WHERE id=?", (raw.get("id"),)).fetchone()
            if not lead:
                raise CRMError("not_found", 404)
            if raw.get("action") == "status" and raw.get("status") in STATUSES:
                db.execute("UPDATE leads SET status=? WHERE id=?", (raw["status"], raw["id"]))
            elif raw.get("action") == "delete" and raw.get("confirm") is True:
                names = [row["storage_name"] for row in db.execute(
                    "SELECT storage_name FROM files WHERE dialog=? AND storage_name IS NOT NULL", (lead["dialog"],)
                )]
                db.execute("DELETE FROM dialogs WHERE id=?", (lead["dialog"],))
            else:
                raise CRMError("bad_request")
        directory = self.root / "attachments"
        if not directory.is_symlink():
            for name in names:
                if re.fullmatch(r"[0-9a-f]{32}", name):
                    (directory / name).unlink(missing_ok=True)
