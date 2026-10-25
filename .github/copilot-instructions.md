# Anweisungen für Copilot

- Nie direkt auf `main` committen oder pushen (Branch Protection und Hook verbieten es). Immer: Branch anlegen (`git switch -c <typ>/<kurzname>`), committen, pushen, PR mit `gh pr create` öffnen, nach grünem Status-Check `tests` mit `gh pr merge --squash` mergen (der Branch wird automatisch gelöscht), danach `git switch main && git pull`. Ohne Rückfrage selbst ausführen.
- Falls der Push abgelehnt wird, den Branch mit `git pull --rebase origin main` aktualisieren (der Workflow committet nichts).
- Sprache: Meldungen, Mails, Kommentare und Doku auf Deutsch. Code-Bezeichner und Commit-Nachrichten (kurz) auf Englisch.
- URLs mit `uv run add.py <url> --group <Gruppe> -y` hinzufügen, nicht von Hand in `urls.yml` schreiben.
- Vor dem Commit: `uv run ruff check . && uv run ruff format --check . && uv run mypy check.py add.py && uv run pytest -q`.
