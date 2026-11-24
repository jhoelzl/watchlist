"""Generate a read-only JavaScript comparison for one configured URL."""

import sys
from datetime import UTC, datetime
from typing import Any

from config import config_errors, merge_config
from fetch import fetch_all
from store import FileStore, PgStore


def review(store: FileStore | PgStore, url: str, key: str) -> bool:
    original_config: Any = store.raw_config()
    raw: dict[str, Any] = original_config if isinstance(original_config, dict) else {"urls": original_config}
    entries = merge_config(raw)
    opts = next((entry for entry in entries if entry["url"] == url), None)
    record: dict[str, Any] = {"url": url, "time": datetime.now(UTC).isoformat()}
    try:
        if opts is None:
            raise ValueError("URL is not active or no longer exists.")
        if opts.get("js"):
            raise ValueError("JavaScript is already enabled.")
        errors = config_errors(opts)
        if errors:
            raise ValueError("; ".join(errors))
        baseline = store.snapshot(key)
        if baseline is None:
            raise ValueError("No saved snapshot exists yet.")
        original = next(
            {"url": row} if isinstance(row, str) else row
            for row in raw["urls"]
            if (row if isinstance(row, str) else row["url"]) == url
        )
        options = {k: v for k, v in original.items() if k not in ("url", "name", "group")}
        result = fetch_all([({**opts, "js": True}, {})])[url]
        if isinstance(result, Exception):
            raise result
        _, rendered, feed, _ = result
        if rendered is None or not rendered.strip():
            raise ValueError("The rendered page returned no text.")
        if feed:
            raise ValueError("This URL is a feed, not a JavaScript page.")
        if store.snapshot(key) != baseline or store.raw_config() != original_config:
            raise ValueError("The snapshot or configuration changed during the comparison. Try again.")
        record.update({"baseline": baseline, "rendered": rendered, "options": options, "defaults": raw.get("defaults", {})})
    except Exception as exc:
        record["error"] = str(exc)[:500]
        print(f"[review] {url}: {exc}", file=sys.stderr)
    store.set_doc("review:" + key, record)
    return "error" not in record
