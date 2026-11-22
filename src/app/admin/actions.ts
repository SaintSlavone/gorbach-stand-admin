"use server";
import { validateRevision } from "@/lib/validate-revision";
import { redirect } from "next/navigation";
import { db, staff, authenticate, signOut } from "@/lib/admin";
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
			data = validateRevision(action, value("content"));
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
