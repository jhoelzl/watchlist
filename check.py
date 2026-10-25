import difflib
import hashlib
import html
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
import yaml
from bs4 import BeautifulSoup, Tag

import dashboard
from store import open_store

ROOT = Path(__file__).parent
# Im Workflow liegen state/ und site/ auf dem Branch "state" (ausgecheckt in einem eigenen Verzeichnis).
STATE = Path(os.environ.get("WATCHLIST_STATE_DIR") or ROOT / "state")
STORE_DIFF_LINES = 500  # so viele Diff-Zeilen werden gespeichert (Dashboard)
MAIL_DIFF_LINES = 60  # und so viele davon stehen in der Mail
DIFF_CONTEXT = 3
MAX_HISTORY = 100
DEFAULT_GROUP = "Allgemein"
ROBOTS_AGENT = "watchlist"
# Textwächter: Eine Seite mit vorher mind. GUARD_MIN_CHARS Zeichen, die unter
# min_ratio (Standard 30 %) schrumpft, gilt als Fehlabruf (Cookie-Wand, Bot-Block).
GUARD_MIN_CHARS = 500
DEFAULT_MIN_RATIO = 0.3
GUARD_ALERT_AFTER = 2
FAIL_ALERT_AFTER = 3
STUCK_AFTER = 6  # Läufe in Folge (bei 2 Läufen pro Tag = 3 Tage), ab denen eine Seite als dauerhaft kaputt gilt
RETRY_DELAYS = (2, 5)  # Wartezeit in Sekunden vor dem 2. und 3. Versuch
MAX_RETRY_AFTER = 30
MAX_WORKERS = 6  # parallele Abrufe insgesamt
MAX_PER_HOST = 2  # gleichzeitige Abrufe pro Host (Rücksicht auf Server)
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "de,en;q=0.8"}


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def drop_blank_lines(text):
    return "\n".join(l for l in (l.strip() for l in text.splitlines()) if l)


def is_feed(body):
    head = body[:1000].lower()
    return "<rss" in head or "<feed" in head or "<rdf:rdf" in head


def parse_feed(body):
    """Liefert (Titel, Text) mit einer Zeile pro Eintrag."""
    root = ET.fromstring(body.encode("utf-8"))
    for el in root.iter():
        el.tag = el.tag.split("}")[-1]

    def txt(el, *names):
        for n in names:
            c = el.find(n)
            if c is not None and (c.text or "").strip():
                value = c.text
                if "<" in value:
                    value = BeautifulSoup(value, "html.parser").get_text(" ")
                return clean(value)
        return ""

    channel = root.find("channel")
    title = txt(channel if channel is not None else root, "title")
    lines = []
    for item in list(root.iter("item")) + list(root.iter("entry")):
        link = txt(item, "link")
        if not link:
            l = item.find("link")
            link = l.get("href", "") if l is not None else ""
        date = txt(item, "updated", "pubDate", "published", "date")
        summary = txt(item, "summary", "description", "content")[:500]
        lines.append(" | ".join(p for p in (date, txt(item, "title"), link, summary) if p))
    return title, "\n".join(lines)


AUTO_SELECTOR = "auto"
CANDIDATE_SELECTORS = ["main", "article", "[role=main]", "#main-content", "#content"]
SELECTOR_MIN_SHARE = 0.2  # Ein Selector muss mindestens so viel Text liefern wie die ganze Seite * Anteil


def auto_root(soup):
    """Erster Kandidat, der existiert und nicht fast leer ist, sonst die ganze Seite."""
    total = len(clean(soup.get_text(" ")))
    for sel in CANDIDATE_SELECTORS:
        node = soup.select_one(sel)
        if node is not None and total and len(clean(node.get_text(" "))) >= total * SELECTOR_MIN_SHARE:
            return node
    return soup


