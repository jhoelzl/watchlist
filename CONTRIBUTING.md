# Contributing

A short guide to setup, tests, and style. See the [README](README.md) for features and operations, and [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) for open ideas.

## Setup

Requirements: [uv](https://docs.astral.sh/uv/) (Python 3.12) and Node.js for the web dashboard.

```
uv sync                               # Python dependencies
uv run pre-commit install             # once per clone: gitleaks, ruff, mypy, plus oxlint and tsc for web/ changes; also blocks commits and pushes to main
cd web && npm ci                      # dashboard dependencies
```

Keep secrets (Supabase, Resend) only in a local `.env`, never in code or the repository. To run `check.py` with a database: `op run --env-file=.env -- uv run check.py`. Without `RESEND_API_KEY`, emails are only printed. For the dashboard, copy `web/.env.example` to `web/.env` (use only the Publishable/Anon key, never the Secret key).

## Structure

- `check.py`: run flow (`run`, `check_url`, emails, and storage)
- `config.py`: load and validate options; `fetch.py`: fetching (HTTP, retry, robots, Playwright); `parse.py`: feed/HTML to text
- `diffing.py`: diffs and anchors; `notify.py`: emails and heartbeat; `errors.py`: `CheckError` and error codes; `settings.json`/`settings.py`: shared constants for Python and the dashboard; `models.py`: `TypedDict` types for options, status, and changes
- Dashboard (`web/src/`): `useWatchlist.ts` (loading and actions), `components/Dashboard.tsx` (shell, filters, tabs), `UrlsTab`, `ChangesTab`, `GroupsPanel`, `AddUrl`, `EditUrl`, `DiffView`, `RunsPanel`, `PreviewBox`, `Heatmap`; pure logic in `lib/watchlist.ts`
- `store.py`: storage (Supabase or files); `add.py` and `migrate.py`: helper scripts

## Tests and checks

Before each commit:

```
uv run ruff check . && uv run ruff format --check . && uv run mypy check.py add.py store.py migrate.py && uv run pytest -q
cd web && npx tsc -b && npm run lint && npm test
```

- Python tests are in `tests/`; web tests (Vitest, no DOM) are next to the code in `web/src/lib/`. Pure logic should live in functions that can be tested without a browser.
- Logic implemented in both Python and TypeScript (`annotate_diff`/`annotateDiff`, `fragment_url`/`fragmentUrl`, `diff_counts`/`countLines`, `group_of`/`groupOf`) is tested in both languages against `fixtures/shared_cases.json` (`tests/test_shared_cases.py`, `web/src/lib/shared.test.ts`). Add new cases to the JSON file; both tests must pass.
- Add tests for new functions and error cases. Mock network and email access in tests.
- `uv run pre-commit run --all-files` runs all hooks manually. CI (`tests.yml`) runs the same checks plus `uv audit` and `npm audit`.

## Workflow

`main` is protected: direct pushes are blocked for everyone (including admins); all changes go through a branch and pull request. Merge only when the `pytest`, `web`, and `gitleaks` status checks pass (squash merge; the branch is deleted afterward).

```bash
git switch -c feat/short-name
# ... make changes and commit ...
git push -u origin HEAD
gh pr create --fill
gh pr merge --squash --auto      # merges automatically once checks pass
git switch main && git pull
```

Locally, the `pre-commit`/`pre-push` hook (`no-commit-to-branch`) blocks commits and pushes to `main`.

## Style

- Language: all text (messages, emails, comments, docs, commit messages, PR titles, and descriptions) must be in English.
- Python: ruff (lint and format, line length in `pyproject.toml`) and mypy in `strict` mode (annotate every function). TypeScript: oxlint and `tsc` in strict mode.
- Add comments only where something is not obvious.
- Represent errors as `CheckError(message, code)` with a stable code. The hint text is attached to the code through `HINTS`, not to the error text.
- Add dependencies with `UV_NO_CONFIG=1 uv add <package>` or `npm install` so lockfiles contain only public registry URLs.

## Data and URLs

- The URL list lives in Supabase, not in the repository. Add URLs with `op run --env-file=.env -- uv run add.py <url> --group <group> -y` or manage them in the dashboard. The default group is `General`.
- Put schema changes in `supabase/schema.sql` (safe to run repeatedly) and execute them in the Supabase SQL Editor.
- Edge Functions: `supabase functions deploy <name> --project-ref <ref> --no-verify-jwt --use-api` (the functions validate authentication themselves).

## Submitting changes

Keep commits small and focused, with a short English message. Update the documentation (README, `docs/IMPROVEMENTS.md`) alongside changes, and remove completed items from the open-ideas list.
