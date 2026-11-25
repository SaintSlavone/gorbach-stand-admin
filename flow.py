"""Localized quote and service questionnaires."""

from copy import deepcopy
import re

from crm import CRMError

LANGS = ("cs", "en", "de", "ru", "uk")
TEXT = {
    "cs": ("Dobrý den, jsem AI asistent Gorbach žaluzie. Co potřebujete zastínit?", "Poptávka", "Servis", "Dotaz", "Jaký produkt vás zajímá?", "Jakou službu potřebujete?", "Jak se jmenujete?", "Jaký je váš telefon nebo e-mail?", "Shrnutí poptávky", "Shrnutí požadavku", "Přeskočit", "Přidat další produkt", "Mohu dotaz předat specialistovi. Jak se jmenujete?", "Zpět k výběru stínění", "Příjem požadavků není dostupný.", "Na co se chcete zeptat?"),
    "en": ("Hello, I’m the Gorbach žaluzie AI assistant. What would you like to shade?", "Request a quote", "Service", "Ask a question", "Which product are you interested in?", "Which service do you need?", "What is your name?", "What is your phone number or email address?", "Quote summary", "Service request summary", "Skip", "Add another product", "I can pass your question to a specialist. What is your name?", "Back to choosing shading", "This enquiry form is unavailable.", "What would you like to know?"),
    "de": ("Guten Tag, ich bin der KI-Assistent von Gorbach žaluzie. Was möchten Sie beschatten?", "Angebot anfragen", "Service", "Frage stellen", "Für welches Produkt interessieren Sie sich?", "Welche Dienstleistung benötigen Sie?", "Wie heißen Sie?", "Wie lautet Ihre Telefonnummer oder E-Mail-Adresse?", "Zusammenfassung der Anfrage", "Zusammenfassung der Serviceanfrage", "Überspringen", "Weiteres Produkt hinzufügen", "Ich kann Ihre Frage weiterleiten. Wie heißen Sie?", "Zurück zur Auswahl", "Das Anfrageformular ist nicht verfügbar.", "Was möchten Sie wissen?"),
    "ru": ("Здравствуйте, я ИИ-ассистент Gorbach žaluzie. Что вы хотите затенить?", "Запросить расчёт", "Сервис", "Задать вопрос", "Какой продукт вас интересует?", "Какая услуга вам нужна?", "Как вас зовут?", "Какой у вас телефон или адрес электронной почты?", "Сводка заявки", "Сводка сервисной заявки", "Пропустить", "Добавить ещё один продукт", "Могу передать вопрос специалисту. Как вас зовут?", "Вернуться к выбору", "Приём заявок сейчас недоступен.", "Что вы хотите узнать?"),
    "uk": ("Вітаю, я ШІ-асистент Gorbach žaluzie. Що ви хочете затінити?", "Запитати вартість", "Сервіс", "Поставити питання", "Який продукт вас цікавить?", "Яка послуга вам потрібна?", "Як вас звати?", "Який у вас телефон або адреса електронної пошти?", "Підсумок заявки", "Підсумок сервісної заявки", "Пропустити", "Додати ще один продукт", "Можу передати запитання фахівцю. Як вас звати?", "Повернутися до вибору", "Приймання заявок зараз недоступне.", "Що ви хочете дізнатися?"),
}
KEYS = ("greeting", "quote", "service", "question", "product", "choose_service", "name", "contact", "summary", "service_summary", "skip", "add", "handoff", "decline", "unavailable", "ask")
COPY = {lang: dict(zip(KEYS, values)) for lang, values in TEXT.items()}
SPECIALIST = dict(zip(LANGS, ("Kontaktovat specialistu", "Contact a specialist", "Fachteam kontaktieren", "Связаться со специалистом", "Зв’язатися з фахівцем")))
MARKERS = {
    "neví": dict(zip(LANGS, ("neví", "Not specified", "Nicht angegeben", "Не указано", "Не вказано"))),
    "attachment": dict(zip(LANGS, ("Příloha přiložena", "Attachment added", "Datei angehängt", "Вложение добавлено", "Вкладення додано"))),
    "viz poznámka": dict(zip(LANGS, ("viz poznámka", "See note", "Siehe Anmerkung", "См. примечание", "Див. примітку"))),
}
SERVICE_NAMES = {
    name: dict(zip(LANGS, labels)) for name, labels in {
        "cleaning": ("Čištění", "Cleaning", "Reinigung", "Чистка", "Чищення"),
        "service": ("Servis", "Service", "Service", "Обслуживание", "Обслуговування"),
        "revision": ("Revize", "Inspection", "Überprüfung", "Проверка", "Перевірка"),
        "complaint": ("Reklamace", "Complaint", "Reklamation", "Рекламация", "Рекламація"),
        "partner": ("Spolupráce", "Partnership", "Zusammenarbeit", "Сотрудничество", "Співпраця"),
        "question": ("Dotaz", "General question", "Allgemeine Frage", "Общий вопрос", "Загальне запитання"),
    }.items()
}


