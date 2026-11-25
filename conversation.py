"""Stateful widget API built on the legacy Gorbach SQLite records."""

import hashlib
import json
import re
import secrets
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from crm import CRMError, FILE_AGE, dump, millis, now
from flow import COPY, chip, contact, instance, raw_items, starters, step, survey_answer, survey_view
from knowledge import clean
from model import ModelError

BASE = {"chips": [], "multi": False, "progress": None, "input": "text", "review": None, "pending": False}
QUOTE = re.compile(r"\b(?:price|quote|how much|preis|kosten|kolik stojí|cena|cenu|ціна|вартість|цена|стоимость)\b", re.I)
WORDSETS = {
    "cs": "jak máte prosím žaluzie venkovní nabídfte dobrý máte kolik cenu cena",
    "en": "the you your which would blinds what how english please could exterior",
    "de": "ich sie was welche wie jalousien außenjalousien deutsch bitte",
    "ru": "что какие как вы жалюзи сколько русский русского наружные",
    "uk": "чи які як ви пропонуєте зовнішні українська скільки ласка запитання",
}
EXPLICIT = {"english": "en", "deutsch": "de", "german": "de", "czech": "cs", "česky": "cs",
            "українською": "uk", "ukrainian": "uk", "русский": "ru", "russian": "ru"}


GREETINGS = {
    "ahoj": "cs", "dobrý den": "cs", "hello": "en", "hi": "en",
    "hallo": "de", "guten tag": "de", "привет": "ru", "здравствуйте": "ru",
    "привіт": "uk", "вітаю": "uk", "добрий день": "uk",
}
CAPABLE = {
    "cs": "Ano, mluvím česky. S čím vám mohu ohledně stínění pomoci?",
    "en": "Yes, I speak English. How can I help you with shading?",
    "de": "Ja, ich spreche Deutsch. Wie kann ich Ihnen bei der Beschattung helfen?",
    "ru": "Да, я говорю по-русски. Чем могу помочь вам с солнцезащитой?",
    "uk": "Так, я розмовляю українською. Чим можу допомогти вам із сонцезахистом?",
}
CAPABILITY = re.compile(
    r"(?:(?:do|can) you (?:speak|understand)|(?:sprechen|verstehen) sie|(?:sprichst|verstehst|kannst) du"
    r"|mluvíte|rozumíte|(?:ты|вы) (?:понимаешь|понимаете|говоришь|говорите)"
    r"|(?:ти|ви) (?:розумієш|розумієте|говориш|говорите|розмовляєш|розмовляєте)"
    r") (english|deutsch|german|česky|czech|русский|по-русски|українську|українською)"
)


def courtesy(text):
    phrase = re.sub(r"[.!?]+$", "", text.casefold().strip()).strip()
    if phrase in GREETINGS:
        lang = GREETINGS[phrase]
        return lang, COPY[lang]["greeting"]
    match = CAPABILITY.fullmatch(phrase)
    target = match[1] if match else phrase
    lang = {"по-русски": "ru", "українську": "uk", **EXPLICIT}.get(target)
    return (lang, CAPABLE[lang]) if lang else None


def language(value):
    code = value.lower().split("-", 1)[0] if isinstance(value, str) else ""
    return code if code in COPY else "cs"


def detected(text, default):
    words = set(re.findall(r"[^\W\d_]+", text.lower()))
    if len(words) == 1 and next(iter(words)) in EXPLICIT:
        return EXPLICIT[next(iter(words))]
    scores = sorted(((len(words.intersection(markers.split())), lang) for lang, markers in WORDSETS.items()), reverse=True)
    if re.search(r"[іїєґ]", text, re.I):
        return "uk"
    return scores[0][1] if scores[0][0] >= 2 and scores[0][0] > scores[1][0] else default


def media_type(blob):
    if blob.startswith(b"%PDF-"):
        return "application/pdf"
    if blob.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if blob.startswith(b"RIFF") and blob[8:12] == b"WEBP":
        return "image/webp"
    if len(blob) >= 16 and blob[4:8] == b"ftyp":
        brands = {blob[index:index + 4] for index in range(8, min(len(blob), 64), 4)}
        if brands & {b"heic", b"heix", b"mif1"}:
            return "image/heic"
        if b"qt  " in brands:
            return "video/quicktime"
        if brands & {b"isom", b"mp41", b"mp42", b"avc1", b"iso2"}:
            return "video/mp4"
    raise CRMError("type")


