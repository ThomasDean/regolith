-- Regolith online rooms. A room is a lobby (seats, who joined) and then a game. The full game
-- state, with every hand and the deck, lives in room_states, which only the server (the
-- regolith-play Edge Function, using the service role) can read or write. Players read the
-- slim rooms row (realtime tells them when it changes) and ask the Edge Function for their
-- own view of the game. Safe to re-run.

create table if not exists regolith.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'over')),
  -- [{ "kind": "human" | "open" | "easy" | "normal" | "hard", "name": text, "color": text, "user": uuid | null }]
  seats jsonb not null,
  members uuid[] not null default '{}',
  corporate_era boolean not null default true,
  version int not null default 0,
  phase text,
  generation int,
  decider int,
  -- seats the game is waiting on (several during corporation and research choices)
  waiting int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seats_size check (jsonb_array_length(seats) between 2 and 5)
);
create index if not exists rooms_members on regolith.rooms using gin (members);
alter table regolith.rooms enable row level security;
revoke all on regolith.rooms from public, anon, authenticated;
grant select on regolith.rooms to authenticated;
drop policy if exists rooms_members_read on regolith.rooms;
create policy rooms_members_read on regolith.rooms for select to authenticated using ((select auth.uid()) = any (members));

create table if not exists regolith.room_states (
  room_id uuid primary key references regolith.rooms (id) on delete cascade,
  state jsonb not null,
  -- corporation / research picks submitted before it was that player's turn, by seat
  pending jsonb not null default '{}',
  -- every applied action, for replays and debugging: [{ "seat": int, "a": action }]
  actions jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  constraint room_state_size check (pg_column_size(state) < 2000000)
);
alter table regolith.room_states enable row level security;
revoke all on regolith.room_states from public, anon, authenticated;

-- Realtime: members get a change event whenever their room's row changes.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'regolith' and tablename = 'rooms') then
    alter publication supabase_realtime add table regolith.rooms;
  end if;
end $$;

-- ---------------------------------------------------------------- lobby (signed-in players)

create or replace function regolith.new_room_code()
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
    exit when not exists (select 1 from regolith.rooms r where r.code = c);
  end loop;
  return c;
end;
$$;

-- Validate and normalise a seat list sent by the host. Seat 0 is always the host.
create or replace function regolith.clean_seats(p_seats jsonb, p_host uuid, p_old jsonb)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_out jsonb := '[]';
  s jsonb;
  kind text;
  uid uuid;
  nm text;
  i int := 0;
  names text[] := '{}';
begin
  if jsonb_typeof(p_seats) <> 'array' or jsonb_array_length(p_seats) not between 2 and 5 then
    raise exception 'A game needs 2 to 5 seats';
  end if;
  for s in select * from jsonb_array_elements(p_seats) loop
    kind := coalesce(s ->> 'kind', 'open');
    uid := nullif(s ->> 'user', '')::uuid;
    if i = 0 then
      kind := 'human';
      uid := p_host;
    elsif kind = 'human' then
      -- only someone who already joined can hold a human seat
      if uid is null or p_old is null or not exists (
        select 1 from jsonb_array_elements(p_old) o where (o ->> 'user')::uuid = uid
      ) then
        kind := 'open';
        uid := null;
      end if;
    elsif kind in ('open', 'easy', 'normal', 'hard') then
      uid := null;
    else
      raise exception 'Unknown seat type %', kind;
    end if;
    nm := left(btrim(coalesce(s ->> 'name', '')), 16);
    if kind = 'human' and p_old is not null and i > 0 then
      select left(o ->> 'name', 16) into nm from jsonb_array_elements(p_old) o where (o ->> 'user')::uuid = uid limit 1;
    end if;
    if nm = '' then nm := 'Player ' || (i + 1); end if;
    while nm = any (names) loop nm := left(nm, 14) || ' ' || (i + 1); end loop;
    names := names || nm;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', kind, 'name', nm, 'color', left(coalesce(s ->> 'color', ''), 16), 'user', uid
    ));
    i := i + 1;
  end loop;
  -- no player twice
  if (select count(*) from jsonb_array_elements(v_out) o where o ->> 'user' is not null)
     <> (select count(distinct o ->> 'user') from jsonb_array_elements(v_out) o where o ->> 'user' is not null) then
    raise exception 'A player can only hold one seat';
  end if;
  return v_out;
end;
$$;

create or replace function regolith.seat_members(p_seats jsonb)
returns uuid[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg((o ->> 'user')::uuid), '{}') from jsonb_array_elements(p_seats) o where o ->> 'user' is not null;
$$;

-- Host opens a room. Returns { id, code }.
create or replace function regolith.create_room(p_seats jsonb, p_corporate_era boolean default true)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_seats jsonb;
  r regolith.rooms;
begin
  if uid is null then raise exception 'Sign in to play online'; end if;
  if (select count(*) from regolith.rooms x where x.host = uid and x.status <> 'over') >= 20 then
    raise exception 'You already host 20 open games; finish or delete some first';
  end if;
  v_seats := regolith.clean_seats(p_seats, uid, null);
  insert into regolith.rooms (code, host, seats, members, corporate_era)
  values (regolith.new_room_code(), uid, v_seats, regolith.seat_members(v_seats), coalesce(p_corporate_era, true))
  returning * into r;
  return jsonb_build_object('id', r.id, 'code', r.code);
end;
$$;

