"""Auto-diagnosis for URLs that keep failing: probes likely causes and suggests a concrete fix.

Runs once, when a URL reaches DIAGNOSE_AFTER failed runs in a row. All probes are best-effort and never raise.
"""

from typing import Any, cast
from urllib.parse import urlparse, urlunparse

import requests

import fetch
from errors import CheckError
from models import Diagnosis, Options
from netsafe import safe_get
from parse import extract

DIAGNOSE_AFTER = 2
MIN_JS_CHARS = 200  # A rendered page needs at least this much text to count as "works".
PROBE_TIMEOUT = 20
FIX_JS = "js"
FIX_URL = "url"
FIX_ROBOTS = "ignore_robots"
FIX_SELECTOR = "selector"


def diagnose(opts: Options, code: str, message: str, min_chars: int = 0) -> Diagnosis | None:
    """Returns a suggestion for the failure, or None if nothing helpful was found."""
    url = opts["url"]
    try:
        if code == "robots":
            return {
                "text": "robots.txt blocks automated fetches. If monitoring this page is permitted, set ignore_robots: true.",
                "fix": {"type": FIX_ROBOTS},
            }
        if code == "selector":
            return _selector(opts)
        if code in ("http_404", "http_410", "connection"):
            moved = _moved_url(url)
            if moved:
                return {
                    "text": f"The page moved: {moved} answers instead of the configured URL.",
                    "fix": {"type": FIX_URL, "url": moved},
                }
            return None
        if code in ("redirects", "http_403", "http_401", "content", "timeout"):
            moved = _moved_url(url) if code == "redirects" else None
            if moved:
                return {
                    "text": f"The page moved: {moved} answers instead of the configured URL.",
                    "fix": {"type": FIX_URL, "url": moved},
                }
            if opts.get("js"):
                return None  # Already rendering with a browser.
            if _js_works(opts, min_chars=max(MIN_JS_CHARS, min_chars)):
                why = {"redirects": "a redirect loop", "content": "too little text", "http_403": "an HTTP 403"}.get(
                    code, "this error"
                )
                return {"text": f"Rendering with a browser loads the page despite {why}: set js: true.", "fix": {"type": FIX_JS}}
    except Exception as ex:
        print(f"[diagnose] {url}: {ex}")
    return None


def _selector(opts: Options) -> Diagnosis | None:
    """The selector no longer matches: check whether automatic content detection finds the page text."""
    if opts.get("selector") == "auto":
        return None
    try:
        body, _ = fetch.fetch_body(opts["url"], bool(opts.get("js")))
        if body is None:
            return None
        _, text, _ = extract(body, cast(Any, {**opts, "selector": "auto"}))
    except (CheckError, requests.RequestException):
        return None
    if len(text) >= MIN_JS_CHARS:
        return {
            "text": "The selector no longer matches, but automatic detection finds the content: use selector: auto.",
            "fix": {"type": FIX_SELECTOR},
        }
    return None


def _variants(url: str) -> list[str]:
    """Cheap URL guesses: https, www toggle, trailing slash toggle."""
    p = urlparse(url)
    hosts = [p.netloc]
    hosts.append(p.netloc[4:] if p.netloc.startswith("www.") else "www." + p.netloc)
    paths = [p.path, p.path[:-1] if p.path.endswith("/") and len(p.path) > 1 else p.path + "/"]
    out: list[str] = []
    for scheme in ("https", p.scheme):
        for host in hosts:
            for path in paths:
                cand = urlunparse(p._replace(scheme=scheme, netloc=host, path=path))
                if cand != url and cand not in out:
                    out.append(cand)
    return out[:6]


def _moved_url(url: str) -> str | None:
    """A variant of the URL that answers with 200 (after following redirects) and the URL it ends up at."""
    for cand in [url, *_variants(url)]:
        try:
            resp = safe_get(cand, fetch.HEADERS, PROBE_TIMEOUT)
        except (CheckError, requests.RequestException):
            continue
        if resp.status_code == 200:
            final = getattr(resp, "url", None) or cand
            final = cand if not isinstance(final, str) else final
            return None if final == url else final
    return None


def _js_works(opts: Options, min_chars: int) -> bool:
    """Whether rendering with Chromium produces enough text. Returns False when Playwright is unavailable."""
    try:
        _, text, _, _ = fetch.fetch(opts["url"], cast(Any, {**opts, "js": True}))
    except Exception:
        return False
    return text is not None and len(text) >= min_chars
