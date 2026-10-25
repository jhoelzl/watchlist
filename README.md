# watchlist

[![check](https://github.com/jhoelzl/watchlist/actions/workflows/check.yml/badge.svg)](https://github.com/jhoelzl/watchlist/actions/workflows/check.yml)
[![tests](https://github.com/jhoelzl/watchlist/actions/workflows/tests.yml/badge.svg)](https://github.com/jhoelzl/watchlist/actions/workflows/tests.yml)

Prüft die Seiten aus `urls.yml` 2x täglich (GitHub Actions) und schickt bei Änderungen eine gruppierte HTML-Mail mit Diff über Resend.

## Setup
1. Resend-Account anlegen, Domain verifizieren (oder nur an die eigene Adresse mit `onboarding@resend.dev` senden) und API-Key erzeugen.
2. Repo → Settings → Secrets and variables → Actions → Secrets:
   - `RESEND_API_KEY`
   - `MAIL_TO`
   - `MAIL_FROM` (optional, Standard `onboarding@resend.dev`, sonst z. B. `watchlist@deine-domain.at`)
3. `urls.example.yml` nach `urls.yml` kopieren und pflegen (`urls.yml` ist in `.gitignore`, damit keine persönlichen URLs im Repo landen; mit Supabase pflegst du die URLs im Dashboard), dann Actions → check → Run workflow (erzeugt die Baselines, keine Mail).

## Supabase statt Dateien (URLs, Snapshots, Diffs, Status)

Mit `SUPABASE_URL` und `SUPABASE_SERVICE_KEY` (Umgebungsvariablen bzw. Repo-Secrets) liegen URLs, Snapshots, Fehlerzähler, Status, HTTP-Cache und der Änderungsverlauf (inkl. Diffs) in Supabase-Tabellen mit dem Präfix `watchlist_`. Ohne sie läuft `check.py` lokal im Dateimodus (`urls.yml`, `state/`).

1. Im Supabase SQL-Editor [supabase/schema.sql](supabase/schema.sql) ausführen (RLS ist aktiv, keine öffentlichen Policies).
2. Project Settings → API Keys: **Project URL** als `SUPABASE_URL` und den **service_role**-Key als `SUPABASE_SERVICE_KEY` verwenden. Der Anon-Key reicht nicht, er darf wegen RLS nichts lesen oder schreiben. Der service_role-Key ist geheim (umgeht RLS): nur in `.env` und als Secret, nie im Frontend.
3. Lokal migrieren (einmalig, wiederholbar): `uv run --env-file .env migrate.py --state-dir state` (Ordner mit den bisherigen Snapshots; nicht nötig, wenn du bei null anfängst).
4. Beide Werte als Repo-Secrets eintragen. Der Workflow arbeitet nur noch mit Supabase und kennt `urls.yml` nicht. `urls.yml` ist nicht im Repo.
5. Neue URLs: `uv run --env-file .env add.py <url>` schreibt direkt in `watchlist_urls`. Einträge lassen sich auch im Supabase-Table-Editor pflegen (`options` enthält `selector` (`auto` = Bereich automatisch erkennen), `js`, `ignore`, `only_added`, `min_ratio`, `ignore_robots`; `active = false` pausiert eine URL; gemeinsame Optionen in `watchlist_settings` unter dem Schlüssel `defaults`).

### Dashboard mit Login (`web/`)

Vite + React + `supabase-js`, Anmeldung per E-Mail und Passwort wie in der App sheet-music (gleiches Supabase-Projekt, gleiche Konten). Es liest Status und Änderungsverlauf direkt aus Supabase. Ohne Anmeldung sieht man nichts.

- Die Registrierung im Projekt ist offen, deshalb schaltet `supabase/schema.sql` nur Konten aus `watchlist_admins` frei (Policies, kein Zugriff auf Snapshots). Nach dem Ausführen des Schemas das eigene Konto freischalten (SQL-Editor): `insert into watchlist_admins (user_id) select id from auth.users where email = 'du@example.com' on conflict do nothing;`. Ein Konto, das noch nicht freigeschaltet ist, sieht „nicht freigeschaltet".
- Lokal: `cd web`, `.env.example` nach `.env` kopieren und `VITE_SUPABASE_URL` sowie `VITE_SUPABASE_ANON_KEY` (Publishable/Anon-Key, **nicht** der Secret-Key) eintragen, dann `npm ci && npm run dev`. Prüfen mit `npm run lint`, `npm test`, `npm run build`.
- GitHub Pages: Secret `SUPABASE_ANON_KEY` (Publishable-Key) anlegen und die Variable `ENABLE_PAGES=true` setzen. Der eigene Workflow `pages.yml` baut dann `web/` und veröffentlicht `web/dist` (bei jedem Push auf `web/**` und manuell). Er ist unabhängig vom Prüflauf. Die Seite ist öffentlich erreichbar, zeigt aber ohne Anmeldung keine Daten. Der statische Export im Dateimodus wird nicht mehr veröffentlicht.
- Tab „Gruppen“: Gruppen anlegen, umbenennen, URLs zuordnen und auflösen. Das ändert `grp` an den URLs und braucht die Policy `admins update urls` aus `supabase/schema.sql` (einmal im SQL-Editor ausführen).
- URLs bearbeiten: Der Stift in der URL-Tabelle öffnet ein Formular für Name, Gruppe, Selector, JavaScript, `ignore`, `only_added` und Pausieren. Pausierte URLs werden nicht geprüft und erscheinen als „Pausiert“. Auch das braucht die Policy `admins update urls`.
- „Jetzt prüfen“: Der Button ruft die Edge Function `watchlist-trigger-check` (`supabase/functions/`) auf. Sie prüft die Anmeldung und `watchlist_admins` und startet dann den Workflow `check`. Einrichten: Fine-grained Token auf GitHub anlegen (nur dieses Repo, Berechtigung „Actions: Read and write“), dann `supabase secrets set GH_DISPATCH_TOKEN=… --project-ref <ref>` und `supabase functions deploy watchlist-trigger-check --project-ref <ref> --no-verify-jwt`.
- Selector-Vorschau: Im Formular „URL hinzufügen“ ruft die Edge Function `watchlist-preview` die Seite ab und zeigt den erkannten Bereich samt Textmenge. Deployen: `supabase functions deploy watchlist-preview --project-ref <ref> --no-verify-jwt`. Sie prüft wie der Button Anmeldung und `watchlist_admins`, blockt interne Adressen und rendert kein JavaScript.
- Import / Export: Das Menü „Import / Export“ sichert die URL-Liste als YAML oder JSON (Format wie `urls.yml`) und liest solche Dateien wieder ein. Vorhandene URLs bleiben unberührt. Der Import braucht die Insert-Policy `admins add urls`.

Alternativ geht eine direkte Postgres-Verbindung mit `SUPABASE_DB_URL` (Session-Pooler-URL mit Datenbankpasswort), sie hat Vorrang.

Tests gegen echtes Postgres (`tests/test_pgstore.py`) laufen mit `WATCHLIST_TEST_DSN=...` oder mit installiertem `pgserver` (Python 3.12), sonst werden sie übersprungen.

## urls.yml
```yaml
defaults:                      # gilt für alle URLs, ignore-Listen werden zusammengeführt
  ignore: ['Last updated on\s*\S+']

urls:
  - url: https://example.com/releases
    name: "Mein Name"          # optional, sonst der Seitentitel
    group: Azure               # optional, gruppiert Mail und Dashboard
    selector: main             # optional, nur dieser CSS-Bereich; "auto" wählt main/article/[role=main] selbst, sonst ganze Seite
    ignore: ['\d{2}:\d{2}']    # optional, Regex wird vor dem Vergleich entfernt
    only_added: true           # optional, Mail zeigt nur neue Zeilen
    js: true                   # optional, Seite mit Playwright (Chromium) rendern
    min_ratio: 0.3             # optional, Textwächter (0 = aus), siehe unten
    ignore_robots: true        # optional, robots.txt-Sperre übergehen
  - url: https://example.com/feed.xml   # RSS/Atom wird automatisch erkannt
```
- `ignore`-Regex werden beim Start geprüft: ungültige, über 300 Zeichen lange oder zu Backtracking neigende Muster (verschachtelte Quantifizierer wie `(a+)+`) markieren die URL als „Fehler" (Konfigurationsfehler, nicht abgerufen), der Lauf endet mit Fehler und löst die Alarmmail aus.
- Bei Feeds ist `only_added` standardmäßig an (ein Eintrag pro Zeile, entfernte Einträge lösen keine Mail aus).
- Eine reine Liste von URLs ohne `defaults`/`urls` funktioniert weiterhin.
- `js: true` ist langsamer. Der Workflow installiert Chromium nur, wenn irgendwo `js: true` konfiguriert ist (`check.py --needs-js`).

## URL hinzufügen
```
uv run add.py https://example.com/seite          # fragt Name, Gruppe und Selector ab
uv run add.py https://example.com/seite -y       # Vorschläge ohne Rückfrage übernehmen
uv run add.py <url> --group Azure --selector main --js
```
Das Skript ruft die Seite ab, schlägt einen Selector (`main`, `article`, ...) und die Gruppe vorhandener URLs desselben Hosts vor und hängt den Eintrag an `urls.yml` an (Kommentare bleiben erhalten). Findet es im HTML `<link rel="alternate" type="application/rss+xml">` (oder Atom), werden die Feeds aufgelistet und du wählst einen (`--feed` nimmt den ersten, mit `-y` nur ein Hinweis). Die Baseline entsteht beim nächsten Lauf (`uv run check.py`).

## Sprache
Meldungen, Mails, Kommentare und Doku sind auf Deutsch. Code-Bezeichner (Funktionen, Variablen, Konstanten, Optionsnamen in `urls.yml`) und Commit-Nachrichten sind auf Englisch.

## Rücksicht auf Server und Fehlabrufe
- **Parallele Abrufe:** Die Seiten werden mit bis zu 6 Threads geladen, pro Host höchstens 2 gleichzeitig (`MAX_WORKERS`, `MAX_PER_HOST` in `check.py`). Seiten mit `js: true` laufen nacheinander. Die Auswertung, Mails und Snapshots bleiben seriell und in der Reihenfolge von `urls.yml`.
- **robots.txt** wird pro Host einmal je Lauf geprüft. Verbietet sie eine URL, zählt das als Abruffehler (Override: `ignore_robots: true`). Fehlt die Datei oder ist sie nicht erreichbar, ist alles erlaubt.
- **ETag / Last-Modified:** Antwortet der Server mit `304 Not Modified`, wird die Seite nicht neu geladen. Die Werte stehen in `state/http.json` (bzw. in Supabase). Ändert sich `selector`, `ignore` oder `js`, wird wieder voll geladen. Nicht alle Server unterstützen das (z. B. Google nur eingeschränkt).
- **Textwächter:** Liefert eine Seite plötzlich unter 30 % des bisherigen Textes (nur bei Snapshots ab 500 Zeichen), gilt das als Fehlabruf (Cookie-Wand, Bot-Block). Der Snapshot bleibt unverändert, es gibt keine Änderungsmail, das Dashboard zeigt „Zu wenig Text", und nach dem 2. Lauf in Folge kommt eine Warnmail. Mit `min_ratio` anpassbar, `0` schaltet den Wächter für diese URL aus.
- **Retry:** Bei Netzwerkfehlern, Timeouts, HTTP 5xx und 429 gibt es bis zu 3 Versuche (Pause 2 s, 5 s, `Retry-After` bis max. 30 s). Andere 4xx werden nicht wiederholt. Erst danach zählt es als Fehlabruf.
- **Fehlerfester Mailversand:** Snapshot und Verlauf einer geänderten Seite werden erst nach erfolgreichem Versand gespeichert. Schlägt Resend fehl, bleibt der alte Snapshot, die Änderung wird im nächsten Lauf erneut erkannt, der Lauf endet mit Fehler (Alarm) und die Seite steht im Dashboard auf „Fehler".
- **only_added:** Für Release-Notes-Seiten mit viel Text empfohlen (in `urls.yml` bereits gesetzt), die Mail zeigt dann nur neue Zeilen.

## Betrieb
- **Badge:** Die Badges oben zeigen den Status des letzten Laufs. Bei einem privaten Repo siehst du sie nur, wenn du bei GitHub eingeloggt bist.
- **Lebenszeichen:** Im ersten Lauf eines neuen Monats kommt eine Mail mit Anzahl der Seiten, Änderungen und Problemen pro Gruppe, den letzten Änderungen und den dauerhaft kaputten Seiten (6 Läufe in Folge, `STUCK_AFTER`) mit Hinweis zur Abhilfe. Bleibt sie aus, läuft der Zeitplan nicht mehr (GitHub deaktiviert ihn nach 60 Tagen ohne Repo-Aktivität).
- **Warnmails mit Tipp:** Die Mails „Probleme beim Abruf" nennen zur Fehlerart eine mögliche Ursache und Abhilfe (robots.txt → `ignore_robots`, 403/Bot-Block/Timeout → `js: true`, 404 → URL prüfen, Selector nicht gefunden usw.).
- **Alarm:** Schlägt der Workflow fehl (z. B. Resend-Fehler), versucht ein letzter Schritt eine Alarmmail mit Link zum Lauf zu senden. Zusätzlich meldet GitHub fehlgeschlagene Läufe selbst per Mail.
- **Diffs:** Gespeichert werden bis zu 500 Diff-Zeilen mit 3 Zeilen Kontext (`STORE_DIFF_LINES`, `DIFF_CONTEXT`), die Mail zeigt die ersten 60 (`MAIL_DIFF_LINES`) mit wortgenauer Markierung, `+N −M`, einer Zusammenfassung oben und einem Link „zur geänderten Stelle" (Textfragment `#:~:text=`, funktioniert in Chromium und Safari bei einfachem Text). Der Tab „Letzte Änderungen" im Dashboard zeigt den vollen Diff, gruppiert nach Tag, mit Filter für Zeitraum und Gruppe.
- **Dashboard:** Das Web-Dashboard (`web/`) zeigt Status pro URL, letzte Prüfung und Änderungsverlauf mit Suche und Filtern. Im Dateimodus erzeugt `check.py` lokal `site/index.html`.
- **Dashboard auf GitHub Pages (optional):** Pages-Seiten sind öffentlich erreichbar, auch bei privatem Repo, und für private Repos braucht es einen bezahlten Plan. Aktivieren: Settings → Pages → Source „GitHub Actions" und Variable `ENABLE_PAGES=true` (Settings → Secrets and variables → Actions → Variables).
- **Dependabot** aktualisiert Abhängigkeiten und Actions wöchentlich, `tests.yml` führt Lint, Typcheck, Tests und `uv audit` (Schwachstellenprüfung der Abhängigkeiten) bei Push, Pull Request und wöchentlich aus.

## Lokal
```
uv run check.py                       # Mails werden nur ausgegeben, wenn RESEND_API_KEY fehlt
uv run --extra js playwright install chromium   # einmalig, nur für js: true (ein Browser pro Lauf, eine Seite je URL)
uv run --extra js check.py            # mit js: true
uv run pytest                         # Tests
uv run ruff check .                   # Lint
uv run ruff format .                  # Formatieren (CI prüft mit --check)
uv run mypy check.py add.py dashboard.py  # Typcheck
uv run pre-commit install             # einmalig pro Klon: gitleaks, ruff, mypy, bei Änderungen in web/ auch oxlint und tsc
uv run pre-commit run --all-files     # alle Hooks von Hand
uv audit --preview-features audit-command  # bekannte Schwachstellen in Abhängigkeiten
```
Mit Secrets aus einer `.env`-Datei: `set -a; source .env; set +a; uv run check.py`.
Falls eine globale uv-Konfiguration mit privaten Index-Feeds stört: `UV_NO_CONFIG=1 uv ...` (nötig z. B. bei `uv add`, damit `uv.lock` nur öffentliche PyPI-URLs enthält).

Abhängigkeiten ändern: `uv add <paket>` (aktualisiert `pyproject.toml` und `uv.lock`).

Optional: `DASHBOARD_URL` (Standard `https://jhoelzl.github.io/watchlist/`) bestimmt, worauf die Dashboard-Links in den Mails zeigen.
