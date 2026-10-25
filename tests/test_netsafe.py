import pytest
from test_features import FakeResp

import fetch
import netsafe
from errors import CheckError


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "http://localhost/admin",
        "http://printer.local/",
        "http://metadata.internal/",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://[::1]/",
        "http://100.64.0.1/",
    ],
)
def test_blocked_urls(url):
    with pytest.raises(CheckError) as ex:
        netsafe.ensure_public_url(url)
    assert ex.value.code == "blocked_url"


def test_public_urls_pass():
    netsafe.ensure_public_url("https://example.com/a")
    netsafe.ensure_public_url("http://93.184.216.34/")


def test_hostname_resolving_to_private_ip_is_blocked(monkeypatch):
    monkeypatch.setattr(netsafe, "resolve_ips", lambda host: ["93.184.216.34", "10.0.0.1"])
    with pytest.raises(CheckError):
        netsafe.ensure_public_url("https://evil.example")


def test_unresolvable_host_is_left_to_the_fetch(monkeypatch):
    monkeypatch.setattr(netsafe, "resolve_ips", lambda host: [])
    netsafe.ensure_public_url("https://does-not-exist.example")


def test_redirect_to_internal_address_is_blocked(monkeypatch):
    calls = []

    def fake(url, **kw):
        calls.append(url)
        return FakeResp(302, headers={"Location": "http://169.254.169.254/latest"})

    monkeypatch.setattr(netsafe.requests, "get", fake)
    with pytest.raises(CheckError) as ex:
        fetch.get_with_retry("https://example.com/", {})
    assert ex.value.code == "blocked_url"
    assert calls == ["https://example.com/"]


def test_relative_redirect_is_followed(monkeypatch):
    seen = []

    def fake(url, **kw):
        seen.append(url)
        return FakeResp(301, headers={"Location": "/new"}) if len(seen) == 1 else FakeResp(200, "ok")

    monkeypatch.setattr(netsafe.requests, "get", fake)
    assert fetch.get_with_retry("https://example.com/old", {}).text == "ok"
    assert seen == ["https://example.com/old", "https://example.com/new"]


def test_redirect_loop_is_stopped(monkeypatch):
    monkeypatch.setattr(netsafe.requests, "get", lambda url, **kw: FakeResp(302, headers={"Location": url}))
    with pytest.raises(CheckError):
        fetch.get_with_retry("https://example.com/", {})


class FakeRoute:
    def __init__(self, url, navigation=True):
        self.request = type("R", (), {"url": url, "is_navigation_request": lambda self: navigation})()
        self.actions = []

    def abort(self):
        self.actions.append("abort")

    def continue_(self):
        self.actions.append("continue")


def test_browser_blocks_internal_navigation_only():
    internal, public, asset = (
        FakeRoute("http://10.0.0.1/"),
        FakeRoute("https://example.com/"),
        FakeRoute("http://10.0.0.1/x.png", False),
    )
    for r in (internal, public, asset):
        fetch._block_internal_navigation(r)
    assert (internal.actions, public.actions, asset.actions) == (["abort"], ["continue"], ["continue"])
