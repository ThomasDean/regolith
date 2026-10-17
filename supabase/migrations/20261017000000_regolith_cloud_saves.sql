-- Regolith cloud saves, in their own schema. Signed-in users can't touch the table directly;
-- they go through four functions, each scoped to the caller's own saves. The schema must be
-- listed under "Exposed schemas" in the project's Data API settings. Safe to re-run.

create schema if not exists regolith;
revoke all on schema regolith from public, anon, authenticated;
grant usage on schema regolith to authenticated;

create table if not exists regolith.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  players text not null default '',
  phase text not null default '',
  generation int not null default 1,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint state_size check (pg_column_size(state) < 2000000)
);
create index if not exists saves_user_updated on regolith.saves (user_id, updated_at desc);
alter table regolith.saves enable row level security;
revoke all on regolith.saves from public, anon, authenticated;

-- List the caller's saves, newest first (without the game state itself).
create or replace function regolith.list_saves()
returns table (id uuid, name text, players text, phase text, generation int, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.name, s.players, s.phase, s.generation, s.updated_at
  from regolith.saves s
  where s.user_id = auth.uid()
  order by s.updated_at desc
  limit 50;
$$;

-- Load one of the caller's saves.
create or replace function regolith.get_save(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select s.state from regolith.saves s where s.id = p_id and s.user_id = auth.uid();
$$;

-- Create or update one of the caller's saves. Another user's id is never overwritten.
create or replace function regolith.put_save(
  p_id uuid, p_name text, p_players text, p_phase text, p_generation int, p_state jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in to save games to the cloud';
  end if;
  insert into regolith.saves as s (id, user_id, name, players, phase, generation, state)
  values (p_id, uid, left(coalesce(p_name, ''), 80), left(coalesce(p_players, ''), 200), left(coalesce(p_phase, ''), 20), coalesce(p_generation, 1), p_state)
  on conflict (id) do update
    set name = excluded.name, players = excluded.players, phase = excluded.phase,
        generation = excluded.generation, state = excluded.state, updated_at = now()
    where s.user_id = uid;
  return p_id;
end;
$$;

-- Delete one of the caller's saves.
create or replace function regolith.delete_save(p_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from regolith.saves s where s.id = p_id and s.user_id = auth.uid();
$$;

revoke execute on function regolith.list_saves() from public, anon;
revoke execute on function regolith.get_save(uuid) from public, anon;
revoke execute on function regolith.put_save(uuid, text, text, text, int, jsonb) from public, anon;
revoke execute on function regolith.delete_save(uuid) from public, anon;
grant execute on function regolith.list_saves() to authenticated;
grant execute on function regolith.get_save(uuid) to authenticated;
grant execute on function regolith.put_save(uuid, text, text, text, int, jsonb) to authenticated;
grant execute on function regolith.delete_save(uuid) to authenticated;
