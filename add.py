"""Neue URL zu urls.yml hinzufügen: uv run add.py <url> [--name N] [--group G] [--selector S] [--js] [-y]"""

import argparse
import sys
from typing import Any
from urllib.parse import urljoin, urlparse

import yaml
from bs4 import BeautifulSoup

import check
from store import PgStore, open_store

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


FEED_TYPES = ("application/rss+xml", "application/atom+xml")


def find_feeds(body, base_url):
    """Feed-URLs aus <link rel="alternate" type="application/rss+xml|atom+xml">, absolut und ohne Duplikate."""
    soup = BeautifulSoup(body, "html.parser")
    feeds = []
    for link in soup.find_all("link"):
        raw_rel: Any = link.get("rel") or []
        rel = raw_rel.split() if isinstance(raw_rel, str) else list(raw_rel)
        if "alternate" not in [r.lower() for r in rel]:
            continue
        link_type = link.get("type") or ""
        if str(link_type).lower() not in FEED_TYPES or not link.get("href"):
            continue
        href = urljoin(base_url, link["href"])
        if href not in feeds:
            feeds.append(href)
    return feeds


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


def prepare(args, entries):
    """Seite abrufen, Feed/Selector/Name/Gruppe bestimmen. Beendet das Programm bei Fehlern."""
    print(f"Rufe {args.url} ab...")
    if not args.js and not check.robots_allowed(args.url, {}):
        sys.exit("robots.txt verbietet den Abruf. Trage die URL manuell mit 'ignore_robots: true' ein.")
    try:
        body, _ = check.fetch_body(args.url, args.js)
    except Exception as ex:
        sys.exit(f"Abruf fehlgeschlagen: {ex}")

    feed = check.is_feed(body)
    if not feed:
        feeds = find_feeds(body, args.url)
        if feeds:
            print("Feeds gefunden:")
            for i, f in enumerate(feeds, 1):
                print(f"  {i}. {f}")
            choice = "1" if args.feed else ("" if args.yes else input("Feed überwachen? Nummer (leer = Seite): ").strip())
            if choice.isdigit() and 1 <= int(choice) <= len(feeds):
                feed_url = feeds[int(choice) - 1]
                if any(e["url"] == feed_url for e in entries):
                    sys.exit(f"Schon vorhanden: {feed_url}")
                if not check.robots_allowed(feed_url, {}):
                    sys.exit("robots.txt verbietet den Abruf des Feeds.")
                try:
                    feed_body, _ = check.fetch_body(feed_url, False)
                except Exception as ex:
                    sys.exit(f"Feed-Abruf fehlgeschlagen: {ex}")
                if not check.is_feed(feed_body):
                    sys.exit(f"{feed_url} ist kein gültiger Feed.")
                args.url, body, feed, args.js = feed_url, feed_body, True, False
            elif args.yes and not args.feed:
                print("Tipp: mit --feed wird der Feed statt der Seite überwacht.")
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
    return {"url": args.url, "name": name, "group": group, "selector": selector, "js": args.js}


def add_to_database(args, store):
    """Gleicher Ablauf wie bei urls.yml, nur das Speichern geht in die Datenbank."""
    entries = check.merge_config(store.raw_config())
    if any(e["url"] == args.url for e in entries):
        sys.exit(f"Schon vorhanden: {args.url}")
    prepared = prepare(args, entries)
    entry = {"url": prepared["url"]}
    for key in ("name", "group", "selector"):
        if prepared[key]:
            entry[key] = prepared[key]
    if prepared["js"]:
        entry["js"] = True
    store.add_url(entry)
    print("\nIn Supabase hinzugefügt: " + prepared["url"])
    print("Baseline erzeugen: uv run check.py (oder beim nächsten geplanten Lauf).")


def main(argv=None):
    ap = argparse.ArgumentParser(description="URL zu urls.yml hinzufügen")
    ap.add_argument("url")
    ap.add_argument("--name")
    ap.add_argument("--group")
    ap.add_argument("--selector", help="'none' für die ganze Seite")
    ap.add_argument("--js", action="store_true", help="Seite mit Playwright rendern")
    ap.add_argument("--feed", action="store_true", help="gefundenen RSS/Atom-Feed statt der Seite überwachen")
    ap.add_argument("-y", "--yes", action="store_true", help="Vorschläge ohne Rückfrage übernehmen")
    args = ap.parse_args(argv)

    path = check.ROOT / "urls.yml"
    store = open_store(check.STATE, path)
    if isinstance(store, PgStore):
        try:
            return add_to_database(args, store)
        finally:
            store.close()
    entries = check.load_config(path)
    if any(e["url"] == args.url for e in entries):
        sys.exit(f"Schon vorhanden: {args.url}")

    prepared = prepare(args, entries)
    args.url, name, group, selector, js = (prepared[k] for k in ("url", "name", "group", "selector", "js"))

    raw = yaml.safe_load(path.read_text()) or []
    block = render_entry(args.url, name, group, selector, js, nested=isinstance(raw, dict))
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
