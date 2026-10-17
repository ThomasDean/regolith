// Visual effects: animated numbers, the card-play showcase, toasts, banners and confetti.
// Effects read state changes; they never touch the engine, so turning them off changes nothing
// about the game.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../engine/types';
import { CARDS } from '../engine/cards';
import { AWARDS, MILESTONES } from '../engine/queries';
import { Card } from './Card';
import { rng } from './CardArt';

// ---------- setting ----------
const FX_KEY = 'regolith-fx';
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function loadFxSetting(): boolean {
  try {
    const v = localStorage.getItem(FX_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch { /* storage unavailable */ }
  return !reduced();
}
export function saveFxSetting(on: boolean) {
  try { localStorage.setItem(FX_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
export const FxContext = createContext(true);
export const useFxOn = () => useContext(FxContext);

// ---------- animated numbers ----------
/** A number that counts to its new value and floats the change above itself. */
export function Num({ value, className, float = true }: { value: number; className?: string; float?: boolean }) {
  const on = useFxOn();
  const [shown, setShown] = useState(value);
  const [deltas, setDeltas] = useState<{ id: number; d: number }[]>([]);
  const prev = useRef(value);
  const nextId = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (!on) { setShown(value); return; }
    if (float) {
      const id = ++nextId.current;
      setDeltas((x) => [...x.slice(-2), { id, d: value - from }]);
      setTimeout(() => setDeltas((x) => x.filter((y) => y.id !== id)), 1400);
    }
    const t0 = performance.now();
    const dur = Math.min(700, 220 + Math.abs(value - from) * 30);
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      setShown(Math.round(from + (value - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, on, float]);
  return (
    <span className={`num ${className ?? ''} ${deltas.length ? 'num-hit' : ''}`}>
      {on ? shown : value}
      {deltas.map((x) => <span key={x.id} className={`num-float ${x.d > 0 ? 'up' : 'down'}`} aria-hidden="true">{x.d > 0 ? `+${x.d}` : x.d}</span>)}
    </span>
  );
}

// ---------- events from a state change ----------
export type FxEvent =
  | { k: 'card'; pid: number; card: string }
  | { k: 'tile'; space: string; kind: string; pid: number | null }
  | { k: 'param'; which: 'temp' | 'oxy' | 'ocean'; delta: number }
  | { k: 'milestone'; pid: number; name: string }
  | { k: 'award'; pid: number; name: string }
  | { k: 'generation'; gen: number; production: { pid: number; mc: number }[] }
  | { k: 'action'; pid: number; text: string }
  | { k: 'pass'; pid: number }
  | { k: 'terraformed' }
  | { k: 'over' };

export function diffEvents(a: GameState, b: GameState): FxEvent[] {
  const ev: FxEvent[] = [];
  for (const p of b.players) {
    const q = a.players[p.id];
    if (!q.corp && p.corp) ev.push({ k: 'card', pid: p.id, card: p.corp });
    for (const id of p.played.slice(q.played.length)) ev.push({ k: 'card', pid: p.id, card: id });
    if (!q.passed && p.passed && b.phase === 'action') ev.push({ k: 'pass', pid: p.id });
  }
  for (const sp of b.board) {
    const was = a.board.find((x) => x.id === sp.id);
    if (sp.tile && !was?.tile) ev.push({ k: 'tile', space: sp.id, kind: sp.tile.kind, pid: sp.tile.owner });
  }
  if (b.temperature !== a.temperature) ev.push({ k: 'param', which: 'temp', delta: b.temperature - a.temperature });
  if (b.oxygen !== a.oxygen) ev.push({ k: 'param', which: 'oxy', delta: b.oxygen - a.oxygen });
  if (b.oceans !== a.oceans) ev.push({ k: 'param', which: 'ocean', delta: b.oceans - a.oceans });
  for (const m of b.milestones.slice(a.milestones.length)) ev.push({ k: 'milestone', pid: m.pid, name: MILESTONES.find((x) => x.id === m.id)?.name ?? m.id });
  for (const w of b.awards.slice(a.awards.length)) ev.push({ k: 'award', pid: w.pid, name: AWARDS.find((x) => x.id === w.id)?.name ?? w.id });
  if (b.generation > a.generation) {
    ev.push({ k: 'generation', gen: b.generation, production: b.players.map((p) => ({ pid: p.id, mc: p.res.mc - a.players[p.id].res.mc })) });
  }
  if (a.phase !== 'finalGreenery' && b.phase === 'finalGreenery') ev.push({ k: 'terraformed' });
  if (a.phase !== 'over' && b.phase === 'over') ev.push({ k: 'over' });
  // other things players did, from the log (card plays get the showcase instead)
  if (!ev.some((e) => e.k === 'card' || e.k === 'milestone' || e.k === 'award' || e.k === 'generation')) {
    const fresh = b.log.length >= a.log.length ? b.log.slice(a.log.length) : [];
    const mine = fresh.filter((l) => l.pid !== null);
    if (mine.length && b.phase === 'action') ev.push({ k: 'action', pid: mine[0].pid!, text: mine[0].text });
  }
  return ev;
}

// ---------- card showcase ----------
export interface Showcase { key: number; pid: number; card: string; mine: boolean }

/** A played card swells to the centre of the screen, then flies to its player's panel. */
export function CardShowcase({ show, s, onDone, fast }: { show: Showcase; s: GameState; onDone: () => void; fast: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const p = s.players[show.pid];
  const c = CARDS[show.card];
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = document.querySelector(`[data-player-id="${show.pid}"]`)?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const dx = target ? target.left + target.width / 2 - (box.left + box.width / 2) : 0;
    const dy = target ? target.top + 30 - (box.top + box.height / 2) : -200;
    const dur = fast ? 900 : show.mine ? 1250 : 1750;
    const a = el.animate([
      { opacity: 0, transform: 'perspective(900px) translateY(80px) rotateY(-80deg) scale(0.5)' },
      { opacity: 1, transform: 'perspective(900px) translateY(0) rotateY(8deg) scale(1.06)', offset: 0.2 },
      { opacity: 1, transform: 'perspective(900px) rotateY(0) scale(1)', offset: 0.3 },
      { opacity: 1, transform: 'perspective(900px) rotateY(0) scale(1)', offset: 0.72 },
      { opacity: 0, transform: `perspective(900px) translate(${dx}px, ${dy}px) scale(0.12) rotate(${dx > 0 ? 10 : -10}deg)` },
    ], { duration: dur, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    glow.current?.animate([
      { opacity: 0, transform: 'scale(0.3) rotate(0deg)' },
      { opacity: 1, transform: 'scale(1) rotate(40deg)', offset: 0.25 },
      { opacity: 0.8, transform: 'scale(1.1) rotate(80deg)', offset: 0.7 },
      { opacity: 0, transform: 'scale(1.4) rotate(110deg)' },
    ], { duration: dur, easing: 'ease-out', fill: 'forwards' });
    a.onfinish = onDone;
    return () => a.cancel();
  }, [show, fast, onDone]);
  return (
    <div className="showcase" aria-hidden="true" style={{ ['--pc' as string]: p.color }}>
      <div className="showcase-glow" ref={glow} />
      <div className="showcase-card" ref={ref}>
        <div className="showcase-who"><span className="swatch" />{show.mine ? `You ${c.type === 'corp' ? 'found' : 'play'}` : `${p.name} ${c.type === 'corp' ? 'founds' : 'plays'}`}</div>
        <Card id={show.card} still />
      </div>
    </div>
  );
}

// ---------- toasts and banners ----------
export interface Toast { id: number; pid: number | null; text: string; tone: 'info' | 'trophy' | 'pass' }

export function Toasts({ items, s }: { items: Toast[]; s: GameState }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} style={t.pid !== null ? { ['--pc' as string]: s.players[t.pid].color } : undefined}>
          {t.tone === 'trophy' && (
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 3h12v4a6 6 0 0 1-12 0Zm0 1H2.5v2A3.5 3.5 0 0 0 6 9.5M18 4h3.5v2A3.5 3.5 0 0 1 18 9.5M12 13v4m-4 4h8l-1-4H9Z" fill="#e3b341" stroke="#5a3f08" strokeWidth="1.2" strokeLinejoin="round" /></svg>
          )}
          {t.pid !== null && t.tone !== 'trophy' && <span className="swatch" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export interface Banner { key: number; title: string; sub?: string; tone: 'gen' | 'turn' | 'terraformed' }

export function BannerView({ b, onDone }: { b: Banner; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, b.tone === 'turn' ? 1300 : 2300);
    return () => clearTimeout(t);
  }, [b, onDone]);
  return (
    <div className={`banner banner-${b.tone}`} aria-hidden="true">
      <div className="banner-sweep" />
      <div className="banner-text">
        <div className="banner-title">{b.title}</div>
        {b.sub && <div className="banner-sub">{b.sub}</div>}
      </div>
    </div>
  );
}

// ---------- confetti ----------
export function Confetti({ colors }: { colors: string[] }) {
  const bits = useMemo(() => {
    const r = rng(colors.length * 977 + 13);
    return Array.from({ length: 70 }, (_, i) => ({
      left: r() * 100,
      delay: r() * 1.6,
      dur: 2.6 + r() * 2.2,
      size: 8 + r() * 10,
      spin: (r() - 0.5) * 900,
      drift: (r() - 0.5) * 160,
      color: [...colors, '#5f9d50', '#3e7bb6', '#e3b341', '#9cc35a'][i % (colors.length + 4)],
    }));
  }, [colors]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span key={i} style={{
          left: `${b.left}%`, width: b.size, height: b.size * 1.15, background: b.color,
          animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`,
          ['--spin' as string]: `${b.spin}deg`, ['--drift' as string]: `${b.drift}px`,
        }} />
      ))}
    </div>
  );
}
