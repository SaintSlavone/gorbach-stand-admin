import shipped from "../../data/initial/survey.json";
import type { Language } from "./chat-copy";

export type Intake = "quote" | "service";
export type FieldCopy = {
	id: string;
	q: string;
	translations?: Record<string, { q?: string; chips?: Record<string, string> }>;
};

const shippedProducts: Record<
	string,
	{ title: Record<string, string>; fields: FieldCopy[] }
> = shipped.products;

const serviceTitles: Record<string, Record<Language, string>> = {
	cleaning: {
		cs: "Čištění",
		en: "Cleaning",
		de: "Reinigung",
		ru: "Чистка",
		uk: "Чищення",
	},
	service: {
		cs: "Servis",
		en: "Service",
		de: "Service",
		ru: "Сервисное обслуживание",
		uk: "Сервісне обслуговування",
	},
	revision: {
		cs: "Revize",
		en: "Inspection",
		de: "Überprüfung",
		ru: "Проверка",
		uk: "Перевірка",
	},
	complaint: {
		cs: "Reklamace",
		en: "Complaint",
		de: "Reklamation",
		ru: "Рекламация",
		uk: "Рекламація",
	},
	partner: {
		cs: "Spolupráce",
		en: "Partnership",
		de: "Zusammenarbeit",
		ru: "Сотрудничество",
		uk: "Співпраця",
	},
	question: {
		cs: "Dotaz",
		en: "General question",
		de: "Allgemeine Frage",
		ru: "Общий вопрос",
		uk: "Загальне запитання",
	},
};

export function surveyTitle(
	intake: Intake,
	id: string,
	title: Record<string, string> | undefined,
	lang: Language,
) {
	const explicit = title?.[lang];
	if (explicit != null) return explicit;
	const standard =
		intake === "service"
			? Object.hasOwn(serviceTitles, id)
				? serviceTitles[id]
				: undefined
			: Object.hasOwn(shippedProducts, id)
				? shippedProducts[id].title
				: undefined;
	const defaultService = intake === "service" && !Object.keys(title ?? {}).length;
	return (
		(standard && (defaultService || title?.cs === standard.cs)
			? standard[lang]
			: undefined) ??
		title?.cs ??
		id
	);
}

function fieldTranslation(intake: Intake, id: string, field: FieldCopy, lang: Language) {
	if (intake === "quote" && Object.hasOwn(shippedProducts, id))
		return shippedProducts[id].fields.find(
			(stock) => stock.id === field.id && stock.q === field.q,
		)?.translations?.[lang];
}

export function surveyQuestion(
	intake: Intake,
	id: string,
	field: FieldCopy,
	lang: Language,
) {
	return (
		field.translations?.[lang]?.q ?? fieldTranslation(intake, id, field, lang)?.q ?? field.q
	);
}

export function surveyOption(
	intake: Intake,
	id: string,
	field: FieldCopy,
	lang: Language,
	value: string,
) {
	const explicit = field.translations?.[lang]?.chips;
	if (explicit && Object.hasOwn(explicit, value)) return explicit[value];
	const standard = fieldTranslation(intake, id, field, lang)?.chips;
	return standard && Object.hasOwn(standard, value) ? standard[value] : undefined;
}

export const answerMarkerLabels = {
	cs: { skipped: "neví", notes: "viz poznámka", attachment: "Příloha přiložena" },
	en: { skipped: "Not specified", notes: "See note", attachment: "Attachment added" },
	de: {
		skipped: "Nicht angegeben",
		notes: "Siehe Anmerkung",
		attachment: "Datei angehängt",
	},
	ru: { skipped: "Не указано", notes: "См. примечание", attachment: "Вложение добавлено" },
	uk: { skipped: "Не вказано", notes: "Див. примітку", attachment: "Вкладення додано" },
};
