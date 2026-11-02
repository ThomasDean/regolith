// Runs the built Edge Function bundle with push configured, against fake Supabase and a fake
// push service: a host starts a two-player game, and the other player's two devices should get
// an encrypted "choose your corporation" push (the dead one is forgotten). Run after
// `npm run build:edge`.
import { pathToFileURL } from 'node:url';
import { createDecipheriv, createECDH, hkdfSync, webcrypto } from 'node:crypto';

const ROOM = '11111111-2222-4333-8444-555555555555';
const users = { 'tok-host': 'user-host', 'tok-friend': 'user-friend' };
let room = {
  id: ROOM, code: 'XYZ234', host: 'user-host', status: 'lobby', members: ['user-host', 'user-friend'], corporate_era: true, version: 0,
  phase: null, generation: null, decider: null, waiting: [], updated_at: '',
  seats: [{ kind: 'human', name: 'Tom', color: '#e4572e', user: 'user-host' }, { kind: 'human', name: 'Ana', color: '#29a3a3', user: 'user-friend' }],
};
let state = null, pending = {};

// the friend's two phones: one works, one has been removed from the Home Screen
const phone = () => { const e = createECDH('prime256v1'); e.generateKeys(); const auth = webcrypto.getRandomValues(new Uint8Array(16)); return { e, auth }; };
const good = phone(), dead = phone();
const b64u = (b) => Buffer.from(b).toString('base64url');
const device = (p, endpoint) => ({ user: 'user-friend', endpoint, p256dh: b64u(p.e.getPublicKey()), auth: b64u(p.auth), badge: 1 });
const GOOD = 'https://web.push.apple.com/good-device-endpoint', DEAD = 'https://web.push.apple.com/dead-device-endpoint';

const vp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const vpub = b64u(new Uint8Array(await webcrypto.subtle.exportKey('raw', vp.publicKey)));
const vpriv = (await webcrypto.subtle.exportKey('jwk', vp.privateKey)).d;

const pushes = [], dropped = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://web.push.apple.com/')) {
    pushes.push({ url: u, headers: init.headers, body: new Uint8Array(init.body) });
    return new Response(null, { status: u === DEAD ? 410 : 201 });
  }
  if (u.endsWith('/auth/v1/user')) {
    const tok = (init.headers.Authorization || '').replace('Bearer ', '');
    return users[tok] ? ok({ id: users[tok] }) : new Response('{}', { status: 401 });
  }
  const args = JSON.parse(init.body);
  if (u.endsWith('/rpc/srv_load')) return ok({ room, state, pending });
  if (u.endsWith('/rpc/srv_save')) {
    if (args.p_version !== room.version) return ok(null);
    room = { ...room, version: room.version + 1, status: args.p_status, phase: args.p_phase, generation: args.p_generation, decider: args.p_decider, waiting: args.p_waiting, seats: args.p_seats ?? room.seats };
    state = args.p_state; pending = args.p_pending;
    return ok(room.version);
  }
  if (u.endsWith('/rpc/srv_push_targets')) return ok(args.p_users.includes('user-friend') ? [device(good, GOOD), device(dead, DEAD)] : []);
  if (u.endsWith('/rpc/srv_push_drop')) { dropped.push(...args.p_endpoints); return ok(args.p_endpoints.length); }
  throw new Error('unexpected fetch ' + u);
};

let handler;
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}', SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_test"}', VAPID_PUBLIC_KEY: vpub, VAPID_PRIVATE_KEY: vpriv, VAPID_SUBJECT: 'https://regolith.example' };
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL('supabase/functions/regolith-play/index.js').href);

const call = async (body, tok) => {
  const res = await handler(new Request('https://fn/regolith-play', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

assert((await call({ op: 'push-key' }, 'tok-friend')).body.key === vpub, 'the browser can fetch the public key');
assert((await call({ op: 'push-key' }, 'bad')).status === 401, 'the key is only for signed-in players');

const started = await call({ op: 'start', room: ROOM }, 'tok-host');
assert(started.status === 200 && started.body.room.status === 'playing', 'game started');
for (let i = 0; i < 50 && pushes.length < 2; i++) await new Promise((r) => setTimeout(r, 20)); // delivery runs in the background

assert(pushes.length === 2, `both of the friend's devices were pushed to (got ${pushes.length})`);
assert(dropped.length === 1 && dropped[0] === DEAD, 'the removed device was forgotten');
const p = pushes.find((x) => x.url === GOOD);
assert(/^vapid t=.+, k=/.test(p.headers.Authorization) && p.headers['Content-Encoding'] === 'aes128gcm', 'VAPID + aes128gcm headers');

const body = Buffer.from(p.body);
const salt = body.subarray(0, 16), asPublic = body.subarray(21, 21 + body[20]), cipher = body.subarray(21 + body[20]);
const shared = good.e.computeSecret(asPublic);
const ikm = Buffer.from(hkdfSync('sha256', shared, good.auth, Buffer.concat([Buffer.from('WebPush: info\0'), good.e.getPublicKey(), asPublic]), 32));
const d = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16)), Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12)));
d.setAuthTag(cipher.subarray(-16));
const plain = Buffer.concat([d.update(cipher.subarray(0, -16)), d.final()]);
const msg = JSON.parse(plain.subarray(0, -1).toString());
assert(msg.title === 'Choose your corporation' && msg.url === `/?room=${ROOM}` && msg.tag === ROOM && msg.badge === 1, 'message content: ' + JSON.stringify(msg));
assert(!pushes.some((x) => x.url.includes('host')), 'the host, who started it, was not notified');
console.log('ok: push delivered through the bundle:', JSON.stringify(msg));
