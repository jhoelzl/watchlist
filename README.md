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
3. `urls.yml` pflegen, dann Actions → check → Run workflow (erzeugt die Baselines, keine Mail).

## urls.yml
```yaml
defaults:                      # gilt für alle URLs, ignore-Listen werden zusammengeführt
  ignore: ['Last updated on\s*\S+']

urls:
  - url: https://example.com/releases
    name: "Mein Name"          # optional, sonst der Seitentitel
    group: Azure               # optional, gruppiert Mail und Dashboard
    selector: main             # optional, nur dieser CSS-Bereich
    ignore: ['\d{2}:\d{2}']    # optional, Regex wird vor dem Vergleich entfernt
    only_added: true           # optional, Mail zeigt nur neue Zeilen
    js: true                   # optional, Seite mit Playwright (Chromium) rendern
    min_ratio: 0.3             # optional, Textwächter (0 = aus), siehe unten
    ignore_robots: true        # optional, robots.txt-Sperre übergehen
  - url: https://example.com/feed.xml   # RSS/Atom wird automatisch erkannt
```
- Bei Feeds ist `only_added` standardmäßig an (ein Eintrag pro Zeile, entfernte Einträge lösen keine Mail aus).
- Eine reine Liste von URLs ohne `defaults`/`urls` funktioniert weiterhin.
- `js: true` ist langsamer. Der Workflow installiert Chromium nur, wenn `js: true` in `urls.yml` vorkommt.

## URL hinzufügen
```
uv run add.py https://example.com/seite          # fragt Name, Gruppe und Selector ab
uv run add.py https://example.com/seite -y       # Vorschläge ohne Rückfrage übernehmen
uv run add.py <url> --group Azure --selector main --js
```
Das Skript ruft die Seite ab, schlägt einen Selector (`main`, `article`, ...) und die Gruppe vorhandener URLs desselben Hosts vor und hängt den Eintrag an `urls.yml` an (Kommentare bleiben erhalten). Findet es im HTML `<link rel="alternate" type="application/rss+xml">` (oder Atom), werden die Feeds aufgelistet und du wählst einen (`--feed` nimmt den ersten, mit `-y` nur ein Hinweis). Die Baseline entsteht beim nächsten Lauf (`uv run check.py`).

## Rücksicht auf Server und Fehlabrufe
- **robots.txt** wird pro Host einmal je Lauf geprüft. Verbietet sie eine URL, zählt das als Abruffehler (Override: `ignore_robots: true`). Fehlt die Datei oder ist sie nicht erreichbar, ist alles erlaubt.
- **ETag / Last-Modified:** Antwortet der Server mit `304 Not Modified`, wird die Seite nicht neu geladen. Die Werte stehen in `state/http.json`. Ändert sich `selector`, `ignore` oder `js`, wird wieder voll geladen. Nicht alle Server unterstützen das (z. B. Google nur eingeschränkt).
- **Textwächter:** Liefert eine Seite plötzlich unter 30 % des bisherigen Textes (nur bei Snapshots ab 500 Zeichen), gilt das als Fehlabruf (Cookie-Wand, Bot-Block). Der Snapshot bleibt unverändert, es gibt keine Änderungsmail, das Dashboard zeigt „Zu wenig Text", und nach dem 2. Lauf in Folge kommt eine Warnmail. Mit `min_ratio` anpassbar, `0` schaltet den Wächter für diese URL aus.
- **Retry:** Bei Netzwerkfehlern, Timeouts, HTTP 5xx und 429 gibt es bis zu 3 Versuche (Pause 2 s, 5 s, `Retry-After` bis max. 30 s). Andere 4xx werden nicht wiederholt. Erst danach zählt es als Fehlabruf.
- **Fehlerfester Mailversand:** Snapshot und Verlauf einer geänderten Seite werden erst nach erfolgreichem Versand gespeichert. Schlägt Resend fehl, bleibt der alte Snapshot, die Änderung wird im nächsten Lauf erneut erkannt, der Lauf endet mit Fehler (Alarm) und die Seite steht im Dashboard auf „Fehler".
- **only_added:** Für Release-Notes-Seiten mit viel Text empfohlen (in `urls.yml` bereits gesetzt), die Mail zeigt dann nur neue Zeilen.

## Betrieb
- **Badge:** Die Badges oben zeigen den Status des letzten Laufs. Bei einem privaten Repo siehst du sie nur, wenn du bei GitHub eingeloggt bist.
- **Lebenszeichen:** Im ersten Lauf eines neuen Monats kommt eine Mail mit Anzahl der Seiten, Änderungen und Fehlern. Bleibt sie aus, läuft der Zeitplan nicht mehr (GitHub deaktiviert ihn nach 60 Tagen ohne Repo-Aktivität).
- **Alarm:** Schlägt der Workflow fehl (z. B. Resend-Fehler), versucht ein letzter Schritt eine Alarmmail mit Link zum Lauf zu senden. Zusätzlich meldet GitHub fehlgeschlagene Läufe selbst per Mail.
- **Dashboard:** `site/index.html` wird bei jedem Lauf erzeugt und committet (Status pro URL, letzte Prüfung, Änderungsverlauf). Mit Suchfeld und Filtern nach Gruppe und Status. Lokal einfach im Browser öffnen.
- **Dashboard auf GitHub Pages (optional):** Pages-Seiten sind öffentlich erreichbar, auch bei privatem Repo, und für private Repos braucht es einen bezahlten Plan. Aktivieren: Settings → Pages → Source „GitHub Actions" und Variable `ENABLE_PAGES=true` (Settings → Secrets and variables → Actions → Variables).
- **Dependabot** aktualisiert Abhängigkeiten und Actions wöchentlich, `tests.yml` führt die Tests bei Push und Pull Request aus.

## Lokal
```
uv run check.py                       # Mails werden nur ausgegeben, wenn RESEND_API_KEY fehlt
uv run --extra js playwright install chromium   # einmalig, nur für js: true
uv run --extra js check.py            # mit js: true
uv run pytest                         # Tests
uv run ruff check .                   # Lint
uv run mypy check.py add.py dashboard.py  # Typcheck
```
Mit Secrets aus einer `.env`-Datei: `set -a; source .env; set +a; uv run check.py`.
Falls eine globale uv-Konfiguration mit privaten Index-Feeds stört: `UV_NO_CONFIG=1 uv ...`.

Abhängigkeiten ändern: `uv add <paket>` (aktualisiert `pyproject.toml` und `uv.lock`).
