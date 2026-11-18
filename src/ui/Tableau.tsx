import { useState } from 'react';
import type { GameState } from '../engine/types';
import { CARDS } from '../engine/cards';
import { cardVP } from '../engine/queries';
import { Card } from './Card';
import { Dialog } from './Dialog';
import { TagIcon } from './Icons';
import { resLabel } from './format';

export type TableauView = 'stack' | 'grid' | 'hidden';
const VIEW_KEY = 'regolith-tableau-view';
export function loadTableauView(): TableauView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'stack' || v === 'grid' || v === 'hidden') return v;
  } catch { /* storage unavailable */ }
  return 'stack';
}
function saveTableauView(v: TableauView) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
}

const GROUPS = [
  { type: 'active', label: 'Active' },
  { type: 'automated', label: 'Automated' },
  { type: 'event', label: 'Events' },
  { type: 'prelude', label: 'Preludes' },
] as const;


/** One played card as a slim strip: cost, name, tags, resources and VP, readable at a glance. */
export function CardStrip({ s, pid, id, onOpen }: { s: GameState; pid: number; id: string; onOpen?: (id: string) => void }) {
  const c = CARDS[id];
  const p = s.players[pid];
  const res = p.cardRes[id] ?? 0;
  const vp = c.vp === undefined ? null : typeof c.vp === 'number' ? c.vp : cardVP(s, pid, id);
  const used = !!c.action && p.usedActions.includes(id);
  const free = c.type === 'corp' || c.type === 'prelude';
  const label = `${c.name}${c.resource ? `, ${res} ${resLabel(c.resource, res)}` : ''}${vp !== null ? `, ${vp} VP` : ''}${used ? ', action used this generation' : ''}`;
  return (
    <button type="button" className={`strip strip-${c.type}`} onClick={onOpen ? () => onOpen(id) : undefined} aria-label={label} title={c.text}>
      {!free ? <span className="strip-cost">{c.cost}</span> : <span className="strip-cost none" aria-hidden="true" />}
      <span className="strip-name">{c.name}{used && <span className="strip-used" title="Action used this generation">used</span>}</span>
      {c.resource && (
        <span className={`strip-res ${res ? '' : 'zero'}`} title={`${res} ${resLabel(c.resource, res)} on this card`}>
          <b>{res}</b><small>{resLabel(c.resource, res)}</small>
        </span>
      )}
      {vp !== null && vp !== 0 && <span className="strip-vp" title={c.vpText ?? 'Victory points'}>{vp}</span>}
      <span className="strip-tags">{c.tags.map((t, i) => <TagIcon key={i} tag={t} size={18} />)}</span>
    </button>
  );
}

/** A player's cards in play: grouped by type, newest first, as a stack of strips or a grid. */
export function Tableau({ s, pid, view, setView, title }: { s: GameState; pid: number; view: TableauView; setView: (v: TableauView) => void; title?: React.ReactNode }) {
  const p = s.players[pid];
  const [open, setOpen] = useState<string | null>(null);
  const newest = [...p.played].reverse();
  const choose = (v: TableauView) => { setView(v); saveTableauView(v); };
  const count = p.played.length + (p.corp ? 1 : 0);
  return (
    <section className={`tableau view-${view}`} aria-label={`${p.name}'s cards in play`}>
      <div className="tableau-head">
        <h3>{title ?? 'Cards in play'} <span className="muted">({count})</span></h3>
        <div className="seg" role="group" aria-label="Show cards as">
          {(['stack', 'grid', 'hidden'] as const).map((v) => (
            <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => choose(v)}>
              {v === 'stack' ? 'Stack' : v === 'grid' ? 'Grid' : 'Hide'}
            </button>
          ))}
        </div>
      </div>
      {view !== 'hidden' && (
        <div className="tableau-groups">
          {p.corp && (
            <div className="tableau-group">
              <h4>Corporation</h4>
              {view === 'stack'
                ? <div className="strips"><CardStrip s={s} pid={pid} id={p.corp} onOpen={setOpen} /></div>
                : <div className="tableau-grid"><Card id={p.corp} resources={CARDS[p.corp].resource ? p.cardRes[p.corp] ?? 0 : undefined} compact onClick={() => setOpen(p.corp)} /></div>}
            </div>
          )}
          {GROUPS.map((g) => {
            const ids = newest.filter((id) => CARDS[id].type === g.type);
            if (!ids.length) return null;
            return (
              <div key={g.type} className={`tableau-group group-${g.type}`}>
                <h4>{g.label} <span className="muted">{ids.length}</span></h4>
                {view === 'stack' ? (
                  <div className="strips">{ids.map((id) => <CardStrip key={id} s={s} pid={pid} id={id} onOpen={setOpen} />)}</div>
                ) : (
                  <div className="tableau-grid">
                    {ids.map((id) => <Card key={id} id={id} s={s} pid={pid} compact resources={CARDS[id].resource ? p.cardRes[id] ?? 0 : undefined} onClick={() => setOpen(id)} />)}
                  </div>
                )}
              </div>
            );
          })}
          {count === 0 && <p className="muted">No cards in play yet.</p>}
        </div>
      )}
      {open && (
        <Dialog title={CARDS[open].name} onClose={() => setOpen(null)}>
          <div className="card-big"><Card id={open} s={s} pid={pid} resources={CARDS[open].resource ? p.cardRes[open] ?? 0 : undefined} /></div>
        </Dialog>
      )}
    </section>
  );
}
