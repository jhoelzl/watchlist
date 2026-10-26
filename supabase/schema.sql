-- Watchlist schema. Run in the Supabase SQL Editor (safe to run repeatedly).
-- RLS is enabled. The Python script uses the secret/service_role key or a Postgres connection and bypasses RLS.
-- The public API exposes only the data allowed below for authorized accounts (watchlist_admins).

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
  key text primary key, -- sha1(url)[:16], same as the previous filename
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
  time text not null, -- Timestamp as used in emails, e.g. "2026-10-23 06:00 UTC"
  diff text not null, -- Diff lines, separated by newline
  extra integer not null default 0, -- Number of truncated lines
  created_at timestamptz not null default now()
);
alter table watchlist_history add column if not exists summary text; -- optional one-line AI summary
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

-- Dashboard (web/): read access is limited to authorized accounts, not every registered account.
-- Registration is open in the Supabase project (same auth as other apps), so "authenticated" alone is insufficient.
create table if not exists watchlist_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table watchlist_admins enable row level security;

drop policy if exists "own admin row" on watchlist_admins;
create policy "own admin row" on watchlist_admins for select to authenticated using (user_id = auth.uid());

-- Snapshots (page text), counters, and settings intentionally remain unreadable.
drop policy if exists "admins read urls" on watchlist_urls;
create policy "admins read urls" on watchlist_urls for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins read history" on watchlist_history;
create policy "admins read history" on watchlist_history for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins read state" on watchlist_state;
create policy "admins read state" on watchlist_state for select to authenticated
  using (key = 'status' and exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

-- Authorize your account (replace the email; the account must already be registered):
-- insert into watchlist_admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;

-- Add and pause URLs in the dashboard (authorized accounts only).
drop policy if exists "admins add urls" on watchlist_urls;
create policy "admins add urls" on watchlist_urls for insert to authenticated
  with check (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins delete urls" on watchlist_urls;
create policy "admins delete urls" on watchlist_urls for delete to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

-- Edit groups in the dashboard (change the URLs’ grp).
drop policy if exists "admins update urls" on watchlist_urls;
create policy "admins update urls" on watchlist_urls for update to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

-- Groups: order, color, and icon (including empty groups). The dashboard also works without this table.
create table if not exists watchlist_groups (
  name text primary key,
  position int not null default 0,
  color text,
  icon text
);
alter table watchlist_groups enable row level security;
drop policy if exists "admins manage groups" on watchlist_groups;
create policy "admins manage groups" on watchlist_groups for all to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

-- Screenshots of changed pages (option screenshot: true): the previous and the latest image as base64 JPEG.
create table if not exists watchlist_screenshots (
  key text primary key, -- sha1(url)[:16], same as watchlist_snapshots
  url text not null,
  img_before text,
  img_after text,
  updated_at timestamptz not null default now()
);
alter table watchlist_screenshots enable row level security;
drop policy if exists "admins read screenshots" on watchlist_screenshots;
create policy "admins read screenshots" on watchlist_screenshots for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));
