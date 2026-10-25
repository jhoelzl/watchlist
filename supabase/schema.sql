-- Schema für die Watchlist. Im Supabase SQL-Editor ausführen (mehrfach ausführbar).
-- RLS ist aktiv. Das Python-Skript nutzt den Secret-/service_role-Key bzw. eine Postgres-Verbindung und umgeht RLS.
-- Über die öffentliche API ist nur lesbar, was unten für freigeschaltete Konten (watchlist_admins) erlaubt wird.

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

-- Dashboard (web/): Lesezugriff nur für freigeschaltete Konten, nicht für jedes registrierte Konto.
-- Die Registrierung im Supabase-Projekt ist offen (gleiche Auth wie andere Apps), deshalb reicht "authenticated" nicht.
create table if not exists watchlist_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table watchlist_admins enable row level security;

drop policy if exists "own admin row" on watchlist_admins;
create policy "own admin row" on watchlist_admins for select to authenticated using (user_id = auth.uid());

-- Snapshots (Seitentexte), Zähler und Einstellungen bleiben bewusst unlesbar.
drop policy if exists "admins read urls" on watchlist_urls;
create policy "admins read urls" on watchlist_urls for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins read history" on watchlist_history;
create policy "admins read history" on watchlist_history for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins read state" on watchlist_state;
create policy "admins read state" on watchlist_state for select to authenticated
  using (key = 'status' and exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

-- Eigenes Konto freischalten (E-Mail anpassen, Konto muss vorher registriert sein):
-- insert into watchlist_admins (user_id) select id from auth.users where email = 'du@example.com' on conflict do nothing;

-- URLs im Dashboard hinzufügen und pausieren (nur freigeschaltete Konten).
drop policy if exists "admins add urls" on watchlist_urls;
create policy "admins add urls" on watchlist_urls for insert to authenticated
  with check (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins delete urls" on watchlist_urls;
create policy "admins delete urls" on watchlist_urls for delete to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

-- Gruppen im Dashboard bearbeiten (grp der URLs ändern).
drop policy if exists "admins update urls" on watchlist_urls;
create policy "admins update urls" on watchlist_urls for update to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));
