# watchlist

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
  - url: https://example.com/feed.xml   # RSS/Atom wird automatisch erkannt
```
- Bei Feeds ist `only_added` standardmäßig an (ein Eintrag pro Zeile, entfernte Einträge lösen keine Mail aus).
- Eine reine Liste von URLs ohne `defaults`/`urls` funktioniert weiterhin.
- `js: true` ist langsamer. Der Workflow installiert Chromium nur, wenn `js: true` in `urls.yml` vorkommt.

## Betrieb
- **Lebenszeichen:** Im ersten Lauf eines neuen Monats kommt eine Mail mit Anzahl der Seiten, Änderungen und Fehlern. Bleibt sie aus, läuft der Zeitplan nicht mehr (GitHub deaktiviert ihn nach 60 Tagen ohne Repo-Aktivität).
- **Alarm:** Schlägt der Workflow fehl (z. B. Resend-Fehler), versucht ein letzter Schritt eine Alarmmail mit Link zum Lauf zu senden. Zusätzlich meldet GitHub fehlgeschlagene Läufe selbst per Mail.
- **Dashboard:** `site/index.html` wird bei jedem Lauf erzeugt und committet (Status pro URL, letzte Prüfung, Änderungsverlauf). Lokal einfach im Browser öffnen.
- **Dashboard auf GitHub Pages (optional):** Pages-Seiten sind öffentlich erreichbar, auch bei privatem Repo, und für private Repos braucht es einen bezahlten Plan. Aktivieren: Settings → Pages → Source „GitHub Actions" und Variable `ENABLE_PAGES=true` (Settings → Secrets and variables → Actions → Variables).
- **Dependabot** aktualisiert Abhängigkeiten und Actions wöchentlich, `tests.yml` führt die Tests bei Push und Pull Request aus.

## Lokal
```
uv run check.py                       # Mails werden nur ausgegeben, wenn RESEND_API_KEY fehlt
uv run --extra js playwright install chromium   # einmalig, nur für js: true
uv run --extra js check.py            # mit js: true
uv run pytest                         # Tests
```
Mit Secrets aus einer `.env`-Datei: `set -a; source .env; set +a; uv run check.py`.
Falls eine globale uv-Konfiguration mit privaten Index-Feeds stört: `UV_NO_CONFIG=1 uv ...`.

Abhängigkeiten ändern: `uv add <paket>` (aktualisiert `pyproject.toml` und `uv.lock`).
