import { expiryCutoff } from "./attachments";
import { consultationChips, language, type Language } from "./chat-copy";
import { db } from "./admin";
import {
	answerMarkerLabels,
	surveyOption,
	surveyQuestion,
	surveyTitle,
	type FieldCopy,
	type Intake,
} from "./survey-copy";

export class ApiError extends Error {
	constructor(
		public status: number,
		key: string,
		public missing?: string[],
	) {
		super(key);
	}
}
export const prompts = {
	cs: {
		service: "Jakou službu potřebujete?",
		unavailable: "Příjem servisních požadavků momentálně není dostupný.",
		serviceSummary: "Shrnutí požadavku",
		product: "O jaký produkt máte zájem?",
		name: "Jak se jmenujete?",
		contact: "Jaký je váš telefon nebo e-mail?",
		summary: "Shrnutí poptávky",
		skip: "Přeskočit",
		add: "Přidat další produkt",
	},
	en: {
		service: "Which service do you need?",
		unavailable: "Service intake is currently unavailable.",
		serviceSummary: "Service request summary",
		product: "Which product are you interested in?",
		name: "What is your name?",
		contact: "What is your phone number or email address?",
		summary: "Quote summary",
		skip: "Skip",
		add: "Add another product",
	},
	de: {
		service: "Welche Dienstleistung benötigen Sie?",
		unavailable: "Serviceanfragen können derzeit nicht aufgenommen werden.",
		serviceSummary: "Zusammenfassung der Serviceanfrage",
		product: "Für welches Produkt interessieren Sie sich?",
		name: "Wie heißen Sie?",
		contact: "Wie lautet Ihre Telefonnummer oder E-Mail-Adresse?",
		summary: "Zusammenfassung der Anfrage",
		skip: "Überspringen",
		add: "Weiteres Produkt hinzufügen",
	},
	ru: {
		service: "Какая услуга вам нужна?",
		unavailable: "Приём сервисных заявок сейчас недоступен.",
		serviceSummary: "Сводка сервисной заявки",
		product: "Какой продукт вас интересует?",
		name: "Как вас зовут?",
		contact: "Какой у вас номер телефона или адрес электронной почты?",
		summary: "Сводка заявки",
		skip: "Пропустить",
		add: "Добавить ещё один продукт",
	},
	uk: {
		service: "Яка послуга вам потрібна?",
		unavailable: "Приймання сервісних заявок зараз недоступне.",
		serviceSummary: "Підсумок сервісної заявки",
		product: "Який продукт вас цікавить?",
		name: "Як вас звати?",
		contact: "Який у вас номер телефону або адреса електронної пошти?",
		summary: "Підсумок заявки",
		skip: "Пропустити",
		add: "Додати ще один продукт",
	},
};
type Field = FieldCopy & {
	priority: "required" | "recommended" | "optional";
	type: string;
	chips?: string[];
	follow?: Record<string, string[]>;
	only_if?: "follow";
};
type Product = { title?: Record<string, string>; fields: Field[] };
type Catalog = Record<string, Product>;
type Answer = string | string[];
type Item = {
	product: string;
	answers: Record<string, Answer>;
	attachments?: Record<string, string[]>;
	notes?: string;
	answerMarkers?: Record<string, "skipped" | "notes">;
};
type State = {
	intake?: Intake;
	items: Item[];
	choosing: boolean;
	skips: number;
	name: string;
	contact: string;
};
type Input = { values: string[]; kind: "text" | "chip" | "chips"; files?: string[] };
export function readInput(body: Record<string, unknown>): Input {
	const files = body.files;
	if (
		files !== undefined &&
		(!Array.isArray(files) ||
			!files.length ||
			files.length > 5 ||
			!files.every((id) => typeof id === "string"))
	)
		throw new ApiError(400, "invalid_attachment");
	if (files && !Object.hasOwn(body, "text")) body = { ...body, text: "attachment" };
	const keys = (["text", "chip", "chips"] as const).filter((k) => Object.hasOwn(body, k));
	if (keys.length !== 1) throw new ApiError(400, "invalid_input");
	const kind = keys[0],
		raw = body[kind],
		values = kind === "chips" ? raw : [raw];
	if (
		!Array.isArray(values) ||
		!values.length ||
		values.length > 100 ||
		!values.every((v) => typeof v === "string" && v.trim() && Array.from(v).length <= 800)
	)
		throw new ApiError(400, kind === "text" ? "invalid_text" : "invalid_chip");
	return {
		files: files as string[] | undefined,
		kind,
		values: values.map((v) => v.trim()),
	};
}
const blank = (intake: Intake = "quote"): State => ({
	intake,
	items: [],
	choosing: true,
	skips: 0,
	name: "",
	contact: "",
});
const chip = (id: string, label = id) => ({ id, label });
function active(item: Item, product: Product) {
	const targets = new Set<string>();
	for (const f of product.fields) {
		const a = item.answers[f.id];
		if (!Object.hasOwn(item.answers, f.id)) continue;
		for (const v of Array.isArray(a) ? a : [a])
			if (f.follow && Object.hasOwn(f.follow, v))
				for (const id of f.follow[v]) targets.add(id);
	}
	return product.fields.filter((f) => !f.only_if || targets.has(f.id));
}
function pending(item: Item, product: Product) {
	const todo = active(item, product).filter((f) => !Object.hasOwn(item.answers, f.id));
	for (const priority of ["required", "recommended", "optional"]) {
		const fields = todo.filter((f) => f.priority === priority);
		if (fields.length)
			return priority === "optional" &&
				!fields.some((f) => ["file", "text+file"].includes(f.type))
				? fields
				: fields.slice(0, 1);
	}
	return [];
}
const email = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const phone = (s: string) =>
	/^\+?[\d ()-]+$/.test(s) && /^\d{7,15}$/.test(s.replace(/\D/g, ""));
