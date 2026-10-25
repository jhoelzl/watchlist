"""Orchestrierung eines Prüflaufs. Die Bausteine liegen in config, fetch, parse, diffing und notify."""

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
from fetch import fetch_all
from notify import render_html, render_text, send_heartbeat, subject_for, with_hint
from store import open_store

ROOT = Path(__file__).parent
# Im Workflow liegen state/ auf dem Branch "state" (ausgecheckt in einem eigenen Verzeichnis).
STATE = Path(os.environ.get("WATCHLIST_STATE_DIR") or ROOT / "state")
MAX_HISTORY = 100
MAX_RUNS = 30
# Textwächter: Eine Seite mit vorher mind. GUARD_MIN_CHARS Zeichen, die unter
# min_ratio (Standard 30 %) schrumpft, gilt als Fehlabruf (Cookie-Wand, Bot-Block).
GUARD_MIN_CHARS = 500
DEFAULT_MIN_RATIO = 0.3
GUARD_ALERT_AFTER = 2
FAIL_ALERT_AFTER = 3
PERMANENT_CODES = {"http_404", "http_410"}  # Seite gibt es nicht mehr: kein Abwarten nötig
PERMANENT_ALERT_AFTER = 2


@dataclass
class RunState:
    """Zwischenstand eines Laufs: wird von den Prüfschritten gefüllt und danach für Mail und Speichern gelesen."""

    stamp: str
    old_status: dict[str, Any]
    http_cache: dict[str, Any]
    status: dict[str, Any] = field(default_factory=dict)
    new_cache: dict[str, Any] = field(default_factory=dict)
    changes: list[dict[str, Any]] = field(default_factory=list)
    problems: list[dict[str, Any]] = field(default_factory=list)
    pending: list[dict[str, Any]] = field(default_factory=list)
    config_bad: list[str] = field(default_factory=list)