def parse_html(body, selector):
    soup = BeautifulSoup(body, "html.parser")
    title = clean(soup.title.get_text()) if soup.title else ""
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    root: BeautifulSoup | Tag = soup
    if selector == AUTO_SELECTOR:
        root = auto_root(soup)
    elif selector:
        found = soup.select_one(selector)
        if found is None:
            raise ValueError(f"Selector nicht gefunden: {selector}")
        root = found
    return title, drop_blank_lines("\n".join(clean(l) for l in root.get_text("\n").splitlines()))


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


def config_hash(opts):
    relevant = {k: opts.get(k) for k in ("selector", "ignore", "js")}
    return hashlib.sha1(json.dumps(relevant, sort_keys=True).encode()).hexdigest()[:12]


def get_with_retry(url, headers):
    """GET mit Wiederholung bei Netzwerkfehlern, Timeouts, 429 und 5xx. Andere 4xx werden sofort zurückgegeben."""
    last = None
    delay = 0
    for attempt in range(len(RETRY_DELAYS) + 1):
        if attempt:
            print(f"            Wiederholung {attempt}/{len(RETRY_DELAYS)} in {delay}s ({last})")
            time.sleep(delay)
        delay = RETRY_DELAYS[attempt] if attempt < len(RETRY_DELAYS) else 0
        try:
            resp = requests.get(url, headers=headers, timeout=30)
        except (requests.ConnectionError, requests.Timeout) as ex:
            last = type(ex).__name__
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            last = f"HTTP {resp.status_code}"
            retry_after = resp.headers.get("Retry-After", "")
            if retry_after.isdigit():
                delay = min(int(retry_after), MAX_RETRY_AFTER)
            continue
        return resp
    raise RuntimeError(f"Abruf nach {len(RETRY_DELAYS) + 1} Versuchen fehlgeschlagen ({last})")


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
    feed = is_feed(body)
    title, text = parse_feed(body) if feed else parse_html(body, opts.get("selector"))
    for pattern in opts.get("ignore", []):
        text = re.sub(pattern, "", text)
    return title, drop_blank_lines(text), feed, validators


def make_diff(old, new, only_added):
    old_l, new_l = old.splitlines(), new.splitlines()
    if only_added:
        seen = set(old_l)
        diff = ["+" + l for l in new_l if l not in seen]
    else:
        diff = [l for l in difflib.unified_diff(old_l, new_l, lineterm="", n=DIFF_CONTEXT) if not l.startswith(("---", "+++"))]
    extra = max(0, len(diff) - STORE_DIFF_LINES)
    return diff[:STORE_DIFF_LINES], extra


def fragment_url(url, diff):
    """URL mit Textfragment (#:~:text=) zur ersten hinzugefügten Zeile, damit der Browser dorthin springt."""
    for line in diff:
        if line.startswith("+") and not line.startswith("+++"):
            snippet = " ".join(line[1:].split()[:8])[:80]
            if len(snippet) >= 8:
                encoded = urllib.parse.quote(snippet, safe="").replace("-", "%2D")
                return f"{url}{':~:text=' if '#' in url else '#:~:text='}{encoded}"
    return url


def safe_link(url):
    """Verlinkt nur http(s)-URLs; alles andere (z. B. javascript:) bleibt reiner Text."""
    esc = html.escape(url)
    if urllib.parse.urlsplit(url.strip()).scheme.lower() in ("http", "https"):
        return f'<a href="{esc}">{esc}</a>'
    return esc


def mail_view(change):
    """Diff für die Mail: gekürzt auf MAIL_DIFF_LINES, der Rest zählt zu "weitere Zeilen"."""
    diff = change["diff"][:MAIL_DIFF_LINES]
    return diff, change["extra"] + len(change["diff"]) - len(diff)


TOKEN = re.compile(r"\s+|\w+|[^\w\s]")


