import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { GameState, Level } from '../engine/types';
import { createGame } from '../engine/game';
import { Board } from './Board';
import { Card } from './Card';
import { Game } from './Game';
import { CloudPanel } from './Cloud';
import { Gallery } from './Gallery';
import { currentCloudId, setCloudId, startNewCloudId, useSession } from '../cloud';
import { hostRoom, OnlinePanel, OnlineRoom } from './Online';
import { onlineEnabled } from '../online/client';
import { roomFromUrl } from '../pwa';
import { navigate, useLocation } from '../shell/route';
import { migrateLegacySave, regolithSaves } from './saves';
import { useLocalSaves } from '../shell/useLocalSaves';
import { PLAYER_COLORS, PLAYER_COLOR_NAMES } from './format';
import type { BoardId } from '../engine/board';
import { BoardPicker, ExpansionPicker, initialMA, MAPicker, maForBoard, type MAState } from './Setup';
import type { Expansions } from '../engine/types';

const EX_KEY = 'regolith-expansions';
const loadEx = (): Expansions => { try { return JSON.parse(localStorage.getItem(EX_KEY) ?? '{}') as Expansions; } catch { return {}; } };
const saveEx = (ex: Expansions) => { try { localStorage.setItem(EX_KEY, JSON.stringify(ex)); } catch { /* storage unavailable */ } };

type Seat = { name: string; kind: 'human' | Level; color: string };

const DEFAULT_SEATS: Seat[] = [
  { name: 'You', kind: 'human', color: PLAYER_COLORS[0] },
  { name: 'Vesta', kind: 'normal', color: PLAYER_COLORS[1] },
  { name: 'Ceres', kind: 'normal', color: PLAYER_COLORS[2] },
];
const OnlineSim = lazy(() => import('./OnlineSim').then((m) => ({ default: m.OnlineSim })));
const CPU_NAMES = ['Vesta', 'Ceres', 'Pallas', 'Hygiea', 'Juno'];
const FAN = ['comet', 'kelp-farming', 'fusion-power', 'birds', 'terraforming-ganymede'];

export function App() {
  const { params, hash } = useLocation();
  migrateLegacySave();
  const room = roomFromUrl(`/?${params.toString()}`);
  const local = params.get('local');
  const toMenu = useCallback(() => navigate('/regolith'), []);
  const openRoom = useCallback((id: string) => navigate(`/regolith?room=${id}`), []);
  const startLocal = useCallback((s: GameState, id = startNewCloudId()) => { regolithSaves.save(id, s); setCloudId(id); navigate(`/regolith?local=${id}`); }, []);
  useEffect(() => { document.title = 'Regolith'; }, []);
  if (import.meta.env.DEV && hash === '#online-sim') return <Suspense fallback={null}><OnlineSim /></Suspense>;
  if (room) return <OnlineRoom key={room} id={room} onExit={toMenu} />;
  if (hash === '#gallery') return <Gallery onExit={toMenu} />;
  if (local) return <LocalGame key={local} id={local} onExit={toMenu} />;
  return <Menu onStart={startLocal} onOnline={openRoom} onGallery={() => navigate('/regolith#gallery')} />;
}

/** A hotseat game saved on this device, opened by its id. */
function LocalGame({ id, onExit }: { id: string; onExit: () => void }) {
  const initial = useMemo(() => regolithSaves.load(id), [id]);
  useEffect(() => { if (initial) setCloudId(id); }, [id, initial]);
  if (!initial) {
    return (
      <div className="online-screen">
        <div className="menu-panel">
          <h2>That game isn’t on this device</h2>
          <p className="muted">It may have been started on another device or browser. Signed-in games can be resumed from Cloud saves.</p>
          <button type="button" className="btn" onClick={onExit}>Back to Regolith</button>
        </div>
      </div>
    );
  }
  return <Game initial={initial} saveId={id} onExit={onExit} />;
}

