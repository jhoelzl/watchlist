import pytest

import check
import notify
import summarize


class Resp:
    def __init__(self, content="Pricing updated", status=200):
        self.content, self.status = content, status

    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError(f"HTTP {self.status}")

    def json(self):
        return {"choices": [{"message": {"content": self.content}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WATCHLIST_SUMMARIES", "true")
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MAX_PER_RUN", raising=False)


def change(**kw):
    return {"name": "N", "url": "https://a", "group": None, "diff": ["+new price", "-old price"], "extra": 0, **kw}


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("WATCHLIST_SUMMARIES", raising=False)
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setattr(summarize.requests, "post", lambda *a, **k: pytest.fail("must not call"))
    c = change()
    summarize.add_summaries([(c, True)])
    assert "summary" not in c


def test_summary_is_set_and_request_is_bounded(on, monkeypatch):
    seen = {}

    def post(url, headers, json, timeout):
        seen.update(url=url, auth=headers["Authorization"], body=json)
        return Resp('"Pricing table updated."\nsecond line')

    monkeypatch.setattr(summarize.requests, "post", post)
    c = change(diff=["+x" * 5000])
    summarize.add_summaries([(c, True)])
    assert c["summary"] == "Pricing table updated."
    assert seen["url"].endswith("/chat/completions") and seen["auth"] == "Bearer t"
    assert len(seen["body"]["messages"][1]["content"]) <= summarize.MAX_INPUT_CHARS
    assert seen["body"]["max_tokens"] == summarize.MAX_OUTPUT_TOKENS


def test_errors_are_silent(on, monkeypatch):
    monkeypatch.setattr(summarize.requests, "post", lambda *a, **k: Resp(status=500))
    c = change()
    summarize.add_summaries([(c, True)])
    assert "summary" not in c


def test_limit_and_opt_out(on, monkeypatch):
    monkeypatch.setenv("LLM_MAX_PER_RUN", "1")
    calls = []
    monkeypatch.setattr(summarize.requests, "post", lambda *a, **k: calls.append(1) or Resp())
    a, b, c = change(), change(url="https://b"), change(url="https://c")
    summarize.add_summaries([(a, False), (b, True), (c, True)])
    assert "summary" not in a and b["summary"] and "summary" not in c and len(calls) == 1


def test_long_output_is_cut():
    assert len(summarize.clean("x" * 500)) == summarize.MAX_SUMMARY_CHARS


def test_summary_in_mails_is_escaped():
    c = change(summary="<b>Price</b> changed")
    assert "<b>Price</b> changed" in notify.render_text([c])
    html = notify.render_html([c])
    assert "&lt;b&gt;Price&lt;/b&gt; changed" in html and "<b>Price</b>" not in html


def test_send_change_mail_adds_summary(on, monkeypatch):
    monkeypatch.setattr(summarize.requests, "post", lambda *a, **k: Resp("Short"))
    mails = []
    monkeypatch.setattr(notify, "send_mail", lambda s, t, h=None: mails.append(t))
    store = type("S", (), {"set_snapshot": lambda *a, **k: None})()
    c = change()
    st = check.RunState("2026-10-26 12:00 UTC", {}, {})
    st.changes = [c]
    st.pending = [{"change": c, "key": "k", "text": "t", "entry": {}, "cache": None}]
    hist, new = [], []
    assert check.send_change_mail(store, st, hist, new)
    assert "Short" in mails[0] and new[0]["summary"] == "Short"
