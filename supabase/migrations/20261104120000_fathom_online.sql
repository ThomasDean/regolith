-- Fathom online rooms, in Fathom's own schema (one schema per game). The same shape as
-- Regolith's: a slim rooms row members can read (with realtime), the full game in room_states
-- (server only), lobby functions for signed-in players, and srv_load / srv_save for the
-- fathom-play Edge Function. Seat validation is shared with Regolith (regolith.clean_seats,
-- regolith.seat_members), and game codes are unique across both games.
--
-- After applying: add `fathom` to Settings → Data API → Exposed schemas. Safe to re-run;
-- needs the Regolith migrations first.

create schema if not exists fathom;
revoke all on schema fathom from public, anon, authenticated;
grant usage on schema fathom to authenticated, service_role;

create table if not exists fathom.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'over')),
  -- [{ "kind": "human" | "open" | "easy" | "normal" | "hard", "name": text, "color": text, "user": uuid | null, "forfeited"?: bool }]
  seats jsonb not null,
  members uuid[] not null default '{}',
  -- { "variable": bool }
  settings jsonb not null default '{}'::jsonb,
  version int not null default 0,
  phase text,
  tide int,
  decider int,
  waiting int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seats_size check (jsonb_array_length(seats) between 2 and 5),
  constraint settings_shape check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 2000)
);
create index if not exists rooms_members on fathom.rooms using gin (members);
alter table fathom.rooms enable row level security;
revoke all on fathom.rooms from public, anon, authenticated;
grant select on fathom.rooms to authenticated;
drop policy if exists rooms_members_read on fathom.rooms;
create policy rooms_members_read on fathom.rooms for select to authenticated using ((select auth.uid()) = any (members));

create table if not exists fathom.room_states (
  room_id uuid primary key references fathom.rooms (id) on delete cascade,
  state jsonb not null,
  pending jsonb not null default '{}',
  actions jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  constraint room_state_size check (pg_column_size(state) < 1000000)
);
alter table fathom.room_states enable row level security;
revoke all on fathom.room_states from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'fathom' and tablename = 'rooms') then
    alter publication supabase_realtime add table fathom.rooms;
  end if;
end $$;

-- ---------------------------------------------------------------- lobby (signed-in players)

create or replace function fathom.new_room_code()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from fathom.rooms r where r.code = c) and not exists (select 1 from regolith.rooms r where r.code = c);
  end loop;
  return c;
end;
$$;

create or replace function fathom.clean_settings(p jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'variable', case when jsonb_typeof(p -> 'variable') = 'boolean' then p -> 'variable' end
  ))
  where p is not null and jsonb_typeof(p) = 'object';
$$;

