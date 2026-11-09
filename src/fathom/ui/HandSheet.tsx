// The whole hand at a glance: a dock pinned to the bottom of phone screens, and a sheet that shows
// every card full size with its abilities, a releasable-only filter and sorting.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FISH } from '../engine/cards';
import { canAfford, whyNot } from '../engine/game';
import type { FPlayer } from '../engine/types';
import { FishArt } from './FishArt';
import { FishCard } from './FishCard';

type Sort = 'hand' | 'pts' | 'cost' | 'size';
const costOf = (id: string) => { const c = FISH[id].cost; return (c.cards ?? 0) + (c.eggs ?? 0) + (c.fry ?? 0) + (c.eat ? 1 : 0); };

export function HandDock({ p, mine, canRelease, onOpen }: { p: FPlayer; mine: boolean; canRelease: boolean; onOpen: () => void }) {
  const ok = canRelease ? p.hand.filter((c) => canAfford(p, c)).length : 0;
  return (
    <button type="button" className="fm-hand-dock" onClick={onOpen} aria-label={`Open ${mine ? 'your' : `${p.name}'s`} hand: ${p.hand.length} cards${canRelease ? `, ${ok} can be released` : ''}`}>
      <span className="dock-fan" aria-hidden="true">
        {p.hand.slice(0, 6).map((c, i) => <span key={c} className={`dock-card ${canRelease && canAfford(p, c) ? 'ok' : ''}`} style={{ ['--k' as string]: i }}><FishArt id={c} size="mini" /></span>)}
      </span>
      <span className="dock-text">
        <b>{mine ? 'Your hand' : `${p.name}’s hand`} · {p.hand.length}</b>
        <span>{canRelease ? (ok ? `${ok} can be released` : 'none affordable: dive for cards') : 'tap to view all'}</span>
      </span>
      <span className="dock-up" aria-hidden="true">▲</span>
    </button>
  );
}

export function HandSheet({ p, mine, canRelease, onRelease, onInspect, onClose }: {
  p: FPlayer; mine: boolean; canRelease: boolean; onRelease: (card: string) => void; onInspect: (card: string) => void; onClose: () => void;
}) {
  const [only, setOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('hand');
  const ok = (c: string) => canRelease && canAfford(p, c);
  const cards = useMemo(() => {
    const xs = p.hand.filter((c) => !only || ok(c));
    if (sort === 'pts') xs.sort((a, b) => FISH[b].pts - FISH[a].pts);
    if (sort === 'cost') xs.sort((a, b) => costOf(a) - costOf(b));
    if (sort === 'size') xs.sort((a, b) => FISH[a].len - FISH[b].len);
    return xs;
  }, [p.hand, only, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const okCount = p.hand.filter(ok).length;

  // a sheet: Escape closes, the page behind doesn't scroll, and a downward swipe on the handle closes it
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose]);
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  return (
    <div className="fm-sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fm-sheet" role="dialog" aria-modal="true" aria-label={mine ? 'Your hand' : `${p.name}'s hand`} tabIndex={-1} ref={ref}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}>
        <header className="sheet-head"
          onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
          onTouchMove={(e) => { if (startY.current !== null) setDrag(Math.max(0, e.touches[0].clientY - startY.current)); }}
          onTouchEnd={() => { if (drag > 80) onClose(); setDrag(0); startY.current = null; }}>
          <span className="sheet-grip" aria-hidden="true" />
          <div className="sheet-title">
            <h2>{mine ? 'Your hand' : `${p.name}’s hand`} <span className="muted">· {p.hand.length} card{p.hand.length === 1 ? '' : 's'} · discard pile {p.discard.length}</span></h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="sheet-tools">
            {canRelease && (
              <span className="fm-seg" role="group" aria-label="Show">
                <button type="button" className={`btn small ${only ? 'ghost' : ''}`} aria-pressed={!only} onClick={() => setOnly(false)}>All {p.hand.length}</button>
                <button type="button" className={`btn small ${only ? '' : 'ghost'}`} aria-pressed={only} onClick={() => setOnly(true)}>Releasable {okCount}</button>
              </span>
            )}
            <label className="sheet-sort">Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="hand">As drawn</option>
                <option value="pts">Points</option>
                <option value="cost">Cheapest</option>
                <option value="size">Size</option>
              </select>
            </label>
          </div>
        </header>
        <div className="sheet-body">
          {cards.length === 0 && <p className="muted">{p.hand.length ? 'Nothing you can afford right now. Dive a site whose bonuses draw cards, lay eggs or hatch fry.' : 'No cards. Dive a site whose bonuses draw cards.'}</p>}
          <div className="sheet-grid">
            {cards.map((c) => (
              <div key={c} className={`sheet-card ${ok(c) ? 'ok' : ''}`}>
                <button type="button" className="fm-hand-card" onClick={() => onInspect(c)} aria-label={`${FISH[c].name}: how it works`}>
                  <FishCard id={c} dim={canRelease && !ok(c)} />
                </button>
                {canRelease && (ok(c)
                  ? <button type="button" className="btn small" onClick={() => onRelease(c)}>Release</button>
                  : <span className="sheet-why">{whyNot(p, c)}</span>)}
                {!canRelease && <button type="button" className="btn small ghost" onClick={() => onInspect(c)}>How it works</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
