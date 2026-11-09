// Fathom: the menu (players, goals, games in progress) and the game screen.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './fathom.css';
import { FISH } from '../engine/cards';
import {
  applyAction, canAfford, createGame, decider as deciderOf, forfeit as forfeitState, GOALS, goalPoints, legalSlots, score, slotName, standings, whyNot,
} from '../engine/game';
import { autoPay, cpuAction } from '../engine/cpu';
import { DIVERS, SCHOOL_PTS, TIDES, type FAction, type FPrompt, type FState, type Level } from '../engine/types';
import { fathomSaves } from '../saves';
import { newId } from '../../shell/localSaves';
import { useLocalSaves } from '../../shell/useLocalSaves';
import { navigate, useLocation } from '../../shell/route';
import { NextGameButton } from '../../shell/NextGame';
import { ForfeitDialog, forfeitText } from '../../shell/Forfeit';
import { Dialog } from '../../ui/Dialog';
import { PLAYER_COLORS, PLAYER_COLOR_NAMES } from '../../ui/format';
import { FishCard, Egg, Fry, School, CardGlyph, EndGlyph } from './FishCard';
import { FishArt } from './FishArt';
import { Ocean } from './Ocean';
import type { SeatRow } from '../online/protocol';
import { FathomOnlinePanel, FathomRoom, hostFathom } from './FathomOnline';
import { CardHow, RulesGuide } from './Guide';
import { HandDock, HandSheet } from './HandSheet';
import { TideRecap } from './TideRecap';
import { GoalIcon } from './GoalArt';
import { onlineEnabled } from '../../shell/rooms';
import { useSession } from '../../cloud';

const OnlineSim = lazy(() => import('./FathomOnlineSim').then((m) => ({ default: m.FathomOnlineSim })));

const LEVEL_LABEL: Record<Level, string> = { easy: 'Easy CPU', normal: 'Normal CPU', hard: 'Hard CPU' };

export function FathomApp() {
  const { params, hash } = useLocation();
  const local = params.get('local');
  const room = params.get('room');
  useEffect(() => { document.title = 'Fathom'; }, []);
  if (import.meta.env.DEV && hash === '#online-sim') return <Suspense fallback={null}><OnlineSim /></Suspense>;
  if (room && onlineEnabled && /^[0-9a-f-]{36}$/i.test(room)) return <FathomRoom key={room} id={room} />;
  if (local) return <LocalGame key={local} id={local} />;
  return <Menu />;
}

function LocalGame({ id }: { id: string }) {
  const initial = useMemo(() => fathomSaves.load(id), [id]);
  if (!initial) {
    return (
      <div className="fathom fm-screen">
        <div className="fm-panel">
          <h2>That game isn’t on this device</h2>
          <p className="muted">Fathom games are saved in the browser they were played in.</p>
          <button type="button" className="btn" onClick={() => navigate('/fathom')}>Back to Fathom</button>
        </div>
      </div>
    );
  }
  return <FathomGame id={id} initial={initial} />;
}

// ---------------------------------------------------------------- menu

type Seat = { name: string; kind: 'human' | Level; color: string };
const CPU_NAMES = ['Marina', 'Coral', 'Brook', 'Pearl', 'Reed'];
const SEATS_KEY = 'fathom-seats';
const loadSeats = (): Seat[] => {
  try { const v = JSON.parse(localStorage.getItem(SEATS_KEY) ?? 'null'); if (Array.isArray(v) && v.length >= 1) return v as Seat[]; } catch { /* default */ }
  return [{ name: 'You', kind: 'human', color: PLAYER_COLORS[1] }, { name: 'Marina', kind: 'normal', color: PLAYER_COLORS[2] }, { name: 'Coral', kind: 'normal', color: PLAYER_COLORS[3] }];
};

