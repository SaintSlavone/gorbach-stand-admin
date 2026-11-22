import type { DatabaseSync } from "node:sqlite";

// Run inside the startup schema transaction. Older service flows copied the
// category into the product columns as well as the questionnaire snapshot.
export function migrateServiceProducts(db: DatabaseSync) {
	if (Number(db.prepare("PRAGMA user_version").get()?.user_version) >= 1) return;
	db.exec(`
		UPDATE leads SET product = ''
		WHERE product <> '' AND product = kind AND json_valid(fields)
			AND json_extract(fields, '$.serviceKind') = kind;
		UPDATE dialogs SET product = ''
		FROM quote_sessions AS survey
		WHERE dialogs.id = survey.dialog AND dialogs.start_chip = 'service'
			AND dialogs.product <> '' AND json_valid(survey.state)
			AND json_extract(survey.state, '$.intake') = 'service'
			AND json_extract(survey.state, '$.items[0].product') = dialogs.product;
		PRAGMA user_version = 1;
	`);
}
