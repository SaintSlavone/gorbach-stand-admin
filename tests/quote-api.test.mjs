import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileLimits } from "../src/lib/attachments.ts";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import next from "next";
import { migrateServiceProducts } from "../src/lib/service-migration.ts";
import { validateRevision } from "../src/lib/validate-revision.ts";

const requests = [];
let provider = () => Response.json({}, { status: 503 });
const originalFetch = globalThis.fetch;
function addKnowledge(text, lang = "en") {
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('knowledge',?,'tester','staff')",
		)
		.run(JSON.stringify([{ id: "section", title: "Information", lang, text }]));
}
let app, server, sql, origin, directory;
before(async () => {
	directory = mkdtempSync(path.join(tmpdir(), "gorbach-quote-"));
	process.env.GORBACH_DATA_DIR = directory;
	process.env.GEMINI_API_KEY = "test-only";
	process.env.GEMINI_MODEL = "fixture-model";
	globalThis.fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : input);
		if (url.hostname !== "generativelanguage.googleapis.com")
			return originalFetch(input, init);
		const req = new Request(input, init);
		requests.push(await req.json());
		return provider(req);
	};
	app = next({ dev: false });
	await app.prepare();
	server = createServer(app.getRequestHandler());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	origin = "http://127.0.0.1:" + server.address().port;
	await start();
	sql = new DatabaseSync(path.join(directory, "admin.sqlite"));
	const fixture = readFileSync(
		new URL("./fixtures/quote-survey.json", import.meta.url),
		"utf8",
	);
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('survey',?,'tester','staff')",
		)
		.run(fixture);
	addKnowledge("Fixture knowledge");
});
after(async () => {
	if (server) {
		const closed = once(server, "close");
		server.close();
		server.closeAllConnections();
		await closed;
	}
	await app?.close();
	sql?.close();
	globalThis.fetch = originalFetch;
	// The app owns a process-lifetime SQLite connection. Windows releases it on exit.
});
async function api(route, body, status = 200, headers = {}) {
	const response = await fetch(
		origin + "/api/" + route,
		body
			? {
					method: "POST",
					headers: { "Content-Type": "application/json", ...headers },
					body: JSON.stringify(body),
				}
			: {},
	);
	const data = await response.json();
	assert.ok(
		[status].flat().includes(response.status),
		`${response.status} ${JSON.stringify(data)}`,
	);
	return data;
}
async function start() {
	return (await api("start", { page: "/", lang: "cs" })).sid;
}
test("a second product must reach review before concurrent submissions create one lead", async () => {
	const sid = await start(),
		msg = (body) => api("msg", { sid, ...body });
	await msg({ chip: "quote" });
	await msg({ chip: "sample" });
	await msg({ chip: "Původní" });
	await msg({ chip: "skip" });
	await msg({ text: "Jana" });
	assert.ok((await msg({ text: "jana@example.com" })).review);
	await msg({ chip: "add_product" });
	await msg({ chip: "sample" });
	const optional = await msg({ chip: "Původní" });
	assert.equal(optional.question, "Poznámka?");
	assert.equal(optional.review, null);
	assert.equal((await api("history?sid=" + sid)).review, null);
	const rejection = await api("submit", { sid }, 400);
	assert.equal(rejection.error, "incomplete");
	assert.equal(rejection.ok, false);
	assert.ok(rejection.missing.length);
	const count = () =>
		sql.prepare("SELECT count(*) AS n FROM leads WHERE dialog=?").get(sid).n;
	assert.equal(count(), 0);
	const final = await msg({ chip: "skip" });
	assert.equal(final.review.products.length, 2);
	const beforeSubmit = await api("history?sid=" + sid);
	assert.deepEqual(beforeSubmit.review, final.review);
	const [first, second] = await Promise.all([
		api("submit", { sid }),
		api("submit", { sid }),
	]);
	assert.ok(first.lead_id);
	assert.deepEqual(second, first);
	assert.deepEqual(await api("submit", { sid }), first);
	assert.equal(count(), 1);
	assert.equal(requests.length, 0);
	const submitted = await api("history?sid=" + sid);
	assert.equal(submitted.lead_id, first.lead_id);
	assert.deepEqual(submitted.chips, []);
	assert.equal(submitted.review, null);
	assert.equal(submitted.progress, null);
	assert.equal(submitted.question, undefined);
	assert.deepEqual(submitted.messages, beforeSubmit.messages);
});
test("localized price phrases open product selection and ordinary text stays in chat", async () => {
	for (const text of [
		"Kolik stojí?",
		"cost",
		"Price?",
		"quote",
		"Preis?",
		"cena",
		"cenu",
		"сколько стоит",
		"ціна",
		"вартість",
	]) {
		const sid = await start();
		const result = await api("msg", { sid, text });
		assert.ok(
			result.chips.some((c) => c.id === "sample"),
			text,
		);
	}
	for (const text of ["Kolik stojících lidí?", "necena"]) {
		const sid = await start();
		const result = await api("msg", { sid, text });
		assert.deepEqual(
			result.chips.map((choice) => choice.id),
			["products", "quote", "specialist"],
			text,
		);
		assert.match(result.messages.at(-1).text, /ověřenou odpověď/i);
	}
});
test("review labels and answers use the pinned survey after a newer revision is saved", async () => {
	const sid = await start(),
		msg = (body) => api("msg", { sid, ...body });
	await msg({ chip: "quote" });
	await msg({ chip: "sample" });
	const newer = JSON.parse(
		readFileSync(new URL("./fixtures/quote-survey.json", import.meta.url), "utf8"),
	);
	newer.products.sample.title.cs = "Updated title";
	newer.products.sample.fields[0].q = "Updated question";
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('survey',?,'tester','staff')",
		)
		.run(JSON.stringify(newer));
	await msg({ chip: "Nový" });
	await msg({ chips: ["B", "A"] });
	await msg({ chip: "skip" });
	await msg({ text: "Jana" });
	const { review } = await msg({ text: "jana@example.com" });
	assert.deepEqual(review.products[0], {
		product: "sample",
		title: "Testovací produkt",
		answers: { stage: "Nový", options: ["B", "A"], note: "neví" },
		questionLabels: { stage: "Stav?", options: "Možnosti?", note: "Poznámka?" },
		answerLabels: { stage: "Nový", options: ["B", "A"], note: "neví" },
	});
	assert.deepEqual((await api("history?sid=" + sid)).review, review);
});
test("chip turns display the offered labels in replies and history", async () => {
	const sid = await start();
	const labels = [];
	for (const [payload, label] of [
		[{ chip: "quote" }, "Poptávka"],
		[{ chip: "sample" }, null],
		[{ chip: "Nový" }, "Nový"],
		[{ chips: ["B", "A"] }, "B, A"],
	]) {
		const history = await api("history?sid=" + sid);
		const expected = label ?? history.chips.find((c) => c.id === "sample").label;
		const reply = await api("msg", { sid, ...payload });
		assert.equal(reply.messages[0].text, expected);
		labels.push(expected);
	}
	assert.deepEqual(
		(await api("history?sid=" + sid)).messages
			.filter((m) => m.role === "visitor")
			.map((m) => m.text),
		labels,
	);
});
test("English prompts and translated choices retain the displayed labels and stable answers", async () => {
	const survey = JSON.parse(
		readFileSync(new URL("./fixtures/quote-survey.json", import.meta.url), "utf8"),
	);
	const product = survey.products.sample;
	product.title.en = "Sample product";
	product.fields[1].translations = {
		en: { q: "Which options?", chips: { A: "First option", B: "Second option" } },
	};
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('survey',?,'tester','staff')",
		)
		.run(JSON.stringify(survey));
	const { sid } = await api("start", { page: "/", lang: "en" });
	const msg = (body) => api("msg", { sid, ...body });
	const pick = await msg({ chip: "quote" });
	assert.equal(pick.question, "Which product are you interested in?");
	assert.equal(pick.messages[0].text, "Request a quote");
	const stage = await msg({ chip: "sample" });
	assert.equal(stage.messages[0].text, "Sample product");
	assert.equal(stage.question, "Stav?");
	const multi = await msg({ chip: "Nový" });
	assert.equal(multi.question, "Which options?");
	assert.deepEqual(multi.chips[0], { id: "A", label: "First option" });
	const note = await msg({ chips: ["B", "A"] });
	assert.equal(note.messages[0].text, "Second option, First option");
	assert.equal(note.question, "Poznámka?");
	const name = await msg({ chip: "skip" });
	assert.equal(name.question, "What is your name?");
	assert.equal(name.messages[0].text, "Skip");
	assert.equal(
		(await msg({ text: "Jane" })).question,
		"What is your phone number or email address?",
	);
	const summary = await msg({ text: "jane@example.com" });
	assert.equal(summary.question, "Quote summary");
	assert.equal(summary.review.products[0].questionLabels.options, "Which options?");
	const history = await api("history?sid=" + sid);
	for (const { review } of [summary, history]) {
		assert.deepEqual(review.products[0].answerLabels.options, [
			"Second option",
			"First option",
		]);
		assert.deepEqual(review.products[0].answers.options, ["B", "A"]);
		assert.equal(review.products[0].answerLabels.stage, "Nový");
	}
	assert.deepEqual(
		history.messages.filter((m) => m.role === "visitor").map((m) => m.text),
		[
			"Request a quote",
			"Sample product",
			"Nový",
			"Second option, First option",
			"Skip",
			"Jane",
			"jane@example.com",
		],
	);
});
test("general questions use pinned knowledge and restore validated replies and fallbacks", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const old = "The showroom opens at nine.";
	addKnowledge(old);
	const { sid } = await api("start", {
		lang: "en",
		page: "/private-page",
		utm: { name: "secret-campaign" },
	});
	addKnowledge("The showroom opens at noon.");
	const msg = (body) => api("msg", { sid, ...body });
	const initial = requests.length;
	assert.equal(
		(await msg({ chip: "question" })).messages[1].text,
		"What would you like to know about Gorbach shading?",
	);
	assert.equal(requests.length, initial);
	const result = (payload) =>
		Response.json({
			candidates: [
				{
					finishReason: "STOP",
					content: {
						parts: [{ text: JSON.stringify({ scope: "consultation", ...payload }) }],
					},
				},
			],
		});
	provider = () => {
		// An independent SQLite connection can acquire a write lock during generation.
		sql.exec("BEGIN IMMEDIATE; ROLLBACK");
		return result({ reply: old, unknown: false, evidence: old });
	};
	const reply = await msg({
		text:
			"When do you open? My name is Jane Nováková. Reach me at jane@example.org or +420 123 456 789.",
		attachments: ["private-file.pdf"],
	});
	assert.equal(reply.messages[1].text.split("\n\n")[0], old);
	assert.match(reply.messages[1].text, /What would you like to shade\?/);
	assert.ok(reply.messages[0].text.includes("Jane Nováková"));
	const body = JSON.stringify(requests.at(-1));
	assert.ok(body.includes("When do you open?"));
	assert.ok(body.includes(old));
	for (const omitted of [
		"at noon",
		"Jane Nováková",
		"jane@example",
		"123 456",
		"private-file",
		"private-page",
		"secret-campaign",
		sid,
	])
		assert.ok(!body.includes(omitted), omitted);
	assert.deepEqual((await api("history?sid=" + sid)).messages.slice(-2), reply.messages);
	const unsupported = /^I don’t have a verified answer in the Gorbach knowledge base\./;
	const unavailable = /^I can’t look up a verified answer right now\./;
	for (const [callback, expected] of [
		[() => result({ unknown: true, reply: "", evidence: "" }), unsupported],
		[
			() =>
				result({ unknown: false, reply: "The showroom opens at midnight.", evidence: old }),
			unsupported,
		],
		[
			() => result({ unknown: false, reply: "Unsupported", evidence: "absent" }),
			unsupported,
		],
		[() => result({ unknown: "no", reply: 17 }), unavailable],
		[() => Response.json({}, { status: 429 }), unavailable],
		[
			() => {
				throw new DOMException("timeout", "TimeoutError");
			},
			unavailable,
		],
	]) {
		const another = await api("start", { lang: "en", page: "/" });
		provider = callback;
		assert.match(
			(await api("msg", { sid: another.sid, text: "Another question?" })).messages[1].text,
			expected,
		);
	}
	const n = requests.length;
	delete process.env.GEMINI_API_KEY;
	try {
		assert.match(
			(await msg({ text: "Missing configuration?" })).messages[1].text,
			unavailable,
		);
		assert.equal(requests.length, n);
	} finally {
		process.env.GEMINI_API_KEY = "test-only";
	}
	assert.match((await api("history?sid=" + sid)).messages.at(-1).text, unavailable);
});
test("concurrent provider attempts respect rolling session and IP limits and the daily budget", async () => {
	process.env.GORBACH_TRUST_PROXY = "true";
	process.env.GORBACH_DAY_LIMIT_MSGS = "1500";
	addKnowledge("Montujeme žaluzie.", "cs");
	const sids = await Promise.all(Array.from({ length: 13 }, () => start()));
	provider = () =>
		Response.json({
			candidates: [
				{
					finishReason: "STOP",
					content: {
						parts: [
							{
								text: JSON.stringify({
									unknown: false,
									scope: "consultation",
									reply: "Montujeme žaluzie.",
									evidence: "Montujeme žaluzie.",
								}),
							},
						],
					},
				},
			],
		});
	async function burst(session, ip, expected, limit, overlapping = false) {
		sql.exec("DELETE FROM gemini_attempts");
		const prior = requests.length;
		const responses = await Promise.all(
			sids.map((_, i) =>
				api(
					"msg",
					{ sid: session(i), text: "Montujete žaluzie?" },
					overlapping ? [200, 409] : 200,
					{
						"x-real-ip": ip(i),
					},
				),
			),
		);
		assert.equal(requests.length - prior, expected);
		if (overlapping) {
			const next = await api("msg", { sid: session(0), text: "Montujete žaluzie?" }, 200, {
				"x-real-ip": "192.0.2.240",
			});
			assert.equal(next.messages.at(-1).text, limit);
		} else {
			assert.equal(
				responses.filter((r) => r.messages[1].text === limit).length,
				13 - expected,
			);
		}
	}
	try {
		await burst(
			() => sids[0],
			(i) => "192.0.2." + (i + 1),
			12,
			"Zkuste to prosím později.",
			true,
		);
		await burst(
			(i) => sids[i],
			() => "192.0.2.1",
			12,
			"Zkuste to prosím později.",
		);
		process.env.GORBACH_DAY_LIMIT_MSGS = "2";
		await burst(
			(i) => sids[i],
			(i) => "192.0.2." + (i + 1),
			2,
			"Zkuste to prosím později. info@gorbach-zaluzie.cz",
		);
	} finally {
		delete process.env.GORBACH_TRUST_PROXY;
		delete process.env.GORBACH_DAY_LIMIT_MSGS;
	}
});
test("self-introduction filtering preserves ordinary interests and subsequent questions", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	provider = () => Response.json({}, { status: 503 });
	for (const [lang, text, expected, privateText] of [
		[
			"en",
			"I'm interested in outdoor blinds. Do you install them?",
			"I'm interested in outdoor blinds. Do you install them?",
		],
		[
			"en",
			"I am looking for shades. Can you help?",
			"I am looking for shades. Can you help?",
		],
		[
			"en",
			"My name is Jane Nováková. Do you install blinds?",
			"Do you install blinds?",
			"Jane Nováková",
		],
		[
			"en",
			"I'm Jane Nováková. Do you install blinds?",
			"Do you install blinds?",
			"Jane Nováková",
		],
		[
			"en",
			"My address is 24 Park Road. Do you install blinds?",
			"Do you install blinds?",
			"24 Park Road",
		],
		[
			"cs",
			"Jsem zvědavý na montáž. Montujete žaluzie?",
			"Jsem zvědavý na montáž. Montujete žaluzie?",
		],
		["de", "Ich bin an Jalousien interessiert.", "Ich bin an Jalousien interessiert."],
		["ru", "Я хочу заказать жалюзи.", "Я хочу заказать жалюзи."],
		["uk", "Я хочу замовити жалюзі.", "Я хочу замовити жалюзі."],
	]) {
		addKnowledge("Fixture", lang);
		const { sid } = await api("start", { lang, page: "/" });
		const before = requests.length;
		await api("msg", { sid, text });
		assert.equal(requests.length, before + 1);
		const outgoing = JSON.parse(requests.at(-1).contents[0].parts[0].text).question;
		if (privateText) {
			assert.ok(!outgoing.includes(privateText));
			assert.ok(outgoing.includes(expected));
		} else assert.equal(outgoing, expected);
	}
});
test("knowledge replies require an exact pinned source line and verified cross-language translation", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const czech = "Montujeme venkovní žaluzie.",
		english = "We install outdoor blinds.";
	const sections = [
		{ id: "legacy", title: "Montáž", text: czech },
		{ id: "malformed", title: "Invalid language", text: "Malformed source.", lang: 123 },
	];
	const save = () =>
		sql
			.prepare(
				"INSERT INTO revisions(kind,content,editor,provenance) VALUES('knowledge',?,'tester','staff')",
			)
			.run(JSON.stringify(sections));
	const ask = async (lang) => {
		const { sid } = await api("start", { page: "/", lang });
		return (
			await api("msg", {
				sid,
				text: lang === "cs" ? "Montujete žaluzie?" : "Do you install blinds?",
			})
		).messages[1].text.split("\n\n")[0];
	};
	const fallback = /^I don’t have a verified answer in the Gorbach knowledge base\./;
	save();
	provider = () => geminiResult(czech);
	const before = requests.length;
	assert.match(await ask("en"), fallback);
	assert.equal(requests.length, before + 2);
	assert.equal(await ask("cs"), czech);
	provider = () => {
		const request = requests.at(-1);
		const data = JSON.parse(request.contents[0].parts[0].text);
		if (request.generationConfig.responseSchema.properties.faithful) {
			assert.deepEqual(data, {
				evidence: czech,
				sourceLanguage: "cs",
				reply: english,
				targetLanguage: "en",
			});
			return geminiResponse({ faithful: true });
		}
		assert.deepEqual(
			data.sections.map((section) => section.language),
			["cs"],
		);
		return geminiResult(english, false, "en", czech);
	};
	assert.equal(await ask("en"), english);
	provider = () =>
		requests.at(-1).generationConfig.responseSchema.properties.faithful
			? geminiResponse({ faithful: false })
			: geminiResult(english + " They include a free motor.", false, "en", czech);
	assert.match(await ask("en"), fallback);
	sections.push({
		id: "installation",
		lang: "en-US",
		title: "Installation",
		text: english,
	});
	save();
	provider = () => geminiResult(english);
	const sameLanguage = requests.length;
	assert.equal(await ask("en"), english);
	assert.equal(requests.length, sameLanguage + 1);
	assert.ok(!JSON.stringify(requests.at(-1)).includes("Malformed source."));
	sections.at(-1).lang = "EN";
	save();
	assert.equal(await ask("en"), english);
	for (const invalid of ["en_US", "en-", "fr-CA"]) {
		sql.exec("DELETE FROM gemini_attempts");
		sections.at(-1).lang = invalid;
		save();
		assert.match(await ask("en"), fallback);
	}
});
test("knowledge validation accepts only supported explicit language codes or an omitted language", () => {
	const section = { id: "test", title: "Test", text: "Test" };
	const validate = (entry) => validateRevision("knowledge", JSON.stringify([entry]));
	for (const lang of [123, null, "fr", "", "en-US", "EN", {}])
		assert.throws(() => validate({ ...section, lang }));
	for (const lang of ["cs", "en", "de", "ru", "uk"])
		assert.deepEqual(validate({ ...section, lang }), [{ ...section, lang }]);
	assert.deepEqual(validate(section), [section]);
});
function geminiResponse(result) {
	return Response.json({
		candidates: [
			{
				finishReason: "STOP",
				content: { parts: [{ text: JSON.stringify(result) }] },
			},
		],
	});
}
function geminiResult(
	reply,
	unknown = false,
	language,
	evidence = reply,
	scope = "consultation",
) {
	return geminiResponse({ reply, evidence, unknown, language, scope });
}

