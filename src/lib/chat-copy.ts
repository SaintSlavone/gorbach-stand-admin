export const copy = {
	cs: [
		"Dobrý den, jsem AI asistent Gorbach žaluzie. Jaké stínění hledáte?",
		"Odpovídá AI asistent.",
		"Poptávka",
		"Servis",
		"Dotaz",
	],
	en: [
		"Hello, I’m Gorbach žaluzie’s AI assistant. What would you like to shade?",
		"You are chatting with an AI assistant.",
		"Request a quote",
		"Service",
		"Ask a question",
	],
	de: [
		"Guten Tag, ich bin der KI-Assistent von Gorbach žaluzie. Was möchten Sie beschatten?",
		"Sie schreiben mit einem KI-Assistenten.",
		"Angebot anfragen",
		"Service",
		"Frage stellen",
	],
	ru: [
		"Здравствуйте, я ИИ-ассистент Gorbach žaluzie. Что вы хотите защитить от солнца?",
		"Вам отвечает ИИ-ассистент.",
		"Запросить расчёт",
		"Сервис",
		"Задать вопрос",
	],
	uk: [
		"Вітаю! Я ШІ-асистент Gorbach žaluzie. Що ви хочете затінити?",
		"Вам відповідає ШІ-асистент.",
		"Запитати вартість",
		"Сервіс",
		"Поставити питання",
	],
};
export type Language = keyof typeof copy;
export function language(value: unknown) {
	const key = typeof value === "string" ? value.toLowerCase().split("-")[0] : "";
	return Object.hasOwn(copy, key) ? (key as Language) : "cs";
}
export function startCopy(lang: Language) {
	const [greeting, note, ...labels] = copy[lang];
	return {
		greeting,
		note,
		chips: ["quote", "service", "question"].map((id, i) => ({ id, label: labels[i] })),
	};
}