export function contactDetails(value: string) {
	if (email(value)) return { email: value };
	if (phone(value)) return { phone: value };
	return null;
}
function selectedProduct(state: State) {
	return state.intake === "service" ? "" : (state.items[0]?.product ?? "");
}
function review(state: State) {
	return {
		...(state.intake === "service" ? { serviceKind: state.items[0]?.product } : {}),
		products: state.items.map(({ answerMarkers, ...item }) => item),
		name: state.name,
		...contactDetails(state.contact),
	};
}
function reviewAnswerLabel(
	intake: Intake,
	item: Item,
	field: Field,
	lang: Language,
	value: string,
) {
	const explicit = surveyOption(intake, item.product, field, lang, value);
	if (explicit !== undefined) return explicit;
	const labels = answerMarkerLabels[lang];
	const marker =
		item.answerMarkers && Object.hasOwn(item.answerMarkers, field.id)
			? item.answerMarkers[field.id]
			: undefined;
	if (marker) return labels[marker];
	if (field.type === "file" && value === "attachment") return labels.attachment;
	// A historical free-text answer can literally contain a marker. Translate only
	// values the visitor could not have entered as an ordinary answer in the field.
	const restricted =
		["number", "choice", "multi", "file"].includes(field.type) &&
		!field.chips?.includes(value);
	if (
		value === "neví" &&
		(restricted || (field.type === "text+file" && !item.attachments?.[field.id]?.length))
	)
		return labels.skipped;
	if (value === "viz poznámka" && restricted && item.notes) return labels.notes;
	return value;
}

