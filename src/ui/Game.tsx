import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameState, Level, Payment, Prompt, StdProject } from '../engine/types';
import { MAX_TEMP } from '../engine/types';
import { applyAction } from '../engine/game';
import { CARDS } from '../engine/cards';
import { cpuAction } from '../engine/ai/cpu';
import {
  activeCards, autoPay, availableSpaces, awardCost, AWARDS, awardPlaces, canClaimMilestone, canFundAward, canPlayCard, canSP,
  cardActionAvailable, cardCost, checkPayment, greeneryCost, maxSpend, MILESTONE_COST, MILESTONES, opsFeasible, payLimitsForCard,
  requirementsMet, score, spCost, SP_NAME, steelValue, titaniumValue, type PayLimits,
} from '../engine/queries';
import { Board } from './Board';
import { Card } from './Card';
import { Dialog } from './Dialog';
import { Gauges } from './Gauges';
import { Players, ResourceGrid } from './Players';
import { fmtTemp, RES_LABEL } from './format';
import { cloudEnabled, currentCloudId, putSave, useSession } from '../cloud';
import { BannerView, CardShowcase, Confetti, diffEvents, FxContext, loadFxSetting, saveFxSetting, Toasts, type Banner, type Showcase, type Toast } from './Fx';
import type { SeatRow } from '../online/protocol';

/** What an online game gives the board: the server's view for your seat and a way to move. */
export interface OnlineLink {
  code: string;
  /** your seat, or -1 when watching */
  seat: number;
  host: boolean;
  version: number;
  view: GameState;
  seats: SeatRow[];
  /** seats the game is waiting on; queued: picks already in for later in turn order */
  waiting: number[];
  queued: number[];
  send: (a: Action) => Promise<void>;
  /** ask the server for the next CPU step at this version */
  advance: (version: number) => void;
  setSeat: (seat: number, kind: 'human' | Level) => Promise<void>;
}

