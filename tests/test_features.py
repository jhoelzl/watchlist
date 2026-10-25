import json
import sys
import threading
import types

import pytest

import add
import check
import config
import diffing
import errors
import fetch
import notify


class FakeResp:
    def __init__(self, status=200, text="", headers=None):
        self.status_code, self.text, self.headers = status, text, headers or {}
        self.ok = status < 400

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def robots_for(monkeypatch, status, body=""):
    monkeypatch.setattr(fetch.requests, "get", lambda url, **kw: FakeResp(status, body))


def test_robots_disallow(monkeypatch):
    robots_for(monkeypatch, 200, "User-agent: *\nDisallow: /privat\n")
    cache = {}
    assert not fetch.robots_allowed("https://x.de/privat/seite", cache)
    assert fetch.robots_allowed("https://x.de/oeffentlich", cache)


def test_robots_missing_or_error_allows(monkeypatch):
    robots_for(monkeypatch, 404)
    assert fetch.robots_allowed("https://x.de/a", {})

    def boom(url, **kw):
        raise fetch.requests.ConnectionError("down")

    monkeypatch.setattr(fetch.requests, "get", boom)
    assert fetch.robots_allowed("https://x.de/a", {})


def test_robots_cached_per_host(monkeypatch):
    calls = []

    def fake(url, **kw):
        calls.append(url)
        return FakeResp(200, "User-agent: *\nAllow: /\n")

    monkeypatch.setattr(fetch.requests, "get", fake)
    cache = {}
    fetch.robots_allowed("https://x.de/a", cache)
    fetch.robots_allowed("https://x.de/b", cache)
    assert calls == ["https://x.de/robots.txt"]


def test_conditional_headers_and_304(monkeypatch):
    seen = {}

    def fake(url, headers=None, **kw):
        seen.update(headers)
        return FakeResp(304)

    monkeypatch.setattr(fetch.requests, "get", fake)
    cond = {"etag": '"abc"', "last_modified": "Sun, 18 Oct 2026 11:08:28 GMT"}
    body, val = fetch.fetch_body("https://x.de", False, cond)
    assert body is None and val == cond
    assert seen["If-None-Match"] == '"abc"'
    assert seen["If-Modified-Since"] == cond["last_modified"]


def test_fetch_stores_validators(monkeypatch):
    monkeypatch.setattr(
        fetch.requests,
        "get",
        lambda url, **kw: FakeResp(200, "<html><body>hi</body></html>", {"ETag": '"e1"'}),
    )
    title, text, feed, val = fetch.fetch("https://x.de", {})
    assert text == "hi" and val == {"etag": '"e1"'}


def test_config_hash_changes_with_selector():
    assert config.config_hash({"selector": "main"}) != config.config_hash({"selector": "body"})
    assert config.config_hash({"url": "a", "name": "x"}) == config.config_hash({"url": "b"})


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "urls.yml").write_text("urls:\n  - url: https://a\n    group: G\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "STATE", tmp_path / "state")
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    sent = []
    monkeypatch.setattr(notify, "send_mail", lambda s, t, h=None: sent.append((s, t)))
    return tmp_path, sent


def set_pages(monkeypatch, pages):
    it = iter(pages)
    monkeypatch.setattr(fetch, "fetch", lambda url, opts, cond=None: ("T", next(it), False, {"etag": '"v"'}))


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
    monkeypatch.setattr(fetch, "fetch", lambda url, opts, cond=None: (None, None, False, cond))
    check.run()
    assert sent == [] and status_of(tmp)["status"] == "ok"
    assert json.loads((tmp / "state" / "http.json").read_text())["https://a"]["etag"] == '"v"'


def test_robots_block_is_an_error(env, monkeypatch):
    tmp, sent = env
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: False)
    check.run()
    st = status_of(tmp)
    assert st["status"] == "error" and "robots.txt" in st["error"]


