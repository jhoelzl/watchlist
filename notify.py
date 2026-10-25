import html
import os
import urllib.parse
from datetime import datetime, timedelta
from typing import Any

import requests

from diffing import annotate_diff, diff_counts, fragment_url
from models import Change, HistoryEntry, Options, UrlStatus
from settings import SETTINGS

DASHBOARD_URL = "https://jhoelzl.github.io/watchlist/"  # Overridable with the DASHBOARD_URL environment variable.
DEFAULT_GROUP = "General"


def safe_link(url: str) -> str:
    """Links only to http(s) URLs; everything else (e.g. javascript:) remains plain text."""
    esc = html.escape(url)
    if urllib.parse.urlsplit(url.strip()).scheme.lower() in ("http", "https"):
        return f'<a href="{esc}">{esc}</a>'
    return esc


def mail_view(change: Change) -> tuple[list[str], int]:
    """Email diff, truncated to the line limit; the rest is counted as "more lines"."""
    diff = change["diff"][: SETTINGS.mail_diff_lines]
    return diff, change["extra"] + len(change["diff"]) - len(diff)


def merge_variants(changes: list[Change]) -> list[Change]:
    """Combines entries with identical diffs in the same group (e.g. tab variants ?tabs=stt|tts)."""
    merged: dict[tuple[Any, ...], Change] = {}
    for c in changes:
        key = (c.get("group"), tuple(c["diff"]), c["extra"])
        if key in merged:
            merged[key].setdefault("variants", []).append(c["url"])
        else:
            merged[key] = {**c, "variants": []}
    return list(merged.values())


def group_of(group: str | None) -> str:
    return group or DEFAULT_GROUP


def group_changes(changes: list[Change]) -> dict[str, list[Change]]:
    groups: dict[str, list[Change]] = {}
    for c in changes:
        groups.setdefault(group_of(c.get("group")), []).append(c)
    return groups


def summary_line(changes: list[Change]) -> str:
    pages, groups = len(changes), len(group_changes(changes))
    return f"{pages} page{'s' if pages != 1 else ''} changed in {groups} group{'s' if groups != 1 else ''}"


def dashboard_link(url: str | None = None) -> str:
    """Links to the "Recent changes" tab, with a URL that jumps directly to the matching entry."""
    base = os.environ.get("DASHBOARD_URL") or DASHBOARD_URL
    return f"{base}#changes" + (f":{urllib.parse.quote(url, safe='')}" if url else "")


def subject_for(changes: list[Change]) -> str:
    shown = merge_variants(changes)
    if len(shown) == 1:
        return f"Watchlist: {shown[0]['name']} changed"
    names = [c["name"] for c in shown]
    head = ", ".join(names[:3]) + (", …" if len(names) > 3 else "")
    groups = list(group_changes(shown))
    tail = f" ({', '.join(groups[:3])}{', …' if len(groups) > 3 else ''})" if len(groups) > 1 else ""
    return f"Watchlist: {len(shown)} changes: {head}{tail}"[:150]


def render_text(changes: list[Change]) -> str:
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
                out.append(f"Changed section: {jump}")
            out.append(f"In the dashboard: {dashboard_link(c['url'])}")
            if c.get("variants"):
                out.append("Same content also at:")
                out += [f"  {v}" for v in c["variants"]]
            out.append("")
            out += diff
            if extra:
                out.append(f"... and {extra} more lines (full diff in the dashboard)")
            out.append("")
    out.append(f"All changes in the dashboard: {dashboard_link()}")
    return "\n".join(out).strip()


def render_html(changes: list[Change]) -> str:
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
                f' &middot; <a href="{html.escape(jump)}">changed section</a>'
                if jump != c["url"] and safe_link(jump).startswith("<a")
                else ""
            )
            dash = f' &middot; <a href="{html.escape(dashboard_link(c["url"]))}">in the dashboard</a>'
            more = "".join(f"<br>{safe_link(v)}" for v in c.get("variants", []))
            if more:
                more = f'<span style="color:#6e7781;font-size:12px">Same content also at:{more}</span>'
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
                parts.append(f'<div style="color:#6e7781">... and {extra} more lines (full diff in the dashboard)</div>')
            parts.append("</pre>")
    parts.append(
        f'<p style="margin:24px 0 0"><a href="{html.escape(dashboard_link())}">All changes in the dashboard</a></p></div>'
    )
    return "".join(parts)


