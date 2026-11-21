(() => {
"use strict";
const WIDGET_CSS = "@media(max-width: 699px){.chat-widget section#chat{position:fixed;inset:0;width:100%;height:100dvh;border-radius:0;box-sizing:border-box;padding-top:env(safe-area-inset-top)}}:host{all:initial}.chat-widget{position:fixed;right:20px;bottom:max(24px,env(safe-area-inset-bottom));z-index:2147483000;font:16px/1.5 Arial,sans-serif;color:#173f34}.chat-widget[hidden],.chat-widget [hidden]{display:none}.chat-widget button{border:0;cursor:pointer;color:#fff;background:#173f34}.chat-widget button:focus-visible{outline:3px solid #173f34;outline-offset:3px}.chat-widget .launcher{display:grid;place-items:center;width:56px;height:56px;border-radius:50%}.chat-widget .launcher[hidden]{display:none}.chat-widget section{width:min(380px,100vw - 40px);height:min(600px,100dvh - 48px);background:#faf9f5;border-radius:18px;overflow:hidden;box-shadow:0 8px 40px rgba(23,63,52,.2)}.chat-widget header{display:flex;align-items:center;justify-content:space-between;background:#173f34;color:#fff;padding:12px 18px}.chat-widget .close{font-size:28px;width:44px;height:44px;border-radius:50%}.chat-widget .close:focus-visible{outline-color:#fff}.chat-widget .conversation{padding:20px}.chat-widget p{margin:0;background:#fff;border-radius:12px;padding:12px 16px}";
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
        cs: ["Otevřít chat", "Zavřít chat", "Jak vám můžeme pomoci?"],
        en: ["Open chat", "Close chat", "How can we help you?"],
        de: ["Chat öffnen", "Chat schließen", "Wie können wir Ihnen helfen?"],
        ru: ["Открыть чат", "Закрыть чат", "Чем мы можем вам помочь?"],
        uk: ["Відкрити чат", "Закрити чат", "Чим ми можемо вам допомогти?"],
    };
    const lang = Object.hasOwn(labels, language) ? language : "cs";
    const [openLabel, closeLabel, greeting] = labels[lang];
    const widget = document.createElement("div");
    widget.className = "chat-widget";
    widget.lang = lang;
    widget.innerHTML = `<button type="button" class="launcher" aria-controls="chat" aria-expanded="false">
		<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2 1.8-6A8 8 0 1 1 20 11.5Z"/><path d="M7.5 9.5h8m-8 4h5"/></svg>
	</button><section id="chat" role="dialog" aria-labelledby="title" hidden>
		<header><strong id="title">Gorbach žaluzie</strong><button class="close" type="button">×</button></header>
		<div class="conversation"><p></p></div>
	</section>`;
    root.append(style, widget);
    const launcher = widget.querySelector(".launcher");
    const close = widget.querySelector(".close");
    const panel = widget.querySelector("section");
    const message = widget.querySelector("p");
    launcher.setAttribute("aria-label", openLabel);
    close.setAttribute("aria-label", closeLabel);
    message.textContent = greeting;
    function handleToggle(open) {
        panel.hidden = !open;
        launcher.hidden = open;
        launcher.setAttribute("aria-expanded", String(open));
        (open ? close : launcher).focus();
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
        if (typeof config.start?.greeting === "string")
            message.textContent = config.start.greeting;
        if (typeof config.enabled !== "boolean" || typeof config.public !== "boolean")
            return;
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