function labelReview(state: State, catalog: Catalog, lang: Language) {
	const summary = review(state);
	const intake = state.intake ?? "quote";
	return {
		...summary,
		products: summary.products.map((item, index) => {
			const product = catalog[item.product];
			const answered = product.fields.filter((field) =>
				Object.hasOwn(item.answers, field.id),
			);
			return {
				...item,
				title: surveyTitle(intake, item.product, product.title, lang),
				questionLabels: Object.fromEntries(
					answered.map((f) => [f.id, surveyQuestion(intake, item.product, f, lang)]),
				),
				answerLabels: Object.fromEntries(
					answered.map((field) => {
						const answer = item.answers[field.id];
						const label = (value: string) =>
							reviewAnswerLabel(intake, state.items[index], field, lang, value);
						return [field.id, Array.isArray(answer) ? answer.map(label) : label(answer)];
					}),
				),
			};
		}),
	};
}
function view(state: State, catalog: Catalog, lang: Language = "cs") {
	const prompt = prompts[lang];
	const intake = state.intake ?? "quote";
	const item = state.items.at(-1),
		product = item && catalog[item.product];
	const required =
		item && product ? active(item, product).filter((f) => f.priority === "required") : [];
	const total = required.length + 1;
	const base = {
		attachmentField: null as { id: string; type: string } | null,
		attachmentAnswers: state.items.map((item) => ({
			product: item.product,
			fields: item.attachments ?? {},
		})),
		multi: false,
		input: "text",
		pending: false,
		progress: {
			step: Math.min(
				total,
				required.filter((f) => Object.hasOwn(item!.answers, f.id)).length + 1,
			),
			total,
		},
	};
	if (state.choosing || !item || !product)
		return {
			...base,
			question: state.intake === "service" ? prompt.service : prompt.product,
			chips: Object.entries(catalog)
				.filter(([, p]) => p.fields.length)
				.map(([id, p]) => chip(id, surveyTitle(intake, id, p.title, lang))),
			review: null,
		};
	const fields = pending(item, product);
	if (fields.length) {
		const f = fields[0],
			grouped = fields.length > 1;
		return {
			...base,
			question: fields.map((f) => surveyQuestion(intake, item.product, f, lang)).join("\n"),
			multi: !grouped && f.type === "multi",
			attachmentField: ["file", "text+file"].includes(f.type)
				? { id: f.id, type: f.type }
				: null,
			chips: [
				...(grouped
					? []
					: (f.chips ?? []).map((v) =>
							chip(v, surveyOption(intake, item.product, f, lang, v) ?? v),
						)),
				chip("skip", prompt.skip),
			],
			review: null,
		};
	}
	if (!state.name) return { ...base, question: prompt.name, chips: [], review: null };
	if (!state.contact)
		return {
			...base,
			question: prompt.contact,
			input: "phone",
			chips: [],
			review: null,
		};
	return {
		...base,
		question: state.intake === "service" ? prompt.serviceSummary : prompt.summary,
		chips: state.intake === "service" ? [] : [chip("add_product", prompt.add)],
		review: review(state),
	};
}
function markAnswer(item: Item, id: string, marker: "skipped" | "notes") {
	item.answers[id] = marker === "skipped" ? "neví" : "viz poznámka";
	item.answerMarkers = { ...item.answerMarkers, [id]: marker };
}

function answer(state: State, catalog: Catalog, input: Input, sid: string) {
	const { values, kind } = input,
		v = values[0];
	if (state.choosing) {
		const id = Object.keys(catalog).find((id) => id === v || catalog[id].title?.cs === v);
		if (kind === "chips" || !id || !catalog[id].fields.length)
			throw new ApiError(400, "invalid_product");
		state.items.push({ product: id, answers: {} });
		state.choosing = false;
		state.skips = 0;
		return;
	}
	const item = state.items.at(-1)!;
	const fields = pending(item, catalog[item.product]);
	if (fields.length) {
		const f = fields[0],
			skip =
				kind !== "chips" &&
				["skip", "nevím", "přeskočit", "nechci"].includes(v.toLowerCase());
		if (skip) {
			state.skips++;
			for (const field of fields) markAnswer(item, field.id, "skipped");
			if (state.skips >= 2 || v.toLowerCase() === "nechci")
				for (const field of active(item, catalog[item.product]))
					if (!Object.hasOwn(item.answers, field.id)) markAnswer(item, field.id, "skipped");
			return;
		}
		if (["file", "text+file"].includes(f.type)) {
			if (
				!validFiles(sid, input.files) ||
				(f.type === "text+file" && (kind !== "text" || v === "attachment"))
			)
				throw new ApiError(400, "invalid_attachment");
			item.attachments ??= {};
			item.attachments[f.id] = [...new Set(input.files!)];
			item.answers[f.id] = f.type === "file" ? "attachment" : v;
			state.skips = 0;
			return;
		}
		if (input.files) throw new ApiError(400, "invalid_attachment");
		const options = f.chips ?? [];
		if (fields.length > 1) {
			if (kind !== "text") throw new ApiError(400, "invalid_answer");
			item.notes = v;
			for (const field of fields) markAnswer(item, field.id, "notes");
		} else {
			if (
				(kind === "chips" && f.type !== "multi") ||
				(kind !== "text" && !values.every((x) => options.includes(x)))
			)
				throw new ApiError(400, "invalid_chip");
			if (["choice", "multi"].includes(f.type) && !values.every((x) => options.includes(x)))
				return;
			if (f.type === "number" && !options.includes(v) && !/^\d+(?:[.,]\d+)?$/.test(v))
				return;
			if (f.type === "file") return;
			item.answers[f.id] = f.type === "multi" ? [...new Set(values)] : v;
		}
		state.skips = 0;
		return;
	}
	if (!state.name) {
		if (kind !== "text" || !v.trim()) throw new ApiError(400, "invalid_name");
		state.name = v;
		return;
	}
	if (!state.contact) {
		if (kind !== "text" || !contactDetails(v)) throw new ApiError(400, "invalid_contact");
		state.contact = v;
		return;
	}
	if (state.intake !== "service" && kind !== "chips" && v === "add_product") {
		state.choosing = true;
		return;
	}
	throw new ApiError(409, "already_reviewed");
}
function expiredAnswer(sid: string, state: State, catalog: Catalog) {
	for (const item of state.items) {
		const field = active(item, catalog[item.product]).find(
			(f) =>
				f.priority === "required" &&
				["file", "text+file"].includes(f.type) &&
				Object.hasOwn(item.answers, f.id) &&
				item.answers[f.id] !== "neví" &&
				!validFiles(sid, item.attachments?.[f.id]),
		);
		if (field) return { item, field };
	}
}
function recoveryScreen(
	state: State,
	catalog: Catalog,
	lang: Language,
	{ item, field }: NonNullable<ReturnType<typeof expiredAnswer>>,
) {
	return {
		...view(state, catalog, lang),
		question: surveyQuestion(state.intake ?? "quote", item.product, field, lang),
		attachmentField: { id: field.id, type: field.type },
		attachmentRecovery: { product: item.product, field: field.id },
		chips: [chip("skip", prompts[lang].skip)],
		review: null,
		multi: false,
		input: "text",
	};
}
function surveyCatalog(state: State, content: string): Catalog {
	return JSON.parse(content)[state.intake === "service" ? "services" : "products"];
}

