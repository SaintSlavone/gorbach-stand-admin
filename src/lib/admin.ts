import { ensureRevisionSchema } from "./revision-schema";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

let connection: DatabaseSync | undefined;
export function db() {
	if (connection) return connection;
	const dir = process.env.GORBACH_DATA_DIR || path.join(process.cwd(), ".gorbach");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const database = new DatabaseSync(path.join(dir, "admin.sqlite"));
	database.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS staff(login TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,login TEXT REFERENCES staff(login) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS dialogs(id TEXT PRIMARY KEY,lang TEXT NOT NULL,page TEXT NOT NULL,created TEXT NOT NULL,product TEXT DEFAULT '',start_chip TEXT DEFAULT '',exit_field TEXT DEFAULT '',knowledge_version INTEGER);
 CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,dialog TEXT REFERENCES dialogs(id) ON DELETE CASCADE,role TEXT NOT NULL,body TEXT NOT NULL,unknown INTEGER DEFAULT 0,cost REAL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,dialog TEXT UNIQUE NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,kind TEXT NOT NULL,product TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Nová',created TEXT NOT NULL,contact TEXT NOT NULL,summary TEXT NOT NULL,fields TEXT DEFAULT '{}',delivery TEXT DEFAULT '');
 CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,dialog TEXT NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,name TEXT NOT NULL,bytes BLOB NOT NULL);`);
	database.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
	try {
		ensureRevisionSchema(database);
		if (
			!database
				.prepare("PRAGMA table_info(dialogs)")
				.all()
				.some((c) => c.name === "utm")
		)
			database.exec("ALTER TABLE dialogs ADD COLUMN utm TEXT NOT NULL DEFAULT '{}'");
		if (
			!database
				.prepare("PRAGMA table_info(messages)")
				.all()
				.some((c) => c.name === "chips")
		)
			database.exec("ALTER TABLE messages ADD COLUMN chips TEXT NOT NULL DEFAULT '[]'");
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		database.close();
		throw error;
	}
	connection = database;
	return database;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export async function staff() {
	const token = (await cookies()).get("gz_admin")?.value;
	return token
		? (db()
				.prepare("SELECT login FROM sessions WHERE token=? AND expires>?")
				.get(digest(token), Date.now())?.login as string | undefined)
		: undefined;
}
export async function authenticate(login: string, password: string) {
	const row = db().prepare("SELECT salt,hash FROM staff WHERE login=?").get(login);
	const hash = scryptSync(password, String(row?.salt || "unregistered"), 64);
	if (!row || !timingSafeEqual(hash, Buffer.from(String(row.hash), "hex"))) return false;
	const token = randomBytes(32).toString("hex");
	const age = 8 * 3600;
	db().prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
	db()
		.prepare("INSERT INTO sessions VALUES(?,?,?)")
		.run(digest(token), login, Date.now() + age * 1000);
	(await cookies()).set("gz_admin", token, {
		httpOnly: true,
		secure: true,
		sameSite: "strict",
		path: "/",
		maxAge: age,
	});
	return true;
}
export async function signOut() {
	const jar = await cookies();
	db()
		.prepare("DELETE FROM sessions WHERE token=?")
		.run(digest(jar.get("gz_admin")?.value || ""));
	jar.delete("gz_admin");
}
export function revision(kind: string) {
	return db()
		.prepare("SELECT * FROM revisions WHERE kind=? ORDER BY id DESC LIMIT 1")
		.get(kind);
}
