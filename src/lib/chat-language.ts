import type { Language } from "./chat-copy";

const capabilityQuestions: Record<Language, RegExp> = {
	cs: /^(?:(?:mluvíte|rozumíte|umíte) česky|(?:česky|v češtině) prosím)$/u,
	en: /^(?:(?:do|can|could|will) you (?:speak|understand|reply in|answer in|help in|chat in) english|english please|in english please)$/u,
	de: /^(?:(?:sprechen|verstehen) sie deutsch|(?:auf deutsch|deutsch) bitte)$/u,
	ru: /^(?:(?:вы )?(?:говорите|понимаете) по[- ]русски|(?:на русском|по[- ]русски) пожалуйста)$/u,
	uk: /^(?:(?:ви )?(?:говорите|розмовляєте|розумієте) українською|українською будь ласка)$/u,
};

export function languageRequest(text: string) {
	const normalized = text
		.toLowerCase()
		.replace(/[,?!\.]/gu, "")
		.trim();
	return (Object.keys(capabilityQuestions) as Language[]).find((lang) =>
		capabilityQuestions[lang].test(normalized),
	);
}

const markers: Record<Language, RegExp> = {
	cs: /^(?:ahoj|ano|cena|cenu|děkuji|den|dobrý|jak|jaká|jaké|jsem|kolik|mohu|montujete|nabízíte|nebo|prosím|stínění|venkovní|vy|žaluzie)$/u,
	en: /^(?:are|can|could|do|does|exterior|for|hello|hi|how|i|install|much|please|price|quote|shading|the|they|what|where|which|would|you|your)$/u,
	de: /^(?:angebot|auf|danke|das|den|deutsch|die|für|hallo|haben|ich|jalousien|kann|können|kostet|möchte|oder|preis|sonnenschutz|was|welche|wie|wir)$/u,
	ru: /^(?:вы|где|есть|заказать|здравствуйте|интересует|какие|какой|могу|мне|можно|пожалуйста|предлагаете|русском|сколько|спасибо|стоит|что)$/u,
	uk: /^(?:будь|вартість|ви|дякую|замовити|ласка|мені|можна|можу|потрібно|пропонуєте|скільки|сонцезахист|українською|ціна|чи|що|яке|якщо)$/u,
};

export function detectVisitorLanguage(text: string) {
	const normalized = text.toLowerCase();
	const words = new Set(normalized.match(/\p{L}+/gu));
	const scores = (Object.keys(markers) as Language[]).map((lang) => ({
		lang,
		score: [...words].filter((word) => markers[lang].test(word)).length,
	}));
	const distinctive = {
		cs: /[ěščřžýůďťň]/u,
		de: /[äöüß]/u,
		en: /$^/u,
		ru: /[ыэъё]/u,
		uk: /[іїєґ]/u,
	};
	for (const entry of scores)
		if ((words.size >= 2 || entry.score) && distinctive[entry.lang].test(normalized))
			entry.score += 2;
	const [first, second] = scores.sort((a, b) => b.score - a.score);
	return first.score >= 2 && first.score > second.score ? first.lang : undefined;
}

export function canInferVisitorLanguage(text: string) {
	return (text.match(/\p{L}{2,}/gu)?.length ?? 0) >= 2;
}
