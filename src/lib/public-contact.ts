import type { Language } from "./chat-copy";

type Department = "general" | "quote" | "service" | "complaint";
type Channel = "email" | "phone" | "address" | "contact";

const departmentWords = {
	complaint:
		/(?:\b(?:complaint|warranty claim|reklamation)\b|reklamac|рекламац|скарг|жалоб|претензи)/iu,
	service:
		/(?:\b(?:service|support|repair|inspection|reparatur|wartung)\w*\b|servis|oprav|reviz|сервіс|сервис|ремонт|ревізі)/iu,
	quote:
		/(?:\b(?:quote|sales|estimate|angebot|vertrieb|partner|cleaning|reinigung)\w*\b|poptávk|čištění|spoluprác|кошторис|розрахунок|замовлен|заявк|расч[её]т|попт[а-я]+|чистк|чищенн)/iu,
};

const channelWords = {
	email:
		/(?:\b(?:e[- ]?mail|mail|emailadresse)\b|електронн[а-яіїє]* (?:пошт|адрес)|электронн[а-я]* (?:почт|адрес)|пошт[ауи]|почт[ауые]|емейл)/iu,
	phone:
		/(?:\b(?:phone|telephone|telefon|telefonnummer|handynummer|telefonní)\w*\b|телефон|номер компанії|номер фирмы)/iu,
	address: /(?:\b(?:address|adres[ayue]|adresse|anschrift)\w*\b|адрес)/iu,
	contact:
		/(?:\b(?:kontakt|kontakty|kontaktovat|kontaktdaten|kontaktieren|erreichen|contact|contacts|reach|get in touch)\b|контакт|зв[’'ʼ]?язатися|связаться)/iu,
};

function contactIntent(text: string) {
	const value = text.toLowerCase().trim();
	const channel = (Object.keys(channelWords) as Channel[]).find((key) =>
		channelWords[key].test(value),
	);
	if (!channel) return undefined;
	const department = (
		Object.keys(departmentWords) as Exclude<Department, "general">[]
	).find((key) => departmentWords[key].test(value));
	const company =
		/(?<!\p{L})(?:your|you|company|gorbach|ihre[rmns]?|sie|firma|firmy|váš|vaš[ei]|vás|vám|máte|ваш[а-яіїє]*|вас|вам|вами|у вас|компані[яї]|компани[яи]|фірм[аи]|фирм[аы])(?!\p{L})/iu;
	const bare =
		/^(?:kontakt(?:y|daten)?|contacts?|e[- ]?mail|emailadresse|phone(?: number)?|telefon(?:nummer)?|address|adresa|adresse|контакт[ыи]?|телефон|адрес[а]?|почта|пошта|електронна пошта)[?!.\s]*$/iu;
	const question =
		/(?:\?|^(?:jak|kam|kde|what|how|where|which|wie|wo|welch|який|яка|як|куди|де|как|куда|где|какой|какая))|(?:contact|reach|kontaktovat|зв[’'ʼ]?язатися|связаться)\s/u;
	const privateContact =
		/(?:\bcustomer\b(?!\s+service)|\b(?:visitor|client|lead|besucher|kunde|zákazník)\w*\b|\bmy\s+(?:email|e-mail|address|phone)\b|klient|клієнт|клиент|посетител|відвідувач|покупател)/iu;
	if (
		privateContact.test(value) ||
		(!bare.test(value) && !((company.test(value) || department) && question.test(value)))
	)
		return undefined;
	return { channel, department: department ?? "general" } as const;
}

export function publicContactRequest(text: string) {
	const segments = new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(
		text,
	);
	for (const { segment } of segments) {
		const intent = contactIntent(segment);
		if (intent) return intent;
	}
}

const titles = new Set([
	"kontakt",
	"kontakty",
	"contact",
	"contacts",
	"company contact",
	"business contact",
	"public contact",
	"kontaktdaten",
	"контакты",
	"контакти",
]);
const sectionIds = new Set([
	"kontakt",
	"kontakty",
	"contact",
	"contacts",
	"company-contact",
	"company-contacts",
	"business-contact",
	"public-contact",
]);
const emailLabel =
	/^(?:poptávky(?:, čištění, dotazy a spolupráce)?|servis(?: a revize)?|reklamace|obecný kontakt|obecný e-?mail|e-?mail|general(?: contact| e-?mail)?|company e-?mail|sales(?: e-?mail)?|quote(?: requests?| e-?mail)?|service(?: and inspections?| e-?mail)?|complaints?(?: e-?mail)?|allgemeiner kontakt|angebot|reklamation|загальний контакт|общий контакт|сервіс|сервис|рекламація|рекламация)$/iu;
const phoneLabel =
	/^(?:telefon|telefonní číslo|phone|company phone|telephone|telefonnummer|телефон|номер телефону)(?:\s+(?:pro servis|for service|for sales))?$/iu;
const addressLabel =
	/^(?:adresa(?: firmy)?|(?:company )?address|adresse|anschrift|адрес|адреса(?: компанії)?)$/iu;

const labels = {
	cs: {
		general: "Obecný kontakt",
		quote: "Poptávky, čištění a spolupráce",
		service: "Servis a revize",
		complaint: "Reklamace",
		phone: "Telefon",
		address: "Adresa",
		missing: "Ověřené kontaktní údaje tohoto typu nemám.",
	},
	en: {
		general: "General contact",
		quote: "Quotes, cleaning and partnerships",
		service: "Service and inspections",
		complaint: "Complaints",
		phone: "Phone",
		address: "Address",
		missing: "I don’t have a verified contact of that type.",
	},
	de: {
		general: "Allgemeiner Kontakt",
		quote: "Angebote, Reinigung und Zusammenarbeit",
		service: "Service und Prüfungen",
		complaint: "Reklamationen",
		phone: "Telefon",
		address: "Adresse",
		missing: "Dafür liegt mir kein bestätigter Kontakt vor.",
	},
	ru: {
		general: "Общий контакт",
		quote: "Расчёты, чистка и сотрудничество",
		service: "Сервис и проверки",
		complaint: "Рекламации",
		phone: "Телефон",
		address: "Адрес",
		missing: "У меня нет подтверждённых контактных данных этого типа.",
	},
	uk: {
		general: "Загальний контакт",
		quote: "Розрахунки, чищення та співпраця",
		service: "Сервіс і перевірки",
		complaint: "Рекламації",
		phone: "Телефон",
		address: "Адреса",
		missing: "У мене немає підтверджених контактних даних такого типу.",
	},
};

export function publicContactAnswer(
	content: string | null,
	request: NonNullable<ReturnType<typeof publicContactRequest>>,
	lang: Language,
) {
	const emails: Partial<Record<Department, string>> = {};
	const phones: Partial<Record<Department, string>> = {};
	let address: string | undefined;
	if (content) {
		const sections: { id?: string; title: string; text: string }[] = JSON.parse(content);
		for (const section of sections) {
			if (
				!sectionIds.has(section.id?.toLowerCase() ?? "") &&
				!titles.has(section.title.trim().toLowerCase())
			)
				continue;
			for (const line of section.text.split(/\r?\n/)) {
				const pair = /^\s*(?:[-*]\s*)?([^:]+):\s*(.*?)\s*$/u.exec(line);
				if (!pair) continue;
				const [, label, value] = pair;
				const department =
					(Object.keys(departmentWords) as Exclude<Department, "general">[]).find((key) =>
						departmentWords[key].test(label),
					) ?? "general";
				if (emailLabel.test(label) && /^[\w.%+-]+@gorbach-zaluzie\.cz$/iu.test(value))
					emails[department] ??= value;
				if (
					phoneLabel.test(label) &&
					/^\+?[\d(). -]+$/u.test(value) &&
					/^\d{7,15}$/u.test(value.replace(/\D/g, ""))
				)
					phones[department] ??= value;
				if (
					addressLabel.test(label) &&
					/^[\p{L}\p{M}\d ,./()\-–]{8,160}$/u.test(value) &&
					/\d/u.test(value)
				)
					address ??= value;
			}
		}
	}
	const copy = labels[lang];
	const department = request.department;
	const email = emails[department]
		? `${copy[department]}: ${emails[department]}`
		: undefined;
	const generalEmail = emails.general ? `${copy.general}: ${emails.general}` : undefined;
	if (request.channel === "phone")
		return phones[department]
			? `${copy.phone}: ${phones[department]}`
			: [copy.missing, email ?? generalEmail].filter(Boolean).join("\n");
	if (request.channel === "address")
		return address
			? `${copy.address}: ${address}`
			: [copy.missing, email ?? generalEmail].filter(Boolean).join("\n");
	if (request.channel === "email" || department !== "general")
		return email ?? [copy.missing, generalEmail].filter(Boolean).join("\n");
	return (
		[
			generalEmail,
			phones.general && `${copy.phone}: ${phones.general}`,
			address && `${copy.address}: ${address}`,
		]
			.filter(Boolean)
			.join("\n") || copy.missing
	);
}