export const consultation = {
	cs: {
		ask: "Na co se chcete zeptat ohledně stínění Gorbach?",
		discover:
			"Rád vám pomohu vybrat stínění. Řešíte okna, terasu, nebo jiný prostor? Co je pro vás nejdůležitější?",
		next: "Jaké stínění hledáte? Můžeme společně vybrat řešení nebo připravit poptávku.",
		unsupported:
			"V podkladech Gorbach k tomu nemám ověřenou odpověď. Můžu vám pomoci s výběrem stínění nebo předat dotaz specialistovi.",
		unavailable:
			"Ověřenou odpověď teď nemohu vyhledat. Můžeme připravit poptávku nebo předat dotaz specialistovi.",
		handoff: "Dotaz můžu předat specialistovi. Jak se jmenujete?",
		review: "Zkontrolujte prosím kontaktní údaje a odešlete dotaz specialistovi.",
		productsChip: "Jak vybrat stínění?",
		quoteChip: "Jak získat nabídku?",
		questionChip: "Mohu se ještě zeptat?",
		specialistChip: "Může pomoci specialista?",
		declineChip: "Zpět k výběru stínění",
	},
	en: {
		ask: "What would you like to know about Gorbach shading?",
		discover:
			"I can help you choose shading. Is it for windows, a patio, or another space? What matters most to you?",
		next:
			"What would you like to shade? I can help you choose a solution or request a quote.",
		unsupported:
			"I don’t have a verified answer in the Gorbach knowledge base. I can help you choose shading or pass your question to a specialist.",
		unavailable:
			"I can’t look up a verified answer right now. I can help you request a quote or pass your question to a specialist.",
		handoff: "I can pass your question to a specialist. What is your name?",
		review: "Please check your contact details and send your question to a specialist.",
		productsChip: "How do I choose shading?",
		quoteChip: "How do I get a quote?",
		questionChip: "Can I ask another question?",
		specialistChip: "Can a specialist help?",
		declineChip: "Back to choosing shading",
	},
	de: {
		ask: "Was möchten Sie über den Sonnenschutz von Gorbach wissen?",
		discover:
			"Ich helfe Ihnen bei der Auswahl. Geht es um Fenster, eine Terrasse oder einen anderen Bereich? Was ist Ihnen besonders wichtig?",
		next:
			"Was möchten Sie beschatten? Ich helfe Ihnen bei der Auswahl oder bei einer Angebotsanfrage.",
		unsupported:
			"Dazu finde ich keine bestätigte Antwort in der Gorbach-Wissensdatenbank. Ich helfe Ihnen bei der Auswahl oder leite Ihre Frage an unser Fachteam weiter.",
		unavailable:
			"Ich kann gerade keine bestätigte Antwort abrufen. Ich helfe Ihnen mit einer Angebotsanfrage oder leite Ihre Frage an unser Fachteam weiter.",
		handoff: "Ich kann Ihre Frage an unser Fachteam weiterleiten. Wie heißen Sie?",
		review:
			"Bitte prüfen Sie Ihre Kontaktdaten und senden Sie Ihre Frage an unser Fachteam.",
		productsChip: "Welcher Sonnenschutz passt?",
		quoteChip: "Wie erhalte ich ein Angebot?",
		questionChip: "Darf ich noch etwas fragen?",
		specialistChip: "Kann das Fachteam helfen?",
		declineChip: "Zurück zur Auswahl",
	},
	ru: {
		ask: "Что вы хотите узнать о солнцезащите Gorbach?",
		discover:
			"Помогу подобрать солнцезащиту. Что нужно затенить: окна, террасу или другое пространство? Что для вас важнее всего?",
		next: "Что вы хотите затенить? Я помогу выбрать решение или запросить расчёт.",
		unsupported:
			"В базе знаний Gorbach нет подтверждённого ответа. Я могу помочь выбрать солнцезащиту или передать вопрос специалисту.",
		unavailable:
			"Сейчас я не могу найти подтверждённый ответ. Я могу помочь запросить расчёт или передать вопрос специалисту.",
		handoff: "Могу передать ваш вопрос специалисту. Как вас зовут?",
		review: "Проверьте контактные данные и отправьте вопрос специалисту.",
		productsChip: "Как выбрать солнцезащиту?",
		quoteChip: "Как получить расчёт?",
		questionChip: "Можно задать ещё вопрос?",
		specialistChip: "Может помочь специалист?",
		declineChip: "Вернуться к выбору",
	},
	uk: {
		ask: "Що ви хочете дізнатися про сонцезахист Gorbach?",
		discover:
			"Допоможу підібрати сонцезахист. Потрібно затінити вікна, терасу чи інший простір? Що для вас найважливіше?",
		next: "Що ви хочете затінити? Я допоможу підібрати рішення або запросити розрахунок.",
		unsupported:
			"У базі знань Gorbach немає підтвердженої відповіді. Я можу допомогти обрати сонцезахист або передати запитання фахівцю.",
		unavailable:
			"Зараз я не можу знайти підтверджену відповідь. Я можу допомогти запросити розрахунок або передати запитання фахівцю.",
		handoff: "Можу передати ваше запитання фахівцю. Як вас звати?",
		review: "Перевірте контактні дані та надішліть запитання фахівцю.",
		productsChip: "Як обрати сонцезахист?",
		quoteChip: "Як отримати розрахунок?",
		questionChip: "Можна поставити ще запитання?",
		specialistChip: "Чи може допомогти фахівець?",
		declineChip: "Повернутися до вибору",
	},
};

export function consultationChips(lang: Language, offerSpecialist: boolean) {
	const labels = consultation[lang];
	return [
		{ id: "products", label: labels.productsChip },
		{ id: "quote", label: labels.quoteChip },
		offerSpecialist
			? { id: "specialist", label: labels.specialistChip }
			: { id: "question", label: labels.questionChip },
	];
}
