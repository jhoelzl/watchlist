# Mitarbeit

Kurzanleitung für Setup, Tests und Stil. Funktionsübersicht und Betrieb stehen in der [README](README.md), offene Ideen in [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md).

## Setup

Voraussetzungen: [uv](https://docs.astral.sh/uv/) (Python 3.12) und Node.js für das Web-Dashboard.

```
uv sync                               # Python-Abhängigkeiten
uv run pre-commit install             # einmalig pro Klon: gitleaks, ruff, mypy, bei web/-Änderungen oxlint und tsc
cd web && npm ci                      # Abhängigkeiten des Dashboards
```

Secrets (Supabase, Resend) gehören nur in eine lokale `.env`, nie in den Code oder ins Repo. Für `check.py` mit Datenbank: `uv run --env-file .env check.py`. Ohne `RESEND_API_KEY` werden Mails nur ausgegeben. Für das Dashboard `web/.env.example` nach `web/.env` kopieren (nur der Publishable/Anon-Key, nie der Secret-Key).

## Aufbau

- `check.py`: Ablauf eines Laufs (`run`, `check_url`, Mails und Speichern)
- `config.py`: Optionen laden und prüfen, `fetch.py`: Abruf (HTTP, Retry, robots, Playwright), `parse.py`: Feed/HTML zu Text
- `diffing.py`: Diffs und Sprungziele, `notify.py`: Mails und Heartbeat, `errors.py`: `CheckError` und Fehlercodes
- `store.py`: Speicher (Supabase oder Dateien), `add.py` und `migrate.py`: Hilfsskripte

## Tests und Prüfungen

Vor jedem Commit:

```
uv run ruff check . && uv run ruff format --check . && uv run mypy check.py add.py store.py migrate.py && uv run pytest -q
cd web && npx tsc -b && npm run lint && npm test
```

- Python-Tests liegen in `tests/`, Web-Tests (Vitest, ohne DOM) neben dem Code in `web/src/lib/`. Reine Logik gehört in Funktionen, die ohne Browser testbar sind.
- Neue Funktionen und Fehlerfälle bekommen einen Test. Netzwerk und Mails werden in Tests gemockt.
- `uv run pre-commit run --all-files` führt alle Hooks von Hand aus. CI (`tests.yml`) prüft dasselbe plus `uv audit` und `npm audit`.

## Stil

- Sprache: Meldungen, Mails, Kommentare und Doku auf Deutsch. Code-Bezeichner und Commit-Nachrichten (kurz, Imperativ) auf Englisch.
- Python: ruff (Lint und Format, Zeilenlänge siehe `pyproject.toml`) und mypy. TypeScript: oxlint und `tsc` im strikten Modus.
- Kommentare nur dort, wo etwas nicht offensichtlich ist.
- Fehler als `CheckError(message, code)` mit stabilem Code modellieren. Der Hinweistext hängt über `HINTS` am Code, nicht am Fehlertext.
- Abhängigkeiten mit `UV_NO_CONFIG=1 uv add <paket>` bzw. `npm install` hinzufügen, damit die Lock-Dateien nur öffentliche Registry-URLs enthalten.

## Daten und URLs

- Die URL-Liste liegt in Supabase, nicht im Repo. URLs mit `uv run --env-file .env add.py <url> --group <Gruppe> -y` hinzufügen oder im Dashboard pflegen.
- Schemaänderungen kommen in `supabase/schema.sql` (mehrfach ausführbar) und werden im Supabase-SQL-Editor ausgeführt.
- Edge Functions: `supabase functions deploy <name> --project-ref <ref> --no-verify-jwt --use-api` (die Funktionen prüfen die Anmeldung selbst).

## Änderungen einreichen

Kleine, fokussierte Commits mit kurzer englischer Nachricht. Die Doku (README, `docs/IMPROVEMENTS.md`) wird mit der Änderung angepasst: erledigte Punkte aus den offenen Ideen entfernen.
