"""Editable reference KB and read-only import from legacy Gorbach revisions."""

from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import threading

SEED = Path(__file__).resolve().parent / "data" / "initial" / "knowledge.json"
LIMITS = {"about": 160000, "pairs": 150, "q": 300, "a": 1500, "total": 60000}
CONTROLS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class DataError(ValueError):
    pass


def clean(value):
    if not isinstance(value, str):
        raise DataError("Očekává se text.")
    if re.search(r"[\ud800-\udfff]", value):
        raise DataError("Text obsahuje neplatný znak.")
    return CONTROLS.sub(" ", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def validate(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("faq"), list):
        raise DataError("Očekává se popis společnosti a seznam otázek.")
    about = clean(raw.get("about"))
    if len(about) > LIMITS["about"] or len(raw["faq"]) > LIMITS["pairs"]:
        raise DataError("Báze znalostí překročila povolenou velikost.")
    faq = []
    for entry in raw["faq"]:
        if not isinstance(entry, dict):
            raise DataError("Neplatná otázka a odpověď.")
        q, a = clean(entry.get("q")), clean(entry.get("a"))
        if not q and not a:
            continue
        if not q or not a or len(q) > LIMITS["q"] or len(a) > LIMITS["a"]:
            raise DataError("Vyplňte otázku i odpověď v povolené délce.")
        faq.append({"q": q, "a": a})
    if sum(len(row["q"]) + len(row["a"]) for row in faq) > LIMITS["total"]:
        raise DataError("Otázky a odpovědi překročily povolenou velikost.")
    return {"about": about, "faq": faq}


def from_sections(sections):
    if not isinstance(sections, list) or not sections:
        raise DataError("Nenalezena platná revize znalostí.")
    try:
        about = "\n\n".join(section["title"] + "\n" + section["text"] for section in sections)
    except (KeyError, TypeError) as exc:
        raise DataError("Neplatná revize znalostí.") from exc
    return validate({"about": about, "faq": []})


class KnowledgeStore:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def read(self):
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {**from_sections(json.loads(SEED.read_text(encoding="utf-8"))), "updated_at": "", "limits": LIMITS}
        except ValueError as exc:
            raise DataError("Uloženou bázi znalostí se nepodařilo načíst.") from exc
        return {**validate(raw), "updated_at": raw.get("updated_at", ""), "limits": LIMITS}

    def save(self, raw, new_only=False):
        data = {**validate(raw), "updated_at": datetime.now(timezone.utc).isoformat()}
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(dir=self.path.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    json.dump(data, stream, ensure_ascii=False, indent=2)
                    stream.write("\n")
                if new_only:
                    os.link(temporary, self.path)
                else:
                    os.replace(temporary, self.path)
            finally:
                Path(temporary).unlink(missing_ok=True)
        return data

    def import_sqlite(self, database):
        # Import an offline backup. Read-only mode prevents modifying the input.
        with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
            row = connection.execute(
                "SELECT content FROM revisions WHERE kind = ? ORDER BY id DESC LIMIT 1", ("knowledge",)
            ).fetchone()
        if not row:
            raise DataError("V databázi není revize znalostí.")
        return self.save(from_sections(json.loads(row[0])), new_only=True)
