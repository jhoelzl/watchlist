import json

import pytest
from test_features import FakeResp, env, set_pages, status_of  # noqa: F401

import add
import check
import config
import errors
import fetch
import notify


@pytest.fixture
def sleeps(monkeypatch):
    calls = []
    monkeypatch.setattr(fetch.time, "sleep", calls.append)
    monkeypatch.setattr(fetch.random, "uniform", lambda a, b: 0)
    return calls


def sequence(monkeypatch, items):
    it = iter(items)

    def fake(url, **kw):
        item = next(it)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(fetch.requests, "get", fake)


def test_retry_on_5xx_then_ok(monkeypatch, sleeps):
    sequence(monkeypatch, [FakeResp(503), FakeResp(200, "ok")])
    assert fetch.get_with_retry("https://a", {}).text == "ok"
    assert sleeps == [2]


def test_retry_on_connection_error(monkeypatch, sleeps):
    sequence(monkeypatch, [fetch.requests.ConnectionError(), fetch.requests.Timeout(), FakeResp(200, "ok")])
    assert fetch.get_with_retry("https://a", {}).status_code == 200
    assert sleeps == [2, 5]


def test_no_retry_on_404_or_304(monkeypatch, sleeps):
    sequence(monkeypatch, [FakeResp(404)])
    assert fetch.get_with_retry("https://a", {}).status_code == 404
    sequence(monkeypatch, [FakeResp(304)])
    assert fetch.get_with_retry("https://a", {}).status_code == 304
    assert sleeps == []


def test_retry_gives_up(monkeypatch, sleeps):
    sequence(monkeypatch, [FakeResp(500), FakeResp(502), FakeResp(503)])
    with pytest.raises(RuntimeError, match="3 attempts"):
        fetch.get_with_retry("https://a", {})


def test_retry_after_header_capped(monkeypatch, sleeps):
    sequence(monkeypatch, [FakeResp(429, headers={"Retry-After": "999"}), FakeResp(200)])
    fetch.get_with_retry("https://a", {})
    assert sleeps == [30]


BIG = "\n".join(f"line {i}" for i in range(300))
CHANGED = BIG + "\nnew line"


def failing_mail(monkeypatch, fail_count):
    sent = []

    def send(subject, text, html=None):
        if len(sent) < fail_count:
            sent.append(None)
            raise RuntimeError("Resend 500")
        sent.append(subject)

    monkeypatch.setattr(notify, "send_mail", send)
    return sent


def test_mail_failure_keeps_snapshot_and_retries(env, monkeypatch):
    tmp, _ = env
    set_pages(monkeypatch, [BIG, CHANGED, CHANGED])
    assert check.run() is True  # Baseline
    snap = next((tmp / "state").glob("*.txt"))
    sent = failing_mail(monkeypatch, 1)
    assert check.run() is False
    assert snap.read_text() == BIG
    assert status_of(tmp)["status"] == "error"
    assert not (tmp / "state" / "history.json").read_text().strip("[]\n ")
    assert check.run() is True  # the next run detects the change again
    assert snap.read_text() == CHANGED
    assert len(sent) == 2 and sent[1].startswith("Watchlist:")
    assert len(json.loads((tmp / "state" / "history.json").read_text())) == 1


def test_problem_alert_repeats_after_mail_failure(env, monkeypatch):
    tmp, _ = env
    sent = failing_mail(monkeypatch, 1)

    def boom(url, opts, cond=None):
        raise RuntimeError("down")

    monkeypatch.setattr(fetch, "fetch", boom)
    results = [check.run() for _ in range(check.FAIL_ALERT_AFTER + 1)]
    assert results == [True] * (check.FAIL_ALERT_AFTER - 1) + [False, True]
    assert len(sent) == 2 and sent[1] == "Watchlist: 1 fetch problem"


def test_main_exit_code(monkeypatch):
    monkeypatch.setattr(check, "run", lambda: False)
    assert check.main(["check.py"]) == 1
    monkeypatch.setattr(check, "run", lambda: True)
    assert check.main(["check.py"]) == 0


def test_find_feeds():
    html = (
        '<head><link rel="alternate" type="application/rss+xml" href="/feed.xml">'
        '<link rel="alternate" type="application/atom+xml" href="https://x/a.atom">'
        '<link rel="alternate" type="application/rss+xml" href="/feed.xml">'
        '<link rel="stylesheet" href="/s.css"><link rel="alternate" hreflang="de" href="/de"></head>'
    )
    assert add.find_feeds(html, "https://x/blog/") == ["https://x/feed.xml", "https://x/a.atom"]


def test_add_main_feed_flag(tmp_path, monkeypatch):
    f = tmp_path / "urls.yml"
    f.write_text("urls:\n  - url: https://other\n")
    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    page = '<html><head><link rel="alternate" type="application/rss+xml" href="/f.xml"></head><body>x</body></html>'
    rss = (
        "<?xml version='1.0'?><rss><channel><title>T</title><item><title>A</title><link>https://x/1</link></item></channel></rss>"
    )
    monkeypatch.setattr(fetch, "fetch_body", lambda url, js, cond=None: (rss if url.endswith(".xml") else page, {}))
    add.main(["https://x/blog", "--feed", "-y"])
    assert [e["url"] for e in config.load_config(f)] == ["https://other", "https://x/f.xml"]


def test_retry_wait_has_jitter(monkeypatch, sleeps):
    monkeypatch.setattr(fetch.random, "uniform", lambda a, b: b)
    sequence(monkeypatch, [FakeResp(503), FakeResp(200)])
    fetch.get_with_retry("https://a", {})
    assert sleeps == [2.5]


def test_404_is_permanent_error(monkeypatch, sleeps):
    sequence(monkeypatch, [FakeResp(404)])
    with pytest.raises(errors.CheckError, match="persistent error") as ei:
        fetch.fetch_body("https://a", False)
    assert ei.value.code == "http_404" and sleeps == []


def test_permanent_error_alerts_earlier(env, monkeypatch):
    tmp, sent = env

    def boom(url, opts, cond=None):
        raise errors.CheckError("Page no longer exists (HTTP 404), persistent error", "http_404")

    monkeypatch.setattr(fetch, "fetch", boom)
    check.run()
    assert sent == []
    check.run()
    assert len(sent) == 1 and "2 times in a row" in sent[0][1]
