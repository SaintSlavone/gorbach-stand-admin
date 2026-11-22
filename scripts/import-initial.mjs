import { ensureRevisionSchema } from "../src/lib/revision-schema.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateRevision } from "../src/lib/validate-revision.ts";

import { isDeepStrictEqual, parseArgs } from "node:util";
const {
	values: { upgrade },
} = parseArgs({ options: { upgrade: { type: "boolean", default: false } } });
const datasets = ["knowledge", "survey"].map((kind) => {
	const file = new URL("../data/initial/" + kind + ".json", import.meta.url);
	return [kind, JSON.stringify(validateRevision(kind, readFileSync(file, "utf8")))];
});
const directory = process.env.GORBACH_DATA_DIR || ".gorbach";
mkdirSync(directory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(directory, "admin.sqlite"));
try {
	db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
	ensureRevisionSchema(db);
	const latest = db.prepare(
		"SELECT content,provenance FROM revisions WHERE kind=? ORDER BY id DESC LIMIT 1",
	);
	const insert = db.prepare(
		"INSERT INTO revisions(kind,content,editor,provenance) VALUES(?,?,'initial-import','import')",
	);
	const results = datasets.map(([kind, content]) => {
		const current = latest.get(kind);
		if (current) {
			if (current.provenance !== "import")
				return [kind, current.provenance + " revision; manual merge required"];
			if (!upgrade) return [kind, "already imported; skipped"];
			if (isDeepStrictEqual(JSON.parse(current.content), JSON.parse(content)))
				return [kind, "unchanged"];
		}
		insert.run(kind, content);
		return [kind, current ? "upgraded" : "imported"];
	});
	db.exec("COMMIT");
	for (const [kind, status] of results) console.log(kind, status);
} finally {
	db.close();
}
