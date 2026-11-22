(() => {
"use strict";
const WIDGET_CSS = "@media(max-width: 699px){.chat-widget section#chat{position:fixed;inset:0;width:100%;height:100dvh;border-radius:0;box-sizing:border-box;padding-top:env(safe-area-inset-top)}}:host{all:initial}.chat-widget{position:fixed;right:20px;bottom:max(24px,env(safe-area-inset-bottom));z-index:2147483000;font:16px/1.5 Arial,sans-serif;color:#173f34}.chat-widget[hidden],.chat-widget [hidden]{display:none}.chat-widget button{border:0;cursor:pointer;color:#fff;background:#173f34}.chat-widget button:focus-visible{outline:3px solid #173f34;outline-offset:3px}.chat-widget .launcher{display:grid;place-items:center;width:56px;height:56px;border-radius:50%}.chat-widget .launcher[hidden]{display:none}.chat-widget section{width:min(380px,100vw - 40px);height:min(600px,100dvh - 48px);background:#faf9f5;border-radius:18px;overflow:hidden;box-shadow:0 8px 40px rgba(23,63,52,.2)}.chat-widget header{display:flex;align-items:center;justify-content:space-between;background:#173f34;color:#fff;padding:12px 18px}.chat-widget .close{font-size:28px;width:44px;height:44px;border-radius:50%}.chat-widget .close:focus-visible{outline-color:#fff}.chat-widget section:not([hidden]){display:flex;flex-direction:column}.chat-widget .reset{align-self:flex-end;margin:8px 12px}.chat-widget .conversation{flex:1;min-height:0;overflow-y:auto;padding:12px}.chat-widget .conversation p{width:fit-content;overflow-wrap:anywhere;white-space:pre-wrap;margin-bottom:8px}.chat-widget .visitor{margin-left:auto;color:#fff;background:#173f34}.chat-widget form{display:flex;gap:8px;padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom))}.chat-widget input{flex:1;min-width:0;font:inherit}.chat-widget form button,.chat-widget .reset{border-radius:8px;padding:8px 12px}.chat-widget .error:not(:empty){padding:4px 12px}.chat-widget p{margin:0;background:#fff;border-radius:12px;padding:12px 16px}";
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
		<div class="conversation" role="log"><p></p></div>
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
    const form = widget.querySelector("form");
    const input = widget.querySelector("input");
    const send = form.querySelector("button");
    const reset = widget.querySelector(".reset");
    const error = widget.querySelector(".error");
    input.placeholder = inputLabel;
    input.setAttribute("aria-label", inputLabel);
    send.textContent = sendLabel;
    reset.textContent = resetLabel;
    let sid = "";
    let ready = false;
    let busy = false;
    const storageKey = "gorbach-sid";
    try {
        sid = localStorage.getItem(storageKey) || "";
    }
    catch { }
    function saveSession(id) {
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
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body && JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
            if (response.status === 404 && data.error === "unknown_session")
                throw new Error("unknown_session");
            throw new Error("request_failed");
        }
        return data;
    }
    function render(messages, replace) {
        const fragment = document.createDocumentFragment();
        for (const item of messages) {
            const line = document.createElement("p");
            line.classList.toggle("visitor", item.role === "visitor");
            line.textContent = item.text;
            fragment.append(line);
        }
        if (replace)
            list.replaceChildren(fragment);
        else
            list.append(fragment);
        list.scrollTop = list.scrollHeight;
    }
    async function restore() {
        if (sid) {
            try {
                render((await request("history")).messages, true);
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
        render(data.messages, true);
        ready = true;
    }
    async function run(action) {
        if (busy)
            return;
        busy = true;
        input.readOnly = send.disabled = reset.disabled = true;
        error.textContent = "";
        try {
            await action();
        }
        catch (cause) {
            error.textContent = errorLabel;
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
            input.readOnly = send.disabled = false;
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
            const data = await request("msg", { sid, text });
            render(data.messages, false);
            input.value = "";
            input.focus();
        });
    };
    reset.onclick = () => void run(async () => {
        const data = await request("reset", { sid });
        saveSession(data.sid);
        ready = false;
        input.value = "";
        list.replaceChildren();
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