function Menu({ onStart, onOnline, onGallery }: { onStart: (s: GameState, id?: string) => void; onOnline: (room: string) => void; onGallery: () => void }) {
  const saved = useLocalSaves(regolithSaves).filter((x) => !x.over);
  const session = useSession();
  const [hosting, setHosting] = useState(false);
  const [hostErr, setHostErr] = useState<string | null>(null);
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
  const [corporateEra, setCorporateEra] = useState(true);
  const [seed, setSeed] = useState('');
  const [board, setBoard] = useState<BoardId>('tharsis');
  const [ex, setEx] = useState<Expansions>(loadEx);
  const [ma, setMA] = useState<MAState>(() => initialMA('tharsis', ex));
  const chooseBoard = (b: BoardId) => { setBoard(b); setMA((m) => maForBoard(m, b, ex)); };
  const chooseEx = (next: Expansions) => { setEx(next); saveEx(next); setMA((m) => maForBoard(m, board, next)); };
  const preview = useMemo(() => createGame([{ name: 'a', color: '#000', cpu: null }, { name: 'b', color: '#000', cpu: null }], { seed: 1, board }), [board]);
  const settings = { board, milestones: ma.sel.milestones, awards: ma.sel.awards, expansions: ex };
  const update = (i: number, patch: Partial<Seat>) => setSeats((x) => x.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSeat = () => setSeats((x) => {
    const color = PLAYER_COLORS.find((c) => !x.some((s) => s.color === c))!;
    const name = CPU_NAMES.find((n) => !x.some((s) => s.name === n)) ?? `Player ${x.length + 1}`;
    return [...x, { name, kind: 'normal', color }];
  });
  const names = seats.map((s) => s.name.trim());
  const valid = names.every(Boolean) && new Set(names).size === names.length;
  const start = () => {
    onStart(createGame(seats.map((s) => ({ name: s.name.trim(), color: s.color, cpu: s.kind === 'human' ? null : s.kind })), {
      corporateEra, seed: seed.trim() ? Number(seed) || hash(seed) : undefined, ...settings,
    }));
  };
  return (
    <div className="menu">
      <div className="menu-map" aria-hidden="true">
        <Board s={preview} />
        <div className="menu-fan">
          {FAN.map((id, i) => <div key={id} className="fan-card" style={{ ['--k' as string]: i - (FAN.length - 1) / 2 }}><Card id={id} compact still /></div>)}
        </div>
      </div>
      <div className="menu-panel">
        <h1>Regolith</h1>
        <p className="lede">Terraform Mars against friends on one device, or against CPU rivals that build engines of their own.</p>

        <p className="hub-back"><button type="button" className="linkish" onClick={() => navigate('/')}>← All games</button></p>
        {saved.length > 0 && (
          <section className="resume-list" aria-label="Games in progress on this device">
            {saved.map((g) => (
              <div className="resume" key={g.id}>
                <span>{g.title}: {g.players}.</span>
                <span className="save-actions">
                  <button type="button" className="btn" onClick={() => navigate(`/regolith?local=${g.id}`)}>Resume</button>
                  <button type="button" className="icon-btn" aria-label={`Delete the game with ${g.players}`} title="Delete this game from this device" onClick={() => { if (confirm('Delete this game from this device?')) regolithSaves.remove(g.id); }}>×</button>
                </span>
              </div>
            ))}
          </section>
        )}

        <CloudPanel onResume={(g) => onStart(g, currentCloudId())} />
        <OnlinePanel onOpen={onOnline} />

        <h2>Players</h2>
        <ol className="seats">
          {seats.map((s, i) => (
            <li key={i} className="seat" style={{ ['--pc' as string]: s.color }}>
              <label className="sr-only" htmlFor={`name-${i}`}>Player {i + 1} name</label>
              <input id={`name-${i}`} value={s.name} maxLength={16} onChange={(e) => update(i, { name: e.target.value })} />
              <label className="sr-only" htmlFor={`kind-${i}`}>Player {i + 1} controller</label>
              <select id={`kind-${i}`} value={s.kind} onChange={(e) => update(i, { kind: e.target.value as Seat['kind'] })}>
                <option value="human">Human</option>
                <option value="easy">Easy CPU</option>
                <option value="normal">Normal CPU</option>
                <option value="hard">Hard CPU</option>
              </select>
              <label className="sr-only" htmlFor={`color-${i}`}>Player {i + 1} color</label>
              <select id={`color-${i}`} value={s.color} onChange={(e) => update(i, { color: e.target.value })} className="color-select">
                {PLAYER_COLORS.map((c, j) => <option key={c} value={c} disabled={seats.some((o, k) => k !== i && o.color === c)}>{PLAYER_COLOR_NAMES[j]}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} disabled={seats.length <= 2} onClick={() => setSeats((x) => x.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn ghost small" disabled={seats.length >= 5} onClick={addSeat}>Add player</button>

        <div className="cpu-notes">
          <p><b>Easy</b> plays loosely and ignores you. <b>Normal</b> builds around its tags and discounts. <b>Hard</b> also watches the leader, races milestones and awards, and plans two actions ahead.</p>
        </div>

        <h2>Expansions</h2>
        <ExpansionPicker ex={ex} onChange={chooseEx} />

        <h2>Map</h2>
        <BoardPicker board={board} onChange={chooseBoard} />

        <h2>Milestones and awards</h2>
        <MAPicker board={board} st={ma} set={setMA} ex={ex} />

        <h2>Options</h2>
        <label className="check"><input type="checkbox" checked={corporateEra} onChange={(e) => setCorporateEra(e.target.checked)} /> Corporate Era cards and corporations (recommended)</label>
        <details className="seed">
          <summary>Seed</summary>
          <label>Use a seed to replay the same deal <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" /></label>
        </details>

        <div className="start-row">
          <button type="button" className="btn big" disabled={!valid} onClick={start}>Start game</button>
          {onlineEnabled && (
            <button type="button" className="btn big ghost" disabled={!valid || hosting || seats[0].kind !== 'human'}
              title="Other Human seats become open seats for friends to join"
              onClick={async () => {
                setHosting(true); setHostErr(null);
                try { onOnline(await hostRoom(seats.map((x) => ({ ...x, name: x.name.trim() })), corporateEra, !!session, settings)); }
                catch (e) { setHostErr((e as Error).message); }
                finally { setHosting(false); }
              }}>
              {hosting ? 'Opening…' : 'Host online'}
            </button>
          )}
        </div>
        {!valid && <p className="warn">Give every player a different name.</p>}
        {onlineEnabled && valid && seats[0].kind !== 'human' && <p className="muted">To host online, make the first seat yours (Human).</p>}
        {onlineEnabled && <p className="muted small-print">Online: the first seat is you; other Human seats are left open for friends, who join with the game’s code.</p>}
        {hostErr && <p className="warn" role="alert">{hostErr}</p>}
        <p className="gallery-link"><button type="button" className="linkish" onClick={onGallery}>Browse all card art</button></p>
      </div>
    </div>
  );
}

const hash = (t: string) => [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
