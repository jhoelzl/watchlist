import re
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup, Tag

from errors import CheckError
from models import Options


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def drop_blank_lines(text: str) -> str:
    return "\n".join(l for l in (l.strip() for l in text.splitlines()) if l)


def is_feed(body: str) -> bool:
    head = body[:1000].lower()
    return "<rss" in head or "<feed" in head or "<rdf:rdf" in head


def parse_feed(body: str) -> tuple[str, str]:
    """Liefert (Titel, Text) mit einer Zeile pro Eintrag."""
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
SELECTOR_MIN_SHARE = 0.2  # Ein Selector muss mindestens so viel Text liefern wie die ganze Seite * Anteil


def auto_root(soup: BeautifulSoup) -> BeautifulSoup | Tag:
    """Erster Kandidat, der existiert und nicht fast leer ist, sonst die ganze Seite."""
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
            raise CheckError(f"Selector nicht gefunden: {selector}", "selector")
        root = found
    return title, drop_blank_lines("\n".join(clean(l) for l in root.get_text("\n").splitlines()))


def extract(body: str, opts: Options) -> tuple[str, str, bool]:
    """Body -> (Titel, Text, ist_feed). Entfernt danach die ignore-Muster und leere Zeilen."""
    feed = is_feed(body)
    title, text = parse_feed(body) if feed else parse_html(body, opts.get("selector"))
    for pattern in opts.get("ignore", []):
        text = re.sub(pattern, "", text)
    return title, drop_blank_lines(text), feed
