import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameState, Level, Payment, Prompt, StdProject } from '../engine/types';
import { maxTemp } from '../engine/board';
import { Analytics } from './Analytics';
import { applyAction, heatAvailable } from '../engine/game';
import { CARDS } from '../engine/cards';
import { inPlay } from '../engine/helpers';
import { cpuAction } from '../engine/ai/cpu';
import {
  activeCards, autoPay, availableSpaces, canPlayCard, canSP,
  cardActionAvailable, cardCost, checkPayment, greeneryCost, maxSpend, opsFeasible, payLimitsForCard,
  requirementsMet, score, spCost, SP_NAME, steelValue, titaniumValue, type PayLimits, buyCost, spList, redsTax, payStock,
} from '../engine/queries';
import { ColoniesPanel, TurmoilPanel } from './Expansions';
import { Board } from './Board';
import { Card } from './Card';
import { Coin, FxLine, TempGlyph, TileGlyph } from './Symbols';
import { cardRows, SP_LINES } from './cardFx';
import { ResIcon } from './Icons';
import { Dialog } from './Dialog';
import { HowToPlay } from './HowToPlay';
import { Gauges } from './Gauges';
import { MeBar, Players } from './Players';
import { Sheet } from './Sheet';
import { loadTableauView, Tableau, type TableauView } from './Tableau';
import { MAPanel } from './MA';
import { StartPicker } from './StartPicker';
import { LogPanel } from './LogPanel';
import { buildReplay, loadSeen, replayStart, saveSeen, type Replay } from './replay';
import { fmtTemp, RES_LABEL, resLabel } from './format';
import { cloudEnabled, currentCloudId, putSave, useSession } from '../cloud';
import { BannerView, CardShowcase, Confetti, diffEvents, FxContext, loadFxSetting, saveFxSetting, Toasts, type Banner, type Showcase, type Toast } from './Fx';
import type { SeatRow } from '../online/protocol';
import { regolithSaves } from './saves';
import { NextGameButton } from '../shell/NextGame';
import { ForfeitDialog, forfeitText } from '../shell/Forfeit';
import { forfeit as forfeitLocal, ranking } from '../engine/game';

/** What an online game gives the board: the server's view for your seat and a way to move. */
export interface OnlineLink {
  room: string;
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
  /** give up your seat for good */
  forfeit: () => Promise<void>;
}

interface Entry { s: GameState; actor: number | null }
interface Draft { base: GameState; version?: number; steps: { a: Action; s: GameState }[]; committing?: boolean }

const deciderOf = (s: GameState) => (s.prompt ? s.prompt.pid : s.active);