function Menu() {
  const saved = useLocalSaves(fathomSaves).filter((x) => !x.over);
  const [seats, setSeats] = useState<Seat[]>(loadSeats);
  const [variable, setVariable] = useState(false);
  const [seed, setSeed] = useState('');
  const session = useSession();
  const [hosting, setHosting] = useState(false);
  const [hostErr, setHostErr] = useState<string | null>(null);
  const update = (i: number, patch: Partial<Seat>) => setSeats((x) => x.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const names = seats.map((s) => s.name.trim());
  const valid = names.every(Boolean) && new Set(names).size === names.length;
  const addSeat = () => setSeats((x) => [...x, {
    name: CPU_NAMES.find((n) => !x.some((s) => s.name === n)) ?? `Player ${x.length + 1}`, kind: 'normal',
    color: PLAYER_COLORS.find((c) => !x.some((s) => s.color === c))!,
  }]);
  const start = () => {
    try { localStorage.setItem(SEATS_KEY, JSON.stringify(seats)); } catch { /* fine */ }
    const s = createGame(seats.map((x) => ({ name: x.name.trim(), color: x.color, cpu: x.kind === 'human' ? null : x.kind })), {
      variable, seed: seed.trim() ? Number(seed) || [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0 : undefined,
    });
    const id = newId();
    fathomSaves.save(id, s);
    navigate(`/fathom?local=${id}`);
  };
  return (
    <div className="fathom fm-menu">
      <div className="fm-menu-art" aria-hidden="true"><MenuArt /></div>
      <div className="fm-panel">
        <p className="hub-back"><button type="button" className="linkish" onClick={() => navigate('/')}>← All games</button></p>
        <h1>Fathom</h1>
        <p className="lede">Stock your stretch of ocean, from the sunlit shallows to the midnight deep, then send divers down to set it working.</p>

        {saved.length > 0 && (
          <section className="resume-list" aria-label="Games in progress on this device">
            {saved.map((g) => (
              <div className="resume" key={g.id}>
                <span>{g.title}: {g.players}.</span>
                <span className="save-actions">
                  <button type="button" className="btn" onClick={() => navigate(`/fathom?local=${g.id}`)}>Resume</button>
                  <button type="button" className="icon-btn" aria-label={`Delete the game with ${g.players}`} title="Delete this game from this device" onClick={() => { if (confirm('Delete this game from this device?')) fathomSaves.remove(g.id); }}>×</button>
                </span>
              </div>
            ))}
          </section>
        )}

        <FathomOnlinePanel />

        <h2>Players</h2>
        <ol className="seats">
          {seats.map((s, i) => (
            <li key={i} className="seat" style={{ ['--pc' as string]: s.color }}>
              <label className="sr-only" htmlFor={`fn-${i}`}>Player {i + 1} name</label>
              <input id={`fn-${i}`} value={s.name} maxLength={16} onChange={(e) => update(i, { name: e.target.value })} />
              <label className="sr-only" htmlFor={`fk-${i}`}>Player {i + 1} controller</label>
              <select id={`fk-${i}`} value={s.kind} onChange={(e) => update(i, { kind: e.target.value as Seat['kind'] })}>
                <option value="human">Human</option>
                <option value="easy">Easy CPU</option>
                <option value="normal">Normal CPU</option>
                <option value="hard">Hard CPU</option>
              </select>
              <label className="sr-only" htmlFor={`fc-${i}`}>Player {i + 1} color</label>
              <select id={`fc-${i}`} value={s.color} onChange={(e) => update(i, { color: e.target.value })} className="color-select">
                {PLAYER_COLORS.map((c, j) => <option key={c} value={c} disabled={seats.some((o, k) => k !== i && o.color === c)}>{PLAYER_COLOR_NAMES[j]}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} disabled={seats.length <= 1} onClick={() => setSeats((x) => x.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn ghost small" disabled={seats.length >= 5} onClick={addSeat}>Add player</button>
        <p className="muted small-print">Hands are open in Fathom, so several humans can share one device without hiding anything. <b>Easy</b> plays loosely, <b>Normal</b> builds a dive engine and chases the tide goals, <b>Hard</b> also plans its next turn and watches the goal race.</p>

        <h2>Tide goals</h2>
        <div className="fm-goal-pick" role="radiogroup" aria-label="Tide goals">
          <label className="check"><input type="radio" name="goals" checked={!variable} onChange={() => setVariable(false)} /> <span><b>Classic:</b> Brood, Full rows, Schools</span></label>
          <label className="check"><input type="radio" name="goals" checked={variable} onChange={() => setVariable(true)} /> <span><b>Variable:</b> three drawn from nine, and the leader of each tide gets 3 more</span></label>
        </div>
        <details className="seed">
          <summary>Seed</summary>
          <label>Use a seed to replay the same deal <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" /></label>
        </details>

        <div className="start-row">
          <button type="button" className="btn big" disabled={!valid} onClick={start}>Start game</button>
          {onlineEnabled && (
            <button type="button" className="btn big ghost" disabled={!valid || hosting || seats[0].kind !== 'human' || seats.length < 2}
              title="Other Human seats become open seats for friends to join"
              onClick={async () => {
                setHosting(true); setHostErr(null);
                try {
                  try { localStorage.setItem(SEATS_KEY, JSON.stringify(seats)); } catch { /* fine */ }
                  const id = await hostFathom(seats.map((x) => ({ ...x, name: x.name.trim() })), variable, !!session);
                  navigate(`/fathom?room=${id}`);
                } catch (e) { setHostErr((e as Error).message); } finally { setHosting(false); }
              }}>
              {hosting ? 'Opening…' : 'Host online'}
            </button>
          )}
        </div>
        {!valid && <p className="warn">Give every player a different name.</p>}
        {onlineEnabled && valid && seats[0].kind !== 'human' && <p className="muted">To host online, make the first seat yours (Human).</p>}
        {onlineEnabled && <p className="muted small-print">Online: the first seat is you; other Human seats are left open for friends, who join with the game’s code.</p>}
        {hostErr && <p className="warn" role="alert">{hostErr}</p>}
        <HowToPlay />
      </div>
    </div>
  );
}

function HowToPlay() {
  const [open, setOpen] = useState(false);
  return (
    <section className="fm-rules">
      <div className="fm-rules-head">
        <h2>How to play</h2>
        <button type="button" className="btn small" onClick={() => setOpen(true)}>Full illustrated rules</button>
      </div>
      <p>The game lasts <b>{TIDES} tides</b>. Each tide everyone places <b>{DIVERS} divers</b>, one per turn. With each diver you either:</p>
      <ul>
        <li><b>Release a fish</b> from your hand into your ocean, paying its cost (discarding cards, spending eggs or fry, or eating a smaller fish). It must go in a zone shown on its card, and in its site if it has one. Its <i>Released</i> ability happens at once.</li>
        <li><b>Dive</b> one of your three sites. The diver goes from top to bottom: each zone with a fish in it pays that zone’s bonus, each fish passed gives its <i>Dived</i> ability, and the first diver to reach the bottom of a site each tide takes the bottom bonus.</li>
      </ul>
      <p>A fish can only eat (cover) a smaller one. Eaten fish stay underneath and score 1 point each; eggs and fry on them pass to the new fish’s slot. Eggs hatch into fry, and three fry in one slot form a <b>school</b>, worth {SCHOOL_PTS}.</p>
      <p>At the end of tides 1–3 the tide’s goal scores. After tide {TIDES}: fish points, 1 per eaten fish, egg and fry, {SCHOOL_PTS} per school, and every <i>Game end</i> ability. Ties go to the most cards in hand.</p>
      {open && <Dialog title="How to play Fathom" wide onClose={() => setOpen(false)}><RulesGuide /></Dialog>}
    </section>
  );
}

function MenuArt() {
  return (
    <svg viewBox="0 0 300 520" className="fm-menu-svg">
      <defs>
        <linearGradient id="fm-depth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#47b5c5" /><stop offset="0.33" stopColor="#1d6c8c" /><stop offset="0.66" stopColor="#123653" /><stop offset="1" stopColor="#060c18" /></linearGradient>
      </defs>
      <rect width="300" height="520" rx="14" fill="url(#fm-depth)" />
      {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${-10 + i * 70} 0 L${30 + i * 70} 0 L${-60 + i * 70} 200Z`} fill="#fff" opacity="0.05" />)}
      <g transform="translate(40 60) scale(0.9)"><FishGroup id="parrotfish" /></g>
      <g transform="translate(170 120) scale(0.8)"><FishGroup id="moorish-idol" /></g>
      <g transform="translate(60 220)"><FishGroup id="opah" /></g>
      <g transform="translate(150 300) scale(0.9)"><FishGroup id="hake" /></g>
      <g transform="translate(40 400)"><FishGroup id="anglerfish" /></g>
      <g transform="translate(160 440) scale(0.8)"><FishGroup id="dragonfish" /></g>
      {[[70, 180], [210, 250], [120, 380], [240, 360]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2 + (i % 3)} fill="none" stroke="#dff3f0" opacity="0.5" />)}
    </svg>
  );
}
const FishGroup = ({ id }: { id: string }) => <foreignObject width="120" height="68"><FishArt id={id} /></foreignObject>;

// ---------------------------------------------------------------- the game

interface Entry { s: FState; actor: number | null }

/** What an online game gives the screen: the server's view for your seat and a way to move. */
export interface FathomOnline {
  room: string;
  code: string;
  /** your seat, or -1 when watching */
  seat: number;
  host: boolean;
  version: number;
  view: FState;
  seats: SeatRow[];
  waiting: number[];
  send: (a: FAction) => Promise<void>;
  /** ask the server for the next CPU step at this version */
  advance: (version: number) => void;
  setSeat: (seat: number, kind: 'human' | Level) => Promise<void>;
  forfeit: () => Promise<void>;
}

export function FathomGame({ id, initial, online }: { id: string; initial: FState; online?: FathomOnline }) {
  const [hist, setHist] = useState<Entry[]>([{ s: online?.view ?? initial, actor: null }]);
  const s = hist[hist.length - 1].s;
  const over = s.phase === 'over';
  const d = deciderOf(s);
  const dp = s.players[d];
  const humans = s.players.filter((p) => !p.cpu);
  const [localViewer, setViewer] = useState<number | null>(() => (!dp.cpu ? d : humans[0]?.id ?? null));
  const viewer = online ? (online.seat >= 0 ? online.seat : null) : localViewer;
  const [shown, setShown] = useState<number>(() => viewer ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [cpuSpeed, setCpuSpeed] = useState(700);
  const [placing, setPlacing] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ card: string; slot: number } | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [moveFrom, setMoveFrom] = useState<{ slot: number; what: 'fry' | 'school' } | null>(null);
  const [forfeiting, setForfeiting] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; color: string }[]>([]);
  const [recap, setRecap] = useState<{ key: number; tide: number; s: FState } | null>(null);
  const closeRecap = useCallback(() => setRecap(null), []);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [handOpen, setHandOpen] = useState(false);
  const [fresh, setFresh] = useState<number[]>([]);
  const [diving, setDiving] = useState<{ pid: number; col: number } | null>(null);
  const [showOver, setShowOver] = useState(true);

  useEffect(() => { if (!online) fathomSaves.save(id, s); }, [id, s, online]);

  const localAct = useCallback((a: FAction) => {
    setHist((h) => {
      const cur = h[h.length - 1].s;
      try {
        const next = applyAction(cur, a);
        setError(null);
        return [...h.slice(-60), { s: next, actor: deciderOf(cur) }];
      } catch (e) {
        setError((e as Error).message);
        return h;
      }
    });
  }, []);

  // online: moves go to the server, and each newer view it sends becomes the next step
  const [sending, setSending] = useState(false);
  const sendRef = useRef(online?.send);
  sendRef.current = online?.send;
  const onlineAct = useCallback((a: FAction) => {
    setSending(true);
    setError(null);
    sendRef.current!(a).catch((e) => setError((e as Error).message)).finally(() => setSending(false));
  }, []);
  const act = online ? onlineAct : localAct;
  const onlineView = online?.view;
  useEffect(() => {
    if (!onlineView) return;
    setHist((h) => (h[h.length - 1].s === onlineView ? h : [...h.slice(-60), { s: onlineView, actor: deciderOf(h[h.length - 1].s) }]));
  }, [onlineView]);

  // whoever is human and deciding takes the controls (online: you), and their ocean comes up
  useEffect(() => {
    if (over || dp.cpu) return;
    if (!online) { setViewer(d); setShown(d); }
    else if (d === online.seat) setShown(d);
  }, [d, dp.cpu, over, online?.seat]); // eslint-disable-line react-hooks/exhaustive-deps

  // CPU turns, paced so you can follow them. Online the server plays them a step at a time when
  // asked: the host's screen asks; everyone else only if the host seems to be away.
  const advanceRef = useRef(online?.advance);
  advanceRef.current = online?.advance;
  const onlineVersion = online?.version;
  const onlineHost = online?.host;
  useEffect(() => {
    if (over || !dp.cpu || recap) return;
    const wait = s.prompt ? Math.min(300, cpuSpeed) : cpuSpeed;
    if (onlineVersion !== undefined) {
      const v = onlineVersion;
      const t = setTimeout(() => advanceRef.current!(v), wait + (onlineHost ? 0 : 6000));
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => act(cpuAction(s, dp.cpu!)), wait);
    return () => clearTimeout(t);
  }, [s, over, dp.cpu, act, cpuSpeed, onlineVersion, onlineHost, recap]);

  // effects: new fish splash, dives sweep their site, tides get their goal count, other players' moves a toast
  const prev = useRef(s);
  const key = useRef(0);
  useEffect(() => {
    const a = prev.current;
    prev.current = s;
    if (a === s) return;
    const changed: number[] = [];
    s.players.forEach((p, pid) => p.ocean.forEach((sl, i) => { const before = a.players[pid]?.ocean[i]; if (before && before.fish.length !== sl.fish.length && pid === shown) changed.push(i); }));
    if (changed.length) { setFresh(changed); setTimeout(() => setFresh([]), 1200); }
    if (s.lastDive && s.lastDive !== a.lastDive && (s.lastDive.turn !== a.lastDive?.turn || s.lastDive.pid !== a.lastDive?.pid)) {
      const dv = { pid: s.lastDive.pid, col: s.lastDive.col };
      setDiving(dv);
      setTimeout(() => setDiving((x) => (x === dv ? null : x)), 900);
    }
    // a tide with a goal just ended: count it up, then show what's next
    if (s.tide > a.tide && s.phase !== 'over' && s.goals[s.tide - 2]) {
      setRecap({ key: ++key.current, tide: s.tide - 1, s });
    }
    const added = Math.max(0, s.log.length - a.log.length) || (a.log[a.log.length - 1] !== s.log[s.log.length - 1] ? 1 : 0);
    for (const e of s.log.slice(s.log.length - added).slice(-3)) {
      if (e.pid === null || e.pid === viewer || / skipped: /.test(e.text)) continue;
      const tid = ++key.current;
      setToasts((x) => [...x.slice(-1), { id: tid, text: e.text, color: s.players[e.pid!].color }]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== tid)), 2600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const myTurn = !over && !dp.cpu && viewer === d && !sending;
  const me = viewer !== null ? s.players[viewer] : null;
  const pr: FPrompt | null = myTurn ? s.prompt : null;
  const idle = myTurn && !s.prompt && s.acting === null;

  // reset half-finished choices when the turn moves on
  useEffect(() => { setPlacing(null); setPaying(null); setMoveFrom(null); }, [d, s.turn, s.prompt]);

  const last = hist[hist.length - 1];
  const before = hist[hist.length - 2];
  const canUndo = !online && !over && !!before && last.actor !== null && !s.players[last.actor].cpu && last.actor === d
    && before.s.deck.length === s.deck.length && before.s.players.every((p, i) => p.hand.length <= s.players[i].hand.length || p.id === last.actor);
  const undo = () => setHist((h) => h.slice(0, -1));

  // what can be tapped in the ocean right now
  let selectable: Set<number> | undefined;
  let pick: ((slot: number) => void) | undefined;
  if (shown === viewer && myTurn) {
    if (placing) {
      selectable = new Set(legalSlots(s.players[viewer], placing));
      pick = (slot) => {
        const pay = autoPay(s, viewer, placing, slot)!;
        if (needsPayChoice(s, viewer, placing)) setPaying({ card: placing, slot });
        else act({ t: 'release', card: placing, slot, pay });
        setPlacing(null);
      };
    } else if (pr && (pr.kind === 'egg' || pr.kind === 'hatch' || pr.kind === 'fry')) {
      selectable = new Set(pr.options.map((o) => o.slot!));
      pick = (slot) => act({ t: 'answer', choice: pr.options.findIndex((o) => o.slot === slot) });
    } else if (pr && pr.kind === 'move') {
      if (!moveFrom) {
        selectable = new Set(pr.options.map((o) => o.move!.from));
        pick = (slot) => {
          const kinds = new Set(pr.options.filter((o) => o.move!.from === slot).map((o) => o.move!.what));
          setMoveFrom({ slot, what: kinds.has('fry') ? 'fry' : 'school' });
        };
      } else {
        const opts = pr.options.filter((o) => o.move!.from === moveFrom.slot && o.move!.what === moveFrom.what);
        selectable = new Set(opts.map((o) => o.move!.to));
        pick = (slot) => act({ t: 'answer', choice: pr.options.findIndex((o) => o.move!.from === moveFrom.slot && o.move!.what === moveFrom.what && o.move!.to === slot) });
      }
    }
  }
  const moveKinds = pr?.kind === 'move' && moveFrom ? new Set(pr.options.filter((o) => o.move!.from === moveFrom.slot).map((o) => o.move!.what)) : null;

  const forfeitable = over ? [] : online
    ? (me && !me.forfeited && online.seats[me.id]?.kind === 'human' ? [{ id: me.id, name: me.name }] : [])
    : s.players.filter((p) => !p.cpu && !p.forfeited).map((p) => ({ id: p.id, name: p.name }));
  const [seatsOpen, setSeatsOpen] = useState(false);
  const turnDone = !!online && !over && !!me && !me.forfeited && !online.waiting.includes(online.seat) && !sending;
  const gameKey = online ? `fathom:room:${online.room}` : `fathom:local:${id}`;
  const shownP = s.players[shown];
  const scores = useMemo(() => s.players.map((p) => score(s, p.id).total), [s]);

  return (
    <div className="fathom fm-game">
      <header className="topbar fm-topbar">
        <div className="brand">Fathom</div>
        <div className="gen">Tide <b>{s.tide}</b> of {TIDES}</div>
        <div className="status" role="status" aria-live="polite">
          {over ? 'Game over' : pr ? `${dp.name}: ${pr.title.toLowerCase()}` : dp.cpu ? `${dp.name} is thinking…` : dp.name.trim().toLowerCase() === 'you' ? 'Your turn' : `${dp.name}’s turn`}
        </div>
        <div className="topbar-tools">
          <label className="speed">CPU speed
            <select value={cpuSpeed} onChange={(e) => setCpuSpeed(Number(e.target.value))}>
              <option value={1300}>Slow</option>
              <option value={700}>Normal</option>
              <option value={180}>Fast</option>
            </select>
          </label>
          {online ? (
            <>
              <span className="room-code" title="Friends join with this code">Game <b>{online.code}</b></span>
              {online.host && !over && <button type="button" className="btn ghost" onClick={() => setSeatsOpen(true)}>Seats</button>}
            </>
          ) : <button type="button" className="btn ghost" onClick={undo} disabled={!canUndo} title="Take back your last step (not after a card is drawn)">Undo</button>}
          {forfeitable.length > 0 && <button type="button" className="btn ghost" onClick={() => setForfeiting(true)}>Forfeit</button>}
          <button type="button" className="btn ghost" onClick={() => setRulesOpen(true)} title="How to play">Rules</button>
          <NextGameButton current={gameKey} turnDone={turnDone} />
          <button type="button" className="btn ghost" onClick={() => navigate('/fathom')}>Menu</button>
        </div>
      </header>

      {error && <div className="error" role="alert">{error}<button type="button" className="icon-btn" onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}

      <nav className="fm-players" aria-label="Players">
        {s.players.map((p, i) => (
          <button type="button" key={p.id} className={`fm-chip ${shown === p.id ? 'shown' : ''} ${!over && d === p.id ? 'acting' : ''}`} style={{ ['--pc' as string]: p.color }}
            onClick={() => setShown(p.id)} aria-pressed={shown === p.id} aria-label={`Show ${p.name}'s ocean`}>
            <span className="swatch" />
            <span className="fm-chip-name">{p.name}{p.forfeited && <span className="forfeit-tag"> · forfeited</span>}</span>
            <span className="fm-chip-score">{scores[i]}</span>
            <span className="fm-chip-meta">
              <span className="divers" title={`${p.divers} divers left this tide`}>{Array.from({ length: DIVERS }, (_, k) => <i key={k} className={k < p.divers ? 'on' : ''} />)}</span>
              <span title={`${p.hand.length} cards in hand`}><CardGlyph />{p.hand.length}</span>
            </span>
            {p.cpu && !p.forfeited && <span className="fm-chip-cpu">{LEVEL_LABEL[p.cpu]}</span>}
          </button>
        ))}
      </nav>
      <CurrentGoal s={s} viewer={viewer} />

      <main className="fm-table">
        <section className="fm-main">
          {myTurn && shown === viewer && (placing || pr) && (
            <div className="fm-banner" role="status">
              {placing && <><span>Choose where <b>{FISH[placing].name}</b> goes.</span><button type="button" className="btn ghost small" onClick={() => setPlacing(null)}>Cancel</button></>}
              {!placing && pr && (
                <>
                  <span><b>{pr.title}</b> <span className="muted">· {pr.src}</span>{pr.kind === 'move' && <span className="muted"> · {moveFrom ? 'now tap where it goes' : 'tap a fry or school'}</span>}</span>
                  {moveKinds && moveKinds.size > 1 && (
                    <span className="fm-seg">
                      <button type="button" className={`btn small ${moveFrom?.what === 'fry' ? '' : 'ghost'}`} onClick={() => setMoveFrom((m) => m && { ...m, what: 'fry' })}>Fry</button>
                      <button type="button" className={`btn small ${moveFrom?.what === 'school' ? '' : 'ghost'}`} onClick={() => setMoveFrom((m) => m && { ...m, what: 'school' })}>School</button>
                    </span>
                  )}
                  {moveFrom && <button type="button" className="btn ghost small" onClick={() => setMoveFrom(null)}>Back</button>}
                  <button type="button" className="btn ghost small" onClick={() => act({ t: 'answer', choice: null })}>Skip</button>
                </>
              )}
            </div>
          )}
          {online && viewer === null && <p className="fm-viewing muted">You are watching this game.</p>}
          {online && me && !over && !myTurn && d !== viewer && <p className="fm-viewing muted" role="status">Waiting on {dp.name}{dp.cpu ? ' (CPU)' : ''}.</p>}
          {shown !== viewer && myTurn && <p className="fm-viewing muted">Looking at {shownP.name}’s ocean. <button type="button" className="linkish" onClick={() => setShown(viewer!)}>Back to yours</button></p>}
          <Ocean p={shownP} selectable={selectable} selected={moveFrom?.slot ?? null} onPick={pick} onInspect={setInspect}
            onDive={idle && shown === viewer && !placing ? (col) => act({ t: 'dive', col }) : null}
            fresh={fresh} diving={diving && diving.pid === shown ? diving.col : null} />

          <section className="fm-hand" aria-label={`${shownP.name}'s hand`}>
            <div className="fm-hand-head">
              <h3>{shown === viewer ? 'Your hand' : `${shownP.name}’s hand`} <span className="muted">· {shownP.hand.length} · discard pile {shownP.discard.length}</span></h3>
              {shownP.hand.length > 0 && <button type="button" className="btn ghost small" onClick={() => setHandOpen(true)}>View all</button>}
            </div>
            {shownP.hand.length === 0 && <p className="muted">No cards. Dive a site whose bonuses draw cards.</p>}
            <div className="fm-hand-row">
              {shownP.hand.map((c) => {
                const ok = shown === viewer && idle && canAfford(shownP, c);
                return (
                  <button type="button" key={c} className={`fm-hand-card ${placing === c ? 'placing' : ''}`} onClick={() => setInspect(c)} aria-label={`${FISH[c].name}${ok ? ', can be released' : ''}`}>
                    <FishCard id={c} compact dim={shown === viewer && idle && !ok} />
                  </button>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="fm-side">
          <Goals s={s} />
          <Log s={s} />
        </aside>
      </main>

      {inspect && (
        <Dialog title={FISH[inspect].name} onClose={() => setInspect(null)} footer={
          me && idle && shown === viewer && me.hand.includes(inspect) ? (
            <button type="button" className="btn" disabled={!canAfford(me, inspect)} onClick={() => { setPlacing(inspect); setInspect(null); setHandOpen(false); }}>
              {canAfford(me, inspect) ? 'Release this fish' : whyNot(me, inspect)}
            </button>
          ) : undefined
        }>
          <div className="fm-inspect"><FishCard id={inspect} /><CardHow id={inspect} /></div>
          {me && idle && me.hand.includes(inspect) && canAfford(me, inspect) && <p className="muted">Then tap a highlighted slot in your ocean.</p>}
        </Dialog>
      )}
      {paying && viewer !== null && (
        <PayDialog s={s} pid={viewer} card={paying.card} slot={paying.slot} onCancel={() => setPaying(null)}
          onPay={(pay) => { setPaying(null); act({ t: 'release', card: paying.card, slot: paying.slot, pay }); }} />
      )}
      {pr && (pr.kind === 'recover' || pr.kind === 'cycle') && (
        <Dialog title={pr.title} footer={<button type="button" className="btn ghost" onClick={() => act({ t: 'answer', choice: null })}>Skip</button>}>
          <p className="muted">{pr.src}</p>
          <div className="fm-pick-cards">
            {pr.options.map((o, i) => (
              <button type="button" key={`${o.card}-${i}`} className="fm-hand-card" onClick={() => act({ t: 'answer', choice: i })} aria-label={o.label}>
                <FishCard id={o.card!} compact />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {forfeiting && (
        <ForfeitDialog seats={forfeitable} initial={viewer ?? forfeitable[0]?.id} onClose={() => setForfeiting(false)}
          consequence={(pid) => forfeitText(s.players, pid, !!online || forfeitable.length === 1)}
          onConfirm={(pid) => (online ? online.forfeit() : setHist((h) => [...h.slice(-60), { s: forfeitState(h[h.length - 1].s, pid), actor: null }]))} />
      )}
      {seatsOpen && online && <SeatsDialog s={s} online={online} onClose={() => setSeatsOpen(false)} />}
      {over && showOver && <GameOver s={s} onClose={() => setShowOver(false)} />}
      {over && !showOver && <button type="button" className="btn fm-results-btn" onClick={() => setShowOver(true)}>Final scores</button>}
      {!over && !handOpen && <HandDock p={shownP} mine={shown === viewer} canRelease={shown === viewer && idle} onOpen={() => setHandOpen(true)} />}
      {handOpen && (
        <HandSheet p={shownP} mine={shown === viewer} canRelease={shown === viewer && idle} onClose={() => setHandOpen(false)}
          onInspect={(c) => setInspect(c)}
          onRelease={(c) => { setHandOpen(false); setPlacing(c); }} />
      )}
      {rulesOpen && <Dialog title="How to play Fathom" wide onClose={() => setRulesOpen(false)}><RulesGuide goals={s.goals} /></Dialog>}
      {recap && <TideRecap key={recap.key} s={recap.s} tide={recap.tide} onClose={closeRecap} />}
      <div className="fm-toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="fm-toast" style={{ ['--pc' as string]: t.color }}>{t.text}</div>)}
      </div>
    </div>
  );
}

function SeatsDialog({ s, online, onClose }: { s: FState; online: FathomOnline; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async (i: number, kind: 'human' | Level) => {
    setBusy(true); setErr(null);
    try { await online.setSeat(i, kind); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Seats" onClose={onClose}>
      <p className="muted">If a friend has to drop out, a CPU can play their seat. Hand it back whenever they return.</p>
      <ul className="online-seats">
        {online.seats.map((seat, i) => (
          <li key={i} style={{ ['--pc' as string]: s.players[i].color }}>
            <span className="swatch" /><span className="seat-name">{seat.name}</span>
            {i === online.seat ? <span className="muted">You</span> : seat.forfeited || s.players[i].forfeited ? <span className="muted">Forfeited · {LEVEL_LABEL[s.players[i].cpu ?? 'normal']}</span> : (
              <select value={s.players[i].cpu ?? 'human'} disabled={busy} onChange={(e) => change(i, e.target.value as 'human' | Level)} aria-label={`Who plays ${seat.name}`}>
                {seat.user && <option value="human">{seat.name} plays</option>}
                <option value="easy">Easy CPU</option>
                <option value="normal">Normal CPU</option>
                <option value="hard">Hard CPU</option>
              </select>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="warn">{err}</p>}
    </Dialog>
  );
}

/** Whether paying for this fish involves a real choice (which cards, eggs or fry). */
function needsPayChoice(s: FState, pid: number, card: string): boolean {
  const p = s.players[pid];
  const c = FISH[card].cost;
  const others = p.hand.length - 1;
  const eggs = p.ocean.filter((x) => x.egg).length;
  const fryOwners = p.ocean.filter((x) => x.fry > 0).length;
  return ((c.cards ?? 0) > 0 && (c.cards ?? 0) < others) || ((c.eggs ?? 0) > 0 && (c.eggs ?? 0) < eggs) || ((c.fry ?? 0) > 0 && fryOwners > 1);
}

function PayDialog({ s, pid, card, slot, onPay, onCancel }: { s: FState; pid: number; card: string; slot: number; onPay: (pay: { cards: string[]; eggs: number[]; fry: number[] }) => void; onCancel: () => void }) {
  const p = s.players[pid];
  const c = FISH[card].cost;
  const auto = autoPay(s, pid, card, slot)!;
  const [cards, setCards] = useState<string[]>(auto.cards);
  const [eggs, setEggs] = useState<number[]>(auto.eggs);
  const [fry, setFry] = useState<number[]>(auto.fry);
  const toggle = <T,>(xs: T[], x: T, max: number) => (xs.includes(x) ? xs.filter((y) => y !== x) : xs.length < max ? [...xs, x] : [...xs.slice(1), x]);
  const fryAt = (i: number) => fry.filter((x) => x === i).length;
  const ok = cards.length === (c.cards ?? 0) && eggs.length === (c.eggs ?? 0) && fry.length === (c.fry ?? 0);
  return (
    <Dialog title={`Release ${FISH[card].name}`} onClose={onCancel} wide footer={(
      <>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn" disabled={!ok} onClick={() => onPay({ cards, eggs, fry })}>Release at {slotName(slot)}</button>
      </>
    )}>
      {(c.cards ?? 0) > 0 && (
        <fieldset className="plain fm-pay">
          <legend>Discard {c.cards} card{c.cards === 1 ? '' : 's'} <span className="muted">({cards.length} chosen)</span></legend>
          <div className="fm-pick-cards">
            {p.hand.filter((x) => x !== card).map((x) => (
              <button type="button" key={x} className={`fm-hand-card ${cards.includes(x) ? 'chosen' : ''}`} aria-pressed={cards.includes(x)} onClick={() => setCards((xs) => toggle(xs, x, c.cards!))}>
                <FishCard id={x} compact />
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {(c.eggs ?? 0) > 0 && (
        <fieldset className="plain fm-pay">
          <legend>Spend {c.eggs} egg{c.eggs === 1 ? '' : 's'}</legend>
          <div className="fm-token-pick">
            {p.ocean.map((x, i) => (x.egg ? (
              <label key={i} className="check"><input type="checkbox" checked={eggs.includes(i)} onChange={() => setEggs((xs) => toggle(xs, i, c.eggs!))} /> <Egg /> {slotName(i)}</label>
            ) : null))}
          </div>
        </fieldset>
      )}
      {(c.fry ?? 0) > 0 && (
        <fieldset className="plain fm-pay">
          <legend>Spend {c.fry} fry <span className="muted">({fry.length} chosen)</span></legend>
          <div className="fm-token-pick">
            {p.ocean.map((x, i) => (x.fry > 0 ? (
              <span key={i} className="fm-stepper">
                <Fry /> {slotName(i)}: {fryAt(i)} of {x.fry}
                <button type="button" className="icon-btn" aria-label={`One fewer from ${slotName(i)}`} disabled={!fryAt(i)} onClick={() => setFry((xs) => { const k = xs.indexOf(i); return xs.filter((_, j) => j !== k); })}>−</button>
                <button type="button" className="icon-btn" aria-label={`One more from ${slotName(i)}`} disabled={fryAt(i) >= x.fry || fry.length >= c.fry!} onClick={() => setFry((xs) => [...xs, i])}>+</button>
              </span>
            ) : null))}
          </div>
        </fieldset>
      )}
    </Dialog>
  );
}

function Goals({ s }: { s: FState }) {
  return (
    <section className="fm-goals" aria-label="Tide goals">
      <h3>Tide goals</h3>
      <ol>
        {s.goals.map((g, i) => {
          const tide = i + 1;
          const cur = s.phase !== 'over' && s.tide === tide;
          return (
            <li key={g} className={cur ? 'current' : tide < s.tide || s.phase === 'over' ? 'done' : ''}>
              <div><b>Tide {tide}: {GOALS[g].name}</b> <span className="muted">· {GOALS[g].text}{s.options.variable ? '; +3 to the leader' : ''}</span></div>
              <div className="fm-goal-scores">
                {s.players.map((p) => (
                  <span key={p.id} style={{ ['--pc' as string]: p.color }} title={p.name}>
                    <span className="swatch" />{tide < s.tide || s.phase === 'over' ? p.goals[i] ?? 0 : goalPoints(p, g)}
                  </span>
                ))}
                {cur && <span className="muted">so far</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The goal this tide is racing toward, always in view (the side panel is far down on phones). */
function CurrentGoal({ s, viewer }: { s: FState; viewer: number | null }) {
  if (s.phase === 'over') return null;
  const g = s.goals[s.tide - 1];
  if (!g) return <div className="fm-goal-pill final"><EndGlyph size={20} /><span><b>Tide {s.tide}: the last tide</b> <span className="muted">· No goal. Final scoring when it ends.</span></span></div>;
  const me = viewer !== null ? s.players[viewer] : null;
  return (
    <div className="fm-goal-pill">
      <GoalIcon id={g} size={26} />
      <span className="txt"><b>Tide {s.tide} goal: {GOALS[g].name}</b> <span className="muted">· {GOALS[g].text}</span></span>
      {me && <span className="you">{me.name.trim().toLowerCase() === 'you' ? 'You' : me.name}: <b>{goalPoints(me, g)}</b> so far</span>}
    </div>
  );
}

function Log({ s }: { s: FState }) {
  const items = s.log.slice(-40).reverse();
  return (
    <section className="fm-log" aria-label="Game log">
      <h3>Log</h3>
      <ol>
        {items.map((e, i) => <li key={i} style={e.pid !== null ? { ['--pc' as string]: s.players[e.pid].color } : undefined} className={e.pid === null ? 'sys' : ''}>{e.text}</li>)}
      </ol>
    </section>
  );
}

function GameOver({ s, onClose }: { s: FState; onClose: () => void }) {
  const rows = standings(s);
  const w = s.players[rows[0].pid];
  return (
    <Dialog title={`${w.name} wins`} wide onClose={onClose} footer={(
      <>
        <button type="button" className="btn ghost" onClick={onClose}>Look at the oceans</button>
        <button type="button" className="btn" onClick={() => navigate('/fathom')}>Back to Fathom</button>
      </>
    )}>
      <p>{s.endedBy === 'forfeit' ? `The game ended early in tide ${s.tide} after players forfeited.` : `After ${TIDES} tides,`} {w.name} finishes with {rows[0].sc.total} points.</p>
      <div className="fm-table-wrap">
        <table className="scores">
          <thead><tr><th>Player</th><th>Fish</th><th>Eaten</th><th><Egg /></th><th><Fry /></th><th><School /></th><th>Abilities</th><th>Goals</th><th>Total</th></tr></thead>
          <tbody>
            {rows.map(({ pid, sc }) => {
              const p = s.players[pid];
              return (
                <tr key={pid} style={{ ['--pc' as string]: p.color }}>
                  <th scope="row"><span className="swatch" />{p.name}{p.forfeited && <span className="forfeit-tag"> · forfeited</span>}</th>
                  <td>{sc.fish}</td><td>{sc.eaten}</td><td>{sc.eggs}</td><td>{sc.fry}</td><td>{sc.schools}</td><td>{sc.abilities}</td><td>{sc.goals}</td><td><b>{sc.total}</b></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">Ties go to the most cards in hand.{rows.some((r) => s.players[r.pid].forfeited) ? ' Forfeited players rank last.' : ''}</p>
      {s.history.length > 1 && <TideChart s={s} />}
    </Dialog>
  );
}

function TideChart({ s }: { s: FState }) {
  const W = 320, H = 150, pad = 26;
  const max = Math.max(10, ...s.history.flat());
  const n = s.history.length;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, n - 1);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  return (
    <figure className="fm-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score after each tide">
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" />
        {s.history.map((_, i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">Tide {i + 1}</text>)}
        {s.players.map((p) => (
          <g key={p.id}>
            <polyline points={s.history.map((h, i) => `${x(i)},${y(h[p.id])}`).join(' ')} fill="none" stroke={p.color} strokeWidth="2.5" />
            {s.history.map((h, i) => <circle key={i} cx={x(i)} cy={y(h[p.id])} r="3" fill={p.color} />)}
            <text x={x(n - 1) + 4} y={y(s.history[n - 1][p.id]) + 3} fontSize="10" fill="var(--text)">{s.history[n - 1][p.id]}</text>
          </g>
        ))}
      </svg>
      <figcaption className="muted">Score after each tide</figcaption>
    </figure>
  );
}
