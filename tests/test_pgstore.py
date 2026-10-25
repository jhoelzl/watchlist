"""Integrationstest gegen echtes Postgres: WATCHLIST_TEST_DSN setzen oder pgserver installieren, sonst wird übersprungen."""

import os
import tempfile
from pathlib import Path

import pytest

import check
import config
import fetch
import migrate
import notify
from store import FileStore, PgStore

SCHEMA = Path(__file__).parent.parent / "supabase" / "schema.sql"


@pytest.fixture(scope="module")
def dsn():
    url = os.environ.get("WATCHLIST_TEST_DSN")
    if url:
        yield url
        return
    pgserver = pytest.importorskip("pgserver")
    with tempfile.TemporaryDirectory() as d:
        server = pgserver.get_server(d, cleanup_mode="stop")
        yield server.get_uri()
        server.cleanup()


@pytest.fixture
def db(dsn, monkeypatch):
    import psycopg

    with psycopg.connect(dsn, autocommit=True) as c:
        c.execute("drop schema public cascade; create schema public")
        c.execute(SCHEMA.read_text())
    store = PgStore(dsn)
    monkeypatch.setenv("SUPABASE_DB_URL", dsn)
    yield store
    store.close()


def test_store_roundtrip(db):
    db.add_url({"url": "https://a", "name": "A", "group": "G", "selector": "main", "ignore": ["x"]})
    db.add_url({"url": "https://b"})
    db.set_defaults({"ignore": ["d"]})
    entries = config.merge_config(db.raw_config())
    assert [e["url"] for e in entries] == ["https://a", "https://b"]
    assert entries[0]["selector"] == "main" and entries[0]["group"] == "G" and entries[0]["ignore"] == ["d", "x"]
    with pytest.raises(Exception, match="duplicate"):
        db.add_url({"url": "https://a"})

    assert db.snapshot("k") is None
    db.set_snapshot("k", "https://a", "eins")
    db.set_snapshot("k", "https://a", "zwei äö")
    assert db.snapshot("k") == "zwei äö" and db.snapshot_keys() == {"k"}

    assert db.counter("k", "fail") == 0
    db.set_counter("k", "fail", 2)
    assert db.counter("k", "fail") == 2
    db.clear_counter("k", "fail")
    assert db.counter("k", "fail") == 0

    assert db.doc("status", {}) == {}
    db.set_doc("status", {"https://a": {"status": "ok", "streak": 2}})
    assert db.doc("status", {})["https://a"]["streak"] == 2

    db.add_history([{"name": "A", "url": "https://a", "group": "G", "time": "t1", "diff": ["+x", "-y"], "extra": 3}], 10)
    db.add_history([{"name": "A", "url": "https://a", "group": None, "time": "t2", "diff": ["+z"], "extra": 0}], 10)
    assert [h["time"] for h in db.history(10)] == ["t1", "t2"]
    assert [h["time"] for h in db.history(1)] == ["t2"]
    assert db.history(10)[0]["diff"] == ["+x", "-y"] and db.history(10)[0]["extra"] == 3


def test_run_uses_database(db, tmp_path, monkeypatch):
    db.add_url({"url": "https://a", "group": "G"})
    pages = iter(["eins", "zwei"])
    monkeypatch.setattr(check, "STATE", tmp_path / "state")
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    monkeypatch.setattr(fetch, "fetch", lambda url, opts, cond=None: ("T", next(pages), False, {}))
    sent = []
    monkeypatch.setattr(notify, "send_mail", lambda subject, text, html_body=None: sent.append(subject))
    assert check.run()
    assert check.run()
    assert len(sent) == 1 and "geändert" in sent[0]
    assert db.history(10)[0]["diff"][-2:] == ["-eins", "+zwei"]
    assert db.doc("status", {})["https://a"]["changed"]
    assert not (tmp_path / "state").exists()  # nichts lokal geschrieben


def test_migrate_from_files(db, tmp_path):
    cfg = tmp_path / "urls.yml"
    cfg.write_text("defaults:\n  ignore: ['d']\nurls:\n  - url: https://a\n    group: G\n  - https://b\n")
    files = FileStore(tmp_path / "state", cfg)
    key = migrate.url_key("https://a")
    files.set_snapshot(key, "", "text a")
    files.set_counter(key, "fail", 2)
    files.set_doc("status", {"https://a": {"status": "ok"}})
    files.set_doc("meta", {"heartbeat": "2026-10"})
    files.add_history([{"name": "A", "url": "https://a", "group": "G", "time": "t", "diff": ["+x"], "extra": 0}], 10)

    assert migrate.migrate(files, db) == {"urls": 2, "snapshots": 1, "counters": 1, "history": 1}
    assert migrate.migrate(files, db) == {"urls": 0, "snapshots": 1, "counters": 1, "history": 0}  # idempotent
    assert db.snapshot(key) == "text a" and db.counter(key, "fail") == 2
    assert db.doc("meta", {}) == {"heartbeat": "2026-10"}
    assert [e["url"] for e in config.merge_config(db.raw_config())] == ["https://a", "https://b"]
    assert len(db.history(10)) == 1


def test_add_writes_to_database(db, monkeypatch):
    import add

    html = "<html><head><title>Seite</title></head><body><main>" + "Text " * 80 + "</main></body></html>"
    monkeypatch.setattr(fetch, "robots_allowed", lambda url, cache: True)
    monkeypatch.setattr(fetch, "fetch_body", lambda url, js, cond=None: (html, {}))
    add.main(["https://neu.example/", "--group", "G", "-y"])
    entry = config.merge_config(db.raw_config())[0]
    assert entry["url"] == "https://neu.example/" and entry["group"] == "G" and entry["selector"] == "main"
    with pytest.raises(SystemExit, match="Schon vorhanden"):
        add.main(["https://neu.example/", "-y"])
