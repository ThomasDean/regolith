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
export function sb(): SupabaseClient {
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

/** Where to come back to after Google: this page, keeping ?join=CODE but not old auth params. */
function returnUrl(): string {
  const q = new URLSearchParams(window.location.search);
  for (const k of [...q.keys()]) if (k !== 'join') q.delete(k);
  const qs = q.toString();
  return `${here()}${qs ? `?${qs}` : ''}`;
}

/**
 * Sign in with Google. A guest (anonymous) session is upgraded in place with linkIdentity, so
 * the same user keeps their saves and online games; anyone else gets an ordinary Google sign-in.
 * Both leave the page for Google and come back to it.
 */
export async function signInWithGoogle(opts: { switchAccount?: boolean } = {}) {
  const c = sb();
  const { data } = await c.auth.getSession();
  const guest = !!data.session?.user.is_anonymous;
  const options = { redirectTo: returnUrl(), queryParams: { prompt: 'select_account' } };
  if (guest && !opts.switchAccount) {
    const { error } = await c.auth.linkIdentity({ provider: 'google', options });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await c.auth.signInWithOAuth({ provider: 'google', options });
  if (error) throw new Error(error.message);
}

export type AuthReturnError = 'already-linked' | 'other';

/**
 * Reads an error Supabase put on the URL after a Google round trip, then tidies the URL. The
 * common one: that Google account already belongs to another Regolith user, so it can't be
 * attached to this guest.
 */
export function takeAuthReturnError(): { kind: AuthReturnError; message: string } | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const code = q.get('error_code') ?? h.get('error_code');
    const desc = q.get('error_description') ?? h.get('error_description');
    if (!code && !desc && !q.get('error') && !h.get('error')) return null;
    history.replaceState(null, '', returnUrl());
    const kind: AuthReturnError = code === 'identity_already_exists' || /already.*(linked|exists)/i.test(desc ?? '') ? 'already-linked' : 'other';
    return { kind, message: desc ?? code ?? 'Sign-in did not complete' };
  } catch { return null; }
}

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
