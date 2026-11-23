import { db } from "./admin";
import { consultation, type Language } from "./chat-copy";
import { ApiError, contactDetails, createLead, prompts, type readInput } from "./quote";

type Handoff = { question: string; name: string; contact: string };

export function getHandoff(sid: string): Handoff | undefined {
	const row = db()
		.prepare("SELECT question,name,contact FROM handoff_sessions WHERE dialog=?")
		.get(sid);
	if (row)
		return {
			question: String(row.question),
			name: String(row.name),
			contact: String(row.contact),
		};
}

export function handoffScreen(handoff: Handoff, lang: Language) {
	const labels = consultation[lang];
	const contact = contactDetails(handoff.contact);
	return {
		question: !handoff.name
			? labels.handoff
			: contact
				? labels.review
				: prompts[lang].contact,
		chips: [{ id: "decline_handoff", label: labels.declineChip }],
		multi: false,
		progress: null,
		input: handoff.name && !contact ? "phone" : "text",
		review: contact
			? { purpose: "handoff", products: [], name: handoff.name, ...contact }
			: null,
		pending: false,
	};
}

export function beginHandoff(sid: string, question: string) {
	db()
		.prepare("INSERT INTO handoff_sessions(dialog,question) VALUES(?,?)")
		.run(sid, question);
	db()
		.prepare("UPDATE dialogs SET unsupported_streak=0,consultation_evidence='' WHERE id=?")
		.run(sid);
	return { question, name: "", contact: "" };
}

export function answerHandoff(
	sid: string,
	handoff: Handoff,
	input: ReturnType<typeof readInput>,
) {
	const value = input.values[0];
	if (input.files) throw new ApiError(400, "invalid_attachment");
	if (input.kind === "chip" && value === "decline_handoff") {
		db().prepare("DELETE FROM handoff_sessions WHERE dialog=?").run(sid);
		return null;
	}
	if (input.kind !== "text") throw new ApiError(400, "invalid_chip");
	if (!handoff.name) {
		if (value.length > 120 || !/\p{L}/u.test(value) || /[@?¿\u061f\uff1f\r\n]/u.test(value))
			throw new ApiError(400, "invalid_name");
		handoff.name = value;
	} else if (!handoff.contact) {
		if (!contactDetails(value)) throw new ApiError(400, "invalid_contact");
		handoff.contact = value;
	} else throw new ApiError(409, "already_reviewed");
	db()
		.prepare("UPDATE handoff_sessions SET name=?,contact=? WHERE dialog=?")
		.run(handoff.name, handoff.contact, sid);
	return handoff;
}

export function submitHandoff(sid: string, handoff: Handoff) {
	const contact = contactDetails(handoff.contact);
	const missing: string[] = [];
	if (!handoff.name) missing.push("name");
	if (!contact) missing.push("contact");
	if (missing.length) throw new ApiError(400, "incomplete", missing);
	return createLead(sid, {
		kind: "question",
		product: "",
		contact: handoff.name + " · " + handoff.contact,
		summary: "Dotaz pro specialistu: " + handoff.question,
		fields: {
			purpose: "handoff",
			name: handoff.name,
			question: handoff.question,
			...contact,
		},
	});
}
