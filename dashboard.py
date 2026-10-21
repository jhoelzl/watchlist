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
.filters{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin:1rem 0}
.filters input,.filters select{padding:.35rem .5rem;font-size:.9rem;border:1px solid #d8dee4;border-radius:6px}
.filters input{flex:1;min-width:12rem}
[hidden]{display:none!important}
"""

JS = """
(function(){
  var q=document.getElementById('q'),g=document.getElementById('g'),s=document.getElementById('s'),c=document.getElementById('count');
  function apply(){
    var t=q.value.trim().toLowerCase(),shown=0,total=0;
    document.querySelectorAll('tr[data-s]').forEach(function(r){
      var st=s.value,okS=!st||(st==='problem'?(r.dataset.s==='error'||r.dataset.s==='warn'):r.dataset.s===st);
      var okG=!g.value||r.dataset.g===g.value,okT=!t||r.dataset.t.indexOf(t)>=0;
      var vis=okS&&okG&&okT;r.hidden=!vis;total++;if(vis)shown++;
    });
    document.querySelectorAll('section.grp').forEach(function(sec){
      sec.hidden=!sec.querySelector('tr[data-s]:not([hidden])');
    });
    document.querySelectorAll('details[data-g]').forEach(function(d){
      d.hidden=!((!g.value||d.dataset.g===g.value)&&(!t||d.dataset.t.indexOf(t)>=0));
    });
    c.textContent=shown+' von '+total;
  }
  [q,g,s].forEach(function(el){el.addEventListener('input',apply);});
  apply();
})();
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


def group_of(item):
    return item.get("group") or "Allgemein"


def build(entries, history, generated):
    groups = {}
    for e in entries:
        groups.setdefault(group_of(e), []).append(e)

    options = "".join(f'<option value="{esc(g)}">{esc(g)}</option>' for g in groups)
    parts = [
        '<!doctype html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="robots" content="noindex">'
        f"<title>Watchlist</title><style>{CSS}</style></head><body>"
        f'<h1>Watchlist</h1><p class="muted">Zuletzt aktualisiert: {esc(generated)}</p>'
        '<div class="filters"><input id="q" type="search" placeholder="Suchen (Name, URL, Text)">'
        f'<select id="g"><option value="">Alle Gruppen</option>{options}</select>'
        '<select id="s"><option value="">Alle Status</option><option value="ok">OK</option>'
        '<option value="new">Neu</option><option value="error">Fehler</option>'
        '<option value="warn">Zu wenig Text</option><option value="problem">Probleme</option></select>'
        '<span id="count" class="muted"></span></div>'
    ]
    for group, items in groups.items():
        parts.append(
            f'<section class="grp"><h2>{esc(group)}</h2><table><tr><th>Status</th><th>Seite</th>'
            "<th>Zuletzt geprüft</th><th>Zuletzt geändert</th></tr>"
        )
        for e in items:
            cls, label = STATUS.get(e["status"], ("", e["status"]))
            err = f'<br><span class="muted">{esc(e["error"])}</span>' if e.get("error") else ""
            text = f'{e.get("name", "")} {e["url"]} {e.get("error") or ""}'.lower()
            parts.append(
                f'<tr data-t="{esc(text)}" data-g="{esc(group)}" data-s="{esc(e["status"])}">'
                f'<td class="{cls}">{label}</td>'
                f'<td><a href="{esc(e["url"])}">{esc(e["name"])}</a>{err}</td>'
                f'<td>{esc(e.get("checked", "-"))}</td><td>{esc(e.get("changed") or "-")}</td></tr>'
            )
        parts.append("</table></section>")

    parts.append("<h2>Änderungsverlauf</h2>")
    if not history:
        parts.append('<p class="muted">Noch keine Änderungen erkannt.</p>')
    for h in reversed(history[-50:]):
        more = f'<div class="muted">... und {h["extra"]} weitere Zeilen</div>' if h.get("extra") else ""
        text = f'{h["name"]} {h["url"]} {" ".join(h["diff"])}'.lower()
        parts.append(
            f'<details data-t="{esc(text)}" data-g="{esc(group_of(h))}">'
            f'<summary>{esc(h["time"])} - {esc(h["name"])}</summary>'
            f'<p><a href="{esc(h["url"])}">{esc(h["url"])}</a></p>'
            f'<pre>{diff_html(h["diff"])}{more}</pre></details>'
        )
    parts.append(f"<script>{JS}</script></body></html>")

    SITE.mkdir(exist_ok=True)
    (SITE / "index.html").write_text("".join(parts), encoding="utf-8")
