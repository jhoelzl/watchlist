"""Add a new URL to urls.yml: uv run add.py <url> [--name N] [--group G] [--selector S] [--js] [-y]"""

import argparse
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import yaml
from bs4 import BeautifulSoup

import check
import config
import fetch
import parse
from models import Options
from store import FileStore, PgStore, open_store


def suggest_selector(body: str) -> str | None:
    """First matching candidate as the selector, or None (the whole page)."""
    soup = BeautifulSoup(body, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    node = parse.auto_root(soup)
    if node is soup:
        return None
    return next(s for s in parse.CANDIDATE_SELECTORS if soup.select_one(s) is node)


FEED_TYPES = ("application/rss+xml", "application/atom+xml")


def find_feeds(body: str, base_url: str) -> list[str]:
    """Feed URLs from <link rel="alternate" type="application/rss+xml|atom+xml">, absolute and without duplicates."""
    soup = BeautifulSoup(body, "html.parser")
    feeds: list[str] = []
    for link in soup.find_all("link"):
        raw_rel: Any = link.get("rel") or []
        rel = raw_rel.split() if isinstance(raw_rel, str) else list(raw_rel)
        if "alternate" not in [r.lower() for r in rel]:
            continue
        link_type = link.get("type") or ""
        if str(link_type).lower() not in FEED_TYPES or not link.get("href"):
            continue
        href = urljoin(base_url, str(link["href"]))
        if href not in feeds:
            feeds.append(href)
    return feeds


def suggest_group(url: str, entries: list[Options]) -> str:
    """Same group as an existing URL on the same host, or empty."""
    host = urlparse(url).netloc
    for e in entries:
        if urlparse(e["url"]).netloc == host and e.get("group"):
            return e["group"]
    return ""


def render_entry(
    url: str,
    name: str | None = None,
    group: str | None = None,
    selector: str | None = None,
    js: bool = False,
    nested: bool = True,
) -> str:
    pad = "  " if nested else ""
    lines = [f"{pad}- url: {url}"]
    for key, value in (("name", name), ("group", group), ("selector", selector)):
        if value:
            lines.append(f"{pad}  {key}: {yaml.safe_dump(value, default_flow_style=True, width=10**6).splitlines()[0]}")
    if js:
        lines.append(f"{pad}  js: true")
    return "\n".join(lines) + "\n"


def append_entry(path: Path, block: str) -> None:
    text = path.read_text()
    if text and not text.endswith("\n"):
        text += "\n"
    path.write_text(text + block)


def ask(prompt: str, default: str, assume_yes: bool) -> str:
    if assume_yes:
        return default
    answer = input(f"{prompt} [{default or '-'}]: ").strip()
    return answer if answer else default


def fetch_text(url: str, js: bool) -> str:
    """Without validators, the server never responds with 304, so the body is always present."""
    body, _ = fetch.fetch_body(url, js)
    if body is None:
        raise RuntimeError("Empty response (304)")
    return body


def prepare(args: argparse.Namespace, entries: list[Options]) -> dict[str, Any]:
    """Fetch a page and determine its feed, selector, name, and group. Exits on errors."""
    print(f"Fetching {args.url}...")
    if not args.js and not fetch.robots_allowed(args.url, {}):
        sys.exit("robots.txt blocks this fetch. Add the URL manually with 'ignore_robots: true'.")
    try:
        body = fetch_text(args.url, args.js)
    except Exception as ex:
        sys.exit(f"Fetch failed: {ex}")

    feed = parse.is_feed(body)
    if not feed:
        feeds = find_feeds(body, args.url)
        if feeds:
            print("Found feeds:")
            for i, f in enumerate(feeds, 1):
                print(f"  {i}. {f}")
            choice = "1" if args.feed else ("" if args.yes else input("Monitor this feed? Number (blank = page): ").strip())
            if choice.isdigit() and 1 <= int(choice) <= len(feeds):
                feed_url = feeds[int(choice) - 1]
                if any(e["url"] == feed_url for e in entries):
                    sys.exit(f"Already exists: {feed_url}")
                if not fetch.robots_allowed(feed_url, {}):
                    sys.exit("robots.txt blocks fetching this feed.")
                try:
                    feed_body = fetch_text(feed_url, False)
                except Exception as ex:
                    sys.exit(f"Feed fetch failed: {ex}")
                if not parse.is_feed(feed_body):
                    sys.exit(f"{feed_url} is not a valid feed.")
                args.url, body, feed, args.js = feed_url, feed_body, True, False
            elif args.yes and not args.feed:
                print("Tip: use --feed to monitor the feed instead of the page.")
    selector = None
    if feed:
        title, text = parse.parse_feed(body)
        print(f"Feed detected: {title!r}, {len(text.splitlines())} entries")
    else:
        title = parse.parse_html(body, None)[0]
        selector = args.selector if args.selector else suggest_selector(body)
        if args.selector == "none":
            selector = None
        if selector:
            print(f"Suggested selector: {selector}")
        text = parse.parse_html(body, selector)[1]
        print(f"Title: {title!r}, {len(text)} characters of text")
        if len(text) < 200:
            print("WARNING: very little text. The page may need --js or a different selector.")

    name = args.name if args.name is not None else ask("Name (blank = page title)", "", args.yes)
    group = args.group if args.group is not None else ask("Group", suggest_group(args.url, entries), args.yes)
    if not feed and args.selector is None:
        selector = ask("Selector ('none' = whole page)", selector or "none", args.yes)
        selector = None if selector == "none" else selector
    return {"url": args.url, "name": name, "group": group, "selector": selector, "js": args.js}


def add_to_database(args: argparse.Namespace, store: PgStore) -> None:
    """Same workflow as urls.yml, but saves to the database."""
    entries = config.merge_config(store.raw_config())
    if any(e["url"] == args.url for e in entries):
        sys.exit(f"Already exists: {args.url}")
    prepared = prepare(args, entries)
    entry: dict[str, Any] = {"url": prepared["url"]}
    for key in ("name", "group", "selector"):
        if prepared[key]:
            entry[key] = prepared[key]
    if prepared["js"]:
        entry["js"] = True
    store.add_url(entry)
    print("\nAdded to Supabase: " + prepared["url"])
    print("Create a baseline: uv run check.py (or wait for the next scheduled run).")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Add a URL to urls.yml")
    ap.add_argument("url")
    ap.add_argument("--name")
    ap.add_argument("--group")
    ap.add_argument("--selector", help="'none' for the whole page")
    ap.add_argument("--js", action="store_true", help="Render the page with Playwright")
    ap.add_argument("--feed", action="store_true", help="Monitor the discovered RSS/Atom feed instead of the page")
    ap.add_argument("-y", "--yes", action="store_true", help="Accept suggestions without prompting")
    args = ap.parse_args(argv)

    path = check.ROOT / "urls.yml"
    store = open_store(check.STATE, path)
    if not isinstance(store, FileStore):
        try:
            return add_to_database(args, store)
        finally:
            store.close()
    entries = config.load_config(path)
    if any(e["url"] == args.url for e in entries):
        sys.exit(f"Already exists: {args.url}")

    prepared = prepare(args, entries)
    args.url, name, group, selector, js = (prepared[k] for k in ("url", "name", "group", "selector", "js"))

    raw = yaml.safe_load(path.read_text()) or []
    block = render_entry(args.url, name, group, selector, js, nested=isinstance(raw, dict))
    original = path.read_text()
    append_entry(path, block)
    try:
        ok = any(e["url"] == args.url for e in config.load_config(path))
    except yaml.YAMLError:
        ok = False
    if not ok:
        path.write_text(original)
        sys.exit("Could not append the entry cleanly (is 'urls:' at the end of the file?). urls.yml is unchanged.")
    print("\nAdded:\n" + block)
    print("Create a baseline: uv run check.py (or wait for the next scheduled run).")


if __name__ == "__main__":
    main()
