# Improvement ideas

Open improvements by area. Effort: **S** (< 1 h), **M** (a few hours), **L** (days). Priority: 🔴 high, 🟡 medium, ⚪ low.

Current state: `check.py` 356 lines (plus `config.py`, `fetch.py`, `parse.py`, `diffing.py`, `notify.py`, `errors.py`), `store.py` 323, `add.py` 216, web dashboard in `web/` (React, Supabase), 125 Python and 78 web tests. Data is stored in Supabase (`watchlist_*` tables). The repository is public; personal data (URL list) is kept only in the database.

## Next steps (Top 5)

| # | Idea | Area | Priority | Effort |
|---|------|------|----------|--------|
| 1 | More channels (ntfy/Slack/Teams) and digest mode | Features | 🟡 | M |
| 2 | Tests for `RestStore`, `add.py`, Edge Functions, and web components | Quality | 🟡 | M |
| 3 | `timeout-minutes` and workflow-failure alert for `check.yml` | Operations | 🟡 | S |
| 4 | Database backup (weekly export as an artifact) | Operations | 🟡 | S |
| 5 | Monitor run duration | Reliability | 🟡 | S |

---

## 1. Security

- ⚪ **DNS rebinding:** `netsafe.py` resolves a host once for the check and again when requests connects, so a malicious DNS server could still answer differently the second time. Fix: connect to the checked IP (custom adapter) with the original `Host` header. (M)
- ⚪ **Resend error text** (`r.text`) is written to the log. Ensure headers or keys are never exposed there. (S)
- ⚪ **Document key rotation:** All secrets are in the `watchlist` 1Password vault (only `OP_SERVICE_ACCOUNT_TOKEN` remains in GitHub). Open item: how to renew the service-account token, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, and `GH_DISPATCH_TOKEN` (stored as a Supabase secret, not in 1Password), including the token expiration date. (S)

## 2. Features

- 🟡 **More channels:** ntfy.sh (the simplest way to send push notifications to a phone), Slack/Teams/Discord webhook, Telegram. Configurable through secrets and `options`, including per group. (M)
- 🟡 **Digest mode:** Optional daily summary instead of immediate email, per group or URL (`notify: daily|immediate`). (M)
- 🟡 **Keyword/regex trigger:** `notify_if: 'Salzburg|Python'` sends the email only when new lines match (jobs, events). Add a field to the dashboard form. (S)
- 🟡 **Recipients per group:** Allow `MAIL_TO` to be overridden per group. (S)
- ⚪ **Support JSON and PDF sources** (JSON path, PDF text). (L)
- ⚪ **Screenshots for JS pages** as artifacts, to help with layout issues. (M)
- ⚪ **Authentication support** (headers/cookies through secrets) for protected pages. (M)
- ⚪ **Improve `add.py`:** add multiple URLs at once (`-f list.txt`), detect duplicates using normalized URLs, suggest `ignore` patterns. (S)

## 3. UX / UI (email and CLI)

- No open items at the moment.

## 4. Dashboard

- ⚪ **Mark as read** in the “Recent changes” tab, with an unread counter. (M)
- ⚪ **Accessibility:** `aria-label` for filters, keyboard navigation for diffs, status not conveyed by color alone, form focus order. (S)
- ⚪ **Installable PWA** with an offline cache of recent data. (M)

## 5. Refactoring

- ⚪ **Configuration schema** with clear errors for typos (`selektor:`), unknown options, and incorrect types, including when saving in the dashboard. (M)
- ⚪ **Logging** instead of `print` (GitHub Actions groups `::group::` and `::warning::` annotations). (S)
- ⚪ **Package structure** (`src/watchlist/`, entry points `watchlist check|add`). (M)

## 6. Reliability and operations

- 🟡 **Set `timeout-minutes`** for the `check` job so a stuck Playwright run cannot block for hours (currently unset). (S)
- 🟡 **Pages that block GitHub runners:** `buch.stadt-salzburg.at` responds only from private IPs (ConnectTimeout or `goto` timeout on the runner). Options: self-hosted runner, proxy, or local launchd job. It has been removed from the list for now. (M)
- ⚪ **Pages with A/B variants:** `deepl.com/en/pro` randomly returns one of two text variants on every fetch, causing repeated change emails (URL paused). Idea: detect when snapshots keep switching between two states and warn in the dashboard or pause automatically. (M)
- 🟡 **Monitor run duration:** 52 URLs, many on `learn.microsoft.com` (`MAX_PER_HOST = 2`). After a few runs, review duration and adjust the limit or per-host delay if needed. (S)
- 🟡 **Workflow-failure notification:** If `check.yml` itself fails (Supabase down, missing secret), no email is sent. Add a second job with `if: failure()` or monitor “no run in 36 h”. (S)
- 🟡 **Database backup:** Regularly export `watchlist_urls` and `watchlist_history` (for example, as a weekly artifact). The Supabase project is shared. (S)
- ⚪ **Parser version in state:** Changes to `clean`/`parse_html`/`auto_root` make every page appear changed. Quietly establish a new baseline with `parser_version`. (M)

## 7. Tests and quality

- 🟡 **Test web components** (Testing Library): tabs, filters, group form, error message on “Check now”, using a mocked Supabase client. Only pure helpers are tested so far. (M)
- 🟡 **Test `RestStore`:** Use an HTTP mock (PostgREST responses), including errors. `PgStore` has tests (Python 3.12 and `pgserver`); `RestStore` does not. (M)
- 🟡 **Test the `add.py` flow:** `main` with mocked `fetch_body`, `--feed`, `-y`, duplicates, and robots blocking. (M)
- 🟡 **Integration test** with a local HTTP server for 304, 429/5xx retries, redirects, and character encoding. (M)
- 🟡 **Test Edge Functions** (Deno tests, `watchlist-trigger-check` and `watchlist-preview`) for 401, 403, 429, “run active”, start, and CORS. (S)
- 🟡 **End-to-end dashboard test** (Playwright) with mocked REST responses. Playwright is already a dependency. (L)
- 🟡 **Measure coverage** (`pytest --cov`, `vitest --coverage`) and set a minimum in CI. (S)
- ⚪ **Property tests** (Hypothesis, fast-check) for `make_diff`, `annotate_diff`, `fragment_url`, `clean`, and regex ignore. (M)
- ⚪ **CI configuration validation:** `check.py --validate` without network access (duplicates, invalid regexes, unknown options). (S)

## 8. Documentation

- ⚪ **Dashboard and sample email screenshots** in the README. (S)
- ⚪ **Example configurations** for common cases (release notes with `only_added`, JS page, feed, job listings with `ignore`, `selector: auto`). (S)
- ⚪ **CHANGELOG** and version management (currently `0.1.0`). (S)

---

## Suggested order

1. Edit and pause URLs in the dashboard, show failure streaks, and provide feedback after “Check now”.
2. Add `timeout-minutes`, workflow-failure notifications, database backups, and web checks in CI.
3. Group tab variants, then add ntfy and digest mode.
4. Add tests for `RestStore`, `add.py`, Edge Functions, and web components, then add coverage in CI.