const SAVE_KEY = 'regolith-save-v1';
export function saveGame(s: GameState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch { return null; }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

interface Entry { s: GameState; actor: number | null }

const deciderOf = (s: GameState) => (s.prompt ? s.prompt.pid : s.active);

export function Game({ initial, onExit, online }: { initial: GameState; onExit: () => void; online?: OnlineLink }) {
  const [hist, setHist] = useState<Entry[]>([{ s: online?.view ?? initial, actor: null }]);
  const s = hist[hist.length - 1].s;
  const humans = s.players.filter((p) => !p.cpu).map((p) => p.id);
  const [localViewer, setViewer] = useState<number | null>(humans.length === 1 ? humans[0] : null);
  const viewer = online ? (online.seat >= 0 ? online.seat : null) : localViewer;
  const [error, setError] = useState<string | null>(null);
  const [cpuSpeed, setCpuSpeed] = useState(450);
  const [viewCards, setViewCards] = useState<number | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'projects' | 'sell' | 'confirmPass'>(null);
  const decider = deciderOf(s);
  const dp = s.players[decider];
  const over = s.phase === 'over';
  const myTurn = !over && !dp.cpu && viewer === decider;

  const lastOp = useRef<'act' | 'undo' | null>(null);
  const [sending, setSending] = useState(false);
  const localAct = useCallback((a: Action) => {
    lastOp.current = 'act';
    setHist((h) => {
      const cur = h[h.length - 1].s;
      try {
        const next = applyAction(cur, a);
        setError(null);
        return [...h.slice(-80), { s: next, actor: deciderOf(cur) }];
      } catch (e) {
        setError((e as Error).message);
        return h;
      }
    });
  }, []);
  const sendRef = useRef(online?.send);
  sendRef.current = online?.send;
  const onlineAct = useCallback((a: Action) => {
    setSending(true);
    setError(null);
    sendRef.current!(a).catch((e) => setError((e as Error).message)).finally(() => setSending(false));
  }, []);
  const act = online ? onlineAct : localAct;

  // online: each newer server view becomes the next step, so effects play as they do locally
  const onlineView = online?.view;
  useEffect(() => {
    if (!onlineView) return;
    setHist((h) => {
      const cur = h[h.length - 1].s;
      if (cur === onlineView) return h;
      lastOp.current = 'act';
      return [...h.slice(-80), { s: onlineView, actor: deciderOf(cur) }];
    });
  }, [onlineView]);

  useEffect(() => { if (!online) saveGame(s); }, [s, online]);

  // cloud sync: a couple of seconds after the last change (right away when the game ends)
  const session = useSession();
  const cloudId = useMemo(() => (cloudEnabled ? currentCloudId() : ''), []);
  const [cloud, setCloud] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => {
    if (!cloudEnabled || !session || online) return;
    const t = setTimeout(() => {
      setCloud('saving');
      putSave(cloudId, s).then(() => setCloud('saved'), () => setCloud('error'));
    }, s.phase === 'over' ? 0 : 2500);
    return () => clearTimeout(t);
  }, [s, session, cloudId, online]);

  // ---- effects: turn each state change into showcases, tile drops, toasts and banners ----
  const [fxOn, setFxOn] = useState(loadFxSetting);
  const [show, setShow] = useState<Showcase | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [pulse, setPulse] = useState<{ kind: 'temp' | 'oxy' | 'ocean'; key: number } | null>(null);
  const prevS = useRef(s);
  const fxKey = useRef(0);
  const holdRef = useRef(0);
  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++fxKey.current;
    setToasts((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.tone === 'trophy' ? 3600 : 2600);
  }, []);
  useEffect(() => {
    const a = prevS.current;
    prevS.current = s;
    const op = lastOp.current;
    lastOp.current = null;
    holdRef.current = 0;
    if (a === s || op !== 'act') return;
    const ev = diffEvents(a, s);
    const name = (pid: number) => (pid === viewer && !s.players[pid].cpu ? 'You' : s.players[pid].name);
    const tiles = ev.flatMap((e) => (e.k === 'tile' ? [e.space] : []));
    if (tiles.length) {
      setFresh(tiles);
      setTimeout(() => setFresh((f) => (f === tiles ? [] : f)), 1700);
    }
    const params = ev.filter((e) => e.k === 'param');
    if (params.length) setPulse({ kind: (params[params.length - 1] as { which: 'temp' | 'oxy' | 'ocean' }).which, key: ++fxKey.current });
    const cards = ev.filter((e) => e.k === 'card');
    // corporations are founded while you choose your own: announce those quietly
    if (cards.length && a.phase === 'setup') {
      for (const e of cards as { pid: number; card: string }[]) if (e.pid !== viewer) pushToast({ pid: e.pid, tone: 'info', text: `${s.players[e.pid].name} founded ${CARDS[e.card].name}` });
    } else if (cards.length && fxOn) {
      const c = cards[cards.length - 1] as { pid: number; card: string };
      const mine = c.pid === viewer && !s.players[c.pid].cpu;
      setShow({ key: ++fxKey.current, pid: c.pid, card: c.card, mine });
      if (!mine && cpuSpeed > 120) holdRef.current = 1300;
    }
    let bannered = false;
    for (const e of ev) {
      if (e.k === 'milestone') pushToast({ pid: e.pid, tone: 'trophy', text: `${name(e.pid)} claimed the ${e.name} milestone` });
      if (e.k === 'award') pushToast({ pid: e.pid, tone: 'trophy', text: `${name(e.pid)} funded the ${e.name} award` });
      if (e.k === 'pass' && e.pid !== viewer) pushToast({ pid: e.pid, tone: 'pass', text: `${s.players[e.pid].name} passed for this generation` });
      if (e.k === 'action' && e.pid !== viewer && !ev.some((x) => x.k === 'pass' || x.k === 'tile' || x.k === 'param')) pushToast({ pid: e.pid, tone: 'info', text: e.text });
      if (e.k === 'generation' && fxOn) {
        const mine = viewer !== null ? e.production.find((x) => x.pid === viewer) : undefined;
        setBanner({ key: ++fxKey.current, tone: 'gen', title: `Generation ${e.gen}`, sub: mine ? `Production: you collected ${mine.mc} M€` : 'Production paid out' });
        bannered = true;
        if (cpuSpeed > 120) holdRef.current = Math.max(holdRef.current, 1500);
      }
      if (e.k === 'terraformed' && fxOn) {
        setBanner({ key: ++fxKey.current, tone: 'terraformed', title: 'Mars is terraformed', sub: 'Plant your last greeneries before scoring' });
        bannered = true;
      }
    }
    // your turn, when playing alone against CPUs
    const d = deciderOf(s);
    if (fxOn && !bannered && (online || humans.length === 1) && d === viewer && deciderOf(a) !== d && s.phase === 'action' && !s.prompt) {
      setBanner({ key: ++fxKey.current, tone: 'turn', title: 'Your turn' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);
  const toggleFx = () => setFxOn((v) => { saveFxSetting(!v); if (v) setShow(null); return !v; });
  const endShow = useCallback(() => setShow(null), []);
  const endBanner = useCallback(() => setBanner(null), []);

  // CPU moves (held a little after a showcase or banner so you can see it)
  // Online, the server plays CPU seats one step at a time when asked: the host's screen asks,
  // paced like local play; everyone else asks only if the host seems to be away.
  const advanceRef = useRef(online?.advance);
  advanceRef.current = online?.advance;
  const onlineVersion = online?.version;
  const onlineHost = online?.host;
  useEffect(() => {
    if (over || !dp.cpu) return;
    const base = s.prompt ? Math.min(250, cpuSpeed) : cpuSpeed;
    if (onlineVersion !== undefined) {
      const v = onlineVersion;
      const t = setTimeout(() => advanceRef.current!(v), base + holdRef.current + (onlineHost ? 0 : 6000));
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => act(cpuAction(s, dp.cpu!)), base + holdRef.current);
    return () => clearTimeout(t);
  }, [s, over, dp.cpu, act, cpuSpeed, onlineVersion, onlineHost]);

  // with several humans, hide hands between them
  const needsHandoff = !online && !over && !dp.cpu && viewer !== decider;
  useEffect(() => {
    if (needsHandoff && humans.length === 1) setViewer(decider);
  }, [needsHandoff, humans.length, decider]);

  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2];
  const canUndo = !online && !!prev && last.actor !== null && last.actor === viewer && !s.players[last.actor].cpu && prev.s.reveal === s.reveal && !over;
  const undo = () => { lastOp.current = 'undo'; setHist((h) => h.slice(0, -1)); };

  // online, corporation and research picks are made at the same time, not in turn order
  const meP = viewer !== null ? s.players[viewer] : null;
  const picking = online
    ? !!meP && !s.prompt && !online.queued.includes(meP.id) && ((s.phase === 'setup' && !!meP.setup) || (s.phase === 'research' && !!meP.research))
    : myTurn;
  const canAct = myTurn && !sending;
  const pr = canAct ? s.prompt : null;
  const [seatsOpen, setSeatsOpen] = useState(false);
  const spacePrompt = pr?.kind === 'space' ? pr : null;
  const me = viewer !== null ? s.players[viewer] : null;

  return (
    <FxContext.Provider value={fxOn}>
    <div className="game" data-fx={fxOn ? 'on' : 'off'}>
      <header className="topbar">
        <div className="brand">Regolith</div>
        <div className="gen">Generation <b>{s.generation}</b></div>
        <Status s={s} viewer={viewer} online={online} />
        <div className="topbar-tools">
          {session && cloud !== 'idle' && (
            <span className={`cloud-status ${cloud}`} role="status">
              {cloud === 'saving' ? 'Saving…' : cloud === 'saved' ? 'Saved to cloud' : 'Cloud save failed; saved on this device'}
            </span>
          )}
          <label className="fx-toggle" title="Card showcases, tile animations and banners">
            <input type="checkbox" checked={fxOn} onChange={toggleFx} /> Effects
          </label>
          <label className="speed">CPU speed
            <select value={cpuSpeed} onChange={(e) => setCpuSpeed(Number(e.target.value))}>
              <option value={900}>Slow</option>
              <option value={450}>Normal</option>
              <option value={120}>Fast</option>
            </select>
          </label>
          {online ? (
            <>
              <span className="room-code" title="Friends join with this code">Game <b>{online.code}</b></span>
              {online.host && !over && <button type="button" className="btn ghost" onClick={() => setSeatsOpen(true)}>Seats</button>}
            </>
          ) : (
            <button type="button" className="btn ghost" onClick={undo} disabled={!canUndo} title="Undo your last step (not after cards are drawn)">Undo</button>
          )}
          <button type="button" className="btn ghost" onClick={onExit}>Menu</button>
        </div>
      </header>

      {error && <div className="error" role="alert">{error}<button type="button" className="icon-btn" onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}

      <main className="table">
        <div className="map-col">
          <Gauges s={s} />
          <div className="map-area">
            {spacePrompt && <div className="place-banner" role="status">{spacePrompt.title}: choose a highlighted space.</div>}
            <Board s={s} options={spacePrompt?.options} onPick={(id) => act({ t: 'answer', space: id })} fresh={fresh} pulse={fxOn ? pulse : null} />
          </div>
        </div>

        <aside className="side">
          <Players s={s} viewer={viewer} onView={setViewCards} queued={online?.queued} />
          <Log s={s} />
        </aside>

        <section className="desk">
          {me && !over && s.phase === 'action' && (
            <ActionBar s={s} pid={me.id} myTurn={canAct && !s.prompt && !s.pendingAction} act={act} panel={panel} setPanel={setPanel} />
          )}
          {me && s.phase === 'finalGreenery' && canAct && !s.prompt && (
            <div className="final-bar">
              <p>Mars is terraformed. Turn your remaining plants into greeneries before scoring.</p>
              <button type="button" className="btn" disabled={me.res.plants < greeneryCost(s, me.id) || !availableSpaces(s, me.id, 'greenery', 'greenery').length} onClick={() => act({ t: 'plants' })}>
                Convert {greeneryCost(s, me.id)} plants to a greenery ({me.res.plants} plants)
              </button>
              <button type="button" className="btn ghost" onClick={() => act({ t: 'pass' })}>Finish</button>
            </div>
          )}
          {me && (
            <Hand s={s} pid={me.id} onOpen={setOpenCard} canAct={canAct && s.phase === 'action' && !s.prompt && !s.pendingAction} />
          )}
          {!me && !over && <p className="muted pad">{online ? 'You are watching this game.' : 'Hands stay hidden until a player takes the device.'}</p>}
          {online && me && !over && !picking && !myTurn && (s.phase === 'setup' || s.phase === 'research') && (
            <p className="muted pad waiting-note" role="status">Your {s.phase === 'setup' ? 'corporation' : 'research'} is in. It applies when your turn comes round.</p>
          )}
        </section>
      </main>

      {needsHandoff && humans.length > 1 && (
        <Dialog title={`Pass the device to ${dp.name}`}>
          <p>{dp.name} has a decision to make. Other players, look away while they play.</p>
          <button type="button" className="btn big" onClick={() => setViewer(decider)}>I'm {dp.name}, show my hand</button>
        </Dialog>
      )}
      {picking && !sending && s.phase === 'setup' && <SetupDialog s={s} pid={online ? viewer! : decider} act={act} />}
      {picking && !sending && s.phase === 'research' && !s.prompt && <ResearchDialog s={s} pid={online ? viewer! : decider} act={act} />}
      {seatsOpen && online && <SeatsDialog s={s} online={online} onClose={() => setSeatsOpen(false)} />}
      {pr && pr.kind !== 'space' && <PromptDialog s={s} pr={pr} act={act} />}
      {openCard && me && <CardDialog s={s} pid={me.id} id={openCard} canAct={canAct && s.phase === 'action' && !s.prompt && !s.pendingAction} onClose={() => setOpenCard(null)} act={(a) => { setOpenCard(null); act(a); }} />}
      {viewCards !== null && <TableauDialog s={s} pid={viewCards} onClose={() => setViewCards(null)} />}
      {panel === 'sell' && me && <SellDialog s={s} pid={me.id} onClose={() => setPanel(null)} act={(a) => { setPanel(null); act(a); }} />}
      {over && <GameOver s={s} onExit={onExit} />}
      {over && fxOn && <Confetti colors={s.players.map((p) => p.color)} />}
      {show && <CardShowcase key={show.key} show={show} s={s} onDone={endShow} fast={cpuSpeed <= 120} />}
      {banner && <BannerView key={banner.key} b={banner} onDone={endBanner} />}
      <Toasts items={toasts} s={s} />
    </div>
    </FxContext.Provider>
  );
}

// ---------------- status line ----------------
function Status({ s, viewer, online }: { s: GameState; viewer: number | null; online?: OnlineLink }) {
  const d = s.players[deciderOf(s)];
  let text: string;
  const names = (ids: number[]) => ids.map((i) => (i === viewer ? 'you' : s.players[i].name)).join(', ');
  if (online && (s.phase === 'setup' || s.phase === 'research') && !s.prompt && online.waiting.length) {
    const ids = online.waiting;
    const what = s.phase === 'setup' ? 'founding corporations' : 'buying research';
    text = ids.length === 1 && ids[0] === viewer ? `Your move: ${what}` : `Waiting on ${names(ids)}: ${what}`;
    return <div className="status" role="status" aria-live="polite" style={{ ['--pc' as string]: s.players[ids[0]].color }}><span className="swatch" />{text}</div>;
  }
  if (s.phase === 'over') text = 'Game over';
  else if (s.phase === 'setup') text = `${d.name} is choosing a corporation`;
  else if (s.phase === 'research') text = `${d.name} is buying research cards`;
  else if (s.phase === 'finalGreenery') text = `${d.name} is placing final greeneries`;
  else text = `${d.name}'s turn`;
  if (d.cpu && s.phase !== 'over') text += '…';
  else if (viewer === d.id && s.phase === 'action') text = 'Your turn';
  else if (online && s.phase !== 'over' && !d.cpu) text = `Waiting on ${d.name}`;
  return <div className="status" role="status" aria-live="polite" style={{ ['--pc' as string]: d.color }}><span className="swatch" />{text}</div>;
}

// ---------------- log ----------------
function Log({ s }: { s: GameState }) {
  const items = s.log.slice(-40).reverse();
  return (
    <section className="log" aria-label="Game log">
      <h3>Log</h3>
      <ol>
        {items.map((l, i) => (
          <li key={s.log.length - i} style={l.pid !== null ? { ['--pc' as string]: s.players[l.pid].color } : undefined} className={l.pid === null ? 'sys' : ''}>{l.text}</li>
        ))}
      </ol>
    </section>
  );
}

// ---------------- hand ----------------
function whyNot(s: GameState, pid: number, id: string): string | null {
  if (canPlayCard(s, pid, id)) return null;
  if (!requirementsMet(s, pid, id)) return 'Requirement not met';
  const c = CARDS[id];
  if (c.canPlay && !c.canPlay(s, pid)) return 'Its effect can’t resolve right now';
  if (c.play && !opsFeasible(s, pid, c.play(s, pid, id))) return 'Missing production or space for its effect';
  return `Costs ${cardCost(s, pid, id)} M€, more than you can pay`;
}

function Hand({ s, pid, onOpen, canAct }: { s: GameState; pid: number; onOpen: (id: string) => void; canAct: boolean }) {
  const p = s.players[pid];
  const [sort, setSort] = useState<'playable' | 'cost'>('playable');
  const cards = [...p.hand].sort((a, b) => (sort === 'cost' ? cardCost(s, pid, a) - cardCost(s, pid, b) : Number(canPlayCard(s, pid, b)) - Number(canPlayCard(s, pid, a))));
  return (
    <section className="hand" aria-label="Your hand">
      <div className="hand-head">
        <h3>Your hand <span className="muted">({p.hand.length})</span></h3>
        <ResourceGrid s={s} pid={pid} />
        <label className="sort">Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as 'playable' | 'cost')}>
            <option value="playable">Playable first</option>
            <option value="cost">Cost</option>
          </select>
        </label>
      </div>
      {cards.length === 0 && <p className="muted">No cards in hand. Buy some in the research phase or use standard projects.</p>}
      <div className="hand-cards">
        {cards.map((id, i) => (
          <Card key={id} id={id} s={s} pid={pid} index={i} dim={canAct && !canPlayCard(s, pid, id)} onClick={() => onOpen(id)} />
        ))}
      </div>
    </section>
  );
}

