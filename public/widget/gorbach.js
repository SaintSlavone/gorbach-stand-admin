(() => {
	"use strict";

	const script = document.currentScript;
	if (!script) return;

	const api = new URL(script.dataset.api || "/api/cbot/", document.baseURI);
	api.pathname = api.pathname.replace(/\/+$/, "") + "/";
	api.search = "";
	api.hash = "";
	const styles = `
		:host { all: initial; }
		.chat-widget {
			--ink: #173f34;
			--paper: #faf9f5;
			--white: #fff;
			position: fixed;
			right: 20px;
			bottom: max(24px, env(safe-area-inset-bottom));
			z-index: 2147483000;
			font: 16px/1.5 Arial, sans-serif;
			color: var(--ink);
		}
		[hidden] { display: none !important; }
		button { border: 0; cursor: pointer; color: var(--white); background: var(--ink); }
		button:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
		button:disabled { opacity: .65; cursor: default; }
		.launcher { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; }
		section {
			display: flex;
			flex-direction: column;
			width: min(380px, calc(100vw - 40px));
			height: min(600px, calc(100dvh - 48px));
			background: var(--paper);
			border-radius: 18px;
			overflow: hidden;
			box-shadow: 0 8px 40px #173f3433;
		}
		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			background: var(--ink);
			color: var(--white);
			padding: 12px 18px;
		}
		.close { font-size: 28px; width: 44px; height: 44px; border-radius: 50%; }
		.close:focus-visible { outline-color: var(--white); }
		.reset { align-self: flex-end; margin: 8px 12px; }
		.conversation { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
		.conversation p {
			width: fit-content;
			overflow-wrap: anywhere;
			white-space: pre-wrap;
			margin: 0 0 8px;
			background: var(--white);
			border-radius: 12px;
			padding: 12px 16px;
		}
		.conversation .visitor { margin-left: auto; color: var(--white); background: var(--ink); }
		.waiting {
			width: 16px;
			height: 16px;
			margin: 12px 16px;
			border: 2px solid var(--ink);
			border-right-color: transparent;
			border-radius: 50%;
			animation: gorbach-spin .7s linear infinite;
		}
		@keyframes gorbach-spin { to { transform: rotate(360deg); } }
		@media (prefers-reduced-motion: reduce) { .waiting { animation: none; } }
		form { display: flex; gap: 8px; padding: 12px; }
		input { flex: 1; min-width: 0; font: inherit; }
		form button, .reset { border-radius: 8px; padding: 8px 12px; }
		.error:not(:empty) { padding: 4px 12px; }
		.note { margin: 0 12px max(12px, env(safe-area-inset-bottom)); font-size: .75rem; }
		@media (max-width: 699px) {
			section {
				position: fixed;
				inset: var(--viewport-top, 0px) 0 auto;
				width: 100%;
				height: var(--viewport-height, 100dvh);
				border-radius: 0;
				box-sizing: border-box;
				padding-top: env(safe-area-inset-top);
			}
		}
	`;
	const translations = {
		cs: {
			open: "Otevřít chat", close: "Zavřít chat",
			greeting: "Dobrý den! Jsem AI asistent Gorbach žaluzie. Jak vám mohu pomoci s výběrem stínění?",
			input: "Zpráva", send: "Odeslat", reset: "Nový rozhovor", waiting: "Čekám na odpověď…",
			error: "Akci se nepodařilo dokončit. Zkuste to znovu.",
			limit: "Zpráva může obsahovat nejvýše 800 znaků.",
			note: "V živém chatu Google zpracovává zprávy pro vytvoření odpovědi. Nesdílejte citlivé údaje.",
		},
		de: {
			open: "Chat öffnen", close: "Chat schließen",
			greeting: "Hallo! Ich bin der KI-Assistent von Gorbach žaluzie. Wie kann ich Ihnen bei der Wahl des Sonnenschutzes helfen?",
			input: "Nachricht", send: "Senden", reset: "Neues Gespräch", waiting: "Warte auf eine Antwort…",
			error: "Die Anfrage ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
			limit: "Ihre Nachricht darf höchstens 800 Zeichen enthalten.",
			note: "Im Live-Chat verarbeitet Google Nachrichten, um Antworten zu erstellen. Teilen Sie keine sensiblen Daten.",
		},
		en: {
			open: "Open chat", close: "Close chat",
			greeting: "Hello! I’m the Gorbach žaluzie AI assistant. How can I help you choose shading?",
			input: "Message", send: "Send", reset: "New conversation", waiting: "Waiting for a reply…",
			error: "Could not complete the request. Please try again.",
			limit: "Your message can contain up to 800 characters.",
			note: "In live chat, Google processes messages to generate replies. Do not share sensitive information.",
		},
		ru: {
			open: "Открыть чат", close: "Закрыть чат",
			greeting: "Здравствуйте! Я ИИ-ассистент Gorbach žaluzie. Как я могу помочь вам выбрать солнцезащиту?",
			input: "Сообщение", send: "Отправить", reset: "Новый разговор", waiting: "Ожидаю ответа…",
			error: "Не удалось выполнить запрос. Попробуйте ещё раз.",
			limit: "Сообщение может содержать не более 800 символов.",
			note: "В чате Google обрабатывает сообщения для подготовки ответов. Не передавайте конфиденциальные данные.",
		},
		uk: {
			open: "Відкрити чат", close: "Закрити чат",
			greeting: "Вітаю! Я ШІ-асистент Gorbach žaluzie. Як я можу допомогти вам вибрати сонцезахист?",
			input: "Повідомлення", send: "Надіслати", reset: "Нова розмова", waiting: "Очікую на відповідь…",
			error: "Не вдалося виконати запит. Спробуйте ще раз.",
			limit: "Повідомлення може містити не більше 800 символів.",
			note: "У чаті Google обробляє повідомлення, щоб підготувати відповіді. Не надсилайте конфіденційні дані.",
		},
	};

	const hostLanguage = document.documentElement.lang.toLowerCase().split("-")[0];
	const language = Object.hasOwn(translations, hostLanguage) ? hostLanguage : "cs";
	const copy = translations[language];
	const greeting = script.dataset.greet || copy.greeting;
	const networkError = script.dataset.neterr || copy.error;
	const historyLimit = 12;

	async function request(path, body) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 26000);
		let response;
		let data;
		try {
			response = await fetch(new URL(path, api), {
				method: body ? "POST" : "GET",
				headers: body ? { "Content-Type": "application/json" } : { Accept: "application/json" },
				body: body ? JSON.stringify(body) : undefined,
				credentials: "omit",
				signal: controller.signal,
			});
			data = await response.json();
		} catch {
			throw new Error(networkError);
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok || data?.ok !== true) {
			throw new Error(typeof data?.message === "string" ? data.message : networkError);
		}
		return data;
	}

	function mount() {
		if (document.querySelector("gorbach-chat")) return;
		const host = document.createElement("gorbach-chat");
		const root = host.attachShadow({ mode: "open" });
		const css = document.createElement("style");
		css.textContent = styles;
		const widget = document.createElement("div");
		widget.className = "chat-widget";
		widget.lang = language;
		widget.hidden = true;
		widget.innerHTML = `<button type="button" class="launcher" aria-controls="chat" aria-haspopup="dialog" aria-expanded="false">
			<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2 1.8-6A8 8 0 1 1 20 11.5Z"/><path d="M7.5 9.5h8m-8 4h5"/></svg>
		</button><section id="chat" role="dialog" aria-labelledby="title" hidden>
			<header><strong id="title">Gorbach žaluzie</strong><button class="close" type="button">×</button></header>
			<button class="reset" type="button"></button>
			<div class="conversation" role="log" aria-live="polite"></div>
			<div class="error" role="alert"></div>
			<form autocomplete="off"><input required type="text" enterkeyhint="send"><button type="submit"></button></form>
			<p class="note"></p>
		</section>`;
		root.append(css, widget);
		document.body.append(host);

		const launcher = widget.querySelector(".launcher");
		const closer = widget.querySelector(".close");
		const panel = widget.querySelector("section");
		const log = widget.querySelector(".conversation");
		const form = widget.querySelector("form");
		const input = widget.querySelector("input");
		const send = form.querySelector("button");
		const reset = widget.querySelector(".reset");
		const error = widget.querySelector(".error");
		const mobile = window.matchMedia("(max-width: 699px)");
		const viewport = window.visualViewport;

		launcher.setAttribute("aria-label", copy.open);
		closer.setAttribute("aria-label", copy.close);
		input.placeholder = copy.input;
		input.setAttribute("aria-label", copy.input);
		send.textContent = copy.send;
		reset.textContent = copy.reset;
		widget.querySelector(".note").textContent = copy.note;

		let history = [];
		let busy = false;

		function scrollToLatest() {
			log.scrollTop = log.scrollHeight;
		}

		function addMessage(text, className = "") {
			const line = document.createElement("p");
			line.className = className;
			line.textContent = text;
			log.append(line);
			scrollToLatest();
			return line;
		}

		function fitViewport() {
			if (!viewport || !mobile.matches || panel.hidden) return;
			panel.style.setProperty("--viewport-height", viewport.height + "px");
			panel.style.setProperty("--viewport-top", viewport.offsetTop + "px");
		}

		function toggle(open) {
			panel.hidden = !open;
			launcher.hidden = open;
			launcher.setAttribute("aria-expanded", String(open));
			if (open) {
				fitViewport();
				scrollToLatest();
				(mobile.matches ? closer : input).focus();
			} else {
				launcher.focus();
			}
		}

		function clearConversation() {
			history = [];
			log.replaceChildren();
			addMessage(greeting);
			error.textContent = "";
			input.value = "";
		}

		launcher.onclick = () => toggle(true);
		closer.onclick = () => toggle(false);
		panel.onkeydown = (event) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			toggle(false);
		};
		viewport?.addEventListener("resize", fitViewport);
		viewport?.addEventListener("scroll", fitViewport);
		window.addEventListener("resize", fitViewport);
		reset.onclick = () => {
			if (busy) return;
			clearConversation();
			if (!mobile.matches) input.focus();
		};

		form.onsubmit = async (event) => {
			event.preventDefault();
			const text = input.value.trim();
			if (!text || busy) return;
			if (Array.from(text).length > 800) {
				error.textContent = copy.limit;
				return;
			}

			busy = true;
			input.readOnly = send.disabled = reset.disabled = true;
			input.value = "";
			error.textContent = "";
			const visitor = addMessage(text, "visitor");
			const waiting = document.createElement("div");
			waiting.className = "waiting";
			waiting.setAttribute("role", "status");
			waiting.setAttribute("aria-label", copy.waiting);
			log.append(waiting);
			scrollToLatest();

			try {
				const answer = await request("msg", { text, history });
				if (typeof answer.reply !== "string" || !answer.reply.trim()) throw new Error(networkError);
				history.push({ role: "user", text }, { role: "assistant", text: answer.reply });
				history = history.slice(-historyLimit);
				addMessage(answer.reply);
			} catch (cause) {
				visitor.remove();
				input.value = text;
				error.textContent = cause.message || networkError;
			} finally {
				waiting.remove();
				busy = false;
				input.readOnly = send.disabled = reset.disabled = false;
				scrollToLatest();
				if (!panel.hidden && !mobile.matches) input.focus();
			}
		};

		clearConversation();
		request("status").then((status) => {
			widget.hidden = status.enabled !== true;
		}).catch(() => {});
	}

	if (document.body) mount();
	else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
