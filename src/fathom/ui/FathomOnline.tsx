// Online Fathom: the menu panel (sign in or play as a guest, join by code, your games), the
// lobby where friends gather, and the screen that runs a game from the server's views.
import { useCallback, useEffect, useRef, useState } from 'react';
import { signInWithGoogle, useSession } from '../../cloud';
import { onlineEnabled, signInGuest } from '../../shell/rooms';
import { roomWaitsOn } from '../../shell/rooms';
import { navigate } from '../../shell/route';
import { PushToggle } from '../../shell/PushToggle';
import { refreshBadge } from '../../pwa';
import { PLAYER_COLORS } from '../../ui/format';
import type { FAction, Level } from '../engine/types';
import { GOALS, CLASSIC_GOALS } from '../engine/game';
import { createFathomRoom, fathomJoinLink, fathomRooms, playFathom, updateFathomRoom, type FSeatDraft } from '../online/client';
import type { FPlayReply, FRoomRow, SeatKind } from '../online/protocol';
import { FathomGame, type FathomOnline } from './FathomApp';

const NAME_KEY = 'regolith-online-name'; // one name for every game
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const saveName = (n: string) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* fine */ } };
const CPU_NAMES = ['Marina', 'Coral', 'Brook', 'Pearl', 'Reed'];
const KIND_LABEL: Record<SeatKind, string> = { human: 'Player', open: 'Open for a friend', easy: 'Easy CPU', normal: 'Normal CPU', hard: 'Hard CPU' };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
};

export const joinCodeFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get('join')?.toUpperCase() ?? null; } catch { return null; }
};

// ---------------------------------------------------------------- menu panel

