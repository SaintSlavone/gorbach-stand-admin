import { db } from "./admin";

export class ApiError extends Error {
	constructor(
		public status: number,
		key: string,
		public missing?: string[],
	) {
		super(key);
	}
}
const prompts = {
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
type Field = {
	translations?: Record<string, { q?: string; chips?: Record<string, string> }>;
	id: string;
	q: string;
	priority: "required" | "recommended" | "optional";
	type: string;
	chips?: string[];
	follow?: Record<string, string[]>;
	only_if?: "follow";
};
type Product = { title?: Record<string, string>; fields: Field[] };
type Catalog = Record<string, Product>;
type Answer = string | string[];
type Item = { product: string; answers: Record<string, Answer>; notes?: string };
type Intake = "quote" | "service";
type State = {
	intake?: Intake;
	items: Item[];
	choosing: boolean;
	skips: number;
	name: string;
	contact: string;
};
type Input = { values: string[]; kind: "text" | "chip" | "chips" };
export function readInput(body: Record<string, unknown>): Input {
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
	return { kind, values: values.map((v) => v.trim()) };
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
function answerLabel(field: Field, lang: string, value: string) {
	const labels = field.translations?.[lang]?.chips;
	return labels && Object.hasOwn(labels, value) ? (labels[value] ?? value) : value;
}
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
		if (fields.length) return priority === "optional" ? fields : fields.slice(0, 1);
	}
	return [];
}
const email = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const phone = (s: string) =>
	/^\+?[\d ()-]+$/.test(s) && /^\d{7,15}$/.test(s.replace(/\D/g, ""));
function review(state: State) {
	return {
		...(state.intake === "service" ? { serviceKind: state.items[0]?.product } : {}),
		products: state.items,
		name: state.name,
		...(email(state.contact) ? { email: state.contact } : { phone: state.contact }),
	};
}
export function labelReview(
	summary: ReturnType<typeof review>,
	catalog: Catalog,
	lang: string,
) {
	return {
		...summary,
		products: summary.products.map((item) => {
			const product = catalog[item.product];
			const answered = product.fields.filter((field) =>
				Object.hasOwn(item.answers, field.id),
			);
			return {
				...item,
				title: product.title?.[lang] ?? product.title?.cs ?? item.product,
				questionLabels: Object.fromEntries(
					answered.map((f) => [f.id, f.translations?.[lang]?.q ?? f.q]),
				),
				answerLabels: Object.fromEntries(
					answered.map((field) => {
						const answer = item.answers[field.id];
						const label = (value: string) => answerLabel(field, lang, value);
						return [field.id, Array.isArray(answer) ? answer.map(label) : label(answer)];
					}),
				),
			};
		}),
	};
}
function view(state: State, catalog: Catalog, lang = "cs") {
	const prompt = prompts[lang as keyof typeof prompts] ?? prompts.cs;
	const item = state.items.at(-1),
		product = item && catalog[item.product];
	const required =
		item && product ? active(item, product).filter((f) => f.priority === "required") : [];
	const total = required.length + 1;
	const base = {
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
				.map(([id, p]) => chip(id, p.title?.[lang] ?? p.title?.cs ?? id)),
			review: null,
		};
	const fields = pending(item, product);
	if (fields.length) {
		const f = fields[0],
			grouped = fields.length > 1;
		return {
			...base,
			question: fields.map((f) => f.translations?.[lang]?.q ?? f.q).join("\n"),
			multi: !grouped && f.type === "multi",
			chips: [
				...(grouped ? [] : (f.chips ?? [])).map((v) => chip(v, answerLabel(f, lang, v))),
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
function answer(state: State, catalog: Catalog, input: Input) {
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
			for (const field of fields) item.answers[field.id] = "neví";
			if (state.skips >= 2 || v.toLowerCase() === "nechci")
				for (const field of active(item, catalog[item.product]))
					if (!Object.hasOwn(item.answers, field.id)) item.answers[field.id] = "neví";
			return;
		}
		const options = f.chips ?? [];
		if (fields.length > 1) {
			if (kind !== "text") throw new ApiError(400, "invalid_answer");
			item.notes = v;
			for (const field of fields) item.answers[field.id] = "viz poznámka";
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
		if (kind !== "text" || !(email(v) || phone(v)))
			throw new ApiError(400, "invalid_contact");
		state.contact = v;
		return;
	}
	if (state.intake !== "service" && kind !== "chips" && v === "add_product") {
		state.choosing = true;
		return;
	}
	throw new ApiError(409, "already_reviewed");
}
export function questionnaireTurn(
	sid: string,
	input: Input,
	requested: Intake | null,
	lang: string,
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
	const catalog: Catalog = rev
		? JSON.parse(String(rev.content))[service ? "services" : "products"]
		: {};
	if (!rev || !Object.values(catalog).some((p) => p.fields.length)) {
		if (service)
			return {
				question: (prompts[lang as keyof typeof prompts] ?? prompts.cs).unavailable,
				chips: [],
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
		answer(state, catalog, input);
	}
	const screen = view(state, catalog, lang);
	sql
		.prepare(
			"INSERT INTO quote_sessions(dialog,version,state,screen) VALUES(?,?,?,?) ON CONFLICT(dialog) DO UPDATE SET state=excluded.state,screen=excluded.screen",
		)
		.run(sid, rev.version, JSON.stringify(state), JSON.stringify(screen));
	sql
		.prepare("UPDATE dialogs SET product=?,start_chip=? WHERE id=?")
		.run(state.items[0]?.product ?? "", state.intake ?? "quote", sid);
	return screen.review
		? { ...screen, review: labelReview(screen.review, catalog, lang) }
		: screen;
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
		catalog: Catalog = row
			? JSON.parse(String(row.content))[state.intake === "service" ? "services" : "products"]
			: {};
	const missing: string[] = [];
	if (state.choosing || !state.items.length) missing.push("product");
	for (const item of state.items) {
		const product = catalog[item.product];
		if (!product?.fields.length) {
			missing.push("product");
			continue;
		}
		for (const f of active(item, product))
			if (f.priority === "required" && !Object.hasOwn(item.answers, f.id))
				missing.push(f.id);
	}
	if (!state.name.trim()) missing.push("name");
	if (!(email(state.contact) || phone(state.contact))) missing.push("contact");
	if (missing.length) throw new ApiError(400, "incomplete", missing);
	const summary = view(state, catalog).review;
	if (!summary) throw new ApiError(400, "incomplete", ["review"]);
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
	const titles = state.items.map((i) => catalog[i.product].title?.cs ?? i.product);
	const contact = state.name + " · " + state.contact;
	sql
		.prepare(
			"INSERT INTO leads(id,dialog,kind,product,created,contact,summary,fields) VALUES(?,?,?,?,?,?,?,?)",
		)
		.run(
			id,
			sid,
			state.intake === "service" ? state.items[0].product : "quote",
			state.items[0].product,
			now.toISOString(),
			contact,
			(state.intake === "service" ? "Servisní požadavek: " : "Poptávka: ") +
				titles.join(", ") +
				" · " +
				contact,
			JSON.stringify(summary),
		);
	return { lead_id: id };
}