const shippedKnowledge = () =>
	JSON.parse(
		readFileSync(new URL("../data/initial/knowledge.json", import.meta.url), "utf8"),
	);
function saveKnowledgeSections(sections) {
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('knowledge',?,'tester','staff')",
		)
		.run(JSON.stringify(sections));
}

test("public contact requests use pinned business information in the visitor language without spending Gemini quota", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const real = shippedKnowledge().find(({ id }) => id === "kontakt");
	const pinned = {
		...real,
		text:
			real.text +
			"\nVisitor email: private-lead@gorbach-zaluzie.cz\nEmail: visitor@example.org",
	};
	saveKnowledgeSections([pinned]);
	const { sid } = await api("start", { lang: "cs", page: "/" });
	saveKnowledgeSections([{ ...real, text: "Obecný kontakt: newer@gorbach-zaluzie.cz" }]);
	const msg = (text) => api("msg", { sid, text });
	const before = requests.length;
	delete process.env.GEMINI_API_KEY;
	try {
		const screenshot = await msg("Jaké jsou vaše kontakty, jak vás mohu kontaktovat?");
		assert.equal(screenshot.lang, "cs");
		assert.match(
			screenshot.messages.at(-1).text,
			/Obecný kontakt: info@gorbach-zaluzie\.cz/,
		);
		assert.match(screenshot.messages.at(-1).text, /Plzeňská 197\/100/);
		assert.doesNotMatch(
			screenshot.messages.at(-1).text,
			/newer|private-lead|visitor@example/,
		);
		const quote = await msg("What is the Gorbach email for a quote?");
		assert.equal(quote.lang, "en");
		assert.match(quote.messages.at(-1).text, /poptavky@gorbach-zaluzie\.cz/);
		assert.equal(quote.progress, null);
		const service = await msg("Wie lautet Ihre E-Mail für den Service?");
		assert.equal(service.lang, "de");
		assert.match(service.messages.at(-1).text, /servis@gorbach-zaluzie\.cz/);
		const complaint = await msg("На яку електронну пошту вашої компанії надіслати скаргу?");
		assert.equal(complaint.lang, "uk");
		assert.match(complaint.messages.at(-1).text, /reklamace@gorbach-zaluzie\.cz/);
		const bare = await msg("Контакти?");
		assert.equal(bare.lang, "uk");
		assert.match(bare.messages.at(-1).text, /Загальний контакт: info@gorbach-zaluzie\.cz/);
		assert.match(
			(await msg("Какой у вас телефон?")).messages.at(-1).text,
			/^У меня нет подтверждённых/,
		);
		assert.match(
			(await msg("English?")).messages.at(-1).text,
			/^Yes, I can help in English\./,
		);
		assert.equal((await api("history?sid=" + sid)).lang, "en");
		for (const [phrase, lang, headline] of [
			["Як з вами зв’язатися?", "uk", "Загальний контакт"],
			["Как с вами связаться?", "ru", "Общий контакт"],
		]) {
			const fresh = await api("start", { lang: "cs", page: "/" });
			const contact = await api("msg", { sid: fresh.sid, text: phrase });
			assert.equal(contact.lang, lang);
			assert.ok(contact.messages.at(-1).text.startsWith(headline));
		}
		assert.equal(requests.length, before);
	} finally {
		process.env.GEMINI_API_KEY = "test-only";
	}
	provider = () => geminiResult("", true, "en");
	const privateRequest = await msg("What is a customer's email address?");
	assert.doesNotMatch(
		privateRequest.messages.at(-1).text,
		/@gorbach-zaluzie\.cz|visitor@example/,
	);
	assert.equal(requests.length, before + 1);
	assert.doesNotMatch(
		JSON.stringify(requests.at(-1)),
		/private-lead|visitor@example|poptavky@gorbach/,
	);
});