def chip(key, label):
    return {"id": key, "label": label}


def starters(lang, specialist=False):
    copy = COPY[lang]
    return [chip(key, copy[key]) for key in ("quote", "service", "question")] + (
        [chip("specialist", SPECIALIST[lang])] if specialist else []
    )


def contact(text):
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", text):
        return {"email": text}
    if re.fullmatch(r"\+?[\d ()-]+", text) and 7 <= len(re.sub(r"\D", "", text)) <= 15:
        return {"phone": text}
    return None


def survey_validate(data):
    if not isinstance(data, dict):
        raise CRMError("invalid_survey")
    for kind in ("products", "services"):
        catalog = data.get(kind)
        if not isinstance(catalog, dict) or len(catalog) > 150:
            raise CRMError("invalid_survey")
        for key, entry in catalog.items():
            if not key or not isinstance(entry, dict) or not isinstance(entry.get("fields"), list) or len(entry["fields"]) > 100:
                raise CRMError("invalid_survey")
            titles = entry.get("title", {})
            if not isinstance(titles, dict) or not all(isinstance(value, str) for value in titles.values()):
                raise CRMError("invalid_survey")
            fields = entry["fields"]
            ids = []
            for field in fields:
                if (not isinstance(field, dict) or not isinstance(field.get("id"), str) or not field["id"]
                        or not isinstance(field.get("q"), str) or not field["q"].strip()
                        or field.get("priority") not in ("required", "recommended", "optional")
                        or field.get("type") not in ("text", "number", "choice", "multi", "file", "text+file")
                        or field.get("only_if") not in (None, "follow")):
                    raise CRMError("invalid_survey")
                ids.append(field["id"])
                options = field.get("chips", [])
                if not isinstance(options, list) or not all(isinstance(option, str) and option for option in options):
                    raise CRMError("invalid_survey")
                if not options and field["type"] in ("choice", "multi"):
                    raise CRMError("invalid_survey")
                translations = field.get("translations", {})
                if not isinstance(translations, dict) or any(
                    not isinstance(row, dict) or not isinstance(row.get("q", ""), str)
                    or not isinstance(row.get("chips", {}), dict)
                    or not all(isinstance(value, str) for value in row.get("chips", {}).values())
                    for row in translations.values()
                ):
                    raise CRMError("invalid_survey")
            if len(ids) != len(set(ids)):
                raise CRMError("invalid_survey")
            for field in fields:
                follow = field.get("follow", {})
                if not isinstance(follow, dict) or any(
                    key not in field.get("chips", []) or not isinstance(targets, list)
                    or any(target not in ids for target in targets) for key, targets in follow.items()
                ):
                    raise CRMError("invalid_survey")
            reachable = {field["id"] for field in fields if not field.get("only_if")}
            for _ in ids:
                reachable.update(target for field in fields if field["id"] in reachable
                                 for targets in field.get("follow", {}).values() for target in targets)
            if len(reachable) != len(ids):
                raise CRMError("invalid_survey")
    return data


def active(item, product):
    targets = set()
    for field in product["fields"]:
        value = item["answers"].get(field["id"], [])
        for option in value if isinstance(value, list) else [value]:
            targets.update(field.get("follow", {}).get(option, []))
    return [field for field in product["fields"] if not field.get("only_if") or field["id"] in targets]