def word_segments(old, new):
    """Teilt zwei ersetzte Zeilen in (Text, geändert)-Stücke, damit nur die tatsächlich geänderten Wörter hervorgehoben werden."""
    a, b = TOKEN.findall(old), TOKEN.findall(new)
    out_old: list[tuple[str, bool]] = []
    out_new: list[tuple[str, bool]] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            out_old.append(("".join(a[i1:i2]), False))
            out_new.append(("".join(b[j1:j2]), False))
        else:
            if i2 > i1:
                out_old.append(("".join(a[i1:i2]), True))
            if j2 > j1:
                out_new.append(("".join(b[j1:j2]), True))
    return out_old, out_new


def annotate_diff(diff):
    """Je Diff-Zeile eine Liste aus (Text, geändert)-Stücken. Aufeinanderfolgende -/+ Blöcke werden zeilenweise verglichen."""
    result: list[list[tuple[str, bool]] | None] = [None] * len(diff)
    i = 0
    while i < len(diff):
        if diff[i].startswith("-"):
            j = i
            while j < len(diff) and diff[j].startswith("-"):
                j += 1
            k = j
            while k < len(diff) and diff[k].startswith("+"):
                k += 1
            for n in range(min(j - i, k - j)):
                old, new = diff[i + n][1:], diff[j + n][1:]
                if difflib.SequenceMatcher(None, old, new, autojunk=False).quick_ratio() >= 0.5:
                    o, w = word_segments(old, new)
                    result[i + n] = [("-", False), *o]
                    result[j + n] = [("+", False), *w]
            i = k
        else:
            i += 1
    return [r if r is not None else [(line, False)] for r, line in zip(result, diff, strict=True)]


def diff_counts(diff):
    return (
        sum(1 for l in diff if l.startswith("+") and not l.startswith("+++")),
        sum(1 for l in diff if l.startswith("-") and not l.startswith("---")),
    )


def merge_variants(changes):
    """Fasst Einträge mit identischem Diff in derselben Gruppe zusammen (z. B. Tab-Varianten ?tabs=stt|tts)."""
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    for c in changes:
        key = (c.get("group"), tuple(c["diff"]), c["extra"])
        if key in merged:
            merged[key]["variants"].append(c["url"])
        else:
            merged[key] = {**c, "variants": []}
    return list(merged.values())


def group_changes(changes):
    groups: dict[str, list[dict[str, Any]]] = {}
    for c in changes:
        groups.setdefault(c.get("group") or DEFAULT_GROUP, []).append(c)
    return groups


def summary_line(changes):
    pages, groups = len(changes), len(group_changes(changes))
    return f"{pages} Seite{'n' if pages != 1 else ''} geändert in {groups} Gruppe{'n' if groups != 1 else ''}"


def render_text(changes):
    changes = merge_variants(changes)
    out = [summary_line(changes), ""] if len(changes) > 1 else []
    for group, items in group_changes(changes).items():
        out.append(f"=== {group} ===")
        for c in items:
            diff, extra = mail_view(c)
            out.append(f"{c['name']}\n{fragment_url(c['url'], c['diff'])}")
            if c.get("variants"):
                out.append("Gleicher Inhalt auch unter:")
                out += [f"  {v}" for v in c["variants"]]
            out.append("")
            out += diff
            if extra:
                out.append(f"... und {extra} weitere Zeilen (vollständig im Dashboard)")
            out.append("")
    return "\n".join(out).strip()


