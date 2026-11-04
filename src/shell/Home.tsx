// The hub: every game you have going (yours to move first), and the games you can start.
import { useEffect } from 'react';
import { useSession } from '../cloud';
import { onlineEnabled } from '../online/client';
import { nextGame, useActiveGames, type ActiveGame } from './active';
import { GAME_INFO, GAME_LIST, type GameId } from './gameInfo';
import { navigate } from './route';
import { regolithSaves } from '../ui/saves';
import { fathomSaves } from '../fathom/saves';

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(ms).toLocaleDateString();
};

export function Home() {
  const session = useSession();
  const { games, loaded } = useActiveGames(session?.user.id);
  const next = nextGame(games, null);
  const waiting = games.filter((g) => g.yourMove && !g.lobby).length;
  useEffect(() => { document.title = 'Board games'; }, []);

  return (
    <div className="hub">
      <header className="hub-head">
        <HubMark />
        <div>
          <h1>Board games</h1>
          <p className="lede">Pass-and-play at one table, or online with friends. CPU opponents fill any empty seat.</p>
        </div>
      </header>

      <section className="hub-section" aria-labelledby="yours-h">
        <div className="hub-section-head">
          <h2 id="yours-h">Your games{games.length > 0 && <span className="muted"> · {games.length}</span>}</h2>
          {next && (
            <button type="button" className="btn" onClick={() => navigate(next.href)}>
              Play next{waiting > 1 ? ` (${waiting} waiting)` : ''} ›
            </button>
          )}
        </div>
        {games.length === 0 ? (
          <p className="muted hub-empty">{session && !loaded ? 'Looking for your games…' : 'Nothing in progress. Start a game below.'}</p>
        ) : (
          <ul className="active-list">
            {games.map((g) => <ActiveRow key={g.key} g={g} />)}
          </ul>
        )}
        {onlineEnabled && session === null && (
          <p className="muted small-print">Online games show up here once you’ve signed in or joined one as a guest (in Regolith’s menu).</p>
        )}
      </section>

      <section className="hub-section" aria-labelledby="start-h">
        <h2 id="start-h">Start a game</h2>
        <div className="game-tiles">
          {GAME_LIST.map((g) => (
            <article key={g.id} className={`game-tile tile-${g.id}`}>
              <button type="button" className="tile-hit" onClick={() => navigate(g.path)} aria-label={`Open ${g.name}`}>
                <TileArt id={g.id} />
              </button>
              <div className="tile-body">
                <h3>{g.name}</h3>
                <p className="tile-kind">Plays like {g.kind}</p>
                <p>{g.blurb}</p>
                <p className="tile-meta muted">{g.players} players · {g.minutes} min · {g.online ? 'hotseat or online' : 'hotseat'} · CPU opponents</p>
                <button type="button" className="btn" onClick={() => navigate(g.path)}>Play {g.name}</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActiveRow({ g }: { g: ActiveGame }) {
  const info = GAME_INFO[g.game];
  const remove = g.kind === 'local' ? () => {
    if (!confirm(`Delete this ${info.name} game from this device?`)) return;
    const id = new URLSearchParams(g.href.split('?')[1]).get('local')!;
    (g.game === 'regolith' ? regolithSaves : fathomSaves).remove(id);
  } : null;
  return (
    <li className={`active-row game-${g.game}`} data-yours={g.yourMove ? 'yes' : undefined}>
      <span className="active-icon" aria-hidden="true"><MiniMark id={g.game} /></span>
      <div className="active-info">
        <b>{info.name} · {g.title}{g.yourMove && !g.lobby && <span className="badge your-move">Your move</span>}{!g.yourMove && !g.lobby && <span className="badge">Waiting on others</span>}</b>
        <span className="muted">{g.players} · {g.kind === 'local' ? 'on this device' : 'online'} · {ago(g.updated)}</span>
      </div>
      <span className="save-actions">
        <button type="button" className="btn small" onClick={() => navigate(g.href)}>{g.yourMove && !g.lobby ? 'Play' : 'Open'}</button>
        {remove && <button type="button" className="icon-btn" aria-label={`Delete this ${info.name} game`} title="Delete from this device" onClick={remove}>×</button>}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- art (drawn here, no images)

function HubMark() {
  return (
    <svg className="hub-mark" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#26344f" stroke="#c79a62" strokeWidth="2.5" />
      <path d="M7 36c8-6 14 6 25 0s17-6 25 0v10.5L32 61 7 46.5Z" fill="#2a7f9e" />
      <circle cx="32" cy="24" r="9" fill="#c4472f" />
      <path d="M23.5 22c4 2 13 2 17-1" stroke="#e59a6f" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

export function MiniMark({ id }: { id: GameId }) {
  return id === 'regolith' ? (
    <svg viewBox="0 0 32 32" width="32" height="32"><polygon points="16,2 29,9.5 29,22.5 16,30 3,22.5 3,9.5" fill="#c79a62" stroke="#1d2840" strokeWidth="2" /><circle cx="16" cy="16" r="6" fill="#c4472f" /></svg>
  ) : (
    <svg viewBox="0 0 32 32" width="32" height="32"><rect x="2" y="2" width="28" height="28" rx="7" fill="#123a52" /><path d="M2 14c5-3 9 3 14 0s9-3 14 0v16H2Z" fill="#0b2233" /><path d="M8 19c3-3 8-3 11 0-3 3-8 3-11 0Zm11 0 5-3v6Z" fill="#7fd1c7" /></svg>
  );
}

function TileArt({ id }: { id: GameId }) {
  if (id === 'regolith') {
    return (
      <svg viewBox="0 0 320 160" className="tile-art" aria-hidden="true">
        <defs>
          <radialGradient id="tr-planet" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#e07a4f" /><stop offset="0.6" stopColor="#b5452c" /><stop offset="1" stopColor="#5e1f19" /></radialGradient>
          <linearGradient id="tr-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#101828" /><stop offset="1" stopColor="#1d2840" /></linearGradient>
        </defs>
        <rect width="320" height="160" fill="url(#tr-sky)" />
        {[[30, 20], [70, 120], [280, 30], [250, 130], [150, 14], [300, 90], [18, 90]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? 1 : 1.6} fill="#ece5d8" opacity="0.7" />)}
        <circle cx="160" cy="92" r="64" fill="url(#tr-planet)" />
        <path d="M108 70c18 8 40 4 58-3s38-4 50 6" stroke="#f0a37a" strokeWidth="3" fill="none" opacity="0.5" />
        <path d="M118 112c14-6 28 2 44-2s30-10 42-2" stroke="#3e7bb6" strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.85" />
        <circle cx="136" cy="86" r="6" fill="#5f9d50" /><circle cx="148" cy="92" r="5" fill="#5f9d50" /><circle cx="190" cy="78" r="5" fill="#5f9d50" />
        <polygon points="176,96 184,91 192,96 192,105 184,110 176,105" fill="#ece5d8" stroke="#1d2840" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 160" className="tile-art" aria-hidden="true">
      <defs>
        <linearGradient id="tf-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3aa6b9" /><stop offset="0.38" stopColor="#1c5f7f" /><stop offset="0.7" stopColor="#12344f" /><stop offset="1" stopColor="#070f1d" /></linearGradient>
      </defs>
      <rect width="320" height="160" fill="url(#tf-sea)" />
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M${-20 + i * 90} 0 L${30 + i * 90} 0 L${-40 + i * 90} 120Z`} fill="#fff" opacity="0.05" />)}
      <path d="M40 160c4-30-6-50 2-80 4 30 10 50 4 80Zm18 0c2-24 10-40 4-62-8 20-6 40-4 62Z" fill="#2f7d4d" opacity="0.9" />
      <g transform="translate(150 48)"><path d="M0 0c14-12 38-12 52 0-14 12-38 12-52 0Zm52 0 14-9v18Z" fill="#f2b84b" /><circle cx="10" cy="-2" r="2" fill="#132" /></g>
      <g transform="translate(205 92) scale(-1 1)"><path d="M0 0c12-9 30-9 42 0-12 9-30 9-42 0Zm42 0 11-7v14Z" fill="#a77be0" /><circle cx="8" cy="-1.5" r="1.8" fill="#132" /></g>
      <g transform="translate(110 128)"><path d="M0 0c18-14 52-14 70 0-18 14-52 14-70 0Zm70 0 16-10v20Z" fill="#334c6b" /><circle cx="12" cy="-2" r="2.4" fill="#7fe8ff" /><path d="M10-8q-6-14 8-20" stroke="#7fe8ff" strokeWidth="1.4" fill="none" /><circle cx="18" cy="-28" r="2.5" fill="#bff6ff" /></g>
      {[[90, 40], [96, 50], [84, 54], [250, 60], [244, 70], [258, 72]].map(([x, y], i) => <path key={i} d={`M${x} ${y}c3-2 7-2 10 0-3 2-7 2-10 0Z`} fill="#dff3f0" opacity="0.8" />)}
      {[[60, 30, 3], [70, 22, 2], [230, 40, 2.5]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="none" stroke="#dff3f0" opacity="0.6" />)}
    </svg>
  );
}
