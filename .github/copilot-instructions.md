# Anweisungen für Copilot

- In diesem Repo immer selbst committen und pushen, direkt auf `main` (kein Feature-Branch, kein PR, keine Rückfrage).
- Vor dem Push `git pull --rebase origin main` nur bei abgelehntem Push (der Workflow committet nichts).
- Sprache: Meldungen, Mails, Kommentare und Doku auf Deutsch. Code-Bezeichner und Commit-Nachrichten (kurz) auf Englisch.
- URLs mit `uv run add.py <url> --group <Gruppe> -y` hinzufügen, nicht von Hand in `urls.yml` schreiben.
- Vor dem Commit: `uv run ruff check . && uv run ruff format --check . && uv run mypy check.py add.py dashboard.py && uv run pytest -q`.
