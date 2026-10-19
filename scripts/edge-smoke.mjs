// Runs the built Edge Function bundle in Node with a fake Deno, a fake auth endpoint and an
// in-memory stand-in for regolith.srv_load / srv_save, then plays a 1-human + 1-CPU game
// through real HTTP-shaped requests. Run after `npm run build:edge`.
import { pathToFileURL } from 'node:url';

const users = { 'tok-host': 'user-host' };
const ROOM = '11111111-2222-4333-8444-555555555555';
let room = {
  id: ROOM, code: 'XYZ234', host: 'user-host', status: 'lobby', members: ['user-host'], corporate_era: true, version: 0,
  phase: null, generation: null, decider: null, waiting: [], updated_at: '',
  seats: [{ kind: 'human', name: 'Tom', color: '#e4572e', user: 'user-host' }, { kind: 'normal', name: 'Vesta', color: '#29a3a3', user: null }],
};
let state = null, pending = {};

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.endsWith('/auth/v1/user')) {
    const tok = (init.headers.Authorization || '').replace('Bearer ', '');
    return users[tok] ? ok({ id: users[tok] }) : new Response('{}', { status: 401 });
  }
  if (init.headers['Content-Profile'] !== 'regolith') throw new Error('missing schema header');
  const args = JSON.parse(init.body);
  if (u.endsWith('/rpc/srv_load')) return ok(args.p_room === ROOM ? { room, state, pending } : null);
  if (u.endsWith('/rpc/srv_save')) {
    if (args.p_version !== room.version) return ok(null);
    room = { ...room, version: room.version + 1, status: args.p_status, phase: args.p_phase, generation: args.p_generation, decider: args.p_decider, waiting: args.p_waiting, seats: args.p_seats ?? room.seats };
    state = args.p_state; pending = args.p_pending;
    return ok(room.version);
  }
  throw new Error('unexpected fetch ' + u);
};

let handler;
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' })[k] },
  serve: (h) => { handler = h; },
};
await import(pathToFileURL('supabase/functions/regolith-play/index.js').href);

async function call(body, tok = 'tok-host') {
  const res = await handler(new Request('https://fn/regolith-play', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
assert((await call({ op: 'view', room: ROOM }, 'bad')).status === 401, 'bad token rejected');
assert((await handler(new Request('https://fn', { method: 'OPTIONS' }))).headers.get('Access-Control-Allow-Origin') === '*', 'CORS preflight');
let r = await call({ op: 'start', room: ROOM });
assert(r.status === 200 && r.body.room.status === 'playing', 'started: ' + JSON.stringify(r.body).slice(0, 200));

// the human plays like a lazy player: picks the first corp, keeps nothing, passes whenever possible
let steps = 0;
while (r.body.room.status !== 'over' && steps++ < Number(process.env.STEPS ?? 4000)) {
  const { room: rm, view } = r.body;
  if (process.env.TRACE) console.log(steps, rm.version, rm.phase, rm.decider, view.prompt?.kind ?? "", view.generation, view.temperature, view.oxygen, view.oceans);
  if (rm.decider === 1) { r = await call({ op: 'advance', room: ROOM, version: rm.version }); continue; }
  const me = view.players[0];
  let action;
  if (view.prompt) {
    const p = view.prompt;
    action = p.kind === 'space' ? { t: 'answer', space: p.options[0] } : p.kind === 'player' ? { t: 'answer', player: p.optional ? null : p.options[0] }
      : p.kind === 'card' ? { t: 'answer', card: p.optional ? null : p.options[0] } : p.kind === 'choice' ? { t: 'answer', option: p.options.findIndex((o) => o.ok) }
      : p.kind === 'cards' ? { t: 'answer', cards: p.cards.slice(0, p.min) } : { t: 'answer', amount: 0 };
  } else if (view.phase === 'setup') action = { t: 'setup', corp: me.setup.corps[0], keep: [] };
  else if (view.phase === 'research') action = { t: 'research', keep: [] };
  else if (view.phase === 'finalGreenery') action = { t: 'pass' };
  else if (view.temperature < 8 && me.res.heat >= 8) action = { t: 'heat' };
  else if (view.temperature < 8 && me.res.mc >= 14) action = { t: 'sp', id: 'asteroid' };
  else if (view.oceans < 9 && me.res.mc >= 18) action = { t: 'sp', id: 'aquifer' };
  else if (view.oxygen < 14 && me.res.mc >= 23) action = { t: 'sp', id: 'greenery' };
  else action = { t: 'pass' };
  r = await call({ op: 'act', room: ROOM, action });
  assert(r.status === 200, `act ${JSON.stringify(action)} -> ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.view.players[1].hand.every((c) => c === '?'), 'CPU hand hidden');
}
assert(r.body.room.status === 'over', 'game finished in ' + steps + ' steps');
console.log(`ok: bundle played a full game in ${steps} requests, generation ${r.body.view.generation}, final version ${r.body.room.version}`);
