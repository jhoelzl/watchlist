import difflib
import hashlib
import html
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
import yaml
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent
STATE = ROOT / "state"
MAX_DIFF_LINES = 60
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "de,en;q=0.8",
}


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


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
    lines = [clean(l) for l in root.get_text("\n").splitlines()]
    return title, "\n".join(l for l in lines if l)


def fetch(url, opts):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    feed = is_feed(resp.text)
    title, text = parse_feed(resp.text) if feed else parse_html(resp.text, opts.get("selector"))
    for pattern in opts.get("ignore", []):
        text = re.sub(pattern, "", text)
    return title, text, feed


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


def render_text(c):
    out = [f"{c['name']}\n{c['url']}\n"]
    out += c["diff"]
    if c["extra"]:
        out.append(f"... und {c['extra']} weitere Zeilen")
    return "\n".join(out)


def render_html(changes):
    parts = ['<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">']
    for c in changes:
        parts.append(
            f'<h3 style="margin:24px 0 4px">{html.escape(c["name"])}</h3>'
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


def main():
    STATE.mkdir(exist_ok=True)
    entries = yaml.safe_load((ROOT / "urls.yml").read_text()) or []
    changes, errors = [], []

    print(f"Prüfe {len(entries)} URL(s)...")
    for e in entries:
        url = e["url"] if isinstance(e, dict) else e
        opts = e if isinstance(e, dict) else {}
        key = hashlib.sha1(url.encode()).hexdigest()[:16]
        snap = STATE / f"{key}.txt"
        fail = STATE / f"{key}.fail"
        try:
            title, text, feed = fetch(url, opts)
        except Exception as ex:
            n = int(fail.read_text()) + 1 if fail.exists() else 1
            fail.write_text(str(n))
            print(f"[FEHLER]    {url} (Versuch {n} in Folge): {ex}")
            if n == 3:
                errors.append(f"{url}: {ex}")
            continue
        fail.unlink(missing_ok=True)

        name = opts.get("name") or title or url
        kind = "Feed" if feed else "Seite"
        if not snap.exists():
            print(f"[NEU]       {name} [{kind}] (Baseline gespeichert, {len(text)} Zeichen)")
        else:
            old = snap.read_text()
            if old == text:
                print(f"[UNVERÄNDERT] {name} [{kind}] ({len(text)} Zeichen)")
            else:
                print(f"[GEÄNDERT]  {name} [{kind}] ({len(old)} -> {len(text)} Zeichen)")
                only_added = opts.get("only_added", feed)
                diff, extra = make_diff(old, text, only_added)
                if diff:
                    changes.append({"name": name, "url": url, "diff": diff, "extra": extra})
                else:
                    print("            (nur entfernte Zeilen, keine Mail)")
        snap.write_text(text)

    if changes:
        subject = (
            f"Watchlist: {changes[0]['name']} geändert"
            if len(changes) == 1
            else f"Watchlist: {len(changes)} Seiten geändert"
        )
        print(f"Sende Änderungs-Mail an {os.environ.get('MAIL_TO', '?')}...")
        send_mail(
            subject,
            "\n\n==========\n\n".join(render_text(c) for c in changes),
            render_html(changes),
        )
    if errors:
        send_mail(
            "Watchlist: Abruf schlägt dauerhaft fehl",
            "3 Fehlversuche in Folge:\n\n" + "\n".join(errors),
        )
    print(f"{len(entries)} geprüft, {len(changes)} geändert, {len(errors)} Fehler")


if __name__ == "__main__":
    sys.exit(main())
