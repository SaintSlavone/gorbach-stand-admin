import type { ProductTopic } from "./consultation-context";

export const assistantIntroduction = {
	cs: "Dobrý den, jsem AI asistent Gorbach žaluzie.",
	en: "Hello, I’m Gorbach žaluzie’s AI assistant.",
	de: "Guten Tag, ich bin der KI-Assistent von Gorbach žaluzie.",
	ru: "Здравствуйте, я ИИ-ассистент Gorbach žaluzie.",
	uk: "Вітаю! Я ШІ-асистент Gorbach žaluzie.",
};

export const languageConfirmation = {
	cs: "Ano, můžeme si psát česky.",
	en: "Yes, I can help in English.",
	de: "Ja, ich kann Ihnen auf Deutsch helfen.",
	ru: "Да, я понимаю русский и могу помочь вам на русском.",
	uk: "Так, я можу допомогти українською.",
};

export const copy = {
	cs: [
		assistantIntroduction.cs +
			" Pomohu vám vybrat stínění pro okna, balkon nebo terasu. Co potřebujete zastínit?",
		"Odpovídá AI asistent.",
		"Poptávka",
		"Servis",
		"Dotaz",
	],
	en: [
		assistantIntroduction.en +
			" I can help you choose shading for your windows, balcony, or patio. What would you like to shade?",
		"You are chatting with an AI assistant.",
		"Request a quote",
		"Service",
		"Ask a question",
	],
	de: [
		assistantIntroduction.de +
			" Ich helfe Ihnen, Sonnenschutz für Fenster, Balkon oder Terrasse auszuwählen. Was möchten Sie beschatten?",
		"Sie schreiben mit einem KI-Assistenten.",
		"Angebot anfragen",
		"Service",
		"Frage stellen",
	],
	ru: [
		assistantIntroduction.ru +
			" Помогу подобрать солнцезащиту для окон, балкона или террасы. Что вы хотите затенить?",
		"Вам отвечает ИИ-ассистент.",
		"Запросить расчёт",
		"Сервис",
		"Задать вопрос",
	],
	uk: [
		assistantIntroduction.uk +
			" Допоможу підібрати сонцезахист для вікон, балкона чи тераси. Що ви хочете затінити?",
		"Вам відповідає ШІ-асистент.",
		"Запитати вартість",
		"Сервіс",
		"Поставити питання",
	],
};
export type Language = keyof typeof copy;
export function isLanguage(value: unknown): value is Language {
	return typeof value === "string" && Object.hasOwn(copy, value);
}
export function language(value: unknown) {
	const key = typeof value === "string" ? value.toLowerCase().split("-")[0] : "";
	return isLanguage(key) ? key : "cs";
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
		languageHelp: languageConfirmation.cs + " S jakým stíněním vám mohu pomoci?",
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
		languageHelp: languageConfirmation.en + " What would you like to shade?",
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
		languageHelp: languageConfirmation.de + " Was möchten Sie beschatten?",
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
		languageHelp: languageConfirmation.ru + " Какое пространство вы хотите затенить?",
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
		languageHelp: languageConfirmation.uk + " Що ви хочете затінити?",
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

const productDiscovery = {
	cs: {
		"outdoor-blinds":
			"Co je u těchto oken důležitější: omezit přehřívání, nebo lépe regulovat denní světlo?",
		shutters: "Jde vám u rolet hlavně o zatemnění, nebo o větší soukromí?",
		pergolas: "Jak velkou část terasy chcete zastínit a jak ji obvykle využíváte?",
		awnings: "Jak širokou část terasy nebo balkonu chcete markýzou zastínit?",
		"indoor-shading":
			"Potřebujete spíš jemně filtrovat denní světlo, nebo místnost výrazně zatemnit?",
		"insect-screens": "Potřebujete síť do okna, nebo do dveří?",
		housings: "Řešíte box u novostavby, nebo u hotové fasády?",
		controls: "Chcete stínění ovládat po jednotlivých oknech, nebo společně?",
		installation: "Jde o novostavbu, rekonstrukci, nebo už hotový prostor?",
	},
	en: {
		"outdoor-blinds":
			"For these windows, is your priority reducing heat or adjusting the daylight?",
		shutters: "Are you mainly looking to darken the room or gain more privacy?",
		pergolas:
			"How much of the patio would you like to cover, and how do you normally use it?",
		awnings:
			"How wide is the part of your patio or balcony you’d like the awning to shade?",
		"indoor-shading": "Would you rather soften the daylight or make the room much darker?",
		"insect-screens": "Is the screen for a window or a door?",
		housings: "Is the housing for a new build or an existing façade?",
		controls:
			"Would you like to operate each shade individually or control several together?",
		installation: "Is this for a new build, a renovation, or an existing space?",
	},
	de: {
		"outdoor-blinds":
			"Möchten Sie an diesen Fenstern vor allem die Hitze reduzieren oder das Tageslicht regulieren?",
		shutters: "Geht es Ihnen vor allem um Verdunkelung oder um mehr Privatsphäre?",
		pergolas:
			"Welchen Teil der Terrasse möchten Sie beschatten und wie nutzen Sie ihn üblicherweise?",
		awnings:
			"Wie breit ist der Teil Ihrer Terrasse oder Ihres Balkons, den die Markise beschatten soll?",
		"indoor-shading":
			"Möchten Sie das Tageslicht sanft filtern oder den Raum stärker abdunkeln?",
		"insect-screens": "Brauchen Sie den Insektenschutz für ein Fenster oder eine Tür?",
		housings: "Ist der Kasten für einen Neubau oder eine bestehende Fassade gedacht?",
		controls: "Möchten Sie die Beschattung einzeln je Fenster oder gemeinsam bedienen?",
		installation:
			"Geht es um einen Neubau, eine Sanierung oder einen bereits fertigen Raum?",
	},
	ru: {
		"outdoor-blinds":
			"Для этих окон важнее уменьшить нагрев или точнее регулировать дневной свет?",
		shutters: "Для вас важнее затемнить комнату или повысить приватность?",
		pergolas: "Какую часть террасы вы хотите затенить и как обычно ею пользуетесь?",
		awnings: "Какой ширины участок террасы или балкона вы хотите затенить маркизой?",
		"indoor-shading":
			"Вам нужно мягко рассеять дневной свет или заметно затемнить комнату?",
		"insect-screens": "Вам нужна москитная сетка для окна или двери?",
		housings: "Короб нужен для нового здания или для уже готового фасада?",
		controls:
			"Вам удобнее управлять солнцезащитой на каждом окне отдельно или на нескольких сразу?",
		installation: "Это новое здание, ремонт или уже обустроенное пространство?",
	},
	uk: {
		"outdoor-blinds":
			"Для цих вікон важливіше зменшити нагрівання чи точніше регулювати денне світло?",
		shutters: "Для вас важливіше затемнити кімнату чи забезпечити більше приватності?",
		pergolas: "Яку частину тераси потрібно затінити та як ви зазвичай нею користуєтеся?",
		awnings: "Яку ширину тераси чи балкона потрібно затінити маркізою?",
		"indoor-shading":
			"Вам потрібно м’яко розсіяти денне світло чи помітно затемнити кімнату?",
		"insect-screens": "Вам потрібна москітна сітка для вікна чи дверей?",
		housings: "Короб потрібен для новобудови чи для вже готового фасаду?",
		controls:
			"Ви хочете керувати сонцезахистом на кожному вікні окремо чи на кількох одночасно?",
		installation: "Це новобудова, ремонт чи вже облаштований простір?",
	},
};

export function discoveryQuestion(
	lang: Language,
	topic: ProductTopic | undefined,
	need: "controls" | "installation" | undefined,
) {
	const focus = need ?? topic;
	return focus ? productDiscovery[lang][focus] : consultation[lang].next;
}

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
