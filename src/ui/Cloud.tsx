// Menu panel for cloud saves: sign in with Google (or an emailed link), then resume or delete
// saved games. Guests can upgrade to Google without losing their saves or online games.
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { GameState } from '../engine/types';
import {
  cloudEnabled, deleteSave, listSaves, loadSave, sendSignInLink, setCloudId, signInWithGoogle, signOut, takeAuthReturnError,
  useSession, verifyCode, type CloudSave,
} from '../cloud';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

// Read once per page load, before React renders twice in dev.
const returnError = cloudEnabled ? takeAuthReturnError() : null;

export function CloudPanel({ onResume }: { onResume: (s: GameState) => void }) {
  const session = useSession();
  const [notice, setNotice] = useState(returnError);
  if (!cloudEnabled || session === undefined) return null;
  const guest = !!session?.user.is_anonymous;
  const linkClash = notice?.kind === 'already-linked' && guest;
  return (
    <section className="cloud" aria-labelledby="cloud-h">
      <h2 id="cloud-h">Cloud saves</h2>
      {notice && <ReturnNotice guest={guest} kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />}
      {!session && <SignIn />}
      {session && guest && !linkClash && <GuestUpgrade />}
      {session && <Saves session={session} onResume={onResume} />}
    </section>
  );
}

function GoogleButton({ label, switchAccount }: { label: string; switchAccount?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await signInWithGoogle({ switchAccount }); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn google-btn" onClick={go} disabled={busy}>
        <GoogleMark />
        <span>{busy ? 'Opening Google…' : label}</span>
      </button>
      {err && <p className="warn">{err}</p>}
    </>
  );
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function ReturnNotice({ guest, kind, message, onDismiss }: { guest: boolean; kind: 'already-linked' | 'other'; message: string; onDismiss: () => void }) {
  if (kind === 'already-linked' && guest) {
    return (
      <div className="cloud-form notice" role="alert">
        <p>That Google account already has Regolith games of its own, so it can’t be attached to this guest.</p>
        <p className="muted">Sign in to it to see those games. Games you played as a guest stay with this device’s guest and won’t follow you.</p>
        <div className="cloud-row">
          <GoogleButton label="Sign in to that account" switchAccount />
          <button type="button" className="btn ghost small" onClick={onDismiss}>Stay a guest</button>
        </div>
      </div>
    );
  }
  return <p className="warn" role="alert">Google sign-in didn’t finish: {message}</p>;
}

function GuestUpgrade() {
  return (
    <div className="cloud-form">
      <p className="muted">You’re playing as a <b>guest</b> on this device. Sign in with Google to keep your saves and online games and pick them up anywhere.</p>
      <div className="cloud-row"><GoogleButton label="Sign in with Google" /></div>
    </div>
  );
}

function SignIn() {
  const [useEmail, setUseEmail] = useState(false);
  if (!useEmail) {
    return (
      <div className="cloud-form">
        <p className="muted">Sign in to keep your games in sync across devices. Games still save on this device either way.</p>
        <div className="cloud-row">
          <GoogleButton label="Sign in with Google" />
          <button type="button" className="linkish small-print" onClick={() => setUseEmail(true)}>Use email instead</button>
        </div>
      </div>
    );
  }
  return <EmailSignIn onBack={() => setUseEmail(false)} />;
}

function EmailSignIn({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (!sent) {
    return (
      <form className="cloud-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await sendSignInLink(email.trim()); setSent(true); }); }}>
        <div className="cloud-row">
          <label className="sr-only" htmlFor="cloud-email">Email</label>
          <input id="cloud-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn small" disabled={busy || !email.includes('@')}>Email me a sign-in link</button>
          <button type="button" className="btn ghost small" onClick={onBack}>Back</button>
        </div>
        {err && <p className="warn">{err}</p>}
      </form>
    );
  }
  return (
    <form className="cloud-form" onSubmit={(e) => { e.preventDefault(); run(() => verifyCode(email.trim(), code.trim())); }}>
      <p className="muted">Check your inbox at <b>{email}</b> and open the link on this device. If the email shows a 6-digit code instead, enter it here.</p>
      <div className="cloud-row">
        <label className="sr-only" htmlFor="cloud-code">Sign-in code</label>
        <input id="cloud-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className="btn small" disabled={busy || code.trim().length < 6}>Sign in</button>
        <button type="button" className="btn ghost small" onClick={() => { setSent(false); setCode(''); }}>Use another email</button>
      </div>
      {err && <p className="warn">{err}</p>}
    </form>
  );
}

function Saves({ session, onResume }: { session: Session; onResume: (s: GameState) => void }) {
  const [saves, setSaves] = useState<CloudSave[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = useCallback(() => { listSaves().then(setSaves, (e) => setErr((e as Error).message)); }, []);
  useEffect(refresh, [refresh, session.user.id]);
  const guest = !!session.user.is_anonymous;
  const meta = session.user.user_metadata as { full_name?: string; name?: string } | undefined;
  const who = meta?.full_name ?? meta?.name ?? session.user.email ?? 'you';

  const resume = async (id: string) => {
    try {
      const s = await loadSave(id);
      setCloudId(id);
      onResume(s);
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await deleteSave(id); setConfirm(null); refresh(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="cloud-saves">
      {!guest && (
        <p className="muted cloud-who">Signed in as <b>{who}</b>{session.user.email && who !== session.user.email ? ` (${session.user.email})` : ''} · <button type="button" className="linkish" onClick={() => signOut()}>Sign out</button></p>
      )}
      {saves === null && !err && <p className="muted">Loading saved games…</p>}
      {saves?.length === 0 && <p className="muted">No cloud saves yet. Games you play while signed in are saved here automatically.</p>}
      {saves && saves.length > 0 && (
        <ul className="save-list">
          {saves.map((sv) => (
            <li key={sv.id}>
              <div className="save-info">
                <b>{sv.phase === 'over' ? 'Finished' : `Generation ${sv.generation}`}</b>
                <span className="muted">{sv.players} · {ago(sv.updated_at)}</span>
              </div>
              {confirm === sv.id ? (
                <span className="save-actions">
                  <span className="muted">Delete this save?</span>
                  <button type="button" className="btn danger small" onClick={() => remove(sv.id)}>Delete</button>
                  <button type="button" className="btn ghost small" onClick={() => setConfirm(null)}>Keep</button>
                </span>
              ) : (
                <span className="save-actions">
                  <button type="button" className="btn small" onClick={() => resume(sv.id)}>{sv.phase === 'over' ? 'View' : 'Resume'}</button>
                  <button type="button" className="btn ghost small" onClick={() => setConfirm(sv.id)} aria-label={`Delete save from ${ago(sv.updated_at)}`}>Delete</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="warn">{err}</p>}
    </div>
  );
}
