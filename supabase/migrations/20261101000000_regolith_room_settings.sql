-- Map and milestone/award choice for online rooms. Adds rooms.settings
-- ({ "board": text, "milestones": [text], "awards": [text] }) and an optional p_settings argument
-- to create_room / update_room. The referee checks the contents when the game starts (unknown
-- maps fall back to Tharsis; unknown milestones or awards are refused). Safe to re-run; apply
-- before deploying a site or referee that sends settings.

alter table regolith.rooms add column if not exists settings jsonb not null default '{}'::jsonb;
alter table regolith.rooms drop constraint if exists settings_shape;
alter table regolith.rooms add constraint settings_shape check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 4000);

-- Keeps only the known keys, with the right types.
create or replace function regolith.clean_settings(p jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'board', case when jsonb_typeof(p -> 'board') = 'string' then p -> 'board' end,
    'milestones', case when jsonb_typeof(p -> 'milestones') = 'array' and jsonb_array_length(p -> 'milestones') between 1 and 8 then p -> 'milestones' end,
    'awards', case when jsonb_typeof(p -> 'awards') = 'array' and jsonb_array_length(p -> 'awards') between 1 and 8 then p -> 'awards' end
  ))
  where p is not null and jsonb_typeof(p) = 'object';
$$;

drop function if exists regolith.create_room(jsonb, boolean);
drop function if exists regolith.update_room(uuid, jsonb, boolean);

-- Host opens a room. Returns { id, code }.
create or replace function regolith.create_room(p_seats jsonb, p_corporate_era boolean default true, p_settings jsonb default null)
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
  insert into regolith.rooms (code, host, seats, members, corporate_era, settings)
  values (regolith.new_room_code(), uid, v_seats, regolith.seat_members(v_seats), coalesce(p_corporate_era, true), coalesce(regolith.clean_settings(p_settings), '{}'))
  returning * into r;
  return jsonb_build_object('id', r.id, 'code', r.code);
end;
$$;

-- Host changes seats or options while still in the lobby (null settings: keep them).
create or replace function regolith.update_room(p_room uuid, p_seats jsonb, p_corporate_era boolean, p_settings jsonb default null)
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
         settings = coalesce(regolith.clean_settings(p_settings), r.settings),
         version = x.version + 1, updated_at = now()
   where x.id = p_room;
end;
$$;

revoke execute on function regolith.clean_settings(jsonb) from public, anon, authenticated;
revoke execute on function regolith.create_room(jsonb, boolean, jsonb) from public, anon;
revoke execute on function regolith.update_room(uuid, jsonb, boolean, jsonb) from public, anon;
grant execute on function regolith.create_room(jsonb, boolean, jsonb) to authenticated;
grant execute on function regolith.update_room(uuid, jsonb, boolean, jsonb) to authenticated;