// ---------------- payment ----------------
function PayControl({ s, pid, cost, lim, pay, setPay }: { s: GameState; pid: number; cost: number; lim: PayLimits; pay: Payment; setPay: (p: Payment) => void }) {
  const p = s.players[pid];
  const rows: { key: 'steel' | 'titanium' | 'heat'; label: string; unit: number; have: number }[] = [];
  if (lim.steel && p.res.steel) rows.push({ key: 'steel', label: 'Steel', unit: steelValue(s, pid), have: p.res.steel });
  if (lim.titanium && p.res.titanium) rows.push({ key: 'titanium', label: 'Titanium', unit: titaniumValue(s, pid), have: p.res.titanium });
  if (lim.heat && p.res.heat) rows.push({ key: 'heat', label: 'Heat', unit: 1, have: p.res.heat });
  const mc = checkPayment(s, pid, cost, pay, lim);
  if (!rows.length) return null;
  return (
    <div className="pay">
      {rows.map((r) => (
        <div key={r.key} className="pay-row">
          <span>{r.label} <small>({r.unit} M€ each, you have {r.have})</small></span>
          <div className="stepper">
            <button type="button" className="icon-btn" aria-label={`Less ${r.label}`} disabled={!(pay[r.key] ?? 0)} onClick={() => setPay({ ...pay, [r.key]: (pay[r.key] ?? 0) - 1 })}>−</button>
            <output>{pay[r.key] ?? 0}</output>
            <button type="button" className="icon-btn" aria-label={`More ${r.label}`} disabled={(pay[r.key] ?? 0) >= r.have} onClick={() => setPay({ ...pay, [r.key]: (pay[r.key] ?? 0) + 1 })}>+</button>
          </div>
        </div>
      ))}
      <p className={mc === null ? 'warn' : 'muted'}>{mc === null ? 'That payment doesn’t work: too little, or more than needed.' : `Plus ${mc} M€ (you have ${p.res.mc}).`}</p>
    </div>
  );
}

