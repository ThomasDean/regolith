// End of a tide: count each player's goal pip by pip, crown the leader, then reveal the next goal.
import { useEffect, useMemo, useRef, useState } from 'react';
import { GOALS, goalPoints, score } from '../engine/game';
import { TIDES, type FState, type GoalId } from '../engine/types';
import { EndGlyph } from './FishCard';
import { GoalIcon, goalPips, PipView, unitName, type Pip } from './GoalArt';

type Phase = 'intro' | 'count' | 'bonus' | 'next';
const AUTO_CLOSE = 9000;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Row { pid: number; name: string; color: string; count: number; raw: number; total: number; lead: boolean; bonus: number; pips: (Pip | null)[]; score: number }

/** `s` is the state just after tide `tide` ended (its goal points are in `players[].goals`). */
export function TideRecap({ s, tide, onClose }: { s: FState; tide: number; onClose: () => void }) {
  const g = s.goals[tide - 1] as GoalId;
  const def = GOALS[g];
  const next = tide < 3 ? (s.goals[tide] as GoalId | undefined) ?? null : null;

  const rows = useMemo<Row[]>(() => {
    const stored = s.players.map((p) => p.goals[tide - 1] ?? 0);
    const max = Math.max(0, ...stored);
    return s.players.map((p, i) => {
      const lead = max > 0 && stored[i] === max;
      const bonus = s.options.variable && lead ? 3 : 0;
      const raw = stored[i] - bonus;
      const count = Math.round(raw / def.per);
      const found = goalPips(p, g);
      // the ocean may have moved on (an online view can skip ahead): fall back to plain goal marks
      const pips: (Pip | null)[] = found.length === count ? found : Array.from({ length: count }, () => null);
      return { pid: p.id, name: p.name, color: p.color, count, raw, total: stored[i], lead, bonus, pips, score: score(s, p.id).total };
    });
  }, [s, tide, g, def.per]);

  const maxCount = Math.max(0, ...rows.map((r) => r.count));
  const [phase, setPhase] = useState<Phase>(() => (reduced() ? 'next' : 'intro'));
  const [tick, setTick] = useState(() => (reduced() ? maxCount : 0));
  const step = Math.max(90, Math.min(260, 1700 / Math.max(1, maxCount)));

  useEffect(() => {
    if (phase === 'intro') { const t = setTimeout(() => setPhase('count'), 800); return () => clearTimeout(t); }
    if (phase === 'count') {
      if (tick >= maxCount) { const t = setTimeout(() => setPhase('bonus'), 350); return () => clearTimeout(t); }
      const t = setTimeout(() => setTick((x) => x + 1), step);
      return () => clearTimeout(t);
    }
    if (phase === 'bonus') { const t = setTimeout(() => setPhase('next'), 1100); return () => clearTimeout(t); }
    const t = setTimeout(onClose, AUTO_CLOSE);
    return () => clearTimeout(t);
  }, [phase, tick, maxCount, step, onClose]);

  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const skip = () => { setTick(maxCount); setPhase('next'); };
  const shownTick = phase === 'intro' ? 0 : phase === 'count' ? tick : maxCount;
  const settled = phase === 'bonus' || phase === 'next';
  const summary = `End of tide ${tide}. ${def.name}: ${rows.map((r) => `${r.name} ${r.total}`).join(', ')}.`;

  return (
    <div className="overlay fm-recap-overlay" onMouseDown={(e) => { if (e.target !== e.currentTarget) return; if (phase === 'next') onClose(); else skip(); }}>
      <div className={`fm-recap phase-${phase}`} role="dialog" aria-modal="true" aria-label={`End of tide ${tide}`}>
        <p className="sr-only" aria-live="polite">{summary}</p>
        <header className="recap-head">
          <span className="recap-kicker">End of tide {tide} of {TIDES}</span>
          <div className="recap-goal">
            <GoalIcon id={g} size={40} />
            <div><b>{def.name}</b><span>{def.text}{s.options.variable ? '; +3 to the leader' : ''}</span></div>
          </div>
        </header>

        <ol className="recap-rows">
          {rows.map((r, ri) => {
            const n = Math.min(shownTick, r.count);
            const pts = settled ? r.total : n * def.per;
            return (
              <li key={r.pid} className={`recap-row ${settled && r.lead ? 'lead' : ''}`} style={{ ['--pc' as string]: r.color, ['--i' as string]: ri }}>
                <span className="recap-name"><span className="swatch" />{r.name}{settled && r.lead && <span className="crown" aria-label="leader">♛</span>}</span>
                <span className="recap-pips" aria-hidden="true">
                  {r.pips.slice(0, n).map((pip, k) => <span key={k} className="recap-pip">{pip ? <PipView pip={pip} g={g} /> : <GoalIcon id={g} size={14} />}</span>)}
                  {phase !== 'intro' && r.count === 0 && <span className="recap-none">none</span>}
                </span>
                <span className="recap-pts">
                  <b key={pts} className="bump">+{pts}</b>
                  {settled && r.bonus > 0 && <span className="recap-bonus">incl. +{r.bonus} lead</span>}
                </span>
                <span className="recap-caption muted">{settled ? `${unitName(g, r.count)} × ${def.per} · ` : ''}score {r.score}</span>
              </li>
            );
          })}
        </ol>

        {phase === 'next' && (
          <section className="recap-next" aria-label="Next goal">
            {next ? (
              <div className="next-card">
                <span className="recap-kicker">Next up · tide {tide + 1} goal</span>
                <div className="recap-goal">
                  <GoalIcon id={next} size={44} />
                  <div><b>{GOALS[next].name}</b><span>{GOALS[next].text}{s.options.variable ? '; +3 to the leader' : ''}</span></div>
                </div>
                <div className="next-standing">
                  <span className="muted">Where everyone stands now:</span>
                  {s.players.map((p) => <span key={p.id} style={{ ['--pc' as string]: p.color }}><span className="swatch" />{p.name} <b>{goalPoints(p, next)}</b></span>)}
                </div>
              </div>
            ) : (
              <div className="next-card final">
                <span className="recap-kicker">Next up · tide {tide + 1}</span>
                <div className="recap-goal">
                  <span className="final-star"><EndGlyph size={36} /></span>
                  <div><b>The last tide</b><span>No goal this time. When it ends, final scoring: fish, eaten fish, eggs, fry, schools, <i>Game end</i> abilities and goals.</span></div>
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="recap-foot">
          {phase === 'next'
            ? <button ref={btn} type="button" className="btn recap-go" onClick={onClose}><span className="recap-timer" style={{ animationDuration: `${AUTO_CLOSE}ms` }} />Continue to tide {tide + 1}</button>
            : <button ref={btn} type="button" className="btn ghost" onClick={skip}>Skip count</button>}
        </footer>
      </div>
    </div>
  );
}
