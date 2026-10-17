// Menu panel for cloud saves: sign in with an emailed link, then resume or delete saved games.
import { useCallback, useEffect, useState } from 'react';
import type { GameState } from '../engine/types';
import {
  cloudEnabled, deleteSave, listSaves, loadSave, sendSignInLink, setCloudId, signOut, useSession, verifyCode, type CloudSave,
} from '../cloud';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

export function CloudPanel({ onResume }: { onResume: (s: GameState) => void }) {
  const session = useSession();
  if (!cloudEnabled || session === undefined) return null;
  return (
    <section className="cloud" aria-labelledby="cloud-h">
      <h2 id="cloud-h">Cloud saves</h2>
      {session ? <Saves email={session.user.email ?? 'you'} onResume={onResume} /> : <SignIn />}
    </section>
  );
}

function SignIn() {
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
        <p className="muted">Sign in to keep your games in sync across devices. Games still save on this device either way.</p>
        <div className="cloud-row">
          <label className="sr-only" htmlFor="cloud-email">Email</label>
          <input id="cloud-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn small" disabled={busy || !email.includes('@')}>Email me a sign-in link</button>
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

function Saves({ email, onResume }: { email: string; onResume: (s: GameState) => void }) {
  const [saves, setSaves] = useState<CloudSave[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = useCallback(() => { listSaves().then(setSaves, (e) => setErr((e as Error).message)); }, []);
  useEffect(refresh, [refresh]);

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
      <p className="muted cloud-who">Signed in as <b>{email}</b> · <button type="button" className="linkish" onClick={() => signOut()}>Sign out</button></p>
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
