const productPatterns = {
	"outdoor-blinds":
		/(?:\b(?:exterior|outdoor) blinds?\b|venkovn[íi] žaluzi|außenjalousi|raffstor|наружн[а-я]* жалюзи|зовнішн[а-яіїє]* жалюз)/iu,
	shutters:
		/(?:\b(?:roller )?shutters?\b|venkovn[íi] rolet|außenroll|rolllad|рольстав|захисн[а-яіїє]* рол[еь]т)/iu,
	pergolas: /(?:\bpergol\w*\b|пергол)/iu,
	awnings: /(?:\bawnings?\b|markýz|markis(?:e|en)|маркиз|маркіз)/iu,
	"indoor-shading":
		/(?:\b(?:indoor|interior) (?:blinds?|shad(?:es?|ing))\b|vnitřn[íi] (?:stíněn|žaluzi)|innenbeschattung|innenjalousi|внутренн[а-я]* жалюзи|внутрішн[а-яіїє]* жалюз)/iu,
	"insect-screens":
		/(?:\b(?:insect (?:screens?|nets?)|mosquito nets?)\b|sít[ěe] proti hmyzu|fliegengitter|insektenschutz|москитн[а-я]* сетк|москітн[а-яіїє]* сітк)/iu,
	housings: /(?:\bpurenit\w*\b|пуренит|пуреніт)/iu,
};

export type ProductTopic = keyof typeof productPatterns;
type Topic = ProductTopic | "general";
export type ConsultationContext = {
	active: Topic;
	evidence: Partial<Record<Topic, string>>;
};

const topics = Object.keys(productPatterns) as ProductTopic[];

export function productTopic(text: string): ProductTopic | undefined {
	const matches = topics.filter((topic) => productPatterns[topic].test(text));
	return matches.length === 1 ? matches[0] : undefined;
}

export function sectionProduct(id: string | undefined, title: string) {
	const topicsBySection: Record<string, ProductTopic> = {
		"venkovni-zaluzie": "outdoor-blinds",
		"venkovni-rolety": "shutters",
		"hlinikove-pergoly": "pergolas",
		"purenitove-boxy": "housings",
		markyzy: "awnings",
		"vnitrni-stineni": "indoor-shading",
		"site-proti-hmyzu": "insect-screens",
	};
	return id && Object.hasOwn(topicsBySection, id)
		? topicsBySection[id]
		: productTopic(title);
}

export function readConsultationContext(
	raw: string,
	legacyEvidence: string,
): ConsultationContext {
	const legacyTopic = productTopic(legacyEvidence) ?? "general";
	const fallback: ConsultationContext = {
		active: legacyTopic,
		evidence: legacyEvidence ? { [legacyTopic]: legacyEvidence } : {},
	};
	try {
		const stored = JSON.parse(raw);
		const valid: Topic[] = ["general", ...topics];
		if (!valid.includes(stored?.active)) return fallback;
		return {
			active: stored.active,
			evidence: Object.fromEntries(
				valid.flatMap((topic) => {
					const line = stored.evidence?.[topic];
					return typeof line === "string" && line.length <= 800 ? [[topic, line]] : [];
				}),
			),
		};
	} catch {
		return fallback;
	}
}

export function refersToProduct(text: string) {
	const reference =
		/(?:\b(?:they|them|their|these|those|it|its|this model)\b|\b(?:ihnen|ihre|diese|dieses|damit|davon)\b|^\s*(?:a co|a lze|a má|a můž)|(?<!\p{L})(?:tohle|tohoto|jejich|které z nich|они|их|у них|эти|этот|этого|это|вони|їх|у них|цей|ці|цього|це)(?!\p{L}))/iu;
	const continuation = /^\s*(?:and|how about|what about|und|wie wäre|a|а|і|та)(?!\p{L})/iu;
	return (
		reference.test(text) ||
		(Boolean(consultationNeed(text)) &&
			(continuation.test(text) || (text.match(/\p{L}+/gu)?.length ?? 0) <= 2))
	);
}

export function clearlyOffTopic(text: string) {
	const shading =
		/(?:\b(?:blinds?|shad(?:e|es|ing)|awnings?|pergolas?|shutters?|screens?|canop(?:y|ies)|gorbach)\b|žaluzi|stíněn|rolet|pergol|markýz|sonnenschutz|jalousi|markise|жалюз|затен|затін|ролет|маркиз|маркіз|сонцезахист|солнцезащит)/iu;
	if (shading.test(text)) return false;
	const animalRequest =
		/(?:\b(?:tell me (?:something )?about|facts about|what (?:do|are)|where (?:do|are)|how (?:do|long do)) (?:the )?(?:cats?|dogs?|whales?|dolphins?|penguins?|elephants?|animals?)\b|(?:расскаж(?:и|ите)|розкаж(?:и|іть)|расскажи мне|розкажи мені) (?:что-нибудь |щось )?(?:мне |мені )?(?:про|о) (?:кош|кот|собак|животн|тварин|котів|кіш|псів|дельфін|дельфин|пінгвін|пингвин)|(?:что едят|чем питаются|где живут|що їдять|чим харчуються|де живуть) (?:кош|кот|собак|кит|дельфин|дельфін|пінгвін|пингвин)|(?:rekn|řekn|pověz|jak dlouho|co žerou|co jedí)\p{L}*(?:\s+\p{L}+){0,3}\s+(?:kočk|ps[ie]|zvíř)|(?:erzähl|erzähle|was fressen|wo leben)\p{L}*(?:\s+\p{L}+){0,3}\s+(?:katz|hund|tier))/iu;
	const outsideSales =
		/(?:\b(?:bitcoin|ethereum|cryptocurrency|football match|sports scores?|weather forecast|recipe for)\b|биткоин|біткоїн|футбольн[а-яіїє]* матч|прогноз погод|рецепт (?:пицц|піци)|předpověď počasí|fotbalov[ýé] zápas|wettervorhersage|fußballspiel)/iu;
	return animalRequest.test(text) || outsideSales.test(text);
}

export function consultationNeed(text: string) {
	if (
		/(?:\b(?:motori[sz]|motor|automat|remote control)\w*|ovládán|motoriz|fernsteuer|motoris|elektrisch|мотор|электропривод|електропривід|електропривод|управлен|автомат|керуван)/iu.test(
			text,
		)
	)
		return "controls";
	if (
		/(?:\b(?:install|mount|retrofit)\w*|montáž|montuj|instalac|einbau|montier|монтаж|установ|встанов)/iu.test(
			text,
		)
	)
		return "installation";
}