function CardDialog({ s, pid, id, canAct, onClose, act }: { s: GameState; pid: number; id: string; canAct: boolean; onClose: () => void; act: (a: Action) => void }) {
  const cost = cardCost(s, pid, id);
  const lim = payLimitsForCard(s, pid, id);
  const [pay, setPay] = useState<Payment>(() => autoPay(s, pid, cost, lim) ?? {});
  const reason = whyNot(s, pid, id);
  const ok = !reason && checkPayment(s, pid, cost, pay, lim) !== null;
  return (
    <Dialog title={CARDS[id].name} onClose={onClose}
      footer={canAct ? (
        <>
          {reason && <span className="warn">{reason}</span>}
          <button type="button" className="btn" disabled={!ok} onClick={() => act({ t: 'play', card: id, pay })}>Play for {cost} M€</button>
        </>
      ) : <span className="muted">You can play cards on your turn.</span>}>
      <div className="card-big"><Card id={id} s={s} pid={pid} /></div>
      {canAct && !reason && <PayControl s={s} pid={pid} cost={cost} lim={lim} pay={pay} setPay={setPay} />}
    </Dialog>
  );
}

// ---------------- action bar ----------------
const SPS: StdProject[] = ['power', 'asteroid', 'aquifer', 'greenery', 'city'];
const SP_EFFECT: Record<StdProject, string> = {
  sell: 'Discard cards for 1 M€ each', power: '+1 energy production', asteroid: 'Raise temperature', aquifer: 'Place an ocean', greenery: 'Place a greenery', city: 'Place a city, +1 M€ production',
};

