import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateRevision } from "../src/lib/validate-revision.ts";

const datasets = ["knowledge", "survey"].map((kind) => {
	const file = new URL("../data/initial/" + kind + ".json", import.meta.url);
	return [kind, JSON.stringify(validateRevision(kind, readFileSync(file, "utf8")))];
});
const directory = process.env.GORBACH_DATA_DIR || ".gorbach";
mkdirSync(directory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(directory, "admin.sqlite"));
try {
	db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
	db.exec(
		"CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,content TEXT NOT NULL,editor TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP)",
	);
	const insert = db.prepare(
		"INSERT INTO revisions(kind,content,editor) SELECT ?,?,'initial-import' WHERE NOT EXISTS (SELECT 1 FROM revisions WHERE kind=?)",
	);
	const results = datasets.map(([kind, content]) => [
		kind,
		insert.run(kind, content, kind).changes,
	]);
	db.exec("COMMIT");
	for (const [kind, changes] of results)
		console.log(kind, changes ? "imported" : "already has revisions; skipped");
} finally {
	db.close();
}
