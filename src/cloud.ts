// Optional cloud saves on Supabase. When VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
// are not set (local dev, the single-file build), every export here quietly does nothing and
// the game stays local-only.
import { useEffect, useState } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from './engine/types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const cloudEnabled = !!(url && key);

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!cloudEnabled) throw new Error('Cloud saves are not configured');
  client ??= createClient(url!, key!, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

/** The signed-in session: undefined while loading, null when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(cloudEnabled ? undefined : null);
  useEffect(() => {
    if (!cloudEnabled) return;
    const c = sb();
    c.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = c.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

const here = () => `${window.location.origin}${window.location.pathname}`;

export async function sendSignInLink(email: string) {
  const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: here(), shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function verifyCode(email: string, token: string) {
  const { error } = await sb().auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await sb().auth.signOut();
}

export interface CloudSave { id: string; name: string; players: string; phase: string; generation: number; updated_at: string }

export async function listSaves(): Promise<CloudSave[]> {
  const { data, error } = await sb().schema('regolith').rpc('list_saves');
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudSave[];
}

export async function loadSave(id: string): Promise<GameState> {
  const { data, error } = await sb().schema('regolith').rpc('get_save', { p_id: id });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That save no longer exists');
  return data as GameState;
}

export async function putSave(id: string, s: GameState) {
  const players = s.players.map((p) => p.name).join(', ');
  const { error } = await sb().schema('regolith').rpc('put_save', {
    p_id: id, p_name: `Generation ${s.generation}`, p_players: players, p_phase: s.phase, p_generation: s.generation, p_state: s,
  });
  if (error) throw new Error(error.message);
}

export async function deleteSave(id: string) {
  const { error } = await sb().schema('regolith').rpc('delete_save', { p_id: id });
  if (error) throw new Error(error.message);
}

// Which cloud save the game on this device belongs to.
const ID_KEY = 'regolith-cloud-id';
export function currentCloudId(): string {
  try {
    const id = localStorage.getItem(ID_KEY);
    if (id) return id;
  } catch { /* storage unavailable */ }
  return startNewCloudId();
}
export function setCloudId(id: string) {
  try { localStorage.setItem(ID_KEY, id); } catch { /* storage unavailable */ }
}
export function startNewCloudId(): string {
  const id = crypto.randomUUID();
  setCloudId(id);
  return id;
}
