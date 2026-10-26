"""Orchestrates a check run. Components live in config, fetch, parse, diffing, and notify."""

import hashlib
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import notify
from config import config_errors, config_hash, is_due, merge_config
from diffing import make_diff
from errors import error_code
from fetch import FetchResult, fetch_all
from models import Change, HistoryEntry, Options, Pending, Problem, RunSummary, UrlStatus, Validators
from notify import render_html, render_text, send_heartbeat, subject_for, with_hint
from settings import SETTINGS
from store import FileStore, PgStore, open_store

ROOT = Path(__file__).parent
# In the workflow, state/ lives on the "state" branch (checked out into a separate directory).
STATE = Path(os.environ.get("WATCHLIST_STATE_DIR") or ROOT / "state")
MAX_RUNS = 30
# Content guard: a page that previously had at least GUARD_MIN_CHARS characters and drops below
# min_ratio (30% by default) is treated as a failed fetch (cookie wall or bot block).
GUARD_MIN_CHARS = 500
DEFAULT_MIN_RATIO = 0.3
GUARD_ALERT_AFTER = 2
FAIL_ALERT_AFTER = 3
PERMANENT_CODES = {"http_404", "http_410"}  # The page no longer exists: no waiting required.
PERMANENT_ALERT_AFTER = 2


@dataclass
class RunState:
    """Intermediate run state, populated during collection and then read during sending and saving."""

    stamp: str
    old_status: dict[str, UrlStatus]
    http_cache: dict[str, Validators]
    status: dict[str, UrlStatus] = field(default_factory=dict)
    new_cache: dict[str, Validators] = field(default_factory=dict)
    changes: list[Change] = field(default_factory=list)
    problems: list[Problem] = field(default_factory=list)
    pending: list[Pending] = field(default_factory=list)
    config_bad: list[str] = field(default_factory=list)


@dataclass
class Result:
    """Result of checking a URL. apply_result applies changes to the store and run state."""

    entry: UrlStatus
    cache: Validators | None = None  # New HTTP cache entry.
    snapshot: str | None = None  # Text to save as a snapshot immediately.
    pending: Pending | None = None  # Change to apply only after the email is sent.
    problem: Problem | None = None  # Warning to report by email.
    config_error: str | None = None
    counters: list[tuple[Any, ...]] = field(default_factory=list)  # ("set", key, name, n) or ("clear", key, name)


Store = FileStore | PgStore


def url_key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def run() -> bool:
    store = open_store(STATE, ROOT / "urls.yml")
    try:
        return _run(store)
    finally:
        store.close()


def record_run(
    runs: list[RunSummary], stamp: str, seconds: float, status: dict[str, UrlStatus], changes: int, ok: bool
) -> list[RunSummary]:
    """Appends a run summary (duration, error rate) and keeps the latest MAX_RUNS entries."""
    entry: RunSummary = {
        "time": stamp,
        "seconds": round(seconds, 1),
        "total": len(status),
        "errors": sum(1 for s in status.values() if s["status"] == "error"),
        "warns": sum(1 for s in status.values() if s["status"] == "warn"),
        "changes": changes,
        "ok": ok,
    }
    return [*runs, entry][-MAX_RUNS:]


def plan_jobs(
    store: Store,
    entries: list[Options],
    old_status: dict[str, UrlStatus],
    http_cache: dict[str, Validators],
    now: datetime,
    force: bool = False,
) -> list[tuple[Options, Validators]]:
    """Returns the URLs to fetch during this run (valid configuration, interval elapsed) and their validators."""
    jobs: list[tuple[Options, Validators]] = []
    snapshot_keys = store.snapshot_keys()
    for opts in entries:
        if config_errors(opts):
            continue
        url = opts["url"]
        cached = http_cache.get(url, {})
        snap_exists = url_key(url) in snapshot_keys
        if not force and not is_due(opts, old_status.get(url, {}), now, snap_exists):
            continue
        jobs.append((opts, cached if snap_exists and cached.get("config") == config_hash(opts) else {}))
    return jobs


