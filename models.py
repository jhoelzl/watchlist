"""Types for data passed between modules. At runtime, all values are plain dicts (JSON in Supabase)."""

from typing import NotRequired, TypedDict


class Options(TypedDict, total=False):
    """An entry from urls.yml or watchlist_urls (after merge_config applies defaults)."""

    url: str
    name: str
    group: str
    selector: str | None
    js: bool
    screenshot: bool
    summary: bool
    ignore: list[str]
    only_added: bool
    ignore_robots: bool
    min_ratio: float
    interval: str


class Diagnosis(TypedDict):
    """Suggested fix for a failing URL. fix = {"type": "js" | "url" | "ignore_robots" | "selector", "url": new URL}."""

    text: str
    fix: dict[str, str]


class Validators(TypedDict, total=False):
    """HTTP cache values (ETag, Last-Modified) and the hash of the options they apply to."""

    etag: str
    last_modified: str
    config: str


class UrlStatus(TypedDict, total=False):
    """Status of a URL in the "status" document."""

    name: str
    group: str
    checked: str
    changed: str
    status: str
    error: str
    code: str
    streak: int
    diagnosis: Diagnosis


class Change(TypedDict):
    """A detected change with a truncated diff."""

    name: str
    url: str
    group: str | None
    diff: list[str]
    extra: int
    summary: NotRequired[str]
    variants: NotRequired[list[str]]


class HistoryEntry(Change):
    time: str


class Pending(TypedDict):
    """A change to apply only after the email is sent successfully."""

    change: Change
    key: str
    text: str
    entry: UrlStatus
    cache: Validators | None
    summarize: NotRequired[bool]


class Problem(TypedDict):
    """Warning for the problem email. counter and value restore the counter if delivery fails."""

    text: str
    counter: tuple[str, str]
    value: int


class HealthEntry(TypedDict):
    h: str
    ms: list[int]


class RunSummary(TypedDict):
    time: str
    seconds: float
    total: int
    errors: int
    warns: int
    changes: int
    ok: bool