def render_html(changes):
    changes = merge_variants(changes)
    parts = ['<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">']
    grouped = group_changes(changes)
    if len(changes) > 1:
        parts.append(
            f'<p style="margin:0 0 8px"><strong>{summary_line(changes)}</strong></p><ul style="margin:0 0 8px;padding-left:20px">'
        )
        n = 0
        for gi, (group, items) in enumerate(grouped.items()):
            links = []
            for c in items:
                links.append(f'<a href="#c{n}">{html.escape(c["name"])}</a>')
                n += 1
            parts.append(f'<li><a href="#g{gi}"><strong>{html.escape(group)}</strong></a>: {", ".join(links)}</li>')
        parts.append("</ul>")
    n = 0
    for gi, (group, items) in enumerate(grouped.items()):
        parts.append(f'<h2 id="g{gi}" style="margin:28px 0 0;border-bottom:1px solid #d8dee4">{html.escape(group)}</h2>')
        for c in items:
            diff, extra = mail_view(c)
            added, removed = diff_counts(c["diff"])
            jump = fragment_url(c["url"], c["diff"])
            jump_link = (
                f' &middot; <a href="{html.escape(jump)}">zur geänderten Stelle</a>'
                if jump != c["url"] and safe_link(jump).startswith("<a")
                else ""
            )
            more = "".join(f"<br>{safe_link(v)}" for v in c.get("variants", []))
            if more:
                more = f'<span style="color:#6e7781;font-size:12px">Gleicher Inhalt auch unter:{more}</span>'
                more = f'<p style="margin:0 0 8px">{more}</p>'
            parts.append(
                f'<h3 id="c{n}" style="margin:16px 0 4px">{html.escape(c["name"])} '
                f'<span style="font-size:12px;font-weight:600"><span style="color:#116329">+{added}</span> '
                f'<span style="color:#82071e">&minus;{removed}</span></span></h3>'
                f'<p style="margin:0 0 8px">{safe_link(c["url"])}{jump_link}</p>{more}'
                '<pre style="background:#f6f8fa;padding:8px;white-space:pre-wrap;'
                'word-break:break-word;font-size:12px">'
            )
            n += 1
            for l, segments in zip(diff, annotate_diff(diff), strict=True):
                style = ""
                mark = ""
                if l.startswith("+"):
                    style = "background:#e6ffec;color:#116329"
                    mark = "background:#abf2bc;font-weight:600"
                elif l.startswith("-"):
                    style = "background:#ffebe9;color:#82071e"
                    mark = "background:#ffc1ba;font-weight:600"
                elif l.startswith("@@"):
                    style = "color:#6e7781"
                body = "".join(
                    f'<span style="{mark}">{html.escape(s)}</span>' if changed else html.escape(s) for s, changed in segments
                )
                parts.append(f'<div style="{style}">{body or "&nbsp;"}</div>')
            if extra:
                parts.append(f'<div style="color:#6e7781">... und {extra} weitere Zeilen (vollständig im Dashboard)</div>')
            parts.append("</pre>")
    parts.append("</div>")
    return "".join(parts)


def send_mail(subject, text, html_body=None):
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print("RESEND_API_KEY fehlt, Mail wird nur ausgegeben:\n", subject, "\n", text)
        return
    payload = {
        "from": os.environ.get("MAIL_FROM") or "onboarding@resend.dev",
        "to": [os.environ["MAIL_TO"]],
        "subject": subject,
        "text": text,
    }
    if html_body:
        payload["html"] = html_body
    r = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {key}"},
        json=payload,
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"Resend {r.status_code}: {r.text}")
    print(f"Mail gesendet: {subject} (Resend-ID {r.json().get('id')})")


# Quantifizierte Gruppe mit Quantifizierer, z. B. (a+)+ oder (.*)*: klassisches Muster für katastrophales Backtracking.
NESTED_QUANTIFIER = re.compile(r"\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]")
MAX_PATTERN_LENGTH = 300


def config_errors(opts):
    """Prüft die ignore-Regex einer URL. Liefert eine Liste verständlicher Fehlermeldungen (leer = alles gut)."""
    errors = []
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


def load_config(path):
    return merge_config(yaml.safe_load(path.read_text()) or [])


def merge_config(raw):
    """Akzeptiert eine reine Liste oder {defaults: {...}, urls: [...]}."""
    defaults, urls = ({}, raw) if isinstance(raw, list) else (raw.get("defaults") or {}, raw.get("urls") or [])
    entries = []
    for e in urls:
        e = {"url": e} if isinstance(e, str) else dict(e)
        merged = {**defaults, **e}
        merged["ignore"] = as_list(defaults.get("ignore")) + as_list(e.get("ignore"))
        entries.append(merged)
    return entries


def as_list(value):
    """Ein einzelner Text (statt Liste) zählt als ein Eintrag und wird nicht in Zeichen zerlegt."""
    if value is None:
        return []
    return [value] if isinstance(value, str) else list(value)


