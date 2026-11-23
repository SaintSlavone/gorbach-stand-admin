# Gorbach stand and admin

Use Node.js 24, run `npm ci` and `npm run dev`, then open the stand at `/` or the staff workspace at `/admin`. Use `npm run build` and `npm start` for production.

## Test the chat widget

Public mode is enabled by default. To restrict access to preview mode, set `GORBACH_CHAT_PUBLIC=false` and restart the app. Open `/#gzbot` on the stand to enable preview mode in your browser. The browser remembers this setting across reloads. Open `/#gzbot-off` to turn preview mode off. To show the launcher to everyone without a preview link, set `GORBACH_CHAT_PUBLIC=true` in the server environment and restart the app.

### Browser smoke test

1. Open `/` in a fresh browser session, then open the chat launcher.
2. Send a distinctive message and wait for the reply.
3. Reload the page in the same browser. Reopen the chat and confirm that your message and the reply are both visible in order.
4. Open `/admin` and sign in with a staff account. Select **Rozhovory** (conversations), search for your message, and open the matching dialog to verify the same exchange.

## Staff access

Set `GORBACH_STAFF_PASSWORD` privately in the shell environment, run `node scripts/add-staff.mjs LOGIN` once per employee, then clear the environment variable. Passwords require at least 4 characters. Use HTTPS in deployment. Localhost supports the secure session cookie for development.

The app and provisioning command use the same SQLite database in `.gorbach/` by default. Set `GORBACH_DATA_DIR` to a persistent private directory to override it. Admin lists and statistics read the database directly. The chat service must populate dialogs, messages, files and leads. At conversation creation it must pin the current knowledge revision in `dialogs.knowledge_version` and use that revision throughout the conversation. Questionnaire versions use the products and services groups from section 6 of the technical brief.

## Chat attachments

Send multipart form data with the dialog’s `sid` and one `file` to `POST /api/file`. A successful response contains `file.id`, `file.name`, and `file.size` in bytes. The API checks file signatures for JPEG, PNG, WebP, HEIC, PDF, MP4, and MOV. A conflicting filename extension is rejected.

Set upload limits in `config/files.json` and restart the service. The defaults allow 10 MiB per file, five files per dialog, and 30 MiB in total per dialog. Validation errors use the keys `type`, `size`, `count`, and `total`.

Back up the SQLite database together with the `attachments` directory under `GORBACH_DATA_DIR`. Signed-in staff can download attachments from the lead card. Deleting a lead removes its dialog and attachments. The service cleans expired files on startup and daily while running. Downloads expire at the configured age (180 days by default). Existing SQLite attachments retain their IDs and download links. Their retention period starts at migration because the legacy records have no upload timestamp.

## Initial knowledge and questionnaires

From the project root with Node.js 24, run `npm run import:initial`. Use the same `GORBACH_DATA_DIR` as the app. The command validates both JSON files in `data/initial/` with the admin save validator (knowledge text limit 160,000 characters). It initializes missing revision kinds in one transaction. Any existing history, including staff edits, takes precedence. After updating the seed files, run `npm run import:initial -- --upgrade` to append changed content for datasets whose latest revision is still an import. Revisions created before provenance was recorded also require a manual merge, even when the editor is named `initial-import`. Staff revisions require a manual merge in the editor. Previous revisions and existing conversation pins are preserved. Edit subsequent revisions in **Znalosti** and **Dotazník**.

The partial seed comes from developer specification sections 3 and 6: seven product names, contact routing, six service categories, and the explicitly written exterior-blinds window-count question. Empty field lists mark categories awaiting source material. Completing the content requires `source/klient-ai-web-consultant.md` (blind dimensions, Sběr poptávky, Servis and Čištění) and `TZ.md` (especially service prices in §4.6 and questionnaires in §5). Construction-stage follow-ups and motorized-awning sensor branches require their original questions, priorities and options. Additional Czech knowledge sections summarize the client’s published [service prices](https://gorbach-zaluzie.cz/servis/), [partnership information](https://gorbach-zaluzie.cz/spoluprace/), [contacts](https://gorbach-zaluzie.cz/kontakt/) and [cleaning service](https://gorbach-zaluzie.cz/service/cisteni-zaluzii/).

Questionnaire product titles use the dialog language from `title` (for example, `title.en`). A field can supply `translations.en.q` and a `translations.en.chips` object mapping its original chip values to English labels. The original question and chip values supply Czech fallback text. Use the same structure for other dialog languages.

## Gemini knowledge answers

Set `GEMINI_API_KEY` and `GEMINI_MODEL` in the server environment (or an untracked `.env.local`) and restart the app. Use the project’s billed Gemini API key and a generateContent model ID supporting structured JSON output. Use a bare model ID, without the `models/` prefix. Keep these settings server-side.

Import knowledge before starting a conversation. General chat follows the visitor’s latest clear language in Czech, English, German, Russian or Ukrainian. Ambiguous input uses the conversation’s saved language, and active questionnaires and contact collection keep their current language. Gemini receives the redacted question, the number of current attachments and sections from the pinned knowledge revision. Each section may specify its source language in `lang`. Untagged sections use Czech. The app requires an exact, complete evidence line and returns it verbatim when it is already in the reply language. For another language, Gemini separately checks that the translation preserves the source facts and qualifications. Translations that change numbers or expose contact details are rejected. Missing knowledge, missing configuration, unsupported answers and provider failures produce localized fallbacks. The 15-second request deadline covers answer selection, any retry and translation verification.

Gemini reserves each provider attempt (including a retry) in SQLite before sending it. Each dialog and client IP has 12 attempts per rolling minute. The site-wide default is 1,500 attempts per Prague calendar day; set `GORBACH_DAY_LIMIT_MSGS` to a nonnegative integer to override it. Zero disables paid requests. Provider failures consume their reservation. Quote turns do not consume this budget.

Behind a trusted reverse proxy, configure it to overwrite `X-Real-IP` with the actual client address, restrict direct access to the app, then set `GORBACH_TRUST_PROXY=true`. The app hashes validated addresses. Without that configuration, or if an address is missing or invalid, requests share a conservative IP bucket. Visitor email addresses, phone patterns, URLs and identifying introduction clauses are filtered from the outbound question; the local transcript retains the original.

## Questionnaire attachment confirmation

Upload with multipart POST /api/file first. Then confirm the returned file ID using POST /api/msg with {"sid":"…","files":["file-id"]} for a file field, or {"sid":"…","text":"description","files":["file-id"]} for text+file. Uploading alone does not advance the survey. The existing skip chip remains available.

Survey responses expose attachmentField with id and type while a file question is active, and attachmentAnswers as product entries with a fields map from field ID to attachment IDs. History restores these values. Confirmed references are also stored in each review product's attachments map. Required references are checked again on submission. Expired or foreign references return invalid_attachment during confirmation, or incomplete during submission.

An unsubmitted questionnaire with an expired required attachment exposes
attachmentRecovery with product and field IDs in history and message responses.
The response supplies the affected attachmentField and question, with review set
to null. Upload a replacement and confirm it through the usual /api/msg files
contract (include text again for text+file). Recovery proceeds through affected
fields in questionnaire order, then restores the prior step or review. Other
answers, contacts, and the pinned revision are retained. Submitted leads keep
their original idempotent submission response.