test("a Czech product fact can be rendered in Ukrainian after a failed verifier, with bounded retry", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const source = shippedKnowledge().find(({ id }) => id === "venkovni-zaluzie");
	const line =
		"Nabízíme například Zetta 90, Zetta 70, Cetta 80 a Cetta 65 v různých montážních provedeních.";
	assert.ok(source.text.split("\n").includes(line));
	saveKnowledgeSections([source]);
	const { sid } = await api("start", { lang: "cs", page: "/" });
	const before = requests.length;
	let selections = 0,
		verifications = 0;
	const question =
		"Які типи зовнішніх жалюзі ваша фірма пропонує для різних монтажних виконань?";
	const translation =
		"Ми пропонуємо, зокрема, Zetta 90, Zetta 70, Cetta 80 і Cetta 65 у різних монтажних виконаннях.";
	provider = () => {
		const request = requests.at(-1);
		const data = JSON.parse(request.contents[0].parts[0].text);
		const properties = request.generationConfig.responseSchema.properties;
		if (properties.translation) {
			assert.deepEqual(data, { evidence: line, sourceLanguage: "cs", targetLanguage: "uk" });
			return geminiResponse({ translation });
		}
		if (properties.faithful) {
			verifications++;
			assert.deepEqual(data, {
				evidence: line,
				sourceLanguage: "cs",
				reply: translation,
				targetLanguage: "uk",
			});
			return verifications === 1
				? Response.json({}, { status: 503 })
				: geminiResponse({ faithful: true });
		}
		selections++;
		assert.equal(data.knownLanguage, "uk");
		assert.equal(data.question, question);
		assert.match(request.systemInstruction.parts[0].text, /close literal translation/);
		return geminiResult(translation, false, "uk", [line]);
	};
	const answer = await api("msg", { sid, text: question });
	assert.equal(answer.lang, "uk");
	assert.equal(answer.messages.at(-1).text.split("\n\n")[0], translation);
	assert.equal(requests.length, before + 4);
	assert.equal(selections, 1);
	assert.equal(verifications, 2);
	const switched = await api("msg", { sid, text: "English?" });
	assert.equal(switched.lang, "en");
	assert.equal(requests.length, before + 4);
});

test("a rejected paraphrase is repaired from the same exact product line and reverified within one deadline", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const source = shippedKnowledge().find(({ id }) => id === "venkovni-zaluzie");
	const line = "Vhodné pro novostavby i dokončené objekty.";
	const translated = "Підходять як для новобудов, так і для вже збудованих об’єктів.";
	const rejected = "Підходять для будь-яких нових і готових будинків без обмежень.";
	assert.ok(source.text.split("\n").includes(line));
	saveKnowledgeSections([source]);
	const { sid } = await api("start", { lang: "cs", page: "/" });
	const originalTimeout = AbortSignal.timeout;
	const timeouts = [];
	AbortSignal.timeout = (ms) => {
		timeouts.push(ms);
		return originalTimeout(ms);
	};
	let verifications = 0;
	provider = () => {
		const request = requests.at(-1);
		const data = JSON.parse(request.contents[0].parts[0].text);
		const properties = request.generationConfig.responseSchema.properties;
		if (properties.translation) {
			assert.deepEqual(data, { evidence: line, sourceLanguage: "cs", targetLanguage: "uk" });
			return geminiResponse({ translation: translated });
		}
		if (properties.faithful) {
			verifications++;
			assert.equal(data.reply, verifications === 1 ? rejected : translated);
			assert.equal(data.evidence, line);
			return geminiResponse({ faithful: verifications === 2 });
		}
		return geminiResult(rejected, false, "uk", [line]);
	};
	const before = requests.length;
	try {
		const reply = await api("msg", {
			sid,
			text: "Чи підходять зовнішні жалюзі для вже збудованого будинку?",
		});
		assert.equal(reply.lang, "uk");
		assert.equal(reply.messages.at(-1).text.split("\n\n")[0], translated);
		assert.equal(requests.length, before + 4);
		assert.equal(timeouts.filter((ms) => ms === 28_000).length, 1);
		const other = await api("start", { lang: "cs", page: "/" });
		provider = () => {
			const properties = requests.at(-1).generationConfig.responseSchema.properties;
			if (properties.translation) return geminiResponse({ translation: translated });
			if (properties.faithful) return geminiResponse({ faithful: false });
			return geminiResult(rejected, false, "uk", [line]);
		};
		const refused = await api("msg", {
			sid: other.sid,
			text: "Чи підходять зовнішні жалюзі для вже збудованого будинку?",
		});
		assert.match(refused.messages.at(-1).text, /немає підтвердженої відповіді/);
		assert.ok(!refused.messages.at(-1).text.includes(translated));
		assert.equal(requests.length, before + 8);
	} finally {
		AbortSignal.timeout = originalTimeout;
	}
});

test("the pinned exterior-blind blackout FAQ preserves the same qualification in all five languages", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const source = shippedKnowledge().find(({ id }) => id === "venkovni-zaluzie");
	const evidence =
		"Žaluzie typu Z poskytují velmi vysoký stupeň zastínění, ale úplné zatemnění nelze garantovat.";
	assert.ok(source.text.includes(evidence));
	saveKnowledgeSections([source]);
	const cases = [
		[
			"cs",
			"Zatemňují venkovní žaluzie místnost úplně?",
			/zastínění.*úplné zatemnění nelze garantovat/,
		],
		[
			"en",
			"Do exterior blinds completely darken a room?",
			/shading.*complete blackout cannot be guaranteed/,
		],
		[
			"de",
			"Verdunkeln Außenjalousien einen Raum vollständig?",
			/Verschattung.*vollständige Verdunkelung lässt sich jedoch nicht garantieren/,
		],
		[
			"ru",
			"Полностью ли затемняют комнату наружные жалюзи?",
			/затенения.*полное затемнение нельзя гарантировать/,
		],
		[
			"uk",
			"Чи повністю затемнюють кімнату зовнішні жалюзі?",
			/затінення.*повне затемнення не можна гарантувати/,
		],
	];
	const before = requests.length;
	delete process.env.GEMINI_API_KEY;
	try {
		for (const [lang, question, expected] of cases) {
			const { sid } = await api("start", { lang: "cs", page: "/" });
			const result = await api("msg", { sid, text: question });
			assert.equal(result.lang, lang);
			assert.match(result.messages.at(-1).text, expected);
		}
		saveKnowledgeSections([
			{
				...source,
				text: source.text.replace(evidence, "Nabízíme různé možnosti zastínění."),
			},
		]);
		const { sid } = await api("start", { lang: "cs", page: "/" });
		const revised = await api("msg", { sid, text: cases[1][1] });
		assert.doesNotMatch(
			revised.messages.at(-1).text,
			/complete blackout cannot be guaranteed/,
		);
		assert.equal(requests.length, before);
	} finally {
		process.env.GEMINI_API_KEY = "test-only";
	}
});

test("explicit exterior-blind model lists read only the pinned Czech offer and answer in all five languages offline", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const shipped = shippedKnowledge();
	const source = shipped.find(({ id }) => id === "venkovni-zaluzie");
	const line =
		"Nabízíme například Zetta 90, Zetta 70, Cetta 80 a Cetta 65 v různých montážních provedeních.";
	assert.ok(source.text.split("\n").includes(line));
	saveKnowledgeSections(shipped);
	const cases = [
		["cs", "Jaké typy venkovních žaluzií nabízíte?", /^Z venkovních žaluzií nabízíme/],
		["en", "What types of blinds does your company offer?", /^Our exterior blind models/],
		[
			"de",
			"Welche Modelle von Außenjalousien bieten Sie an?",
			/^Zu unseren Außenjalousien/,
		],
		[
			"ru",
			"Какие типы жалюзи предлагает ваша фирма?",
			/^Среди наших моделей наружных жалюзи/,
		],
		["uk", "Які типи жалюзі пропонує ваша фірма?", /^Серед наших моделей зовнішніх жалюзі/],
	];
	const sessions = [];
	for (const row of cases) {
		const { sid } = await api("start", { lang: "cs", page: "/" });
		sessions.push([row, sid]);
	}
	saveKnowledgeSections([
		{ ...source, text: source.text.replace(line, "Nabízíme modely Zetta 95 a Cetta 85.") },
	]);
	const before = requests.length;
	delete process.env.GEMINI_API_KEY;
	try {
		for (const [[lang, question, intro], sid] of sessions) {
			const result = await api("msg", { sid, text: question });
			assert.equal(result.lang, lang);
			const reply = result.messages.at(-1).text;
			assert.match(reply, intro);
			for (const model of ["Zetta 90", "Zetta 70", "Cetta 80", "Cetta 65"])
				assert.ok(reply.includes(model));
			assert.doesNotMatch(reply, /Zetta 95|Cetta 85/);
			assert.equal((await api("history?sid=" + sid)).lang, lang);
		}
		const revised = await api("start", { lang: "cs", page: "/" });
		const actual = await api("msg", { sid: revised.sid, text: cases[4][1] });
		assert.match(actual.messages.at(-1).text, /Zetta 95.*Cetta 85/);
		assert.doesNotMatch(actual.messages.at(-1).text, /Zetta 90/);
		const unrelated = await api("msg", {
			sid: revised.sid,
			text: "What types of blinds does your company offer for cars?",
		});
		assert.doesNotMatch(unrelated.messages.at(-1).text, /Zetta|Cetta/);
		assert.equal(requests.length, before);
		assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM gemini_attempts").get().n, 0);
	} finally {
		process.env.GEMINI_API_KEY = "test-only";
	}
});

