# Gorbach chat stand

Python 3.10 or newer runs the stand and knowledge editor with the standard library.

```powershell
$env:GEMINI_API_KEY = "<Gemini key>"
$env:GEMINI_MODEL = "gemini-3.8-flash"
$env:ADMIN_PASSWORD = "<strong password>"
python server.py --host 127.0.0.1 --port 8790
```

Open http://127.0.0.1:8790/ for the stand and http://127.0.0.1:8790/admin/ for leads, dialogs, statistics, survey revisions and the knowledge editor. The default staff user is `admin` when `ADMIN_PASSWORD` is set. Existing SQLite staff credentials work, and new staff can be provisioned with `python server.py --add-staff LOGIN` and `GORBACH_STAFF_PASSWORD` set. The browser holds credentials in memory until logout or reload. Use HTTPS for remote access. No external email transport is configured. Submitted leads are visible in CRM.

## Data and migration

Runtime data lives in `.gorbach/admin.sqlite` or under `GORBACH_DATA_DIR`. For CRM migration, point the rewrite at an offline copy of the old data directory, including the SQLite backup and any private `attachments` directory. Startup creates missing schema elements and retains existing revisions, staff, dialogs, leads and file records. Legacy sessions are restored using the questionnaire state they pinned. Old browser admin cookies are replaced by staff sign-in.

If the configured `GORBACH_KB_FILE` or default `.gorbach/knowledge.json` exists, its about/FAQ content is imported once. Otherwise the service retains existing SQLite knowledge or imports the shipped ordered sections. Staff changes create SQLite revisions. The section editor supports per-section language, title, text, order and additions or removals. Existing visitors keep their pinned knowledge and questionnaire revisions.

To import only old knowledge into a new JSON file, run `python server.py --import-sqlite PATH_TO_BACKUP` with `GORBACH_KB_FILE` pointing to a new file before the first start. This workflow does not copy CRM records or modify the source backup.

New attachments are stored in SQLite. Downloads require staff authentication. Files expire after 180 days. A delegated operator should remove old unreferenced legacy disk files after migration or expiry. Deleting a lead removes its dialog, attachment records and any legacy disk files referenced by that dialog.

## Widget API

The stand uses the stateful widget for guided quote, service and specialist requests. The embed takes the API root in `data-api`.

```html
<script src="/widget/gorbach.js" data-api="/api" defer></script>
```

The stateful API has GET `status` / `history` and POST `start` / `msg` / `reset` / `file` / `submit` under `/api`. Gemini handles free consultation using the pinned knowledge and recent dialog. Guided forms stay available without a Gemini key. `GORBACH_CHAT_ENABLED=false` disables both visitor APIs. Set `GORBACH_CLIENT_ORIGIN` to the exact embedding origin for a cross-origin installation.

The existing standalone reference embed uses `data-api="/api/cbot/"`. GET `/api/cbot/status` returns `{ok, enabled}` and POST `/api/cbot/msg` accepts `{text, history}` and returns `{ok, reply}`. These requests use the latest staff knowledge and do not create CRM lead records. The stateless embed needs a configured Gemini key and model.

Both APIs bound input, provider concurrency and request frequency. The daily Gemini cap is configured by `GORBACH_DAY_LIMIT_MSGS` (default 1500).

## Verify locally

```powershell
python server.py --help
python -m unittest discover -s tests -v
```
