# Gorbach stand and admin

Use Node.js 24, run `npm ci` and `npm run dev`, then open the stand at `/` or the staff workspace at `/admin`. Use `npm run build` and `npm start` for production.

## Staff access

Set `GORBACH_STAFF_PASSWORD` privately in the shell environment, run `node scripts/add-staff.mjs LOGIN` once per employee, then clear the environment variable. Passwords require at least 4 characters. Use HTTPS in deployment. Localhost supports the secure session cookie for development.

The app and provisioning command use the same SQLite database in `.gorbach/` by default. Set `GORBACH_DATA_DIR` to a persistent private directory to override it. Admin lists and statistics read the database directly. The chat service must populate dialogs, messages, files and leads. At conversation creation it must pin the current knowledge revision in `dialogs.knowledge_version` and use that revision throughout the conversation. Questionnaire versions use the products and services groups from section 6 of the technical brief.
