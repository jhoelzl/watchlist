"""Storage for URLs, snapshots, counters, history, and status: files (default) or Supabase/Postgres.

When SUPABASE_DB_URL is set, everything is stored in tables prefixed with watchlist_.
(Schema: supabase/schema.sql); otherwise, as before, in urls.yml and the state/ directory.
"""

import base64
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from models import HistoryEntry

DB_ENV = "SUPABASE_DB_URL"
URL_ENV = "SUPABASE_URL"
KEY_ENV = "SUPABASE_SERVICE_KEY"
COUNTER_KINDS = ("fail", "short")


class FileStore:
    """Existing behavior: urls.yml plus files in state/."""

    def __init__(self, state: Path, config: Path) -> None:
        self.state = state
        self.config = config
        state.mkdir(parents=True, exist_ok=True)

    def raw_config(self) -> Any:
        return yaml.safe_load(self.config.read_text()) or []

    def snapshot_keys(self) -> set[str]:
        return {p.stem for p in self.state.glob("*.txt")}

    def snapshot(self, key: str) -> str | None:
        path = self.state / f"{key}.txt"
        return path.read_text() if path.exists() else None

    def set_snapshot(self, key: str, url: str, text: str) -> None:
        (self.state / f"{key}.txt").write_text(text)

    def counter(self, key: str, kind: str) -> int:
        path = self.state / f"{key}.{kind}"
        return int(path.read_text()) if path.exists() else 0

    def set_counter(self, key: str, kind: str, value: int) -> None:
        (self.state / f"{key}.{kind}").write_text(str(value))

    def clear_counter(self, key: str, kind: str) -> None:
        (self.state / f"{key}.{kind}").unlink(missing_ok=True)

    def rotate_screenshot(self, key: str, url: str, image: bytes) -> None:
        """The previous "after" image becomes "before"; the new image becomes "after"."""
        after = self.state / f"{key}.after.jpg"
        if after.exists():
            after.replace(self.state / f"{key}.before.jpg")
        after.write_bytes(image)

    def doc(self, name: str, default: Any) -> Any:
        path = self.state / f"{name}.json"
        return json.loads(path.read_text()) if path.exists() else default

    def set_doc(self, name: str, data: Any) -> None:
        (self.state / f"{name}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True) + "\n")

    def history(self, limit: int) -> list[HistoryEntry]:
        history: list[HistoryEntry] = self.doc("history", [])
        return history[-limit:]

    def add_history(self, entries: list[HistoryEntry], limit: int) -> None:
        self.set_doc("history", (self.doc("history", []) + entries)[-limit:])

    def close(self) -> None:
        pass


class PgStore:
    """Supabase/Postgres. Connect with a Postgres URL (use the IPv4 session pooler in GitHub Actions)."""

    def __init__(self, dsn: str) -> None:
        import psycopg

        # prepare_threshold=None: compatible with the Supabase transaction pooler.
        self.conn = psycopg.connect(dsn, autocommit=True, prepare_threshold=None)

    def _all(self, sql: str, args: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()

    def _run(self, sql: str, args: tuple[Any, ...] = ()) -> None:
        with self.conn.cursor() as cur:
            cur.execute(sql, args)

    def raw_config(self) -> Any:
        row = self._all("select value from watchlist_settings where key = 'defaults'")
        defaults = row[0][0] if row else {}
        rows = self._all("select url, name, grp, options from watchlist_urls where active order by position, id")
        urls = []
        for url, name, grp, options in rows:
            entry = {"url": url, **(options or {})}
            if name:
                entry["name"] = name
            if grp:
                entry["group"] = grp
            urls.append(entry)
        return {"defaults": defaults, "urls": urls}

    def add_url(self, entry: dict[str, Any]) -> None:
        options = {k: v for k, v in entry.items() if k not in ("url", "name", "group")}
        self._run(
            "insert into watchlist_urls (url, name, grp, options, position) values "
            "(%s, %s, %s, %s::jsonb, coalesce((select max(position) from watchlist_urls), 0) + 1)",
            (entry["url"], entry.get("name"), entry.get("group"), json.dumps(options)),
        )

    def set_defaults(self, defaults: dict[str, Any]) -> None:
        self._run(
            "insert into watchlist_settings (key, value) values ('defaults', %s::jsonb) "
            "on conflict (key) do update set value = excluded.value",
            (json.dumps(defaults),),
        )

    def snapshot_keys(self) -> set[str]:
        return {r[0] for r in self._all("select key from watchlist_snapshots")}

    def snapshot(self, key: str) -> str | None:
        rows = self._all("select content from watchlist_snapshots where key = %s", (key,))
        return str(rows[0][0]) if rows else None

    def set_snapshot(self, key: str, url: str, text: str) -> None:
        self._run(
            "insert into watchlist_snapshots (key, url, content) values (%s, %s, %s) "
            "on conflict (key) do update set url = excluded.url, content = excluded.content, updated_at = now()",
            (key, url, text),
        )

    def rotate_screenshot(self, key: str, url: str, image: bytes) -> None:
        self._run(
            "insert into watchlist_screenshots (key, url, img_after) values (%s, %s, %s) "
            "on conflict (key) do update set img_before = watchlist_screenshots.img_after, "
            "img_after = excluded.img_after, url = excluded.url, updated_at = now()",
            (key, url, base64.b64encode(image).decode()),
        )

    def counter(self, key: str, kind: str) -> int:
        rows = self._all("select value from watchlist_counters where key = %s and kind = %s", (key, kind))
        return int(rows[0][0]) if rows else 0

    def set_counter(self, key: str, kind: str, value: int) -> None:
        self._run(
            "insert into watchlist_counters (key, kind, value) values (%s, %s, %s) "
            "on conflict (key, kind) do update set value = excluded.value",
            (key, kind, value),
        )

    def clear_counter(self, key: str, kind: str) -> None:
        self._run("delete from watchlist_counters where key = %s and kind = %s", (key, kind))

    def doc(self, name: str, default: Any) -> Any:
        rows = self._all("select value from watchlist_state where key = %s", (name,))
        return rows[0][0] if rows else default

    def set_doc(self, name: str, data: Any) -> None:
        self._run(
            "insert into watchlist_state (key, value) values (%s, %s::jsonb) "
            "on conflict (key) do update set value = excluded.value, updated_at = now()",
            (name, json.dumps(data, ensure_ascii=False)),
        )

    def history(self, limit: int) -> list[HistoryEntry]:
        rows = self._all(
            "select name, url, grp, time, diff, extra from "
            "(select * from watchlist_history order by id desc limit %s) latest order by id",
            (limit,),
        )
        return [
            {"name": n, "url": u, "group": g, "time": t, "diff": d.split("\n") if d else [], "extra": x}
            for n, u, g, t, d, x in rows
        ]

    def add_history(self, entries: list[HistoryEntry], limit: int) -> None:
        for e in entries:
            cols = ["name", "url", "grp", "time", "diff", "extra"]
            vals = [e.get("name"), e["url"], e.get("group"), e["time"], "\n".join(e.get("diff") or []), e.get("extra") or 0]
            if e.get("summary"):  # column added later; only written when present
                cols.append("summary")
                vals.append(e["summary"])
            self._run(f"insert into watchlist_history ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})", tuple(vals))

    def close(self) -> None:
        self.conn.close()


class RestStore(PgStore):
    """Supabase via the REST API (project URL + service_role key), without a database password.

    The service_role key bypasses RLS and is secret: store it only as a secret or in .env, never in the frontend.
    """

    def __init__(self, url: str, key: str) -> None:
        import requests

        self.base = url.rstrip("/") + "/rest/v1/"
        self.http = requests.Session()
        self.http.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def _call(
        self, method: str, table: str, params: dict[str, str] | None = None, body: Any = None, upsert: str | None = None
    ) -> Any:
        headers = {"Content-Type": "application/json", "Prefer": "return=minimal"}
        if upsert:
            headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
            params = {**(params or {}), "on_conflict": upsert}
        resp = self.http.request(
            method,
            self.base + table,
            params=params,
            headers=headers,
            data=json.dumps(body) if body is not None else None,
            timeout=30,
        )
        if not resp.ok:
            raise RuntimeError(f"Supabase {method} {table}: HTTP {resp.status_code} {resp.text[:200]}")
        return resp.json() if method == "GET" else None

    def _select(self, table: str, **params: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = self._call("GET", table, params)
        return rows

    def raw_config(self) -> Any:
        row = self._select("watchlist_settings", select="value", key="eq.defaults")
        rows = self._select("watchlist_urls", select="url,name,grp,options", active="eq.true", order="position.asc,id.asc")
        urls = []
        for r in rows:
            entry = {"url": r["url"], **(r["options"] or {})}
            if r["name"]:
                entry["name"] = r["name"]
            if r["grp"]:
                entry["group"] = r["grp"]
            urls.append(entry)
        return {"defaults": row[0]["value"] if row else {}, "urls": urls}

    def add_url(self, entry: dict[str, Any]) -> None:
        last = self._select("watchlist_urls", select="position", order="position.desc", limit="1")
        options = {k: v for k, v in entry.items() if k not in ("url", "name", "group")}
        row = {
            "url": entry["url"],
            "name": entry.get("name"),
            "grp": entry.get("group"),
            "options": options,
            "position": (last[0]["position"] if last else 0) + 1,
        }
        self._call("POST", "watchlist_urls", body=row)

    def set_defaults(self, defaults: dict[str, Any]) -> None:
        self._call("POST", "watchlist_settings", body={"key": "defaults", "value": defaults}, upsert="key")

    def snapshot_keys(self) -> set[str]:
        keys: set[str] = set()
        while True:  # PostgREST returns at most 1000 rows by default.
            page = self._select("watchlist_snapshots", select="key", order="key", limit="1000", offset=str(len(keys)))
            keys.update(r["key"] for r in page)
            if len(page) < 1000:
                return keys

    def snapshot(self, key: str) -> str | None:
        rows = self._select("watchlist_snapshots", select="content", key=f"eq.{key}")
        return str(rows[0]["content"]) if rows else None

    def set_snapshot(self, key: str, url: str, text: str) -> None:
        row = {"key": key, "url": url, "content": text, "updated_at": _now()}
        self._call("POST", "watchlist_snapshots", body=row, upsert="key")

    def rotate_screenshot(self, key: str, url: str, image: bytes) -> None:
        old = self._select("watchlist_screenshots", select="img_after", key=f"eq.{key}")
        row = {
            "key": key,
            "url": url,
            "img_before": old[0]["img_after"] if old else None,
            "img_after": base64.b64encode(image).decode(),
            "updated_at": _now(),
        }
        self._call("POST", "watchlist_screenshots", body=row, upsert="key")

    def counter(self, key: str, kind: str) -> int:
        rows = self._select("watchlist_counters", select="value", key=f"eq.{key}", kind=f"eq.{kind}")
        return int(rows[0]["value"]) if rows else 0

    def set_counter(self, key: str, kind: str, value: int) -> None:
        self._call("POST", "watchlist_counters", body={"key": key, "kind": kind, "value": value}, upsert="key,kind")

    def clear_counter(self, key: str, kind: str) -> None:
        self._call("DELETE", "watchlist_counters", {"key": f"eq.{key}", "kind": f"eq.{kind}"})

    def doc(self, name: str, default: Any) -> Any:
        rows = self._select("watchlist_state", select="value", key=f"eq.{name}")
        return rows[0]["value"] if rows else default

    def set_doc(self, name: str, data: Any) -> None:
        self._call("POST", "watchlist_state", body={"key": name, "value": data, "updated_at": _now()}, upsert="key")

    def history(self, limit: int) -> list[HistoryEntry]:
        rows = self._select("watchlist_history", select="name,url,grp,time,diff,extra", order="id.desc", limit=str(limit))
        return [
            {
                "name": r["name"],
                "url": r["url"],
                "group": r["grp"],
                "time": r["time"],
                "diff": r["diff"].split("\n") if r["diff"] else [],
                "extra": r["extra"],
            }
            for r in reversed(rows)
        ]

    def add_history(self, entries: list[HistoryEntry], limit: int) -> None:
        rows = [
            {
                "name": e.get("name"),
                "url": e["url"],
                "grp": e.get("group"),
                "time": e["time"],
                "diff": "\n".join(e.get("diff") or []),
                "extra": e.get("extra") or 0,
                **({"summary": e["summary"]} if e.get("summary") else {}),
            }
            for e in entries
        ]
        if rows:
            self._call("POST", "watchlist_history", body=rows)

    def close(self) -> None:
        self.http.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def open_store(state: Path, config: Path) -> FileStore | PgStore:
    """Database (Postgres URL or REST with service_role key) or files. See README."""
    dsn = os.environ.get(DB_ENV, "")
    key = os.environ.get(KEY_ENV)
    if dsn.startswith(("postgres://", "postgresql://")):
        return PgStore(dsn)
    url = os.environ.get(URL_ENV) or (dsn if dsn.startswith("http") else "")
    if url and key:
        return RestStore(url, key)
    return FileStore(state, config)
