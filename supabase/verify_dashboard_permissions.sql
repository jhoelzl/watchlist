-- Verify dashboard RLS policies in the Supabase SQL Editor.
-- Uses temporary fixture rows and rolls the entire transaction back.
begin;

do $$
declare
  missing text;
begin
  if to_regclass('public.watchlist_admins') is not null
    and not exists (select 1 from watchlist_admins) then
    raise exception 'Add at least one account to watchlist_admins before running this check.';
  end if;

  select string_agg(t, ', ' order by t) into missing
  from unnest(array[
    'watchlist_settings', 'watchlist_urls', 'watchlist_snapshots',
    'watchlist_counters', 'watchlist_history', 'watchlist_state',
    'watchlist_admins', 'watchlist_groups'
  ]) as t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Missing watchlist tables: %. Run supabase/schema.sql first (it is safe to repeat).', missing;
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'watchlist_settings', 'watchlist_urls', 'watchlist_snapshots',
        'watchlist_counters', 'watchlist_history', 'watchlist_state',
        'watchlist_admins', 'watchlist_groups'
      ])
      and not c.relrowsecurity
  ) then
    raise exception 'RLS is disabled on one or more watchlist tables.';
  end if;
end
$$;

select set_config('watchlist.rls_check_marker', replace(gen_random_uuid()::text, '-', ''), true);
select set_config(
  'watchlist.rls_check_admin',
  (select user_id::text from watchlist_admins order by user_id limit 1),
  true
);

insert into watchlist_urls (url, name)
values ('https://rls-check.invalid/' || current_setting('watchlist.rls_check_marker'), 'RLS check fixture');
insert into watchlist_history (url, time, diff)
values (
  'https://rls-check.invalid/' || current_setting('watchlist.rls_check_marker'),
  'RLS check',
  'RLS check fixture'
);
insert into watchlist_state (key, value)
values ('status', jsonb_build_object('rls_check', current_setting('watchlist.rls_check_marker')))
on conflict (key) do nothing;
insert into watchlist_snapshots (key, url, content)
values (
  current_setting('watchlist.rls_check_marker'),
  'https://rls-check.invalid/',
  'RLS check fixture'
);
insert into watchlist_counters (key, kind, value)
values (current_setting('watchlist.rls_check_marker'), 'fail', 1);
insert into watchlist_settings (key, value)
values (current_setting('watchlist.rls_check_marker'), '"RLS check fixture"'::jsonb);
insert into watchlist_groups (name, position)
values (current_setting('watchlist.rls_check_marker'), 0);

-- Anonymous users must see no watchlist data and must not write dashboard data.
set local role anon;
do $$
declare
  marker text := current_setting('watchlist.rls_check_marker');
  affected bigint;
begin
  if exists (select 1 from watchlist_admins)
    or exists (select 1 from watchlist_urls where url = 'https://rls-check.invalid/' || marker)
    or exists (select 1 from watchlist_history where url = 'https://rls-check.invalid/' || marker)
    or exists (select 1 from watchlist_state where key = 'status')
    or exists (select 1 from watchlist_snapshots where key = marker)
    or exists (select 1 from watchlist_counters where key = marker)
    or exists (select 1 from watchlist_settings where key = marker)
    or exists (select 1 from watchlist_groups where name = marker) then
    raise exception 'Anonymous role can read dashboard data.';
  end if;

  begin
    insert into watchlist_urls (url) values ('https://rls-check.invalid/' || marker || '/anon');
    raise exception 'Anonymous role unexpectedly inserted a URL.';
  exception when insufficient_privilege then
    null;
  end;

  update watchlist_urls set name = 'unauthorized' where url = 'https://rls-check.invalid/' || marker;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Anonymous role unexpectedly updated a URL.'; end if;

  delete from watchlist_urls where url = 'https://rls-check.invalid/' || marker;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Anonymous role unexpectedly deleted a URL.'; end if;

  begin
    insert into watchlist_groups (name) values (marker || '-anon');
    raise exception 'Anonymous role unexpectedly inserted a group.';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
