// Runs the Supabase migrations in an in-process Postgres (PGlite) with small stand-ins for
// Supabase's auth schema, roles and realtime publication, then checks the lobby functions and
// who may read what.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const HOST = '00000000-0000-4000-8000-0000000000a1';
const FRIEND = '00000000-0000-4000-8000-0000000000b2';
const STRANGER = '00000000-0000-4000-8000-0000000000c3';

let db: PGlite;

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const asService = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  await db.exec('set role service_role');
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create publication supabase_realtime;
    insert into auth.users values ('${HOST}'), ('${FRIEND}'), ('${STRANGER}');
  `);
  const dir = 'supabase/migrations';
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
  // the migration is meant to be safe to re-run
  await db.exec(readFileSync(`${dir}/20261019000000_regolith_online_rooms.sql`, 'utf8'));
}, 60000);

const seats = JSON.stringify([
  { kind: 'human', name: 'Tom', color: '#e4574a' },
  { kind: 'open', name: '', color: '#4a9fe4' },
  { kind: 'normal', name: 'Vesta', color: '#5fc07a' },
]);

describe('online rooms in the database', () => {
  let room = '';
  let code = '';

  it('lets a signed-in player open a room, and nobody else see it', async () => {
    await expect(as(null, `select regolith.create_room($1::jsonb, true)`, [seats])).rejects.toThrow(/permission denied/);
    const [r] = await as<{ r: { id: string; code: string } }>(HOST, `select regolith.create_room($1::jsonb, true) as r`, [seats]);
    room = r.r.id;
    code = r.r.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await as(HOST, `select id from regolith.rooms`)).toHaveLength(1);
    expect(await as(STRANGER, `select id from regolith.rooms`)).toHaveLength(0);
  });

  it('fills the open seat when a friend joins with the code', async () => {
    const [j] = await as<{ id: string }>(FRIEND, `select regolith.join_room($1, 'Tom') as id`, [code.toLowerCase()]);
    expect(j.id).toBe(room);
    const [row] = await as<{ seats: { kind: string; name: string; user: string | null }[]; members: string[]; version: number }>(FRIEND, `select seats, members, version from regolith.rooms`);
    expect(row.seats[1]).toMatchObject({ kind: 'human', user: FRIEND });
    expect(row.seats[1].name).not.toBe('Tom'); // names stay distinct
    expect(row.members.sort()).toEqual([HOST, FRIEND].sort());
    expect(row.version).toBe(1);
    // joining twice is harmless; a full room turns others away
    await as(FRIEND, `select regolith.join_room($1, 'x')`, [code]);
    await expect(as(STRANGER, `select regolith.join_room($1, 'Eve')`, [code])).rejects.toThrow(/full/);
    await expect(as(STRANGER, `select regolith.join_room('ZZZZZZ', 'Eve')`)).rejects.toThrow(/No game/);
  });

  it('only lets the host change seats, and keeps the host in seat 0', async () => {
    const [{ seats: cur }] = await as<{ seats: object[] }>(HOST, `select seats from regolith.rooms`);
    await expect(as(FRIEND, `select regolith.update_room($1, $2::jsonb, false)`, [room, JSON.stringify(cur)])).rejects.toThrow(/Only the host/);
    const changed = [{ kind: 'hard', name: 'Usurper', user: FRIEND }, ...cur.slice(1), { kind: 'human', name: 'Fake', user: STRANGER }];
    await as(HOST, `select regolith.update_room($1, $2::jsonb, false)`, [room, JSON.stringify(changed)]);
    const [row] = await as<{ seats: { kind: string; user: string | null }[]; corporate_era: boolean }>(HOST, `select seats, corporate_era from regolith.rooms`);
    expect(row.seats[0]).toMatchObject({ kind: 'human', user: HOST });
    expect(row.seats[1]).toMatchObject({ kind: 'human', user: FRIEND });
    expect(row.seats[3]).toMatchObject({ kind: 'open', user: null }); // can't seat someone who never joined
    expect(row.corporate_era).toBe(false);
  });

  it('keeps the game state away from players', async () => {
    await expect(as(HOST, `select regolith.srv_load($1)`, [room])).rejects.toThrow(/permission denied/);
    await expect(as(HOST, `select * from regolith.room_states`)).rejects.toThrow(/permission denied/);
    await expect(as(HOST, `update regolith.rooms set status = 'over'`)).rejects.toThrow(/permission denied/);
  });

  it('saves state for the server only if nobody saved first', async () => {
    const [{ v }] = await asService<{ v: number }>(`select (regolith.srv_load($1) -> 'room' ->> 'version')::int as v`, [room]);
    const save = (version: number) => asService<{ n: number | null }>(
      `select regolith.srv_save($1, $2, '{"phase":"setup"}'::jsonb, '{}'::jsonb, '[{"seat":0}]'::jsonb, 'playing', 'setup', 1, 0, '[0,1]'::jsonb, null) as n`, [room, version]);
    expect((await save(v))[0].n).toBe(v + 1);
    expect((await save(v))[0].n).toBeNull();
    const [loaded] = await asService<{ l: { room: { status: string; waiting: number[] }; state: { phase: string } } }>(`select regolith.srv_load($1) as l`, [room]);
    expect(loaded.l.room.status).toBe('playing');
    expect(loaded.l.room.waiting).toEqual([0, 1]);
    expect(loaded.l.state.phase).toBe('setup');
    await expect(as(FRIEND, `select regolith.update_room($1, '[]'::jsonb, true)`, [room])).rejects.toThrow(/host/);
  });

  it('lets a player leave a started game without closing it', async () => {
    await as(FRIEND, `select regolith.leave_room($1)`, [room]);
    expect(await as(FRIEND, `select id from regolith.rooms`)).toHaveLength(0);
    expect(await as(HOST, `select id from regolith.rooms`)).toHaveLength(1);
  });

  it('closes a lobby when its host leaves', async () => {
    const [r] = await as<{ r: { id: string } }>(HOST, `select regolith.create_room($1::jsonb, true) as r`, [seats]);
    await as(HOST, `select regolith.leave_room($1)`, [r.r.id]);
    expect(await as(HOST, `select id from regolith.rooms where id = $1`, [r.r.id])).toHaveLength(0);
  });
});
