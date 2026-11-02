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
  // the migrations are meant to be safe to re-run (in order)
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
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

  it('stores a room’s map and milestone/award choice, keeping only known keys', async () => {
    const settings = { board: 'hellas', milestones: ['mayor', 'builder', 'planner', 'gardener', 'legend'], awards: ['banker', 'miner', 'magnate', 'celebrity', 'investor'], junk: 'x' };
    const [r] = await as<{ r: { id: string } }>(HOST, `select regolith.create_room($1::jsonb, true, $2::jsonb) as r`, [seats, JSON.stringify(settings)]);
    const [row] = await as<{ settings: Record<string, unknown>; seats: object[] }>(HOST, `select settings, seats from regolith.rooms where id = $1`, [r.r.id]);
    expect(row.settings).toEqual({ board: 'hellas', milestones: settings.milestones, awards: settings.awards });
    // seat changes without settings keep them; new settings replace them
    await as(HOST, `select regolith.update_room($1, $2::jsonb, true)`, [r.r.id, JSON.stringify(row.seats)]);
    expect((await as<{ settings: { board: string } }>(HOST, `select settings from regolith.rooms where id = $1`, [r.r.id]))[0].settings.board).toBe('hellas');
    await as(HOST, `select regolith.update_room($1, $2::jsonb, true, '{"board":"elysium"}'::jsonb)`, [r.r.id, JSON.stringify(row.seats)]);
    expect((await as<{ settings: object }>(HOST, `select settings from regolith.rooms where id = $1`, [r.r.id]))[0].settings).toEqual({ board: 'elysium' });
    await as(HOST, `select regolith.leave_room($1)`, [r.r.id]);
  });

  it('closes a lobby when its host leaves', async () => {
    const [r] = await as<{ r: { id: string } }>(HOST, `select regolith.create_room($1::jsonb, true) as r`, [seats]);
    await as(HOST, `select regolith.leave_room($1)`, [r.r.id]);
    expect(await as(HOST, `select id from regolith.rooms where id = $1`, [r.r.id])).toHaveLength(0);
  });
});

describe('push subscriptions in the database', () => {
  const EP = 'https://web.push.apple.com/QGexample0123456789abcdef';
  const KEYS = [EP, 'B'.repeat(87), 'a'.repeat(22)];

  it('is only reachable through the functions, and only when signed in', async () => {
    await expect(as(null, `select regolith.save_push_subscription($1, $2, $3)`, KEYS)).rejects.toThrow(/permission denied/);
    await expect(as(HOST, `select * from regolith.push_subscriptions`)).rejects.toThrow(/permission denied/);
    await as(HOST, `select regolith.save_push_subscription($1, $2, $3, 'iPhone')`, KEYS);
    expect((await as<{ ok: boolean }>(HOST, `select regolith.has_push_subscription($1) as ok`, [EP]))[0].ok).toBe(true);
    expect((await as<{ ok: boolean }>(FRIEND, `select regolith.has_push_subscription($1) as ok`, [EP]))[0].ok).toBe(false);
    // only the real push services, and sane key sizes
    for (const bad of ['http://web.push.apple.com/push-endpoint-1', 'https://evil.example/push-endpoint-1', 'https://web.push.apple.com.evil.example/x-push-endpoint', 'https://169.254.169.254/latest/meta-data/']) {
      await expect(as(HOST, `select regolith.save_push_subscription($3, $1, $2)`, [...KEYS.slice(1), bad])).rejects.toThrow(/check/);
    }
    for (const good of ['https://fcm.googleapis.com/fcm/send/abc123abc123', 'https://updates.push.services.mozilla.com/wpush/v2/abc123', 'https://wns2-par02p.notify.windows.com/w/?token=abc123']) {
      await as(HOST, `select regolith.save_push_subscription($3, $1, $2)`, [...KEYS.slice(1), good]);
      await as(HOST, `select regolith.delete_push_subscription($1)`, [good]);
    }
  });

  it('moves a device to whoever is signed in on it, and lets only its owner forget it', async () => {
    await as(FRIEND, `select regolith.save_push_subscription($1, $2, $3)`, KEYS);
    const rows = await asService<{ user: string }>(`select (regolith.srv_push_targets($1::uuid[]) -> 0 ->> 'user') as "user"`, [`{${HOST},${FRIEND}}`]);
    expect(rows[0].user).toBe(FRIEND);
    await as(HOST, `select regolith.delete_push_subscription($1)`, [EP]); // not the owner now: nothing happens
    expect((await as<{ ok: boolean }>(FRIEND, `select regolith.has_push_subscription($1) as ok`, [EP]))[0].ok).toBe(true);
    await as(FRIEND, `select regolith.delete_push_subscription($1)`, [EP]);
    expect((await as<{ ok: boolean }>(FRIEND, `select regolith.has_push_subscription($1) as ok`, [EP]))[0].ok).toBe(false);
  });

  it('keeps a player’s ten newest devices', async () => {
    for (let i = 0; i < 12; i++) await as(HOST, `select regolith.save_push_subscription($1, $2, $3)`, [`${EP}-${i}`, KEYS[1], KEYS[2]]);
    const [n] = await asService<{ n: number }>(`select jsonb_array_length(regolith.srv_push_targets($1::uuid[]))::int as n`, [`{${HOST}}`]);
    expect(n.n).toBe(10);
    expect((await as<{ ok: boolean }>(HOST, `select regolith.has_push_subscription($1) as ok`, [`${EP}-0`]))[0].ok).toBe(false);
    expect((await as<{ ok: boolean }>(HOST, `select regolith.has_push_subscription($1) as ok`, [`${EP}-11`]))[0].ok).toBe(true);
  });

  it('counts the games waiting on each player for the badge', async () => {
    const mk = async (waiting: number[], status: string) => {
      const [r] = await as<{ r: { id: string } }>(HOST, `select regolith.create_room($1::jsonb, true) as r`, [seats]);
      await asService(`select regolith.srv_save($1, 0, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, $2, 'action', 1, $3, $4::jsonb, null)`, [r.r.id, status, waiting[0] ?? 0, JSON.stringify(waiting)]);
      return r.r.id;
    };
    const count = async (u: string) => (await asService<{ n: number }>(`select regolith.turns_waiting($1) as n`, [u]))[0].n;
    const before = await count(HOST);
    const a = await mk([0], 'playing');   // waiting on the host
    const b = await mk([0], 'playing');
    const c = await mk([2], 'playing');   // waiting on a CPU seat: nobody's move
    const d = await mk([0], 'over');      // finished games don't count
    expect(await count(HOST)).toBe(before + 2);
    const [t] = await asService<{ badge: number }>(`select (regolith.srv_push_targets($1::uuid[]) -> 0 ->> 'badge')::int as badge`, [`{${HOST}}`]);
    expect(t.badge).toBe(before + 2);
    expect(await count(STRANGER)).toBe(0);
    for (const id of [a, b, c, d]) await as(HOST, `select regolith.leave_room($1)`, [id]);
  });

  it('drops devices the push service no longer knows', async () => {
    const [n] = await asService<{ n: number }>(`select regolith.srv_push_drop($1::text[]) as n`, [`{${EP}-5,${EP}-6,https://nowhere.example/none-none-none}`]);
    expect(n.n).toBe(2);
  });
});
