import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import next from "next";

const requests = [];
let provider = () => Response.json({}, { status: 503 });
const originalFetch = globalThis.fetch;
function addKnowledge(text) {
	sql
		.prepare(
			"INSERT INTO revisions(kind,content,editor,provenance) VALUES('knowledge',?,'tester','staff')",
		)
		.run(JSON.stringify([{ id: "section", title: "Information", text }]));
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
async function api(route, body, status = 200) {
	const response = await fetch(
		origin + "/api/" + route,
		body
			? {
					method: "POST",
					headers: { "Content-Type": "application/json" },
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
