# Gorbach chat stand

Python 3.10 or newer runs the stand and knowledge editor with the standard library.

```powershell
$env:GEMINI_API_KEY = "<Gemini key>"
$env:GEMINI_MODEL = "gemini-3.8-flash"
$env:ADMIN_PASSWORD = "<strong password>"
python server.py --host 127.0.0.1 --port 8790
```

Open http://127.0.0.1:8790/ for the stand and http://127.0.0.1:8790/admin/ for the knowledge editor. The admin user is `admin`. The form holds its credential in memory until logout or reload. Put the app behind HTTPS for remote access. The API key stays server-side. The widget is disabled without a Gemini key. Setting `GORBACH_CHAT_ENABLED=false` disables the widget while keeping the knowledge editor available. Admin operations are disabled when `ADMIN_PASSWORD` is unset.

The server reads the shipped Gorbach knowledge until you save in the editor. Changes go to the ignored `.gorbach/knowledge.json` or the path in `GORBACH_KB_FILE`. The editor supports company knowledge and question/answer pairs. `/api/admin/kb` uses HTTP Basic authentication and accepts JSON.

## Existing knowledge

To transfer an existing knowledge revision, first obtain a consistent offline SQLite backup using the old deployment's SQLite backup procedure. Then run this once on the backup, before saving any edits in the new editor.

```powershell
$env:GORBACH_KB_FILE = "F:/path/to/runtime/knowledge.json"
python server.py --import-sqlite "F:/path/to/offline/admin.sqlite"
```

This reads the latest knowledge revision and creates the JSON target only if the target is absent. The import leaves the source backup intact. The new application stores knowledge in JSON and keeps conversation history in the page. The old questionnaire, attachment and lead workflows are outside this reference-based runtime.

## Widget API

Set `GORBACH_CLIENT_ORIGIN` to the exact origin of the embedding site if it is served separately. Use the server's HTTPS URL in the embedding script when the site runs on another origin.

```html
<script src="/widget/gorbach.js" data-api="/api/cbot/" defer></script>
```

- `GET /api/cbot/status` returns `{ok, enabled}`.
- `POST /api/cbot/msg` accepts `{text, history}` with `user` and `assistant` turns, and returns `{ok, reply}`.

The server limits messages to 800 characters, forwards up to 12 conversation turns and allows four concurrent provider requests. It uses per-address request limits and an in-memory UTC daily cap set by `GORBACH_DAY_LIMIT_MSGS` (1500 by default). Deploy behind a reverse proxy where public exposure requires additional traffic controls.

## Verify locally

```powershell
python server.py --help
python -m unittest discover -s tests -v
```
