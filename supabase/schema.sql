-- Schema für die Watchlist. Im Supabase SQL-Editor ausführen (mehrfach ausführbar).
-- RLS ist aktiv und es gibt keine Policies: über die öffentliche API (anon/authenticated) ist nichts lesbar.
-- Das Skript greift direkt per Postgres-Verbindung zu (SUPABASE_DB_URL) und ist davon nicht betroffen.

create table if not exists watchlist_settings (
  key text primary key,
  value jsonb not null
);

create table if not exists watchlist_urls (
  id bigint generated always as identity primary key,
  url text not null unique,
  name text,
  grp text,
  active boolean not null default true,
  position integer not null default 0,
  options jsonb not null default '{}'::jsonb, -- selector, js, ignore, only_added, min_ratio, ignore_robots, ...
  created_at timestamptz not null default now()
);

create table if not exists watchlist_snapshots (
  key text primary key, -- sha1(url)[:16], wie bisher der Dateiname
  url text not null,
  content text not null,
  updated_at timestamptz not null default now()
);

create table if not exists watchlist_counters (
  key text not null,
  kind text not null check (kind in ('fail', 'short')),
  value integer not null,
  primary key (key, kind)
);

create table if not exists watchlist_history (
  id bigint generated always as identity primary key,
  name text,
  url text not null,
  grp text,
  time text not null, -- Zeitstempel wie in den Mails, z. B. "2026-10-23 06:00 UTC"
  diff text not null, -- Diff-Zeilen, getrennt durch Zeilenumbruch
  extra integer not null default 0, -- Anzahl abgeschnittener Zeilen
  created_at timestamptz not null default now()
);
create index if not exists watchlist_history_url_idx on watchlist_history (url, id desc);

create table if not exists watchlist_state (
  key text primary key, -- status, meta, http
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table watchlist_settings enable row level security;
alter table watchlist_urls enable row level security;
alter table watchlist_snapshots enable row level security;
alter table watchlist_counters enable row level security;
alter table watchlist_history enable row level security;
alter table watchlist_state enable row level security;