export function Game({ initial, onExit, online, saveId }: { initial: GameState; onExit: () => void; online?: OnlineLink; saveId?: string }) {
  const [hist, setHist] = useState<Entry[]>([{ s: online?.view ?? initial, actor: null }]);
  /** the game as the server (or this device's save) has it */
  const live = hist[hist.length - 1].s;
  // your turn is played as a draft first: every step can be undone until you confirm the turn,
  // except steps that reveal cards (draws), which are confirmed on their own and lock it in
  const [draft, setDraft] = useState<Draft | null>(null);
  const [risky, setRisky] = useState<Action | null>(null);
  /** what the table shows and the controls act on: your draft, or the game */
  const s = draft?.steps[draft.steps.length - 1]?.s ?? live;
  const humans = s.players.filter((p) => !p.cpu).map((p) => p.id);
  const [localViewer, setViewer] = useState<number | null>(humans.length === 1 ? humans[0] : null);
  const viewer = online ? (online.seat >= 0 ? online.seat : null) : localViewer;
  const [error, setError] = useState<string | null>(null);
  const [cpuSpeed, setCpuSpeed] = useState(450);
  const [viewCards, setViewCards] = useState<number | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'projects' | 'sell' | 'confirmPass'>(null);
  const [tabView, setTabView] = useState<TableauView>(loadTableauView);
  // catch-up replay: while it runs, the table shows rebuilt earlier frames and nobody can act
  const [replay, setReplay] = useState<{ r: Replay; i: number; playing: boolean } | null>(null);
  const view = replay ? replay.r.frames[replay.i] : s;
  const decider = deciderOf(s);
  const dp = s.players[decider];
  const over = s.phase === 'over';
  const myTurn = !over && !dp.cpu && viewer === decider && !replay;

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
  const rawAct = online ? onlineAct : localAct;

  // ---- drafting your turn ----
  const draftable = (cur: GameState) => viewer !== null && !replay && (cur.phase === 'action' || cur.phase === 'finalGreenery')
    && deciderOf(cur) === viewer && cur.active === viewer && !cur.players[viewer].cpu;
  const pushDraft = (a: Action, next: GameState) => {
    lastOp.current = 'act';
    setError(null);
    setDraft((d) => ({ base: d?.base ?? live, version: d ? d.version : online?.version, steps: [...(d?.steps ?? []), { a, s: next }] }));
  };
  /** Sends the draft (plus one more action) to the game for good. */
  const commit = async (extra?: Action) => {
    const steps = draft?.steps ?? [];
    const actions = [...steps.map((x) => x.a), ...(extra ? [extra] : [])];
    if (!actions.length) { setDraft(null); return; }
    if (!online) {
      const top = steps[steps.length - 1]?.s ?? live;
      let fin: GameState | null = null;
      if (extra) {
        try { fin = applyAction(top, extra); } catch (e) { setError((e as Error).message); return; }
      }
      const actor = deciderOf(draft?.base ?? live);
      if (fin) lastOp.current = 'act';
      setHist((h) => [...h, ...steps.map((x) => ({ s: x.s, actor })), ...(fin ? [{ s: fin, actor }] : [])].slice(-80));
      setDraft(null);
      return;
    }
    setDraft((d) => (d ? { ...d, committing: true } : { base: live, steps: [], committing: true }));
    setSending(true);
    setError(null);
    try {
      for (const a of actions) await sendRef.current!(a);
    } catch (e) {
      setError(`${(e as Error).message} Your turn was reloaded from the server.`);
    } finally {
      setSending(false);
      setDraft(null);
    }
  };
  const act = (a: Action) => {
    if (!draftable(s)) { rawAct(a); return; }
    let next: GameState | null = null;
    try { next = applyAction(s, a); } catch (e) {
      // online the deck is hidden from you, so a step that draws can't be tried here
      if (!online) { setError((e as Error).message); return; }
    }
    if (!next || next.reveal !== s.reveal) { setRisky(a); return; }
    pushDraft(a, next);
  };
  const undoStep = () => {
    lastOp.current = 'undo';
    setDraft((d) => (d && d.steps.length > 1 ? { ...d, steps: d.steps.slice(0, -1) } : null));
  };
  // the game moved on without you (a seat change, a forfeit): drop a draft built on the old one
  const liveVersion = online?.version;
  useEffect(() => {
    if (!draft || draft.committing) return;
    if (online ? draft.version !== liveVersion : draft.base !== live) setDraft(null);
  }, [live, liveVersion, draft, online]);
  const drafting = !!draft && draft.steps.length > 0 && !draft.committing;
  const turnReady = drafting && (deciderOf(s) !== viewer || s.phase !== draft!.base.phase || s.generation !== draft!.base.generation);

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

  useEffect(() => { if (!online && saveId) regolithSaves.save(saveId, live); }, [live, online, saveId]);

  // cloud sync: a couple of seconds after the last change (right away when the game ends)
  const session = useSession();
  const cloudId = useMemo(() => (cloudEnabled ? saveId ?? currentCloudId() : ''), [saveId]);
  const [cloud, setCloud] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => {
    if (!cloudEnabled || !session || online) return;
    const t = setTimeout(() => {
      setCloud('saving');
      putSave(cloudId, live).then(() => setCloud('saved'), () => setCloud('error'));
    }, live.phase === 'over' ? 0 : 2500);
    return () => clearTimeout(t);
  }, [live, session, cloudId, online]);

  // ---- effects: turn each state change into showcases, tile drops, toasts and banners ----
  const [fxOn, setFxOn] = useState(loadFxSetting);
  const [show, setShow] = useState<Showcase | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [pulse, setPulse] = useState<{ kind: 'temp' | 'oxy' | 'ocean'; key: number } | null>(null);
  const prevS = useRef(view);
  const fxKey = useRef(0);
  const holdRef = useRef(0);
  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++fxKey.current;
    setToasts((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.tone === 'trophy' ? 3600 : 2600);
  }, []);
  useEffect(() => {
    const a = prevS.current;
    const s = view;
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
  }, [view]);
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
  const replaying = !!replay;
  const liveDp = live.players[deciderOf(live)];
  const holding = replaying || !!draft;
  useEffect(() => {
    const s = live, dp = liveDp, over = live.phase === 'over';
    if (over || !dp.cpu || holding) return;
    const base = s.prompt ? Math.min(250, cpuSpeed) : cpuSpeed;
    if (onlineVersion !== undefined) {
      const v = onlineVersion;
      const t = setTimeout(() => advanceRef.current!(v), base + holdRef.current + (onlineHost ? 0 : 6000));
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => rawAct(cpuAction(s, dp.cpu!)), base + holdRef.current);
    return () => clearTimeout(t);
  }, [live, liveDp, rawAct, cpuSpeed, onlineVersion, onlineHost, holding]);

  // with several humans, hide hands between them
  const needsHandoff = !online && !over && !dp.cpu && viewer !== decider && !replay && !draft;
  useEffect(() => {
    if (needsHandoff && humans.length === 1) setViewer(decider);
  }, [needsHandoff, humans.length, decider]);


  // online, corporation and research picks are made at the same time, not in turn order
  const meP = viewer !== null ? s.players[viewer] : null;
  const picking = !replay && (online
    ? !!meP && !s.prompt && !online.queued.includes(meP.id) && ((s.phase === 'setup' && !!meP.setup) || (s.phase === 'research' && !!meP.research))
    : myTurn);
  const canAct = myTurn && !sending;
  const pr = canAct ? s.prompt : null;
  const [seatsOpen, setSeatsOpen] = useState(false);
  const choosingStart = picking && !sending && s.phase === 'setup';
  const spacePrompt = pr?.kind === 'space' ? pr : null;
  const me = viewer !== null ? s.players[viewer] : null;

  // forfeit: online, your own seat; at one device, any human still playing
  const [forfeiting, setForfeiting] = useState(false);
  const [help, setHelp] = useState(false);
  const hasExpansions = Object.values(s.options.expansions ?? {}).some(Boolean);
  const forfeitable = over ? [] : online
    ? (me && !me.forfeited && online.seats[me.id]?.kind === 'human' ? [{ id: me.id, name: me.name }] : [])
    : s.players.filter((p) => !p.cpu && !p.forfeited).map((p) => ({ id: p.id, name: p.name }));
  const doForfeit = async (pid: number) => {
    if (online) { await online.forfeit(); return; }
    lastOp.current = 'act';
    setHist((h) => [...h.slice(-80), { s: forfeitLocal(h[h.length - 1].s, pid), actor: null }]);
  };
  // online, your turn is done once the game stops waiting on you: offer the next game
  const turnDone = !!online && !over && online.seat >= 0 && !!me && !me.forfeited && !online.waiting.includes(online.seat) && !sending;
  const gameKey = online ? `regolith:room:${online.room}` : saveId ? `regolith:local:${saveId}` : null;

  // what this device last showed: moves made while you were away can be replayed to catch up
  const latestN = s.log[s.log.length - 1]?.n ?? -1;
  const latestRef = useRef(latestN);
  latestRef.current = latestN;
  /** log entries (by running number) made while this game wasn't on screen */
  const [missed, setMissed] = useState<{ after: number; upTo: number } | null>(() => {
    const seen = gameKey ? loadSeen(gameKey) : null;
    return seen !== null && seen < latestN ? { after: seen, upTo: latestN } : null;
  });
  useEffect(() => { if (gameKey && document.visibilityState !== 'hidden') saveSeen(gameKey, latestN); }, [gameKey, latestN]);
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = latestRef.current;
      else if (hiddenAt !== null) {
        const after = hiddenAt;
        hiddenAt = null;
        if (latestRef.current > after) setMissed((m) => ({ after: m ? Math.min(m.after, after) : after, upTo: latestRef.current }));
        if (gameKey) saveSeen(gameKey, latestRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [gameKey]);
  const missedFrom = missed ? s.log.findIndex((l) => (l.n ?? -1) > missed.after) : -1;
  const catchUp = missedFrom < 0 ? 0 : s.log.slice(missedFrom).filter((l) => (l.n ?? -1) <= missed!.upTo && l.pid !== null && l.pid !== viewer).length;
  const startReplay = () => {
    const from = catchUp > 0 ? Math.max(missedFrom, s.log.length - 40) : replayStart(s, viewer);
    if (from >= s.log.length) return;
    setMissed(null);
    setShow(null); setBanner(null);
    setReplay({ r: buildReplay(s, from), i: 0, playing: true });
  };
  const stopReplay = useCallback(() => setReplay(null), []);
  useEffect(() => {
    if (!replay || !replay.playing) return;
    const last = replay.r.frames.length - 1;
    const next = s.log[replay.r.from + replay.i];
    const pace = cpuSpeed >= 900 ? 1.3 : cpuSpeed <= 120 ? 0.6 : 1;
    const busy = next?.fx?.p?.some((e) => e.played?.length || e.corp) ? 1900 : next?.fx?.tiles ? 1300 : 900;
    const delay = replay.i >= last ? 900 : (replay.i === 0 ? 600 : 0) + (fxOn ? busy : 700) * pace;
    const t = setTimeout(() => {
      if (replay.i >= last) { setReplay(null); return; }
      lastOp.current = 'act';
      setReplay({ ...replay, i: replay.i + 1 });
    }, delay);
    return () => clearTimeout(t);
  }, [replay, s.log, cpuSpeed, fxOn]);
  const stepReplay = () => {
    if (!replay) return;
    if (replay.i >= replay.r.frames.length - 1) { setReplay(null); return; }
    lastOp.current = 'act';
    setReplay({ ...replay, i: replay.i + 1, playing: false });
  };
  const replayEntry = replay && replay.i > 0 ? s.log[replay.r.from + replay.i - 1] : null;

  return (
    <FxContext.Provider value={fxOn}>
    <div className="game" data-fx={fxOn ? 'on' : 'off'}>
      <header className="topbar">
        <div className="brand">Regolith</div>
        <div className="gen">Generation <b>{s.generation}</b></div>
        <Status s={s} viewer={viewer} online={online} awaiting={turnReady} />
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
          {online && (
            <>
              <span className="room-code" title="Friends join with this code">Game <b>{online.code}</b></span>
              {online.host && !over && <button type="button" className="btn ghost" onClick={() => setSeatsOpen(true)}>Seats</button>}
            </>
          )}
          <button type="button" className="btn ghost" onClick={undoStep} disabled={!drafting} title="Undo your last step this turn (not after cards are drawn)">Undo</button>
          <button type="button" className="btn ghost" onClick={replay ? stopReplay : startReplay} disabled={!replay && (!s.log.length || !!draft)}
            title="Watch the latest moves again on the board">{replay ? 'Stop replay' : 'Replay'}</button>
          {hasExpansions && <button type="button" className="btn ghost" onClick={() => setHelp(true)} title="How to play this game's expansions">How to play</button>}
          {forfeitable.length > 0 && <button type="button" className="btn ghost" onClick={() => setForfeiting(true)}>Forfeit</button>}
          <NextGameButton current={gameKey} turnDone={turnDone} />
          <button type="button" className="btn ghost" onClick={onExit}>Menu</button>
        </div>
      </header>

      {me && <MeBar s={view} pid={me.id} />}

      {error && <div className="error" role="alert">{error}<button type="button" className="icon-btn" onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}

      {choosingStart ? <StartPicker s={s} pid={online ? viewer! : decider} act={act} onHelp={hasExpansions ? () => setHelp(true) : undefined} /> : (
      <main className="table">
        <div className="map-col">
          <Gauges s={view} />
          <div className="map-area">
            {spacePrompt && <div className="place-banner" role="status">{spacePrompt.title}: choose a highlighted space.</div>}
            <Board s={view} options={spacePrompt?.options} onPick={(id) => act({ t: 'answer', space: id })} fresh={fresh} pulse={fxOn ? pulse : null} />
          </div>
        </div>

        <aside className="side">
          <Players s={view} viewer={viewer} onView={setViewCards} queued={online?.queued} />
          <MAPanel s={view} viewer={viewer} canAct={canAct && s.phase === 'action' && !s.prompt && !s.pendingAction} act={act} />
          <ColoniesPanel s={view} viewer={viewer} canAct={canAct && s.phase === 'action' && !s.prompt && !s.pendingAction} act={act} />
          <TurmoilPanel s={view} viewer={viewer} canAct={canAct && s.phase === 'action' && !s.prompt && !s.pendingAction} act={act} />
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
          {me && <Tableau s={view} pid={me.id} view={tabView} setView={setTabView} title="Your cards in play" />}
          {!me && !over && <p className="muted pad">{online ? 'You are watching this game.' : 'Hands stay hidden until a player takes the device.'}</p>}
          {online && me && !over && !picking && !myTurn && !replay && (s.phase === 'setup' || s.phase === 'research') && (
            <p className="muted pad waiting-note" role="status">Your {s.phase === 'setup' ? 'corporation' : 'research'} is in. It applies when your turn comes round.</p>
          )}
        </section>
      </main>
      )}

      {needsHandoff && humans.length > 1 && (
        <Dialog title={`Pass the device to ${dp.name}`}>
          <p>{dp.name} has a decision to make. Other players, look away while they play.</p>
          <button type="button" className="btn big" onClick={() => setViewer(decider)}>I'm {dp.name}, show my hand</button>
        </Dialog>
      )}
      {picking && !sending && s.phase === 'research' && !s.prompt && <ResearchDialog s={s} pid={online ? viewer! : decider} act={act} onHelp={hasExpansions ? () => setHelp(true) : undefined} />}
      {canAct && s.phase === 'prelude' && !s.prompt && !s.pendingAction && <PreludeDialog s={s} pid={decider} act={act} />}
      {seatsOpen && online && <SeatsDialog s={s} online={online} onClose={() => setSeatsOpen(false)} />}
      {pr && pr.kind !== 'space' && <PromptDialog s={s} pr={pr} act={act} />}
      {openCard && me && <CardDialog s={s} pid={me.id} id={openCard} canAct={canAct && s.phase === 'action' && !s.prompt && !s.pendingAction} onClose={() => setOpenCard(null)} act={(a) => { setOpenCard(null); act(a); }} />}
      {viewCards !== null && <TableauDialog s={view} pid={viewCards} viewer={viewer} onClose={() => setViewCards(null)} />}
      {panel === 'sell' && me && <SellDialog s={s} pid={me.id} onClose={() => setPanel(null)} act={(a) => { setPanel(null); act(a); }} />}
      {forfeiting && (
        <ForfeitDialog seats={forfeitable} initial={viewer ?? decider} onClose={() => setForfeiting(false)} onConfirm={doForfeit}
          consequence={(id) => forfeitText(s.players, id, !!online || forfeitable.length === 1)} />
      )}
      {help && <HowToPlay onClose={() => setHelp(false)} inGame={s.options.expansions} />}
      {over && <GameOver s={s} onExit={onExit} />}
      {over && fxOn && <Confetti colors={s.players.map((p) => p.color)} />}
      {show && <CardShowcase key={show.key} show={show} s={view} onDone={endShow} fast={cpuSpeed <= 120} />}
      {banner && <BannerView key={banner.key} b={banner} onDone={endBanner} />}
      <Toasts items={toasts} s={view} />
      {drafting && (
        <div className={`turn-bar ${turnReady ? 'ready' : ''}`} role="status" aria-live="polite">
          <span className="turn-text">
            {turnReady
              ? <><b>End your turn?</b> Nothing is sent until you confirm.</>
              : <>{draft!.steps.length} step{draft!.steps.length === 1 ? '' : 's'} this turn, not confirmed yet.</>}
          </span>
          <span className="turn-tools">
            <button type="button" className="btn ghost" onClick={undoStep}>Undo</button>
            <button type="button" className={`btn ${turnReady ? '' : 'ghost'}`} onClick={() => commit()}>{turnReady ? 'Confirm turn' : 'Confirm so far'}</button>
          </span>
        </div>
      )}
      {risky && (
        <Dialog title="This can’t be undone" onClose={() => setRisky(null)}
          footer={<>
            <button type="button" className="btn ghost" onClick={() => setRisky(null)}>Cancel</button>
            <button type="button" className="btn" onClick={() => { const a = risky; setRisky(null); commit(a); }}>Go ahead</button>
          </>}>
          <p>This step reveals new cards, so it can’t be taken back.{drafting ? ' The rest of your turn so far is confirmed with it.' : ''}</p>
        </Dialog>
      )}
      {replay && (
        <div className="replay-bar" role="status" aria-live="polite">
          <span className="replay-count">Replay {replay.i}/{replay.r.frames.length - 1}</span>
          <span className="replay-text" style={replayEntry?.pid != null ? { ['--pc' as string]: s.players[replayEntry.pid].color } : undefined}>
            {replayEntry ? (replayEntry.text || `${s.players[replayEntry.pid ?? 0]?.name ?? ''}: effect resolved`) : 'Starting…'}
          </span>
          <span className="replay-tools">
            <button type="button" className="btn small ghost" onClick={() => setReplay({ ...replay, playing: !replay.playing })}>{replay.playing ? 'Pause' : 'Play'}</button>
            <button type="button" className="btn small ghost" onClick={stepReplay}>Next</button>
            <button type="button" className="btn small" onClick={stopReplay}>Done</button>
          </span>
        </div>
      )}
      <LogPanel s={view} viewer={viewer} onReplay={replay ? undefined : startReplay} catchUp={replay ? 0 : catchUp} onDismissCatchUp={() => setMissed(null)} />
    </div>
    </FxContext.Provider>
  );
}

