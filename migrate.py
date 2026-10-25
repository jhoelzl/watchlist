"""One-time migration to Supabase: uv run migrate.py [--state-dir DIR] [--config urls.yml]

Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (or SUPABASE_DB_URL) and the schema (supabase/schema.sql).
Migrates URLs, defaults, snapshots, counters, status, metadata, HTTP cache, and history. Safe to run multiple times.
The state branch provides the snapshot directory: git worktree add /tmp/wl-state state, then use --state-dir /tmp/wl-state/state.
"""

import argparse
import hashlib
import sys
from pathlib import Path

import check
import config
from store import COUNTER_KINDS, FileStore, PgStore, open_store


def url_key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def migrate(files: FileStore, db: PgStore) -> dict[str, int]:
    raw = files.raw_config()
    defaults, urls = ({}, raw) if isinstance(raw, list) else (raw.get("defaults") or {}, raw.get("urls") or [])
    db.set_defaults(defaults)
    known = {e["url"] for e in config.merge_config(db.raw_config())}
    added = 0
    for e in urls:
        entry = {"url": e} if isinstance(e, str) else dict(e)
        if entry["url"] not in known:
            db.add_url(entry)
            added += 1

    status = files.doc("status", {})
    by_key = {url_key(u): u for u in [*status, *(e["url"] if isinstance(e, dict) else e for e in urls)]}
    snapshots = counters = 0
    for key in sorted(files.snapshot_keys()):
        db.set_snapshot(key, by_key.get(key, ""), files.snapshot(key) or "")
        snapshots += 1
    for key in by_key:
        for kind in COUNTER_KINDS:
            if (files.state / f"{key}.{kind}").exists():
                db.set_counter(key, kind, files.counter(key, kind))
                counters += 1

    for name in ("status", "meta", "http"):
        db.set_doc(name, files.doc(name, {}))
    history = files.doc("history", [])
    migrated = 0
    if history and not db.history(1):
        db.add_history(history, len(history))
        migrated = len(history)
    return {"urls": added, "snapshots": snapshots, "counters": counters, "history": migrated}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state-dir", type=Path, default=check.STATE)
    ap.add_argument("--config", type=Path, default=check.ROOT / "urls.yml")
    args = ap.parse_args(argv)
    if not args.config.exists():
        sys.exit(f"{args.config} not found.")
    if not args.state_dir.exists():
        print(f"Note: {args.state_dir} is missing; only URLs will be migrated.")
    db = open_store(args.state_dir, args.config)
    if isinstance(db, FileStore):
        sys.exit("No database configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_DB_URL).")
    try:
        files = FileStore(args.state_dir, args.config)
        result = migrate(files, db)
    finally:
        db.close()
    print("Migrated: " + ", ".join(f"{v} {k}" for k, v in result.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