def send_mail(subject: str, text: str, html_body: str | None = None) -> None:
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print("RESEND_API_KEY is missing; email will only be printed:\n", subject, "\n", text)
        return
    payload: dict[str, Any] = {
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
    print(f"Email sent: {subject} (Resend ID {r.json().get('id')})")


HINT_CONTENT = "Likely a cookie wall, bot block, or JavaScript-loaded content: try 'js: true' or check the selector."


HINTS = {
    "blocked_url": (
        "Only public http(s) addresses are allowed (no localhost, private networks, or redirects into them): check the URL."
    ),
    "robots": "The page blocks automated fetches. Only if permitted, set 'ignore_robots: true'.",
    "selector": (
        "The selector no longer matches (was the page redesigned?), or content is loaded with JavaScript: "
        "check the selector or try 'js: true'."
    ),
    "ignore_timeout": (
        "An ignore regex is extremely slow on this page (backtracking): "
        "simplify the pattern, e.g. by removing nested quantifiers."
    ),
    "content": HINT_CONTENT + " Adjust the content guard with 'min_ratio'.",
    "http_403": "The server blocks the fetch (bot protection?): try 'js: true'.",
    "http_401": "The page requires authentication and cannot be monitored this way.",
    "http_404": "The page no longer exists or its URL has changed: check the URL in urls.yml.",
    "http_410": "The page was removed: check its URL in urls.yml or delete the entry.",
    "http_429": "Rate limit: The server is throttling requests; waiting usually helps.",
    "timeout": "The server is responding too slowly or not at all: wait. "
    "If the problem persists, check the URL in your browser. If it works there, the server is probably blocking "
    "GitHub runner IPs ('js: true' will not help): pause the page or use a self-hosted runner.",
    "connection": "Connection to the server failed (DNS, network, certificate): check the host and URL.",
    "http_5xx": "Server error: usually temporary; wait and retry.",
    "config": "Correct the entry in urls.yml (see the message).",
}


def hint_for(code: str | None) -> str:
    """Short hint about the cause and remedy for the error code, or empty if none."""
    return HINTS.get(code or "", "")


def with_hint(text: str, code: str | None) -> str:
    hint = hint_for(code)
    return f"{text}\n  Tip: {hint}" if hint else text


def send_heartbeat(
    now: datetime, entries: list[Options], status: dict[str, UrlStatus], history: list[HistoryEntry], meta: dict[str, Any]
) -> None:
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
        f"Watchlist is running. Monitoring {len(entries)} page{'s' if len(entries) != 1 else ''}.",
        f"Changes in the last 31 days: {len(recent)}",
        "",
        "By group (pages / changes / problems):",
    ]
    groups: dict[str, list[int]] = {}
    for s in status.values():
        groups.setdefault(group_of(s.get("group")), [0, 0, 0])[0] += 1
    for h in recent:
        groups.setdefault(group_of(h.get("group")), [0, 0, 0])[1] += 1
    for _, s in failing:
        groups[group_of(s.get("group"))][2] += 1
    lines += [f"- {g}: {n} / {c} / {p}" for g, (n, c, p) in sorted(groups.items())]
    lines += ["", "Recent changes:"] + [f"- {h['time'][:10]} {h['name']}" for h in recent[-15:]]
    if not recent:
        lines.append("- none")
    stuck = [(u, s) for u, s in failing if s.get("streak", 0) >= SETTINGS.stuck_after]
    lines += ["", f"Pages with problems (errors / too little text): {len(failing)}"]
    lines += [f"- {s['name']}: {s['error']}" for _, s in failing]
    if stuck:
        lines += ["", f"Persistently failing (for at least {SETTINGS.stuck_after} consecutive runs):"]
        for u, s in stuck:
            lines.append(with_hint(f"- {s['name']} ({u}): {s['error']} [{s['streak']} consecutive runs]", s.get("code")))
    send_mail(f"Watchlist: heartbeat {month}", "\n".join(lines))
    meta["heartbeat"] = month