class Conversation:
    def __init__(self, crm, server):
        self.crm, self.server = crm, server

    @staticmethod
    def dialog(db, sid):
        if not isinstance(sid, str) or not re.fullmatch(r"[0-9a-f]{48}", sid):
            raise CRMError("invalid_sid")
        row = db.execute("SELECT * FROM dialogs WHERE id=?", (sid,)).fetchone()
        if not row:
            raise CRMError("unknown_session", 404)
        return row

    @staticmethod
    def record(db, sid, role, text, choices, unknown=False):
        db.execute("INSERT INTO messages(dialog,role,body,chips,unknown) VALUES (?,?,?,?,?)",
                   (sid, role, text, dump(choices), int(unknown)))
        return {"role": role, "text": text}

    def start(self, raw):
        page = raw.get("page")
        utm = raw.get("utm", {})
        if (not isinstance(page, str) or not page.strip() or len(page) > 4096 or not isinstance(raw.get("lang"), str)
                or not isinstance(utm, dict) or not all(isinstance(value, str) for value in utm.values())
                or len(dump(utm)) > 8192):
            raise CRMError("invalid_start")
        lang, sid = language(raw["lang"]), secrets.token_hex(24)
        with self.crm.connection(write=True) as db:
            version = self.crm.sync_knowledge(db)
            db.execute("INSERT INTO dialogs(id,lang,page,created,knowledge_version,utm) VALUES (?,?,?,?,?,?)",
                       (sid, lang, page, now(), version, dump(utm)))
            choices = starters(lang)
            greeting = self.record(db, sid, "bot", COPY[lang]["greeting"], choices)
        return {"sid": sid, "lang": lang, "messages": [greeting], "chips": choices}

    def reset(self, sid):
        with self.crm.connection() as db:
            dialog = self.dialog(db, sid)
        return {"sid": self.start({"lang": dialog["lang"], "page": dialog["page"], "utm": json.loads(dialog["utm"])})["sid"]}

    def survey(self, db, sid):
        row = db.execute("SELECT q.*,r.content FROM quote_sessions q JOIN revisions r ON r.id=q.version WHERE q.dialog=?", (sid,)).fetchone()
        if row:
            state = json.loads(row["state"])
            key = "services" if state.get("intake") == "service" else "products"
            return state, json.loads(row["content"])[key], row["version"], self.crm.survey_seed[key]
        return None

    @staticmethod
    def handoff_screen(row, lang):
        copy = COPY[lang]
        screen = {**BASE, "chips": [chip("decline_handoff", copy["decline"])]}
        if not row["name"]:
            return {**screen, "question": copy["handoff"]}
        if not row["contact"]:
            return {**screen, "question": copy["contact"], "input": "phone"}
        return {**screen, "question": copy["summary"],
                "review": {"purpose": "handoff", "products": [], "name": row["name"], **contact(row["contact"])}}

    def history(self, sid):
        with self.crm.connection() as db:
            db.execute("BEGIN")
            dialog = self.dialog(db, sid)
            lang = language(dialog["lang"])
            messages = [dict(row) for row in db.execute("SELECT role,body AS text,chips FROM messages WHERE dialog=? ORDER BY id", (sid,))]
            screen = {**BASE, "lang": lang, "chips": json.loads(messages[-1]["chips"] or "[]") if messages else []}
            lead = db.execute("SELECT id FROM leads WHERE dialog=?", (sid,)).fetchone()
            if lead:
                screen = {**BASE, "lang": lang, "lead_id": lead["id"]}
            else:
                survey = self.survey(db, sid)
                handoff = db.execute("SELECT * FROM handoff_sessions WHERE dialog=?", (sid,)).fetchone()
                if handoff:
                    screen.update(self.handoff_screen(handoff, lang))
                elif survey:
                    state, catalog, _, seed = survey
                    screen.update(survey_view(state, catalog, lang, seed, self.crm.files(db, sid)))
            return {**screen, "messages": [{"role": m["role"], "text": m["text"]} for m in messages]}

    def open_handoff(self, db, sid, question, lang):
        db.execute("INSERT INTO handoff_sessions(dialog,question) VALUES (?,?)", (sid, question))
        return self.handoff_screen({"name": "", "contact": ""}, lang)

    def handoff_answer(self, db, sid, row, kind, value, lang):
        if kind == "chip" and value == "decline_handoff":
            db.execute("DELETE FROM handoff_sessions WHERE dialog=?", (sid,))
            db.execute("UPDATE dialogs SET unsupported_streak=0 WHERE id=?", (sid,))
            return {**BASE, "question": COPY[lang]["ask"], "chips": starters(lang)}
        if kind != "text":
            raise CRMError("invalid_chip")
        row = dict(row)
        if not row["name"]:
            if "?" in value or contact(value):
                raise CRMError("invalid_name")
            row["name"] = value
        elif not row["contact"]:
            if not contact(value):
                raise CRMError("invalid_contact")
            row["contact"] = value
        else:
            raise CRMError("already_reviewed", 409)
        db.execute("UPDATE handoff_sessions SET name=?,contact=? WHERE dialog=?", (row["name"], row["contact"], sid))
        return self.handoff_screen(row, lang)

    def exchange(self, db, sid, lang, visitor, screen, unknown=False):
        db.execute("UPDATE dialogs SET lang=? WHERE id=?", (lang, sid))
        if screen.get("progress"):
            db.execute("UPDATE dialogs SET exit_field=? WHERE id=?", (screen.get("attachmentField", {})["id"] if screen.get("attachmentField") else screen["question"], sid))
        else:
            db.execute("UPDATE dialogs SET exit_field='' WHERE id=?", (sid,))
        return {**screen, "lang": lang, "messages": [
            self.record(db, sid, "visitor", visitor, []),
            self.record(db, sid, "bot", screen["question"], screen["chips"], unknown),
        ]}

    def turn(self, raw, address):
        sid = raw.get("sid")
        keys = [key for key in ("text", "chip", "chips") if key in raw]
        if not keys and raw.get("files"):
            raw = {**raw, "text": "attachment"}
            keys = ["text"]
        if len(keys) != 1:
            raise CRMError("invalid_input")
        kind = keys[0]
        values = raw[kind] if kind == "chips" else [raw[kind]]
        if not isinstance(values, list) or not 0 < len(values) <= 100 or any(
            not isinstance(value, str) or not value.strip() or len(value) > 800 for value in values
        ):
            raise CRMError("invalid_text" if kind == "text" else "invalid_chip")
        files_input = raw.get("files", [])
        if not isinstance(files_input, list) or len(files_input) > 5 or any(not isinstance(key, str) for key in files_input):
            raise CRMError("invalid_attachment")
        values = [clean(v) for v in values]
        if not all(values):
            raise CRMError("invalid_input")
        value = ", ".join(values)
        with self.crm.connection(write=True) as db:
            dialog = self.dialog(db, sid)
            lang = language(dialog["lang"])
            if db.execute("SELECT 1 FROM leads WHERE dialog=?", (sid,)).fetchone():
                raise CRMError("submitted", 409)
            previous = db.execute("SELECT id,chips FROM messages WHERE dialog=? ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
            offered = json.loads(previous["chips"] or "[]") if previous else []
            handoff = db.execute("SELECT * FROM handoff_sessions WHERE dialog=?", (sid,)).fetchone()
            survey = self.survey(db, sid)
            friendly = courtesy(value) if kind == "text" and not survey and not files_input else None
            if friendly:
                lang, reply = friendly
                db.execute("UPDATE dialogs SET lang=?,unsupported_streak=0 WHERE id=?", (lang, sid))
                if handoff:
                    self.record(db, sid, "visitor", value, [])
                    first = self.record(db, sid, "bot", reply, [])
                    screen = self.handoff_screen(handoff, lang)
                    prompt = self.record(db, sid, "bot", screen["question"], screen["chips"])
                    return {**screen, "lang": lang, "messages": [first, prompt]}
                return self.exchange(db, sid, lang, value, {**BASE, "question": reply, "chips": starters(lang)})
            if kind == "text" and not handoff and not survey:
                lang = detected(value, lang)
            files = self.crm.files(db, sid)
            if survey:
                prior_state, prior_catalog, _, prior_seed = survey
                offered = survey_view(prior_state, prior_catalog, lang, prior_seed, files)["chips"]
            visitor = ", ".join(next((c["label"] for c in offered if c["id"] == v), v) for v in values) if kind != "text" else value
            if handoff:
                if files_input:
                    raise CRMError("invalid_attachment")
                return self.exchange(db, sid, lang, visitor, self.handoff_answer(db, sid, handoff, kind, value, lang))
            category = value if kind == "chip" and value in ("quote", "service") else None
            if kind == "text" and not survey and QUOTE.search(value) and not re.search(r"\b(?:e-?mail|contact|bitcoin)\b", value, re.I):
                category = "quote"
            if survey or category:
                if survey:
                    state, catalog, version, seed = survey
                    survey_answer(state, catalog, raw, kind, values, files)
                else:
                    revision = self.crm.revision(db, "survey")
                    key = "services" if category == "service" else "products"
                    catalog, version, seed = json.loads(revision["content"])[key], revision["id"], self.crm.survey_seed[key]
                    if not any(product["fields"] for product in catalog.values()):
                        return self.exchange(db, sid, lang, visitor, {**BASE, "question": COPY[lang]["unavailable"], "chips": starters(lang)})
                    state = {"intake": category, "items": [], "choosing": True, "name": "", "contact": "", "skips": 0}
                    db.execute("UPDATE dialogs SET start_chip=? WHERE id=?", (category, sid))
                screen = survey_view(state, catalog, lang, seed, files)
                db.execute("INSERT INTO quote_sessions VALUES (?,?,?,?) ON CONFLICT(dialog) DO UPDATE SET state=excluded.state,screen=excluded.screen",
                           (sid, version, dump(state), dump(screen)))
                if state.get("intake") != "service" and state["items"]:
                    db.execute("UPDATE dialogs SET product=? WHERE id=?", (state["items"][0]["product"], sid))
                return self.exchange(db, sid, lang, visitor, screen)
            if files_input:
                raise CRMError("invalid_attachment")
            if kind == "chip" and value == "specialist" and any(c["id"] == value for c in offered):
                question = db.execute("SELECT body FROM messages WHERE dialog=? AND role='visitor' ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
                return self.exchange(db, sid, lang, visitor, self.open_handoff(db, sid, question["body"] if question else "", lang))
            if kind == "chip" and value in ("question", "products"):
                if not dialog["start_chip"]:
                    db.execute("UPDATE dialogs SET start_chip=? WHERE id=?", (value, sid))
                return self.exchange(db, sid, lang, visitor, {**BASE, "question": COPY[lang]["ask"], "chips": starters(lang)})
            if kind != "text":
                raise CRMError("invalid_chip")
            history = [{"role": ("user" if row["role"] == "visitor" else "assistant"), "text": row["body"]}
                       for row in reversed(list(db.execute("SELECT role,body FROM messages WHERE dialog=? ORDER BY id DESC LIMIT 12", (sid,))))]
            pinned = db.execute("SELECT content FROM revisions WHERE id=? AND kind='knowledge'", (dialog["knowledge_version"],)).fetchone()
            kb = self.crm.knowledge_content(pinned["content"]) if pinned else self.crm.store.read()
        if not self.server.bot_enabled or not self.server.slots.acquire(blocking=False):
            raise CRMError("unavailable", 503)
        try:
            if not self.server.limits.reserve(address, "message"):
                raise CRMError("rate", 429)
            reply = self.server.model.reply(kb, history, value, classify=True)
        except ModelError as exc:
            raise CRMError("unavailable", 503) from exc
        finally:
            self.server.slots.release()
        unknown = reply.startswith("[[UNKNOWN]]")
        if unknown:
            reply = reply.removeprefix("[[UNKNOWN]]").strip() or COPY[lang]["ask"]
        with self.crm.connection(write=True) as db:
            row = self.dialog(db, sid)
            latest = db.execute("SELECT MAX(id) FROM messages WHERE dialog=?", (sid,)).fetchone()[0]
            if latest != (previous["id"] if previous else None):
                raise CRMError("conversation_changed", 409)
            streak = (row["unsupported_streak"] or 0) + 1 if unknown else 0
            db.execute("UPDATE dialogs SET unsupported_streak=? WHERE id=?", (streak, sid))
            screen = self.open_handoff(db, sid, value, lang) if streak >= 2 else {**BASE, "question": reply, "chips": starters(lang, unknown)}
            return self.exchange(db, sid, lang, visitor, screen, unknown)

    def submit(self, sid):
        with self.crm.connection(write=True) as db:
            dialog = self.dialog(db, sid)
            lead = db.execute("SELECT id FROM leads WHERE dialog=?", (sid,)).fetchone()
            if lead:
                return {"lead_id": lead["id"]}
            handoff = db.execute("SELECT * FROM handoff_sessions WHERE dialog=?", (sid,)).fetchone()
            survey = self.survey(db, sid)
            if handoff and handoff["name"] and contact(handoff["contact"]):
                kind, product = "question", ""
                name, supplied = handoff["name"], handoff["contact"]
                fields = {"products": [], "purpose": "handoff", "question": handoff["question"], "name": name, **contact(supplied)}
                summary = handoff["question"]
            elif survey:
                state, catalog, _, seed = survey
                screen = survey_view(state, catalog, language(dialog["lang"]), seed, self.crm.files(db, sid))
                if not screen["review"]:
                    raise CRMError("incomplete")
                first = state["items"][0]["product"]
                kind = first if state.get("intake") == "service" else "quote"
                product = "" if state.get("intake") == "service" else first
                name, supplied = state["name"], state["contact"]
                fields = {"products": raw_items(state["items"]), "name": name, **contact(supplied)}
                if not product:
                    fields["serviceKind"] = kind
                summary = ", ".join(i["product"] for i in state["items"])
            else:
                raise CRMError("incomplete")
            try:
                day = datetime.now(ZoneInfo("Europe/Prague")).strftime("%Y%m%d")
            except ZoneInfoNotFoundError:
                day = datetime.now().strftime("%Y%m%d")
            db.execute("INSERT INTO lead_sequence(day,n) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET n=n+1", (day,))
            number = db.execute("SELECT n FROM lead_sequence WHERE day=?", (day,)).fetchone()["n"]
            ident = f"GZ-{day}-{number:03d}"
            db.execute("INSERT INTO leads(id,dialog,kind,product,created,contact,summary,fields) VALUES (?,?,?,?,?,?,?,?)",
                       (ident, sid, kind, product, now(), f"{name} · {supplied}", summary, dump(fields)))
            return {"lead_id": ident}

    def upload(self, sid, filename, blob):
        name = Path(filename.replace("\\", "/")).name.strip()[:200]
        if not name or not blob:
            raise CRMError("invalid_attachment")
        if len(blob) > 10 * 1024**2:
            raise CRMError("size", 413)
        mime = media_type(blob)
        with self.crm.connection(write=True) as db:
            self.dialog(db, sid)
            if db.execute("SELECT 1 FROM leads WHERE dialog=?", (sid,)).fetchone():
                raise CRMError("submitted", 409)
            db.execute("DELETE FROM files WHERE created<=?", (millis() - FILE_AGE,))
            files = self.crm.files(db, sid)
            if len(files) >= 5:
                raise CRMError("count")
            if sum(f["size"] for f in files) + len(blob) > 30 * 1024**2:
                raise CRMError("total")
            key = None
            survey = self.survey(db, sid)
            if survey:
                state, catalog, _, _ = survey
                index, fields, _ = step(state, catalog, files)
                if index >= 0:
                    key = instance(index, fields, state["items"][index])
            ident = secrets.token_hex(16)
            db.execute("INSERT INTO files(id,dialog,name,bytes,mime,sha256,size,created,field_instance) VALUES (?,?,?,?,?,?,?,?,?)",
                       (ident, sid, name, blob, mime, hashlib.sha256(blob).hexdigest(), len(blob), millis(), key))
        return {"file": {"id": ident, "name": name, "size": len(blob)}}

    def download(self, ident):
        with self.crm.connection() as db:
            row = db.execute("SELECT * FROM files WHERE id=? AND created>?", (ident, millis() - FILE_AGE)).fetchone()
            if not row:
                raise CRMError("not_found", 404)
            if row["bytes"] is not None:
                return row["name"], row["bytes"]
            name = row["storage_name"] or ""
            if not re.fullmatch(r"[0-9a-f]{32}", name):
                raise CRMError("not_found", 404)
            root = (self.crm.root / "attachments").resolve()
            file = root / name
            if file.is_symlink() or not file.is_file():
                raise CRMError("not_found", 404)
            return row["name"], file.read_bytes()
