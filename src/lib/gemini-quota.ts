import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { db } from "./admin";

const pragueDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" });

export function clientBucket(request: Request) {
	const address =
		process.env.GORBACH_TRUST_PROXY === "true" ? request.headers.get("x-real-ip") : "";
	if (!address || !isIP(address)) return "shared";
	const canonical =
		isIP(address) === 6 ? new URL("http://[" + address + "]").hostname : address;
	return createHash("sha256").update(canonical).digest("hex");
}

// Caller holds BEGIN IMMEDIATE for the check and reservation, never for the fetch.
export function reserveGeminiAttempt(sid: string, ip: string) {
	const now = Date.now(),
		day = pragueDay.format(now),
		since = now - 60000;
	const limit = Number(process.env.GORBACH_DAY_LIMIT_MSGS ?? 1500);
	const sql = db();
	sql.prepare("DELETE FROM gemini_attempts WHERE day < ? AND time <= ?").run(day, since);
	const daily = sql
		.prepare("SELECT COUNT(*) AS n FROM gemini_attempts WHERE day=?")
		.get(day)!;
	if (!Number.isSafeInteger(limit) || Number(daily.n) >= limit) return "daily";
	for (const [query, value] of [
		["SELECT COUNT(*) AS n FROM gemini_attempts WHERE sid=? AND time>? ", sid],
		["SELECT COUNT(*) AS n FROM gemini_attempts WHERE ip=? AND time>? ", ip],
	]) {
		if (Number(sql.prepare(query).get(value, since)?.n) >= 12) return "minute";
	}
	sql
		.prepare("INSERT INTO gemini_attempts(day,time,sid,ip) VALUES(?,?,?,?)")
		.run(day, now, sid, ip);
	return "allowed";
}