def test_ignore_robots_option(env, monkeypatch):
    tmp, sent = env
    (tmp / "urls.yml").write_text("urls:\n  - url: https://a\n    ignore_robots: true\n")
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: False)
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
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    page = "<html><title>T</title><body><main>" + "wort " * 100 + "</main></body></html>"
    monkeypatch.setattr(fetch, "fetch_body", lambda url, js, cond=None: (page, {}))
    add.main(["https://a/neu", "-y"])
    text = f.read_text()
    assert text.startswith("# Kommentar")
    entries = config.load_config(f)
    assert [e["url"] for e in entries] == ["https://a", "https://a/neu"]
    assert entries[1]["selector"] == "main"
    with pytest.raises(SystemExit):
        add.main(["https://a/neu", "-y"])


def test_add_main_list_format_and_rollback(tmp_path, monkeypatch):
    f = tmp_path / "urls.yml"
    f.write_text("- https://a\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    monkeypatch.setattr(fetch, "fetch_body", lambda url, js, cond=None: ("<body>" + "w " * 200 + "</body>", {}))
    add.main(["https://b", "-y", "--group", "G"])
    assert [e["url"] for e in config.load_config(f)] == ["https://a", "https://b"]

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
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: False)
    with pytest.raises(SystemExit):
        add.main(["https://b", "-y"])


@pytest.mark.parametrize(
    "pattern",
    [r"Last updated on\s*\S+", r"\d{2}:\d{2}", r"(Stand|Update): \d+", r"(a)?b"],
)
def test_config_errors_accepts_normal_patterns(pattern):
    assert config.config_errors({"ignore": [pattern]}) == []


@pytest.mark.parametrize("pattern", ["(unclosed", "[a-", "(a+)+$", "(.*)*x", "(\\d+\\s*)+"])
def test_config_errors_rejects_bad_patterns(pattern):
    assert len(config.config_errors({"ignore": [pattern]})) == 1


def test_config_errors_rejects_long_and_non_text():
    assert config.config_errors({"ignore": ["a" * 301]})
    assert config.config_errors({"ignore": [5]})


def test_load_config_single_string_ignore_is_not_split(tmp_path):
    f = tmp_path / "u.yml"
    f.write_text("urls:\n  - url: https://a\n    ignore: 'abc'\n")
    assert config.load_config(f)[0]["ignore"] == ["abc"]


def test_invalid_ignore_marks_url_and_fails_run(env, monkeypatch):
    tmp, sent = env
    (tmp / "urls.yml").write_text("urls:\n  - url: https://a\n    ignore: ['(a+)+$']\n  - url: https://b\n")
    fetched = []

    def fake_fetch(url, opts, cond=None):
        fetched.append(url)
        return "T", "text", False, {}

    monkeypatch.setattr(fetch, "fetch", fake_fetch)
    assert check.run() is False
    assert fetched == ["https://b"]
    status = json.loads((tmp / "state" / "status.json").read_text())
    assert status["https://a"]["status"] == "error"
    assert "Konfigurationsfehler" in status["https://a"]["error"]
    assert status["https://b"]["status"] == "new"


def test_fetch_all_runs_in_parallel_and_respects_host_limit(monkeypatch):
    import threading
    import time

    lock = threading.Lock()
    running = {"now": 0, "max": 0, "a": 0, "a_max": 0}

    def slow_fetch(url, opts, cond=None):
        host_a = "//a.example" in url
        with lock:
            running["now"] += 1
            running["max"] = max(running["max"], running["now"])
            if host_a:
                running["a"] += 1
                running["a_max"] = max(running["a_max"], running["a"])
        time.sleep(0.05)
        with lock:
            running["now"] -= 1
            if host_a:
                running["a"] -= 1
        return "T", url, False, {}

    monkeypatch.setattr(fetch, "fetch", slow_fetch)
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    jobs = [({"url": f"https://a.example/{i}"}, {}) for i in range(6)] + [
        ({"url": f"https://b{i}.example/"}, {}) for i in range(4)
    ]
    result = fetch.fetch_all(jobs)
    assert set(result) == {o["url"] for o, _ in jobs}
    assert result["https://a.example/3"][1] == "https://a.example/3"
    assert running["a_max"] <= fetch.MAX_PER_HOST
    assert 1 < running["max"] <= fetch.MAX_WORKERS


