-- Custom cards. Two parts, safe to re-run:
--
-- 1. Online rooms may carry the host's custom cards in rooms.settings ("custom": [card…], up to
--    60). clean_settings passes the list through; the referee checks every card (shape, limits,
--    and that its id matches its content) when the game starts. The settings size limit grows
--    to make room.
--
-- 2. Each signed-in player keeps a library of their own custom cards and groups in
--    regolith.card_library, read and written only through get_card_library/put_card_library.
--    Apply before deploying a site or referee that sends custom cards.

alter table regolith.rooms drop constraint if exists settings_shape;
alter table regolith.rooms add constraint settings_shape check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 200000);

create or replace function regolith.clean_settings(p jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'board', case when jsonb_typeof(p -> 'board') = 'string' then p -> 'board' end,
    'milestones', case when jsonb_typeof(p -> 'milestones') = 'array' and jsonb_array_length(p -> 'milestones') between 1 and 8 then p -> 'milestones' end,
    'awards', case when jsonb_typeof(p -> 'awards') = 'array' and jsonb_array_length(p -> 'awards') between 1 and 8 then p -> 'awards' end,
    'expansions', case when jsonb_typeof(p -> 'expansions') = 'object' then (
      select coalesce(jsonb_object_agg(k, true), '{}'::jsonb)
      from jsonb_each(p -> 'expansions') as e(k, v)
      where k in ('prelude', 'venus', 'colonies', 'turmoil') and v = 'true'::jsonb
    ) end,
    'custom', case when jsonb_typeof(p -> 'custom') = 'array' and jsonb_array_length(p -> 'custom') between 1 and 60
      and pg_column_size(p -> 'custom') < 150000 then p -> 'custom' end
  ))
  where p is not null and jsonb_typeof(p) = 'object';
$$;

revoke execute on function regolith.clean_settings(jsonb) from public, anon, authenticated;

create table if not exists regolith.card_library (
  user_id uuid primary key references auth.users (id) on delete cascade,
  library jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint library_shape check (jsonb_typeof(library) = 'object' and pg_column_size(library) < 400000)
);
alter table regolith.card_library enable row level security;
revoke all on regolith.card_library from public, anon, authenticated;

-- The caller's library ({} when they have none yet).
create or replace function regolith.get_card_library()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select l.library from regolith.card_library l where l.user_id = auth.uid()), '{}'::jsonb);
$$;

-- Replaces the caller's library.
create or replace function regolith.put_card_library(p_library jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in to keep custom cards in the cloud';
  end if;
  if p_library is null or jsonb_typeof(p_library) <> 'object' then
    raise exception 'Bad card library';
  end if;
  insert into regolith.card_library as l (user_id, library) values (uid, p_library)
  on conflict (user_id) do update set library = excluded.library, updated_at = now();
end;
$$;

revoke execute on function regolith.get_card_library() from public, anon;
revoke execute on function regolith.put_card_library(jsonb) from public, anon;
grant execute on function regolith.get_card_library() to authenticated;
grant execute on function regolith.put_card_library(jsonb) to authenticated;
