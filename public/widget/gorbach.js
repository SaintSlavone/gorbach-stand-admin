(() => {
"use strict";
const WIDGET_CSS = "@media(max-width: 699px){.chat-widget section#chat{position:fixed;inset:0;width:100%;height:100dvh;border-radius:0;box-sizing:border-box;padding-top:env(safe-area-inset-top)}}:host{all:initial}.chat-widget{position:fixed;right:20px;bottom:max(24px,env(safe-area-inset-bottom));z-index:2147483000;font:16px/1.5 Arial,sans-serif;color:#173f34}.chat-widget[hidden],.chat-widget [hidden]{display:none}.chat-widget button{border:0;cursor:pointer;color:#fff;background:#173f34}.chat-widget button:focus-visible{outline:3px solid #173f34;outline-offset:3px}.chat-widget .launcher{display:grid;place-items:center;width:56px;height:56px;border-radius:50%}.chat-widget .launcher[hidden]{display:none}.chat-widget section{width:min(380px,100vw - 40px);height:min(600px,100dvh - 48px);background:#faf9f5;border-radius:18px;overflow:hidden;box-shadow:0 8px 40px rgba(23,63,52,.2)}.chat-widget header{display:flex;align-items:center;justify-content:space-between;background:#173f34;color:#fff;padding:12px 18px}.chat-widget .close{font-size:28px;width:44px;height:44px;border-radius:50%}.chat-widget .close:focus-visible{outline-color:#fff}.chat-widget section:not([hidden]){display:flex;flex-direction:column}.chat-widget .reset{align-self:flex-end;margin:8px 12px}.chat-widget .conversation{flex:1;min-height:0;overflow-y:auto;padding:12px}.chat-widget .survey{border:0;padding:0;margin:0;min-width:0;overflow-wrap:anywhere}.chat-widget .survey legend,.chat-widget .survey dt{font-weight:bold}.chat-widget .survey dl,.chat-widget .survey dd{margin:0 0 8px}.chat-widget .survey button{margin:4px;padding:8px 12px;border-radius:8px}.chat-widget .survey button[aria-pressed=true]{background:#fff;color:#173f34;outline:2px solid #173f34}.chat-widget .survey button:disabled{opacity:.6}.chat-widget .conversation p{width:fit-content;overflow-wrap:anywhere;white-space:pre-wrap;margin-bottom:8px}.chat-widget .visitor{margin-left:auto;color:#fff;background:#173f34}.chat-widget form{display:flex;gap:8px;padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom))}.chat-widget input{flex:1;min-width:0;font:inherit}.chat-widget form button,.chat-widget .reset{border-radius:8px;padding:8px 12px}.chat-widget .error:not(:empty){padding:4px 12px}.chat-widget p{margin:0;background:#fff;border-radius:12px;padding:12px 16px}";
const surveyLabels = {
    cs: { confirm: "Potvrdit výběr", step: "Krok", contact: "Telefon nebo e-mail", submit: "Odeslat poptávku", receipt: "Číslo poptávky", invalidContact: "Zadejte platný telefon nebo e-mail." },
    de: { confirm: "Auswahl bestätigen", step: "Schritt", contact: "Telefon oder E-Mail", submit: "Anfrage senden", receipt: "Anfragenummer", invalidContact: "Geben Sie eine gültige Telefonnummer oder E-Mail-Adresse ein." },
    en: { confirm: "Confirm choices", step: "Step", contact: "Phone or email", submit: "Submit enquiry", receipt: "Enquiry number", invalidContact: "Enter a valid phone number or email address." },
    ru: { confirm: "Подтвердить выбор", step: "Шаг", contact: "Телефон или эл. почта", submit: "Отправить заявку", receipt: "Номер заявки", invalidContact: "Введите действительный номер телефона или адрес электронной почты." },
    uk: { confirm: "Підтвердити вибір", step: "Крок", contact: "Телефон або ел. пошта", submit: "Надіслати заявку", receipt: "Номер заявки", invalidContact: "Введіть дійсний номер телефону або адресу електронної пошти." },
};
const attachmentLabels = {
    cs: ["Přiložit soubor", "Nahrávání…", "Potvrdit přílohy", "Nahraďte přílohu, jejíž platnost vypršela.", "Nepodporovaný typ souboru.", "Soubor je příliš velký.", "Příliš mnoho příloh.", "Překročen celkový limit velikosti.", "Vyberte platnou přílohu.", "Přílohy"],
    en: ["Attach file", "Uploading…", "Confirm attachments", "Replace the expired attachment.", "Unsupported file type.", "The file is too large.", "Too many attachments.", "The total upload size limit was reached.", "Select a valid attachment.", "Attachments"],
    de: ["Datei anhängen", "Wird hochgeladen…", "Anhänge bestätigen", "Ersetzen Sie den abgelaufenen Anhang.", "Nicht unterstützter Dateityp.", "Die Datei ist zu groß.", "Zu viele Anhänge.", "Die Gesamtgröße wurde überschritten.", "Wählen Sie einen gültigen Anhang.", "Anhänge"],
    ru: ["Прикрепить файл", "Загрузка…", "Подтвердить вложения", "Замените просроченное вложение.", "Тип файла не поддерживается.", "Файл слишком большой.", "Слишком много вложений.", "Превышен общий размер вложений.", "Выберите действительное вложение.", "Вложения"],
    uk: ["Прикріпити файл", "Завантаження…", "Підтвердити вкладення", "Замініть прострочене вкладення.", "Тип файлу не підтримується.", "Файл завеликий.", "Забагато вкладень.", "Перевищено загальний розмір вкладень.", "Виберіть дійсне вкладення.", "Вкладення"],
};
const script = document.currentScript;
const endpoint = script?.dataset.api;
if (endpoint && script) {
    const api = new URL(endpoint, document.baseURI);
    const mount = () => mountWidget(api);
    if (document.body)
        mount();
    else
        document.addEventListener("DOMContentLoaded", mount, { once: true });
}
function mountWidget(api) {
    if (document.querySelector("gorbach-chat"))
        return;
    const host = document.createElement("gorbach-chat");
    const root = host.attachShadow({ mode: "open" });
    document.body.append(host);
    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    const language = document.documentElement.lang.toLowerCase().split("-")[0];
    const labels = {
        cs: ["Otevřít chat", "Zavřít chat", "Jak vám můžeme pomoci?", "Zpráva", "Odeslat", "Nový rozhovor", "Akci se nepodařilo dokončit. Zkuste to znovu."],
        en: ["Open chat", "Close chat", "How can we help you?", "Message", "Send", "New conversation", "Could not complete the request. Please try again."],
        de: ["Chat öffnen", "Chat schließen", "Wie können wir Ihnen helfen?", "Nachricht", "Senden", "Neues Gespräch", "Die Anfrage ist fehlgeschlagen. Bitte versuchen Sie es erneut."],
        ru: ["Открыть чат", "Закрыть чат", "Чем мы можем вам помочь?", "Сообщение", "Отправить", "Новый разговор", "Не удалось выполнить запрос. Попробуйте ещё раз."],
        uk: ["Відкрити чат", "Закрити чат", "Чим ми можемо вам допомогти?", "Повідомлення", "Надіслати", "Нова розмова", "Не вдалося виконати запит. Спробуйте ще раз."],
    };
    const lang = Object.hasOwn(labels, language) ? language : "cs";
    const copy = surveyLabels[lang];
    const lengthErrors = {
        cs: "Zpráva může obsahovat nejvýše 800 znaků.",
        en: "Your message can contain up to 800 characters.",
        de: "Ihre Nachricht darf höchstens 800 Zeichen enthalten.",
        ru: "Сообщение может содержать не более 800 символов.",
        uk: "Повідомлення може містити не більше 800 символів.",
    };
    const [openLabel, closeLabel, greeting, inputLabel, sendLabel, resetLabel, errorLabel] = labels[lang];
    const widget = document.createElement("div");
    widget.hidden = true;
    widget.className = "chat-widget";
    widget.lang = lang;
    widget.innerHTML = `<button type="button" class="launcher" aria-controls="chat" aria-expanded="false">
		<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2 1.8-6A8 8 0 1 1 20 11.5Z"/><path d="M7.5 9.5h8m-8 4h5"/></svg>
	</button><section id="chat" role="dialog" aria-labelledby="title" hidden>
		<header><strong id="title">Gorbach žaluzie</strong><button class="close" type="button">×</button></header>
		<button class="reset" type="button"></button>
		<div class="conversation"><div class="messages" role="log"><p></p></div>
			<fieldset class="survey"></fieldset>
		</div>
		<div class="error" role="alert"></div>
		<form><input required type="text"><button type="submit"></button></form>
	</section>`;
    root.append(style, widget);
    const launcher = widget.querySelector(".launcher");
    const close = widget.querySelector(".close");
    const panel = widget.querySelector("section");
    const message = widget.querySelector("p");
    launcher.setAttribute("aria-label", openLabel);
    close.setAttribute("aria-label", closeLabel);
    message.textContent = greeting;
    const list = widget.querySelector(".conversation");
    const transcript = widget.querySelector(".messages");
    const survey = widget.querySelector("fieldset");
    const form = widget.querySelector("form");
    const input = widget.querySelector("input");
    const send = form.querySelector("button");
    const reset = widget.querySelector(".reset");
    const error = widget.querySelector(".error");
    input.placeholder = inputLabel;
    input.setAttribute("aria-label", inputLabel);
    send.textContent = sendLabel;
    reset.textContent = resetLabel;
    let attachmentField;
    let uploaded = [];
    const names = Object.create(null);
    const [attach, uploading, confirmFiles, recovery, typeError, sizeError, countError, totalError, invalidFile, attachments] = attachmentLabels[lang];
    const uploadErrors = { type: typeError, size: sizeError, count: countError, total: totalError, invalid_attachment: invalidFile };
    let sid = "";
    let ready = false;
    let busy = false;
    const storageKey = "gorbach-sid";
    try {
        sid = localStorage.getItem(storageKey) || "";
        const saved = JSON.parse(localStorage.getItem(storageKey + "-files-" + sid) ?? "{}");
        Object.assign(names, saved);
    }
    catch { }
    function saveSession(id) {
        uploaded = [];
        for (const key of Object.keys(names))
            delete names[key];
        sid = id;
        try {
            localStorage.setItem(storageKey, id);
        }
        catch { }
    }
    async function request(route, body) {
        const url = new URL(api);
        url.pathname = url.pathname.replace(/\/$/, "") + "/" + route;
        if (route === "history")
            url.searchParams.set("sid", sid);
        const response = await fetch(url, {
            method: body ? "POST" : "GET",
            credentials: "omit",
            headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
            body: body instanceof FormData ? body : body && JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
            if (route !== "submit" && response.status === 404 && data.error === "unknown_session")
                throw new Error("unknown_session");
            throw new Error(typeof data.error === "string" ? data.error : "request_failed");
        }
        return data;
    }
    function button(label, action) {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        control.onclick = action;
        return control;
    }
    async function answer(payload) {
        const screen = await request("msg", { sid, ...payload });
        render(screen, false);
    }
    function renderReceipt(leadId) {
        const receipt = document.createElement("p");
        receipt.setAttribute("role", "status");
        receipt.textContent = `${copy.receipt}: ${leadId}`;
        survey.replaceChildren(receipt);
        form.hidden = true;
        list.scrollTop = list.scrollHeight;
    }
    function renderSurvey(screen) {
        attachmentField = screen.lead_id ? null : screen.attachmentField;
        uploaded = attachmentField ? screen.pendingAttachments ?? [] : [];
        for (const file of uploaded)
            names[file.id] = file.name;
        if (screen.lead_id) {
            renderReceipt(screen.lead_id);
            return;
        }
        survey.replaceChildren();
        input.placeholder = screen.input === "phone" ? copy.contact : inputLabel;
        input.setAttribute("aria-label", input.placeholder);
        form.hidden = !!screen.review || attachmentField?.type === "file";
        const confirmed = [...new Set((screen.attachmentAnswers ?? []).flatMap(item => Object.values(item.fields).flat()))];
        if (confirmed.length) {
            const line = document.createElement("p");
            line.textContent = attachments + " · " + confirmed.map(id => names[id] ?? id).join(", ");
            survey.append(line);
        }
        if (attachmentField) {
            const status = document.createElement("p");
            status.setAttribute("role", "status");
            status.textContent = screen.attachmentRecovery ? recovery : "";
            const picker = document.createElement("input");
            picker.type = "file";
            picker.accept = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.mp4,.mov";
            picker.setAttribute("aria-label", attach);
            const files = document.createElement("p");
            const confirm = button(confirmFiles, () => void run(() => answer({ files: uploaded.map(file => file.id) })));
            const update = () => {
                files.textContent = uploaded.map(file => file.name).join(", ");
                confirm.disabled = !uploaded.length;
            };
            update();
            picker.onchange = () => {
                const file = picker.files?.[0];
                if (!file)
                    return;
                picker.value = "";
                void run(async () => {
                    status.textContent = uploading;
                    try {
                        const data = new FormData();
                        data.set("sid", sid);
                        data.set("file", file);
                        const result = await request("file", data);
                        uploaded.push(result.file);
                        names[result.file.id] = result.file.name;
                        try {
                            localStorage.setItem(storageKey + "-files-" + sid, JSON.stringify(names));
                        }
                        catch { }
                        update();
                    }
                    finally {
                        status.textContent = screen.attachmentRecovery ? recovery : "";
                    }
                });
            };
            survey.append(picker, status, files);
            if (attachmentField.type === "file")
                survey.append(confirm);
        }
        if (screen.progress) {
            const progress = document.createElement("legend");
            progress.textContent = `${copy.step} ${screen.progress.step} / ${screen.progress.total}`;
            survey.append(progress);
        }
        if (screen.review) {
            for (const item of screen.review.products) {
                const title = document.createElement("strong");
                title.textContent = item.title ?? item.product;
                const answers = document.createElement("dl");
                for (const [field, value] of Object.entries(item.answers)) {
                    const term = document.createElement("dt");
                    const detail = document.createElement("dd");
                    term.textContent = item.questionLabels?.[field] ?? field;
                    const answer = item.answerLabels?.[field] ?? value;
                    detail.textContent = Array.isArray(answer) ? answer.join(", ") : answer;
                    answers.append(term, detail);
                }
                survey.append(title, answers);
                if (item.notes) {
                    const notes = document.createElement("p");
                    notes.textContent = item.notes;
                    survey.append(notes);
                }
            }
            const contact = document.createElement("p");
            contact.textContent = [screen.review.name, screen.review.phone, screen.review.email].filter(Boolean).join(" · ");
            survey.append(contact);
        }
        const selected = new Set();
        const confirm = button(copy.confirm, () => void run(() => answer({ chips: [...selected] })));
        confirm.disabled = true;
        for (const chip of screen.chips ?? []) {
            const multiple = screen.multi && chip.id !== "skip";
            const choice = button(chip.label, () => {
                if (!multiple) {
                    void run(() => answer({ chip: chip.id }));
                    return;
                }
                if (selected.has(chip.id))
                    selected.delete(chip.id);
                else
                    selected.add(chip.id);
                choice.setAttribute("aria-pressed", String(selected.has(chip.id)));
                confirm.disabled = !selected.size;
            });
            if (multiple)
                choice.setAttribute("aria-pressed", "false");
            survey.append(choice);
        }
        if (screen.multi)
            survey.append(confirm);
        if (screen.review) {
            survey.append(button(copy.submit, () => void run(async () => {
                let lead_id;
                try {
                    ({ lead_id } = await request("submit", { sid }));
                }
                catch (cause) {
                    if (!(cause instanceof Error) || cause.message !== "incomplete")
                        throw cause;
                    const history = await request("history");
                    render(history, true);
                    if (history.attachmentRecovery || history.lead_id)
                        return;
                    throw cause;
                }
                if (typeof lead_id !== "string" || !lead_id)
                    throw new Error("missing_lead_id");
                renderReceipt(lead_id);
            })));
        }
    }
    function render(screen, replace) {
        const fragment = document.createDocumentFragment();
        const messages = [...screen.messages];
        const last = messages.at(-1);
        if (screen.question && (last?.role !== "bot" || last.text !== screen.question))
            messages.push({ role: "bot", text: screen.question });
        for (const item of messages) {
            const line = document.createElement("p");
            line.classList.toggle("visitor", item.role === "visitor");
            line.textContent = item.text;
            fragment.append(line);
        }
        if (replace)
            transcript.replaceChildren(fragment);
        else
            transcript.append(fragment);
        renderSurvey(screen);
        list.scrollTop = list.scrollHeight;
    }
    async function restore() {
        if (sid) {
            try {
                render(await request("history"), true);
                ready = true;
                return;
            }
            catch (cause) {
                if (!(cause instanceof Error && cause.message === "unknown_session"))
                    throw cause;
            }
        }
        const data = await request("start", { lang, page: location.href });
        saveSession(data.sid);
        render(data, true);
        ready = true;
    }
    async function run(action) {
        if (busy)
            return;
        busy = true;
        input.readOnly = send.disabled = reset.disabled = survey.disabled = true;
        error.textContent = "";
        try {
            await action();
        }
        catch (cause) {
            error.textContent = cause instanceof Error && cause.message === "invalid_contact"
                ? copy.invalidContact : (cause instanceof Error && Object.hasOwn(uploadErrors, cause.message) ? uploadErrors[cause.message] : errorLabel);
            if (cause instanceof Error && cause.message === "unknown_session") {
                ready = false;
                try {
                    await restore();
                }
                catch { }
            }
        }
        finally {
            busy = false;
            input.readOnly = send.disabled = survey.disabled = false;
            reset.disabled = !ready;
        }
    }
    form.onsubmit = (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text)
            return;
        if (Array.from(text).length > 800) {
            error.textContent = lengthErrors[lang];
            return;
        }
        void run(async () => {
            if (!ready)
                await restore();
            if (form.hidden)
                return;
            if (attachmentField?.type === "text+file" && !uploaded.length)
                throw new Error("invalid_attachment");
            await answer(attachmentField?.type === "text+file" ? { text, files: uploaded.map(file => file.id) } : { text });
            input.value = "";
            input.focus();
        });
    };
    reset.onclick = () => void run(async () => {
        const data = await request("reset", { sid });
        saveSession(data.sid);
        ready = false;
        input.value = "";
        transcript.replaceChildren();
        survey.replaceChildren();
        form.hidden = false;
        await restore();
    });
    function handleToggle(open) {
        panel.hidden = !open;
        launcher.hidden = open;
        launcher.setAttribute("aria-expanded", String(open));
        (open ? close : launcher).focus();
        if (open && !ready)
            void run(restore);
    }
    launcher.onclick = () => handleToggle(true);
    close.onclick = () => handleToggle(false);
    widget.onkeydown = (event) => {
        if (event.key === "Escape" && !panel.hidden)
            handleToggle(false);
    };
    // The stand supplies the configured greeting when its API is available.
    const status = new URL(api);
    status.pathname = status.pathname.replace(/\/$/, "") + "/status";
    status.searchParams.set("lang", lang);
    void fetch(status, { credentials: "omit" }).then(async (response) => {
        if (!response.ok)
            return;
        const config = await response.json();
        if (typeof config?.enabled !== "boolean" || typeof config.public !== "boolean")
            return;
        if (typeof config.start?.greeting === "string")
            message.textContent = config.start.greeting;
        let preview = false;
        try {
            preview = localStorage.getItem("gorbach-preview") === "1";
        }
        catch { }
        function updateVisibility() {
            if (location.hash === "#gzbot" || location.hash === "#gzbot-off") {
                preview = location.hash === "#gzbot";
                try {
                    if (preview)
                        localStorage.setItem("gorbach-preview", "1");
                    else
                        localStorage.removeItem("gorbach-preview");
                }
                catch { }
            }
            widget.hidden = !config.enabled || (!config.public && !preview);
        }
        updateVisibility();
        window.addEventListener("hashchange", updateVisibility);
    }).catch(() => { });
}

})();
