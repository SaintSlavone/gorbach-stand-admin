"use server";
import { redirect } from "next/navigation";
import { db, staff, authenticate, signOut, revision } from "@/lib/admin";
export async function submit(form: FormData) {
	const value = (key: string) => String(form.get(key) ?? "");
	const lang = value("lang") === "ru" ? "ru" : "cs";
	const section = value("section");
	const url = "/admin?lang=" + lang + "&section=" + encodeURIComponent(section);
	const action = value("action");
	if (action === "login") {
		const ok = await authenticate(value("login").trim(), value("password"));
		redirect(url + (ok ? "" : "&error=login"));
	}
	const user = await staff();
	if (!user) redirect("/admin?lang=" + lang);
	if (action === "logout") {
		await signOut();
		redirect("/admin?lang=" + lang);
	}
	if (action === "status" && ["Nová", "V řešení", "Hotovo"].includes(value("status")))
		db().prepare("UPDATE leads SET status=? WHERE id=?").run(value("status"), value("id"));
	if (action === "delete" && value("confirm") === "yes")
		db()
			.prepare("DELETE FROM dialogs WHERE id=(SELECT dialog FROM leads WHERE id=?)")
			.run(value("id"));
	if (action === "knowledge" || action === "survey") {
		let data;
		try {
			data = JSON.parse(value("content"));
			if (action === "knowledge") {
				if (
					!Array.isArray(data) ||
					!data.every(
						(s) =>
							s &&
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
								f.follow &&
								!Object.entries(f.follow).every(
									([choice, targets]) =>
										f.chips?.includes(choice) &&
										Array.isArray(targets) &&
										targets.every((id) => ids.has(id)),
								)
							)
								throw Error();
						}
					}
				}
			}
		} catch {
			redirect(url + "&error=invalid");
		}
		const result = db()
			.prepare(
				"INSERT INTO revisions(kind,content,editor) SELECT ?,?,? WHERE COALESCE((SELECT MAX(id) FROM revisions WHERE kind=?),0)=?",
			)
			.run(action, JSON.stringify(data), user, action, Number(value("version")));
		if (!result.changes) redirect(url + "&error=conflict");
	}
	redirect(url + "&saved=1");
}
