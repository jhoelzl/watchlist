"""RestStore gegen eine In-Memory-Nachbildung der Supabase-REST-API (PostgREST)."""

import json

import config
import migrate
from store import FileStore, RestStore, open_store

PRIMARY = {
    "watchlist_settings": ("key",),
    "watchlist_snapshots": ("key",),
    "watchlist_counters": ("key", "kind"),
    "watchlist_state": ("key",),
    "watchlist_urls": ("url",),
}


class FakeResponse:
    def __init__(self, status=200, data=None):
        self.status_code = status
        self.ok = status < 400
        self._data = data
        self.text = str(data)

    def json(self):
        return self._data


class FakeSession:
    def __init__(self):
        self.headers = {}
        self.tables = {}
        self.seq = 0

    def close(self):
        pass

    def request(self, method, url, params=None, headers=None, data=None, timeout=None):
        table = url.rsplit("/", 1)[1]
        rows = self.tables.setdefault(table, [])
        params = dict(params or {})
        if method == "POST":
            body = json.loads(data)
            body = body if isinstance(body, list) else [body]
            on_conflict = params.get("on_conflict")
            for row in body:
                pk = tuple(on_conflict.split(",")) if on_conflict else PRIMARY.get(table, ())
                match = [r for r in rows if pk and all(r.get(k) == row.get(k) for k in pk)]
                if match and on_conflict:
                    match[0].update(row)
                elif match:
                    return FakeResponse(409, "duplicate key")
                else:
                    self.seq += 1
                    rows.append({"id": self.seq, "active": True, "position": 0, "options": {}, **row})
            return FakeResponse(201)
        selected = [r for r in rows if all(self._eq(r, k, v) for k, v in params.items() if v.startswith("eq."))]
        if method == "DELETE":
            rows[:] = [r for r in rows if r not in selected]
            return FakeResponse(204)
        for spec in reversed(params.get("order", "").split(",")):
            if spec:
                col, _, direction = spec.partition(".")
                selected.sort(key=lambda r: r[col], reverse=direction == "desc")
        start = int(params.get("offset", 0))
        end = start + int(params["limit"]) if "limit" in params else None
        return FakeResponse(200, [dict(r) for r in selected[start:end]])

    @staticmethod
    def _eq(row, key, value):
        actual = row.get(key)
        return (str(actual).lower() if isinstance(actual, bool) else str(actual)) == value[3:]


def make_store():
    store = RestStore("https://x.supabase.co", "service-key")
    store.http = FakeSession()
    return store


def test_roundtrip():
    db = make_store()
    db.add_url({"url": "https://a", "name": "A", "group": "G", "selector": "main"})
    db.add_url({"url": "https://b", "js": True})
    db.set_defaults({"ignore": ["d"]})
    entries = config.merge_config(db.raw_config())
    assert [e["url"] for e in entries] == ["https://a", "https://b"]
    assert entries[0]["group"] == "G" and entries[0]["selector"] == "main" and entries[0]["ignore"] == ["d"]
    assert entries[1]["js"] is True

    db.set_snapshot("k", "https://a", "eins")
    db.set_snapshot("k", "https://a", "zwei")
    assert db.snapshot("k") == "zwei" and db.snapshot_keys() == {"k"} and db.snapshot("x") is None
    db.set_counter("k", "fail", 1)
    db.set_counter("k", "fail", 2)
    assert db.counter("k", "fail") == 2
    db.clear_counter("k", "fail")
    assert db.counter("k", "fail") == 0
    db.set_doc("status", {"a": 1})
    db.set_doc("status", {"a": 2})
    assert db.doc("status", {}) == {"a": 2} and db.doc("meta", "d") == "d"
    db.add_history([{"name": "A", "url": "https://a", "group": "G", "time": "t1", "diff": ["+x", "-y"], "extra": 2}], 10)
    db.add_history([{"name": "A", "url": "https://a", "time": "t2", "diff": ["+z"]}], 10)
    assert [h["time"] for h in db.history(10)] == ["t1", "t2"] and [h["time"] for h in db.history(1)] == ["t2"]
    assert db.history(10)[0]["diff"] == ["+x", "-y"]


def test_open_store_picks_rest_and_accepts_url_in_db_var(monkeypatch, tmp_path):
    for name in ("SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert isinstance(open_store(tmp_path / "s", tmp_path / "u.yml"), FileStore)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    assert isinstance(open_store(tmp_path / "s", tmp_path / "u.yml"), FileStore)  # Key fehlt
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "k")
    assert isinstance(open_store(tmp_path / "s", tmp_path / "u.yml"), RestStore)


def test_migrate_into_rest_store(tmp_path):
    cfg = tmp_path / "urls.yml"
    cfg.write_text("urls:\n  - url: https://a\n    group: G\n")
    files = FileStore(tmp_path / "state", cfg)
    key = migrate.url_key("https://a")
    files.set_snapshot(key, "", "text")
    files.set_doc("status", {"https://a": {"status": "ok"}})
    db = make_store()
    assert migrate.migrate(files, db)["snapshots"] == 1
    assert db.snapshot(key) == "text" and db.doc("status", {}) == {"https://a": {"status": "ok"}}
    assert migrate.migrate(files, db)["urls"] == 0