def test_fetch_all_returns_exceptions_per_url(monkeypatch):
    def fake_fetch(url, opts, cond=None):
        if url.endswith("bad"):
            raise RuntimeError("kaputt")
        return "T", "ok", False, {}

    monkeypatch.setattr(fetch, "fetch", fake_fetch)
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: url != "https://r/blocked")
    jobs = [({"url": u}, {}) for u in ("https://a/good", "https://a/bad", "https://r/blocked")]
    result = fetch.fetch_all(jobs)
    assert result["https://a/good"][1] == "ok"
    assert str(result["https://a/bad"]) == "kaputt"
    assert "robots.txt" in str(result["https://r/blocked"])


def test_fetch_all_js_pages_run_one_at_a_time(monkeypatch):
    import threading
    import time

    state = {"now": 0, "max": 0}
    lock = threading.Lock()

    def fake_fetch(url, opts, cond=None):
        with lock:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
        time.sleep(0.03)
        with lock:
            state["now"] -= 1
        return "T", "x", False, {}

    monkeypatch.setattr(fetch, "fetch", fake_fetch)
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    fetch.fetch_all([({"url": f"https://h{i}/", "js": True}, {}) for i in range(4)])
    assert state["max"] == 1


def test_fetch_all_empty():
    assert fetch.fetch_all([]) == {}


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("robots", "ignore_robots"),
        ("http_403", "js: true"),
        ("http_404", "URL"),
        ("timeout", "zu langsam"),
        ("http_429", "Rate-Limit"),
        ("http_5xx", "Serverfehler"),
        ("connection", "Verbindung"),
        ("selector", "Selector"),
        ("content", "min_ratio"),
        ("config", "urls.yml"),
    ],
)
def test_hint_for_known_codes(code, expected):
    assert expected in notify.hint_for(code)


def test_hint_for_unknown_code_is_empty():
    assert notify.hint_for("") == "" and notify.hint_for(None) == ""
    assert notify.with_hint("Text", "unbekannt") == "Text"
    assert notify.with_hint("Text", "timeout").startswith("Text\n  Tipp: ")


def test_error_code_classifies_exceptions():
    import requests

    resp = requests.Response()
    resp.status_code = 503
    assert errors.error_code(errors.CheckError("x", "selector")) == "selector"
    assert errors.error_code(requests.HTTPError(response=resp)) == "http_5xx"
    assert errors.error_code(requests.Timeout()) == "timeout"
    assert errors.error_code(requests.ConnectionError()) == "connection"
    assert errors.error_code(ValueError("x")) == ""


def test_repeated_failure_mail_contains_hint(env, monkeypatch):
    tmp, sent = env

    def boom(url, opts, cond=None):
        raise errors.CheckError("Abruf nach 3 Versuchen fehlgeschlagen (Timeout)", "timeout")

    monkeypatch.setattr(fetch, "fetch", boom)
    for _ in range(check.FAIL_ALERT_AFTER):
        check.run()
    subject, body = sent[-1]
    assert subject == "Watchlist: Probleme beim Abruf"
    assert "Tipp:" in body and "zu langsam" in body
    status = json.loads((tmp / "state" / "status.json").read_text())
    assert status["https://a"]["streak"] == check.FAIL_ALERT_AFTER


