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

async function knowledge(options = {}) {
  const response = await fetch("/api/admin/kb", {
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
    const bytes = new TextEncoder().encode("admin:" + password.value);
    authorization = "Basic " + btoa(String.fromCharCode(...bytes));
    const data = await knowledge();
    limits = data.limits;
    about.value = data.about;
    about.maxLength = limits.about;
    pairs.replaceChildren();
    add.disabled = false;
    data.faq.forEach(appendPair);
    login.hidden = true;
    workspace.hidden = false;
    statusLine.textContent = "";
    about.focus();
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
    await knowledge({ method: "POST", body: JSON.stringify({ about: about.value, faq }) });
    statusLine.textContent = copy("saved");
  } catch (error) {
    statusLine.textContent = locale.value === "cs" && error.message ? error.message : copy("saveFailed");
  } finally {
    save.disabled = false;
  }
});