reset role;

-- A registered account absent from watchlist_admins must also have no access.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
declare
  marker text := current_setting('watchlist.rls_check_marker');
  affected bigint;
begin
  if exists (select 1 from watchlist_admins)
    or exists (select 1 from watchlist_urls where url = 'https://rls-check.invalid/' || marker)
    or exists (select 1 from watchlist_history where url = 'https://rls-check.invalid/' || marker)
    or exists (select 1 from watchlist_state where key = 'status')
    or exists (select 1 from watchlist_snapshots where key = marker)
    or exists (select 1 from watchlist_counters where key = marker)
    or exists (select 1 from watchlist_settings where key = marker)
    or exists (select 1 from watchlist_groups where name = marker) then
    raise exception 'Non-admin authenticated role can read dashboard data.';
  end if;

  begin
    insert into watchlist_urls (url) values ('https://rls-check.invalid/' || marker || '/non-admin');
    raise exception 'Non-admin authenticated role unexpectedly inserted a URL.';
  exception when insufficient_privilege then
    null;
  end;

  update watchlist_urls set name = 'unauthorized' where url = 'https://rls-check.invalid/' || marker;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-admin authenticated role unexpectedly updated a URL.'; end if;

  delete from watchlist_urls where url = 'https://rls-check.invalid/' || marker;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-admin authenticated role unexpectedly deleted a URL.'; end if;

  begin
    insert into watchlist_groups (name) values (marker || '-non-admin');
    raise exception 'Non-admin authenticated role unexpectedly inserted a group.';
  exception when insufficient_privilege then
    null;
  end;

  update watchlist_groups set name = marker || '-unauthorized' where name = marker;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-admin authenticated role unexpectedly updated a group.'; end if;

  delete from watchlist_groups where name = marker;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-admin authenticated role unexpectedly deleted a group.'; end if;
end
$$;
reset role;

-- An authorized account can use dashboard data but must not read private tables.
select set_config('request.jwt.claim.sub', current_setting('watchlist.rls_check_admin'), true);
set local role authenticated;
do $$
declare
  marker text := current_setting('watchlist.rls_check_marker');
  affected bigint;
begin
  if not exists (
    select 1 from watchlist_admins
    where user_id::text = current_setting('watchlist.rls_check_admin')
  ) then
    raise exception 'Authorized account cannot read its own admin row.';
  end if;
  if not exists (select 1 from watchlist_urls where url = 'https://rls-check.invalid/' || marker)
    or not exists (select 1 from watchlist_history where url = 'https://rls-check.invalid/' || marker)
    or not exists (select 1 from watchlist_state where key = 'status')
    or not exists (select 1 from watchlist_groups where name = marker) then
    raise exception 'Authorized account cannot read expected dashboard data.';
  end if;
  if exists (select 1 from watchlist_snapshots where key = marker)
    or exists (select 1 from watchlist_counters where key = marker)
    or exists (select 1 from watchlist_settings where key = marker) then
    raise exception 'Authorized account can read a private watchlist table.';
  end if;

  update watchlist_urls set name = 'updated by RLS check'
  where url = 'https://rls-check.invalid/' || marker;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Authorized account cannot update URLs.'; end if;

  insert into watchlist_urls (url, name)
  values ('https://rls-check.invalid/' || marker || '/admin', 'RLS check insert');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Authorized account cannot insert URLs.'; end if;
  delete from watchlist_urls where url = 'https://rls-check.invalid/' || marker || '/admin';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Authorized account cannot delete URLs.'; end if;

  update watchlist_groups set position = position + 1 where name = marker;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Authorized account cannot update groups.'; end if;
  insert into watchlist_groups (name) values (marker || '-admin');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Authorized account cannot insert groups.'; end if;
  delete from watchlist_groups where name = marker || '-admin';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Authorized account cannot delete groups.'; end if;
end
$$;
reset role;

rollback;
select 'Dashboard RLS checks passed. All fixture data was rolled back.' as result;
