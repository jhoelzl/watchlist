import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

from errors import CheckError, error_code, status_code_name
from parse import extract

ROBOTS_AGENT = "watchlist"
RETRY_DELAYS = (2, 5)  # Wartezeit in Sekunden vor dem 2. und 3. Versuch
MAX_RETRY_AFTER = 30
RETRY_JITTER = 0.25  # bis zu +25 % Zufall auf die Wartezeit, damit Wiederholungen nicht im Gleichschritt laufen
MAX_WORKERS = 6  # parallele Abrufe insgesamt
MAX_PER_HOST = 2  # gleichzeitige Abrufe pro Host (Rücksicht auf Server)
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "de,en;q=0.8"}


def robots_allowed(url, cache):
    """Prüft robots.txt pro Host (einmal pro Lauf). Fehlt die Datei oder ist sie nicht lesbar, ist alles erlaubt."""
    parts = urlparse(url)
    base = f"{parts.scheme}://{parts.netloc}"
    if base not in cache:
        rp = RobotFileParser()
        try:
            r = requests.get(f"{base}/robots.txt", headers=HEADERS, timeout=15)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            else:
                rp.parse([])  # leere Regeln: alles erlaubt
        except requests.RequestException:
            rp.parse([])
        cache[base] = rp
    return cache[base].can_fetch(ROBOTS_AGENT, url)


def get_with_retry(url, headers):
    """GET mit Wiederholung bei Netzwerkfehlern, Timeouts, 429 und 5xx. Andere 4xx werden sofort zurückgegeben."""
    last = None
    last_code = ""
    delay = 0
    for attempt in range(len(RETRY_DELAYS) + 1):
        if attempt:
            wait = round(delay + random.uniform(0, delay * RETRY_JITTER), 1)
            print(f"            Wiederholung {attempt}/{len(RETRY_DELAYS)} in {wait}s ({last})")
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
    raise CheckError(f"Abruf nach {len(RETRY_DELAYS) + 1} Versuchen fehlgeschlagen ({last})", last_code)


class BrowserPool:
    """Ein Chromium für alle js-Seiten eines Laufs. Starten erst beim ersten Bedarf.

    Playwrights Sync-API ist an den Thread gebunden, der sie startet. Deshalb laufen alle Aufrufe
    über einen eigenen Ein-Thread-Executor, egal aus welchem Worker sie kommen (das serialisiert sie auch).
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
            raise RuntimeError("js: true braucht Playwright (uv run --extra js check.py)") from None
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
            self._stop()  # Browser abgestürzt: beim nächsten Aufruf neu starten
        if self._browser is None:
            self._start()
        page = self._browser.new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, wait_until="networkidle", timeout=60000)
            return str(page.content())
        finally:
            page.close()


_browser_pool: BrowserPool | None = None  # wird von fetch_all pro Lauf gesetzt


def fetch_body(url, js, cond=None):
    """Liefert (Body, Validatoren). Body ist None, wenn der Server 304 antwortet."""
    if js:
        if _browser_pool is not None:
            return _browser_pool.content(url), {}
        pool = BrowserPool()  # Einzelaufruf (z. B. add.py): eigener Browser, danach wieder schließen
        try:
            return pool.content(url), {}
        finally:
            pool.close()
    headers = dict(HEADERS)
    cond = cond or {}
    if cond.get("etag"):
        headers["If-None-Match"] = cond["etag"]
    if cond.get("last_modified"):
        headers["If-Modified-Since"] = cond["last_modified"]
    resp = get_with_retry(url, headers)
    if resp.status_code == 304:
        return None, cond
    if resp.status_code in (404, 410):
        raise CheckError(
            f"Seite nicht mehr vorhanden (HTTP {resp.status_code}), dauerhafter Fehler", status_code_name(resp.status_code)
        )
    resp.raise_for_status()
    if "charset" not in resp.headers.get("Content-Type", "").lower():
        resp.encoding = "utf-8"
    validators = {
        "etag": resp.headers.get("ETag"),
        "last_modified": resp.headers.get("Last-Modified"),
    }
    return resp.text, {k: v for k, v in validators.items() if v}


def fetch(url, opts, cond=None):
    """Liefert (Titel, Text, ist_feed, Validatoren). Text ist None bei 304 Not Modified."""
    body, validators = fetch_body(url, opts.get("js", False), cond)
    if body is None:
        return None, None, False, validators
    title, text, feed = extract(body, opts)
    return title, text, feed, validators


def fetch_all(jobs):
    """Ruft alle Seiten parallel ab. jobs: [(opts, cond)]. Liefert {url: Ergebnis-Tupel oder Exception}.

    Pro Host laufen höchstens MAX_PER_HOST Abrufe gleichzeitig. Seiten mit js: true laufen nacheinander
    (ein gemeinsamer Playwright-Browser pro Lauf, siehe BrowserPool). Die Auswertung bleibt seriell und deterministisch in run().
    """
    robots: dict[str, RobotFileParser] = {}
    robots_lock, js_lock = threading.Lock(), threading.Lock()
    host_limits = {urlparse(o["url"]).netloc: threading.Semaphore(MAX_PER_HOST) for o, _ in jobs}

    def work(opts, cond):
        url = opts["url"]
        with host_limits[urlparse(url).netloc]:
            try:
                if not opts.get("ignore_robots"):
                    with robots_lock:
                        allowed = robots_allowed(url, robots)
                    if not allowed:
                        raise CheckError("robots.txt verbietet den Abruf (ignore_robots: true zum Überschreiben)", "robots")
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
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            return dict(pool.map(lambda job: work(*job), jobs))
    finally:
        if _browser_pool is not None:
            _browser_pool.close()
        _browser_pool = None
