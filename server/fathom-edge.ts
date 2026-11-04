// Supabase Edge Function "fathom-play": the referee for online Fathom games, wrapped for Deno.
// Bundled into supabase/functions/fathom-play/index.js by `npm run build:edge`. Rooms live in
// the fathom schema (fathom.srv_load / fathom.srv_save); push devices are shared with Regolith.
import { handle, type FSavePatch, type FStore } from '../src/fathom/online/referee';
import type { FPlayRequest } from '../src/fathom/online/protocol';
import { notify, rpc, serve, VAPID } from './common';

const store: FStore = {
  ...(VAPID ? { notify } : {}),
  load: (room) => rpc('srv_load', { p_room: room }, 'fathom'),
  save: (room, version, p: FSavePatch) => rpc('srv_save', {
    p_room: room, p_version: version, p_state: p.state, p_actions: p.actions, p_status: p.status,
    p_phase: p.phase, p_tide: p.tide, p_decider: p.decider, p_waiting: p.waiting, p_seats: p.seats,
  }, 'fathom'),
};

serve((body, uid) => handle(body as FPlayRequest, uid, store));