HINT_CONTENT = (
    "Vermutlich Cookie-Wand, Bot-Block oder per JavaScript geladene Inhalte: 'js: true' probieren oder Selector prüfen."
)
HINT_SELECTOR = (
    "Der Selector passt nicht mehr (Seite umgebaut?) oder die Inhalte kommen per JavaScript: Selector prüfen oder 'js: true'."
)
# (Muster im Fehlertext in Kleinbuchstaben, Hinweis mit möglicher Ursache und Abhilfe). Erster Treffer gewinnt.
HINTS = (
    (("robots.txt",), "Die Seite verbietet automatische Abrufe. Nur wenn das erlaubt ist: 'ignore_robots: true' setzen."),
    (("selector nicht gefunden",), HINT_SELECTOR),
    (("bot-block", "kaum text"), HINT_CONTENT + " Mit 'min_ratio' lässt sich der Textwächter anpassen."),
    (("403 client", "http 403"), "Der Server blockt den Abruf (Bot-Schutz?): 'js: true' probieren."),
    (("401 client", "http 401"), "Die Seite verlangt eine Anmeldung und ist so nicht überwachbar."),
    (("404 client", "http 404"), "Die Seite gibt es nicht mehr oder die URL hat sich geändert: URL in urls.yml prüfen."),
    (("410 client", "http 410"), "Die Seite wurde entfernt: URL in urls.yml prüfen oder Eintrag löschen."),
    (("429 client", "http 429"), "Rate-Limit: Der Server drosselt die Abrufe, meist hilft Abwarten."),
    (
        ("timeout",),
        "Der Server antwortet zu langsam oder gar nicht: Abwarten, bei Dauerproblem URL prüfen oder 'js: true' probieren.",
    ),
    (("connectionerror",), "Keine Verbindung zum Server (DNS, Netzwerk, Zertifikat): Host und URL prüfen."),
    (("server error", "http 5"), "Serverfehler auf der Gegenseite: meist vorübergehend, Abwarten."),
    (("konfigurationsfehler",), "Eintrag in urls.yml korrigieren (siehe Meldung)."),
)


def hint_for(error):
    """Kurzer Hinweis zu Ursache und Abhilfe passend zum Fehlertext, sonst leer."""
    low = (error or "").lower()
    for patterns, hint in HINTS:
        if any(p in low for p in patterns):
            return hint
    return ""


def with_hint(text, error):
    hint = hint_for(error)
    return f"{text}\n  Tipp: {hint}" if hint else text


def send_heartbeat(now, entries, status, history, meta):
    month = now.strftime("%Y-%m")
    if "heartbeat" not in meta:
        meta["heartbeat"] = month
        return
    if meta["heartbeat"] == month:
        return
    since = (now - timedelta(days=31)).strftime("%Y-%m-%d")
    recent = [h for h in history if h["time"][:10] >= since]
    failing = [(u, s) for u, s in status.items() if s["status"] in ("error", "warn")]
    lines = [
        f"Watchlist läuft. {len(entries)} Seite(n) werden geprüft.",
        f"Änderungen in den letzten 31 Tagen: {len(recent)}",
        "",
        "Pro Gruppe (Seiten / Änderungen / Probleme):",
    ]
    groups: dict[str, list[int]] = {}
    for s in status.values():
        groups.setdefault(s.get("group") or DEFAULT_GROUP, [0, 0, 0])[0] += 1
    for h in recent:
        groups.setdefault(h.get("group") or DEFAULT_GROUP, [0, 0, 0])[1] += 1
    for _, s in failing:
        groups[s.get("group") or DEFAULT_GROUP][2] += 1
    lines += [f"- {g}: {n} / {c} / {p}" for g, (n, c, p) in sorted(groups.items())]
    lines += ["", "Letzte Änderungen:"] + [f"- {h['time'][:10]} {h['name']}" for h in recent[-15:]]
    if not recent:
        lines.append("- keine")
    stuck = [(u, s) for u, s in failing if s.get("streak", 0) >= STUCK_AFTER]
    lines += ["", f"Seiten mit Problemen (Fehler/zu wenig Text): {len(failing)}"]
    lines += [f"- {s['name']}: {s['error']}" for _, s in failing]
    if stuck:
        lines += ["", f"Dauerhaft kaputt (seit mindestens {STUCK_AFTER} Läufen in Folge):"]
        for u, s in stuck:
            lines.append(with_hint(f"- {s['name']} ({u}): {s['error']} [{s['streak']} Läufe]", s["error"]))
    send_mail(f"Watchlist: Lebenszeichen {month}", "\n".join(lines))
    meta["heartbeat"] = month


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
                        raise RuntimeError("robots.txt verbietet den Abruf (ignore_robots: true zum Überschreiben)")
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


