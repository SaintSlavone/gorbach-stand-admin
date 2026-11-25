"use strict";

const login = document.getElementById("login");
const workspace = document.getElementById("workspace");
const password = document.getElementById("password");
const editor = document.getElementById("editor");
const about = document.getElementById("about");
const pairs = document.getElementById("pairs");
const statusLine = document.getElementById("status");
const add = document.getElementById("add");
const save = document.getElementById("save");
let authorization = "";
let limits;
let knowledgeVersion;
let sectionFormat;
const sections = document.getElementById("sections");
const locale = document.getElementById("locale");
const copies = {
  cs: {
    admin: "Administrace", stand: "Testovací stránka", language: "Jazyk", login: "Přihlášení", user: "Uživatel", password: "Heslo",
    signIn: "Přihlásit se", signOut: "Odhlásit se", knowledge: "Báze znalostí", about: "O společnosti a produktech",
    faq: "Časté otázky", add: "Přidat otázku", save: "Uložit změny", q: "Otázka", a: "Odpověď", remove: "Odebrat otázku",
    signingIn: "Přihlašování…", loginFailed: "Přihlášení se nezdařilo.", signedOut: "Odhlášeno.", saving: "Ukládání…",
    saved: "Změny uloženy.", saveFailed: "Změny se nepodařilo uložit.",
  },
  ru: {
    admin: "Администрирование", stand: "Тестовая страница", language: "Язык", login: "Вход", user: "Пользователь", password: "Пароль",
    signIn: "Войти", signOut: "Выйти", knowledge: "База знаний", about: "О компании и продуктах",
    faq: "Частые вопросы", add: "Добавить вопрос", save: "Сохранить изменения", q: "Вопрос", a: "Ответ", remove: "Удалить вопрос",
    signingIn: "Вход…", loginFailed: "Не удалось войти.", signedOut: "Вы вышли.", saving: "Сохранение…",
    saved: "Изменения сохранены.", saveFailed: "Не удалось сохранить изменения.",
  },
};
const copy = (key) => copies[locale.value][key];
locale.addEventListener("change", () => {
  document.documentElement.lang = locale.value;
  document.querySelectorAll("[data-copy]").forEach((element) => {
    element.textContent = copy(element.dataset.copy);
  });
  statusLine.textContent = "";
});

async function request(path, options = {}) {
  const response = await fetch("/api/admin/" + path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: authorization },
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message);
  return result;
}

function appendPair(pair = { q: "", a: "" }) {
  const group = document.createElement("fieldset");
  for (const field of ["q", "a"]) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.dataset.copy = field;
    caption.textContent = copy(field);
    const input = document.createElement(field === "q" ? "input" : "textarea");
    input.dataset.field = field;
    input.value = pair[field];
    input.maxLength = limits[field];
    label.append(caption, input);
    group.append(label);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.copy = "remove";
  remove.textContent = copy("remove");
  remove.addEventListener("click", () => {
    group.remove();
    add.disabled = false;
  });
  group.append(remove);
  pairs.append(group);
  add.disabled = pairs.children.length >= limits.pairs;
  return group.querySelector("input");
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = login.querySelector("button");
  button.disabled = true;
  statusLine.textContent = copy("signingIn");
  try {
    const bytes = new TextEncoder().encode(document.getElementById("username").value + ":" + password.value);
    authorization = "Basic " + btoa(String.fromCharCode(...bytes));
    const data = await request("kb");
    limits = data.limits;
    knowledgeVersion = data.version;
    sectionFormat = Array.isArray(data.sections);
    document.getElementById("section-editor").hidden = !sectionFormat;
    document.getElementById("faq-editor").hidden = sectionFormat;
    sections.replaceChildren();
    if (sectionFormat) data.sections.forEach(appendSection);
    showSection("kb");
    about.value = data.about;
    about.maxLength = limits.about;
    pairs.replaceChildren();
    add.disabled = false;
    data.faq.forEach(appendPair);
    login.hidden = true;
    workspace.hidden = false;
    statusLine.textContent = "";
    if (!sectionFormat) about.focus();
  } catch (error) {
    authorization = "";
    statusLine.textContent = locale.value === "cs" && error.message ? error.message : copy("loginFailed");
  } finally {
    password.value = "";
    button.disabled = false;
  }
});

