import type { DatabaseSync } from "node:sqlite";

// Both entry points call this inside their schema transaction.
export function ensureRevisionSchema(db: DatabaseSync) {
	db.exec(
		"CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,content TEXT NOT NULL,editor TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP)",
	);
	if (
		!db
			.prepare("PRAGMA table_info(revisions)")
			.all()
			.some((column) => column.name === "provenance")
	) {
		db.exec(
			"ALTER TABLE revisions ADD COLUMN provenance TEXT NOT NULL DEFAULT 'legacy' CHECK(provenance IN ('legacy','staff','import'))",
		);
	}
}
