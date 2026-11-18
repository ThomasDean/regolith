import { useEffect, useRef, useState } from 'react';
import type { GameState, LogEntry, LogFx, Res } from '../engine/types';
import { RESOURCES } from '../engine/types';
import { CARDS } from '../engine/cards';
import { ResIcon, TrIcon } from './Icons';
import { resLabel, signed } from './format';

const who = (s: GameState, pid: number, viewer: number | null) => (pid === viewer && !s.players[pid].cpu ? 'You' : s.players[pid].name);

/** What one log entry changed, as small chips grouped by player. */
export function FxChips({ s, fx, viewer, actor }: { s: GameState; fx: LogFx; viewer: number | null; actor: number | null }) {
  const params: string[] = [];
  if (fx.temp) params.push(`${signed(fx.temp)}°C`);
  if (fx.oxy) params.push(`${signed(fx.oxy)}% O₂`);
  if (fx.ocean) params.push(`${signed(fx.ocean)} ocean${Math.abs(fx.ocean) === 1 ? '' : 's'}`);
  if (fx.venus) params.push(`${signed(fx.venus)}% Venus`);
  const players = (fx.p ?? []).filter((e) => e.res || e.prod || e.tr || e.cards);
  if (!players.length && !params.length) return null;
  return (
    <div className="fx-chips">
      {params.length > 0 && <span className="fx-group global">{params.map((t) => <span key={t} className="fx-chip">{t}</span>)}</span>}
      {players.map((e) => {
        const p = s.players[e.pid];
        const other = actor !== null && e.pid !== actor;
        return (
          <span key={e.pid} className={`fx-group ${other ? 'other' : ''}`} style={{ ['--pc' as string]: p.color }}>
            <span className="fx-who"><span className="swatch" aria-hidden="true" />{who(s, e.pid, viewer)}</span>
            {e.tr ? <span className={`fx-chip ${e.tr < 0 ? 'down' : 'up'}`}><TrIcon size={13} />{signed(e.tr)} TR</span> : null}
            {RESOURCES.filter((r) => e.res?.[r]).map((r: Res) => (
              <span key={r} className={`fx-chip ${e.res![r]! < 0 ? 'down' : 'up'}`} title={`${signed(e.res![r]!)} ${r === 'mc' ? 'M€' : r}`}><ResIcon r={r} size={13} />{signed(e.res![r]!)}</span>
            ))}
            {RESOURCES.filter((r) => e.prod?.[r]).map((r: Res) => (
              <span key={`p-${r}`} className={`fx-chip prod ${e.prod![r]! < 0 ? 'down' : 'up'}`} title={`${signed(e.prod![r]!)} ${r === 'mc' ? 'M€' : r} production`}><span className="prod-box"><ResIcon r={r} size={13} /></span>{signed(e.prod![r]!)}</span>
            ))}
            {Object.entries(e.cards ?? {}).map(([id, n]) => (
              <span key={id} className={`fx-chip ${n < 0 ? 'down' : 'up'}`}>{signed(n)} {resLabel(CARDS[id]?.resource ?? 'resource', Math.abs(n))} · {CARDS[id]?.name ?? id}</span>
            ))}
          </span>
        );
      })}
    </div>
  );
}

export function entryText(s: GameState, l: LogEntry, viewer: number | null): string {
  if (l.text) return l.text;
  if (l.pid !== null) return `${who(s, l.pid, viewer)}: effect resolved`;
  return '';
}

/**
 * The game log, tucked behind a button in the bottom-right corner. Each entry shows what it
 * changed: resources, production and TR for every player it touched.
 */
export function LogPanel({ s, viewer, onReplay, catchUp, onDismissCatchUp }: { s: GameState; viewer: number | null; onReplay?: () => void; catchUp: number; onDismissCatchUp?: () => void }) {
  const [open, setOpen] = useState(false);
  const latest = s.log[s.log.length - 1]?.n ?? s.log.length;
  const [seen, setSeen] = useState(latest);
  useEffect(() => { if (open) setSeen(latest); }, [open, latest]);
  const unread = open ? 0 : s.log.filter((l) => (l.n ?? 0) > seen && l.pid !== viewer).length;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const items = s.log.slice(-150).reverse();
  return (
    <>
      {open && (
        <div className="log-panel" role="dialog" aria-label="Game log" ref={panel} tabIndex={-1}>
          <header className="log-head">
            <h3>Log</h3>
            {onReplay && <button type="button" className="btn small" onClick={() => { setOpen(false); onReplay(); }}>Replay latest moves</button>}
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close log">×</button>
          </header>
          <ol className="log-list">
            {items.flatMap((l, i) => {
              const head = i === 0 || items[i - 1].gen !== l.gen
                ? [<li key={`g-${l.gen}-${l.n ?? i}`} className="log-gen" aria-hidden="true">Generation {l.gen}</li>] : [];
              return [...head, (
                <li key={l.n ?? s.log.length - i} className={l.pid === null ? 'sys' : ''} style={l.pid !== null ? { ['--pc' as string]: s.players[l.pid].color } : undefined}>
                  <span className="log-text">{entryText(s, l, viewer)}</span>
                  {l.fx && <FxChips s={s} fx={l.fx} viewer={viewer} actor={l.pid} />}
                </li>
              )];
            })}
          </ol>
        </div>
      )}
      <div className="log-dock">
        {catchUp > 0 && onReplay && !open && (
          <span className="catchup">
            <button type="button" className="btn small" onClick={onReplay}>Replay {catchUp} move{catchUp === 1 ? '' : 's'} you missed</button>
            {onDismissCatchUp && <button type="button" className="icon-btn" onClick={onDismissCatchUp} aria-label="Dismiss">×</button>}
          </span>
        )}
        <button type="button" className={`log-fab ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Game log${unread ? `, ${unread} new` : ''}`} title="Game log">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 3h9l4 4v14H6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 10h7M9 13.5h7M9 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          {unread > 0 && <span className="log-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </div>
    </>
  );
}
