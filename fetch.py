import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, cast
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

from errors import CheckError, error_code, status_code_name
from models import Options, Validators
from parse import extract
from settings import SETTINGS

ROBOTS_AGENT = "watchlist"
RETRY_DELAYS = (2, 5)  # Delay in seconds before the second and third attempt.
MAX_RETRY_AFTER = 30
RETRY_JITTER = 0.25  # Up to 25% random jitter so retries do not run in lockstep.
MAX_PER_HOST = 2  # Concurrent fetches per host (be considerate of servers).
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FetchResult = tuple[str | None, str | None, bool, Validators]  # (title, text, is_feed, validators); text is None on 304.
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "en,de;q=0.8"}


def robots_allowed(url: str, cache: dict[str, RobotFileParser]) -> bool:
    """Checks robots.txt once per host. If the file is missing or unreadable, everything is allowed."""
    parts = urlparse(url)
    base = f"{parts.scheme}://{parts.netloc}"
    if base not in cache:
        rp = RobotFileParser()
        try:
            r = requests.get(f"{base}/robots.txt", headers=HEADERS, timeout=15)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            else:
                rp.parse([])  # Empty rules: allow everything.
        except requests.RequestException:
            rp.parse([])
        cache[base] = rp
    return cache[base].can_fetch(ROBOTS_AGENT, url)


def get_with_retry(url: str, headers: dict[str, str]) -> requests.Response:
    """GET with retries for network errors, timeouts, 429, and 5xx. Other 4xx responses are returned immediately."""
    last: str | None = None
    last_code = ""
    delay = 0
    for attempt in range(len(RETRY_DELAYS) + 1):
        if attempt:
            wait = round(delay + random.uniform(0, delay * RETRY_JITTER), 1)
            print(f"            Retry {attempt}/{len(RETRY_DELAYS)} in {wait}s ({last})")
            time.sleep(wait)
        delay = RETRY_DELAYS[attempt] if attempt < len(RETRY_DELAYS) else 0
        try:
            resp = requests.get(url, headers=headers, timeout=30)
        except (requests.ConnectionError, requests.Timeout) as ex:
            last = type(ex).__name__
            last_code = error_code(ex)
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            last = f"HTTP {resp.status_code}"
            last_code = status_code_name(resp.status_code)
            retry_after = resp.headers.get("Retry-After", "")
            if retry_after.isdigit():
                delay = min(int(retry_after), MAX_RETRY_AFTER)
            continue
        return resp
    raise CheckError(f"Fetch failed after {len(RETRY_DELAYS) + 1} attempts ({last})", last_code)


class BrowserPool:
    """One Chromium instance for all js pages in a run. Start it only when first needed.

    Playwright's sync API is bound to the thread that starts it, so all calls run
    through a dedicated single-thread executor, regardless of the calling worker (which also serializes them).
    """

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="browser")
        self._playwright: Any = None
        self._browser: Any = None

    def content(self, url: str) -> str:
        return self._executor.submit(self._content, url).result()

    def close(self) -> None:
        try:
            self._executor.submit(self._stop).result()
        finally:
            self._executor.shutdown()

    def _start(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError("js: true requires Playwright (uv run --extra js check.py)") from None
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch()

    def _stop(self) -> None:
        try:
            if self._browser is not None:
                self._browser.close()
        finally:
            if self._playwright is not None:
                self._playwright.stop()
            self._browser = self._playwright = None

    def _content(self, url: str) -> str:
        if self._browser is not None and not self._browser.is_connected():
            self._stop()  # Browser crashed; restart on the next call.
        if self._browser is None:
            self._start()
        page = self._browser.new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, wait_until="networkidle", timeout=60000)
            return str(page.content())
        finally:
            page.close()


_browser_pool: BrowserPool | None = None  # Set by fetch_all for each run.


def fetch_body(url: str, js: bool, cond: Validators | None = None) -> tuple[str | None, Validators]:
    """Returns (body, validators). Body is None when the server responds with 304."""
    if js:
        if _browser_pool is not None:
            return _browser_pool.content(url), Validators()
        pool = BrowserPool()  # Standalone call (e.g. add.py): use and then close its own browser.
        try:
            return pool.content(url), Validators()
        finally:
            pool.close()
    headers = dict(HEADERS)
    cond = cond or Validators()
    if cond.get("etag"):
        headers["If-None-Match"] = cond["etag"]
    if cond.get("last_modified"):
        headers["If-Modified-Since"] = cond["last_modified"]
    resp = get_with_retry(url, headers)
    if resp.status_code == 304:
        return None, cond
    if resp.status_code in (404, 410):
        raise CheckError(f"Page no longer exists (HTTP {resp.status_code}), persistent error", status_code_name(resp.status_code))
    resp.raise_for_status()
    if "charset" not in resp.headers.get("Content-Type", "").lower():
        resp.encoding = "utf-8"
    validators = {
        "etag": resp.headers.get("ETag"),
        "last_modified": resp.headers.get("Last-Modified"),
    }
    return resp.text, cast(Validators, {k: v for k, v in validators.items() if v})


def fetch(url: str, opts: Options, cond: Validators | None = None) -> FetchResult:
    """Returns (title, text, is_feed, validators). Text is None on 304 Not Modified."""
    body, validators = fetch_body(url, opts.get("js", False), cond)
    if body is None:
        return None, None, False, validators
    title, text, feed = extract(body, opts)
    return title, text, feed, validators


def fetch_all(jobs: list[tuple[Options, Validators]]) -> dict[str, FetchResult | Exception]:
    """Fetches all pages in parallel. jobs: [(opts, cond)]. Returns {url: result tuple or exception}.

    At most MAX_PER_HOST fetches per host run concurrently. Pages with js: true run sequentially
    (using one shared Playwright browser per run; see BrowserPool). Evaluation remains serial and deterministic in run().
    """
    robots: dict[str, RobotFileParser] = {}
    robots_lock, js_lock = threading.Lock(), threading.Lock()
    host_limits = {urlparse(o["url"]).netloc: threading.Semaphore(MAX_PER_HOST) for o, _ in jobs}

    def work(opts: Options, cond: Validators) -> tuple[str, FetchResult | Exception]:
        url = opts["url"]
        with host_limits[urlparse(url).netloc]:
            try:
                if not opts.get("ignore_robots"):
                    with robots_lock:
                        allowed = robots_allowed(url, robots)
                    if not allowed:
                        raise CheckError("robots.txt blocks the fetch (set ignore_robots: true to override)", "robots")
                if opts.get("js"):
                    with js_lock:
                        return url, fetch(url, opts, cond)
                return url, fetch(url, opts, cond)
            except Exception as ex:
                return url, ex

    global _browser_pool
    if not jobs:
        return {}
    _browser_pool = BrowserPool() if any(o.get("js") for o, _ in jobs) else None
    try:
        with ThreadPoolExecutor(max_workers=SETTINGS.max_workers) as pool:
            return dict(pool.map(lambda job: work(*job), jobs))
    finally:
        if _browser_pool is not None:
            _browser_pool.close()
        _browser_pool = None
