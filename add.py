"""Neue URL zu urls.yml hinzufügen: uv run add.py <url> [--name N] [--group G] [--selector S] [--js] [-y]"""

import argparse
import sys
from urllib.parse import urlparse

import yaml
from bs4 import BeautifulSoup

import check

CANDIDATE_SELECTORS = ["main", "article", "[role=main]", "#main-content", "#content"]
SELECTOR_MIN_SHARE = 0.2  # Ein Selector muss mindestens so viel Text liefern wie die ganze Seite * Anteil


def suggest_selector(body):
    """Erster Kandidat, der existiert und nicht fast leer ist. Sonst None (ganze Seite)."""
    soup = BeautifulSoup(body, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    total = len(check.clean(soup.get_text(" ")))
    for sel in CANDIDATE_SELECTORS:
        node = soup.select_one(sel)
        if node is not None:
            size = len(check.clean(node.get_text(" ")))
            if total and size >= total * SELECTOR_MIN_SHARE:
                return sel
    return None


def suggest_group(url, entries):
    """Gleiche Gruppe wie eine vorhandene URL desselben Hosts, sonst leer."""
    host = urlparse(url).netloc
    for e in entries:
        if urlparse(e["url"]).netloc == host and e.get("group"):
            return e["group"]
    return ""


def render_entry(url, name=None, group=None, selector=None, js=False, nested=True):
    pad = "  " if nested else ""
    lines = [f"{pad}- url: {url}"]
    for key, value in (("name", name), ("group", group), ("selector", selector)):
        if value:
            lines.append(f"{pad}  {key}: {yaml.safe_dump(value, default_flow_style=True, width=10**6).splitlines()[0]}")
    if js:
        lines.append(f"{pad}  js: true")
    return "\n".join(lines) + "\n"


def append_entry(path, block):
    text = path.read_text()
    if text and not text.endswith("\n"):
        text += "\n"
    path.write_text(text + block)


def ask(prompt, default, assume_yes):
    if assume_yes:
        return default
    answer = input(f"{prompt} [{default or '-'}]: ").strip()
    return answer if answer else default


def main(argv=None):
    ap = argparse.ArgumentParser(description="URL zu urls.yml hinzufügen")
    ap.add_argument("url")
    ap.add_argument("--name")
    ap.add_argument("--group")
    ap.add_argument("--selector", help="'none' für die ganze Seite")
    ap.add_argument("--js", action="store_true", help="Seite mit Playwright rendern")
    ap.add_argument("-y", "--yes", action="store_true", help="Vorschläge ohne Rückfrage übernehmen")
    args = ap.parse_args(argv)

    path = check.ROOT / "urls.yml"
    entries = check.load_config(path)
    if any(e["url"] == args.url for e in entries):
        sys.exit(f"Schon vorhanden: {args.url}")

    print(f"Rufe {args.url} ab...")
    if not args.js and not check.robots_allowed(args.url, {}):
        sys.exit("robots.txt verbietet den Abruf. Trage die URL manuell mit 'ignore_robots: true' ein.")
    try:
        body, _ = check.fetch_body(args.url, args.js)
    except Exception as ex:
        sys.exit(f"Abruf fehlgeschlagen: {ex}")

    feed = check.is_feed(body)
    selector = None
    if feed:
        title, text = check.parse_feed(body)
        print(f"Feed erkannt: {title!r}, {len(text.splitlines())} Einträge")
    else:
        title = check.parse_html(body, None)[0]
        selector = args.selector if args.selector else suggest_selector(body)
        if args.selector == "none":
            selector = None
        if selector:
            print(f"Selector-Vorschlag: {selector}")
        text = check.parse_html(body, selector)[1]
        print(f"Titel: {title!r}, {len(text)} Zeichen Text")
        if len(text) < 200:
            print("WARNUNG: sehr wenig Text. Vielleicht braucht die Seite --js oder einen anderen Selector.")

    name = args.name if args.name is not None else ask("Name (leer = Seitentitel)", "", args.yes)
    group = args.group if args.group is not None else ask("Gruppe", suggest_group(args.url, entries), args.yes)
    if not feed and args.selector is None:
        selector = ask("Selector ('none' = ganze Seite)", selector or "none", args.yes)
        selector = None if selector == "none" else selector

    raw = yaml.safe_load(path.read_text()) or []
    block = render_entry(args.url, name, group, selector, args.js, nested=isinstance(raw, dict))
    original = path.read_text()
    append_entry(path, block)
    try:
        ok = any(e["url"] == args.url for e in check.load_config(path))
    except yaml.YAMLError:
        ok = False
    if not ok:
        path.write_text(original)
        sys.exit("Konnte den Eintrag nicht sauber anhängen (steht 'urls:' am Dateiende?). urls.yml unverändert.")
    print("\nHinzugefügt:\n" + block)
    print("Baseline erzeugen: uv run check.py (oder beim nächsten geplanten Lauf).")


if __name__ == "__main__":
    main()
