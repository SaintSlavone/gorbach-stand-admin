import { db, staff } from "@/lib/admin";
import { readFileSync } from "node:fs";
import { attachmentPath, expiryCutoff } from "@/lib/attachments";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!(await staff())) return new Response(null, { status: 401 });
	const file = db()
		.prepare("SELECT name,bytes,storage_name FROM files WHERE id=? AND created>?")
		.get((await params).id, expiryCutoff());
	if (!file) return new Response(null, { status: 404 });
	let bytes;
	try {
		bytes = file.storage_name
			? readFileSync(attachmentPath(String(file.storage_name)))
			: Buffer.from(file.bytes as Uint8Array);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return new Response(null, { status: 404 });
		throw error;
	}
	return new Response(bytes, {
		headers: {
			"Cache-Control": "private, no-store",
			"Content-Type": "application/octet-stream",
			"X-Content-Type-Options": "nosniff",
			"Content-Disposition":
				"attachment; filename*=UTF-8''" +
				encodeURIComponent(String(file.name)).replace(
					/['()*]/g,
					(c) => "%" + c.charCodeAt(0).toString(16),
				),
		},
	});
}
