"""Speicher für URLs, Snapshots, Zähler, Verlauf und Status: Dateien (Standard) oder Supabase/Postgres.

Mit gesetzter Umgebungsvariable SUPABASE_DB_URL liegt alles in Tabellen mit dem Präfix watchlist_
(Schema: supabase/schema.sql), sonst wie bisher in urls.yml und im Ordner state/.
"""

import json
import os
from pathlib import Path
from typing import Any

import yaml

DB_ENV = "SUPABASE_DB_URL"
COUNTER_KINDS = ("fail", "short")


class FileStore:
    """Bisheriges Verhalten: urls.yml plus Dateien in state/."""

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

    def doc(self, name: str, default: Any) -> Any:
        path = self.state / f"{name}.json"
        return json.loads(path.read_text()) if path.exists() else default

    def set_doc(self, name: str, data: Any) -> None:
        (self.state / f"{name}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True) + "\n")

    def history(self, limit: int) -> list[dict[str, Any]]:
        history: list[dict[str, Any]] = self.doc("history", [])
        return history[-limit:]

    def add_history(self, entries: list[dict[str, Any]], limit: int) -> None:
        self.set_doc("history", (self.doc("history", []) + entries)[-limit:])

    def close(self) -> None:
        pass


class PgStore:
    """Supabase/Postgres. Verbindung per Postgres-URL (bei GitHub Actions den Session-Pooler nutzen, IPv4)."""

    def __init__(self, dsn: str) -> None:
        import psycopg

        # prepare_threshold=None: kompatibel mit dem Transaction-Pooler von Supabase
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

    def history(self, limit: int) -> list[dict[str, Any]]:
        rows = self._all(
            "select name, url, grp, time, diff, extra from "
            "(select * from watchlist_history order by id desc limit %s) latest order by id",
            (limit,),
        )
        return [
            {"name": n, "url": u, "group": g, "time": t, "diff": d.split("\n") if d else [], "extra": x}
            for n, u, g, t, d, x in rows
        ]

    def add_history(self, entries: list[dict[str, Any]], limit: int) -> None:
        for e in entries:
            self._run(
                "insert into watchlist_history (name, url, grp, time, diff, extra) values (%s, %s, %s, %s, %s, %s)",
                (e.get("name"), e["url"], e.get("group"), e["time"], "\n".join(e.get("diff") or []), e.get("extra") or 0),
            )

    def close(self) -> None:
        self.conn.close()


def open_store(state: Path, config: Path) -> FileStore | PgStore:
    dsn = os.environ.get(DB_ENV)
    return PgStore(dsn) if dsn else FileStore(state, config)
