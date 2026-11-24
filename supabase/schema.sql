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

-- Counters and settings remain unreadable to the dashboard.
drop policy if exists "admins read snapshots" on watchlist_snapshots;
create policy "admins read snapshots" on watchlist_snapshots for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins read urls" on watchlist_urls;
create policy "admins read urls" on watchlist_urls for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins read history" on watchlist_history;
create policy "admins read history" on watchlist_history for select to authenticated
  using (exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

drop policy if exists "admins read state" on watchlist_state;
create policy "admins read state" on watchlist_state for select to authenticated
  using ((key in ('status', 'runs', 'health') or key like 'review:%') and exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));

-- Return only metadata for the URL list; the full snapshot is fetched on demand.
create or replace function watchlist_snapshot_hints()
returns table(url text, chars integer, js_hint boolean, has_history boolean, js_enabled boolean)
language sql stable security definer set search_path = public
as $$
  select s.url, char_length(s.content),
    s.content ~* '(enable|turn on|activate|requires?|need(s|ed)?)\s+(your\s+)?javascript|javascript\s+(is\s+)?(disabled|required|must be enabled)',
    exists (select 1 from watchlist_history h where h.url = s.url),
    coalesce(u.options->'js', (select value->'js' from watchlist_settings where key = 'defaults'), 'false'::jsonb) = 'true'::jsonb
  from watchlist_snapshots s
  join watchlist_urls u on u.url = s.url
  where exists (select 1 from watchlist_admins a where a.user_id = auth.uid());
$$;
revoke all on function watchlist_snapshot_hints() from public, anon;
grant execute on function watchlist_snapshot_hints() to authenticated;

-- The serialized check workflow adopts the reviewed content and enables JS together.
create or replace function watchlist_apply_js_review(p_url text, p_key text, p_time text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  r watchlist_state%rowtype;
  u watchlist_urls%rowtype;
  s watchlist_snapshots%rowtype;
  defaults jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized';
  end if;
  select * into r from watchlist_state where key = p_key and key like 'review:%' for update;
  if not found or r.value->>'url' is distinct from p_url or r.value->>'time' is distinct from p_time
    or r.updated_at < now() - interval '1 hour' or coalesce(r.value->>'rendered', '') = '' then
    raise exception 'The comparison is missing or expired. Compare again.';
  end if;
  select * into u from watchlist_urls where url = p_url and active for update;
  if not found or u.options is distinct from r.value->'options' or u.options @> '{"js": true}'::jsonb then
    raise exception 'URL options changed. Compare again.';
  end if;
  select coalesce((select value from watchlist_settings where key = 'defaults'), '{}'::jsonb) into defaults;
  if defaults is distinct from r.value->'defaults' then
    raise exception 'Default options changed. Compare again.';
  end if;
  select * into s from watchlist_snapshots where key = substring(p_key from 8) and url = p_url for update;
  if not found or s.content is distinct from r.value->>'baseline' then
    raise exception 'The saved snapshot changed. Compare again.';
  end if;
  update watchlist_snapshots set content = r.value->>'rendered', updated_at = now() where key = s.key;
  update watchlist_urls set options = options || '{"js": true}'::jsonb where id = u.id;
  delete from watchlist_state where key = p_key;
end
$$;
revoke all on function watchlist_apply_js_review(text, text, text) from public, anon, authenticated;
grant execute on function watchlist_apply_js_review(text, text, text) to service_role;

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

-- Group logos: public bucket for the uploaded images (the public URL is stored in watchlist_groups.icon).
insert into storage.buckets (id, name, public) values ('group-icons', 'group-icons', true) on conflict (id) do nothing;
drop policy if exists "admins upload group icons" on storage.objects;
create policy "admins upload group icons" on storage.objects for insert to authenticated
  with check (bucket_id = 'group-icons' and exists (select 1 from watchlist_admins a where a.user_id = auth.uid()));