test("Gemini scope sends focused product and shared excerpts, falls back to the complete corpus, and uses LOW only on 3.8 Flash", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const originalModel = process.env.GEMINI_MODEL;
	const shipped = shippedKnowledge();
	saveKnowledgeSections(shipped);
	const fact = "Možnost elektrického i manuálního ovládání.";
	const translation = "Electric and manual controls are available.";
	const ask = async (text) => {
		const { sid } = await api("start", { lang: "en", page: "/" });
		return api("msg", { sid, text });
	};
	const outbound = (request) => JSON.parse(request.contents[0].parts[0].text);
	try {
		let selections = 0;
		process.env.GEMINI_MODEL = "gemini-3.8-flash";
		const before = requests.length;
		provider = () => {
			const request = requests.at(-1);
			assert.deepEqual(request.generationConfig.thinkingConfig, { thinkingLevel: "LOW" });
			if (request.generationConfig.responseSchema.properties.faithful)
				return geminiResponse({ faithful: true });
			selections++;
			const { sections } = outbound(request);
			if (selections === 1) {
				assert.ok(sections.some((section) => section.product === "outdoor-blinds"));
				assert.ok(
					sections.some(
						(section) => /chytrá domácnost/i.test(section.title) && section.text.length <= 1500,
					),
				);
				assert.ok(
					sections.some(
						(section) => section.title === "Pravidelná údržba a servisní prohlídky",
					),
				);
				assert.ok(!sections.some((section) => section.product === "pergolas"));
				return geminiResult("", true, "en", []);
			}
			assert.equal(sections.length, shipped.length);
			return geminiResult(translation, false, "en", [fact]);
		};
		assert.equal(
			(await ask("Can exterior blinds be controlled with a switch?")).messages
				.at(-1)
				.text.split("\n\n")[0],
			translation,
		);
		assert.equal(requests.length, before + 3);
		const [focused, complete] = requests.slice(before, before + 2);
		assert.ok(
			Buffer.byteLength(JSON.stringify(focused)) <
				Buffer.byteLength(JSON.stringify(complete)) / 2,
		);
		process.env.GEMINI_MODEL = "fixture-model";
		provider = () => {
			const request = requests.at(-1);
			assert.equal(request.generationConfig.thinkingConfig, undefined);
			assert.equal(outbound(request).sections.length, shipped.length);
			return geminiResult("", true, "en", []);
		};
		await ask("What shading could fit my project?");
		assert.equal(requests.length, before + 4);
	} finally {
		process.env.GEMINI_MODEL = originalModel;
	}
});

test("multiple citations must all match the pinned source before natural wording can be verified", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const first = "Venkovní žaluzie umožňují regulovat množství denního světla.";
	const second = "U kompatibilních výrobků je možné elektrické ovládání.";
	const reply =
		"Exterior blinds let you adjust the daylight, and compatible products can be operated electrically.";
	saveKnowledgeSections([
		{
			id: "venkovni-zaluzie",
			title: "Venkovní žaluzie",
			lang: "cs",
			text: `${first}\n${second}\nQ: Mají dálkové ovládání?`,
		},
	]);
	const ask = async (text, lang = "en") => {
		const { sid } = await api("start", { lang, page: "/" });
		return api("msg", { sid, text });
	};
	const before = requests.length;
	provider = () => {
		const request = requests.at(-1);
		if (!request.generationConfig.responseSchema.properties.faithful)
			return geminiResult(reply, false, "en", [first, second]);
		assert.deepEqual(JSON.parse(request.contents[0].parts[0].text), {
			evidence: [
				{ text: first, sourceLanguage: "cs" },
				{ text: second, sourceLanguage: "cs" },
			],
			reply,
			targetLanguage: "en",
		});
		return geminiResponse({ faithful: true });
	};
	assert.equal(
		(
			await ask("Can outdoor blinds regulate daylight and be operated electrically?")
		).messages
			.at(-1)
			.text.split("\n\n")[0],
		reply,
	);
	assert.equal(requests.length, before + 2);
	for (const lines of [
		[first, "A missing source."],
		[first, second, first, second],
		[first, "Q: Mají dálkové ovládání?"],
	]) {
		const attempts = requests.length;
		provider = () => geminiResult(reply, false, "en", lines);
		const denied = await ask(
			"Can outdoor blinds regulate daylight and be operated electrically?",
		);
		assert.match(denied.messages.at(-1).text, /^I don’t have a verified answer/);
		assert.equal(requests.length, attempts + 2);
		assert.ok(
			requests
				.slice(attempts)
				.every((request) => !request.generationConfig.responseSchema.properties.faithful),
		);
	}
	const sameLanguage = requests.length;
	provider = () => geminiResult(first, false, "cs", [first]);
	assert.equal(
		(await ask("Jak venkovní žaluzie regulují světlo?", "cs")).messages
			.at(-1)
			.text.split("\n\n")[0],
		first,
	);
	assert.equal(requests.length, sameLanguage + 1);
	provider = () =>
		requests.at(-1).generationConfig.responseSchema.properties.faithful
			? geminiResponse({ faithful: false })
			: geminiResult("Venkovní žaluzie pomáhají s řízením denního světla.", false, "cs", [
					first,
				]);
	assert.equal(
		(await ask("Jak venkovní žaluzie regulují světlo?", "cs")).messages
			.at(-1)
			.text.split("\n\n")[0],
		first,
	);
	assert.equal(requests.length, sameLanguage + 3);
});

