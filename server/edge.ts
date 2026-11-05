// Supabase Edge Function "regolith-play": the referee for online Regolith games, wrapped for
// Deno. `npm run build:edge` bundles this with the rules engine into
// supabase/functions/regolith-play/index.js; `npm run deploy:edge` builds and deploys it.
//
// It checks the caller's sign-in itself (so it deploys with verify_jwt off) and reaches the
// database through two service-role-only functions, regolith.srv_load and regolith.srv_save.
import { handle, type SavePatch, type Store } from '../src/online/referee';
import type { PlayRequest } from '../src/online/protocol';
import { notify, rpc, serve, VAPID } from './common';

const store: Store = {
  ...(VAPID ? { notify } : {}),
  load: (room) => rpc('srv_load', { p_room: room }),
  save: (room, version, p: SavePatch) => rpc('srv_save', {
    p_room: room, p_version: version, p_state: p.state, p_pending: p.pending, p_actions: p.actions, p_status: p.status,
    p_phase: p.phase, p_generation: p.generation, p_decider: p.decider, p_waiting: p.waiting, p_seats: p.seats,
  }),
};

serve((body, uid) => handle(body as PlayRequest, uid, store));
