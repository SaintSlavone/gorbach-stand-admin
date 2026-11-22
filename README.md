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

From the project root with Node.js 24, run `npm run import:initial`. Use the same `GORBACH_DATA_DIR` as the app. The command validates both JSON files in `data/initial/` with the admin save validator (knowledge text limit 160,000 characters). It initializes missing revision kinds in one transaction. Any existing history, including staff edits, takes precedence. Edit subsequent revisions in **Znalosti** and **Dotazník**.

The partial seed comes from developer specification sections 3 and 6: seven product names, contact routing, six service categories, and the explicitly written exterior-blinds window-count question. Empty field lists mark categories awaiting source material. Completing the content requires `source/klient-ai-web-consultant.md` (blind dimensions, Sběr poptávky, Servis and Čištění) and `TZ.md` (especially service prices in §4.6 and questionnaires in §5). Construction-stage follow-ups and motorized-awning sensor branches require their original questions, priorities and options. Additional Czech knowledge sections summarize the client’s published [service prices](https://gorbach-zaluzie.cz/servis/), [partnership information](https://gorbach-zaluzie.cz/spoluprace/), [contacts](https://gorbach-zaluzie.cz/kontakt/) and [cleaning service](https://gorbach-zaluzie.cz/service/cisteni-zaluzii/).
