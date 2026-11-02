-- Expansions for online rooms: rooms.settings may now carry
-- { "expansions": { "prelude": bool, "venus": bool, "colonies": bool, "turmoil": bool } }
-- next to the map and milestone/award choice. Only clean_settings changes (create_room and
-- update_room already pass settings through it). Unknown expansion names are dropped; the
-- referee checks the rest when the game starts. Safe to re-run.

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
    ) end
  ))
  where p is not null and jsonb_typeof(p) = 'object';
$$;

revoke execute on function regolith.clean_settings(jsonb) from public, anon, authenticated;