def url_key(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def run():
    store = open_store(STATE, ROOT / "urls.yml")
    try:
        return _run(store)
    finally:
        store.close()


def record_run(runs, stamp, seconds, status, changes, ok):
    """Hängt eine Laufzusammenfassung an (Dauer, Fehlerquote) und behält die letzten MAX_RUNS."""
    entry = {
        "time": stamp,
        "seconds": round(seconds, 1),
        "total": len(status),
        "errors": sum(1 for s in status.values() if s["status"] == "error"),
        "warns": sum(1 for s in status.values() if s["status"] == "warn"),
        "changes": changes,
        "ok": ok,
    }
    return [*runs, entry][-MAX_RUNS:]


def plan_jobs(store, entries, old_status, http_cache, now):
    """Welche URLs in diesem Lauf abgerufen werden (gültige Konfiguration, Intervall erreicht) und mit welchen Validatoren."""
    jobs = []
    snapshot_keys = store.snapshot_keys()
    for opts in entries:
        if config_errors(opts):
            continue
        url = opts["url"]
        cached = http_cache.get(url, {})
        snap_exists = url_key(url) in snapshot_keys
        if not is_due(opts, old_status.get(url, {}), now, snap_exists):
            continue
        jobs.append((opts, cached if snap_exists and cached.get("config") == config_hash(opts) else {}))
    return jobs


def _run(store):
    started = time.monotonic()
    now = datetime.now(UTC)
    st = RunState(
        stamp=now.strftime("%Y-%m-%d %H:%M UTC"),
        old_status=store.doc("status", {}),
        http_cache=store.doc("http", {}),
    )
    entries = merge_config(store.raw_config())
    history = store.history(MAX_HISTORY)
    new_history: list[dict[str, Any]] = []
    meta = store.doc("meta", {})

    print(f"Prüfe {len(entries)} URL(s)...")
    fetched = fetch_all(plan_jobs(store, entries, st.old_status, st.http_cache, now))
    for opts in entries:
        check_url(store, st, opts, fetched)

    ok = not st.config_bad
    ok &= send_change_mail(store, st, history, new_history)
    ok &= send_problem_mail(store, st)

    history = history[-MAX_HISTORY:]
    try:
        send_heartbeat(now, entries, st.status, history, meta)
    except Exception as ex:
        ok = False
        print(f"[MAILFEHLER] Lebenszeichen konnte nicht gesendet werden: {ex}")
    store.set_doc("status", st.status)
    store.add_history(new_history, MAX_HISTORY)
    store.set_doc("meta", meta)
    store.set_doc("http", st.new_cache)
    store.set_doc("runs", record_run(store.doc("runs", []), st.stamp, time.monotonic() - started, st.status, len(st.changes), ok))
    bad = sum(1 for s in st.status.values() if s["status"] in ("error", "warn"))
    print(f"{len(entries)} geprüft, {len(st.changes)} geändert, {bad} mit Problemen")
    return ok


def check_url(store, st, opts, fetched):
    """Wertet das Abrufergebnis einer URL aus und trägt Status, Änderungen und Probleme in den Laufzustand ein."""
    url = opts["url"]
    prev = st.old_status.get(url, {})
    entry = {
        "name": opts.get("name") or prev.get("name") or url,
        "group": opts.get("group") or "",
        "checked": st.stamp,
        "changed": prev.get("changed", ""),
        "status": "ok",
        "error": "",
        "code": "",
    }
    st.status[url] = entry
    errors = config_errors(opts)
    if not errors and url not in fetched:
        st.status[url] = {**prev, "name": entry["name"], "group": entry["group"]}
        if url in st.http_cache:
            st.new_cache[url] = st.http_cache[url]
        print(f"[ÜBERSPRUNGEN] {entry['name']} (interval: {opts.get('interval')})")
        return
    if errors:
        msg = "Konfigurationsfehler: " + "; ".join(errors)
        entry.update(status="error", error=msg[:300], code="config", checked=prev.get("checked", "-"))
        st.config_bad.append(f"{url}\n  {msg}")
        print(f"[KONFIG]    {url}: {msg}")
        return
    result = fetched[url]
    if isinstance(result, Exception):
        record_failure(store, st, entry, prev, url, result)
        return
    title, text, feed, validators = result
    key = url_key(url)
    cached = st.http_cache.get(url, {})
    store.clear_counter(key, "fail")

    if text is None:
        store.clear_counter(key, "short")
        st.new_cache[url] = cached
        print(f"[UNVERÄNDERT] {entry['name']} [304 Not Modified, nicht neu geladen]")
        return

    name = opts.get("name") or title or url
    entry["name"] = name
    kind = "Feed" if feed else "Seite"
    old = store.snapshot(key)
    if is_too_short(old, text, opts):
        record_short_text(store, st, entry, prev, url, name, kind, old, text)
        return
    store.clear_counter(key, "short")

    cfg = config_hash(opts)
    if old is None:
        entry["status"] = "new"
        hint = " - ACHTUNG: sehr wenig Text, Selector prüfen" if len(text) < 200 else ""
        print(f"[NEU]       {name} [{kind}] (Baseline gespeichert, {len(text)} Zeichen{hint})")
    elif old == text:
        print(f"[UNVERÄNDERT] {name} [{kind}] ({len(text)} Zeichen)")
    else:
        print(f"[GEÄNDERT]  {name} [{kind}] ({len(old)} -> {len(text)} Zeichen)")
        diff, extra = make_diff(old, text, opts.get("only_added", feed))
        if diff:
            change = {"name": name, "url": url, "group": opts.get("group"), "diff": diff, "extra": extra}
            st.changes.append(change)
            # Snapshot, Verlauf und Cache erst nach erfolgreichem Mailversand übernehmen
            st.pending.append(
                {
                    "change": change,
                    "key": key,
                    "text": text,
                    "entry": entry,
                    "cache": {**validators, "config": cfg} if validators else None,
                }
            )
            if cached:
                st.new_cache[url] = cached
            return
        print("            (nur entfernte Zeilen, keine Mail)")
    store.set_snapshot(key, url, text)
    if validators:
        st.new_cache[url] = {**validators, "config": cfg}


def record_failure(store, st, entry, prev, url, ex):
    key = url_key(url)
    n = store.counter(key, "fail") + 1
    store.set_counter(key, "fail", n)
    entry.update(status="error", error=str(ex)[:200], code=error_code(ex), checked=prev.get("checked", "-"), streak=n)
    print(f"[FEHLER]    {url} (Versuch {n} in Folge): {ex}")
    if n == (PERMANENT_ALERT_AFTER if error_code(ex) in PERMANENT_CODES else FAIL_ALERT_AFTER):
        st.problems.append(
            {
                "text": with_hint(f"Abruf schlägt {n}x in Folge fehl: {url}\n  {ex}", error_code(ex)),
                "counter": (key, "fail"),
                "value": n,
            }
        )


def is_too_short(old, text, opts):
    min_ratio = float(opts.get("min_ratio", DEFAULT_MIN_RATIO))
    return old is not None and len(old) >= GUARD_MIN_CHARS and len(text) < len(old) * min_ratio


def record_short_text(store, st, entry, prev, url, name, kind, old, text):
    key = url_key(url)
    n = store.counter(key, "short") + 1
    store.set_counter(key, "short", n)
    msg = f"nur {len(text)} statt {len(old)} Zeichen (Cookie-Wand oder Bot-Block?)"
    entry.update(status="warn", error=msg, code="content", checked=prev.get("checked", "-"), streak=n)
    print(f"[WARNUNG]   {name} [{kind}] {msg}, Snapshot bleibt unverändert (Versuch {n} in Folge)")
    if n == GUARD_ALERT_AFTER:
        st.problems.append(
            {
                "text": with_hint(f"Seite liefert kaum Text ({n}x in Folge): {url}\n  {msg}", "content"),
                "counter": (key, "short"),
                "value": n,
            }
        )


def send_change_mail(store, st, history, new_history):
    """Versendet die Änderungsmail und übernimmt danach Snapshots, Verlauf und Cache. Liefert False bei Mailfehler."""
    if not st.changes:
        return True
    print(f"Sende Änderungs-Mail an {os.environ.get('MAIL_TO', '?')}...")
    sent_ok = True
    try:
        notify.send_mail(subject_for(st.changes), render_text(st.changes), render_html(st.changes))
    except Exception as ex:
        sent_ok = False
        print(
            f"[MAILFEHLER] {ex}\n  Snapshots der {len(st.pending)} geänderten Seite(n) bleiben unverändert, "
            "die Änderung wird beim nächsten Lauf erneut erkannt."
        )
    for p in st.pending:
        if sent_ok:
            store.set_snapshot(p["key"], p["change"]["url"], p["text"])
            p["entry"]["changed"] = st.stamp
            record = {**p["change"], "time": st.stamp}
            history.append(record)
            new_history.append(record)
            if p["cache"]:
                st.new_cache[p["change"]["url"]] = p["cache"]
        else:
            p["entry"].update(status="error", error="Änderung erkannt, Mailversand fehlgeschlagen (wird wiederholt)")
    return sent_ok


def send_problem_mail(store, st):
    if not st.problems:
        return True
    try:
        notify.send_mail("Watchlist: Probleme beim Abruf", "\n\n".join(p["text"] for p in st.problems))
    except Exception as ex:
        print(f"[MAILFEHLER] Problemmeldung konnte nicht gesendet werden: {ex}")
        for p in st.problems:  # Zähler zurücksetzen, damit die Warnung beim nächsten Lauf erneut ausgelöst wird
            store.set_counter(*p["counter"], p["value"] - 1)
        return False
    return True


def main(argv):
    if len(argv) >= 3 and argv[1] == "--alert":
        notify.send_mail("Watchlist: Workflow fehlgeschlagen", argv[2])
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