def test_heartbeat_groups_and_stuck_pages(monkeypatch):
    from datetime import UTC, datetime

    sent = []
    monkeypatch.setattr(notify, "send_mail", lambda s, t, h=None: sent.append(t))
    status = {
        "https://a": {"name": "A", "group": "Azure", "status": "ok"},
        "https://b": {
            "name": "B",
            "group": "Azure",
            "status": "error",
            "error": "Timeout",
            "code": "timeout",
            "streak": notify.STUCK_AFTER,
        },
        "https://c": {"name": "C", "group": "", "status": "error", "error": "404 Client Error", "streak": 1},
    }
    hist = [{"time": "2026-11-02 06:00 UTC", "name": "A", "group": "Azure"}]
    notify.send_heartbeat(datetime(2026, 11, 3, tzinfo=UTC), [1, 2, 3], status, hist, {"heartbeat": "2026-10"})
    body = sent[0]
    assert "- Azure: 2 / 1 / 1" in body
    assert "- Allgemein: 1 / 0 / 1" in body
    assert "Dauerhaft kaputt" in body and "B (https://b)" in body and "Tipp:" in body
    assert "C (https://c)" not in body.split("Dauerhaft kaputt")[1]


class FakePage:
    def __init__(self, url):
        self.url = url

    def goto(self, url, **kwargs):
        self.url = url

    def content(self):
        return f"<main>{self.url}</main>"

    def close(self):
        pass


class FakeBrowser:
    def __init__(self, log):
        self.log = log
        self.connected = True

    def new_page(self, **kwargs):
        self.log["threads"].add(threading.get_ident())
        return FakePage("")

    def is_connected(self):
        return self.connected

    def close(self):
        self.log["closed"] += 1


def install_fake_playwright(monkeypatch):
    log = {"launched": 0, "closed": 0, "stopped": 0, "threads": set(), "browsers": []}

    class FakePlaywright:
        class chromium:  # noqa: N801
            @staticmethod
            def launch():
                log["launched"] += 1
                browser = FakeBrowser(log)
                log["browsers"].append(browser)
                return browser

        def stop(self):
            log["stopped"] += 1

    class Ctx:
        def start(self):
            return FakePlaywright()

    module = types.ModuleType("playwright.sync_api")
    module.sync_playwright = lambda: Ctx()
    monkeypatch.setitem(sys.modules, "playwright", types.ModuleType("playwright"))
    monkeypatch.setitem(sys.modules, "playwright.sync_api", module)
    return log


def test_browser_started_once_per_run_and_closed(monkeypatch):
    log = install_fake_playwright(monkeypatch)
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    jobs = [({"url": f"https://h{i}.example/", "js": True}, {}) for i in range(4)]
    result = fetch.fetch_all(jobs)
    assert [result[o["url"]][1] for o, _ in jobs] == [f"https://h{i}.example/" for i in range(4)]
    assert log["launched"] == 1 and log["closed"] == 1 and log["stopped"] == 1
    assert len(log["threads"]) == 1  # alle Seiten im selben Thread (Playwright ist thread-gebunden)
    assert fetch._browser_pool is None


def test_no_browser_without_js_pages(monkeypatch):
    log = install_fake_playwright(monkeypatch)
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    monkeypatch.setattr(fetch, "fetch", lambda url, opts, cond=None: ("T", "x", False, {}))
    fetch.fetch_all([({"url": "https://a/"}, {})])
    assert log["launched"] == 0 and fetch._browser_pool is None


def test_browser_restarts_after_crash(monkeypatch):
    log = install_fake_playwright(monkeypatch)
    pool = fetch.BrowserPool()
    try:
        pool.content("https://a/")
        log["browsers"][0].connected = False
        assert pool.content("https://b/") == "<main>https://b/</main>"
    finally:
        pool.close()
    assert log["launched"] == 2 and log["stopped"] == 2


def test_single_js_fetch_outside_run_uses_own_browser(monkeypatch):
    log = install_fake_playwright(monkeypatch)
    body, validators = fetch.fetch_body("https://a/", True)
    assert "<main>" in body and validators == {}
    assert log["launched"] == 1 and log["closed"] == 1


def test_browser_pool_without_playwright_gives_clear_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "playwright.sync_api", None)
    pool = fetch.BrowserPool()
    try:
        with pytest.raises(RuntimeError, match="Playwright"):
            pool.content("https://a/")
    finally:
        pool.close()


