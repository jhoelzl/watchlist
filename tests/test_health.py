import check
import fetch


def test_record_health_appends_and_caps():
    status = {"https://a": {"status": "ok"}, "https://b": {"status": "error"}, "https://c": {"status": "warn"}}
    h = check.record_health(
        {}, status, {"https://a", "https://b", "https://c"}, {"https://a": 120, "https://b": 900}, set(status)
    )
    assert h["https://a"] == {"h": "o", "ms": [120]}
    assert h["https://b"] == {"h": "e", "ms": []}  # failed fetches do not count towards the average
    assert h["https://c"]["h"] == "w"
    again = check.record_health(h, status, {"https://a"}, {"https://a": 80}, set(status))
    assert again["https://a"] == {"h": "oo", "ms": [120, 80]} and again["https://b"] == h["https://b"]
    long = {"https://a": {"h": "o" * check.HEALTH_CHECKS, "ms": [1] * check.HEALTH_TIMES}}
    capped = check.record_health(long, {"https://a": {"status": "error"}}, {"https://a"}, {}, {"https://a"})
    assert len(capped["https://a"]["h"]) == check.HEALTH_CHECKS and capped["https://a"]["h"].endswith("oe")


def test_record_health_drops_deleted_urls_and_skips_unfetched():
    h = {"https://old": {"h": "o", "ms": [1]}, "https://a": {"h": "o", "ms": [5]}}
    out = check.record_health(h, {"https://a": {"status": "ok"}}, set(), {}, {"https://a"})
    assert out == {"https://a": {"h": "o", "ms": [5]}}


def test_fetch_all_records_timings(monkeypatch):
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    monkeypatch.setattr(fetch, "fetch", lambda url, o, cond=None: ("T", "text", False, {}))
    fetch.fetch_all([({"url": "https://a/x"}, {})])
    assert "https://a/x" in fetch.FETCH_MS and fetch.FETCH_MS["https://a/x"] >= 0
