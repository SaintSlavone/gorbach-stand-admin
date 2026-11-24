import type { Language } from "./chat-copy";
import { savedKnowledgeLanguage } from "./validate-revision";

const questions: Record<Language, RegExp> = {
	cs: /^(?:zatemňují (?:venkovní|exteriérové) žaluzie (?:místnost|pokoj) úplně|(?:dokážou|mohou) (?:venkovní|exteriérové) žaluzie úplně zatemnit (?:místnost|pokoj))$/iu,
	en: /^(?:do|can) (?:exterior|outdoor) blinds (?:completely darken (?:a|the) room|provide complete blackout)$/iu,
	de: /^(?:verdunkeln außenjalousien (?:einen|den) raum (?:vollständig|komplett)|können außenjalousien (?:einen|den) raum (?:vollständig|komplett) verdunkeln)$/iu,
	ru: /^(?:полностью ли затемняют (?:комнату|помещение) (?:наружные|внешние) жалюзи|могут ли (?:наружные|внешние) жалюзи полностью затемнить (?:комнату|помещение))$/iu,
	uk: /^чи (?:повністю затемнюють кімнату зовнішні жалюзі|можуть зовнішні жалюзі повністю затемнити кімнату|зовнішні жалюзі повністю затемнюють кімнату)$/iu,
};

const sourceQuestion = "Q: Dokážou venkovní žaluzie úplně zatemnit místnost?";
const sourceAnswer =
	"Žaluzie typu Z poskytují velmi vysoký stupeň zastínění, ale úplné zatemnění nelze garantovat.";

const localized: Record<Language, string> = {
	cs: sourceAnswer,
	en: "Type Z blinds provide a very high level of shading, but complete blackout cannot be guaranteed.",
	de: "Jalousien vom Typ Z bieten einen sehr hohen Grad an Verschattung. Eine vollständige Verdunkelung lässt sich jedoch nicht garantieren.",
	ru: "Жалюзи типа Z обеспечивают очень высокую степень затенения, но полное затемнение нельзя гарантировать.",
	uk: "Жалюзі типу Z забезпечують дуже високий ступінь затінення, але повне затемнення не можна гарантувати.",
};

export function exteriorBlackout(
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
	const source = sections.find(
		(entry) =>
			entry.id === "venkovni-zaluzie" && savedKnowledgeLanguage(entry.lang) === "cs",
	);
	const lines = source?.text
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	const questionIndex = lines?.indexOf(sourceQuestion) ?? -1;
	if (questionIndex === -1 || lines?.[questionIndex + 1] !== sourceAnswer)
		return undefined;
	return {
		outcome: "answered" as const,
		lang,
		product: "outdoor-blinds" as const,
		text: localized[lang],
		evidence: sourceAnswer,
	};
}