// ---------------- status line ----------------
function Status({ s, viewer, online, awaiting }: { s: GameState; viewer: number | null; online?: OnlineLink; awaiting?: boolean }) {
  if (awaiting && viewer !== null) {
    return <div className="status" role="status" aria-live="polite" style={{ ['--pc' as string]: s.players[viewer].color }}><span className="swatch" />Confirm your turn</div>;
  }
  const d = s.players[deciderOf(s)];
  let text: string;
  const names = (ids: number[]) => ids.map((i) => (i === viewer ? 'you' : s.players[i].name)).join(', ');
  if (online && (s.phase === 'setup' || s.phase === 'research') && !s.prompt && online.waiting.length) {
    const ids = online.waiting;
    const what = s.phase === 'setup' ? 'founding corporations' : 'buying research';
    text = ids.length === 1 && ids[0] === viewer ? `Your move: ${what}` : `Waiting on ${names(ids)}: ${what}`;
    return <div className="status" role="status" aria-live="polite" style={{ ['--pc' as string]: s.players[ids[0]].color }}><span className="swatch" />{text}</div>;
  }
  const isYou = d.id === viewer && !d.cpu;
  if (s.phase === 'over') text = 'Game over';
  else if (s.phase === 'setup') text = isYou ? 'Choose your corporation' : `${d.name} is choosing a corporation`;
  else if (s.phase === 'research') text = isYou ? 'Buy your research cards' : `${d.name} is buying research cards`;
  else if (s.phase === 'prelude') text = `${d.name} is playing preludes`;
  else if (s.phase === 'finalGreenery') text = `${d.name} is placing final greeneries`;
  else text = `${d.name}'s turn`;
  if (d.cpu && s.phase !== 'over') text += '…';
  else if (viewer === d.id && s.phase === 'action') text = 'Your turn';
  else if (online && s.phase !== 'over' && !d.cpu) text = `Waiting on ${d.name}`;
  return <div className="status" role="status" aria-live="polite" style={{ ['--pc' as string]: d.color }}><span className="swatch" />{text}</div>;
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
  const rows: { key: 'steel' | 'titanium' | 'heat' | 'floaters' | 'microbes'; label: string; unit: number; have: number }[] = [];
  if (lim.steel && p.res.steel) rows.push({ key: 'steel', label: 'Steel', unit: steelValue(s, pid), have: p.res.steel });
  if (lim.titanium && p.res.titanium) rows.push({ key: 'titanium', label: 'Titanium', unit: titaniumValue(s, pid), have: p.res.titanium });
  if (lim.heat && p.res.heat) rows.push({ key: 'heat', label: 'Heat', unit: 1, have: p.res.heat });
  if (lim.floaters && payStock(s, pid, 'floaters')) rows.push({ key: 'floaters', label: 'Floaters on Dirigibles', unit: 3, have: payStock(s, pid, 'floaters') });
  if (lim.microbes && payStock(s, pid, 'microbes')) rows.push({ key: 'microbes', label: 'Microbes on Psychrophiles', unit: 2, have: payStock(s, pid, 'microbes') });
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
const SP_EFFECT: Record<StdProject, string> = {
  sell: 'Discard cards for 1 M€ each', power: '+1 energy production', asteroid: 'Raise temperature', aquifer: 'Place an ocean', greenery: 'Place a greenery', city: 'Place a city, +1 M€ production',
  venus: 'Raise Venus 1 step', colony: 'Place a colony',
};

/** A card's action as a symbol line, if it has one. */
const actionLine = (id: string) => cardRows(id).find((r) => r.kind === 'action');

function ActionBar({ s, pid, myTurn, act, panel, setPanel }: { s: GameState; pid: number; myTurn: boolean; act: (a: Action) => void; panel: string | null; setPanel: (p: null | 'projects' | 'sell' | 'confirmPass') => void }) {
  const p = s.players[pid];
  const actions = activeCards(s, pid).filter((c) => c.action);
  const helion = p.corp === 'helion';
  const payHelion = (cost: number): Payment | undefined => (helion ? autoPay(s, pid, cost, { steel: false, titanium: false, heat: true }) ?? undefined : undefined);
  return (
    <section className="actionbar" aria-label="Actions">
      <div className="ab-group">
        <h3>Convert</h3>
        <button type="button" className="btn small sp-btn" disabled={!myTurn || p.res.plants < greeneryCost(s, pid) || !availableSpaces(s, pid, 'greenery', 'greenery').length} onClick={() => act({ t: 'plants' })}
          aria-label={`${greeneryCost(s, pid)} plants to greenery`} title={`${greeneryCost(s, pid)} plants → greenery`}>
          <b>{greeneryCost(s, pid)}</b><ResIcon r="plants" size={16} /><span className="fx-arrow" aria-hidden="true">➜</span><TileGlyph tile="greenery" size={17} />
        </button>
        <button type="button" className="btn small sp-btn" disabled={!myTurn || heatAvailable(s, pid) < 8 || s.temperature >= maxTemp(s) || p.res.mc < redsTax(s, 1)} onClick={() => act({ t: 'heat' })}
          aria-label={`8 heat to raise temperature to ${fmtTemp(Math.min(maxTemp(s), s.temperature + 2))}`} title={`8 heat → ${fmtTemp(Math.min(maxTemp(s), s.temperature + 2))}`}>
          <b>8</b><ResIcon r="heat" size={16} /><span className="fx-arrow" aria-hidden="true">➜</span><TempGlyph size={17} /><span className="chip-sub">{fmtTemp(Math.min(maxTemp(s), s.temperature + 2))}</span>
        </button>
        {s.turmoil?.ruling === 'reds' && <span className="chip-note warn">Reds rule: 3 M€ per TR you raise</span>}
      </div>
      <div className="ab-group">
        <h3>Standard projects</h3>
        <div className="chips">
          {spList(s).map((id) => (
            <button key={id} type="button" className="btn small sp-btn" disabled={!myTurn || !canSP(s, pid, id)} title={SP_EFFECT[id]} onClick={() => act({ t: 'sp', id, pay: payHelion(spCost(s, pid, id)) })}
              aria-label={`${SP_NAME[id]}, ${spCost(s, pid, id)} M€: ${SP_EFFECT[id]}`}>
              {SP_NAME[id]}
              <span className="sp-fx" aria-hidden="true">
                <Coin n={spCost(s, pid, id)} size={20} />
                {SP_LINES[id] && <><span className="fx-arrow">➜</span><FxLine l={SP_LINES[id]} /></>}
              </span>
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
                  {c.name}{used ? ' (used)' : ''}{c.resource && <span className="chip-res" title={`${p.cardRes[c.id] ?? 0} ${resLabel(c.resource, p.cardRes[c.id] ?? 0)} on this card`}>{p.cardRes[c.id] ?? 0} {resLabel(c.resource, p.cardRes[c.id] ?? 0)}</span>}<span className="chip-sub">{actionLine(c.id) ? <FxLine l={actionLine(c.id)!} /> : c.action!.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="ab-turn">
        {s.actionsThisTurn >= 1 && <button type="button" className="btn ghost" disabled={!myTurn} onClick={() => act({ t: 'endTurn' })}>End turn</button>}
        <button type="button" className="btn" disabled={!myTurn} onClick={() => act({ t: 'pass' })} title="Pass for the rest of this generation (you can undo it before confirming)">Pass</button>
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
function ResearchDialog({ s, pid, act, onHelp }: { s: GameState; pid: number; act: (a: Action) => void; onHelp?: () => void }) {
  const p = s.players[pid];
  const [keep, setKeep] = useState<string[]>([]);
  const toggle = (id: string) => setKeep((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const price = buyCost(s, pid);
  const cost = keep.length * price;
  return (
    <Sheet title={`Research for generation ${s.generation}`}
      summary={<span className={cost > p.res.mc ? 'warn' : 'muted'}>{keep.length} chosen · {cost} M€ of your {p.res.mc} M€</span>}
      actions={<button type="button" className="btn" disabled={cost > p.res.mc} onClick={() => act({ t: 'research', keep })}>{keep.length ? `Buy ${keep.length}` : 'Buy none'}</button>}>
      <p className="muted">{p.name}: buy any of these cards for {price} M€ each. The rest are discarded.</p>
      <div className="pick-grid">
        {(p.research ?? []).map((id, i) => <Card key={id} id={id} s={s} pid={pid} index={i} selected={keep.includes(id)} onClick={() => toggle(id)} />)}
      </div>
      <details className="hand-peek"><summary>Your hand ({p.hand.length})</summary>
        <div className="pick-grid">{p.hand.map((id) => <Card key={id} id={id} s={s} pid={pid} compact />)}</div>
      </details>
      {onHelp && <HelpLink onHelp={onHelp} />}
    </Sheet>
  );
}

const HelpLink = ({ onHelp }: { onHelp: () => void }) => (
  <p className="htp-link"><button type="button" className="linkish" onClick={onHelp}>How to play this game’s expansions</button></p>
);

function PreludeDialog({ s, pid, act }: { s: GameState; pid: number; act: (a: Action) => void }) {
  const p = s.players[pid];
  return (
    <Sheet title={`${p.name}: play your preludes`} summary={<span className="muted">Tap one to play it.</span>}>
      <p className="muted">Play them in either order. One that can’t be played in full is swapped for 15 M€.</p>
      <div className="pick-grid">
        {(p.preludes ?? []).map((id, i) => <Card key={id} id={id} s={s} pid={pid} index={i} onClick={() => act({ t: 'prelude', card: id })} />)}
      </div>
      {p.hand.length > 0 && (
        <details className="hand-peek"><summary>Your hand ({p.hand.length})</summary>
          <div className="pick-grid">{p.hand.map((id) => <Card key={id} id={id} s={s} pid={pid} compact />)}</div>
        </details>
      )}
    </Sheet>
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
        <Sheet title={pr.title} summary={<span className="muted">Tap a card to choose it.</span>}
          actions={pr.optional ? <button type="button" className="btn ghost" onClick={() => act({ t: 'answer', card: null })}>Skip</button> : undefined}>
          <div className="pick-grid">
            {pr.options.map((id) => {
              const owner = s.players.find((q) => inPlay(s, q.id, id));
              if (!owner) return <Card key={id} id={id} s={s} pid={pr.pid} onClick={() => act({ t: 'answer', card: id })} />;
              return <Card key={id} id={id} resources={owner.cardRes[id] ?? 0} onClick={() => act({ t: 'answer', card: id })} footer={owner.id !== pr.pid ? <div className="card-owner" style={{ color: owner.color }}>{owner.name}</div> : undefined} />;
            })}
          </div>
        </Sheet>
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
        <Sheet title={pr.title}
          summary={<span className="muted">{pr.min === pr.max ? `Choose ${pr.max}` : `Choose ${pr.min ? `${pr.min} to ` : 'up to '}${pr.max}`} · {sel.length} chosen{pr.costEach ? ` · ${sel.length * pr.costEach} M€ of your ${s.players[pr.pid].res.mc} M€` : ''}</span>}
          actions={<button type="button" className="btn" disabled={!ok} onClick={() => act({ t: 'answer', cards: sel })}>
            {pr.costEach ? (sel.length ? `Buy for ${sel.length * pr.costEach} M€` : 'Discard it') : pr.item.op.k === 'discardDraw' ? (sel.length ? 'Discard and draw' : 'Keep my hand') : `Keep ${sel.length}`}
          </button>}>
          {pr.max === 0 && pr.costEach > 0 && <p className="warn">You can’t afford it, so it will be discarded.</p>}
          <div className="pick-grid">
            {pr.cards.map((id, i) => <Card key={id} id={id} s={s} pid={pr.pid} index={i} selected={sel.includes(id)} onClick={pr.max > 0 ? () => toggle(id) : undefined} />)}
          </div>
        </Sheet>
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
const LEVEL_NAME = { easy: 'Easy CPU', normal: 'Normal CPU', hard: 'Hard CPU' } as const;

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
            {i === online.seat ? <span className="muted">You</span> : seat.forfeited || s.players[i].forfeited ? <span className="muted">Forfeited · {s.players[i].cpu ? LEVEL_NAME[s.players[i].cpu!] : 'CPU'}</span> : (
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
function TableauDialog({ s, pid, viewer, onClose }: { s: GameState; pid: number; viewer: number | null; onClose: () => void }) {
  const p = s.players[pid];
  const [view, setView] = useState<TableauView>(() => (loadTableauView() === 'grid' ? 'grid' : 'stack'));
  return (
    <Dialog title={`${pid === viewer ? 'Your' : `${p.name}’s`} cards in play`} onClose={onClose} wide>
      <Tableau s={s} pid={pid} view={view} setView={setView} title={p.corp ? CARDS[p.corp].name : 'Cards'} />
    </Dialog>
  );
}

// ---------------- game over ----------------
function GameOver({ s, onExit }: { s: GameState; onExit: () => void }) {
  const rows = useMemo(() => ranking(s, (pid) => score(s, pid)).map(({ pid, sc }) => ({ p: s.players[pid], sc })), [s]);
  return (
    <Dialog title={`${rows[0].p.name} wins`} wide footer={<button type="button" className="btn" onClick={onExit}>Back to menu</button>}>
      <div className="gameover-head" style={{ ['--pc' as string]: rows[0].p.color }}>
        <svg className="gameover-crown" viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
          <polygon points="24,3 43,14 43,34 24,45 5,34 5,14" fill="var(--pc)" stroke="#1d2840" strokeWidth="2" />
          <path d="M13 31 15 18l6 6 3-9 3 9 6-6 2 13Z" fill="#f6e8cf" stroke="#1d2840" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <p>{s.endedBy === 'forfeit' ? `The game ended early in generation ${s.generation} after players forfeited.` : `Mars was terraformed in ${s.generation} generations.`} {rows[0].p.name} finishes with {rows[0].sc.total} VP.</p>
      </div>
      <table className="scores">
        <thead><tr><th>Player</th><th>TR</th><th>Milestones</th><th>Awards</th><th>Greeneries</th><th>Cities</th><th>Cards</th><th>Total</th></tr></thead>
        <tbody>
          {rows.map(({ p, sc }) => (
            <tr key={p.id} style={{ ['--pc' as string]: p.color }}>
              <th scope="row"><span className="swatch" />{p.name}{p.forfeited && <span className="forfeit-tag"> · forfeited</span>}<small>{p.corp ? CARDS[p.corp].name : ''}</small></th>
              <td>{sc.tr}</td><td>{sc.milestones}</td><td>{sc.awards}</td><td>{sc.greeneries}</td><td>{sc.cities}</td><td>{sc.cards}</td><td><b>{sc.total}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Ties go to the player with the most M€ left.{rows.some((r) => r.p.forfeited) ? ' Forfeited players rank last.' : ''}</p>
      <Analytics s={s} />
    </Dialog>
  );
}

export { maxSpend };
