import { createHash, randomBytes } from "node:crypto";
import { closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "./admin";
import {
	attachmentPath,
	expiryCutoff,
	fileLimits,
	writeTransaction,
} from "./attachments";
import { ApiError, attachmentContext } from "./quote";

const formats = {
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	heic: "image/heic",
	pdf: "application/pdf",
	mp4: "video/mp4",
	mov: "video/quicktime",
};
function detectFormat(bytes: Buffer): keyof typeof formats | undefined {
	const tag = (offset: number) => bytes.toString("latin1", offset, offset + 4);
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
	if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
	if (bytes.toString("latin1", 0, 5) === "%PDF-") return "pdf";
	if (tag(0) === "RIFF" && tag(8) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(tag(12)))
		return "webp";
	if (bytes.length < 16 || tag(4) !== "ftyp") return;
	const end = bytes.readUInt32BE(0);
	if (end < 16 || end > bytes.length || end % 4 !== 0) return;
	const major = tag(8);
	const heic = /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs)$/;
	if (heic.test(major)) return "heic";
	if (major === "mif1" || major === "msf1") {
		for (let i = 16; i < end; i += 4) if (heic.test(tag(i))) return "heic";
		return;
	}
	if (major === "qt  ") return "mov";
	if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(major)) return "mp4";
}

// Bound the entire multipart envelope, including requests without Content-Length,
// before asking the native parser to buffer the parts.
export async function readUpload(req: Request) {
	const contentType = req.headers.get("content-type") ?? "";
	if (!req.body || !/^multipart\/form-data\s*;/i.test(contentType))
		throw new ApiError(400, "invalid_body");
	const cap = fileLimits.size + 64 * 1024;
	if (Number(req.headers.get("content-length")) > cap) throw new ApiError(413, "size");
	const reader = req.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.length;
			if (length > cap) {
				await reader.cancel();
				throw new ApiError(413, "size");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	let form: FormData;
	try {
		form = await new Response(Buffer.concat(chunks, length), {
			headers: { "Content-Type": contentType },
		}).formData();
	} catch {
		throw new ApiError(400, "invalid_body");
	}
	const file = form.get("file");
	if (
		form.getAll("sid").length !== 1 ||
		form.getAll("file").length !== 1 ||
		!file ||
		typeof file === "string"
	)
		throw new ApiError(400, "invalid_body");
	if (file.size > fileLimits.size) throw new ApiError(413, "size");
	return {
		sid: form.get("sid"),
		name: path.win32.basename(file.name),
		bytes: Buffer.from(await file.arrayBuffer()),
	};
}

export function storeUpload(sid: string, name: string, bytes: Buffer) {
	const format = detectFormat(bytes);
	const extension = path.extname(name).toLowerCase().slice(1);
	if (
		!format ||
		!name ||
		(extension &&
			extension !== format &&
			!(extension === "jpeg" && format === "jpg") &&
			!(extension === "heif" && format === "heic"))
	)
		throw new ApiError(400, "type");
	const sql = db();
	const digest = createHash("sha256").update(bytes).digest("hex");
	const id = randomBytes(16).toString("hex"),
		storageName = randomBytes(16).toString("hex");
	let createdPath: string | undefined;
	try {
		return writeTransaction(sql, () => {
			const dialog = sql.prepare("SELECT lang FROM dialogs WHERE id=?").get(sid);
			if (!dialog) throw new ApiError(404, "unknown_session");
			const usage = sql
				.prepare(
					"SELECT count(*) AS count,coalesce(sum(size),0) AS total FROM files WHERE dialog=? AND created>?",
				)
				.get(sid, expiryCutoff())!;
			if (Number(usage.count) >= fileLimits.count) throw new ApiError(400, "count");
			if (Number(usage.total) + bytes.length > fileLimits.total)
				throw new ApiError(400, "total");
			const instance = sql.prepare("SELECT 1 FROM leads WHERE dialog=?").get(sid)
				? null
				: (attachmentContext(sid, String(dialog.lang))?.instance ?? null);
			const filename = attachmentPath(storageName);
			const fd = openSync(filename, "wx", 0o600);
			createdPath = filename;
			try {
				writeFileSync(fd, bytes);
			} finally {
				closeSync(fd);
			}
			sql
				.prepare(
					"INSERT INTO files(id,dialog,name,storage_name,mime,sha256,size,created,field_instance) VALUES(?,?,?,?,?,?,?,?,?)",
				)
				.run(
					id,
					sid,
					name,
					storageName,
					formats[format],
					digest,
					bytes.length,
					Date.now(),
					instance,
				);
			return { file: { id, name, size: bytes.length } };
		});
	} catch (error) {
		if (createdPath) rmSync(createdPath, { force: true });
		throw error;
	}
}