def test_annotate_diff_marks_changed_words():
    segs = diffing.annotate_diff(["@@ -1 +1 @@", "-Preis: 10 Euro", "+Preis: 12 Euro", "-weg"])
    assert [s for s, changed in segs[1] if changed] == ["10"]
    assert [s for s, changed in segs[2] if changed] == ["12"]
    assert segs[3] == [("-weg", False)]
    assert diffing.annotate_diff(["-alt komplett", "+ganz anders hier"])[0] == [("-alt komplett", False)]


def test_render_html_highlights_words_and_counts():
    html = notify.render_html([{"name": "X", "url": "https://a", "group": "G", "diff": ["-a 1", "+a 2"], "extra": 0}])
    assert 'font-weight:600">1</span>' in html
    assert "+1" in html
    assert diffing.diff_counts(["+a", "+b", "-c", "+++x"]) == (2, 1)


def test_record_run_keeps_last_runs_and_counts_errors():
    status = {"a": {"status": "ok"}, "b": {"status": "error"}, "c": {"status": "warn"}}
    runs = []
    for i in range(check.MAX_RUNS + 2):
        runs = check.record_run(runs, f"t{i}", 1.234, status, 1, True)
    assert len(runs) == check.MAX_RUNS
    assert runs[-1] == {
        "time": f"t{check.MAX_RUNS + 1}",
        "seconds": 1.2,
        "total": 3,
        "errors": 1,
        "warns": 1,
        "changes": 1,
        "ok": True,
    }
    assert runs[0]["time"] == "t2"


def test_run_stores_run_summary(env, monkeypatch):
    tmp, sent = env
    (tmp / "urls.yml").write_text("urls:\n  - url: https://b\n")
    monkeypatch.setattr(fetch, "fetch", lambda url, opts, cond=None: ("T", "text", False, {}))
    check.run()
    runs = json.loads((tmp / "state" / "runs.json").read_text())
    assert len(runs) == 1 and runs[0]["total"] == 1 and runs[0]["errors"] == 0


def test_is_due_respects_interval_and_problems():
    from datetime import UTC, datetime, timedelta

    now = datetime(2026, 10, 25, 18, 0, tzinfo=UTC)
    ok = {"status": "ok", "checked": (now - timedelta(hours=12)).strftime("%Y-%m-%d %H:%M UTC")}
    assert config.is_due({}, ok, now)
    assert not config.is_due({"interval": "daily"}, ok, now)
    assert not config.is_due({"interval": "weekly"}, ok, now)
    old = {"status": "ok", "checked": (now - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M UTC")}
    assert config.is_due({"interval": "daily"}, old, now)
    assert not config.is_due({"interval": "weekly"}, old, now)
    week = {"status": "ok", "checked": (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M UTC")}
    assert config.is_due({"interval": "weekly"}, week, now)
    assert config.is_due({"interval": "weekly"}, {**ok, "status": "error"}, now)
    assert config.is_due({"interval": "weekly"}, ok, now, has_snapshot=False)
    assert config.is_due({"interval": "weekly"}, {}, now)


def test_invalid_interval_is_config_error():
    assert config.config_errors({"interval": "monthly"})
    assert not config.config_errors({"interval": "weekly"})


def test_run_skips_url_not_yet_due(env, monkeypatch):
    tmp, sent = env
    (tmp / "urls.yml").write_text("urls:\n  - url: https://b\n    interval: weekly\n")
    calls = []

    def fake_fetch(url, opts, cond=None):
        calls.append(url)
        return "T", "text", False, {}

    monkeypatch.setattr(fetch, "fetch", fake_fetch)
    assert check.run() is True
    assert check.run() is True
    assert calls == ["https://b"]
    status = json.loads((tmp / "state" / "status.json").read_text())
    assert status["https://b"]["status"] == "new"
    assert status["https://b"]["checked"]
