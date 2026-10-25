import json
import re
from datetime import UTC, datetime

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
    new = "\n".join(f"zeile {i}" for i in range(600))
    diff, extra = check.make_diff("", new, only_added=True)
    assert len(diff) == check.STORE_DIFF_LINES
    assert extra == 600 - check.STORE_DIFF_LINES


def test_default_ignore_removes_last_updated():
    cfg = {"ignore": [r"Last updated on\s*\S+"]}
    text = check.drop_blank_lines(re.sub(cfg["ignore"][0], "", "vorher\nLast updated on\n2026-10-08\nnachher"))
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
    now = datetime(2026, 10, 21, tzinfo=UTC)
    check.send_heartbeat(now, [], {}, [], meta)
    assert sent == [] and meta["heartbeat"] == "2026-10"


def test_heartbeat_sent_once_per_month(monkeypatch):
    sent = []
    monkeypatch.setattr(check, "send_mail", lambda *a, **k: sent.append(a))
    meta = {"heartbeat": "2026-10"}
    status = {"u": {"name": "Seite", "status": "error", "error": "kaputt"}}
    hist = [{"time": "2026-11-02 06:00 UTC", "name": "Seite"}]
    nov = datetime(2026, 11, 3, tzinfo=UTC)
    check.send_heartbeat(nov, [1], status, hist, meta)
    check.send_heartbeat(nov, [1], status, hist, meta)
    assert len(sent) == 1
    assert "Seite: kaputt" in sent[0][1]
    assert meta["heartbeat"] == "2026-11"


def test_dashboard_build(tmp_path, monkeypatch):
    monkeypatch.setattr(dashboard, "SITE", tmp_path / "site")
    entries = [
        {"url": "https://a", "name": "<A>", "group": "Azure", "status": "error", "error": "Boom", "checked": "t1", "changed": ""},
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


def test_fragment_url_points_to_first_added_line():
    diff = ["@@ -1 +1 @@", " Kontext", "-alt", "+Neue Preise ab 12-Euro, sofort & jetzt"]
    assert (
        check.fragment_url("https://a/x", diff) == "https://a/x#:~:text=Neue%20Preise%20ab%2012%2DEuro%2C%20sofort%20%26%20jetzt"
    )
    assert check.fragment_url("https://a/x#top", ["+Ein langer neuer Satz"]).startswith("https://a/x#top:~:text=")
    assert check.fragment_url("https://a/x", ["-nur weg", "+kurz"]) == "https://a/x"


def test_mail_shows_short_diff_and_summary():
    diff = [f"+zeile {i}" for i in range(100)]
    changes = [
        {"name": "A", "url": "https://a", "group": "G1", "diff": diff, "extra": 5},
        {"name": "B", "url": "https://b", "group": "G2", "diff": ["+x"], "extra": 0},
    ]
    text = check.render_text(changes)
    assert text.startswith("2 Seiten geändert in 2 Gruppen")
    assert "zeile 59" in text and "zeile 60" not in text
    assert f"und {5 + 100 - check.MAIL_DIFF_LINES} weitere Zeilen" in text
    html_out = check.render_html(changes)
    assert 'href="#g1"' in html_out and 'id="c1"' in html_out
    assert "2 Seiten geändert in 2 Gruppen" in html_out
    assert "Seiten geändert" not in check.render_text(changes[1:])


def test_auto_selector_picks_main_or_falls_back_to_whole_page():
    with_main = "<body><nav>Menü</nav><main>" + "Inhalt " * 40 + "</main></body>"
    assert "Menü" not in check.parse_html(with_main, "auto")[1]
    role = "<body><nav>Navigation</nav><div role='main'>" + "Inhalt " * 40 + "</div></body>"
    assert "Navigation" not in check.parse_html(role, "auto")[1]
    plain = "<body><p>Nur Text ohne Hauptbereich</p></body>"
    assert "Nur Text" in check.parse_html(plain, "auto")[1]
    assert "Menü" in check.parse_html(with_main, None)[1]


EVIL = '<script>alert(1)</script> " onmouseover="x" <img src=x onerror=alert(1)>'


def test_mail_html_escapes_hostile_content():
    changes = [
        {
            "name": EVIL,
            "url": 'https://a/?q="><script>x</script>',
            "group": EVIL,
            "diff": [f"+{EVIL} Zeile mit genug Text", f"-{EVIL}"],
            "extra": 0,
        },
        {"name": "J", "url": "javascript:alert(1)", "group": "G", "diff": ["+etwas neuer Text hier"], "extra": 0},
    ]
    out = check.render_html(changes)
    assert "<script" not in out and "<img" not in out
    assert 'onmouseover="x"' not in out
    assert "&lt;script&gt;" in out and "&quot; onmouseover=&quot;x&quot;" in out
    assert 'href="javascript' not in out
    assert "javascript:alert(1)" in out  # nur als Text
    assert re.findall(r'href="([^"]*)"', out)
    assert all(h.startswith(("#", "https://")) for h in re.findall(r'href="([^"]*)"', out))


def test_mail_html_escapes_feed_content():
    feed = """<rss version="2.0"><channel><title>T</title><item>
<title>&lt;script&gt;alert(1)&lt;/script&gt; "x" onclick="y"</title><link>https://x/1</link>
<description>&lt;img src=x onerror=alert(1)&gt; Beschreibung</description></item></channel></rss>"""
    _, text = check.parse_feed(feed)
    out = check.render_html([{"name": "F", "url": "https://f", "group": "G", "diff": [f"+{text}"], "extra": 0}])
    assert "<script" not in out and "<img" not in out
    assert 'onclick="y"' not in out


def test_fragment_url_special_characters():
    diff = ['+Preis: 5 & 6, "neu" <b>fett</b> #1 - Übung 100%']
    url = check.fragment_url("https://a/x?y=1&z=2", diff)
    frag = url.split("#:~:text=")[1]
    assert re.fullmatch(r"[A-Za-z0-9%._~]+", frag)
    assert "%3Cb%3E" in frag and "%2D" in frag
    out = check.render_html([{"name": "N", "url": "https://a/x?y=1&z=2", "group": "G", "diff": diff, "extra": 0}])
    assert 'href="https://a/x?y=1&amp;z=2#:~:text=' in out
    assert "<b>fett" not in out