def run():
    store = open_store(STATE, ROOT / "urls.yml")
    try:
        return _run(store)
    finally:
        store.close()


def _run(store):
    now = datetime.now(UTC)
    stamp = now.strftime("%Y-%m-%d %H:%M UTC")
    entries = merge_config(store.raw_config())
    old_status = store.doc("status", {})
    history = store.history(MAX_HISTORY)
    new_history = []
    meta = store.doc("meta", {})
    status, changes, problems, pending = {}, [], [], []
    config_bad = []
    http_cache = store.doc("http", {})
    new_cache = {}

    print(f"Prüfe {len(entries)} URL(s)...")
    jobs = []
    snapshot_keys = store.snapshot_keys()
    for opts in entries:
        if config_errors(opts):
            continue
        url = opts["url"]
        cached = http_cache.get(url, {})
        snap_exists = hashlib.sha1(url.encode()).hexdigest()[:16] in snapshot_keys
        jobs.append((opts, cached if snap_exists and cached.get("config") == config_hash(opts) else {}))
    fetched = fetch_all(jobs)

    for opts in entries:
        url = opts["url"]
        key = hashlib.sha1(url.encode()).hexdigest()[:16]
        prev = old_status.get(url, {})
        entry = {
            "name": opts.get("name") or prev.get("name") or url,
            "group": opts.get("group") or "",
            "checked": stamp,
            "changed": prev.get("changed", ""),
            "status": "ok",
            "error": "",
        }
        status[url] = entry
        errors = config_errors(opts)
        if errors:
            msg = "Konfigurationsfehler: " + "; ".join(errors)
            entry.update(status="error", error=msg[:300], checked=prev.get("checked", "-"))
            config_bad.append(f"{url}\n  {msg}")
            print(f"[KONFIG]    {url}: {msg}")
            continue
        cfg = config_hash(opts)
        cached = http_cache.get(url, {})
        try:
            result = fetched[url]
            if isinstance(result, Exception):
                raise result
            title, text, feed, validators = result
        except Exception as ex:
            n = store.counter(key, "fail") + 1
            store.set_counter(key, "fail", n)
            entry.update(status="error", error=str(ex)[:200], checked=prev.get("checked", "-"), streak=n)
            print(f"[FEHLER]    {url} (Versuch {n} in Folge): {ex}")
            if n == FAIL_ALERT_AFTER:
                problems.append(
                    {
                        "text": with_hint(f"Abruf schlägt {n}x in Folge fehl: {url}\n  {ex}", str(ex)),
                        "counter": (key, "fail"),
                        "value": n,
                    }
                )
            continue
        store.clear_counter(key, "fail")

        if text is None:
            store.clear_counter(key, "short")
            new_cache[url] = cached
            print(f"[UNVERÄNDERT] {entry['name']} [304 Not Modified, nicht neu geladen]")
            continue

        name = opts.get("name") or title or url
        entry["name"] = name
        kind = "Feed" if feed else "Seite"
        old = store.snapshot(key)

        min_ratio = float(opts.get("min_ratio", DEFAULT_MIN_RATIO))
        if old is not None and len(old) >= GUARD_MIN_CHARS and len(text) < len(old) * min_ratio:
            n = store.counter(key, "short") + 1
            store.set_counter(key, "short", n)
            msg = f"nur {len(text)} statt {len(old)} Zeichen (Cookie-Wand oder Bot-Block?)"
            entry.update(status="warn", error=msg, checked=prev.get("checked", "-"), streak=n)
            print(f"[WARNUNG]   {name} [{kind}] {msg}, Snapshot bleibt unverändert (Versuch {n} in Folge)")
            if n == GUARD_ALERT_AFTER:
                problems.append(
                    {
                        "text": with_hint(f"Seite liefert kaum Text ({n}x in Folge): {url}\n  {msg}", "kaum text"),
                        "counter": (key, "short"),
                        "value": n,
                    }
                )
            continue
        store.clear_counter(key, "short")

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
                changes.append(change)
                # Snapshot, Verlauf und Cache erst nach erfolgreichem Mailversand übernehmen
                pending.append(
                    {
                        "change": change,
                        "key": key,
                        "text": text,
                        "entry": entry,
                        "cache": {**validators, "config": cfg} if validators else None,
                    }
                )
                if cached:
                    new_cache[url] = cached
                continue
            print("            (nur entfernte Zeilen, keine Mail)")
        store.set_snapshot(key, url, text)
        if validators:
            new_cache[url] = {**validators, "config": cfg}

    ok = not config_bad
    sent_ok = True
    if changes:
        shown = merge_variants(changes)
        if len(shown) == 1:
            subject = f"Watchlist: {shown[0]['name']} geändert"
        else:
            subject = f"Watchlist: {len(shown)} Seiten geändert ({', '.join(group_changes(shown))})"
        print(f"Sende Änderungs-Mail an {os.environ.get('MAIL_TO', '?')}...")
        try:
            send_mail(subject, render_text(changes), render_html(changes))
        except Exception as ex:
            sent_ok = ok = False
            print(
                f"[MAILFEHLER] {ex}\n  Snapshots der {len(pending)} geänderten Seite(n) bleiben unverändert, "
                "die Änderung wird beim nächsten Lauf erneut erkannt."
            )
        for p in pending:
            if sent_ok:
                store.set_snapshot(p["key"], p["change"]["url"], p["text"])
                p["entry"]["changed"] = stamp
                record = {**p["change"], "time": stamp}
                history.append(record)
                new_history.append(record)
                if p["cache"]:
                    new_cache[p["change"]["url"]] = p["cache"]
            else:
                p["entry"].update(status="error", error="Änderung erkannt, Mailversand fehlgeschlagen (wird wiederholt)")
    if problems:
        try:
            send_mail("Watchlist: Probleme beim Abruf", "\n\n".join(p["text"] for p in problems))
        except Exception as ex:
            ok = False
            print(f"[MAILFEHLER] Problemmeldung konnte nicht gesendet werden: {ex}")
            for p in problems:  # Zähler zurücksetzen, damit die Warnung beim nächsten Lauf erneut ausgelöst wird
                store.set_counter(*p["counter"], p["value"] - 1)

    history = history[-MAX_HISTORY:]
    try:
        send_heartbeat(now, entries, status, history, meta)
    except Exception as ex:
        ok = False
        print(f"[MAILFEHLER] Lebenszeichen konnte nicht gesendet werden: {ex}")
    store.set_doc("status", status)
    store.add_history(new_history, MAX_HISTORY)
    store.set_doc("meta", meta)
    store.set_doc("http", new_cache)
    dashboard.build([{**v, "url": k} for k, v in status.items()], history, stamp)
    bad = sum(1 for s in status.values() if s["status"] in ("error", "warn"))
    print(f"{len(entries)} geprüft, {len(changes)} geändert, {bad} mit Problemen")
    return ok


def main(argv):
    if len(argv) >= 3 and argv[1] == "--alert":
        send_mail("Watchlist: Workflow fehlgeschlagen", argv[2])
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
