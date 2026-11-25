(() => {
	"use strict";

	const script = document.currentScript;
	if (!script) return;

	const api = new URL(script.dataset.api || "/api/cbot/", document.baseURI);
	api.pathname = api.pathname.replace(/\/+$/, "") + "/";
	api.search = "";
	api.hash = "";
	const stateful = api.pathname.split("/").filter(Boolean).at(-1) !== "cbot";
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
		.survey { border: 0; padding: 0; margin: 0; min-width: 0; overflow-wrap: anywhere; }
		.survey button { margin: 4px; padding: 8px 12px; border-radius: 8px; }
		.survey button[aria-pressed="true"] { color: var(--ink); background: var(--white); outline: 2px solid var(--ink); }
		.survey dt, .survey legend { font-weight: bold; }
		.survey dl, .survey dd { margin: 0 0 8px; }
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

	const surveyLabels = {
		cs: { confirm: "Potvrdit výběr", step: "Krok", contact: "Telefon nebo e-mail", submit: "Odeslat poptávku", receipt: "Číslo poptávky", invalidContact: "Zadejte platný telefon nebo e-mail." },
		de: { confirm: "Auswahl bestätigen", step: "Schritt", contact: "Telefon oder E-Mail", submit: "Anfrage senden", receipt: "Anfragenummer", invalidContact: "Geben Sie eine gültige Telefonnummer oder E-Mail-Adresse ein." },
		en: { confirm: "Confirm choices", step: "Step", contact: "Phone or email", submit: "Submit enquiry", receipt: "Enquiry number", invalidContact: "Enter a valid phone number or email address." },
		ru: { confirm: "Подтвердить выбор", step: "Шаг", contact: "Телефон или эл. почта", submit: "Отправить заявку", receipt: "Номер заявки", invalidContact: "Введите действительный номер телефона или адрес электронной почты." },
		uk: { confirm: "Підтвердити вибір", step: "Крок", contact: "Телефон або ел. пошта", submit: "Надіслати заявку", receipt: "Номер заявки", invalidContact: "Введіть дійсний номер телефону або адресу електронної пошти." },
	};

	const handoffLabels = {
		cs: "Předat specialistovi",
		de: "An das Fachteam weiterleiten",
		en: "Send to a specialist",
		ru: "Передать специалисту",
		uk: "Передати фахівцю",
	};

	const attachmentLabels = {
		cs: ["Přiložit soubor", "Nahrávání…", "Potvrdit přílohy", "Nahraďte přílohu, jejíž platnost vypršela.", "Nepodporovaný typ souboru.", "Soubor je příliš velký.", "Příliš mnoho příloh.", "Překročen celkový limit velikosti.", "Vyberte platnou přílohu.", "Přílohy"],
		en: ["Attach file", "Uploading…", "Confirm attachments", "Replace the expired attachment.", "Unsupported file type.", "The file is too large.", "Too many attachments.", "The total upload size limit was reached.", "Select a valid attachment.", "Attachments"],
		de: ["Datei anhängen", "Wird hochgeladen…", "Anhänge bestätigen", "Ersetzen Sie den abgelaufenen Anhang.", "Nicht unterstützter Dateityp.", "Die Datei ist zu groß.", "Zu viele Anhänge.", "Die Gesamtgröße wurde überschritten.", "Wählen Sie einen gültigen Anhang.", "Anhänge"],
		ru: ["Прикрепить файл", "Загрузка…", "Подтвердить вложения", "Замените просроченное вложение.", "Тип файла не поддерживается.", "Файл слишком большой.", "Слишком много вложений.", "Превышен общий размер вложений.", "Выберите действительное вложение.", "Вложения"],
		uk: ["Прикріпити файл", "Завантаження…", "Підтвердити вкладення", "Замініть прострочене вкладення.", "Тип файлу не підтримується.", "Файл завеликий.", "Забагато вкладень.", "Перевищено загальний розмір вкладень.", "Виберіть дійсне вкладення.", "Вкладення"],
	};

	const hostLanguage = document.documentElement.lang.toLowerCase().split("-")[0];
	const language = Object.hasOwn(translations, hostLanguage) ? hostLanguage : "cs";
	const greeting = script.dataset.greet || translations[language].greeting;
	const networkError = script.dataset.neterr || translations[language].error;
	const historyLimit = 12;

	async function request(path, body, query) {
		const controller = new AbortController();
		const multipart = body instanceof FormData;
		// Large uploads can outlast the conversational reply deadline.
		const timer = multipart ? undefined : setTimeout(() => controller.abort(), 26000);
		const url = new URL(path, api);
		if (query) url.search = new URLSearchParams(query);
		let response;
		let data;
		try {
			response = await fetch(url, {
				method: body ? "POST" : "GET",
				headers: body && !multipart ? { "Content-Type": "application/json" } : { Accept: "application/json" },
				body: body && !multipart ? JSON.stringify(body) : body,
				credentials: "omit",
				signal: controller.signal,
			});
			data = await response.json();
		} catch {
			throw new Error(networkError);
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok || (!stateful && data?.ok !== true)) {
			throw new Error(stateful ? data?.error : data?.message);
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
			<div class="conversation"><div class="messages" role="log" aria-live="polite"></div><fieldset class="survey" hidden></fieldset></div>
			<div class="error" role="alert"></div>
			<form autocomplete="off"><input required type="text" enterkeyhint="send"><button type="submit"></button></form>
			<p class="note"></p>
		</section>`;
		root.append(css, widget);
		document.body.append(host);

		const launcher = widget.querySelector(".launcher");
		const closer = widget.querySelector(".close");
		const panel = widget.querySelector("section");
		const conversation = widget.querySelector(".conversation");
		const log = widget.querySelector(".messages");
		const survey = widget.querySelector(".survey");
		const form = widget.querySelector("form");
		const input = widget.querySelector("input");
		const send = form.querySelector("button");
		const reset = widget.querySelector(".reset");
		const error = widget.querySelector(".error");
		const mobile = window.matchMedia("(max-width: 699px)");
		const viewport = window.visualViewport;

		let lang = language;
		let copy = translations[lang];
		localize(language);

		let history = [];
		let busy = false;
		let ready = !stateful;
		let sid = "";
		let attachmentField;
		let uploaded = [];
		const fileNames = Object.create(null);
		const storageKey = "gorbach-sid";
		if (stateful) {
			try {
				sid = localStorage.getItem(storageKey) || "";
				Object.assign(fileNames, JSON.parse(localStorage.getItem(`${storageKey}-files-${sid}`) || "{}"));
			} catch {}
		}

		function localize(locale, inputType) {
			lang = Object.hasOwn(translations, locale) ? locale : language;
			copy = translations[lang];
			widget.lang = lang;
			launcher.setAttribute("aria-label", copy.open);
			closer.setAttribute("aria-label", copy.close);
			input.placeholder = inputType === "phone" ? surveyLabels[lang].contact : copy.input;
			input.setAttribute("aria-label", input.placeholder);
			send.textContent = copy.send;
			reset.textContent = copy.reset;
			widget.querySelector(".note").textContent = copy.note;
		}

		function scrollToLatest() {
			conversation.scrollTop = conversation.scrollHeight;
		}

		function addMessage(text, className = "") {
			const line = document.createElement("p");
			line.className = className;
			line.textContent = text;
			log.append(line);
			scrollToLatest();
			return line;
		}

		function actionButton(label, action) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = label;
			button.onclick = action;
			return button;
		}

		function saveSession(id) {
			sid = id;
			uploaded = [];
			for (const key of Object.keys(fileNames)) delete fileNames[key];
			try { localStorage.setItem(storageKey, id); } catch {}
		}

		async function answer(payload) {
			renderScreen(await request("msg", { sid, ...payload }));
		}

		function renderReceipt(leadId) {
			const receipt = document.createElement("p");
			receipt.setAttribute("role", "status");
			receipt.textContent = `${surveyLabels[lang].receipt}: ${leadId}`;
			survey.replaceChildren(receipt);
			form.hidden = true;
			scrollToLatest();
		}

		function renderAttachments(screen) {
			const [attach, uploading, confirmFiles, recovery, , , , , , attachments] = attachmentLabels[lang];
			const confirmed = new Set((screen.attachmentAnswers ?? []).flatMap((item) => Object.values(item.fields).flat()));
			if (confirmed.size) {
				const line = document.createElement("p");
				line.textContent = `${attachments} · ${[...confirmed].map((id) => fileNames[id] ?? id).join(", ")}`;
				survey.append(line);
			}
			if (!attachmentField) return;

			const status = document.createElement("p");
			status.setAttribute("role", "status");
			const idleStatus = screen.attachmentRecovery ? recovery : "";
			status.textContent = idleStatus;
			const picker = document.createElement("input");
			picker.type = "file";
			picker.accept = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.mp4,.mov";
			picker.setAttribute("aria-label", attach);
			const files = document.createElement("p");
			const confirm = actionButton(confirmFiles, () => run(() => answer({ files: uploaded.map((file) => file.id) })));
			const update = () => {
				files.textContent = uploaded.map((file) => file.name).join(", ");
				confirm.disabled = !uploaded.length;
			};
			update();
			picker.onchange = () => {
				const file = picker.files?.[0];
				if (!file) return;
				picker.value = "";
				return run(async () => {
					status.textContent = uploading;
					try {
						const data = new FormData();
						data.set("sid", sid);
						data.set("file", file);
						const result = await request("file", data);
						uploaded.push(result.file);
						fileNames[result.file.id] = result.file.name;
						try {
							localStorage.setItem(`${storageKey}-files-${sid}`, JSON.stringify(fileNames));
						} catch {}
						update();
					} finally {
						status.textContent = idleStatus;
					}
				});
			};
			survey.append(picker, status, files);
			if (attachmentField.type === "file") survey.append(confirm);
		}

		function renderReview(review) {
			for (const item of review.products) {
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
			contact.textContent = [review.name, review.phone, review.email].filter(Boolean).join(" · ");
			survey.append(contact);
		}

		function renderChips(screen) {
			const selected = new Set();
			const confirm = actionButton(surveyLabels[lang].confirm, () => run(() => answer({ chips: [...selected] })));
			confirm.disabled = true;
			for (const chip of screen.chips ?? []) {
				const multiple = screen.multi && chip.id !== "skip";
				const choice = actionButton(chip.label, () => {
					if (!multiple) return run(() => answer({ chip: chip.id }));
					if (selected.has(chip.id)) selected.delete(chip.id);
					else selected.add(chip.id);
					choice.setAttribute("aria-pressed", String(selected.has(chip.id)));
					confirm.disabled = !selected.size;
				});
				if (multiple) choice.setAttribute("aria-pressed", "false");
				survey.append(choice);
			}
			if (screen.multi) survey.append(confirm);
		}

		async function submitLead() {
			try {
				const result = await request("submit", { sid });
				if (!result.lead_id) throw new Error();
				renderReceipt(result.lead_id);
			} catch (cause) {
				if (cause.message !== "incomplete") throw cause;
				const restored = await request("history", null, { sid });
				renderScreen(restored, true);
				if (!restored.attachmentRecovery && !restored.lead_id) throw cause;
			}
		}

		function renderScreen(screen, replace = false) {
			localize(screen.lang, screen.input);
			if (replace) log.replaceChildren();
			const messages = screen.messages ?? [];
			for (const { role, text } of messages) addMessage(text, role === "visitor" ? "visitor" : "");
			const last = messages.at(-1);
			if (screen.question && (last?.role !== "bot" || last.text !== screen.question)) addMessage(screen.question);
			survey.hidden = false;
			attachmentField = screen.lead_id ? null : screen.attachmentField;
			uploaded = attachmentField ? screen.pendingAttachments ?? [] : [];
			for (const file of uploaded) fileNames[file.id] = file.name;
			if (screen.lead_id) {
				renderReceipt(screen.lead_id);
				return;
			}
			survey.replaceChildren();
			form.hidden = Boolean(screen.review || attachmentField?.type === "file");
			renderAttachments(screen);
			if (screen.progress) {
				const progress = document.createElement("legend");
				progress.textContent = `${surveyLabels[lang].step} ${screen.progress.step} / ${screen.progress.total}`;
				survey.append(progress);
			}
			if (screen.review) renderReview(screen.review);
			renderChips(screen);
			if (screen.review) {
				const label = screen.review.purpose === "handoff" ? handoffLabels[lang] : surveyLabels[lang].submit;
				survey.append(actionButton(label, () => run(submitLead)));
			}
			scrollToLatest();
		}

		async function restore() {
			if (sid) {
				try {
					renderScreen(await request("history", null, { sid }), true);
					ready = true;
					return;
				} catch (cause) {
					if (cause.message !== "unknown_session") throw cause;
				}
			}
			const start = await request("start", { lang: language, page: location.href });
			saveSession(start.sid);
			renderScreen(start, true);
			ready = true;
		}

		function localizedError(cause) {
			if (!stateful) return cause.message || networkError;
			if (cause.message === "invalid_contact") return surveyLabels[lang].invalidContact;
			const [, , , , type, size, count, total, invalid_attachment] = attachmentLabels[lang];
			const uploadErrors = { type, size, count, total, invalid_attachment };
			return Object.hasOwn(uploadErrors, cause.message) ? uploadErrors[cause.message] : script.dataset.neterr || copy.error;
		}

		async function run(action) {
			if (busy) return;
			busy = true;
			input.readOnly = send.disabled = reset.disabled = survey.disabled = true;
			error.textContent = "";
			try {
				await action();
			} catch (cause) {
				error.textContent = localizedError(cause);
				if (stateful && cause.message === "unknown_session") {
					ready = false;
					try { await restore(); } catch {}
				}
			} finally {
				busy = false;
				input.readOnly = send.disabled = survey.disabled = false;
				reset.disabled = !ready;
				scrollToLatest();
				if (!panel.hidden && !mobile.matches && !form.hidden) input.focus();
			}
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
				if (!ready) void run(restore);
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
		reset.onclick = () => run(async () => {
			if (stateful) {
				const result = await request("reset", { sid });
				saveSession(result.sid);
				ready = false;
				attachmentField = null;
				survey.replaceChildren();
				survey.hidden = true;
				form.hidden = false;
				localize(language);
				clearConversation();
				await restore();
			} else {
				clearConversation();
			}
		});

		form.onsubmit = async (event) => {
			event.preventDefault();
			const text = input.value.trim();
			if (!text || busy) return;
			if (Array.from(text).length > 800) {
				error.textContent = copy.limit;
				return;
			}

			return run(async () => {
				if (!ready) await restore();
				if (form.hidden) return;
				const needsFiles = attachmentField?.type === "text+file";
				if (needsFiles && !uploaded.length) throw new Error("invalid_attachment");
				const draft = input.value;
				input.value = "";
				const visitor = addMessage(text, "visitor");
				const waiting = document.createElement("div");
				waiting.className = "waiting";
				waiting.setAttribute("role", "status");
				waiting.setAttribute("aria-label", copy.waiting);
				log.append(waiting);
				scrollToLatest();
				try {
					if (stateful) {
						await answer(needsFiles ? { text, files: uploaded.map((file) => file.id) } : { text });
					} else {
						const { reply } = await request("msg", { text, history });
						if (typeof reply !== "string" || !reply.trim()) throw new Error(networkError);
						history.push({ role: "user", text }, { role: "assistant", text: reply });
						history = history.slice(-historyLimit);
						addMessage(reply);
					}
				} catch (cause) {
					if (!stateful) visitor.remove();
					input.value = draft;
					throw cause;
				} finally {
					if (stateful) visitor.remove();
					waiting.remove();
				}
			});
		};

		clearConversation();
		request("status", null, stateful ? { lang: language } : undefined).then((status) => {
			if (!stateful) {
				widget.hidden = status.enabled !== true;
				return;
			}
			if (typeof status.public !== "boolean") return;
			if (typeof status.start?.greeting === "string" && !script.dataset.greet) {
				log.replaceChildren();
				addMessage(status.start.greeting);
			}
			let preview = false;
			try { preview = localStorage.getItem("gorbach-preview") === "1"; } catch {}
			function updateVisibility() {
				if (location.hash === "#gzbot" || location.hash === "#gzbot-off") {
					preview = location.hash === "#gzbot";
					try {
						if (preview) localStorage.setItem("gorbach-preview", "1");
						else localStorage.removeItem("gorbach-preview");
					} catch {}
				}
				widget.hidden = status.enabled !== true || (!status.public && !preview);
			}
			updateVisibility();
			window.addEventListener("hashchange", updateVisibility);
		}).catch(() => {});
	}

	if (document.body) mount();
	else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
