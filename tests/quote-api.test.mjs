import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import next from "next";

let app, server, sql, origin, directory;
before(async () => {
	directory = mkdtempSync(path.join(tmpdir(), "gorbach-quote-"));
	process.env.GORBACH_DATA_DIR = directory;
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
		assert.equal(result.messages.at(-1).text, "Děkujeme za zprávu.");
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
	});
	assert.deepEqual((await api("history?sid=" + sid)).review, review);
});