test("standalone greetings and language requests introduce the assistant in each language without calling Gemini", async () => {
	const cases = [
		[
			"cs",
			"Dobrý den!",
			"Umíš česky?",
			/AI asistent Gorbach.*vybrat stínění/,
			/psát česky/,
		],
		[
			"en",
			"Hello!",
			"Do you understand english?",
			/AI assistant.*help you choose shading/,
			/help in English/,
		],
		[
			"de",
			"Hallo!",
			"Kannst du Deutsch?",
			/KI-Assistent von Gorbach.*Sonnenschutz/,
			/auf Deutsch helfen/,
		],
		[
			"ru",
			"Привет",
			"Ты понимаешь русский?",
			/Здравствуйте, я ИИ-ассистент Gorbach.*подобрать солнцезащиту/,
			/понимаю русский/,
		],
		[
			"uk",
			"Привіт!",
			"Ти розумієш українську?",
			/ШІ-асистент Gorbach.*підібрати сонцезахист/,
			/допомогти українською/,
		],
	];
	const calls = requests.length;
	for (const [lang, greeting, capability, introduction, confirmation] of cases) {
		const { sid } = await api("start", { lang: "cs", page: "/" });
		const greeted = await api("msg", { sid, text: greeting });
		assert.equal(greeted.lang, lang);
		assert.match(greeted.messages.at(-1).text, introduction);
		assert.equal(greeted.chips.length, 3);
		const confirmed = await api("msg", { sid, text: capability });
		assert.equal(confirmed.lang, lang);
		assert.match(confirmed.messages.at(-1).text, confirmation);
		assert.equal((await api("history?sid=" + sid)).lang, lang);
	}
	const { sid } = await api("start", { lang: "cs", page: "/" });
	const formal = await api("msg", { sid, text: "Вы говорите на русском языке?" });
	assert.equal(formal.lang, "ru");
	assert.match(formal.messages.at(-1).text, /понимаю русский/);
	assert.equal(requests.length, calls);
});
test("a greeting prefix preserves a substantive product question or deterministic localized quote", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const source = "Наружные жалюзи регулируют дневной свет.";
	addKnowledge(source, "ru");
	provider = () => geminiResult(source, false, "ru");
	const { sid } = await api("start", { lang: "cs", page: "/" });
	const calls = requests.length;
	const question = "Привет, как наружные жалюзи регулируют свет?";
	const grounded = await api("msg", { sid, text: question });
	assert.equal(grounded.lang, "ru");
	assert.equal(grounded.messages.at(-1).text.split("\n\n")[0], source);
	assert.equal(requests.length, calls + 1);
	assert.equal(JSON.parse(requests.at(-1).contents[0].parts[0].text).question, question);
	const quote = await api("start", { lang: "cs", page: "/" });
	const pick = await api("msg", { sid: quote.sid, text: "Привет, какая цена жалюзи?" });
	assert.equal(pick.lang, "ru");
	assert.match(pick.question, /Какой продукт вас интересует/);
	assert.equal((await api("history?sid=" + quote.sid)).lang, "ru");
	assert.equal(requests.length, calls + 1);
});
test("greetings and language requests cannot populate an existing specialist contact", async () => {
	const { sid } = await api("start", { lang: "cs", page: "/" });
	const msg = (text) => api("msg", { sid, text });
	const calls = requests.length;
	const redirect = await msg("Расскажите о кошках");
	assert.equal(redirect.lang, "ru");
	assert.match(redirect.messages.at(-1).text, /помочь выбрать солнцезащиту/);
	await msg("Что едят кошки?");
	const greet = await msg("Привет");
	assert.match(greet.messages[1].text, /^Здравствуйте/);
	assert.equal(greet.messages.at(-1).text, greet.question);
	const capability = await msg("Ты понимаешь русский?");
	assert.equal(capability.lang, "ru");
	assert.match(capability.messages[1].text, /понимаю русский/);
	assert.equal(capability.messages.at(-1).text, capability.question);
	const restored = await api("history?sid=" + sid);
	assert.equal(restored.lang, "ru");
	assert.deepEqual(restored.messages.slice(-3), capability.messages);
	assert.deepEqual((await api("submit", { sid }, 400)).missing, ["name", "contact"]);
	await msg("Мария Новак");
	const phonePrompt = await msg("Hello");
	assert.equal(phonePrompt.input, "phone");
	assert.equal(phonePrompt.lang, "en");
	assert.match(phonePrompt.question, /phone number or email/);
	assert.deepEqual((await api("submit", { sid }, 400)).missing, ["contact"]);
	await msg("maria@example.org");
	await api("submit", { sid });
	assert.equal((await api("history?sid=" + sid)).lang, "en");
	assert.equal(requests.length, calls);
});
test("Czech page handles an offline English capability question and persists language until a clear switch", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const czech = "Montujeme venkovní žaluzie.";
	const english = "We install exterior blinds.";
	addKnowledge(czech, "cs");
	const { sid } = await api("start", { lang: "cs", page: "/" });
	const msg = (text) => api("msg", { sid, text });
	const history = () => api("history?sid=" + sid);
	const preferred = () => sql.prepare("SELECT lang FROM dialogs WHERE id=?").get(sid).lang;
	provider = () => geminiResult("", true, "cs");
	await msg("Kdo vyhrál fotbalový zápas?");
	const calls = requests.length;
	delete process.env.GEMINI_API_KEY;
	try {
		const direct = await msg("Do you understand english?");
		assert.match(direct.messages[1].text, /^Yes, I can help in English\./);
		assert.deepEqual(
			direct.chips.map((chip) => chip.label),
			["How do I choose shading?", "How do I get a quote?", "Can I ask another question?"],
		);
		assert.deepEqual((await history()).chips, direct.chips);
		assert.equal(preferred(), "en");
		assert.equal(requests.length, calls);
	} finally {
		process.env.GEMINI_API_KEY = "test-only";
	}
	provider = () => geminiResult("", true, "de");
	const ambiguous = await msg("OK");
	assert.match(ambiguous.messages[1].text, /^I don’t have a verified answer/);
	assert.equal(ambiguous.chips.length, 3);
	assert.equal(preferred(), "en");
	provider = () =>
		requests.at(-1).generationConfig.responseSchema.properties.faithful
			? geminiResponse({ faithful: true })
			: geminiResult(english, false, "en", czech);
	const free = await api("start", { lang: "cs", page: "/" });
	const englishQuestion = await api("msg", {
		sid: free.sid,
		text: "Do you install exterior blinds?",
	});
	assert.equal(englishQuestion.messages[1].text.split("\n\n")[0], english);
	assert.match(englishQuestion.chips[0].label, /^How do I/);
	assert.deepEqual((await api("history?sid=" + free.sid)).chips, englishQuestion.chips);
	provider = () => geminiResult(czech, false, "cs", czech);
	const czechQuestion = await api("msg", {
		sid: free.sid,
		text: "Montujete venkovní žaluzie?",
	});
	assert.equal(czechQuestion.messages[1].text.split("\n\n")[0], czech);
	assert.match(czechQuestion.chips[0].label, /stínění/);
	assert.deepEqual((await api("history?sid=" + free.sid)).chips, czechQuestion.chips);
	const outbound = JSON.parse(requests.at(-1).contents[0].parts[0].text);
	assert.equal(outbound.previousEvidence, czech);
});
test("detected reply language survives handoff and a clear quote starts in the visitor language", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	addKnowledge("Montujeme venkovní žaluzie.", "cs");
	const { sid } = await api("start", { lang: "cs", page: "/" });
	provider = () => geminiResult("", true, "de");
	const first = await api("msg", { sid, text: "Sind Sonderanfertigungen machbar?" });
	assert.match(first.messages[1].text, /^Dazu finde ich/);
	const second = await api("msg", { sid, text: "Gibt es Sonderanfertigungen?" });
	assert.match(second.question, /Wie heißen Sie\?/);
	assert.equal((await api("history?sid=" + sid)).question, second.question);
	const contact = await api("msg", { sid, text: "Jana Dvořáková" });
	assert.match(contact.question, /Telefonnummer oder E-Mail-Adresse\?/);
	const review = await api("msg", { sid, text: "jana@example.org" });
	assert.match(review.question, /^Bitte prüfen/);
	assert.equal((await api("history?sid=" + sid)).question, review.question);
	const quote = await api("start", { lang: "cs", page: "/" });
	const calls = requests.length;
	const pick = await api("msg", { sid: quote.sid, text: "How much are exterior blinds?" });
	assert.equal(pick.question, "Which product are you interested in?");
	assert.equal((await api("history?sid=" + quote.sid)).question, pick.question);
	assert.equal(requests.length, calls);
});
test("malformed translations and translated claims with changed numbers or contact details never reach verification", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const czech = "Lamela je široká 80 mm.";
	addKnowledge(czech, "cs");
	for (const [reply, evidence] of [
		["The slat is 80 mm wide.", "Lamela je široká 70 mm."],
		["The slat is 90 mm wide.", czech],
		["The slat is 80 mm wide. Email service@example.com.", czech],
	]) {
		const { sid } = await api("start", { lang: "cs", page: "/" });
		const previous = requests.length;
		provider = () => geminiResult(reply, false, "en", evidence);
		const result = await api("msg", { sid, text: "How wide are your slats?" });
		assert.match(result.messages[1].text, /^I don’t have a verified answer/);
		assert.equal(requests.length, previous + 2);
		assert.ok(
			requests
				.slice(previous)
				.every((request) => request.generationConfig.responseSchema.properties.evidence),
		);
	}
});
test("status, start and reset introduce the AI agent and offer three starters in each language", async () => {
	for (const [lang, identity] of [
		["cs", /AI asistent/],
		["en", /AI assistant/],
		["de", /KI-Assistent/],
		["ru", /ИИ-ассистент/],
		["uk", /ШІ-асистент/],
	]) {
		const { start: status } = await api("status?lang=" + lang);
		assert.match(status.greeting, identity);
		assert.equal(status.chips.length, 3);
		const first = await api("start", { lang, page: "/" });
		assert.equal(first.lang, lang);
		assert.equal(first.messages[0].text, status.greeting);
		assert.deepEqual(first.chips, status.chips);
		const reset = await api("reset", { sid: first.sid });
		assert.notEqual(reset.sid, first.sid);
		const history = await api("history?sid=" + reset.sid);
		assert.equal(history.lang, lang);
		assert.deepEqual(history.messages, first.messages);
		assert.deepEqual(history.chips, status.chips);
	}
});
test("grounded consultation discovers requirements, carries verified context and resets unsupported streak", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const shade = "Exterior blinds regulate sunlight by tilting their slats.";
	const control = "Exterior blinds can use motorized controls.";
	addKnowledge(`${shade}\n${control}\nWhat colours are available?`);
	const { sid } = await api("start", { lang: "en", page: "/" });
	const msg = (text) => api("msg", { sid, text });
	provider = () => geminiResult("", true);
	assert.equal((await msg("What is the cost of a blindfold?")).chips.length, 3);
	provider = () => geminiResult(shade);
	const result = await msg("How much sunlight can exterior blinds block?");
	assert.equal(result.messages[1].text.split("\n\n")[0], shade);
	assert.match(
		result.messages[1].text,
		/priority reducing heat or adjusting the daylight/,
	);
	assert.deepEqual(
		result.chips.map((chip) => chip.id),
		["products", "quote", "question"],
	);
	provider = () => geminiResult(control);
	const followUp = await msg("Can they be motorized?");
	assert.equal(followUp.messages[1].text.split("\n\n")[0], control);
	assert.match(followUp.messages[1].text, /individually or control several together/);
	const outbound = JSON.parse(requests.at(-1).contents[0].parts[0].text);
	assert.equal(outbound.previousEvidence, shade);
	assert.equal(outbound.question, "Can they be motorized?");
	provider = () => geminiResult(shade);
	assert.equal(
		(await msg("How much do exterior blinds block?")).messages[1].text.split("\n\n")[0],
		shade,
	);
	provider = () => geminiResult("What colours are available?");
	const unsupported = await msg("Do these turn into boats?");
	assert.deepEqual(
		unsupported.chips.map((chip) => chip.id),
		["products", "quote", "specialist"],
	);
	const discovery = await api("msg", { sid, chip: "products" });
	assert.match(
		discovery.messages[1].text,
		/priority reducing heat or adjusting the daylight/,
	);
	assert.equal(discovery.chips.length, 3);
	const requestsBeforeQuote = requests.length;
	const askQuote = await msg("How much are exterior blinds?");
	assert.match(askQuote.question, /Which product/);
	assert.equal(requests.length, requestsBeforeQuote);
});
test("product context survives an animal redirect, rejects evidence for another product and isolates a topic switch", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	const blinds = "Exterior blinds let you adjust the daylight by tilting the slats.";
	const controls = "Motorized controls are available.";
	const awnings = "Awnings can shade a patio.";
	const awningFact = "Compatible with standard mounting brackets.";
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('knowledge',?,'tester','staff')",
		)
		.run(
			JSON.stringify([
				{
					id: "venkovni-zaluzie",
					title: "Outdoor blinds",
					lang: "en",
					text: `${blinds}\n${controls}`,
				},
				{ id: "markyzy", title: "Awnings", lang: "en", text: `${awnings}\n${awningFact}` },
			]),
		);
	const { sid } = await api("start", { lang: "en", page: "/" });
	const msg = (text) => api("msg", { sid, text });
	const outbound = () => JSON.parse(requests.at(-1).contents[0].parts[0].text);
	provider = () => geminiResult(blinds, false, "en");
	await msg(
		"My name is Jane Nováková. Can exterior blinds reduce daylight? jane@example.org",
	);
	const before = requests.length;
	const redirect = await msg("Tell me about cats");
	assert.match(redirect.messages.at(-1).text, /help you choose shading/);
	assert.equal(requests.length, before);
	assert.equal((await api("history?sid=" + sid)).lang, "en");
	provider = () => geminiResult(controls, false, "en");
	const follow = await msg("And motorized?");
	assert.match(follow.messages.at(-1).text, /individually or control several together/);
	assert.equal(outbound().previousProduct, "outdoor-blinds");
	assert.equal(outbound().previousEvidence, blinds);
	assert.doesNotMatch(JSON.stringify(outbound()), /Jane Nováková|jane@example\.org/);
	provider = () => geminiResult(awningFact, false, "en");
	const rejected = await msg("Will they fit standard brackets?");
	assert.match(rejected.messages.at(-1).text, /don’t have a verified answer/);
	assert.equal(outbound().previousProduct, "outdoor-blinds");
	provider = () => geminiResult(awnings, false, "en");
	const newTopic = await msg("Can awnings shade a patio that my cat uses?");
	assert.match(newTopic.messages.at(-1).text, /How wide is the part of your patio/);
	assert.equal(outbound().requestedProduct, "awnings");
	assert.equal(outbound().previousEvidence, undefined);
	provider = () => geminiResult(blinds, false, "en", blinds, "unrelated");
	const unrelated = await msg("What song should I write about exterior blinds?");
	assert.match(unrelated.messages.at(-1).text, /don’t have a verified answer/);
	provider = () => geminiResult(awningFact, false, "en");
	await msg("Could they use brackets?");
	assert.equal(outbound().previousProduct, "awnings");
	assert.equal(outbound().previousEvidence, awnings);
	provider = () => geminiResult(blinds, false, "en");
	await msg("Could exterior blinds be fitted in my home?");
	assert.equal(outbound().requestedProduct, "outdoor-blinds");
	assert.equal(outbound().previousEvidence, controls);
});
test("two unsupported questions open a restorable handoff and explicit submission creates one manager lead", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	addKnowledge("We install exterior blinds.");
	const { sid } = await api("start", { lang: "en", page: "/" });
	const msg = (body, status = 200) => api("msg", { sid, ...body }, status);
	const history = () => api("history?sid=" + sid);
	const question = "What is the price of Bitcoin?";
	provider = () => geminiResult("", true);
	const first = await msg({ text: "Who won the football match?" });
	assert.deepEqual(
		first.chips.map((chip) => chip.id),
		["products", "quote", "specialist"],
	);
	assert.deepEqual((await history()).chips, first.chips);
	provider = () => Response.json({}, { status: 503 });
	const failure = await msg({ text: "Do you install blinds?" });
	assert.match(failure.messages[1].text, /can’t look up a verified answer/);
	assert.equal(
		sql.prepare("SELECT unsupported_streak FROM dialogs WHERE id=?").get(sid)
			.unsupported_streak,
		1,
	);
	provider = () => geminiResult("", true);
	const automatic = await msg({ text: question });
	assert.match(automatic.question, /What is your name\?/);
	assert.equal((await history()).question, automatic.question);
	assert.deepEqual((await api("submit", { sid }, 400)).missing, ["name", "contact"]);
	const calls = requests.length;
	await msg({ text: "Can I ask about installation instead?" }, 400);
	assert.equal((await msg({ text: "Marie Černá" })).input, "phone");
	assert.equal((await history()).input, "phone");
	assert.equal((await msg({ text: "not-a-contact" }, 400)).error, "invalid_contact");
	assert.deepEqual((await api("submit", { sid }, 400)).missing, ["contact"]);
	const review = await msg({ text: "marie@example.org" });
	assert.deepEqual(review.review, {
		purpose: "handoff",
		products: [],
		name: "Marie Černá",
		email: "marie@example.org",
	});
	assert.deepEqual((await history()).review, review.review);
	assert.equal(requests.length, calls);
	assert.equal(
		sql.prepare("SELECT COUNT(*) AS n FROM leads WHERE dialog=?").get(sid).n,
		0,
	);
	const [lead, duplicate] = await Promise.all([
		api("submit", { sid }),
		api("submit", { sid }),
	]);
	assert.ok(lead.lead_id);
	assert.deepEqual(lead, duplicate);
	const submitted = await history();
	assert.equal(submitted.lead_id, lead.lead_id);
	assert.equal(submitted.review, null);
	assert.equal((await msg({ text: "Another question" }, 409)).error, "submitted");
	const stored = sql.prepare("SELECT * FROM leads WHERE dialog=?").get(sid);
	assert.equal(stored.kind, "question");
	assert.equal(stored.product, "");
	assert.match(stored.summary, /price of Bitcoin/);
	assert.equal(JSON.parse(stored.fields).question, question);
	const token = randomUUID();
	sql.prepare("INSERT INTO staff VALUES(?,?,?)").run("handoff-test", "unused", "unused");
	sql
		.prepare("INSERT INTO sessions VALUES(?,?,?)")
		.run(
			createHash("sha256").update(token).digest("hex"),
			"handoff-test",
			Date.now() + 60000,
		);
	const admin = await fetch(origin + "/admin?section=leads&kind=question", {
		headers: { cookie: "gz_admin=" + token },
	});
	assert.equal(admin.status, 200);
	const html = await admin.text();
	for (const expected of [
		lead.lead_id,
		question,
		"Who won the football match?",
		"marie@example.org",
	])
		assert.ok(html.includes(expected));
});
test("specialist choice can be declined and a stale model reply cannot replace the current screen", async () => {
	sql.exec("DELETE FROM gemini_attempts");
	addKnowledge("We install exterior blinds.");
	const { sid } = await api("start", { lang: "en", page: "/" });
	const msg = (body, status = 200) => api("msg", { sid, ...body }, status);
	provider = () => geminiResult("", true);
	await msg({ text: "Can these be painted an unlisted colour?" });
	const { promise: requested, resolve: markRequested } = Promise.withResolvers();
	const { promise: answer, resolve: giveAnswer } = Promise.withResolvers();
	provider = () => {
		markRequested();
		return answer;
	};
	const stale = msg({ text: "Do you install shutters on boats?" }, 409);
	await Promise.race([
		requested,
		stale.then(() => assert.fail("Expected in-flight model request")),
	]);
	try {
		assert.match((await msg({ chip: "specialist" })).question, /What is your name\?/);
		await msg({ text: "Mária" });
		const review = await msg({ text: "+420 123 456 789" });
		assert.equal(review.review.phone, "+420 123 456 789");
	} finally {
		giveAnswer(geminiResult("", true));
	}
	assert.equal((await stale).error, "conversation_changed");
	assert.equal((await api("history?sid=" + sid)).review.purpose, "handoff");
	const decline = await msg({ chip: "decline_handoff" });
	assert.match(decline.messages[1].text, /help you choose shading/);
	const history = await api("history?sid=" + sid);
	assert.deepEqual(history.chips, decline.chips);
	assert.equal(history.review, null);
	await api("submit", { sid }, 400);
	provider = () => geminiResult("", true);
	const again = await msg({ text: "What is the weather?" });
	assert.equal(again.chips.length, 3);
	assert.equal(
		JSON.parse(requests.at(-1).contents[0].parts[0].text).previousEvidence,
		undefined,
	);
});
test("unavailable service restores localized starter choices and accepts either in the same dialog", async () => {
	const fixture = readFileSync(
		new URL("./fixtures/quote-survey.json", import.meta.url),
		"utf8",
	);
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('survey',?,'tester','staff')",
		)
		.run(fixture);
	for (const [lang, action, expectedReply] of [
		["en", "question", "What would you like to know about Gorbach shading?"],
		["de", "quote", "Für welches Produkt interessieren Sie sich?"],
	]) {
		const { sid } = await api("start", { lang, page: "/" });
		const unavailable = await api("msg", { sid, chip: "service" });
		assert.equal(
			unavailable.question,
			lang === "en"
				? "Service intake is currently unavailable."
				: "Serviceanfragen können derzeit nicht aufgenommen werden.",
		);
		const alternatives = unavailable.chips;
		assert.deepEqual(
			alternatives.map((chip) => chip.id),
			["products", "quote", "question"],
		);
		const history = await api("history?sid=" + sid);
		assert.deepEqual(history.chips, alternatives);
		assert.equal(history.messages.at(-1).text, unavailable.question);
		const next = await api("msg", { sid, chip: action });
		assert.equal(
			next.messages[0].text,
			alternatives.find((chip) => chip.id === action).label,
		);
		assert.equal(next.messages.at(-1).text, expectedReply);
	}
});
test("service intake restores its pinned questionnaire and submits one categorized admin lead", async () => {
	const survey = JSON.parse(
		readFileSync(new URL("./fixtures/quote-survey.json", import.meta.url), "utf8"),
	);
	const save = () =>
		sql
			.prepare(
				"INSERT INTO revisions(kind,content,editor,provenance) VALUES('survey',?,'tester','staff')",
			)
			.run(JSON.stringify(survey));
	save();
	const prior = requests.length;
	const { sid } = await api("start", { lang: "en", page: "/" });
	const msg = (body, status = 200) => api("msg", { sid, ...body }, status);
	const history = () => api("history?sid=" + sid);
	survey.services = {
		cleaning: { title: { en: "Cleaning" }, fields: survey.products.sample.fields },
		service: { fields: [] },
	};
	save();
	const selection = await msg({ chip: "service" });
	assert.deepEqual(selection.chips, [{ id: "cleaning", label: "Cleaning" }]);
	assert.deepEqual((await history()).chips, selection.chips);
	await msg({ chip: "service" }, 400);
	survey.services = {};
	save();
	await msg({ chip: "cleaning" });
	const multi = await msg({ chip: "Nový" });
	assert.equal(multi.multi, true);
	const restored = await history();
	assert.equal(restored.question, multi.question);
	assert.deepEqual(restored.chips, multi.chips);
	await msg({ chips: ["B", "A"] });
	await msg({ chip: "skip" });
	await msg({ text: "Jana" });
	assert.equal((await api("submit", { sid }, 400)).error, "incomplete");
	const review = await msg({ text: "jana@example.com" });
	assert.equal(review.review.products[0].title, "Cleaning");
	assert.deepEqual(review.review.products[0].answers.options, ["B", "A"]);
	assert.deepEqual(review.chips, []);
	assert.deepEqual((await history()).review, review.review);
	const [lead, repeat] = await Promise.all([
		api("submit", { sid }),
		api("submit", { sid }),
	]);
	assert.ok(lead.lead_id);
	assert.deepEqual(lead, repeat);
	assert.equal((await history()).lead_id, lead.lead_id);
	const storedLead = () => sql.prepare("SELECT * FROM leads WHERE dialog=?").get(sid);
	const serviceLead = storedLead();
	assert.equal(serviceLead.kind, "cleaning");
	assert.equal(serviceLead.product, "");
	assert.equal(JSON.parse(serviceLead.fields).serviceKind, "cleaning");
	const dialogProduct = () =>
		sql.prepare("SELECT product FROM dialogs WHERE id=?").get(sid).product;
	assert.equal(dialogProduct(), "");

	const quoteSid = await start();
	const quote = (input) => api("msg", { sid: quoteSid, ...input });
	await quote({ chip: "quote" });
	await quote({ chip: "sample" });
	await quote({ chip: "Původní" });
	await quote({ chip: "skip" });
	await quote({ text: "Petr" });
	await quote({ text: "petr@example.com" });
	const quoteLead = await api("submit", { sid: quoteSid });

	// Recreate the duplicate classifications written by the previous release.
	sql.prepare("UPDATE leads SET product=kind WHERE dialog=?").run(sid);
	sql.prepare("UPDATE dialogs SET product='cleaning' WHERE id=?").run(sid);
	sql.exec("PRAGMA user_version=0");
	migrateServiceProducts(sql);
	assert.deepEqual(storedLead(), serviceLead);
	assert.equal(dialogProduct(), "");
	assert.deepEqual(await api("submit", { sid }), lead);
	const { randomUUID, createHash } = await import("node:crypto");
	const token = randomUUID();
	sql.prepare("INSERT INTO staff VALUES(?,?,?)").run("filter-test", "unused", "unused");
	sql
		.prepare("INSERT INTO sessions VALUES(?,?,?)")
		.run(
			createHash("sha256").update(token).digest("hex"),
			"filter-test",
			Date.now() + 60000,
		);
	const admin = async (query) => {
		const response = await fetch(origin + "/admin?" + query, {
			headers: { cookie: "gz_admin=" + token },
		});
		assert.equal(response.status, 200);
		return response.text();
	};
	const byKind = await admin("section=leads&kind=cleaning");
	assert.ok(byKind.includes(lead.lead_id));
	assert.ok(!byKind.includes(quoteLead.lead_id));
	const productOptions = byKind.match(/<select name="product"[^>]*>(.*?)<\/select>/s)?.[1];
	assert.ok(productOptions);
	assert.match(productOptions, /value="sample"/);
	assert.doesNotMatch(productOptions, /cleaning/);
	assert.equal(productOptions.match(/value=""/g)?.length, 1);
	const byProduct = await admin("section=leads&product=sample");
	assert.ok(byProduct.includes(quoteLead.lead_id));
	assert.ok(!byProduct.includes(lead.lead_id));
	assert.ok(!(await admin("section=leads&product=cleaning")).includes(lead.lead_id));
	const stats = await admin("section=stats");
	const products = stats.match(/<h3>Produkty<\/h3>(.*?)<\/section>/s)?.[1];
	assert.ok(products);
	assert.match(products, /sample/);
	assert.doesNotMatch(products, /cleaning/);
	assert.equal(requests.length, prior);
});

