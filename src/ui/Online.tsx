// Online play: the menu panel (guest sign-in, join by code, your games), the lobby where
// friends gather before the host starts, and the screen that runs a game from server views.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, GameState, Level } from '../engine/types';
import { useSession } from '../cloud';
import {
  createRoom, joinCodeFromUrl, joinLink, joinRoom, leaveRoom, myRooms, onlineEnabled, play, saveName, savedName, setLastRoom, signInGuest,
  updateRoom, useRoom, type SeatDraft,
} from '../online/client';
import type { PlayReply, RoomRow, SeatKind } from '../online/protocol';
import { Game, type OnlineLink } from './Game';
import { LEVEL_LABEL, PLAYER_COLORS } from './format';

const CPU_NAMES = ['Vesta', 'Ceres', 'Pallas', 'Hygiea', 'Juno'];
const KIND_LABEL: Record<SeatKind, string> = { human: 'Player', open: 'Open for a friend', ...LEVEL_LABEL };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
};

// ---------------------------------------------------------------- menu panel

export function OnlinePanel({ onOpen }: { onOpen: (room: string) => void }) {
  const session = useSession();
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(() => joinCodeFromUrl() ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const uid = session?.user.id;

  useEffect(() => {
    if (!uid) return;
    myRooms().then(setRooms, () => setRooms([]));
  }, [uid]);

  if (!onlineEnabled || session === undefined) return null;
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const join = () => run(async () => {
    saveName(name.trim());
    if (!session) await signInGuest();
    const id = await joinRoom(code.trim(), name.trim());
    history.replaceState(null, '', window.location.pathname);
    onOpen(id);
  });
  const live = (rooms ?? []).filter((r) => r.status !== 'over' || Date.now() - new Date(r.updated_at).getTime() < 3 * 864e5);

  return (
    <section className="online" aria-labelledby="online-h">
      <h2 id="online-h">Play online</h2>
      <p className="muted">Host a game with the <b>Host online</b> button below, then send friends its code. Hands stay private; CPUs can fill any seat.</p>
      <form className="cloud-row online-join" onSubmit={(e) => { e.preventDefault(); join(); }}>
        <label className="sr-only" htmlFor="online-name">Your name</label>
        <input id="online-name" placeholder="Your name" maxLength={16} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="online-code">Game code</label>
        <input id="online-code" className="code-input" placeholder="CODE" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
        <button type="submit" className="btn small" disabled={busy || code.trim().length !== 6 || !name.trim()}>Join</button>
      </form>
      {!session && <p className="muted small-print">No account needed to join: you play as a guest on this device. Sign in above to pick up your games anywhere.</p>}
      {err && <p className="warn">{err}</p>}
      {live.length > 0 && (
        <ul className="save-list">
          {live.map((r) => {
            const mine = r.seats.findIndex((x) => x.user === uid);
            const yourMove = r.status === 'playing' && mine >= 0 && r.waiting.includes(mine);
            return (
              <li key={r.id}>
                <div className="save-info">
                  <b>{r.status === 'lobby' ? `Lobby ${r.code}` : r.status === 'over' ? 'Finished' : `Generation ${r.generation ?? 1}`}{yourMove && <span className="badge">Your move</span>}</b>
                  <span className="muted">{r.seats.map((x) => x.name).join(', ')} · {ago(r.updated_at)}</span>
                </div>
                <span className="save-actions"><button type="button" className="btn small" onClick={() => onOpen(r.id)}>Open</button></span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Host a room from the menu's player list. Seats marked Human (after yours) become open seats. */
export async function hostRoom(seats: { name: string; kind: 'human' | Level; color: string }[], corporateEra: boolean, signedIn: boolean): Promise<string> {
  if (!signedIn) await signInGuest();
  const drafts: SeatDraft[] = seats.map((x, i) => ({ kind: i === 0 ? 'human' : x.kind === 'human' ? 'open' : x.kind, name: i === 0 || x.kind !== 'human' ? x.name : '', color: x.color }));
  saveName(seats[0].name);
  return (await createRoom(drafts, corporateEra)).id;
}

// ---------------------------------------------------------------- one room

export function OnlineRoom({ id, onExit }: { id: string; onExit: () => void }) {
  const session = useSession();
  const row = useRoom(id);
  useEffect(() => setLastRoom(id), [id]);
  if (row === undefined || session === undefined) return <div className="online-screen"><p className="muted">Connecting…</p></div>;
  if (row === null || !session) {
    return (
      <div className="online-screen">
        <div className="menu-panel">
          <h2>That game is closed</h2>
          <p className="muted">The host closed it, or you’re signed in as someone else on this device.</p>
          <button type="button" className="btn" onClick={() => { setLastRoom(null); onExit(); }}>Back to menu</button>
        </div>
      </div>
    );
  }
  if (row.status === 'lobby') return <Lobby row={row} uid={session.user.id} onExit={onExit} />;
  return <OnlineGame row={row} onExit={onExit} />;
}

function Lobby({ row, uid, onExit }: { row: RoomRow; uid: string; onExit: () => void }) {
  const host = row.host === uid;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const seatsNow = (): SeatDraft[] => row.seats.map((x) => ({ kind: x.kind, name: x.name, color: x.color, user: x.user }));
  const setKind = (i: number, kind: SeatKind) => run(() => {
    const seats = seatsNow();
    const name = kind === 'open' ? '' : kind === 'human' ? seats[i].name : CPU_NAMES.find((n) => !seats.some((x) => x.name === n)) ?? `CPU ${i + 1}`;
    seats[i] = { ...seats[i], kind, name: seats[i].kind === kind ? seats[i].name : name, user: kind === 'human' ? seats[i].user : null };
    return updateRoom(row.id, seats, row.corporate_era);
  });
  const addSeat = () => run(() => {
    const seats = seatsNow();
    const color = PLAYER_COLORS.find((c) => !seats.some((x) => x.color === c)) ?? PLAYER_COLORS[seats.length];
    return updateRoom(row.id, [...seats, { kind: 'open', name: '', color }], row.corporate_era);
  });
  const removeSeat = (i: number) => run(() => updateRoom(row.id, seatsNow().filter((_, j) => j !== i), row.corporate_era));
  const open = row.seats.filter((x) => x.kind === 'open').length;
  const link = joinLink(row.code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  const leave = () => run(async () => { await leaveRoom(row.id); setLastRoom(null); onExit(); });

  return (
    <div className="online-screen">
      <div className="menu-panel lobby">
        <p className="eyebrow">Online game</p>
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

        <h2>Options</h2>
        {host ? (
          <label className="check"><input type="checkbox" checked={row.corporate_era} disabled={busy} onChange={(e) => run(() => updateRoom(row.id, seatsNow(), e.target.checked))} /> Corporate Era cards and corporations</label>
        ) : <p className="muted">{row.corporate_era ? 'Corporate Era cards and corporations.' : 'Base cards only.'}</p>}

        <div className="lobby-actions">
          {host ? (
            <button type="button" className="btn big" disabled={busy || open > 0} onClick={() => run(() => play({ op: 'start', room: row.id }))}>
              {open ? `Waiting for ${open} more` : 'Start game'}
            </button>
          ) : <p className="muted" role="status">Waiting for the host to start. This page updates by itself.</p>}
          <button type="button" className="btn ghost" disabled={busy} onClick={leave}>{host ? 'Close game' : 'Leave'}</button>
          <button type="button" className="btn ghost" onClick={onExit}>Menu</button>
        </div>
        {host && open > 0 && <p className="muted">Send the code or link to your friends, or switch empty seats to CPUs.</p>}
        {err && <p className="warn" role="alert">{err}</p>}
      </div>
    </div>
  );
}

function OnlineGame({ row, onExit }: { row: RoomRow; onExit: () => void }) {
  const session = useSession();
  const uid = session?.user.id ?? '';
  const [reply, setReply] = useState<PlayReply | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef(-1);
  const take = useCallback((r: PlayReply) => {
    if (r.room.version < latest.current) return;
    latest.current = r.room.version;
    setReply(r);
  }, []);
  const roomId = row.id;

  // fetch your view whenever the room moves past the one you have
  const inflight = useRef(false);
  useEffect(() => {
    if (row.version <= latest.current || inflight.current) return;
    inflight.current = true;
    play({ op: 'view', room: roomId }).then(take, (e) => setErr((e as Error).message)).finally(() => { inflight.current = false; });
  }, [row.version, roomId, take]);

  const send = useCallback(async (a: Action) => { take(await play({ op: 'act', room: roomId, action: a })); }, [roomId, take]);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advance = useCallback((version: number) => {
    play({ op: 'advance', room: roomId, version }).then(take, () => {
      // try once more shortly; a newer version from anyone else also moves things on
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => { if (latest.current === version) play({ op: 'advance', room: roomId, version }).then(take, () => {}); }, 3000);
    });
  }, [roomId, take]);
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);
  const setSeat = useCallback(async (seat: number, kind: 'human' | Level) => { take(await play({ op: 'seat', room: roomId, seat, kind })); }, [roomId, take]);

  if (!reply?.view) {
    return (
      <div className="online-screen">
        <div className="menu-panel">
          <p className="muted">{err ?? 'Loading the game…'}</p>
          {err && <button type="button" className="btn" onClick={onExit}>Back to menu</button>}
        </div>
      </div>
    );
  }
  const link: OnlineLink = {
    code: reply.room.code, seat: reply.seat, host: reply.room.host === uid, version: reply.room.version, view: reply.view as GameState,
    seats: reply.room.seats, waiting: reply.room.waiting, queued: reply.queued, send, advance, setSeat,
  };
  return <Game initial={reply.view} online={link} onExit={onExit} />;
}
