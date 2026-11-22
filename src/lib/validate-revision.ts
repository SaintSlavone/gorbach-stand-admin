export const knowledgeLanguages = {
	cs: "Čeština",
	en: "English",
	de: "Deutsch",
	ru: "Русский",
	uk: "Українська",
};
export function knowledgeLanguage(value: unknown) {
	if (value === undefined) return "cs";
	return typeof value === "string" && Object.hasOwn(knowledgeLanguages, value)
		? (value as keyof typeof knowledgeLanguages)
		: null;
}
export function validateRevision(action: "knowledge" | "survey", content: string) {
	const data = JSON.parse(content);
	if (action === "knowledge") {
		if (
			!Array.isArray(data) ||
			!data.every(
				(s) =>
					s &&
					knowledgeLanguage(s.lang) !== null &&
					typeof s.id === "string" &&
					s.id.trim() &&
					typeof s.title === "string" &&
					s.title.trim() &&
					typeof s.text === "string",
			) ||
			new Set(data.map((s) => s.id)).size !== data.length ||
			data.reduce((n, s) => n + s.text.length, 0) > 160000
		)
			throw Error();
	} else {
		for (const key of ["products", "services"]) {
			const group = data[key];
			if (!group || typeof group !== "object" || Array.isArray(group)) throw Error();
			for (const item of Object.values(group) as {
				fields: {
					id: string;
					q: string;
					type: string;
					priority: string;
					chips?: string[];
					follow?: Record<string, string[]>;
					only_if?: string;
				}[];
			}[]) {
				if (!Array.isArray(item.fields)) throw Error();
				const ids = new Set(item.fields.map((f) => f.id));
				if (ids.size !== item.fields.length) throw Error();
				for (const f of item.fields) {
					if (
						(f.only_if !== undefined && f.only_if !== "follow") ||
						typeof f.id !== "string" ||
						!f.id.trim() ||
						typeof f.q !== "string" ||
						!f.q.trim() ||
						!["number", "choice", "multi", "text", "file", "text+file"].includes(f.type) ||
						!["required", "recommended", "optional"].includes(f.priority)
					)
						throw Error();
					if (
						f.chips !== undefined &&
						(!Array.isArray(f.chips) ||
							!f.chips.every((x) => typeof x === "string" && x.trim()))
					)
						throw Error();
					if (["choice", "multi"].includes(f.type) && !f.chips?.length) throw Error();
					if (
						f.follow !== undefined &&
						(f.follow === null ||
							typeof f.follow !== "object" ||
							Array.isArray(f.follow) ||
							!Object.entries(f.follow).every(
								([choice, targets]) =>
									f.chips?.includes(choice) &&
									Array.isArray(targets) &&
									targets.every((id) => ids.has(id)),
							))
					)
						throw Error();
				}
				const fieldsById = new Map(item.fields.map((field) => [field.id, field]));
				const reachable = new Set(
					item.fields.filter((field) => field.only_if === undefined).map((field) => field.id),
				);
				// Set iteration also visits targets discovered along nested branches.
				for (const id of reachable) {
					const field = fieldsById.get(id)!;
					for (const targets of Object.values(field.follow ?? {})) {
						for (const target of targets) reachable.add(target);
					}
				}
				if (reachable.size !== item.fields.length)
					throw Error("Unreachable conditional questionnaire field");
			}
		}
	}
	return data;
}