async function upload(sid, bytes, name = "drawing.pdf", headers = {}) {
	const body = new FormData();
	body.set("sid", sid);
	body.set("file", new Blob([bytes]), name);
	const response = await fetch(origin + "/api/file", { method: "POST", body, headers });
	return { status: response.status, data: await response.json() };
}
test("uploads are linked to the correct lead and only staff can download active attachments", async () => {
	const sid = await start(),
		other = await start(),
		name = "návrh.pdf",
		bytes = Buffer.from("%PDF-1.4\nprivate fixture\n%%EOF");
	const { status, data } = await upload(sid, bytes, name);
	assert.equal(status, 200);
	const { id } = data.file;
	assert.deepEqual(data, { file: { id, name, size: bytes.length } });
	const row = sql.prepare("SELECT * FROM files WHERE id=?").get(id);
	assert.equal(row.dialog, sid);
	assert.equal(row.mime, "application/pdf");
	assert.equal(row.sha256, createHash("sha256").update(bytes).digest("hex"));
	assert.equal(row.bytes, null);
	assert.match(row.storage_name, /^[0-9a-f]{32}$/);
	assert.deepEqual(
		readFileSync(path.join(directory, "attachments", row.storage_name)),
		bytes,
	);
	const url = origin + "/api/admin/files/" + id;
	assert.equal((await fetch(url + "?sid=" + other)).status, 401);
	const token = randomUUID();
	sql.prepare("INSERT INTO staff VALUES(?,?,?)").run("files-test", "unused", "unused");
	sql
		.prepare("INSERT INTO sessions VALUES(?,?,?)")
		.run(
			createHash("sha256").update(token).digest("hex"),
			"files-test",
			Date.now() + 60000,
		);
	const auth = { headers: { cookie: "gz_admin=" + token } };
	const download = await fetch(url, auth);
	assert.equal(download.status, 200);
	assert.match(download.headers.get("content-disposition"), /^attachment;/);
	assert.equal(download.headers.get("content-type"), "application/octet-stream");
	assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
	const lead = sql.prepare(
		"INSERT INTO leads(id,dialog,kind,product,created,contact,summary) VALUES(?,?,'quote',?,'now','','')",
	);
	lead.run("upload-owner", sid, "upload-one");
	lead.run("upload-other", other, "upload-two");
	const card = async (product) =>
		(await fetch(origin + "/admin?section=leads&product=" + product, auth)).text();
	assert.ok((await card("upload-one")).includes("/api/admin/files/" + id));
	assert.ok(!(await card("upload-two")).includes("/api/admin/files/" + id));
	sql
		.prepare(
			"INSERT INTO files(id,dialog,name,bytes,size,created) VALUES('legacy-file',?,'old.pdf',?,?,?)",
		)
		.run(sid, bytes, bytes.length, Date.now());
	const legacy = await fetch(origin + "/api/admin/files/legacy-file", auth);
	assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), bytes);
	sql.prepare("UPDATE files SET created=0 WHERE id=?").run(id);
	assert.equal((await fetch(url, auth)).status, 404);
	assert.ok(!(await card("upload-one")).includes("/api/admin/files/" + id));
});
test("uploads recognize supported media from the supplied bytes", async () => {
	const ftyp = (brand) =>
		Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftyp" + brand + "0000")]);
	for (const [ext, bytes, mime] of [
		["jpg", Buffer.from("ffd8ffe0", "hex"), "image/jpeg"],
		["png", Buffer.from("89504e470d0a1a0a", "hex"), "image/png"],
		["webp", Buffer.from("RIFF0000WEBPVP8L"), "image/webp"],
		["heic", ftyp("heic"), "image/heic"],
		["mp4", ftyp("isom"), "video/mp4"],
		["mov", ftyp("qt  "), "video/quicktime"],
	]) {
		const uploaded = await upload(await start(), bytes, "fixture." + ext);
		assert.equal(uploaded.status, 200);
		assert.equal(
			sql.prepare("SELECT mime FROM files WHERE id=?").get(uploaded.data.file.id).mime,
			mime,
		);
	}
});
test("rejected uploads and a failed metadata insert leave no attachment or stray file", async () => {
	const sid = await start();
	const snapshot = () => ({
		n: sql.prepare("SELECT count(*) n FROM files").get().n,
		files: readdirSync(path.join(directory, "attachments")).sort(),
	});
	const before = snapshot();
	for (const [session, bytes, name, headers, error, status] of [
		[sid, "ordinary text", "fake.jpg", {}, "type", 400],
		[sid, "%PDF-1.7", "wrong.png", {}, "type", 400],
		["bad", "%PDF-1.7", "file.pdf", {}, "invalid_sid", 400],
		["0".repeat(48), "%PDF-1.7", "file.pdf", {}, "unknown_session", 404],
		[sid, "%PDF-1.7", "file.pdf", { origin: "https://unapproved.invalid" }, "origin", 403],
		[sid, Buffer.alloc(fileLimits.size + 1), "file.pdf", {}, "size", 413],
	]) {
		assert.deepEqual(await upload(session, bytes, name, headers), {
			status,
			data: { ok: false, error },
		});
	}
	sql.exec(
		"CREATE TRIGGER reject_test_file BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT,'fixture'); END",
	);
	try {
		assert.deepEqual(await upload(sid, "%PDF-1.7"), {
			status: 500,
			data: { ok: false, error: "internal" },
		});
	} finally {
		sql.exec("DROP TRIGGER reject_test_file");
	}
	assert.deepEqual(snapshot(), before);
});
test("simultaneous uploads enforce count and total boundaries per dialog", async () => {
	const sid = await start();
	const small = "%PDF-1.7";
	const count = await Promise.all(
		Array.from({ length: fileLimits.count + 2 }, () => upload(sid, small)),
	);
	assert.equal(count.filter((r) => r.status === 200).length, fileLimits.count);
	assert.deepEqual(
		count.filter((r) => r.status !== 200).map((r) => r.data.error),
		["count", "count"],
	);
	const other = await start();
	const max = Buffer.alloc(fileLimits.size);
	max.write(small);
	const total = await Promise.all(Array.from({ length: 4 }, () => upload(other, max)));
	assert.equal(total.filter((r) => r.status === 200).length, 3);
	assert.deepEqual(
		total.filter((r) => r.status !== 200).map((r) => r.data.error),
		["total"],
	);
	assert.equal(
		sql.prepare("SELECT sum(size) n FROM files WHERE dialog=?").get(other).n,
		fileLimits.total,
	);
});

