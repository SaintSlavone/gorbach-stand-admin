import type { DatabaseSync } from "node:sqlite";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	unlinkSync,
} from "node:fs";
import path from "node:path";

export const dataDirectory = () =>
	path.resolve(process.env.GORBACH_DATA_DIR || ".gorbach");

function loadLimits() {
	const settings = JSON.parse(readFileSync(path.resolve("config/files.json"), "utf8"));
	for (const key of ["max_mb", "max_count", "max_total_mb", "keep_days"]) {
		if (!Number.isSafeInteger(settings[key]) || settings[key] < 1)
			throw new Error("invalid_file_settings");
	}
	return {
		size: settings.max_mb * 1048576,
		count: Number(settings.max_count),
		total: settings.max_total_mb * 1048576,
		retention: settings.keep_days * 86400000,
	};
}
export const fileLimits = loadLimits();
export const expiryCutoff = () => Date.now() - fileLimits.retention;

const generatedName = /^[0-9a-f]{32}$/;
export function attachmentDirectory() {
	const dir = path.join(dataDirectory(), "attachments");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const resolved = realpathSync(dir);
	const relative = path.relative(realpathSync("public"), resolved);
	if (
		relative === "" ||
		!(
			relative.startsWith(".." + path.sep) ||
			relative === ".." ||
			path.isAbsolute(relative)
		)
	)
		throw new Error("public_attachment_directory");
	return resolved;
}
export function attachmentPath(name: string) {
	if (!generatedName.test(name)) throw new Error("invalid_storage_name");
	return path.join(attachmentDirectory(), name);
}

export function ensureAttachmentSchema(sql: DatabaseSync) {
	if (
		!sql
			.prepare("PRAGMA table_info(files)")
			.all()
			.some((c) => c.name === "storage_name")
	) {
		sql.exec(`ALTER TABLE files RENAME TO legacy_files;
			CREATE TABLE files(
				id TEXT PRIMARY KEY, dialog TEXT NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,
				name TEXT NOT NULL, bytes BLOB, storage_name TEXT UNIQUE, mime TEXT, sha256 TEXT,
				size INTEGER NOT NULL, created INTEGER NOT NULL,
				CHECK ((storage_name IS NULL) <> (bytes IS NULL))
			);
			INSERT INTO files(id,dialog,name,bytes,size,created)
				SELECT id,dialog,name,bytes,length(bytes),unixepoch()*1000 FROM legacy_files;
			DROP TABLE legacy_files;
			CREATE INDEX files_by_dialog ON files(dialog);
			CREATE INDEX files_by_age ON files(created);`);
	}
}

export function writeTransaction<T>(sql: DatabaseSync, work: () => T) {
	sql.exec("BEGIN IMMEDIATE");
	try {
		const result = work();
		sql.exec("COMMIT");
		return result;
	} catch (error) {
		sql.exec("ROLLBACK");
		throw error;
	}
}

// Only generated names absent from committed metadata can be removed. Holding the
// writer lock also protects an upload between its exclusive create and its commit.
export function cleanAttachments(sql: DatabaseSync) {
	sql.prepare("DELETE FROM files WHERE created<=?").run(expiryCutoff());
	if (!existsSync(path.join(dataDirectory(), "attachments"))) return;
	writeTransaction(sql, () => {
		const directory = attachmentDirectory();
		const referenced = sql.prepare("SELECT 1 FROM files WHERE storage_name=?");
		for (const name of readdirSync(directory)) {
			if (generatedName.test(name) && !referenced.get(name))
				unlinkSync(path.join(directory, name));
		}
	});
}
export function deleteLead(sql: DatabaseSync, id: string) {
	sql
		.prepare("DELETE FROM dialogs WHERE id=(SELECT dialog FROM leads WHERE id=?)")
		.run(id);
	cleanAttachments(sql);
}
