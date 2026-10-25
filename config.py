import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import yaml

from models import Options, UrlStatus

# Minimum delay per interval option. Slightly under one day or week so the run cadence (06:00/18:00) stays aligned.
INTERVAL_HOURS: dict[str, int] = {"daily": 20, "weekly": 160}


# A quantified group inside a quantifier, e.g. (a+)+ or (.*)*: a classic catastrophic-backtracking pattern.
NESTED_QUANTIFIER = re.compile(r"\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]")
MAX_PATTERN_LENGTH = 300


def is_due(opts: Options, prev: UrlStatus, now: datetime, has_snapshot: bool = True) -> bool:
    """Whether to check the URL during this run. Always check without an interval; never skip problems or new URLs."""
    hours = INTERVAL_HOURS.get(opts.get("interval", ""))
    if not hours or not has_snapshot or prev.get("status") not in ("ok", "new"):
        return True
    try:
        last = datetime.strptime(prev.get("checked", ""), "%Y-%m-%d %H:%M UTC").replace(tzinfo=UTC)
    except ValueError:
        return True
    return now - last >= timedelta(hours=hours)


def config_errors(opts: Options) -> list[str]:
    """Validates a URL ignore regex. Returns readable error messages (empty means valid)."""
    errors: list[str] = []
    if opts.get("interval") not in (None, *INTERVAL_HOURS):
        errors.append(f"interval must be daily or weekly: {opts.get('interval')!r}")
    for pattern in opts.get("ignore", []):
        if not isinstance(pattern, str):
            errors.append(f"ignore entry is not a string: {pattern!r}")
            continue
        if len(pattern) > MAX_PATTERN_LENGTH:
            errors.append(f"ignore regex is too long ({len(pattern)} > {MAX_PATTERN_LENGTH} characters): {pattern[:40]}...")
            continue
        try:
            re.compile(pattern)
        except re.error as ex:
            errors.append(f"invalid ignore regex {pattern!r}: {ex}")
            continue
        if NESTED_QUANTIFIER.search(pattern):
            errors.append(f"ignore regex {pattern!r} may become catastrophically slow (nested quantifiers, e.g. (a+)+)")
    return errors


def load_config(path: Path) -> list[Options]:
    return merge_config(yaml.safe_load(path.read_text()) or [])


def merge_config(raw: Any) -> list[Options]:
    """Accepts a plain list or {defaults: {...}, urls: [...]}."""
    defaults, urls = ({}, raw) if isinstance(raw, list) else (raw.get("defaults") or {}, raw.get("urls") or [])
    entries: list[Options] = []
    for item in urls:
        e = {"url": item} if isinstance(item, str) else dict(item)
        merged = {**defaults, **e}
        merged["ignore"] = as_list(defaults.get("ignore")) + as_list(e.get("ignore"))
        entries.append(cast(Options, merged))
    return entries


def as_list(value: Any) -> list[Any]:
    """A single string (instead of a list) counts as one entry and is not split into characters."""
    if value is None:
        return []
    return [value] if isinstance(value, str) else list(value)


def config_hash(opts: Options) -> str:
    relevant = {k: opts.get(k) for k in ("selector", "ignore", "js")}
    return hashlib.sha1(json.dumps(relevant, sort_keys=True).encode()).hexdigest()[:12]