test("survey attachments advance, restore, and enforce ownership and expiry", async () => {
	const survey = {
		products: {
			photo: {
				fields: [
					{ id: "photo", q: "Photo", type: "file", priority: "required" },
					{ id: "detail", q: "Detail", type: "text+file", priority: "required" },
				],
			},
		},
		services: {},
	};
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('survey',?,'tester','staff')",
		)
		.run(JSON.stringify(survey));
	const sid = await start(),
		other = await start();
	await upload(sid, "%PDF-1.7");
	const foreign = (await upload(other, "%PDF-1.7")).data.file.id;
	const msg = (body, status = 200) => api("msg", { sid, ...body }, status);
	await msg({ chip: "quote" });
	await msg({ chip: "photo" });
	await msg({ files: [foreign] }, 400);
	const pending = (await upload(sid, "%PDF-1.7")).data.file;
	const history = await api("history?sid=" + sid);
	assert.deepEqual(history.pendingAttachments, [pending]);
	const next = await msg({ files: [history.pendingAttachments[0].id] });
	assert.deepEqual((await api("history?sid=" + sid)).pendingAttachments, []);
	assert.equal(next.attachmentField.id, "detail");
	assert.deepEqual(
		(await api("history?sid=" + sid)).attachmentAnswers,
		next.attachmentAnswers,
	);
	await msg({ text: "description" }, 400);
	await msg({ text: "description", files: [pending.id] });
	await msg({ text: "Jana" });
	await msg({ text: "jana@example.com" });
	sql.prepare("UPDATE files SET created=0 WHERE id=?").run(pending.id);
	assert.equal((await api("submit", { sid }, 400)).error, "incomplete");
	const version = sql
		.prepare("SELECT version FROM quote_sessions WHERE dialog=?")
		.get(sid).version;
	const recovery = await api("history?sid=" + sid);
	assert.equal(recovery.review, null);
	assert.equal(recovery.attachmentRecovery.field, "photo");
	const replacement = (await upload(sid, "%PDF-1.7")).data.file.id;
	await msg({ files: [replacement] });
	assert.equal((await api("history?sid=" + sid)).attachmentRecovery.field, "detail");
	const review = await msg({ text: "description", files: [replacement] });
	assert.ok(review.review);
	assert.equal(review.review.name, "Jana");
	assert.equal(
		sql.prepare("SELECT version FROM quote_sessions WHERE dialog=?").get(sid).version,
		version,
	);
	const lead = await api("submit", { sid });
	sql.prepare("UPDATE files SET created=0 WHERE id=?").run(replacement);
	assert.deepEqual(await api("submit", { sid }), lead);
	assert.equal((await api("history?sid=" + sid)).lead_id, lead.lead_id);
});

function seedSurvey() {
	return validateRevision(
		"survey",
		readFileSync(new URL("../data/initial/survey.json", import.meta.url), "utf8"),
	);
}

