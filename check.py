import difflib
import hashlib
import html
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
import requests
import yaml
from bs4 import BeautifulSoup

import dashboard

ROOT = Path(__file__).parent
STATE = ROOT / "state"
MAX_DIFF_LINES = 60
MAX_HISTORY = 100
DEFAULT_GROUP = "Allgemein"
ROBOTS_AGENT = "watchlist"
# Textwächter: Eine Seite mit vorher mind. GUARD_MIN_CHARS Zeichen, die unter
# min_ratio (Standard 30 %) schrumpft, gilt als Fehlabruf (Cookie-Wand, Bot-Block).
GUARD_MIN_CHARS = 500
DEFAULT_MIN_RATIO = 0.3
GUARD_ALERT_AFTER = 2
FAIL_ALERT_AFTER = 3
RETRY_DELAYS = (2, 5)  # Wartezeit in Sekunden vor dem 2. und 3. Versuch
MAX_RETRY_AFTER = 30
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
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


def parse_html(body, selector):
    soup = BeautifulSoup(body, "html.parser")
    title = clean(soup.title.get_text()) if soup.title else ""
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    root = soup
    if selector:
        root = soup.select_one(selector)
        if root is None:
            raise ValueError(f"Selector nicht gefunden: {selector}")
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
                rp.allow_all = True
        except requests.RequestException:
            rp.allow_all = True
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


def fetch_body(url, js, cond=None):
    """Liefert (Body, Validatoren). Body ist None, wenn der Server 304 antwortet."""
    if js:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError("js: true braucht Playwright (uv run --extra js check.py)")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(user_agent=USER_AGENT)
                page.goto(url, wait_until="networkidle", timeout=60000)
                return page.content(), {}
            finally:
                browser.close()
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
        diff = [
            l
            for l in difflib.unified_diff(old_l, new_l, lineterm="", n=1)
            if not l.startswith(("---", "+++"))
        ]
    extra = max(0, len(diff) - MAX_DIFF_LINES)
    return diff[:MAX_DIFF_LINES], extra


def group_changes(changes):
    groups = {}
    for c in changes:
        groups.setdefault(c.get("group") or DEFAULT_GROUP, []).append(c)
    return groups


def render_text(changes):
    out = []
    for group, items in group_changes(changes).items():
        out.append(f"=== {group} ===")
        for c in items:
            out.append(f"{c['name']}\n{c['url']}\n")
            out += c["diff"]
            if c["extra"]:
                out.append(f"... und {c['extra']} weitere Zeilen")
            out.append("")
    return "\n".join(out).strip()


def render_html(changes):
    parts = ['<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">']
    for group, items in group_changes(changes).items():
        parts.append(
            f'<h2 style="margin:28px 0 0;border-bottom:1px solid #d8dee4">{html.escape(group)}</h2>'
        )
        for c in items:
            parts.append(
                f'<h3 style="margin:16px 0 4px">{html.escape(c["name"])}</h3>'
                f'<p style="margin:0 0 8px"><a href="{html.escape(c["url"])}">{html.escape(c["url"])}</a></p>'
                '<pre style="background:#f6f8fa;padding:8px;white-space:pre-wrap;'
                'word-break:break-word;font-size:12px">'
            )
            for l in c["diff"]:
                style = ""
                if l.startswith("+"):
                    style = "background:#e6ffec;color:#116329"
                elif l.startswith("-"):
                    style = "background:#ffebe9;color:#82071e"
                elif l.startswith("@@"):
                    style = "color:#6e7781"
                parts.append(f'<div style="{style}">{html.escape(l) or "&nbsp;"}</div>')
            if c["extra"]:
                parts.append(f'<div style="color:#6e7781">... und {c["extra"]} weitere Zeilen</div>')
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


def load_config(path):
    """Akzeptiert eine reine Liste oder {defaults: {...}, urls: [...]}."""
    raw = yaml.safe_load(path.read_text()) or []
    defaults, urls = ({}, raw) if isinstance(raw, list) else (raw.get("defaults") or {}, raw.get("urls") or [])
    entries = []
    for e in urls:
        e = {"url": e} if isinstance(e, str) else dict(e)
        merged = {**defaults, **e}
        merged["ignore"] = list(defaults.get("ignore") or []) + list(e.get("ignore") or [])
        entries.append(merged)
    return entries


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path, data):
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True) + "\n")


def send_heartbeat(now, entries, status, history, meta):
    month = now.strftime("%Y-%m")
    if "heartbeat" not in meta:
        meta["heartbeat"] = month
        return
    if meta["heartbeat"] == month:
        return
    since = (now - timedelta(days=31)).strftime("%Y-%m-%d")
    recent = [h for h in history if h["time"][:10] >= since]
    failing = [f"{s['name']}: {s['error']}" for s in status.values() if s["status"] in ("error", "warn")]
    lines = [
        f"Watchlist läuft. {len(entries)} Seite(n) werden geprüft.",
        f"Änderungen in den letzten 31 Tagen: {len(recent)}",
    ]
    lines += [f"- {h['time'][:10]} {h['name']}" for h in recent[-15:]]
    lines.append(f"Seiten mit Problemen (Fehler/zu wenig Text): {len(failing)}")
    lines += [f"- {f}" for f in failing]
    send_mail(f"Watchlist: Lebenszeichen {month}", "\n".join(lines))
    meta["heartbeat"] = month


