import { db, staff } from "@/lib/admin";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!(await staff())) return new Response(null, { status: 401 });
	const file = db()
		.prepare("SELECT name,bytes FROM files WHERE id=?")
		.get((await params).id);
	if (!file) return new Response(null, { status: 404 });
	return new Response(Buffer.from(file.bytes as Uint8Array), {
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
