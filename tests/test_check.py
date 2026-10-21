import json
import re
from datetime import datetime, timezone

import pytest

import check
import dashboard

HTML = """
<html><head><title> Meine   Seite </title><style>x{}</style></head>
<body><nav>Navigation</nav><main><h1>Titel</h1>
<script>var a=1;</script><p>Last updated on
2026-10-08</p>
<p>Text   mit    Leerraum</p></main></body></html>
"""

RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel><title>Mein Feed</title>
<item><title>Eins</title><link>https://x/1</link><pubDate>Mon, 01 Jan 2026</pubDate>
<description>&lt;b&gt;Hallo&lt;/b&gt; Welt</description></item>
<item><title>Zwei</title><link>https://x/2</link></item>
</channel></rss>"""

ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
<entry><title>A1</title><link href="https://x/a1"/><updated>2026-01-01</updated>
<summary>Zusammenfassung</summary></entry></feed>"""


def test_parse_html_strips_noise_and_selects():
    title, text = check.parse_html(HTML, "main")
    assert title == "Meine Seite"
    assert "Navigation" not in text
    assert "var a" not in text
    assert "Text mit Leerraum" in text.splitlines()


def test_parse_html_missing_selector():
    with pytest.raises(ValueError):
        check.parse_html(HTML, "#gibt-es-nicht")


def test_is_feed():
    assert check.is_feed(RSS)
    assert check.is_feed(ATOM)
    assert not check.is_feed(HTML)


def test_parse_rss():
    title, text = check.parse_feed(RSS)
    lines = text.splitlines()
    assert title == "Mein Feed"
    assert lines[0] == "Mon, 01 Jan 2026 | Eins | https://x/1 | Hallo Welt"
    assert lines[1] == "Zwei | https://x/2"


def test_parse_atom():
    title, text = check.parse_feed(ATOM)
    assert title == "Atom Feed"
    assert text == "2026-01-01 | A1 | https://x/a1 | Zusammenfassung"


def test_make_diff_full():
    diff, extra = check.make_diff("a\nb\nc", "a\nB\nc", only_added=False)
    assert "-b" in diff and "+B" in diff
    assert extra == 0


def test_make_diff_only_added_ignores_removals():
    assert check.make_diff("a\nb", "a", only_added=True) == ([], 0)
    assert check.make_diff("a", "a\nneu", only_added=True) == (["+neu"], 0)


def test_make_diff_truncates():
    new = "\n".join(f"zeile {i}" for i in range(100))
    diff, extra = check.make_diff("", new, only_added=True)
    assert len(diff) == check.MAX_DIFF_LINES
    assert extra == 100 - check.MAX_DIFF_LINES


def test_default_ignore_removes_last_updated():
    cfg = {"ignore": [r"Last updated on\s*\S+"]}
    text = check.drop_blank_lines(
        re.sub(cfg["ignore"][0], "", "vorher\nLast updated on\n2026-10-08\nnachher")
    )
    assert text == "vorher\nnachher"


def test_load_config_list_format(tmp_path):
    f = tmp_path / "u.yml"
    f.write_text("- https://a\n- url: https://b\n  group: G\n")
    entries = check.load_config(f)
    assert [e["url"] for e in entries] == ["https://a", "https://b"]
    assert entries[1]["group"] == "G"


def test_load_config_defaults_merge(tmp_path):
    f = tmp_path / "u.yml"
    f.write_text(
        "defaults:\n  selector: main\n  ignore: ['x']\n"
        "urls:\n  - url: https://a\n    ignore: ['y']\n  - url: https://b\n    selector: body\n"
    )
    a, b = check.load_config(f)
    assert a["ignore"] == ["x", "y"] and a["selector"] == "main"
    assert b["ignore"] == ["x"] and b["selector"] == "body"


def test_render_groups_and_escapes():
    changes = [
        {"name": "A <b>", "url": "https://a", "group": "Azure", "diff": ["+neu & gut"], "extra": 2},
        {"name": "G", "url": "https://g", "group": "Google", "diff": ["-weg"], "extra": 0},
        {"name": "N", "url": "https://n", "group": None, "diff": ["+x"], "extra": 0},
    ]
    html_out = check.render_html(changes)
    text_out = check.render_text(changes)
    assert "A &lt;b&gt;" in html_out and "<b>" not in html_out
    assert "neu &amp; gut" in html_out
    for g in ("Azure", "Google", "Allgemein"):
        assert g in html_out and f"=== {g} ===" in text_out
    assert "und 2 weitere Zeilen" in text_out


def test_heartbeat_first_run_is_silent(monkeypatch):
    sent = []
    monkeypatch.setattr(check, "send_mail", lambda *a, **k: sent.append(a))
    meta = {}
    now = datetime(2026, 10, 21, tzinfo=timezone.utc)
    check.send_heartbeat(now, [], {}, [], meta)
    assert sent == [] and meta["heartbeat"] == "2026-10"


def test_heartbeat_sent_once_per_month(monkeypatch):
    sent = []
    monkeypatch.setattr(check, "send_mail", lambda *a, **k: sent.append(a))
    meta = {"heartbeat": "2026-10"}
    status = {"u": {"name": "Seite", "status": "error", "error": "kaputt"}}
    hist = [{"time": "2026-11-02 06:00 UTC", "name": "Seite"}]
    nov = datetime(2026, 11, 3, tzinfo=timezone.utc)
    check.send_heartbeat(nov, [1], status, hist, meta)
    check.send_heartbeat(nov, [1], status, hist, meta)
    assert len(sent) == 1
    assert "Seite: kaputt" in sent[0][1]
    assert meta["heartbeat"] == "2026-11"


def test_dashboard_build(tmp_path, monkeypatch):
    monkeypatch.setattr(dashboard, "SITE", tmp_path / "site")
    entries = [
        {"url": "https://a", "name": "<A>", "group": "Azure", "status": "error",
         "error": "Boom", "checked": "t1", "changed": ""},
        {"url": "https://b", "name": "B", "group": "", "status": "ok", "checked": "t2", "changed": "t0"},
    ]
    hist = [{"time": "t0", "name": "B", "url": "https://b", "diff": ["+neu"], "extra": 1}]
    dashboard.build(entries, hist, "jetzt")
    out = (tmp_path / "site" / "index.html").read_text()
    assert "&lt;A&gt;" in out and "Boom" in out and "Allgemein" in out
    assert "und 1 weitere Zeilen" in out


def test_run_end_to_end(tmp_path, monkeypatch):
    (tmp_path / "urls.yml").write_text("urls:\n  - url: https://a\n    group: G\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "STATE", tmp_path / "state")
    monkeypatch.setattr(dashboard, "SITE", tmp_path / "site")
    pages = iter(["eins", "eins", "zwei"])
    monkeypatch.setattr(check, "fetch", lambda url, opts, cond=None: ("T", next(pages), False, {}))
    monkeypatch.setattr(check, "robots_allowed", lambda url, cache: True)
    sent = []
    monkeypatch.setattr(check, "send_mail", lambda s, t, h=None: sent.append(s))

    check.run()  # Baseline
    check.run()  # unverändert
    assert sent == []
    check.run()  # geändert
    assert sent == ["Watchlist: T geändert"]
    hist = json.loads((tmp_path / "state" / "history.json").read_text())
    assert hist[0]["diff"] == ["-eins", "+zwei"] or "+zwei" in hist[0]["diff"]
    assert (tmp_path / "site" / "index.html").exists()
