import html
from pathlib import Path

SITE = Path(__file__).parent / "site"

CSS = """
body{font-family:-apple-system,Segoe UI,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1f2328}
h1{margin-bottom:0}.muted{color:#6e7781;font-size:.85rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}
th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #d8dee4;font-size:.9rem}
.ok{color:#1a7f37}.err{color:#cf222e;font-weight:600}.new{color:#9a6700}
details{margin:.4rem 0;padding:.4rem .6rem;border:1px solid #d8dee4;border-radius:6px}
pre{background:#f6f8fa;padding:.5rem;white-space:pre-wrap;word-break:break-word;font-size:.8rem}
.add{background:#e6ffec;color:#116329}.del{background:#ffebe9;color:#82071e}
"""

STATUS = {"ok": ("ok", "OK"), "new": ("new", "Neu"), "error": ("err", "Fehler"), "warn": ("new", "Zu wenig Text")}


def esc(s):
    return html.escape(str(s if s is not None else ""))


def diff_html(lines):
    out = []
    for l in lines:
        cls = "add" if l.startswith("+") else "del" if l.startswith("-") else ""
        out.append(f'<div class="{cls}">{esc(l) or "&nbsp;"}</div>')
    return "".join(out)


def build(entries, history, generated):
    groups = {}
    for e in entries:
        groups.setdefault(e.get("group") or "Allgemein", []).append(e)

    parts = [
        '<!doctype html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="robots" content="noindex">'
        f"<title>Watchlist</title><style>{CSS}</style></head><body>"
        f'<h1>Watchlist</h1><p class="muted">Zuletzt aktualisiert: {esc(generated)}</p>'
    ]
    for group, items in groups.items():
        parts.append(
            f"<h2>{esc(group)}</h2><table><tr><th>Status</th><th>Seite</th>"
            "<th>Zuletzt geprüft</th><th>Zuletzt geändert</th></tr>"
        )
        for e in items:
            cls, label = STATUS.get(e["status"], ("", e["status"]))
            err = f'<br><span class="muted">{esc(e["error"])}</span>' if e.get("error") else ""
            parts.append(
                f'<tr><td class="{cls}">{label}</td>'
                f'<td><a href="{esc(e["url"])}">{esc(e["name"])}</a>{err}</td>'
                f'<td>{esc(e.get("checked", "-"))}</td><td>{esc(e.get("changed") or "-")}</td></tr>'
            )
        parts.append("</table>")

    parts.append("<h2>Änderungsverlauf</h2>")
    if not history:
        parts.append('<p class="muted">Noch keine Änderungen erkannt.</p>')
    for h in reversed(history[-50:]):
        more = f'<div class="muted">... und {h["extra"]} weitere Zeilen</div>' if h.get("extra") else ""
        parts.append(
            f'<details><summary>{esc(h["time"])} - {esc(h["name"])}</summary>'
            f'<p><a href="{esc(h["url"])}">{esc(h["url"])}</a></p>'
            f'<pre>{diff_html(h["diff"])}{more}</pre></details>'
        )
    parts.append("</body></html>")

    SITE.mkdir(exist_ok=True)
    (SITE / "index.html").write_text("".join(parts), encoding="utf-8")
