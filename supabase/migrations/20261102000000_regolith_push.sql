-- Regolith push notifications. A device that installed Regolith to its Home Screen and said
-- yes to notifications registers a Web Push subscription here. When it becomes someone's move
-- in an online game, the regolith-play Edge Function looks up that player's subscriptions
-- (with the number of games now waiting on them, for the app badge) and sends the push.
-- The table can't be read or written directly; the app goes through the functions below.
-- Safe to re-run.

create table if not exists regolith.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- the push service's URL for this device; whoever holds it can push to the device
  -- only the browser makers' push services (Apple, Google, Mozilla, Microsoft); anyone can be a
  -- guest, so this stops the server being pointed at arbitrary addresses
  endpoint text not null unique check (
    length(endpoint) between 20 and 2048
    and endpoint ~ '^https://([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)/'
  ),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on regolith.push_subscriptions (user_id);
alter table regolith.push_subscriptions enable row level security;
revoke all on regolith.push_subscriptions from public, anon, authenticated;

-- ---------------------------------------------------------------- the signed-in player

-- Register (or refresh) this device. An endpoint belongs to one device, so if it was
-- registered under another account (a shared phone) it moves to the account signed in now.
-- A player keeps their 10 most recent devices.
create or replace function regolith.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to turn on notifications'; end if;
  insert into regolith.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = coalesce(excluded.user_agent, s.user_agent), updated_at = now();
  delete from regolith.push_subscriptions s
   where s.user_id = uid
     and s.id in (select o.id from regolith.push_subscriptions o where o.user_id = uid order by o.updated_at desc offset 10);
end;
$$;

-- Forget this device.
create or replace function regolith.delete_push_subscription(p_endpoint text)
returns void
language sql volatile security definer set search_path = ''
as $$
  delete from regolith.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;

-- Whether this endpoint is registered to you (the app checks after sign-in changes).
create or replace function regolith.has_push_subscription(p_endpoint text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from regolith.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------- shared with the server

-- How many games are waiting on this player's decision: the number on the app badge.
create or replace function regolith.turns_waiting(p_user uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from regolith.rooms r
   where r.status = 'playing'
     and p_user = any (r.members)
     and exists (select 1 from unnest(r.waiting) w where (r.seats -> w ->> 'user')::uuid = p_user);
$$;

-- ---------------------------------------------------------------- server only (service role)

-- Every device of the given players, each with that player's current badge count.
create or replace function regolith.srv_push_targets(p_users uuid[])
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user', s.user_id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           'badge', regolith.turns_waiting(s.user_id))), '[]'::jsonb)
    from regolith.push_subscriptions s
   where s.user_id = any (p_users);
$$;

-- Drop devices the push service says are gone (404 / 410).
create or replace function regolith.srv_push_drop(p_endpoints text[])
returns int
language sql volatile security definer set search_path = ''
as $$
  with d as (delete from regolith.push_subscriptions s where s.endpoint = any (p_endpoints) returning 1)
  select count(*)::int from d;
$$;

revoke execute on function regolith.save_push_subscription(text, text, text, text) from public, anon, authenticated;
revoke execute on function regolith.delete_push_subscription(text) from public, anon, authenticated;
revoke execute on function regolith.has_push_subscription(text) from public, anon, authenticated;
revoke execute on function regolith.turns_waiting(uuid) from public, anon, authenticated;
revoke execute on function regolith.srv_push_targets(uuid[]) from public, anon, authenticated;
revoke execute on function regolith.srv_push_drop(text[]) from public, anon, authenticated;
grant execute on function regolith.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function regolith.delete_push_subscription(text) to authenticated;
grant execute on function regolith.has_push_subscription(text) to authenticated;
grant execute on function regolith.turns_waiting(uuid) to service_role;
grant execute on function regolith.srv_push_targets(uuid[]) to service_role;
grant execute on function regolith.srv_push_drop(text[]) to service_role;