def _run(store: Store) -> bool:
    started = time.monotonic()
    now = datetime.now(UTC)
    st = RunState(
        stamp=now.strftime("%Y-%m-%d %H:%M UTC"),
        old_status=store.doc("status", {}),
        http_cache=store.doc("http", {}),
    )
    entries = merge_config(store.raw_config())
    history = store.history(SETTINGS.max_history)
    new_history: list[HistoryEntry] = []
    meta = store.doc("meta", {})
    known: set[str] = set()
    only_url = os.environ.get("WATCHLIST_ONLY_URL", "").strip()  # Single-URL check from the dashboard.
    only_group = os.environ.get("WATCHLIST_ONLY_GROUP", "").strip()  # Whole-group check from the dashboard.
    only = bool(only_url or only_group)
    checked: set[str] = set()
    if only:
        known = {e["url"] for e in entries}
        entries = [e for e in entries if (e["url"] == only_url if only_url else (e.get("group") or "General") == only_group)]
        if not entries:
            print(f"[error]    Not in the configuration: {only_url or 'group ' + only_group}")
            return False
        checked = {e["url"] for e in entries}

    print(f"Checking {len(entries)} URL(s)...")
    jobs = plan_jobs(store, entries, st.old_status, st.http_cache, now, force=bool(only))
    fetched = fetch_all(jobs)
    for opts in entries:
        apply_result(store, st, opts["url"], check_url(store, st, opts, fetched))

    ok = not st.config_bad
    ok &= send_change_mail(store, st, history, new_history)
    ok &= send_problem_mail(store, st)

    history = history[-SETTINGS.max_history :]
    if only:  # Other URLs remain unchanged; no heartbeat or run-history entry.
        st.status = {**{u: s for u, s in st.old_status.items() if u in known and u not in checked}, **st.status}
        st.new_cache = {**{u: c for u, c in st.http_cache.items() if u not in checked}, **st.new_cache}
    else:
        try:
            send_heartbeat(now, entries, st.status, history, meta)
        except Exception as ex:
            ok = False
            print(f"[email error] Could not send heartbeat: {ex}")
    store.set_doc("status", st.status)
    store.add_history(new_history, SETTINGS.max_history)
    store.set_doc("meta", meta)
    store.set_doc("http", st.new_cache)
    if not only:
        store.set_doc(
            "runs", record_run(store.doc("runs", []), st.stamp, time.monotonic() - started, st.status, len(st.changes), ok)
        )
    bad = sum(1 for s in st.status.values() if s["status"] in ("error", "warn"))
    print(f"{len(entries)} checked, {len(st.changes)} changed, {bad} with problems")
    return ok


def check_url(store: Store, st: RunState, opts: Options, fetched: dict[str, FetchResult | Exception]) -> Result:
    """Evaluates a URL fetch result. Reads only from the store and run state; all changes are returned in Result."""
    url = opts["url"]
    prev = st.old_status.get(url, {})
    entry: UrlStatus = {
        "name": opts.get("name") or prev.get("name") or url,
        "group": opts.get("group") or "",
        "checked": st.stamp,
        "changed": prev.get("changed", ""),
        "status": "ok",
        "error": "",
        "code": "",
    }
    res = Result(entry)
    cached = st.http_cache.get(url, {})
    errors = config_errors(opts)
    if not errors and url not in fetched:
        res.entry = {**prev, "name": entry["name"], "group": entry["group"]}
        res.cache = cached if url in st.http_cache else None
        print(f"[skipped] {entry['name']} (interval: {opts.get('interval')})")
        return res
    if errors:
        msg = "Configuration error: " + "; ".join(errors)
        entry.update({"status": "error", "error": msg[:300], "code": "config", "checked": prev.get("checked", "-")})
        res.config_error = f"{url}\n  {msg}"
        print(f"[CONFIG]    {url}: {msg}")
        return res
    result = fetched[url]
    key = url_key(url)
    if isinstance(result, Exception):
        return failed_result(store, res, prev, url, result)
    title, text, feed, validators = result
    res.counters.append(("clear", key, "fail"))

    if text is None:
        res.counters.append(("clear", key, "short"))
        res.cache = cached
        print(f"[unchanged] {entry['name']} [304 Not Modified, no new data]")
        return res

    name = opts.get("name") or title or url
    entry["name"] = name
    kind = "Feed" if feed else "page"
    old = store.snapshot(key)
    if old is not None and is_too_short(old, text, opts):
        return short_text_result(store, res, prev, url, name, kind, old, text)
    res.counters.append(("clear", key, "short"))

    new_cache: Validators | None = {**validators, "config": config_hash(opts)} if validators else None
    if old is None:
        entry["status"] = "new"
        hint = " - WARNING: very little text; check the selector" if len(text) < 200 else ""
        print(f"[new]       {name} [{kind}] (baseline saved, {len(text)} characters{hint})")
    elif old == text:
        print(f"[unchanged] {name} [{kind}] ({len(text)} characters)")
    else:
        print(f"[changed]  {name} [{kind}] ({len(old)} -> {len(text)} characters)")
        diff, extra = make_diff(old, text, opts.get("only_added", feed))
        if diff:
            change: Change = {"name": name, "url": url, "group": opts.get("group"), "diff": diff, "extra": extra}
            # Apply snapshot, history, and cache only after the email is sent successfully.
            res.pending = {"change": change, "key": key, "text": text, "entry": entry, "cache": new_cache}
            res.cache = cached or None
            return res
        print("            (removed lines only; no email)")
    res.snapshot = text
    res.cache = new_cache
    return res


