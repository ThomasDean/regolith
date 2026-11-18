import { useState } from 'react';
import type { Action, GameState, Tag } from '../engine/types';
import { TAGS } from '../engine/types';
import { CARDS } from '../engine/cards';
import { Card } from './Card';
import { TagIcon } from './Icons';
import { MAPanel } from './MA';
import { Board } from './Board';

/**
 * The start of the game on one page: corporations, preludes and all ten starting cards side
 * by side, chosen together, with a running summary, the milestones and awards, and the map.
 */
export function StartPicker({ s, pid, act, onHelp }: { s: GameState; pid: number; act: (a: Action) => void; onHelp?: () => void }) {
  const p = s.players[pid];
  const su = p.setup!;
  const [corp, setCorp] = useState<string | null>(null);
  const [keep, setKeep] = useState<string[]>([]);
  const [pre, setPre] = useState<string[]>([]);
  const beginner = corp === 'beginner-corporation';
  const start = corp ? CARDS[corp].startMC! : 0;
  const price = corp === 'polyphemos' ? 5 : corp === 'terralabs-research' ? 1 : 3;
  const kept = beginner ? su.cards : keep;
  const cost = beginner ? 0 : keep.length * price;
  const toggle = (id: string) => setKeep((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const togglePre = (id: string) => setPre((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 2 ? [x[1], id] : [...x, id]));
  const needPre = !!su.preludes && pre.length !== 2;
  const ok = !!corp && !needPre && cost <= start;
  const tags = new Map<Tag, number>();
  for (const id of [...(corp ? [corp] : []), ...pre, ...kept]) for (const t of CARDS[id].tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  const problem = !corp ? 'Choose a corporation.' : needPre ? `Choose 2 preludes (${pre.length} chosen).` : cost > start ? `Those cards cost ${cost} M€; ${CARDS[corp].name} starts with ${start} M€.` : null;
  const confirm = (
    <button type="button" className="btn big" disabled={!ok} onClick={() => corp && act({ t: 'setup', corp, keep: beginner ? [] : keep, ...(su.preludes ? { preludes: pre } : {}) })}>
      {corp ? `Start with ${CARDS[corp].name}` : 'Start'}
    </button>
  );
  return (
    <main className="start-view">
      <div className="start-cards">
        <h2>{p.name}: choose your start</h2>
        <p className="muted">Pick a corporation{su.preludes ? ', 2 preludes' : ''} and the starting cards to keep, all at once.</p>
        <div className="start-row">
          <section className="start-group" aria-label="Corporations">
            <h3>Corporation <span className="muted">choose 1</span></h3>
            <div className="start-grid">
              {su.corps.map((c, i) => <Card key={c} id={c} index={i} selected={corp === c} onClick={() => setCorp(c)} />)}
            </div>
          </section>
          {su.preludes && (
            <section className="start-group" aria-label="Preludes">
              <h3>Preludes <span className="muted">keep 2, played before generation 1</span></h3>
              <div className="start-grid">
                {su.preludes.map((c, i) => <Card key={c} id={c} index={i + 3} selected={pre.includes(c)} onClick={() => togglePre(c)} />)}
              </div>
            </section>
          )}
        </div>
        <section className="start-group" aria-label="Starting cards">
          <h3>Starting cards <span className="muted">{beginner ? 'all 10 are free with the beginner corporation' : `${price} M€ each`}</span></h3>
          <div className="start-grid">
            {su.cards.map((id, i) => <Card key={id} id={id} index={i + 7} selected={kept.includes(id)} onClick={beginner ? undefined : () => toggle(id)} />)}
          </div>
        </section>
        {onHelp && <p className="htp-link"><button type="button" className="linkish" onClick={onHelp}>How to play this game’s expansions</button></p>}
      </div>
      <aside className="start-side">
        <section className="start-summary" aria-label="Your choices">
          <h3>Your start</h3>
          <dl>
            <dt>Corporation</dt><dd>{corp ? CARDS[corp].name : <span className="muted">not chosen</span>}</dd>
            {su.preludes && <><dt>Preludes</dt><dd>{pre.length ? pre.map((c) => CARDS[c].name).join(', ') : <span className="muted">none yet</span>}</dd></>}
            <dt>Cards kept</dt><dd>{kept.length}{beginner ? ' (free)' : ` × ${price} = ${cost} M€`}</dd>
            {corp && <><dt>M€ left</dt><dd className={cost > start ? 'warn' : ''}>{start - cost} of {start}</dd></>}
          </dl>
          {tags.size > 0 && (
            <div className="start-tags" aria-label="Tags across your choices">
              {TAGS.filter((t) => tags.get(t)).map((t) => <span key={t} className="tag" title={`${tags.get(t)} ${t} tags`}><TagIcon tag={t} size={18} />{tags.get(t)}</span>)}
            </div>
          )}
          {problem && <p className={cost > start ? 'warn' : 'muted'}>{problem}</p>}
          {confirm}
        </section>
        <MAPanel s={s} viewer={pid} canAct={false} act={act} detailed />
        <div className="start-map"><Board s={s} /></div>
      </aside>
      <div className="start-bar">
        <span className={problem && cost > start ? 'warn' : 'muted'}>{problem ?? `${corp ? CARDS[corp].name : ''} · ${kept.length} cards · ${start - cost} M€ left`}</span>
        {confirm}
      </div>
    </main>
  );
}
