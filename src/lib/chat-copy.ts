export const copy = {
	cs: [
		"Jak vám můžeme pomoci?",
		"Odpovídá automatický asistent.",
		"Poptávka",
		"Servis",
		"Dotaz",
		"Děkujeme za zprávu.",
	],
	en: [
		"How can we help you?",
		"You are chatting with an automated assistant.",
		"Request a quote",
		"Service",
		"Ask a question",
		"Thank you for your message.",
	],
	de: [
		"Wie können wir Ihnen helfen?",
		"Sie schreiben mit einem automatischen Assistenten.",
		"Angebot anfragen",
		"Service",
		"Frage stellen",
		"Vielen Dank für Ihre Nachricht.",
	],
	ru: [
		"Чем мы можем вам помочь?",
		"Вам отвечает автоматический помощник.",
		"Запросить расчёт",
		"Сервис",
		"Задать вопрос",
		"Спасибо за сообщение.",
	],
	uk: [
		"Чим ми можемо вам допомогти?",
		"Вам відповідає автоматичний помічник.",
		"Запитати вартість",
		"Сервіс",
		"Поставити питання",
		"Дякуємо за повідомлення.",
	],
};
export function language(value: unknown) {
	const key = typeof value === "string" ? value.toLowerCase().split("-")[0] : "";
	return Object.hasOwn(copy, key) ? (key as keyof typeof copy) : "cs";
}
export function startCopy(lang: keyof typeof copy) {
	const [greeting, note, ...labels] = copy[lang];
	return {
		greeting,
		note,
		chips: ["quote", "service", "question"].map((id, i) => ({ id, label: labels[i] })),
	};
}