document.getElementById("logout").addEventListener("click", () => {
  authorization = "";
  document.getElementById("crm-panel").replaceChildren();
  sections.replaceChildren();
  about.value = "";
  pairs.replaceChildren();
  workspace.hidden = true;
  login.hidden = false;
  statusLine.textContent = copy("signedOut");
  password.focus();
});

add.addEventListener("click", () => appendPair().focus());
editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  save.disabled = true;
  statusLine.textContent = copy("saving");
  const faq = Array.from(pairs.children, (group) => ({
    q: group.querySelector('[data-field="q"]').value,
    a: group.querySelector('[data-field="a"]').value,
  }));
  try {
    const body = sectionFormat
      ? { sections: Array.from(sections.children, (section) => section.collect()) }
      : { about: about.value, faq };
    const data = await post("kb", { ...body, version: knowledgeVersion });
    knowledgeVersion = data.version;
    statusLine.textContent = copy("saved");
  } catch (error) {
    statusLine.textContent = locale.value === "cs" && error.message ? error.message : copy("saveFailed");
  } finally {
    save.disabled = false;
  }
});
const panel = document.getElementById("crm-panel");
const paths = {
  cs: { leads: "Poptávky", dialogs: "Dialogy", stats: "Statistiky", survey: "Dotazník", search: "Hledat", delete: "Smazat", confirm: "Smazat tuto poptávku i její dialog?", attachments: "Přílohy", reload: "Načíst znovu" },
  ru: { leads: "Заявки", dialogs: "Диалоги", stats: "Статистика", survey: "Анкета", search: "Поиск", delete: "Удалить", confirm: "Удалить заявку и её диалог?", attachments: "Вложения", reload: "Обновить" },
};
for (const [lang, labels] of Object.entries(paths)) Object.assign(copies[lang], labels);
let view = "kb";
let epoch = 0;

function node(tag, content, parent = panel) {
  const element = document.createElement(tag);
  element.textContent = content;
  parent.append(element);
  return element;
}

function control(key, parent, action) {
  const element = node("button", copy(key) || key, parent);
  element.type = "button";
  if (copy(key)) element.dataset.copy = key;
  element.addEventListener("click", async () => {
    element.disabled = true;
    try { await action(); }
    catch (error) { statusLine.textContent = error.message || copy("saveFailed"); }
    finally { element.disabled = false; }
  });
  return element;
}

function post(path, body) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