def failed_result(store: Store, res: Result, prev: UrlStatus, url: str, ex: Exception) -> Result:
    key = url_key(url)
    n = store.counter(key, "fail") + 1
    res.counters.append(("set", key, "fail", n))
    res.entry.update(
        {"status": "error", "error": str(ex)[:200], "code": error_code(ex), "checked": prev.get("checked", "-"), "streak": n}
    )
    print(f"[error]    {url} (attempt {n} in a row): {ex}")
    if n == (PERMANENT_ALERT_AFTER if error_code(ex) in PERMANENT_CODES else FAIL_ALERT_AFTER):
        res.problem = {
            "text": with_hint(f"Fetch failed {n} times in a row: {url}\n  {ex}", error_code(ex)),
            "counter": (key, "fail"),
            "value": n,
        }
    return res


def is_too_short(old: str | None, text: str, opts: Options) -> bool:
    min_ratio = float(opts.get("min_ratio", DEFAULT_MIN_RATIO))
    return old is not None and len(old) >= GUARD_MIN_CHARS and len(text) < len(old) * min_ratio


def short_text_result(store: Store, res: Result, prev: UrlStatus, url: str, name: str, kind: str, old: str, text: str) -> Result:
    key = url_key(url)
    n = store.counter(key, "short") + 1
    res.counters.append(("set", key, "short", n))
    msg = f"only {len(text)} instead of {len(old)} characters (cookie wall or bot block?)"
    res.entry.update({"status": "warn", "error": msg, "code": "content", "checked": prev.get("checked", "-"), "streak": n})
    print(f"[warning]   {name} [{kind}] {msg}, snapshot remains unchanged (attempt {n} in a row)")
    if n == GUARD_ALERT_AFTER:
        res.problem = {
            "text": with_hint(f"Page returned very little text ({n} times in a row): {url}\n  {msg}", "content"),
            "counter": (key, "short"),
            "value": n,
        }
    return res


def apply_result(store: Store, st: RunState, url: str, res: Result) -> None:
    """Collection phase: applies a URL result to the store and run state."""
    st.status[url] = res.entry
    for op in res.counters:
        if op[0] == "set":
            store.set_counter(op[1], op[2], op[3])
        else:
            store.clear_counter(op[1], op[2])
    if res.snapshot is not None:
        store.set_snapshot(url_key(url), url, res.snapshot)
    if res.cache is not None:
        st.new_cache[url] = res.cache
    if res.pending:
        st.changes.append(res.pending["change"])
        st.pending.append(res.pending)
    if res.problem:
        st.problems.append(res.problem)
    if res.config_error:
        st.config_bad.append(res.config_error)


def send_change_mail(store: Store, st: RunState, history: list[HistoryEntry], new_history: list[HistoryEntry]) -> bool:
    """Sends the change email, then applies snapshots, history, and cache. Returns False if email delivery fails."""
    if not st.changes:
        return True
    print(f"Sending change email to {os.environ.get('MAIL_TO', '?')}...")
    sent_ok = True
    try:
        notify.send_mail(subject_for(st.changes), render_text(st.changes), render_html(st.changes))
    except Exception as ex:
        sent_ok = False
        print(
            f"[email error] {ex}\n  Snapshots for {len(st.pending)} changed page(s) remain unchanged, "
            "and the change will be detected again on the next run."
        )
    for p in st.pending:
        if sent_ok:
            store.set_snapshot(p["key"], p["change"]["url"], p["text"])
            p["entry"]["changed"] = st.stamp
            record: HistoryEntry = {**p["change"], "time": st.stamp}
            history.append(record)
            new_history.append(record)
            if p["cache"]:
                st.new_cache[p["change"]["url"]] = p["cache"]
        else:
            p["entry"].update({"status": "error", "error": "Change detected, email delivery failed (will retry)"})
    return sent_ok


def send_problem_mail(store: Store, st: RunState) -> bool:
    if not st.problems:
        return True
    try:
        notify.send_mail(
            f"Watchlist: {len(st.problems)} fetch problem{'s' if len(st.problems) != 1 else ''}",
            "\n\n".join(p["text"] for p in st.problems),
        )
    except Exception as ex:
        print(f"[email error] Could not send problem notification: {ex}")
        for p in st.problems:  # Reset the counter so the warning is triggered again on the next run.
            store.set_counter(*p["counter"], p["value"] - 1)
        return False
    return True


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[1] == "--alert":
        notify.send_mail("Watchlist: workflow failed", argv[2])
        return 0
    if len(argv) >= 2 and argv[1] == "--needs-js":
        store = open_store(STATE, ROOT / "urls.yml")
        try:
            return 0 if any(e.get("js") for e in merge_config(store.raw_config())) else 1
        finally:
            store.close()
    return 0 if run() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