def pending(item, product):
    fields = [field for field in active(item, product) if field["id"] not in item["answers"]]
    for priority in ("required", "recommended", "optional"):
        match = [field for field in fields if field["priority"] == priority]
        if match:
            return match if priority == "optional" and all(field["type"] not in ("file", "text+file") for field in match) else match[:1]
    return []


def title(product, key, lang, seed):
    value = product.get("title", {})
    default = seed.get(key, {}).get("title", {}) if value else SERVICE_NAMES.get(key, {})
    if value and default.get("cs") != value.get("cs"):
        default = {}
    return value.get(lang) or default.get(lang) or value.get("cs") or key


def translations(field, product, lang, seed):
    known = next((item for item in seed.get(product, {}).get("fields", [])
                  if item["id"] == field["id"] and item["q"] == field["q"]), {})
    defaults = known.get("translations", {}).get(lang, {})
    custom = field.get("translations", {}).get(lang, {})
    return custom.get("q", defaults.get("q", field["q"])), {**defaults.get("chips", {}), **custom.get("chips", {})}


def review(state, catalog, lang, seed):
    result = {"name": state["name"], **contact(state["contact"]), "products": []}
    for item in state["items"]:
        product = item["product"]
        rendered = {"product": product, "title": title(catalog[product], product, lang, seed),
                    "answers": {key: value for key, value in item["answers"].items()}, "questionLabels": {},
                    "answerLabels": {}}
        if item.get("notes"):
            rendered["notes"] = item["notes"]
        if item.get("attachments"):
            rendered["attachments"] = item["attachments"]
        for field in active(item, catalog[product]):
            key = field["id"]
            if key not in item["answers"]:
                continue
            question, labels = translations(field, product, lang, seed)
            rendered["questionLabels"][key] = question
            value = item["answers"][key]
            marker = item.get("answerMarkers", {}).get(key)
            if marker in ("skipped", "notes") or (field["type"] == "file" and value in MARKERS):
                labels = {**labels, value: MARKERS[value][lang]}
            rendered["answerLabels"][key] = [labels.get(option, option) for option in value] if isinstance(value, list) else labels.get(value, value)
        result["products"].append(rendered)
    if state.get("intake") == "service":
        result["serviceKind"] = state["items"][0]["product"]
    return result


def step(state, catalog, files):
    ids = {file["id"] for file in files}
    for index, item in enumerate(state["items"]):
        for field in active(item, catalog[item["product"]]):
            if field["type"] not in ("file", "text+file") or field["priority"] != "required":
                continue
            key = field["id"]
            if key in item["answers"] and item["answers"][key] != "neví" and not (
                item.get("attachments", {}).get(key) and set(item["attachments"][key]) <= ids
            ):
                return index, [field], True
    if state["choosing"]:
        return -1, [], False
    item = state["items"][-1]
    return len(state["items"]) - 1, pending(item, catalog[item["product"]]), False


def instance(index, fields, item):
    from crm import dump
    if fields and fields[0]["type"] in ("file", "text+file"):
        return dump([index, fields[0]["id"], item.get("attachments", {}).get(fields[0]["id"], [])])
    return None


def survey_view(state, catalog, lang, seed, files):
    copy = COPY[lang]
    service = state.get("intake") == "service"
    index, fields, recovering = step(state, catalog, files)
    item = state["items"][index] if index >= 0 else {"answers": {}}
    required = [f for f in active(item, catalog[item["product"]]) if f["priority"] == "required"] if index >= 0 else []
    phase = {"chips": [], "multi": False, "input": "text", "pending": False, "review": None,
             "progress": {"step": 1 + sum(f["id"] in item["answers"] for f in required), "total": len(required) + 1},
             "attachmentField": None, "attachmentAnswers": [{"product": i["product"], "fields": i.get("attachments", {})} for i in state["items"]]}
    if index == -1:
        return {**phase, "question": copy["choose_service" if service else "product"],
                "chips": [chip(key, title(product, key, lang, seed)) for key, product in catalog.items() if product["fields"]]}
    if fields:
        field = fields[0]
        labels = [translations(f, item["product"], lang, seed) for f in fields]
        phase.update(question="\n".join(label[0] for label in labels),
                     multi=len(fields) == 1 and field["type"] == "multi",
                     chips=[chip(key, labels[0][1].get(key, key)) for key in field.get("chips", []) if len(fields) == 1] + [chip("skip", copy["skip"])])
        key = instance(index, fields, item)
        if key:
            phase["attachmentField"] = {"id": field["id"], "type": field["type"]}
            phase["pendingAttachments"] = [{"id": f["id"], "name": f["name"], "size": f["size"]} for f in files if f["field_instance"] == key]
        if recovering:
            phase["attachmentRecovery"] = {"product": item["product"], "field": field["id"]}
        return phase
    if not state["name"]:
        return {**phase, "question": copy["name"]}
    if not state["contact"]:
        return {**phase, "question": copy["contact"], "input": "phone"}
    return {**phase, "question": copy["service_summary" if service else "summary"], "review": review(state, catalog, lang, seed),
            "chips": [] if service else [chip("add_product", copy["add"])]}