def run():
    STATE.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%d %H:%M UTC")
    entries = load_config(ROOT / "urls.yml")
    old_status = read_json(STATE / "status.json", {})
    history = read_json(STATE / "history.json", [])
    meta = read_json(STATE / "meta.json", {})
    status, changes, problems, pending = {}, [], [], []
    http_cache = read_json(STATE / "http.json", {})
    new_cache = {}
    robots = {}

    print(f"Prüfe {len(entries)} URL(s)...")
    for opts in entries:
        url = opts["url"]
        key = hashlib.sha1(url.encode()).hexdigest()[:16]
        snap = STATE / f"{key}.txt"
        fail = STATE / f"{key}.fail"
        short = STATE / f"{key}.short"
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
        cfg = config_hash(opts)
        cached = http_cache.get(url, {})
        cond = cached if snap.exists() and cached.get("config") == cfg else {}
        try:
            if not opts.get("ignore_robots") and not robots_allowed(url, robots):
                raise RuntimeError("robots.txt verbietet den Abruf (ignore_robots: true zum Überschreiben)")
            title, text, feed, validators = fetch(url, opts, cond)
        except Exception as ex:
            n = int(fail.read_text()) + 1 if fail.exists() else 1
            fail.write_text(str(n))
            entry.update(status="error", error=str(ex)[:200], checked=prev.get("checked", "-"))
            print(f"[FEHLER]    {url} (Versuch {n} in Folge): {ex}")
            if n == FAIL_ALERT_AFTER:
                problems.append(
                    {"text": f"Abruf schlägt {n}x in Folge fehl: {url}\n  {ex}", "counter": fail, "value": n}
                )
            continue
        fail.unlink(missing_ok=True)

        if text is None:
            short.unlink(missing_ok=True)
            new_cache[url] = cached
            print(f"[UNVERÄNDERT] {entry['name']} [304 Not Modified, nicht neu geladen]")
            continue

        name = opts.get("name") or title or url
        entry["name"] = name
        kind = "Feed" if feed else "Seite"
        old = snap.read_text() if snap.exists() else None

        min_ratio = float(opts.get("min_ratio", DEFAULT_MIN_RATIO))
        if old is not None and len(old) >= GUARD_MIN_CHARS and len(text) < len(old) * min_ratio:
            n = int(short.read_text()) + 1 if short.exists() else 1
            short.write_text(str(n))
            msg = f"nur {len(text)} statt {len(old)} Zeichen (Cookie-Wand oder Bot-Block?)"
            entry.update(status="warn", error=msg, checked=prev.get("checked", "-"))
            print(f"[WARNUNG]   {name} [{kind}] {msg}, Snapshot bleibt unverändert (Versuch {n} in Folge)")
            if n == GUARD_ALERT_AFTER:
                problems.append(
                    {"text": f"Seite liefert kaum Text ({n}x in Folge): {url}\n  {msg}", "counter": short, "value": n}
                )
            continue
        short.unlink(missing_ok=True)

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
                    {"change": change, "snap": snap, "text": text, "entry": entry,
                     "cache": {**validators, "config": cfg} if validators else None}
                )
                if cached:
                    new_cache[url] = cached
                continue
            print("            (nur entfernte Zeilen, keine Mail)")
        snap.write_text(text)
        if validators:
            new_cache[url] = {**validators, "config": cfg}

    ok = True
    sent_ok = True
    if changes:
        if len(changes) == 1:
            subject = f"Watchlist: {changes[0]['name']} geändert"
        else:
            subject = f"Watchlist: {len(changes)} Seiten geändert ({', '.join(group_changes(changes))})"
        print(f"Sende Änderungs-Mail an {os.environ.get('MAIL_TO', '?')}...")
        try:
            send_mail(subject, render_text(changes), render_html(changes))
        except Exception as ex:
            sent_ok = ok = False
            print(f"[MAILFEHLER] {ex}\n  Snapshots der {len(pending)} geänderten Seite(n) bleiben unverändert, "
                  "die Änderung wird beim nächsten Lauf erneut erkannt.")
        for p in pending:
            if sent_ok:
                p["snap"].write_text(p["text"])
                p["entry"]["changed"] = stamp
                history.append({**p["change"], "time": stamp})
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
                p["counter"].write_text(str(p["value"] - 1))

    history = history[-MAX_HISTORY:]
    try:
        send_heartbeat(now, entries, status, history, meta)
    except Exception as ex:
        ok = False
        print(f"[MAILFEHLER] Lebenszeichen konnte nicht gesendet werden: {ex}")
    write_json(STATE / "status.json", status)
    write_json(STATE / "history.json", history)
    write_json(STATE / "meta.json", meta)
    write_json(STATE / "http.json", new_cache)
    dashboard.build(list({**v, "url": k} for k, v in status.items()), history, stamp)
    bad = sum(1 for s in status.values() if s["status"] in ("error", "warn"))
    print(f"{len(entries)} geprüft, {len(changes)} geändert, {bad} mit Problemen")
    return ok


def main(argv):
    if len(argv) >= 3 and argv[1] == "--alert":
        send_mail("Watchlist: Workflow fehlgeschlagen", argv[2])
        return 0
    return 0 if run() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
