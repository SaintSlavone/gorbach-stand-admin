import type { Language } from "./chat-copy";

const capabilityQuestions: Record<Language, RegExp> = {
	cs: /^(?:(?:mluvíte|mluvíš|rozumíte|rozumíš|umíte|umíš) česky|(?:česky|v češtině) prosím)$/u,
	en: /^(?:(?:do|can|could|will) you (?:speak|understand|reply in|respond in|answer in|help in|chat in) english|english please|in english please)$/u,
	de: /^(?:(?:(?:sprechen|verstehen|können) sie|(?:sprichst|verstehst|kannst) du) deutsch|(?:auf deutsch|deutsch) bitte)$/u,
	ru: /^(?:(?:ты |вы )?(?:говоришь|говорите|понимаешь|понимаете) (?:ли (?:ты|вы) )?(?:по[- ]русски|на русском(?: языке)?|русский(?: язык)?)|(?:на русском(?: языке)?|по[- ]русски) пожалуйста|можно (?:по[- ]русски|на русском(?: языке)?))$/u,
	uk: /^(?:(?:ти |ви )?(?:говориш|говорите|розмовляєш|розмовляєте|розумієш|розумієте) (?:українською|українську(?: мову)?)|українською будь ласка|можна українською)$/u,
};

const greetings: Record<Language, RegExp> = {
	cs: /^(?:ahoj|dobrý den|dobrý večer|dobré ráno|zdravím)(?![\p{L}\p{N}])/u,
	en: /^(?:hi|hello|hey|good morning|good afternoon|good evening)(?![\p{L}\p{N}])/u,
	de: /^(?:hallo|guten tag|guten morgen|guten abend)(?![\p{L}\p{N}])/u,
	ru: /^(?:привет|здравствуйте|здравствуй|добрый день|добрый вечер|доброе утро)(?![\p{L}\p{N}])/u,
	uk: /^(?:привіт|вітаю|добрий день|добрий вечір|доброго дня|доброго ранку)(?![\p{L}\p{N}])/u,
};

export function greetingLanguage(text: string) {
	const normalized = text
		.toLowerCase()
		.replace(/[\p{P}\s]+$/u, "")
		.trim();
	return (Object.keys(greetings) as Language[]).find(
		(lang) => greetings[lang].exec(normalized)?.[0] === normalized,
	);
}

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
	ru: /^(?:вы|где|есть|заказать|здравствуйте|интересует|какие|какой|кошек|кошках|могу|мне|можно|пожалуйста|предлагаете|расскажи|расскажите|русском|сколько|собаках|спасибо|стоит|что)$/u,
	uk: /^(?:будь|вартість|ви|дякую|замовити|котів|ласка|мені|можна|можу|потрібно|пропонуєте|розкажи|розкажіть|скільки|сонцезахист|тварин|українською|ціна|чи|що|яке|якщо)$/u,
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
	if (first.score >= 2 && first.score > second.score) return first.lang;
	return (Object.keys(greetings) as Language[]).find((lang) =>
		greetings[lang].test(normalized),
	);
}

export function canInferVisitorLanguage(text: string) {
	return (text.match(/\p{L}{2,}/gu)?.length ?? 0) >= 2;
}
