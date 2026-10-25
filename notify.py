import html
import os
import urllib.parse
from datetime import timedelta
from typing import Any

import requests

from diffing import annotate_diff, diff_counts, fragment_url

MAIL_DIFF_LINES = 60  # und so viele davon stehen in der Mail
DASHBOARD_URL = "https://jhoelzl.github.io/watchlist/"  # überschreibbar per Umgebungsvariable DASHBOARD_URL
DEFAULT_GROUP = "Allgemein"
STUCK_AFTER = 6  # Läufe in Folge (bei 2 Läufen pro Tag = 3 Tage), ab denen eine Seite als dauerhaft kaputt gilt


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


def dashboard_link(url=None):
    """Link auf den Tab "Letzte Änderungen", mit URL direkt zum passenden Eintrag."""
    base = os.environ.get("DASHBOARD_URL") or DASHBOARD_URL
    return f"{base}#changes" + (f":{urllib.parse.quote(url, safe='')}" if url else "")


def subject_for(changes):
    shown = merge_variants(changes)
    if len(shown) == 1:
        return f"Watchlist: {shown[0]['name']} geändert"
    names = [c["name"] for c in shown]
    head = ", ".join(names[:3]) + (", …" if len(names) > 3 else "")
    groups = list(group_changes(shown))
    tail = f" ({', '.join(groups[:3])}{', …' if len(groups) > 3 else ''})" if len(groups) > 1 else ""
    return f"Watchlist: {len(shown)} Änderungen: {head}{tail}"[:150]


def render_text(changes):
    changes = merge_variants(changes)
    out = [summary_line(changes), ""] if len(changes) > 1 else []
    for group, items in group_changes(changes).items():
        out.append(f"=== {group} ===")
        for c in items:
            diff, extra = mail_view(c)
            added, removed = diff_counts(c["diff"])
            jump = fragment_url(c["url"], c["diff"])
            out.append(f"{c['name']} (+{added} -{removed})\n{c['url']}")
            if jump != c["url"]:
                out.append(f"Zur geänderten Stelle: {jump}")
            out.append(f"Im Dashboard: {dashboard_link(c['url'])}")
            if c.get("variants"):
                out.append("Gleicher Inhalt auch unter:")
                out += [f"  {v}" for v in c["variants"]]
            out.append("")
            out += diff
            if extra:
                out.append(f"... und {extra} weitere Zeilen (vollständig im Dashboard)")
            out.append("")
    out.append(f"Alle Änderungen im Dashboard: {dashboard_link()}")
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
            dash = f' &middot; <a href="{html.escape(dashboard_link(c["url"]))}">im Dashboard</a>'
            more = "".join(f"<br>{safe_link(v)}" for v in c.get("variants", []))
            if more:
                more = f'<span style="color:#6e7781;font-size:12px">Gleicher Inhalt auch unter:{more}</span>'
                more = f'<p style="margin:0 0 8px">{more}</p>'
            parts.append(
                f'<h3 id="c{n}" style="margin:16px 0 4px">{html.escape(c["name"])} '
                f'<span style="font-size:12px;font-weight:600"><span style="color:#116329">+{added}</span> '
                f'<span style="color:#82071e">&minus;{removed}</span></span></h3>'
                f'<p style="margin:0 0 8px">{safe_link(c["url"])}{jump_link}{dash}</p>{more}'
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
    parts.append(
        f'<p style="margin:24px 0 0"><a href="{html.escape(dashboard_link())}">Alle Änderungen im Dashboard</a></p></div>'
    )
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


HINT_CONTENT = (
    "Vermutlich Cookie-Wand, Bot-Block oder per JavaScript geladene Inhalte: 'js: true' probieren oder Selector prüfen."
)


HINTS = {
    "robots": "Die Seite verbietet automatische Abrufe. Nur wenn das erlaubt ist: 'ignore_robots: true' setzen.",
    "selector": (
        "Der Selector passt nicht mehr (Seite umgebaut?) oder die Inhalte kommen per JavaScript: Selector prüfen oder 'js: true'."
    ),
    "content": HINT_CONTENT + " Mit 'min_ratio' lässt sich der Textwächter anpassen.",
    "http_403": "Der Server blockt den Abruf (Bot-Schutz?): 'js: true' probieren.",
    "http_401": "Die Seite verlangt eine Anmeldung und ist so nicht überwachbar.",
    "http_404": "Die Seite gibt es nicht mehr oder die URL hat sich geändert: URL in urls.yml prüfen.",
    "http_410": "Die Seite wurde entfernt: URL in urls.yml prüfen oder Eintrag löschen.",
    "http_429": "Rate-Limit: Der Server drosselt die Abrufe, meist hilft Abwarten.",
    "timeout": "Der Server antwortet zu langsam oder gar nicht: Abwarten, bei Dauerproblem URL prüfen oder 'js: true' probieren.",
    "connection": "Keine Verbindung zum Server (DNS, Netzwerk, Zertifikat): Host und URL prüfen.",
    "http_5xx": "Serverfehler auf der Gegenseite: meist vorübergehend, Abwarten.",
    "config": "Eintrag in urls.yml korrigieren (siehe Meldung).",
}


def hint_for(code):
    """Kurzer Hinweis zu Ursache und Abhilfe passend zum Fehlercode, sonst leer."""
    return HINTS.get(code or "", "")


def with_hint(text, code):
    hint = hint_for(code)
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
            lines.append(with_hint(f"- {s['name']} ({u}): {s['error']} [{s['streak']} Läufe]", s.get("code")))
    send_mail(f"Watchlist: Lebenszeichen {month}", "\n".join(lines))
    meta["heartbeat"] = month
