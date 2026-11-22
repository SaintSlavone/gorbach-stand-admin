import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	attachmentPath,
	cleanAttachments,
	deleteLead,
	ensureAttachmentSchema,
	fileLimits,
} from "../src/lib/attachments.ts";

test("migrate legacy blobs and remove expired, deleted and orphaned files", (t) => {
	const dir = mkdtempSync(path.join(tmpdir(), "gorbach-retention-"));
	const oldDir = process.env.GORBACH_DATA_DIR;
	process.env.GORBACH_DATA_DIR = dir;
	const sql = new DatabaseSync(":memory:");
	t.after(() => {
		sql.close();
		if (oldDir === undefined) delete process.env.GORBACH_DATA_DIR;
		else process.env.GORBACH_DATA_DIR = oldDir;
		rmSync(dir, { recursive: true, force: true });
	});
	sql.exec(`PRAGMA foreign_keys=ON;
		CREATE TABLE dialogs(id TEXT PRIMARY KEY);
		CREATE TABLE leads(id TEXT PRIMARY KEY, dialog TEXT REFERENCES dialogs ON DELETE CASCADE);
		CREATE TABLE files(id TEXT PRIMARY KEY, dialog TEXT REFERENCES dialogs ON DELETE CASCADE, name TEXT NOT NULL, bytes BLOB NOT NULL);
		INSERT INTO dialogs VALUES('old'),('keep');
		INSERT INTO leads VALUES('lead','old');
		INSERT INTO files VALUES('legacy','old','original.png',x'0102');`);
	ensureAttachmentSchema(sql);
	ensureAttachmentSchema(sql);
	const legacy = sql.prepare("SELECT * FROM files WHERE id='legacy'").get();
	assert.equal(legacy.name, "original.png");
	assert.equal(legacy.size, 2);
	assert.deepEqual([...legacy.bytes], [1, 2]);
	const now = Date.now();
	t.mock.method(Date, "now", () => now);
	const insert = sql.prepare(
		"INSERT INTO files(id,dialog,name,storage_name,size,created) VALUES(?,?,?,?,1,?)",
	);
	const settings = JSON.parse(readFileSync(path.resolve("config/files.json"), "utf8"));
	assert.equal(fileLimits.retention, settings.keep_days * 86400000);
	const cutoff = now - fileLimits.retention;
	const paths = ["a", "b", "c", "d"].map((c) => attachmentPath(c.repeat(32)));
	for (const file of paths) writeFileSync(file, "x");
	insert.run("expired", "keep", "expired.png", "a".repeat(32), cutoff);
	insert.run("active", "keep", "active.png", "b".repeat(32), cutoff + 1);
	insert.run("delete", "old", "delete.png", "c".repeat(32), now);
	cleanAttachments(sql);
	assert.deepEqual(
		paths.map((p) => existsSync(p)),
		[false, true, true, false],
	);
	deleteLead(sql, "lead");
	assert.deepEqual(
		paths.map((p) => existsSync(p)),
		[false, true, false, false],
	);
	assert.deepEqual(
		sql
			.prepare("SELECT id FROM files")
			.all()
			.map((f) => f.id),
		["active"],
	);
});
