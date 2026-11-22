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
	assert.equal(response.status, status, JSON.stringify(data));
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
	for (const text of ["Dobrý den!", "Kolik stojících lidí?", "necena"]) {
		const sid = await start();
		const result = await api("msg", { sid, text });
		assert.deepEqual(result.chips, [], text);
		assert.equal(
			result.messages.at(-1).text,
			"Tuto informaci nemám ověřenou. Upřesní ji náš specialista.",
		);
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
		"Please enter your question.",
	);
	assert.equal(requests.length, initial);
	const result = (payload) =>
		Response.json({
			candidates: [
				{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } },
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
	assert.equal(reply.messages[1].text, old);
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
	const fallback =
		"I don’t have verified information on that. Our specialist can clarify.";
	for (const callback of [
		() => result({ unknown: true, reply: "", evidence: "" }),
		() =>
			result({ unknown: false, reply: "The showroom opens at midnight.", evidence: old }),
		() => result({ unknown: false, reply: "Unsupported", evidence: "absent" }),
		() => result({ unknown: "no", reply: 17 }),
		() => Response.json({}, { status: 429 }),
		() => {
			throw new DOMException("timeout", "TimeoutError");
		},
	]) {
		provider = callback;
		assert.equal((await msg({ text: "Another question?" })).messages[1].text, fallback);
	}
	const n = requests.length;
	delete process.env.GEMINI_API_KEY;
	try {
		assert.equal(
			(await msg({ text: "Missing configuration?" })).messages[1].text,
			fallback,
		);
		assert.equal(requests.length, n);
	} finally {
		process.env.GEMINI_API_KEY = "test-only";
	}
	assert.equal((await api("history?sid=" + sid)).messages.at(-1).text, fallback);
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
					content: { parts: [{ text: JSON.stringify({ unknown: true }) }] },
				},
			],
		});
	async function burst(session, ip, expected, limit) {
		sql.exec("DELETE FROM gemini_attempts");
		const prior = requests.length;
		const responses = await Promise.all(
			sids.map((_, i) =>
				api("msg", { sid: session(i), text: "When do you open?" }, 200, {
					"x-real-ip": ip(i),
				}),
			),
		);
		assert.equal(requests.length - prior, expected);
		assert.equal(
			responses.filter((r) => r.messages[1].text === limit).length,
			13 - expected,
		);
	}
	try {
		await burst(
			() => sids[0],
			(i) => "192.0.2." + (i + 1),
			12,
			"Zkuste to prosím později.",
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
test("knowledge answers must match the dialog language and a pinned source line", async () => {
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
		).messages[1].text;
	};
	let line = czech;
	provider = () =>
		Response.json({
			candidates: [
				{
					finishReason: "STOP",
					content: {
						parts: [{ text: JSON.stringify({ unknown: false, reply: line, evidence: line }) }],
					},
				},
			],
		});
	const fallback =
		"I don’t have verified information on that. Our specialist can clarify.";
	save();
	const before = requests.length;
	assert.equal(await ask("en"), fallback);
	assert.equal(requests.length, before);
	assert.equal(await ask("cs"), czech);
	sections.push({
		id: "installation",
		lang: "en-US",
		title: "Installation",
		text: english,
	});
	save();
	const mixed = requests.length;
	assert.equal(await ask("en"), fallback);
	assert.ok(requests.length > mixed);
	assert.ok(!JSON.stringify(requests.at(-1)).includes(czech));
	line = english;
	assert.equal(await ask("en"), english);
	assert.ok(!JSON.stringify(requests.at(-1)).includes("Malformed source."));
	sections.at(-1).lang = "EN";
	save();
	assert.equal(await ask("en"), english);
	for (const invalid of ["en_US", "en-", "fr-CA"]) {
		sections.at(-1).lang = invalid;
		save();
		assert.equal(await ask("en"), fallback);
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
		["en", "question", "Please enter your question."],
		["de", "quote", "Für welches Produkt interessieren Sie sich?"],
	]) {
		const { sid, chips } = await api("start", { lang, page: "/" });
		const alternatives = chips.filter((chip) => chip.id !== "service");
		assert.deepEqual(
			alternatives.map((chip) => chip.id),
			["quote", "question"],
		);
		const unavailable = await api("msg", { sid, chip: "service" });
		assert.equal(
			unavailable.question,
			lang === "en"
				? "Service intake is currently unavailable."
				: "Serviceanfragen können derzeit nicht aufgenommen werden.",
		);
		assert.deepEqual(unavailable.chips, alternatives);
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
	const own = (await upload(sid, "%PDF-1.7")).data.file.id;
	const foreign = (await upload(other, "%PDF-1.7")).data.file.id;
	const msg = (body, status = 200) => api("msg", { sid, ...body }, status);
	await msg({ chip: "quote" });
	await msg({ chip: "photo" });
	await msg({ files: [foreign] }, 400);
	const next = await msg({ files: [own] });
	assert.equal(next.attachmentField.id, "detail");
	assert.deepEqual(
		(await api("history?sid=" + sid)).attachmentAnswers,
		next.attachmentAnswers,
	);
	await msg({ text: "description" }, 400);
	await msg({ text: "description", files: [own] });
	await msg({ text: "Jana" });
	await msg({ text: "jana@example.com" });
	sql.prepare("UPDATE files SET created=0 WHERE id=?").run(own);
	assert.equal((await api("submit", { sid }, 400)).error, "incomplete");
});
