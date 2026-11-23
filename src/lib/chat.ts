import { readUpload, storeUpload } from "./file-upload";
import { writeTransaction, expiryCutoff } from "./attachments";
import { clientBucket, reserveGeminiAttempt } from "./gemini-quota";
import { knowledgeAnswer } from "./knowledge-answer";
import { detectVisitorLanguage, languageRequest } from "./chat-language";
import {
	answerHandoff,
	beginHandoff,
	getHandoff,
	handoffScreen,
	submitHandoff,
} from "./handoff";
import {
	ApiError,
	attachmentContext,
	questionnaireTurn,
	labelReview,
	submitLead,
	readInput,
} from "./quote";
import { randomBytes } from "node:crypto";
import { db } from "./admin";

import {
	consultation,
	consultationChips,
	copy,
	language,
	startCopy,
	type Language,
} from "./chat-copy";

function validateSid(sid: unknown): asserts sid is string {
	if (typeof sid !== "string" || !/^[a-f0-9]{48}$/.test(sid))
		throw new ApiError(400, "invalid_sid");
}
function start(lang: Language, page: string, utm: string) {
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
const unsupportedLimit = 2;

function lastMessageId(sid: string) {
	return db().prepare("SELECT MAX(id) AS id FROM messages WHERE dialog=?").get(sid)?.id;
}

function lastChoices(sid: string): { id: string; label: string }[] {
	const row = db()
		.prepare(
			"SELECT chips FROM messages WHERE dialog=? AND role='bot' ORDER BY id DESC LIMIT 1",
		)
		.get(sid);
	return JSON.parse(String(row?.chips ?? "[]"));
}

function isQuoteRequest(value: string, lang: Language) {
	const normalized = value
		.toLowerCase()
		.replace(/[?!.]+$/u, "")
		.trim();
	if (normalized === copy[lang][2].toLowerCase()) return true;
	if (
		/^(?:price|cost|quote|preis|cena|cenu|kolik stojí|сколько стоит|ціна|вартість|how much(?: is it| are they| does it cost)?|what (?:is|are) (?:the|your) (?:price|cost)s?|was kostet (?:das|es)|сколько это стоит|скільки (?:це )?коштує)$/iu.test(
			normalized,
		)
	)
		return true;
	const price =
		/(?<![\p{L}\p{M}\p{N}_])(?:prices?|costs?|quotes?|preise?|koste[tn]|cena|cenu|kolik stojí|сколько сто(?:ит|ят)|цена|стоимость|ціна|вартість|скільки кошту(?:є|ють))(?![\p{L}\p{M}\p{N}_])/iu;
	const englishPrice =
		/^how much (?:is|are) (?:(?:an?|the|your|those|some) )?(?:(?:exterior|outdoor|interior|indoor|roller|window|motorized|motorised|retractable|aluminum|aluminium|solar|custom|electric|manual) ){0,3}(?:blinds?|shades?|shading|awnings?|shutters?|pergolas?|insect screens?|roller screens?)$/iu;
	const product =
		/(?<![\p{L}\p{M}\p{N}_])(?:gorbach|blinds?|shades?|shading|awnings?|shutters?|insect screens?|roller screens?)(?![\p{L}\p{M}\p{N}_])|(?:žaluzi|rolet|pergol|markýz|stíněn|purenit|jalousi|rolllad|rollo|markise|sonnenschutz|fliegengitter|жалюз|маркиз|маркіз|рольстав|сонцезахист|москитн|москітн|затінен|солнцезащит|пуренит|пуреніт|пергол|штор)/iu;
	return (
		englishPrice.test(normalized) || (price.test(normalized) && product.test(normalized))
	);
}
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
			public: (process.env.GORBACH_CHAT_PUBLIC ?? "true") === "true",
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
				`SELECT m.role,m.body AS text,m.chips,q.screen,q.version,d.lang,l.id AS lead_id,
				 h.question AS handoff_question,h.name AS handoff_name,h.contact AS handoff_contact
				 FROM dialogs d LEFT JOIN leads l ON l.dialog=d.id LEFT JOIN quote_sessions q ON q.dialog=d.id
				 LEFT JOIN handoff_sessions h ON h.dialog=d.id LEFT JOIN messages m ON m.dialog=d.id
				 WHERE d.id=? ORDER BY m.id`,
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
		const { handoff_question, handoff_name, handoff_contact } = rows[0];
		if (typeof handoff_question === "string")
			return {
				messages,
				...handoffScreen(
					{
						question: handoff_question,
						name: String(handoff_name),
						contact: String(handoff_contact),
					},
					language(rows[0].lang),
				),
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
		const context = attachmentContext(sid, String(rows[0].lang));
		const pendingAttachments = context?.instance
			? db()
					.prepare(
						"SELECT id,name,size FROM files WHERE dialog=? AND field_instance=? AND created>? ORDER BY created,id",
					)
					.all(sid, context.instance, expiryCutoff())
			: [];
		return {
			...generalScreen,
			messages,
			chips: JSON.parse(String(rows.at(-1)?.chips ?? "[]")),
			...screen,
			...context?.recovery,
			pendingAttachments,
		};
	}
	const turn = writeTransaction(db(), () => {
		const dialog = db()
			.prepare(
				`SELECT lang,page,utm,knowledge_version,consultation_evidence,
				 EXISTS(SELECT 1 FROM quote_sessions WHERE dialog=dialogs.id) AS in_survey
				 FROM dialogs WHERE id=?`,
			)
			.get(sid);
		if (!dialog) throw new ApiError(404, "unknown_session");
		const lang = language(dialog.lang);
		if (route === "reset")
			return { sid: start(lang, String(dialog.page), String(dialog.utm)).sid };
		const lead = db().prepare("SELECT id FROM leads WHERE dialog=?").get(sid);
		const handoff = getHandoff(sid);
		if (route === "submit") {
			if (lead) return { lead_id: lead.id };
			return handoff ? submitHandoff(sid, handoff) : submitLead(sid);
		}
		if (lead) throw new ApiError(409, "submitted");
		const input = readInput(body);
		const value = input.values.join(", ");
		const choices = input.kind === "text" ? [] : lastChoices(sid);
		const visitorText = input.values
			.map((id) => choices.find((c) => c.id === id)?.label ?? id)
			.join(", ");
		if (handoff) {
			const next = answerHandoff(sid, handoff, input);
			const screen = next
				? handoffScreen(next, lang)
				: {
						...generalScreen,
						chips: consultationChips(lang, false),
					};
			const reply =
				"question" in screen ? String(screen.question) : consultation[lang].discover;
			return { messages: saveExchange(sid, visitorText, reply, screen.chips), ...screen };
		}
		const freeText = input.kind === "text" && !input.files && !dialog.in_survey;
		const requestedLanguage = freeText ? languageRequest(value) : undefined;
		if (requestedLanguage) {
			const screen = {
				...generalScreen,
				chips: consultationChips(requestedLanguage, false),
			};
			db()
				.prepare("UPDATE dialogs SET lang=?,unsupported_streak=0 WHERE id=?")
				.run(requestedLanguage, sid);
			return {
				messages: saveExchange(
					sid,
					visitorText,
					consultation[requestedLanguage].languageHelp,
					screen.chips,
				),
				...screen,
			};
		}
		const detectedLanguage = freeText ? detectVisitorLanguage(value) : undefined;
		const turnLanguage = detectedLanguage ?? lang;
		const quoteRequested =
			(input.kind === "chip" && value === "quote") ||
			(input.kind === "text" && isQuoteRequest(value, turnLanguage));
		const requested = quoteRequested
			? "quote"
			: input.kind === "chip" && value === "service"
				? "service"
				: null;
		const survey = questionnaireTurn(sid, input, requested, turnLanguage);
		if (survey) {
			if (turnLanguage !== lang)
				db().prepare("UPDATE dialogs SET lang=? WHERE id=?").run(turnLanguage, sid);
			return {
				messages: saveExchange(sid, visitorText, survey.question, survey.chips),
				...survey,
			};
		}
		if (input.files) throw new ApiError(400, "invalid_attachment");
		if (input.kind === "text") {
			const revision = db()
				.prepare("SELECT content FROM revisions WHERE id=? AND kind='knowledge'")
				.get(dialog.knowledge_version);
			return {
				general: {
					text: value,
					lang,
					detectedLanguage,
					lastMessage: lastMessageId(sid),
					previousEvidence: String(dialog.consultation_evidence),
					attachmentCount: Number(
						db()
							.prepare("SELECT count(*) AS n FROM files WHERE dialog=? AND created>?")
							.get(sid, expiryCutoff())!.n,
					),
					content: revision ? String(revision.content) : null,
				},
			};
		}
		if (
			input.kind === "chip" &&
			value === "specialist" &&
			choices.some((c) => c.id === value)
		) {
			const lastVisitor = db()
				.prepare(
					"SELECT body FROM messages WHERE dialog=? AND role='visitor' ORDER BY id DESC LIMIT 1",
				)
				.get(sid)!;
			const screen = handoffScreen(beginHandoff(sid, String(lastVisitor.body)), lang);
			return {
				messages: saveExchange(sid, visitorText, screen.question, screen.chips),
				...screen,
			};
		}
		if (input.kind !== "chip" || !["products", "question"].includes(value))
			throw new ApiError(400, "invalid_chip");
		const screen = { ...generalScreen, chips: consultationChips(lang, false) };
		const reply =
			value === "products" ? consultation[lang].discover : consultation[lang].ask;
		return { messages: saveExchange(sid, visitorText, reply, screen.chips), ...screen };
	});
	if (!("general" in turn) || !turn.general) return turn;
	const {
		text,
		lang,
		detectedLanguage,
		content,
		attachmentCount,
		lastMessage,
		previousEvidence,
	} = turn.general;
	const ip = clientBucket(req);
	const answer = await knowledgeAnswer(
		text,
		lang,
		detectedLanguage,
		content,
		attachmentCount,
		() => writeTransaction(db(), () => reserveGeminiAttempt(sid, ip)),
		previousEvidence,
	);
	return writeTransaction(db(), () => {
		const sql = db();
		const dialog = sql
			.prepare("SELECT unsupported_streak FROM dialogs WHERE id=?")
			.get(sid);
		if (!dialog) throw new ApiError(404, "unknown_session");
		if (lastMessage !== lastMessageId(sid)) throw new ApiError(409, "conversation_changed");
		const responseLanguage = answer.lang;
		if (responseLanguage !== lang)
			sql.prepare("UPDATE dialogs SET lang=? WHERE id=?").run(responseLanguage, sid);
		const labels = consultation[responseLanguage];
		if (answer.outcome === "unsupported" || answer.outcome === "answered") {
			const streak =
				answer.outcome === "unsupported" ? Number(dialog.unsupported_streak) + 1 : 0;
			if (streak >= unsupportedLimit) {
				const screen = handoffScreen(beginHandoff(sid, text), responseLanguage);
				return {
					messages: saveExchange(sid, text, screen.question, screen.chips, true),
					...screen,
				};
			}
			sql
				.prepare("UPDATE dialogs SET unsupported_streak=?,consultation_evidence=? WHERE id=?")
				.run(streak, answer.outcome === "answered" ? answer.evidence : "", sid);
		}
		const chips = consultationChips(responseLanguage, answer.outcome !== "answered");
		const reply =
			answer.outcome === "answered"
				? answer.text + "\n\n" + labels.next
				: answer.outcome === "limited"
					? answer.text
					: labels[answer.outcome];
		return {
			...generalScreen,
			chips,
			messages: saveExchange(sid, text, reply, chips, answer.outcome === "unsupported"),
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
