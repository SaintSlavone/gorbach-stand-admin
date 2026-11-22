# Gorbach stand and admin

Use Node.js 24, run `npm ci` and `npm run dev`, then open the stand at `/` or the staff workspace at `/admin`. Use `npm run build` and `npm start` for production.

## Test the chat widget

Public mode is disabled by default. Open `/#gzbot` on the stand to enable preview mode in your browser. The browser remembers this setting across reloads. Open `/#gzbot-off` to turn preview mode off. To show the launcher to everyone without a preview link, set `GORBACH_CHAT_PUBLIC=true` in the server environment and restart the app.

### Browser smoke test

1. Open `/#gzbot`, then open the chat launcher.
2. Send a distinctive message and wait for the reply.
3. Reload the page in the same browser. Reopen the chat and confirm that your message and the reply are both visible in order.
4. Open `/admin` and sign in with a staff account. Select **Rozhovory** (conversations), search for your message, and open the matching dialog to verify the same exchange.

## Staff access

Set `GORBACH_STAFF_PASSWORD` privately in the shell environment, run `node scripts/add-staff.mjs LOGIN` once per employee, then clear the environment variable. Passwords require at least 4 characters. Use HTTPS in deployment. Localhost supports the secure session cookie for development.

The app and provisioning command use the same SQLite database in `.gorbach/` by default. Set `GORBACH_DATA_DIR` to a persistent private directory to override it. Admin lists and statistics read the database directly. The chat service must populate dialogs, messages, files and leads. At conversation creation it must pin the current knowledge revision in `dialogs.knowledge_version` and use that revision throughout the conversation. Questionnaire versions use the products and services groups from section 6 of the technical brief.

## Initial knowledge and questionnaires

From the project root with Node.js 24, run `npm run import:initial`. Use the same `GORBACH_DATA_DIR` as the app. The command validates both JSON files in `data/initial/` with the admin save validator (knowledge text limit 160,000 characters). It initializes missing revision kinds in one transaction. Any existing history, including staff edits, takes precedence. After updating the seed files, run `npm run import:initial -- --upgrade` to append changed content for datasets whose latest revision is still an import. Revisions created before provenance was recorded also require a manual merge, even when the editor is named `initial-import`. Staff revisions require a manual merge in the editor. Previous revisions and existing conversation pins are preserved. Edit subsequent revisions in **Znalosti** and **Dotazník**.

The partial seed comes from developer specification sections 3 and 6: seven product names, contact routing, six service categories, and the explicitly written exterior-blinds window-count question. Empty field lists mark categories awaiting source material. Completing the content requires `source/klient-ai-web-consultant.md` (blind dimensions, Sběr poptávky, Servis and Čištění) and `TZ.md` (especially service prices in §4.6 and questionnaires in §5). Construction-stage follow-ups and motorized-awning sensor branches require their original questions, priorities and options. Additional Czech knowledge sections summarize the client’s published [service prices](https://gorbach-zaluzie.cz/servis/), [partnership information](https://gorbach-zaluzie.cz/spoluprace/), [contacts](https://gorbach-zaluzie.cz/kontakt/) and [cleaning service](https://gorbach-zaluzie.cz/service/cisteni-zaluzii/).

Questionnaire product titles use the dialog language from `title` (for example, `title.en`). A field can supply `translations.en.q` and a `translations.en.chips` object mapping its original chip values to English labels. The original question and chip values supply Czech fallback text. Use the same structure for other dialog languages.

## Gemini knowledge answers

Set `GEMINI_API_KEY` and `GEMINI_MODEL` in the server environment (or an untracked `.env.local`) and restart the app. Use the project’s billed Gemini API key and a generateContent model ID supporting structured JSON output. Use a bare model ID, without the `models/` prefix. Keep these settings server-side.

Import knowledge before starting a conversation. General text uses the revision pinned at conversation creation. Gemini receives the current question and knowledge section titles and text. Email addresses, phone-number patterns and URLs are redacted. The app accepts an extractive answer only when the reply and evidence both match a complete knowledge line. Each section may specify a source language in `lang` (for example, `"en"`). Untagged sections use the Czech seed language. Only sections matching the dialog language are sent and accepted as evidence. If none match, the app returns the localized fallback before contacting Gemini. Missing knowledge, missing configuration, unsupported answers and provider failures produce a localized fallback. The request deadline is 15 seconds including one retry for an invalid structured answer.

Gemini reserves each provider attempt (including a retry) in SQLite before sending it. Each dialog and client IP has 12 attempts per rolling minute. The site-wide default is 1,500 attempts per Prague calendar day; set `GORBACH_DAY_LIMIT_MSGS` to a nonnegative integer to override it. Zero disables paid requests. Provider failures consume their reservation. Quote turns do not consume this budget.

Behind a trusted reverse proxy, configure it to overwrite `X-Real-IP` with the actual client address, restrict direct access to the app, then set `GORBACH_TRUST_PROXY=true`. The app hashes validated addresses. Without that configuration, or if an address is missing or invalid, requests share a conservative IP bucket. Visitor email addresses, phone patterns, URLs and identifying introduction clauses are filtered from the outbound question; the local transcript retains the original.