export function FathomOnlinePanel() {
  const session = useSession();
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(() => joinCodeFromUrl() ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rooms, setRooms] = useState<FRoomRow[] | null>(null);
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) return;
    fathomRooms.myRooms().then(setRooms, (e) => { setRooms([]); setErr((e as Error).message); });
  }, [uid]);
  if (!onlineEnabled || session === undefined) return null;
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const join = () => run(async () => {
    saveName(name.trim());
    if (!session) await signInGuest();
    const id = await fathomRooms.joinRoom(code.trim(), name.trim());
    navigate(`/fathom?room=${id}`);
  });
  const live = (rooms ?? []).filter((r) => (r.status !== 'over' || Date.now() - new Date(r.updated_at).getTime() < 3 * 864e5) && !r.seats.find((x) => x.user === uid)?.forfeited);
  const who = session?.user.is_anonymous ? 'a guest on this device' : session?.user.email;

  return (
    <section className="online" aria-labelledby="fm-online-h">
      <h2 id="fm-online-h">Play online</h2>
      <p className="muted">Host with the <b>Host online</b> button below and send friends the code, or join a friend’s game here. CPUs can fill any seat.</p>
      {session ? (
        <p className="muted small-print">Playing as {who}.{session.user.is_anonymous && <> <button type="button" className="linkish" onClick={() => run(() => signInWithGoogle())}>Sign in with Google</button> to keep your games on every device.</>}</p>
      ) : (
        <div className="cloud-row"><button type="button" className="btn small ghost" disabled={busy} onClick={() => run(() => signInWithGoogle())}>Sign in with Google</button><span className="muted small-print">or just join as a guest</span></div>
      )}
      <form className="cloud-row online-join" onSubmit={(e) => { e.preventDefault(); join(); }}>
        <label className="sr-only" htmlFor="fm-online-name">Your name</label>
        <input id="fm-online-name" placeholder="Your name" maxLength={16} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="fm-online-code">Game code</label>
        <input id="fm-online-code" className="code-input" placeholder="CODE" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
        <button type="submit" className="btn small" disabled={busy || code.trim().length !== 6 || !name.trim()}>Join</button>
      </form>
      {err && <p className="warn">{err}</p>}
      {session && <PushToggle />}
      {live.length > 0 && (
        <ul className="save-list">
          {live.map((r) => (
            <li key={r.id}>
              <div className="save-info">
                <b>{r.status === 'lobby' ? `Lobby ${r.code}` : r.status === 'over' ? 'Finished' : `Tide ${r.tide ?? 1}`}{uid && roomWaitsOn(r, uid) && <span className="badge your-move">Your move</span>}</b>
                <span className="muted">{r.seats.map((x) => x.name || 'open seat').join(', ')} · {ago(r.updated_at)}</span>
              </div>
              <span className="save-actions"><button type="button" className="btn small" onClick={() => navigate(`/fathom?room=${r.id}`)}>Open</button></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Host from the menu's player list: seat 0 is you, other Human seats are left open for friends. */
export async function hostFathom(seats: { name: string; kind: 'human' | Level; color: string }[], variable: boolean, signedIn: boolean): Promise<string> {
  if (!signedIn) await signInGuest();
  const drafts: FSeatDraft[] = seats.map((x, i) => ({ kind: i === 0 ? 'human' : x.kind === 'human' ? 'open' : x.kind, name: i === 0 || x.kind !== 'human' ? x.name : '', color: x.color }));
  saveName(seats[0].name);
  return (await createFathomRoom(drafts, { variable })).id;
}

// ---------------------------------------------------------------- one room

export function FathomRoom({ id }: { id: string }) {
  const session = useSession();
  const row = fathomRooms.useRoom(id);
  if (row === undefined || session === undefined) return <div className="fathom fm-screen"><p className="muted">Connecting…</p></div>;
  if (row === null || !session) {
    return (
      <div className="fathom fm-screen">
        <div className="fm-panel">
          <h2>That game is closed</h2>
          <p className="muted">The host closed it, or you’re signed in as someone else on this device.</p>
          <button type="button" className="btn" onClick={() => navigate('/fathom')}>Back to Fathom</button>
        </div>
      </div>
    );
  }
  if (row.status === 'lobby') return <Lobby row={row} uid={session.user.id} />;
  return <OnlineGame row={row} uid={session.user.id} />;
}

function Lobby({ row, uid }: { row: FRoomRow; uid: string }) {
  const host = row.host === uid;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const seatsNow = (): FSeatDraft[] => row.seats.map((x) => ({ kind: x.kind, name: x.name, color: x.color, user: x.user }));
  const setKind = (i: number, kind: SeatKind) => run(() => {
    const seats = seatsNow();
    const name = kind === 'open' ? '' : kind === 'human' ? seats[i].name : CPU_NAMES.find((n) => !seats.some((x) => x.name === n)) ?? `CPU ${i + 1}`;
    seats[i] = { ...seats[i], kind, name: seats[i].kind === kind ? seats[i].name : name, user: kind === 'human' ? seats[i].user : null };
    return updateFathomRoom(row.id, seats);
  });
  const addSeat = () => run(() => {
    const seats = seatsNow();
    const color = PLAYER_COLORS.find((c) => !seats.some((x) => x.color === c)) ?? PLAYER_COLORS[seats.length];
    return updateFathomRoom(row.id, [...seats, { kind: 'open', name: '', color }]);
  });
  const removeSeat = (i: number) => run(() => updateFathomRoom(row.id, seatsNow().filter((_, j) => j !== i)));
  const open = row.seats.filter((x) => x.kind === 'open').length;
  const link = fathomJoinLink(row.code);
  const variable = row.settings?.variable === true;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  const leave = () => run(async () => { await fathomRooms.leaveRoom(row.id); navigate('/fathom'); });

  return (
    <div className="fathom fm-screen">
      <div className="fm-panel lobby">
        <p className="eyebrow">Online game of Fathom</p>
        <h1 className="lobby-code" aria-label={`Game code ${row.code.split('').join(' ')}`}>{row.code}</h1>
        <div className="lobby-share">
          <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn small" onClick={copy}>{copied ? 'Copied' : 'Copy invite link'}</button>
        </div>

        <h2>Seats</h2>
        <ol className="online-seats">
          {row.seats.map((x, i) => (
            <li key={i} style={{ ['--pc' as string]: x.color || PLAYER_COLORS[i] }} data-open={x.kind === 'open' ? 'yes' : undefined}>
              <span className="swatch" />
              <span className="seat-name">{x.kind === 'open' ? <span className="muted">Waiting for a friend…</span> : x.name}{x.user === uid && <span className="muted"> (you)</span>}{i === 0 && <span className="muted"> · host</span>}</span>
              {host && i > 0 ? (
                <>
                  <select value={x.kind} disabled={busy} onChange={(e) => setKind(i, e.target.value as SeatKind)} aria-label={`Seat ${i + 1}`}>
                    {x.user && <option value="human">{x.name}</option>}
                    <option value="open">Open for a friend</option>
                    <option value="easy">Easy CPU</option>
                    <option value="normal">Normal CPU</option>
                    <option value="hard">Hard CPU</option>
                  </select>
                  <button type="button" className="icon-btn" aria-label={`Remove seat ${i + 1}`} disabled={busy || row.seats.length <= 2} onClick={() => removeSeat(i)}>×</button>
                </>
              ) : <span className="muted seat-kind">{i === 0 ? '' : KIND_LABEL[x.kind]}</span>}
            </li>
          ))}
        </ol>
        {host && <button type="button" className="btn ghost small" disabled={busy || row.seats.length >= 5} onClick={addSeat}>Add seat</button>}

        <h2>Tide goals</h2>
        {host ? (
          <div className="fm-goal-pick" role="radiogroup" aria-label="Tide goals">
            <label className="check"><input type="radio" name="lobby-goals" checked={!variable} disabled={busy} onChange={() => run(() => updateFathomRoom(row.id, seatsNow(), { variable: false }))} /> <span><b>Classic:</b> {CLASSIC_GOALS.map((g) => GOALS[g].name).join(', ')}</span></label>
            <label className="check"><input type="radio" name="lobby-goals" checked={variable} disabled={busy} onChange={() => run(() => updateFathomRoom(row.id, seatsNow(), { variable: true }))} /> <span><b>Variable:</b> three drawn from nine, +3 to each tide’s leader</span></label>
          </div>
        ) : <p className="muted">{variable ? 'Variable goals: three drawn from nine, +3 to each tide’s leader.' : `Classic goals: ${CLASSIC_GOALS.map((g) => GOALS[g].name).join(', ')}.`}</p>}

        <div className="lobby-actions">
          {host ? (
            <button type="button" className="btn big" disabled={busy || open > 0} onClick={() => run(() => playFathom({ op: 'start', room: row.id }))}>
              {open ? `Waiting for ${open} more` : 'Start game'}
            </button>
          ) : <p className="muted" role="status">Waiting for the host to start. This page updates by itself.</p>}
          <button type="button" className="btn ghost" disabled={busy} onClick={leave}>{host ? 'Close game' : 'Leave'}</button>
          <button type="button" className="btn ghost" onClick={() => navigate('/fathom')}>Menu</button>
        </div>
        {host && open > 0 && <p className="muted">Send the code or link to your friends, or switch empty seats to CPUs.</p>}
        {err && <p className="warn" role="alert">{err}</p>}
      </div>
    </div>
  );
}

function OnlineGame({ row, uid }: { row: FRoomRow; uid: string }) {
  const [reply, setReply] = useState<FPlayReply | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef(-1);
  const take = useCallback((r: FPlayReply) => {
    if (r.room.version < latest.current) return;
    latest.current = r.room.version;
    setReply(r);
  }, []);
  const roomId = row.id;

  // fetch the view whenever the room moves past the one we have
  const inflight = useRef(false);
  useEffect(() => {
    if (row.version <= latest.current || inflight.current) return;
    inflight.current = true;
    playFathom({ op: 'view', room: roomId }).then(take, (e) => setErr((e as Error).message)).finally(() => { inflight.current = false; });
  }, [row.version, roomId, take]);

  const send = useCallback(async (a: FAction) => { take(await playFathom({ op: 'act', room: roomId, action: a })); }, [roomId, take]);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advance = useCallback((version: number) => {
    playFathom({ op: 'advance', room: roomId, version }).then(take, () => {
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => { if (latest.current === version) playFathom({ op: 'advance', room: roomId, version }).then(take, () => {}); }, 3000);
    });
  }, [roomId, take]);
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);
  const setSeat = useCallback(async (seat: number, kind: 'human' | Level) => { take(await playFathom({ op: 'seat', room: roomId, seat, kind })); }, [roomId, take]);
  const forfeit = useCallback(async () => { take(await playFathom({ op: 'forfeit', room: roomId })); }, [roomId, take]);

  const waitingKey = `${row.status}:${row.waiting.join(',')}`;
  useEffect(() => { refreshBadge(uid); }, [uid, waitingKey]);

  if (!reply?.view) {
    return (
      <div className="fathom fm-screen">
        <div className="fm-panel">
          <p className="muted">{err ?? 'Loading the game…'}</p>
          {err && <button type="button" className="btn" onClick={() => navigate('/fathom')}>Back to Fathom</button>}
        </div>
      </div>
    );
  }
  const link: FathomOnline = {
    room: roomId, code: reply.room.code, seat: reply.seat, host: reply.room.host === uid, version: reply.room.version, view: reply.view,
    seats: reply.room.seats, waiting: reply.room.waiting, send, advance, setSeat, forfeit,
  };
  return <FathomGame id={roomId} initial={reply.view} online={link} />;
}
