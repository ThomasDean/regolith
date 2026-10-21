// Supabase Edge Function "regolith-play": the referee for online games, wrapped for Deno.
// `npm run build:edge` bundles this with the rules engine into
// supabase/functions/regolith-play/index.js; `npm run deploy:edge` builds and deploys it.
//
// It checks the caller's sign-in itself (so it deploys with verify_jwt off) and reaches the
// database through two service-role-only functions, regolith.srv_load and regolith.srv_save.
import { handle, HttpError, type SavePatch, type Store } from '../src/online/referee';
import type { PlayRequest } from '../src/online/protocol';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

// Prefer the new sb_secret_/sb_publishable_ keys (JSON maps by name); fall back to the legacy
// service_role/anon JWT keys, which Supabase retires at the end of 2026.
const named = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  try { const m = JSON.parse(v) as Record<string, string>; return m.default ?? Object.values(m)[0]; } catch { return undefined; }
};
const BASE = Deno.env.get('SUPABASE_URL')!;
const SERVICE = named(Deno.env.get('SUPABASE_SECRET_KEYS')) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = named(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')) ?? Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE;
// legacy keys are JWTs and also go in Authorization; new keys must only be sent as apikey
const isJwt = (k: string) => k.split('.').length === 3;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SERVICE, 'Content-Type': 'application/json', 'Content-Profile': 'regolith', 'Accept-Profile': 'regolith',
  };
  if (isJwt(SERVICE)) headers.Authorization = `Bearer ${SERVICE}`;
  const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

const store: Store = {
  load: (room) => rpc('srv_load', { p_room: room }),
  save: (room, version, p: SavePatch) => rpc('srv_save', {
    p_room: room, p_version: version, p_state: p.state, p_pending: p.pending, p_actions: p.actions, p_status: p.status,
    p_phase: p.phase, p_generation: p.generation, p_decider: p.decider, p_waiting: p.waiting, p_seats: p.seats,
  }),
};

async function userId(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sign in to play online');
  const res = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(401, 'Your sign-in has expired; sign in again');
  const user = (await res.json()) as { id?: string };
  if (!user.id) throw new HttpError(401, 'Sign in to play online');
  return user.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  try {
    const uid = await userId(req);
    const body = (await req.json()) as PlayRequest;
    return json(await handle(body, uid, store));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on the server' }, 500);
  }
});
