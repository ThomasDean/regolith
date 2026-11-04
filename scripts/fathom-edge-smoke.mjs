// Runs the built fathom-play bundle in Node with a fake Deno, a fake auth endpoint and an
// in-memory stand-in for fathom.srv_load / srv_save, then plays a 1-human + 1-CPU game through
// real HTTP-shaped requests. Run after `npm run build:edge`.
import { pathToFileURL } from 'node:url';

const users = { 'tok-host': 'user-host' };
const ROOM = '11111111-2222-4333-8444-555555555556';
let room = {
  id: ROOM, code: 'FSH234', host: 'user-host', status: 'lobby', members: ['user-host'], settings: { variable: true }, version: 0,
  phase: null, tide: null, decider: null, waiting: [], updated_at: '',
  seats: [{ kind: 'human', name: 'Tom', color: '#e4572e', user: 'user-host' }, { kind: 'normal', name: 'Marina', color: '#29a3a3', user: null }],
};
let state = null;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.endsWith('/auth/v1/user')) {
    const tok = (init.headers.Authorization || '').replace('Bearer ', '');
    return users[tok] ? ok({ id: users[tok] }) : new Response('{}', { status: 401 });
  }
  if (init.headers['Content-Profile'] !== 'fathom') throw new Error('wrong schema header ' + init.headers['Content-Profile']);
  const args = JSON.parse(init.body);
  if (u.endsWith('/rpc/srv_load')) return ok(args.p_room === ROOM ? { room, state } : null);
  if (u.endsWith('/rpc/srv_save')) {
    if (args.p_version !== room.version) return ok(null);
    room = { ...room, version: room.version + 1, status: args.p_status, phase: args.p_phase, tide: args.p_tide, decider: args.p_decider, waiting: args.p_waiting, seats: args.p_seats ?? room.seats };
    state = args.p_state;
    return ok(room.version);
  }
  throw new Error('unexpected fetch ' + u);
};

let handler;
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}', SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_test"}' })[k] },
  serve: (h) => { handler = h; },
};
await import(pathToFileURL('supabase/functions/fathom-play/index.js').href);

async function call(body, tok = 'tok-host') {
  const res = await handler(new Request('https://fn/fathom-play', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

assert((await call({ op: 'view', room: ROOM }, 'bad')).status === 401, 'bad token rejected');
let r = await call({ op: 'start', room: ROOM });
assert(r.status === 200 && r.body.room.status === 'playing', 'started: ' + JSON.stringify(r.body).slice(0, 200));
assert(r.body.view.deck.every((c) => c === '?') && r.body.view.rng === 0, 'deck and seed hidden');

// the human dives the sites in turn and skips every choice
let steps = 0, col = 0;
while (r.body.room.status !== 'over' && steps++ < 2000) {
  const { room: rm, view } = r.body;
  const d = view.prompt ? view.prompt.pid : view.active;
  if (d !== r.body.seat) r = await call({ op: 'advance', room: ROOM, version: rm.version });
  else if (view.prompt) r = await call({ op: 'act', room: ROOM, action: { t: 'answer', choice: null } });
  else r = await call({ op: 'act', room: ROOM, action: { t: 'dive', col: col++ % 3 } });
  assert(r.status === 200, 'request failed: ' + JSON.stringify(r.body));
}
assert(r.body.room.status === 'over', 'game finished');
console.log(`ok: fathom bundle played a full game in ${steps} requests, final version ${r.body.room.version}`);