function saveSurvey(revision) {
	return Number(
		sql
			.prepare(
				"INSERT INTO revisions(kind,content,editor,provenance) VALUES('survey',?,'tester','staff')",
			)
			.run(JSON.stringify(revision)).lastInsertRowid,
	);
}

test("legacy Czech quote and service revisions render stock copy across five conversation languages", async () => {
	const shipped = seedSurvey();
	const legacy = structuredClone(shipped);
	for (const product of Object.values(legacy.products)) {
		product.title = { cs: product.title.cs };
		for (const field of product.fields) delete field.translations;
	}
	for (const service of Object.values(legacy.services)) {
		service.fields = [
			{ id: "detail", q: "Poznámka k požadavku?", type: "text", priority: "required" },
		];
	}
	const version = saveSurvey(legacy);
	const originalChoice = "9 a více";
	const originalTitle = "Venkovní žaluzie";
	const originalQuestion = "Kolik oken chcete zastínit?";
	const id = "venkovni-zaluzie";
	const cases = [
		[
			"cs",
			"Česky prosím",
			originalTitle,
			originalQuestion,
			originalChoice,
			"Čištění",
			"neví",
		],
		[
			"en",
			"English please",
			"Exterior blinds",
			"How many windows would you like to shade?",
			"9 or more",
			"Cleaning",
			"Not specified",
		],
		[
			"de",
			"Deutsch bitte",
			"Außenjalousien",
			"Wie viele Fenster möchten Sie beschatten?",
			"9 oder mehr",
			"Reinigung",
			"Nicht angegeben",
		],
		[
			"ru",
			"На русском пожалуйста",
			"Наружные жалюзи",
			"Сколько окон вы хотите затенить?",
			"9 и более",
			"Чистка",
			"Не указано",
		],
		[
			"uk",
			"Українською, будь ласка",
			"Зовнішні жалюзі",
			"Скільки вікон потрібно затінити?",
			"9 і більше",
			"Чищення",
			"Не вказано",
		],
	];
	const calls = requests.length;
	for (const [lang, preference, title, question, option, cleaning, skipped] of cases) {
		const { sid } = await api("start", { lang: "cs", page: "/" });
		const msg = (body) => api("msg", { sid, ...body });
		const history = () => api("history?sid=" + sid);
		await msg({ text: preference });
		const pick = await msg({ chip: "quote" });
		assert.equal(pick.lang, lang);
		assert.deepEqual(pick.chips, [{ id, label: title }]);
		assert.equal(shipped.products[id].title[lang], title);
		const stalePick = [{ id, label: originalTitle }];
		sql
			.prepare(
				"UPDATE messages SET chips=? WHERE id=(SELECT MAX(id) FROM messages WHERE dialog=?)",
			)
			.run(JSON.stringify(stalePick), sid);
		assert.deepEqual((await history()).chips, pick.chips);
		const count = await msg({ chip: id });
		assert.equal(count.messages[0].text, title);
		assert.equal(count.question, question);
		assert.equal(
			shipped.products[id].fields[0].translations?.[lang]?.q ?? originalQuestion,
			question,
		);
		assert.deepEqual(
			count.chips.find((c) => c.id === originalChoice),
			{ id: originalChoice, label: option },
		);
		const staleChips = count.chips.map((c) =>
			c.id === originalChoice ? { ...c, label: originalChoice } : c,
		);
		const saved = sql
			.prepare("SELECT version,state,screen FROM quote_sessions WHERE dialog=?")
			.get(sid);
		assert.equal(saved.version, version);
		const staleScreen = JSON.stringify({
			...JSON.parse(saved.screen),
			question: originalQuestion,
			chips: staleChips,
		});
		sql.prepare("UPDATE quote_sessions SET screen=? WHERE dialog=?").run(staleScreen, sid);
		const lastMessage = sql
			.prepare("SELECT MAX(id) AS id FROM messages WHERE dialog=?")
			.get(sid).id;
		sql
			.prepare("UPDATE messages SET body=?,chips=? WHERE id=?")
			.run(originalQuestion, JSON.stringify(staleChips), lastMessage);
		const restored = await history();
		assert.equal(restored.question, question);
		assert.equal(restored.messages.at(-1).text, question);
		assert.deepEqual(restored.chips, count.chips);
		assert.equal(
			sql.prepare("SELECT body FROM messages WHERE id=?").get(lastMessage).body,
			originalQuestion,
		);
		assert.equal(
			sql.prepare("SELECT screen FROM quote_sessions WHERE dialog=?").get(sid).screen,
			staleScreen,
		);
		assert.equal((await msg({ chip: originalChoice })).messages[0].text, option);
		await msg({ text: "Jana" });
		const review = await msg({ text: "jana@example.org" });
		assert.deepEqual(review.review.products[0], {
			product: id,
			answers: { count: originalChoice },
			title,
			questionLabels: { count: question },
			answerLabels: { count: option },
		});
		assert.deepEqual((await history()).review, review.review);
		await api("submit", { sid });
		const lead = sql
			.prepare("SELECT kind,product,fields FROM leads WHERE dialog=?")
			.get(sid);
		assert.equal(lead.kind, "quote");
		assert.equal(lead.product, id);
		assert.deepEqual(JSON.parse(lead.fields).products, [
			{ product: id, answers: { count: originalChoice } },
		]);

		const service = await api("start", { lang: "cs", page: "/" });
		const askService = (body) => api("msg", { sid: service.sid, ...body });
		await askService({ text: preference });
		const services = await askService({ chip: "service" });
		assert.equal(services.chips.length, 6);
		assert.deepEqual(services.chips[0], { id: "cleaning", label: cleaning });
		assert.deepEqual((await api("history?sid=" + service.sid)).chips, services.chips);
		assert.equal(
			(await askService({ chip: "cleaning" })).question,
			"Poznámka k požadavku?",
		);
		await askService({ chip: "skip" });
		await askService({ text: "Jana" });
		const serviceReview = await askService({ text: "jana@example.org" });
		assert.equal(serviceReview.review.products[0].title, cleaning);
		assert.equal(serviceReview.review.products[0].answerLabels.detail, skipped);
		assert.equal(serviceReview.review.products[0].answers.detail, "neví");
		await api("submit", { sid: service.sid });
		const serviceLead = sql
			.prepare("SELECT kind,product,fields,summary FROM leads WHERE dialog=?")
			.get(service.sid);
		assert.equal(serviceLead.kind, "cleaning");
		assert.equal(serviceLead.product, "");
		assert.match(serviceLead.summary, /^Servisní požadavek: cleaning/);
		assert.deepEqual(JSON.parse(serviceLead.fields).products, [
			{ product: "cleaning", answers: { detail: "neví" } },
		]);
	}
	assert.equal(requests.length, calls);
});

test("staff survey overrides and translated attachment recovery preserve raw answers and transcript", async () => {
	const id = "venkovni-zaluzie";
	const survey = seedSurvey();
	const product = survey.products[id];
	product.title = { cs: "Zakázkové žaluzie", en: "Made-to-order blinds" };
	const count = product.fields[0];
	count.q = "Vlastní otázka na okna?";
	count.translations = {
		en: {
			q: "Staff window-count question",
			chips: { "9 a více": "Staff nine-plus option" },
		},
	};
	product.fields.push(
		{
			id: "photo",
			q: "Nahrajte fotografii",
			type: "file",
			priority: "required",
			translations: { en: { q: "Upload a photo of your window" } },
		},
		{ id: "literal", q: "Vlastní text?", type: "text", priority: "required" },
		{ id: "notes1", q: "Poznámka 1?", type: "text", priority: "optional" },
		{ id: "notes2", q: "Poznámka 2?", type: "text", priority: "optional" },
	);
	saveSurvey(survey);
	const { sid } = await api("start", { lang: "cs", page: "/" });
	const msg = (body) => api("msg", { sid, ...body });
	await msg({ text: "English please" });
	assert.deepEqual((await msg({ chip: "quote" })).chips, [
		{ id, label: "Made-to-order blinds" },
	]);
	const windowCount = await msg({ chip: id });
	assert.equal(windowCount.question, "Staff window-count question");
	assert.deepEqual(
		windowCount.chips.find((c) => c.id === "9 a více"),
		{ id: "9 a více", label: "Staff nine-plus option" },
	);
	const photo = await msg({ chip: "9 a více" });
	assert.equal(photo.question, "Upload a photo of your window");
	const first = (await upload(sid, "%PDF-1.7")).data.file;
	assert.deepEqual((await api("history?sid=" + sid)).pendingAttachments, [first]);
	await msg({ files: [first.id] });
	await msg({ text: "neví" });
	await msg({ text: "My windows are on the first floor." });
	await msg({ text: "Jana" });
	const review = await msg({ text: "jana@example.org" });
	const item = review.review.products[0];
	assert.equal(item.answerLabels.literal, "neví");
	assert.equal(item.answerLabels.photo, "Attachment added");
	assert.equal(item.answerLabels.notes1, "See note");
	assert.equal(item.answers.notes1, "viz poznámka");
	assert.equal(item.notes, "My windows are on the first floor.");
	sql.prepare("UPDATE files SET created=0 WHERE id=?").run(first.id);
	const history = await api("history?sid=" + sid);
	assert.equal(history.question, "Upload a photo of your window");
	assert.deepEqual(history.attachmentRecovery, { product: id, field: "photo" });
	assert.equal(history.messages.at(-1).text, review.question);
	const replacement = (await upload(sid, "%PDF-1.7")).data.file;
	assert.deepEqual((await api("history?sid=" + sid)).pendingAttachments, [replacement]);
	assert.equal(
		(await msg({ files: [replacement.id] })).review.products[0].answerLabels.photo,
		"Attachment added",
	);
	await api("submit", { sid });
	const stored = JSON.parse(
		sql.prepare("SELECT fields FROM leads WHERE dialog=?").get(sid).fields,
	).products[0];
	assert.deepEqual(stored.answers, {
		count: "9 a více",
		photo: "attachment",
		literal: "neví",
		notes1: "viz poznámka",
		notes2: "viz poznámka",
	});
	assert.deepEqual(stored.attachments, { photo: [replacement.id] });
	assert.equal(Object.hasOwn(stored, "answerMarkers"), false);

	const custom = await api("start", { lang: "de", page: "/" });
	const askCustom = (body) => api("msg", { sid: custom.sid, ...body });
	assert.deepEqual((await askCustom({ chip: "quote" })).chips, [
		{ id, label: "Zakázkové žaluzie" },
	]);
	const fallback = await askCustom({ chip: id });
	assert.equal(fallback.question, "Vlastní otázka na okna?");
	assert.deepEqual(
		fallback.chips.find((c) => c.id === "9 a více"),
		{ id: "9 a více", label: "9 a více" },
	);
});
