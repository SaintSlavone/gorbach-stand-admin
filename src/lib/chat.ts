import { readUpload, storeUpload } from "./file-upload";
import { writeTransaction, expiryCutoff } from "./attachments";
import { clientBucket, reserveGeminiAttempt } from "./gemini-quota";
import { knowledgeAnswer, questionPrompt } from "./knowledge-answer";
import { ApiError, questionnaireTurn, labelReview, submitLead, readInput } from "./quote";
import { randomBytes } from "node:crypto";
import { db } from "./admin";

import { copy, language, startCopy } from "./chat-copy";

function validateSid(sid: unknown): asserts sid is string {
	if (typeof sid !== "string" || !/^[a-f0-9]{48}$/.test(sid))
		throw new ApiError(400, "invalid_sid");
}
function start(lang: keyof typeof copy, page: string, utm: string) {
	const sid = randomBytes(24).toString("hex");
	const { greeting, chips } = startCopy(lang);
	db()
		.prepare(
			"INSERT INTO dialogs(id,lang,page,created,utm,knowledge_version) VALUES(?,?,?,?,?,(SELECT MAX(id) FROM revisions WHERE kind='knowledge'))",
		)
		.run(sid, lang, page, new Date().toISOString(), utm);
	db()
		.prepare("INSERT INTO messages(dialog,role,body,chips) VALUES(?,'bot',?,?)")
		.run(sid, greeting, JSON.stringify(chips));
	return { sid, messages: [{ role: "bot", text: greeting }], chips };
}
const generalScreen = {
	chips: [],
	multi: false,
	progress: null,
	input: "text",
	review: null,
	pending: false,
};
function saveExchange(
	sid: string,
	visitor: string,
	reply: string,
	chips: { id: string; label: string }[],
	unknown = false,
) {
	const messages = [
		{ role: "visitor", text: visitor },
		{ role: "bot", text: reply },
	];
	const insert = db().prepare(
		"INSERT INTO messages(dialog,role,body,chips,unknown) VALUES(?,?,?,?,?)",
	);
	for (const m of messages)
		insert.run(
			sid,
			m.role,
			m.text,
			JSON.stringify(m.role === "bot" ? chips : []),
			Number(m.role === "bot" && unknown),
		);
	return messages;
}
type Endpoint = "status" | "start" | "msg" | "history" | "reset" | "submit" | "file";
async function dispatch(req: Request, route: Endpoint) {
	const url = new URL(req.url);
	if (route === "status")
		return {
			enabled: true,
			public: process.env.GORBACH_CHAT_PUBLIC === "true",
			start: startCopy(language(url.searchParams.get("lang"))),
		};
	if (route === "file") {
		const { sid, name, bytes } = await readUpload(req);
		validateSid(sid);
		return storeUpload(sid, name, bytes);
	}
	let body: Record<string, unknown> = {};
	if (req.method === "POST") {
		try {
			body = await req.json();
		} catch {
			throw new ApiError(400, "invalid_json");
		}
		if (!body || typeof body !== "object" || Array.isArray(body))
			throw new ApiError(400, "invalid_body");
	}
	if (route === "start") {
		const { lang, page, utm = {} } = body;
		if (
			typeof lang !== "string" ||
			typeof page !== "string" ||
			!page.trim() ||
			page.length > 4096 ||
			!utm ||
			typeof utm !== "object" ||
			Array.isArray(utm) ||
			!Object.values(utm).every((v) => typeof v === "string") ||
			JSON.stringify(utm).length > 8192
		)
			throw new ApiError(400, "invalid_start");
		return writeTransaction(db(), () => start(language(lang), page, JSON.stringify(utm)));
	}
	const sid = route === "history" ? url.searchParams.get("sid") : body.sid;
	validateSid(sid);
	if (route === "history") {
		const rows = db()
			.prepare(
				"SELECT m.role,m.body AS text,m.chips,q.screen,q.version,d.lang,l.id AS lead_id FROM dialogs d LEFT JOIN leads l ON l.dialog=d.id LEFT JOIN quote_sessions q ON q.dialog=d.id LEFT JOIN messages m ON m.dialog=d.id WHERE d.id=? ORDER BY m.id",
			)
			.all(sid);
		if (!rows.length) throw new ApiError(404, "unknown_session");
		const messages = rows
			.filter((row) => row.role !== null)
			.map(({ role, text }) => ({ role, text }));
		if (rows[0].lead_id)
			return {
				messages,
				lead_id: rows[0].lead_id,
				chips: [],
				review: null,
				progress: null,
				multi: false,
				pending: false,
			};
		const screen = JSON.parse(String(rows[0].screen ?? "{}"));
		if (screen.review) {
			const pinned = db()
				.prepare("SELECT content FROM revisions WHERE id=?")
				.get(rows[0].version)!;
			screen.review = labelReview(
				screen.review,
				JSON.parse(String(pinned.content))[
					screen.review.serviceKind ? "services" : "products"
				],
				String(rows[0].lang),
			);
		}
		return {
			messages,
			chips: JSON.parse(String(rows.at(-1)?.chips ?? "[]")),
			...screen,
		};
	}
	const turn = writeTransaction(db(), () => {
		const dialog = db()
			.prepare("SELECT lang,page,utm,knowledge_version FROM dialogs WHERE id=?")
			.get(sid);
		if (!dialog) throw new ApiError(404, "unknown_session");
		const lang = language(dialog.lang);
		if (route === "reset")
			return { sid: start(lang, String(dialog.page), String(dialog.utm)).sid };
		if (route === "submit") return submitLead(sid);
		const input = readInput(body);
		const value = input.values.join(", ");
		const quoteRequested =
			input.kind !== "chips" &&
			(["quote", copy[lang][2].toLowerCase()].includes(value.toLowerCase()) ||
				(input.kind === "text" &&
					/(?:(?<![\p{L}\p{M}\p{N}_])(?:price|cost|quote|preis|cena|cenu|kolik stojí)(?![\p{L}\p{M}\p{N}_])|сколько стоит|ціна|вартість)/iu.test(
						value,
					)));
		const requested = quoteRequested
			? "quote"
			: input.kind === "chip" && value === "service"
				? "service"
				: null;
		const survey = questionnaireTurn(sid, input, requested, lang);
		if (
			!survey &&
			input.kind !== "text" &&
			!(input.kind === "chip" && ["service", "question"].includes(value))
		)
			throw new ApiError(400, "invalid_chip");
		if (!survey && input.kind === "text") {
			const revision = db()
				.prepare("SELECT content FROM revisions WHERE id=? AND kind='knowledge'")
				.get(dialog.knowledge_version);
			return {
				general: {
					text: value,
					lang,
					attachmentCount: Number(
						db()
							.prepare("SELECT count(*) AS n FROM files WHERE dialog=? AND created>?")
							.get(sid, expiryCutoff())!.n,
					),
					content: revision ? String(revision.content) : null,
				},
			};
		}
		const screen = survey ?? generalScreen;
		let visitorText = value;
		if (input.kind !== "text") {
			const last = db()
				.prepare(
					"SELECT chips FROM messages WHERE dialog=? AND role='bot' ORDER BY id DESC LIMIT 1",
				)
				.get(sid);
			const choices: { id: string; label: string }[] = JSON.parse(
				String(last?.chips ?? "[]"),
			);
			visitorText = input.values
				.map((id) => choices.find((c) => c.id === id)?.label ?? id)
				.join(", ");
		}
		const reply =
			survey?.question ??
			(input.kind === "chip" && value === "question" ? questionPrompt(lang) : copy[lang][5]);
		return { messages: saveExchange(sid, visitorText, reply, screen.chips), ...screen };
	});
	if (!("general" in turn) || !turn.general) return turn;
	const { text, lang, content, attachmentCount } = turn.general;
	const ip = clientBucket(req);
	const answer = await knowledgeAnswer(text, lang, content, attachmentCount, () =>
		writeTransaction(db(), () => reserveGeminiAttempt(sid, ip)),
	);
	return writeTransaction(db(), () => {
		if (!db().prepare("SELECT 1 FROM dialogs WHERE id=?").get(sid))
			throw new ApiError(404, "unknown_session");
		if (db().prepare("SELECT 1 FROM quote_sessions WHERE dialog=?").get(sid))
			throw new ApiError(409, "conversation_changed");
		return {
			messages: saveExchange(sid, text, answer.text, [], answer.unknown),
			...generalScreen,
		};
	});
}
export function handler(route: Endpoint) {
	return async (req: Request) => {
		const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
		const origin = req.headers.get("origin");
		const url = new URL(req.url);
		const sameOrigin = url.protocol + "//" + (req.headers.get("host") || url.host);
		if (
			origin &&
			origin !== sameOrigin &&
			origin !== (process.env.GORBACH_CLIENT_ORIGIN || "https://gorbach-zaluzie.cz")
		)
			return Response.json({ ok: false, error: "origin" }, { status: 403, headers });
		if (origin) headers.set("Access-Control-Allow-Origin", origin);
		if (req.method === "OPTIONS") {
			headers.set(
				"Access-Control-Allow-Methods",
				route === "history" || route === "status" ? "GET" : "POST",
			);
			headers.set("Access-Control-Allow-Headers", "Content-Type");
			return new Response(null, { status: 204, headers });
		}
		try {
			return Response.json(await dispatch(req, route), { headers });
		} catch (error) {
			return Response.json(
				{
					ok: false,
					error: error instanceof ApiError ? error.message : "internal",
					...(error instanceof ApiError && error.missing ? { missing: error.missing } : {}),
				},
				{ status: error instanceof ApiError ? error.status : 500, headers },
			);
		}
	};
}
