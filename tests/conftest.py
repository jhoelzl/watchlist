import pytest

import netsafe


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    """Tests never hit real DNS: every host resolves to a public address."""
    monkeypatch.setattr(netsafe, "resolve_ips", lambda host: ["93.184.216.34"])
