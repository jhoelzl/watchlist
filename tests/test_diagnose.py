import json

import check
import diagnose
import fetch
import notify
from errors import CheckError


class Resp:
    def __init__(self, status, url):
        self.status_code, self.url = status, url


def opts(**kw):
    return {"url": "https://example.com/old", **kw}


def test_moved_page_is_found_via_variant(monkeypatch):
    def fake_get(url, headers, timeout):
        return Resp(200, "https://www.example.com/old") if url == "https://www.example.com/old" else Resp(404, url)

    monkeypatch.setattr(diagnose, "safe_get", fake_get)
    d = diagnose.diagnose(opts(), "http_404", "gone")
    assert d and d["fix"] == {"type": "url", "url": "https://www.example.com/old"}


def test_redirect_target_is_suggested(monkeypatch):
    monkeypatch.setattr(diagnose, "safe_get", lambda url, headers, timeout: Resp(200, "https://example.com/new"))
    d = diagnose.diagnose(opts(), "http_404", "gone")
    assert d and d["fix"]["url"] == "https://example.com/new"


def test_no_suggestion_when_nothing_works(monkeypatch):
    def fake_get(url, headers, timeout):
        raise CheckError("nope", "connection")

    monkeypatch.setattr(diagnose, "safe_get", fake_get)
    assert diagnose.diagnose(opts(), "http_404", "gone") is None


def test_js_suggested_for_redirect_loop_and_short_text(monkeypatch):
    def loop(url, headers, timeout):
        raise CheckError("Too many redirects", "redirects")

    monkeypatch.setattr(diagnose, "safe_get", loop)
    monkeypatch.setattr(fetch, "fetch", lambda url, o, cond=None: ("T", "x" * 500, False, {}))
    assert diagnose.diagnose(opts(), "redirects", "loop")["fix"] == {"type": "js"}
    assert diagnose.diagnose(opts(), "content", "short", min_chars=400)["fix"] == {"type": "js"}
    assert diagnose.diagnose(opts(), "content", "short", min_chars=900) is None  # rendered text is too short as well
    assert diagnose.diagnose(opts(js=True), "http_403", "blocked") is None  # already using a browser


def test_js_probe_failure_is_silent(monkeypatch):
    def boom(url, o, cond=None):
        raise RuntimeError("no playwright")

    monkeypatch.setattr(fetch, "fetch", boom)
    assert diagnose.diagnose(opts(), "http_403", "blocked") is None


def test_robots_and_selector(monkeypatch):
    assert diagnose.diagnose(opts(), "robots", "x")["fix"] == {"type": "ignore_robots"}
    page = "<html><body><main>" + "word " * 100 + "</main></body></html>"
    monkeypatch.setattr(fetch, "fetch_body", lambda url, js, cond=None: (page, {}))
    assert diagnose.diagnose(opts(selector="#gone"), "selector", "x")["fix"] == {"type": "selector"}
    assert diagnose.diagnose(opts(selector="auto"), "selector", "x") is None


def test_diagnosis_runs_once_at_streak_two_and_is_carried(tmp_path, monkeypatch):
    (tmp_path / "urls.yml").write_text("urls:\n  - url: https://a\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "STATE", tmp_path / "state")
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    mails = []
    monkeypatch.setattr(notify, "send_mail", lambda s, t, h=None: mails.append(t))

    def failing(url, o, cond=None):
        raise CheckError("Page no longer exists (HTTP 404)", "http_404")

    monkeypatch.setattr(fetch, "fetch", failing)
    calls = []

    def fake_diag(o, code, msg, min_chars=0):
        calls.append(code)
        return {"text": "moved", "fix": {"type": "url", "url": "https://b"}}

    monkeypatch.setattr(check, "diagnose", fake_diag)

    def status():
        return json.loads((tmp_path / "state" / "status.json").read_text())["https://a"]

    check.run()
    assert "diagnosis" not in status() and calls == []
    check.run()  # 404 is permanent: alert and diagnosis in the same run
    assert status()["diagnosis"]["fix"]["url"] == "https://b" and calls == ["http_404"]
    assert any("Suggested fix: moved" in m for m in mails)
    check.run()  # Carried over, not diagnosed again
    assert status()["diagnosis"]["text"] == "moved" and calls == ["http_404"]
