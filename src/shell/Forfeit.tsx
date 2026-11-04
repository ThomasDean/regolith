// Confirming a forfeit. Shared by every game: the game says who may forfeit and what it means.
import { useState } from 'react';
import { Dialog } from '../ui/Dialog';

export interface ForfeitSeat { id: number; name: string }

export function ForfeitDialog({ seats, initial, consequence, onConfirm, onClose }: {
  /** who can forfeit from this screen (online: just you; hotseat: any human still playing) */
  seats: ForfeitSeat[];
  initial: number;
  /** what forfeiting this seat does, in a sentence */
  consequence: (id: number) => string;
  onConfirm: (id: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const [who, setWho] = useState(seats.some((x) => x.id === initial) ? initial : seats[0]?.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = seats.find((x) => x.id === who)?.name ?? '';
  const confirm = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(who); onClose(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog title="Forfeit this game?" onClose={busy ? undefined : onClose} footer={(
      <>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Keep playing</button>
        <button type="button" className="btn danger" disabled={busy || who === undefined} onClick={confirm}>{busy ? 'Forfeiting…' : `Forfeit${seats.length > 1 ? ` as ${name}` : ''}`}</button>
      </>
    )}>
      {seats.length > 1 && (
        <fieldset className="plain forfeit-who">
          <legend>Who is forfeiting?</legend>
          {seats.map((x) => (
            <label key={x.id} className="check"><input type="radio" name="forfeit-who" checked={who === x.id} onChange={() => setWho(x.id)} /> {x.name}</label>
          ))}
        </fieldset>
      )}
      <p>{consequence(who)}</p>
      <p className="muted">This can’t be undone.</p>
      {err && <p className="warn" role="alert">{err}</p>}
    </Dialog>
  );
}

/** The usual wording, for games where a forfeited seat is played out by a Normal CPU. */
export function forfeitText(players: { id: number; name: string; cpu: unknown; forfeited?: boolean }[], id: number, you: boolean): string {
  const left = players.filter((p) => !p.forfeited && p.id !== id);
  const subject = you ? 'You' : players.find((p) => p.id === id)?.name ?? 'They';
  if (left.length === 1) return `${subject} will finish last and the game ends now: ${left[0].name} wins.`;
  if (!left.some((p) => !p.cpu)) return `${subject} will finish last, and with no human players left the game ends now.`;
  return `A Normal CPU plays out ${you ? 'your' : `${subject}’s`} seat so the others can finish, and ${you ? 'you finish' : `${subject} finishes`} last whatever the score.`;
}
