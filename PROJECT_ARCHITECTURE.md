# Project architecture

The stand uses Python's standard library and static HTML, CSS and JavaScript. `server.py` serves the fixed public routes and separates visitor and authenticated staff APIs. `conversation.py` owns persisted visitor sessions and optimistic stateful turns. `flow.py` evaluates pinned quote/service surveys, localization and contact capture. `model.py` builds bounded Gemini requests from company knowledge and redacted recent context.

`crm.py` stores revisioned knowledge, surveys, staff, dialogs, attachments, leads and statistics in SQLite and can open a copy of the old stand database. Knowledge imported through `knowledge.py` is read-only at its source. Once bootstrapped, SQLite is the authority for the admin editor and both widget APIs. Lead submission is idempotent and records a CRM lead after explicit review. The server does not send external notifications.

The static admin shell is in `public/admin/`. The embed at `public/widget/gorbach.js` comes from the widget repository. Coordinate the stateful `/api` contract and lightweight `/api/cbot` contract with that repository. Company knowledge and survey defaults ship under `data/initial/`. Keep runtime state and secrets out of Git.

Run `python -m unittest discover -s tests -v` and `node --check public/admin/admin.js`. The server does not require a frontend build.
