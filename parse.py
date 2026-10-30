import re
import xml.etree.ElementTree as ET

import regex
from bs4 import BeautifulSoup, Tag

from errors import CheckError
from models import Options

# Per-pattern timeout; protects against catastrophic backtracking not caught by the heuristic in config.py.
IGNORE_TIMEOUT = 2.0


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def drop_blank_lines(text: str) -> str:
    return "\n".join(l for l in (l.strip() for l in text.splitlines()) if l)


def is_feed(body: str) -> bool:
    head = body[:1000].lower()
    return "<rss" in head or "<feed" in head or "<rdf:rdf" in head


def parse_feed(body: str) -> tuple[str, str]:
    """Returns (title, text) with one line per entry."""
    root = ET.fromstring(body.encode("utf-8"))
    for el in root.iter():
        el.tag = el.tag.split("}")[-1]

    def txt(el: ET.Element, *names: str) -> str:
        for n in names:
            c = el.find(n)
            if c is not None and (c.text or "").strip():
                value = c.text or ""
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
SELECTOR_MIN_SHARE = 0.2  # A selector must return at least this fraction of the full page text.


def auto_root(soup: BeautifulSoup) -> BeautifulSoup | Tag:
    """First candidate that exists and is not nearly empty; otherwise use the whole page."""
    total = len(clean(soup.get_text(" ")))
    for sel in CANDIDATE_SELECTORS:
        node = soup.select_one(sel)
        if node is not None and total and len(clean(node.get_text(" "))) >= total * SELECTOR_MIN_SHARE:
            return node
    return soup


def parse_html(body: str, selector: str | None) -> tuple[str, str]:
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
            raise CheckError(f"Selector not found: {selector}", "selector")
        root = found
    return title, drop_blank_lines("\n".join(clean(l) for l in root.get_text("\n").splitlines()))


def extract(body: str, opts: Options) -> tuple[str, str, bool]:
    """Body -> (title, text, is_feed). Then removes ignore patterns and blank lines."""
    feed = is_feed(body)
    title, text = parse_feed(body) if feed else parse_html(body, opts.get("selector"))
    return title, apply_ignore(text, opts), feed


def apply_ignore(text: str, opts: Options) -> str:
    """Removes the ignore patterns and blank lines. Also applied to old snapshots after the ignore list changed."""
    for pattern in opts.get("ignore", []):
        try:
            text = regex.sub(pattern, "", text, timeout=IGNORE_TIMEOUT)
        except TimeoutError as ex:
            raise CheckError(f"ignore regex took too long (>{IGNORE_TIMEOUT} s): {pattern[:60]}", "ignore_timeout") from ex
    return drop_blank_lines(text)