def survey_answer(state, catalog, raw, kind, values, files):
    index, fields, _ = step(state, catalog, files)
    value = values[0]
    if index < 0:
        key = next((key for key, product in catalog.items() if key == value or product.get("title", {}).get("cs") == value), None)
        if kind == "chips" or key is None or not catalog[key]["fields"]:
            raise CRMError("invalid_product")
        state["items"].append({"product": key, "answers": {}})
        state.update(choosing=False, skips=0)
        return
    item = state["items"][index]
    if fields:
        field = fields[0]
        key = field["id"]
        skip = kind != "chips" and value.lower() in ("skip", "nevím", "přeskočit", "nechci")
        if skip:
            state["skips"] += 1
            for current in fields:
                item["answers"][current["id"]] = "neví"
                item.setdefault("attachments", {}).pop(current["id"], None)
                item.setdefault("answerMarkers", {})[current["id"]] = "skipped"
            if state["skips"] >= 2 or value.lower() == "nechci":
                for current in active(item, catalog[item["product"]]):
                    if current["id"] not in item["answers"]:
                        item["answers"][current["id"]] = "neví"
                        item.setdefault("answerMarkers", {})[current["id"]] = "skipped"
            return
        if field["type"] in ("file", "text+file"):
            attached = raw.get("files", [])
            field_instance = instance(index, fields, item)
            eligible = {f["id"] for f in files if f["field_instance"] == field_instance}
            if not attached or not set(attached) <= eligible or (field["type"] == "text+file" and value == "attachment"):
                raise CRMError("invalid_attachment")
            item.setdefault("attachments", {})[key] = list(dict.fromkeys(attached))
            item.setdefault("answerMarkers", {}).pop(key, None)
            item["answers"][key] = "attachment" if field["type"] == "file" else value
        elif raw.get("files"):
            raise CRMError("invalid_attachment")
        elif len(fields) > 1:
            if kind != "text":
                raise CRMError("invalid_answer")
            item["notes"] = value
            for current in fields:
                item["answers"][current["id"]] = "viz poznámka"
                item.setdefault("answerMarkers", {})[current["id"]] = "notes"
        else:
            options = field.get("chips", [])
            if (kind == "chips" and field["type"] != "multi") or (kind != "text" and any(v not in options for v in values)):
                raise CRMError("invalid_chip")
            if field["type"] in ("choice", "multi") and any(v not in options for v in values):
                return
            if field["type"] == "number" and value not in options and not re.fullmatch(r"\d+(?:[.,]\d+)?", value):
                return
            item["answers"][key] = list(dict.fromkeys(values)) if field["type"] == "multi" else value
        state["skips"] = 0
    elif not state["name"]:
        if kind != "text":
            raise CRMError("invalid_name")
        state["name"] = value
    elif not state["contact"]:
        if kind != "text" or not contact(value):
            raise CRMError("invalid_contact")
        state["contact"] = value
    elif state.get("intake") != "service" and value == "add_product":
        state["choosing"] = True
    else:
        raise CRMError("already_reviewed", 409)


def raw_items(items):
    return [{key: deepcopy(value) for key, value in item.items() if key != "answerMarkers"} for item in items]