create or replace function fathom.create_room(p_seats jsonb, p_settings jsonb default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_seats jsonb;
  r fathom.rooms;
begin
  if uid is null then raise exception 'Sign in to play online'; end if;
  if (select count(*) from fathom.rooms x where x.host = uid and x.status <> 'over') >= 20 then
    raise exception 'You already host 20 open games; finish or delete some first';
  end if;
  v_seats := regolith.clean_seats(p_seats, uid, null);
  insert into fathom.rooms (code, host, seats, members, settings)
  values (fathom.new_room_code(), uid, v_seats, regolith.seat_members(v_seats), coalesce(fathom.clean_settings(p_settings), '{}'))
  returning * into r;
  return jsonb_build_object('id', r.id, 'code', r.code);
end;
$$;

create or replace function fathom.update_room(p_room uuid, p_seats jsonb, p_settings jsonb default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r fathom.rooms;
  v_seats jsonb;
begin
  select * into r from fathom.rooms x where x.id = p_room for update;
  if r.id is null or r.host is distinct from uid then raise exception 'Only the host can change this game'; end if;
  if r.status <> 'lobby' then raise exception 'The game has already started'; end if;
  v_seats := regolith.clean_seats(p_seats, uid, r.seats);
  update fathom.rooms x
     set seats = v_seats, members = regolith.seat_members(v_seats), settings = coalesce(fathom.clean_settings(p_settings), r.settings),
         version = x.version + 1, updated_at = now()
   where x.id = p_room;
end;
$$;

create or replace function fathom.join_room(p_code text, p_name text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r fathom.rooms;
  idx int;
  nm text := left(btrim(coalesce(p_name, '')), 16);
  v_seats jsonb;
begin
  if uid is null then raise exception 'Sign in to play online'; end if;
  select * into r from fathom.rooms x where x.code = upper(btrim(p_code)) for update;
  if r.id is null then raise exception 'No game with that code'; end if;
  if uid = any (r.members) then return r.id; end if;
  if r.status <> 'lobby' then raise exception 'That game has already started'; end if;
  select (o.ord - 1)::int into idx from jsonb_array_elements(r.seats) with ordinality o(v, ord) where o.v ->> 'kind' = 'open' order by o.ord limit 1;
  if idx is null then raise exception 'That game is full'; end if;
  if nm = '' then nm := 'Player ' || (idx + 1); end if;
  while exists (select 1 from jsonb_array_elements(r.seats) o where o ->> 'name' = nm) loop
    nm := left(nm, 14) || ' ' || (idx + 1);
  end loop;
  v_seats := jsonb_set(r.seats, array[idx::text], (r.seats -> idx) || jsonb_build_object('kind', 'human', 'user', uid, 'name', nm));
  update fathom.rooms x
     set seats = v_seats, members = regolith.seat_members(v_seats), version = x.version + 1, updated_at = now()
   where x.id = r.id;
  return r.id;
end;
$$;

create or replace function fathom.leave_room(p_room uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r fathom.rooms;
  v_seats jsonb;
begin
  select * into r from fathom.rooms x where x.id = p_room for update;
  if r.id is null or not (uid = any (r.members)) then return; end if;
  if r.host = uid and r.status <> 'playing' then
    delete from fathom.rooms x where x.id = p_room;
    return;
  end if;
  if r.status = 'lobby' then
    select jsonb_agg(case when (o ->> 'user')::uuid = uid then o || jsonb_build_object('kind', 'open', 'user', null) else o end order by ord)
      into v_seats from jsonb_array_elements(r.seats) with ordinality t(o, ord);
    update fathom.rooms x set seats = v_seats, members = regolith.seat_members(v_seats), version = x.version + 1, updated_at = now() where x.id = p_room;
  else
    update fathom.rooms x set members = array_remove(x.members, uid), updated_at = now() where x.id = p_room and x.host <> uid;
  end if;
end;
$$;

revoke execute on function fathom.new_room_code() from public, anon, authenticated;
revoke execute on function fathom.clean_settings(jsonb) from public, anon, authenticated;
revoke execute on function fathom.create_room(jsonb, jsonb) from public, anon;
revoke execute on function fathom.update_room(uuid, jsonb, jsonb) from public, anon;
revoke execute on function fathom.join_room(text, text) from public, anon;
revoke execute on function fathom.leave_room(uuid) from public, anon;
grant execute on function fathom.create_room(jsonb, jsonb) to authenticated;
grant execute on function fathom.update_room(uuid, jsonb, jsonb) to authenticated;
grant execute on function fathom.join_room(text, text) to authenticated;
grant execute on function fathom.leave_room(uuid) to authenticated;

-- ---------------------------------------------------------------- server only (service role)

create or replace function fathom.srv_load(p_room uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('room', to_jsonb(r), 'state', st.state, 'pending', coalesce(st.pending, '{}'))
  from fathom.rooms r left join fathom.room_states st on st.room_id = r.id
  where r.id = p_room;
$$;

create or replace function fathom.srv_save(
  p_room uuid, p_version int, p_state jsonb, p_actions jsonb,
  p_status text, p_phase text, p_tide int, p_decider int, p_waiting jsonb, p_seats jsonb
)
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v int;
begin
  update fathom.rooms x
     set version = x.version + 1, status = coalesce(p_status, x.status), phase = p_phase, tide = p_tide,
         decider = p_decider, waiting = coalesce(array(select jsonb_array_elements_text(p_waiting)::int), '{}'), seats = coalesce(p_seats, x.seats),
         members = case when p_seats is null then x.members
                        else (select coalesce(array_agg(distinct m), '{}') from unnest(x.members || regolith.seat_members(p_seats)) m) end,
         updated_at = now()
   where x.id = p_room and x.version = p_version
  returning x.version into v;
  if v is null then return null; end if;
  insert into fathom.room_states as st (room_id, state, actions)
  values (p_room, p_state, coalesce(p_actions, '[]'))
  on conflict (room_id) do update
    set state = excluded.state, actions = st.actions || excluded.actions, updated_at = now();
  return v;
end;
$$;

revoke execute on function fathom.srv_load(uuid) from public, anon, authenticated;
revoke execute on function fathom.srv_save(uuid, int, jsonb, jsonb, text, text, int, int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function fathom.srv_load(uuid) to service_role;
grant execute on function fathom.srv_save(uuid, int, jsonb, jsonb, text, text, int, int, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------- the app badge counts both games

create or replace function regolith.turns_waiting(p_user uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select (
    select count(*)::int from regolith.rooms r
     where r.status = 'playing' and p_user = any (r.members)
       and exists (select 1 from unnest(r.waiting) w where (r.seats -> w ->> 'user')::uuid = p_user and not coalesce((r.seats -> w ->> 'forfeited')::boolean, false))
  ) + (
    select count(*)::int from fathom.rooms r
     where r.status = 'playing' and p_user = any (r.members)
       and exists (select 1 from unnest(r.waiting) w where (r.seats -> w ->> 'user')::uuid = p_user and not coalesce((r.seats -> w ->> 'forfeited')::boolean, false))
  );
$$;
revoke execute on function regolith.turns_waiting(uuid) from public, anon, authenticated;
grant execute on function regolith.turns_waiting(uuid) to service_role;