-- Host changes seats or options while still in the lobby.
create or replace function regolith.update_room(p_room uuid, p_seats jsonb, p_corporate_era boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r regolith.rooms;
  v_seats jsonb;
begin
  select * into r from regolith.rooms x where x.id = p_room for update;
  if r.id is null or r.host is distinct from uid then raise exception 'Only the host can change this game'; end if;
  if r.status <> 'lobby' then raise exception 'The game has already started'; end if;
  v_seats := regolith.clean_seats(p_seats, uid, r.seats);
  update regolith.rooms x
     set seats = v_seats, members = regolith.seat_members(v_seats), corporate_era = coalesce(p_corporate_era, r.corporate_era),
         version = x.version + 1, updated_at = now()
   where x.id = p_room;
end;
$$;

-- Join a room by its code: takes the first open seat. Returns the room id.
create or replace function regolith.join_room(p_code text, p_name text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r regolith.rooms;
  idx int;
  nm text := left(btrim(coalesce(p_name, '')), 16);
  v_seats jsonb;
begin
  if uid is null then raise exception 'Sign in to play online'; end if;
  select * into r from regolith.rooms x where x.code = upper(btrim(p_code)) for update;
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
  update regolith.rooms x
     set seats = v_seats, members = regolith.seat_members(v_seats), version = x.version + 1, updated_at = now()
   where x.id = r.id;
  return r.id;
end;
$$;

-- Leave a lobby (the host leaving closes it). Once a game has started, leaving only hides it
-- from your list; the host can hand your seat to a CPU.
create or replace function regolith.leave_room(p_room uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r regolith.rooms;
  v_seats jsonb;
begin
  select * into r from regolith.rooms x where x.id = p_room for update;
  if r.id is null or not (uid = any (r.members)) then return; end if;
  if r.host = uid and r.status <> 'playing' then
    delete from regolith.rooms x where x.id = p_room;
    return;
  end if;
  if r.status = 'lobby' then
    select jsonb_agg(case when (o ->> 'user')::uuid = uid then o || jsonb_build_object('kind', 'open', 'user', null) else o end order by ord)
      into v_seats from jsonb_array_elements(r.seats) with ordinality t(o, ord);
    update regolith.rooms x set seats = v_seats, members = regolith.seat_members(v_seats), version = x.version + 1, updated_at = now() where x.id = p_room;
  else
    update regolith.rooms x set members = array_remove(x.members, uid), updated_at = now() where x.id = p_room and x.host <> uid;
  end if;
end;
$$;

revoke execute on function regolith.new_room_code() from public, anon, authenticated;
revoke execute on function regolith.clean_seats(jsonb, uuid, jsonb) from public, anon, authenticated;
revoke execute on function regolith.seat_members(jsonb) from public, anon, authenticated;
revoke execute on function regolith.create_room(jsonb, boolean) from public, anon;
revoke execute on function regolith.update_room(uuid, jsonb, boolean) from public, anon;
revoke execute on function regolith.join_room(text, text) from public, anon;
revoke execute on function regolith.leave_room(uuid) from public, anon;
grant execute on function regolith.create_room(jsonb, boolean) to authenticated;
grant execute on function regolith.update_room(uuid, jsonb, boolean) to authenticated;
grant execute on function regolith.join_room(text, text) to authenticated;
grant execute on function regolith.leave_room(uuid) to authenticated;

-- ---------------------------------------------------------------- server only (service role)

-- Room row, full state and queued picks, for the Edge Function.
create or replace function regolith.srv_load(p_room uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('room', to_jsonb(r), 'state', st.state, 'pending', coalesce(st.pending, '{}'))
  from regolith.rooms r left join regolith.room_states st on st.room_id = r.id
  where r.id = p_room;
$$;

-- Save a new game state if nobody else saved since p_version. Returns the new version, or
-- null when the room moved on (the caller reloads and tries again).
create or replace function regolith.srv_save(
  p_room uuid, p_version int, p_state jsonb, p_pending jsonb, p_actions jsonb,
  p_status text, p_phase text, p_generation int, p_decider int, p_waiting jsonb, p_seats jsonb
)
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v int;
begin
  update regolith.rooms x
     set version = x.version + 1, status = coalesce(p_status, x.status), phase = p_phase, generation = p_generation,
         decider = p_decider, waiting = coalesce(array(select jsonb_array_elements_text(p_waiting)::int), '{}'), seats = coalesce(p_seats, x.seats),
         members = case when p_seats is null then x.members
                        else (select coalesce(array_agg(distinct m), '{}') from unnest(x.members || regolith.seat_members(p_seats)) m) end,
         updated_at = now()
   where x.id = p_room and x.version = p_version
  returning x.version into v;
  if v is null then return null; end if;
  insert into regolith.room_states as st (room_id, state, pending, actions)
  values (p_room, p_state, coalesce(p_pending, '{}'), coalesce(p_actions, '[]'))
  on conflict (room_id) do update
    set state = excluded.state, pending = excluded.pending, actions = st.actions || excluded.actions, updated_at = now();
  return v;
end;
$$;

revoke execute on function regolith.srv_load(uuid) from public, anon, authenticated;
revoke execute on function regolith.srv_save(uuid, int, jsonb, jsonb, jsonb, text, text, int, int, jsonb, jsonb) from public, anon, authenticated;
grant usage on schema regolith to service_role;
grant execute on function regolith.srv_load(uuid) to service_role;
grant execute on function regolith.srv_save(uuid, int, jsonb, jsonb, jsonb, text, text, int, int, jsonb, jsonb) to service_role;