async function showSection(section, query = "") {
  view = section;
  const run = ++epoch;
  document.getElementById("kb-panel").hidden = section !== "kb";
  panel.hidden = section === "kb";
  panel.replaceChildren();
  statusLine.textContent = "";
  if (section === "kb") return;
  const data = await request(section + query);
  if (run !== epoch || !authorization) return;
  node("h2", copy(section)).dataset.copy = section;
  if (section === "survey") {
    const source = node("textarea", JSON.stringify(data.content, null, 2));
    source.rows = 24;
    source.setAttribute("aria-label", copy("survey"));
    let version = data.version;
    control("save", panel, async () => {
      const saved = await post("survey", { content: JSON.parse(source.value), version });
      version = saved.version;
      statusLine.textContent = copy("saved");
    });
    control("reload", panel, () => showSection(section));
  } else if (section === "stats") {
    for (const key of ["dialogs", "leads", "conversion", "messages", "unknown", "cost"]) {
      node("p", (copy(key) || key) + " · " + data[key]);
    }
    for (const [group, rows] of Object.entries(data.groups)) {
      node("h3", group);
      const list = node("ul", "");
      for (const row of rows) node("li", row.label + " · " + row.count, list);
    }
  } else if (data.dialog) {
    control("dialogs", panel, () => showSection("dialogs"));
    for (const message of data.messages) node("p", message.role + " · " + message.body);
    if (data.files.length) node("h3", copy("attachments")).dataset.copy = "attachments";
    for (const file of data.files) control(file.name, panel, async () => {
      const response = await fetch("/api/admin/files/" + encodeURIComponent(file.id), {
        headers: { Authorization: authorization },
      });
      if (!response.ok) throw new Error(copy("saveFailed"));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.download = file.name;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  } else {
    const search = node("form", "");
    const term = node("input", "", search);
    term.type = "search";
    term.setAttribute("aria-label", copy("search"));
    const params = new URLSearchParams(query);
    term.name = "q";
    term.value = params.get("q") || "";
    if (section === "leads") {
      for (const key of ["status", "kind", "product", "date", "lang"]) {
        const label = node("label", copy(key) + " ", search);
        const input = node(key === "status" ? "select" : "input", "", label);
        if (key === "status") {
          node("option", "", input).value = "";
          for (const value of data.statuses) node("option", value, input).value = value;
        } else {
          input.type = key === "date" ? "date" : "text";
        }
        input.name = key;
        input.value = params.get(key) || "";
      }
    }
    node("button", copy("search"), search).dataset.copy = "search";
    search.addEventListener("submit", (event) => {
      event.preventDefault();
      showSection(section, "?" + new URLSearchParams(new FormData(search))).catch((error) => {
        statusLine.textContent = error.message || copy("saveFailed");
      });
    });
    for (const record of data[section]) {
      const card = node("fieldset", "");
      node("legend", record.summary || record.page || record.id, card);
      node("p", [record.id, record.created, record.lang, record.kind, record.contact].filter(Boolean).join(" · "), card);
      if (record.fields || record.delivery) {
        node("h3", copy("details"), card).dataset.copy = "details";
        let details = record.fields;
        try { details = JSON.stringify(JSON.parse(details), null, 2); } catch { /* Legacy plain text. */ }
        if (details) node("pre", details, card);
        if (record.delivery) node("p", copy("delivery") + " · " + record.delivery, card);
      }
      control("dialogs", card, () => showSection("dialogs", "?" + new URLSearchParams({ sid: record.dialog || record.id })));
      if (section === "leads") {
        const status = node("select", "", card);
        for (const value of data.statuses) node("option", value, status).value = value;
        status.value = record.status;
        control("save", card, async () => {
          await post("leads", { id: record.id, action: "status", status: status.value });
          statusLine.textContent = copy("saved");
        });
        control("delete", card, async () => {
          if (!window.confirm(copy("confirm"))) return;
          await post("leads", { id: record.id, action: "delete", confirm: true });
          await showSection("leads", query);
        });
      }
    }
  }
}

for (const section of ["kb", "leads", "dialogs", "stats", "survey"]) {
  control(section === "kb" ? "knowledge" : section, document.getElementById("tabs"), () => showSection(section));
}
Object.assign(copies.cs, {
  addSection: "Přidat sekci", title: "Název", text: "Text", moveUp: "Posunout nahoru",
  moveDown: "Posunout dolů", removeSection: "Odebrat sekci", details: "Podrobnosti", delivery: "Doručení",
  status: "Stav", kind: "Typ", product: "Produkt", date: "Datum", lang: "Jazyk",
});
Object.assign(copies.ru, {
  addSection: "Добавить раздел", title: "Название", text: "Текст", moveUp: "Переместить вверх",
  moveDown: "Переместить вниз", removeSection: "Удалить раздел", details: "Подробности", delivery: "Доставка",
  status: "Статус", kind: "Тип", product: "Продукт", date: "Дата", lang: "Язык",
});
document.getElementById("add-section").addEventListener("click", () => appendSection({}));

function appendSection(data) {
  const group = node("fieldset", "", sections);
  const inputs = {};
  for (const [key, tag, caption] of [["lang", "select", "language"], ["title", "input", "title"], ["text", "textarea", "text"]]) {
    const label = node("label", "", group);
    node("span", copy(caption), label).dataset.copy = caption;
    const input = node(tag, "", label);
    if (key === "lang") {
      for (const lang of ["cs", "en", "de", "ru", "uk"]) node("option", lang, input).value = lang;
    }
    input.value = data[key] || (key === "lang" ? "cs" : "");
    input.required = true;
    inputs[key] = input;
  }
  inputs.title.maxLength = 300;
  inputs.text.rows = 8;
  control("moveUp", group, () => {
    if (group.previousElementSibling) sections.insertBefore(group, group.previousElementSibling);
  });
  control("moveDown", group, () => {
    if (group.nextElementSibling) sections.insertBefore(group.nextElementSibling, group);
  });
  control("removeSection", group, () => group.remove());
  group.collect = () => ({ ...data, lang: inputs.lang.value, title: inputs.title.value, text: inputs.text.value });
}
