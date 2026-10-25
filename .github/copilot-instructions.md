# Copilot instructions

- Never commit or push directly to `main` (branch protection and hooks prohibit it). Always create a branch (`git switch -c <type>/<short-name>`), commit, push, open a PR with `gh pr create`, and squash-merge with `gh pr merge --squash` after the `tests` status check passes (the branch is deleted automatically); then run `git switch main && git pull`. Do this without asking for confirmation.
- If a push is rejected, update the branch with `git pull --rebase origin main` (the workflow does not create commits).
- All text (messages, emails, comments, docs, commit messages, PR titles, and descriptions) must be in English. Keep code identifiers and option names unchanged.
- Add URLs with `uv run add.py <url> --group <group> -y`; do not edit `urls.yml` by hand.
- Before committing, run: `uv run ruff check . && uv run ruff format --check . && uv run mypy check.py add.py && uv run pytest -q`.
