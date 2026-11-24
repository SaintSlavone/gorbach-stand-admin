import type { Language } from "./chat-copy";
import { savedKnowledgeLanguage } from "./validate-revision";

const questions: Record<Language, RegExp> = {
	cs: /^jaké (?:typy|modely) (?:(?:venkovních|exteriérových) )?žaluzií (?:nabízíte|prodáváte|máte(?: v nabídce)?)$/iu,
	en: /^(?:what|which) (?:types|models) of (?:(?:exterior|outdoor) )?blinds (?:(?:do you|does your (?:company|firm)) (?:offer|sell|carry)|are available)$/iu,
	de: /^welche (?:(?:typen|modelle) (?:von )?)?(?:außenjalousien|jalousien|raffstores) (?:bieten sie an|verkaufen sie|haben sie(?: im angebot)?)$/iu,
	ru: /^какие (?:типы|виды|модели) (?:(?:наружных|внешних) )?жалюзи (?:вы (?:предлагаете|продаёте|продаете)|(?:предлагает|продаёт|продает) ваша (?:компания|фирма)|ваша (?:компания|фирма) (?:предлагает|продаёт|продает))$/iu,
	uk: /^які (?:типи|види|моделі) (?:(?:зовнішніх|вуличних) )?жалюзі (?:(?:пропонує|продає) ваша (?:компанія|фірма)|(?:ви (?:пропонуєте|продаєте)|(?:пропонуєте|продаєте) ви)|(?:пропонуєте|продаєте))$/iu,
};

const offerings = {
	cs: (names: string) => `Z venkovních žaluzií nabízíme například ${names}.`,
	en: (names: string) => `Our exterior blind models include ${names}.`,
	de: (names: string) => `Zu unseren Außenjalousien gehören beispielsweise ${names}.`,
	ru: (names: string) => `Среди наших моделей наружных жалюзи — ${names}.`,
	uk: (names: string) => `Серед наших моделей зовнішніх жалюзі — ${names}.`,
};

// Only a complete offer sentence can establish that a model is currently offered.
// Other mentions in dimensions, old descriptions or comparisons are insufficient.
const offeringLine =
	/^Nabízíme (?:například |modely )?(.+?)(?: v různých montážních provedeních)?\.$/u;
const modelName = /^(?:Zetta|Cetta) [0-9]{2,3}[A-Z]?$/u;

export function exteriorModels(
	question: string,
	sections: { id?: string; text: string; lang?: unknown }[],
) {
	const normalized = question
		.trim()
		.replace(/[.!?]+$/u, "")
		.trim()
		.replace(/\s+/gu, " ");
	const lang = (Object.keys(questions) as Language[]).find((code) =>
		questions[code].test(normalized),
	);
	if (!lang) return undefined;
	const section = sections.find(
		(entry) =>
			entry.id === "venkovni-zaluzie" && savedKnowledgeLanguage(entry.lang) === "cs",
	);
	if (!section) return undefined;
	for (const line of section.text.split(/\r?\n/u)) {
		const evidence = line.trim();
		const list = offeringLine.exec(evidence)?.[1];
		if (!list) continue;
		const names = list.split(/,\s+| a /u);
		if (names.length > 8 || !names.every((name) => modelName.test(name))) continue;
		const formatted = new Intl.ListFormat(lang, {
			style: "long",
			type: "conjunction",
		}).format([...new Set(names)]);
		return {
			outcome: "answered" as const,
			lang,
			product: "outdoor-blinds" as const,
			text: offerings[lang](formatted),
			evidence,
		};
	}
}
