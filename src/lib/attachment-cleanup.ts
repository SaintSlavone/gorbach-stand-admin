import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "./admin";
import { cleanAttachments, dataDirectory } from "./attachments";

export function startAttachmentCleanup() {
	const run = () => {
		try {
			if (existsSync(path.join(dataDirectory(), "admin.sqlite"))) cleanAttachments(db());
		} catch {
			console.error("attachment_cleanup_failed");
		}
	};
	run();
	setInterval(run, 86400000).unref();
}