function ActionBar({ s, pid, myTurn, act, panel, setPanel }: { s: GameState; pid: number; myTurn: boolean; act: (a: Action) => void; panel: string | null; setPanel: (p: null | 'projects' | 'sell' | 'confirmPass') => void }) {
  const p = s.players[pid];
  const actions = activeCards(s, pid).filter((c) => c.action);
  const helion = p.corp === 'helion';
  const payHelion = (cost: number): Payment | undefined => (helion ? autoPay(s, pid, cost, { steel: false, titanium: false, heat: true }) ?? undefined : undefined);
  return (
    <section className="actionbar" aria-label="Actions">
      <div className="ab-group">
        <h3>Convert</h3>
        <button type="button" className="btn small" disabled={!myTurn || p.res.plants < greeneryCost(s, pid) || !availableSpaces(s, pid, 'greenery', 'greenery').length} onClick={() => act({ t: 'plants' })}>
          {greeneryCost(s, pid)} plants → greenery
        </button>
        <button type="button" className="btn small" disabled={!myTurn || p.res.heat < 8 || s.temperature >= MAX_TEMP} onClick={() => act({ t: 'heat' })}>
          8 heat → {fmtTemp(Math.min(MAX_TEMP, s.temperature + 2))}
        </button>
      </div>
      <div className="ab-group">
        <h3>Standard projects</h3>
        <div className="chips">
          {SPS.map((id) => (
            <button key={id} type="button" className="btn small" disabled={!myTurn || !canSP(s, pid, id)} title={SP_EFFECT[id]} onClick={() => act({ t: 'sp', id, pay: payHelion(spCost(s, pid, id)) })}>
              {SP_NAME[id]} <b>{spCost(s, pid, id)}</b>
            </button>
          ))}
          <button type="button" className="btn small ghost" disabled={!myTurn || !p.hand.length} onClick={() => setPanel('sell')}>Sell patents</button>
        </div>
      </div>
      {actions.length > 0 && (
        <div className="ab-group">
          <h3>Card actions</h3>
          <div className="chips">
            {actions.map((c) => {
              const avail = cardActionAvailable(s, pid, c.id);
              const used = p.usedActions.includes(c.id);
              const lim = { steel: !!c.action!.steel, titanium: !!c.action!.titanium, heat: false };
              return (
                <button key={c.id} type="button" className="btn small" disabled={!myTurn || !avail} title={c.action!.text}
                  onClick={() => act({ t: 'cardAction', card: c.id, pay: c.action!.mc ? autoPay(s, pid, c.action!.mc, lim) ?? undefined : undefined })}>
                  {c.name}{used ? ' (used)' : ''}<span className="chip-sub">{c.action!.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="ab-group">
        <h3>Milestones <span className="muted">{MILESTONE_COST} M€, {3 - s.milestones.length} left</span></h3>
        <div className="chips">
          {MILESTONES.map((m) => {
            const owner = s.milestones.find((x) => x.id === m.id);
            return (
              <button key={m.id} type="button" className="btn small" disabled={!myTurn || !canClaimMilestone(s, pid, m.id)} onClick={() => act({ t: 'milestone', id: m.id, pay: payHelion(MILESTONE_COST) })}
                style={owner ? { ['--pc' as string]: s.players[owner.pid].color } : undefined} data-owned={owner ? 'yes' : undefined}>
                {m.name}<span className="chip-sub">{owner ? `Claimed by ${s.players[owner.pid].name}` : `${m.text} (you: ${m.metric(s, pid)})`}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="ab-group">
        <h3>Awards <span className="muted">{s.awards.length < 3 ? `${awardCost(s)} M€, ${3 - s.awards.length} left` : 'all funded'}</span></h3>
        <div className="chips">
          {AWARDS.map((a) => {
            const funded = s.awards.find((x) => x.id === a.id);
            const lead = awardPlaces(s, a.id).first.map((i) => s.players[i].name).join(', ');
            return (
              <button key={a.id} type="button" className="btn small" disabled={!myTurn || !canFundAward(s, pid, a.id)} onClick={() => act({ t: 'award', id: a.id, pay: payHelion(awardCost(s)) })}
                style={funded ? { ['--pc' as string]: s.players[funded.pid].color } : undefined} data-owned={funded ? 'yes' : undefined}>
                {a.name}<span className="chip-sub">{a.text}. {funded ? 'Funded. ' : ''}Leading: {lead}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="ab-turn">
        {s.actionsThisTurn >= 1 && <button type="button" className="btn ghost" disabled={!myTurn} onClick={() => act({ t: 'endTurn' })}>End turn</button>}
        {panel === 'confirmPass' ? (
          <span className="confirm">Pass for the rest of this generation?
            <button type="button" className="btn danger" onClick={() => { setPanel(null); act({ t: 'pass' }); }}>Pass</button>
            <button type="button" className="btn ghost" onClick={() => setPanel(null)}>Keep playing</button>
          </span>
        ) : (
          <button type="button" className="btn" disabled={!myTurn} onClick={() => setPanel('confirmPass')}>Pass</button>
        )}
      </div>
    </section>
  );
}

function SellDialog({ s, pid, onClose, act }: { s: GameState; pid: number; onClose: () => void; act: (a: Action) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <Dialog title="Sell patents" onClose={onClose} wide
      footer={<button type="button" className="btn" disabled={!sel.length} onClick={() => act({ t: 'sp', id: 'sell', cards: sel })}>Sell {sel.length} for {sel.length} M€</button>}>
      <p>Discard any cards from your hand for 1 M€ each.</p>
      <div className="pick-grid">
        {s.players[pid].hand.map((id) => <Card key={id} id={id} s={s} pid={pid} selected={sel.includes(id)} onClick={() => toggle(id)} />)}
      </div>
    </Dialog>
  );
}

// ---------------- setup & research ----------------
function SetupDialog({ s, pid, act }: { s: GameState; pid: number; act: (a: Action) => void }) {
  const p = s.players[pid];
  const su = p.setup!;
  const [corp, setCorp] = useState(su.corps[0]);
  const [keep, setKeep] = useState<string[]>([]);
  const beginner = corp === 'beginner-corporation';
  const start = CARDS[corp].startMC!;
  const cost = beginner ? 0 : keep.length * 3;
  const toggle = (id: string) => setKeep((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <Dialog title={`${p.name}: found your corporation`} wide
      footer={<>
        <span className={cost > start ? 'warn' : 'muted'}>{beginner ? 'All 10 cards are free with the beginner corporation.' : `${keep.length} cards cost ${cost} M€, leaving ${start - cost} M€.`}</span>
        <button type="button" className="btn" disabled={cost > start} onClick={() => act({ t: 'setup', corp, keep: beginner ? [] : keep })}>Start with {CARDS[corp].name}</button>
      </>}>
      <h3>Corporation</h3>
      <div className="pick-grid corps">
        {su.corps.map((c, i) => <Card key={c} id={c} index={i} selected={corp === c} onClick={() => setCorp(c)} />)}
      </div>
      <h3>Starting cards {beginner ? '' : <span className="muted">3 M€ each</span>}</h3>
      <div className="pick-grid">
        {su.cards.map((id, i) => <Card key={id} id={id} index={i + 2} selected={beginner || keep.includes(id)} onClick={beginner ? undefined : () => toggle(id)} />)}
      </div>
    </Dialog>
  );
}

function ResearchDialog({ s, pid, act }: { s: GameState; pid: number; act: (a: Action) => void }) {
  const p = s.players[pid];
  const [keep, setKeep] = useState<string[]>([]);
  const toggle = (id: string) => setKeep((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const cost = keep.length * 3;
  return (
    <Dialog title={`${p.name}: research for generation ${s.generation}`} wide
      footer={<>
        <span className={cost > p.res.mc ? 'warn' : 'muted'}>{cost} M€ of your {p.res.mc} M€</span>
        <button type="button" className="btn" disabled={cost > p.res.mc} onClick={() => act({ t: 'research', keep })}>{keep.length ? `Buy ${keep.length}` : 'Buy none'}</button>
      </>}>
      <p>Buy any of these cards for 3 M€ each. The rest are discarded.</p>
      <div className="pick-grid">
        {(p.research ?? []).map((id, i) => <Card key={id} id={id} s={s} pid={pid} index={i} selected={keep.includes(id)} onClick={() => toggle(id)} />)}
      </div>
      <details className="hand-peek"><summary>Your hand ({p.hand.length})</summary>
        <div className="pick-grid">{p.hand.map((id) => <Card key={id} id={id} s={s} pid={pid} compact />)}</div>
      </details>
    </Dialog>
  );
}

// ---------------- prompts ----------------
function PromptDialog({ s, pr, act }: { s: GameState; pr: Prompt; act: (a: Action) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [amount, setAmount] = useState(pr.kind === 'amount' ? pr.max : 0);
  switch (pr.kind) {
    case 'player':
      return (
        <Dialog title={pr.title}>
          <div className="choice-list">
            {pr.options.map((id) => {
              const q = s.players[id];
              return (
                <button key={id} type="button" className="btn choice" style={{ ['--pc' as string]: q.color }} onClick={() => act({ t: 'answer', player: id })}>
                  <span className="swatch" />{q.name}{id === pr.pid ? ' (yourself)' : ''}
                  <span className="chip-sub">{RES_LABEL.mc} {q.res.mc}, steel {q.res.steel}, titanium {q.res.titanium}, plants {q.res.plants}; production M€ {q.prod.mc}, plants {q.prod.plants}, energy {q.prod.energy}, heat {q.prod.heat}</span>
                </button>
              );
            })}
            {pr.optional && <button type="button" className="btn ghost" onClick={() => act({ t: 'answer', player: null })}>Skip</button>}
          </div>
        </Dialog>
      );
    case 'card':
      return (
        <Dialog title={pr.title} wide>
          <div className="pick-grid">
            {pr.options.map((id) => {
              const owner = s.players.find((q) => q.played.includes(id));
              return <Card key={id} id={id} resources={owner?.cardRes[id] ?? 0} onClick={() => act({ t: 'answer', card: id })} footer={owner && owner.id !== pr.pid ? <div className="card-owner" style={{ color: owner.color }}>{owner.name}</div> : undefined} />;
            })}
          </div>
          {pr.optional && <button type="button" className="btn ghost" onClick={() => act({ t: 'answer', card: null })}>Skip</button>}
        </Dialog>
      );
    case 'choice':
      return (
        <Dialog title={pr.title}>
          <div className="choice-list">
            {pr.options.map((o, i) => <button key={i} type="button" className="btn choice" disabled={!o.ok} onClick={() => act({ t: 'answer', option: i })}>{o.label}</button>)}
          </div>
        </Dialog>
      );
    case 'cards': {
      const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= pr.max ? [...x.slice(1), id] : [...x, id]));
      const ok = sel.length >= pr.min && sel.length <= pr.max && sel.length * pr.costEach <= s.players[pr.pid].res.mc;
      return (
        <Dialog title={pr.title} wide footer={<button type="button" className="btn" disabled={!ok} onClick={() => act({ t: 'answer', cards: sel })}>
          {pr.costEach ? (sel.length ? `Buy for ${sel.length * pr.costEach} M€` : 'Discard it') : pr.item.op.k === 'discardDraw' ? (sel.length ? 'Discard and draw' : 'Keep my hand') : `Keep ${sel.length}`}
        </button>}>
          {pr.max === 0 && pr.costEach > 0 && <p className="warn">You can’t afford it, so it will be discarded.</p>}
          <div className="pick-grid">
            {pr.cards.map((id, i) => <Card key={id} id={id} s={s} pid={pr.pid} index={i} selected={sel.includes(id)} onClick={pr.max > 0 ? () => toggle(id) : undefined} />)}
          </div>
        </Dialog>
      );
    }
    case 'amount':
      return (
        <Dialog title={pr.title} footer={<button type="button" className="btn" onClick={() => act({ t: 'answer', amount })}>Confirm {amount}</button>}>
          <input type="range" min={0} max={pr.max} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Amount" className="range" />
          <output className="big-num">{amount}</output>
        </Dialog>
      );
    default:
      return null;
  }
}

// ---------------- online seats (host) ----------------
function SeatsDialog({ s, online, onClose }: { s: GameState; online: OnlineLink; onClose: () => void }) {
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
            {i === online.seat ? <span className="muted">You</span> : (
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

// ---------------- tableau ----------------
function TableauDialog({ s, pid, onClose }: { s: GameState; pid: number; onClose: () => void }) {
  const p = s.players[pid];
  const [showEvents, setShowEvents] = useState(false);
  const cards = p.played.filter((id) => showEvents || CARDS[id].type !== 'event');
  return (
    <Dialog title={`${p.name}: cards in play`} onClose={onClose} wide>
      <div className="pick-grid">
        {p.corp && <Card id={p.corp} />}
        {cards.map((id) => <Card key={id} id={id} s={s} pid={pid} resources={p.cardRes[id]} compact={CARDS[id].type === 'event'} />)}
      </div>
      <label className="check"><input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} /> Show played events ({p.played.filter((id) => CARDS[id].type === 'event').length})</label>
    </Dialog>
  );
}

// ---------------- game over ----------------
function GameOver({ s, onExit }: { s: GameState; onExit: () => void }) {
  const rows = useMemo(() => s.players.map((p) => ({ p, sc: score(s, p.id) })).sort((a, b) => b.sc.total - a.sc.total || b.p.res.mc - a.p.res.mc), [s]);
  return (
    <Dialog title={`${rows[0].p.name} wins`} wide footer={<button type="button" className="btn" onClick={onExit}>Back to menu</button>}>
      <div className="gameover-head" style={{ ['--pc' as string]: rows[0].p.color }}>
        <svg className="gameover-crown" viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
          <polygon points="24,3 43,14 43,34 24,45 5,34 5,14" fill="var(--pc)" stroke="#1d2840" strokeWidth="2" />
          <path d="M13 31 15 18l6 6 3-9 3 9 6-6 2 13Z" fill="#f6e8cf" stroke="#1d2840" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <p>Mars was terraformed in {s.generation} generations. {rows[0].p.name} finishes with {rows[0].sc.total} VP.</p>
      </div>
      <table className="scores">
        <thead><tr><th>Player</th><th>TR</th><th>Milestones</th><th>Awards</th><th>Greeneries</th><th>Cities</th><th>Cards</th><th>Total</th></tr></thead>
        <tbody>
          {rows.map(({ p, sc }) => (
            <tr key={p.id} style={{ ['--pc' as string]: p.color }}>
              <th scope="row"><span className="swatch" />{p.name}<small>{p.corp ? CARDS[p.corp].name : ''}</small></th>
              <td>{sc.tr}</td><td>{sc.milestones}</td><td>{sc.awards}</td><td>{sc.greeneries}</td><td>{sc.cities}</td><td>{sc.cards}</td><td><b>{sc.total}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Ties go to the player with the most M€ left.</p>
    </Dialog>
  );
}

export { maxSpend };