function surveyStep(sid: string, state: State, catalog: Catalog, lang: Language) {
	const expired = expiredAnswer(sid, state, catalog);
	const recovery = expired ? recoveryScreen(state, catalog, lang, expired) : null;
	return {
		screen: recovery ?? view(state, catalog, lang),
		recovery,
		item: expired?.item ?? state.items.at(-1),
	};
}

export function restoreQuestionnaire(
	sid: string,
	lang: Language,
	stateJson: string,
	content: string,
) {
	const state: State = JSON.parse(stateJson);
	const catalog = surveyCatalog(state, content);
	const { screen, recovery, item } = surveyStep(sid, state, catalog, lang);
	const field = screen.attachmentField;
	const instance =
		field && item
			? JSON.stringify([
					state.items.indexOf(item),
					field.id,
					item.attachments?.[field.id] ?? [],
				])
			: null;
	return {
		screen: screen.review
			? { ...screen, review: labelReview(state, catalog, lang) }
			: screen,
		recovery,
		instance,
	};
}

export function attachmentContext(sid: string, lang: string) {
	const row = db()
		.prepare(
			"SELECT q.state,r.content FROM quote_sessions q JOIN revisions r ON r.id=q.version WHERE dialog=?",
		)
		.get(sid);
	return row
		? restoreQuestionnaire(sid, language(lang), String(row.state), String(row.content))
		: null;
}
export function questionnaireTurn(
	sid: string,
	input: Input,
	requested: Intake | null,
	lang: Language,
) {
	const sql = db();
	const row = sql
		.prepare(
			"SELECT q.state,q.version,r.content FROM quote_sessions q JOIN revisions r ON r.id=q.version WHERE q.dialog=?",
		)
		.get(sid);
	if (!row && !requested) return null;
	if (sql.prepare("SELECT 1 FROM leads WHERE dialog=?").get(sid))
		throw new ApiError(409, "submitted");
	const rev =
		row ??
		sql
			.prepare(
				"SELECT id AS version,content FROM revisions WHERE kind='survey' ORDER BY id DESC LIMIT 1",
			)
			.get();
	const state: State = row ? JSON.parse(String(row.state)) : blank(requested ?? "quote");
	const service = state.intake === "service";
	const catalog = rev ? surveyCatalog(state, String(rev.content)) : {};
	if (!rev || !Object.values(catalog).some((p) => p.fields.length)) {
		if (service)
			return {
				question: prompts[lang].unavailable,
				chips: consultationChips(lang, false),
				review: null,
				progress: null,
				input: "text",
				multi: false,
				pending: false,
			};
		throw new ApiError(409, "survey_unavailable");
	}
	if (row) {
		for (const item of state.items) Object.setPrototypeOf(item.answers, null);
		const expired = expiredAnswer(sid, state, catalog);
		if (expired) {
			const { item, field } = expired;
			const replacement: Item = { product: item.product, answers: {} };
			const temporary = { ...state, choosing: false, items: [replacement], skips: 0 };
			answer(
				temporary,
				{
					[item.product]: {
						...catalog[item.product],
						fields: [{ ...field, only_if: undefined }],
					},
				},
				input,
				sid,
			);
			item.answers[field.id] = replacement.answers[field.id];
			if (replacement.answerMarkers?.[field.id])
				item.answerMarkers = {
					...item.answerMarkers,
					[field.id]: replacement.answerMarkers[field.id],
				};
			item.attachments ??= {};
			if (replacement.attachments?.[field.id])
				item.attachments[field.id] = replacement.attachments[field.id];
			else delete item.attachments[field.id];
		} else answer(state, catalog, input, sid);
	}
	const { screen } = surveyStep(sid, state, catalog, lang);
	sql
		.prepare(
			"INSERT INTO quote_sessions(dialog,version,state,screen) VALUES(?,?,?,?) ON CONFLICT(dialog) DO UPDATE SET state=excluded.state,screen=excluded.screen",
		)
		.run(sid, rev.version, JSON.stringify(state), JSON.stringify(screen));
	sql
		.prepare("UPDATE dialogs SET product=?,start_chip=? WHERE id=?")
		.run(selectedProduct(state), state.intake ?? "quote", sid);
	return screen.review ? { ...screen, review: labelReview(state, catalog, lang) } : screen;
}
export function submitLead(sid: string) {
	const sql = db(),
		existing = sql.prepare("SELECT id FROM leads WHERE dialog=?").get(sid);
	if (existing) return { lead_id: existing.id };
	const row = sql
		.prepare(
			"SELECT q.state,r.content FROM quote_sessions q JOIN revisions r ON r.id=q.version WHERE dialog=?",
		)
		.get(sid);
	const state: State = row ? JSON.parse(String(row.state)) : blank(),
		catalog = row ? surveyCatalog(state, String(row.content)) : {};
	const missing: string[] = [];
	if (state.choosing || !state.items.length) missing.push("product");
	for (const item of state.items) {
		const product = catalog[item.product];
		if (!product?.fields.length) {
			missing.push("product");
			continue;
		}
		for (const f of active(item, product))
			if (
				f.priority === "required" &&
				(!Object.hasOwn(item.answers, f.id) ||
					(["file", "text+file"].includes(f.type) &&
						item.answers[f.id] !== "neví" &&
						!validFiles(sid, item.attachments?.[f.id])))
			)
				missing.push(f.id);
	}
	if (!state.name.trim()) missing.push("name");
	if (!contactDetails(state.contact)) missing.push("contact");
	if (missing.length) throw new ApiError(400, "incomplete", missing);
	const summary = view(state, catalog).review;
	if (!summary) throw new ApiError(400, "incomplete", ["review"]);
	const titles = state.items.map((i) => catalog[i.product].title?.cs ?? i.product);
	const contact = state.name + " · " + state.contact;
	return createLead(sid, {
		kind: state.intake === "service" ? state.items[0].product : "quote",
		product: selectedProduct(state),
		contact,
		summary:
			(state.intake === "service" ? "Servisní požadavek: " : "Poptávka: ") +
			titles.join(", ") +
			" · " +
			contact,
		fields: summary,
	});
}

export function createLead(
	sid: string,
	lead: {
		kind: string;
		product: string;
		contact: string;
		summary: string;
		fields: object;
	},
) {
	const sql = db();
	const now = new Date();
	const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" })
		.format(now)
		.replaceAll("-", "");
	const seq = sql
		.prepare(
			"INSERT INTO lead_sequence(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1 RETURNING n",
		)
		.get(date)!;
	const id = "GZ-" + date + "-" + String(seq.n).padStart(3, "0");
	sql
		.prepare(
			"INSERT INTO leads(id,dialog,kind,product,created,contact,summary,fields) VALUES(?,?,?,?,?,?,?,?)",
		)
		.run(
			id,
			sid,
			lead.kind,
			lead.product,
			now.toISOString(),
			lead.contact,
			lead.summary,
			JSON.stringify(lead.fields),
		);
	return { lead_id: id };
}

function validFiles(sid: string, files?: string[]) {
	return (
		!!files?.length &&
		files.every(
			(id) =>
				!!db()
					.prepare("SELECT 1 FROM files WHERE id=? AND dialog=? AND created>?")
					.get(id, sid, expiryCutoff()),
		)
	);
}
