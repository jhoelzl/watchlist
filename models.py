"""Typen für die Daten, die zwischen den Modulen wandern. Zur Laufzeit sind alle einfache dicts (JSON in Supabase)."""

from typing import NotRequired, TypedDict


class Options(TypedDict, total=False):
    """Ein Eintrag aus urls.yml bzw. watchlist_urls (nach merge_config mit den Defaults)."""

    url: str
    name: str
    group: str
    selector: str | None
    js: bool
    ignore: list[str]
    only_added: bool
    ignore_robots: bool
    min_ratio: float
    interval: str


class Validators(TypedDict, total=False):
    """HTTP-Cache-Werte (ETag, Last-Modified) und der Hash der Optionen, mit denen sie gelten."""

    etag: str
    last_modified: str
    config: str


class UrlStatus(TypedDict, total=False):
    """Status einer URL im Dokument "status"."""

    name: str
    group: str
    checked: str
    changed: str
    status: str
    error: str
    code: str
    streak: int


class Change(TypedDict):
    """Eine erkannte Änderung mit gekürztem Diff."""

    name: str
    url: str
    group: str | None
    diff: list[str]
    extra: int
    variants: NotRequired[list[str]]


class HistoryEntry(Change):
    time: str


class Pending(TypedDict):
    """Änderung, die erst nach erfolgreichem Mailversand übernommen wird."""

    change: Change
    key: str
    text: str
    entry: UrlStatus
    cache: Validators | None


class Problem(TypedDict):
    """Warnung für die Problem-Mail. Counter und value setzen den Zähler zurück, falls der Versand scheitert."""

    text: str
    counter: tuple[str, str]
    value: int


class RunSummary(TypedDict):
    time: str
    seconds: float
    total: int
    errors: int
    warns: int
    changes: int
    ok: bool
