import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import yaml

from models import Options, UrlStatus

# Mindestabstand pro interval-Option. Knapp unter 1 Tag bzw. 1 Woche, damit der Takt der Läufe (06:00/18:00) nicht davonläuft.
INTERVAL_HOURS: dict[str, int] = {"daily": 20, "weekly": 160}


# Quantifizierte Gruppe mit Quantifizierer, z. B. (a+)+ oder (.*)*: klassisches Muster für katastrophales Backtracking.
NESTED_QUANTIFIER = re.compile(r"\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]")
MAX_PATTERN_LENGTH = 300


def is_due(opts: Options, prev: UrlStatus, now: datetime, has_snapshot: bool = True) -> bool:
    """Ob die URL in diesem Lauf geprüft wird. Ohne interval immer; Probleme und neue URLs werden nie übersprungen."""
    hours = INTERVAL_HOURS.get(opts.get("interval", ""))
    if not hours or not has_snapshot or prev.get("status") not in ("ok", "new"):
        return True
    try:
        last = datetime.strptime(prev.get("checked", ""), "%Y-%m-%d %H:%M UTC").replace(tzinfo=UTC)
    except ValueError:
        return True
    return now - last >= timedelta(hours=hours)


def config_errors(opts: Options) -> list[str]:
    """Prüft die ignore-Regex einer URL. Liefert eine Liste verständlicher Fehlermeldungen (leer = alles gut)."""
    errors: list[str] = []
    if opts.get("interval") not in (None, *INTERVAL_HOURS):
        errors.append(f"interval muss daily oder weekly sein: {opts.get('interval')!r}")
    for pattern in opts.get("ignore", []):
        if not isinstance(pattern, str):
            errors.append(f"ignore-Eintrag ist kein Text: {pattern!r}")
            continue
        if len(pattern) > MAX_PATTERN_LENGTH:
            errors.append(f"ignore-Regex zu lang ({len(pattern)} > {MAX_PATTERN_LENGTH} Zeichen): {pattern[:40]}...")
            continue
        try:
            re.compile(pattern)
        except re.error as ex:
            errors.append(f"ungültige ignore-Regex {pattern!r}: {ex}")
            continue
        if NESTED_QUANTIFIER.search(pattern):
            errors.append(
                f"ignore-Regex {pattern!r} kann katastrophal langsam werden (verschachtelte Quantifizierer, z. B. (a+)+)"
            )
    return errors


def load_config(path: Path) -> list[Options]:
    return merge_config(yaml.safe_load(path.read_text()) or [])


def merge_config(raw: Any) -> list[Options]:
    """Akzeptiert eine reine Liste oder {defaults: {...}, urls: [...]}."""
    defaults, urls = ({}, raw) if isinstance(raw, list) else (raw.get("defaults") or {}, raw.get("urls") or [])
    entries: list[Options] = []
    for item in urls:
        e = {"url": item} if isinstance(item, str) else dict(item)
        merged = {**defaults, **e}
        merged["ignore"] = as_list(defaults.get("ignore")) + as_list(e.get("ignore"))
        entries.append(cast(Options, merged))
    return entries


def as_list(value: Any) -> list[Any]:
    """Ein einzelner Text (statt Liste) zählt als ein Eintrag und wird nicht in Zeichen zerlegt."""
    if value is None:
        return []
    return [value] if isinstance(value, str) else list(value)


def config_hash(opts: Options) -> str:
    relevant = {k: opts.get(k) for k in ("selector", "ignore", "js")}
    return hashlib.sha1(json.dumps(relevant, sort_keys=True).encode()).hexdigest()[:12]
