import json

import pytest

import add
import check
import dashboard


class FakeResp:
    def __init__(self, status=200, text="", headers=None):
        self.status_code, self.text, self.headers = status, text, headers or {}
        self.ok = status < 400

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def robots_for(monkeypatch, status, body=""):
    monkeypatch.setattr(check.requests, "get", lambda url, **kw: FakeResp(status, body))


def test_robots_disallow(monkeypatch):
    robots_for(monkeypatch, 200, "User-agent: *\nDisallow: /privat\n")
    cache = {}
    assert not check.robots_allowed("https://x.de/privat/seite", cache)
    assert check.robots_allowed("https://x.de/oeffentlich", cache)


def test_robots_missing_or_error_allows(monkeypatch):
    robots_for(monkeypatch, 404)
    assert check.robots_allowed("https://x.de/a", {})

    def boom(url, **kw):
        raise check.requests.ConnectionError("down")

    monkeypatch.setattr(check.requests, "get", boom)
    assert check.robots_allowed("https://x.de/a", {})


def test_robots_cached_per_host(monkeypatch):
    calls = []

    def fake(url, **kw):
        calls.append(url)
        return FakeResp(200, "User-agent: *\nAllow: /\n")

    monkeypatch.setattr(check.requests, "get", fake)
    cache = {}
    check.robots_allowed("https://x.de/a", cache)
    check.robots_allowed("https://x.de/b", cache)
    assert calls == ["https://x.de/robots.txt"]


def test_conditional_headers_and_304(monkeypatch):
    seen = {}

    def fake(url, headers=None, **kw):
        seen.update(headers)
        return FakeResp(304)

    monkeypatch.setattr(check.requests, "get", fake)
    cond = {"etag": '"abc"', "last_modified": "Sun, 18 Oct 2026 11:08:28 GMT"}
    body, val = check.fetch_body("https://x.de", False, cond)
    assert body is None and val == cond
    assert seen["If-None-Match"] == '"abc"'
    assert seen["If-Modified-Since"] == cond["last_modified"]


def test_fetch_stores_validators(monkeypatch):
    monkeypatch.setattr(
        check.requests,
        "get",
        lambda url, **kw: FakeResp(200, "<html><body>hi</body></html>", {"ETag": '"e1"'}),
    )
    title, text, feed, val = check.fetch("https://x.de", {})
    assert text == "hi" and val == {"etag": '"e1"'}


