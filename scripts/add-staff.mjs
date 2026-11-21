import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
const login = process.argv[2]?.trim();
const password = process.env.GORBACH_STAFF_PASSWORD;
if (!login || !password || Array.from(password).length < 4)
	throw new Error(
		"Supply a login argument and GORBACH_STAFF_PASSWORD of at least 4 characters.",
	);
const dir = process.env.GORBACH_DATA_DIR || ".gorbach";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dir, "admin.sqlite"));
db.exec(
	"CREATE TABLE IF NOT EXISTS staff(login TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL)",
);
const salt = randomBytes(16).toString("hex");
db
	.prepare("INSERT INTO staff VALUES(?,?,?)")
	.run(login, salt, scryptSync(password, salt, 64).toString("hex"));
db.close();