def test_config_hash_changes_with_selector():
    assert check.config_hash({"selector": "main"}) != check.config_hash({"selector": "body"})
    assert check.config_hash({"url": "a", "name": "x"}) == check.config_hash({"url": "b"})


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "urls.yml").write_text("urls:\n  - url: https://a\n    group: G\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "STATE", tmp_path / "state")
    monkeypatch.setattr(dashboard, "SITE", tmp_path / "site")
    monkeypatch.setattr(check, "robots_allowed", lambda url, cache: True)
    sent = []
    monkeypatch.setattr(check, "send_mail", lambda s, t, h=None: sent.append((s, t)))
    return tmp_path, sent


def set_pages(monkeypatch, pages):
    it = iter(pages)
    monkeypatch.setattr(
        check, "fetch", lambda url, opts, cond=None: ("T", next(it), False, {"etag": '"v"'})
    )


def status_of(tmp, url="https://a"):
    return json.loads((tmp / "state" / "status.json").read_text())[url]


def test_guard_blocks_short_page_and_alerts_once(env, monkeypatch):
    tmp, sent = env
    big = ("zeile\n" * 300).strip()
    set_pages(monkeypatch, [big, "Cookies akzeptieren", "Cookies akzeptieren", "Cookies akzeptieren"])
    check.run()  # Baseline
    check.run()  # 1. kurz: keine Mail
    assert sent == [] and status_of(tmp)["status"] == "warn"
    check.run()  # 2. kurz: Warnmail
    assert len(sent) == 1 and "kaum Text" in sent[0][1]
    check.run()  # 3. kurz: keine weitere Mail
    assert len(sent) == 1
    snap = next((tmp / "state").glob("*.txt"))
    assert snap.read_text() == big


def test_guard_recovers_without_change_mail(env, monkeypatch):
    tmp, sent = env
    big = ("zeile\n" * 300).strip()
    set_pages(monkeypatch, [big, "Cookies", big])
    check.run()
    check.run()
    check.run()
    assert sent == [] and status_of(tmp)["status"] == "ok"
    assert not list((tmp / "state").glob("*.short"))


def test_guard_ignores_small_pages(env, monkeypatch):
    tmp, sent = env
    set_pages(monkeypatch, ["kurze seite", "x"])
    check.run()
    check.run()
    assert status_of(tmp)["status"] == "ok"
    assert [s for s, _ in sent] == ["Watchlist: T geändert"]


def test_not_modified_keeps_snapshot_and_validators(env, monkeypatch):
    tmp, sent = env
    set_pages(monkeypatch, ["inhalt"])
    check.run()
    assert json.loads((tmp / "state" / "http.json").read_text())["https://a"]["etag"] == '"v"'
    monkeypatch.setattr(check, "fetch", lambda url, opts, cond=None: (None, None, False, cond))
    check.run()
    assert sent == [] and status_of(tmp)["status"] == "ok"
    assert json.loads((tmp / "state" / "http.json").read_text())["https://a"]["etag"] == '"v"'


def test_robots_block_is_an_error(env, monkeypatch):
    tmp, sent = env
    monkeypatch.setattr(check, "robots_allowed", lambda url, cache: False)
    check.run()
    st = status_of(tmp)
    assert st["status"] == "error" and "robots.txt" in st["error"]


def test_ignore_robots_option(env, monkeypatch):
    tmp, sent = env
    (tmp / "urls.yml").write_text("urls:\n  - url: https://a\n    ignore_robots: true\n")
    monkeypatch.setattr(check, "robots_allowed", lambda url, cache: False)
    set_pages(monkeypatch, ["inhalt"])
    check.run()
    assert status_of(tmp)["status"] == "new"


# add.py

def test_suggest_selector():
    long = "<p>" + "text " * 200 + "</p>"
    assert add.suggest_selector(f"<body><nav>n</nav><main>{long}</main></body>") == "main"
    assert add.suggest_selector(f"<body><main>x</main>{long}</body>") is None
    assert add.suggest_selector(f"<body>{long}</body>") is None


def test_suggest_group_by_host():
    entries = [{"url": "https://learn.microsoft.com/a", "group": "Azure"}, {"url": "https://g.com/b"}]
    assert add.suggest_group("https://learn.microsoft.com/neu", entries) == "Azure"
    assert add.suggest_group("https://andere.de/x", entries) == ""


def test_render_entry_quotes_special_values():
    block = add.render_entry("https://a?x=1&y=2", name="A: B", group="G", selector="main", js=True)
    import yaml

    parsed = yaml.safe_load("urls:\n" + block)["urls"][0]
    assert parsed == {"url": "https://a?x=1&y=2", "name": "A: B", "group": "G", "selector": "main", "js": True}


def test_add_main_appends_and_keeps_comments(tmp_path, monkeypatch):
    f = tmp_path / "urls.yml"
    f.write_text("# Kommentar\ndefaults:\n  ignore: ['x']\n\nurls:\n  - url: https://a\n    group: Azure\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "robots_allowed", lambda url, cache: True)
    page = "<html><title>T</title><body><main>" + "wort " * 100 + "</main></body></html>"
    monkeypatch.setattr(check, "fetch_body", lambda url, js, cond=None: (page, {}))
    add.main(["https://a/neu", "-y"])
    text = f.read_text()
    assert text.startswith("# Kommentar")
    entries = check.load_config(f)
    assert [e["url"] for e in entries] == ["https://a", "https://a/neu"]
    assert entries[1]["selector"] == "main"
    with pytest.raises(SystemExit):
        add.main(["https://a/neu", "-y"])


def test_add_main_list_format_and_rollback(tmp_path, monkeypatch):
    f = tmp_path / "urls.yml"
    f.write_text("- https://a\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "robots_allowed", lambda url, cache: True)
    monkeypatch.setattr(check, "fetch_body", lambda url, js, cond=None: ("<body>" + "w " * 200 + "</body>", {}))
    add.main(["https://b", "-y", "--group", "G"])
    assert [e["url"] for e in check.load_config(f)] == ["https://a", "https://b"]

    g = tmp_path / "urls2.yml"
    g.write_text("urls:\n  - url: https://a\nother: 1\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    (tmp_path / "urls.yml").write_text(g.read_text())
    before = (tmp_path / "urls.yml").read_text()
    with pytest.raises(SystemExit):
        add.main(["https://c", "-y"])
    assert (tmp_path / "urls.yml").read_text() == before


def test_add_blocked_by_robots(tmp_path, monkeypatch):
    (tmp_path / "urls.yml").write_text("- https://a\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "robots_allowed", lambda url, cache: False)
    with pytest.raises(SystemExit):
        add.main(["https://b", "-y"])
