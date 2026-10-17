import { useRef } from 'react';
import type { GameState } from '../engine/types';
import { CARDS } from '../engine/cards';
import { cardCost, cardVP, requirementsMet } from '../engine/queries';
import { reqText } from './format';
import { CardArt } from './CardArt';
import { TagIcon } from './Icons';

interface Props {
  id: string;
  s?: GameState;
  pid?: number;
  resources?: number;
  compact?: boolean;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;
  /** position in a dealt row, for staggered entrance */
  index?: number;
  /** skip pointer tilt (static displays, showcase) */
  still?: boolean;
}

const TYPE_LABEL = { automated: 'Automated', active: 'Active', event: 'Event', corp: 'Corporation' } as const;

const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

export function Card({ id, s, pid, resources, compact, selected, dim, onClick, footer, index, still }: Props) {
  const c = CARDS[id];
  const ref = useRef<HTMLElement>(null);
  const cost = s && pid !== undefined && c.type !== 'corp' ? cardCost(s, pid, id) : c.cost;
  const req = reqText(c.req);
  const reqOk = s && pid !== undefined ? requirementsMet(s, pid, id) : true;
  const vp = c.vp === undefined ? null : typeof c.vp === 'number' ? String(c.vp) : s && pid !== undefined && s.players[pid].played.includes(id) ? `${cardVP(s, pid, id)}*` : '*';
  const Tag = onClick ? 'button' : 'div';
  const tilt = !!onClick && !still && finePointer;
  const onMove = tilt ? (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width;
    const y = (e.clientY - b.top) / b.height;
    el.style.setProperty('--rx', `${(0.5 - y) * 9}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * 11}deg`);
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
  } : undefined;
  const onLeave = tilt ? () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  } : undefined;
  return (
    <Tag
      ref={ref as never}
      type={onClick ? 'button' : undefined}
      className={`card card-${c.type} ${compact ? 'compact' : ''} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${tilt ? 'tilt' : ''}`}
      onClick={onClick}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      aria-pressed={onClick ? !!selected : undefined}
      style={index !== undefined ? { ['--i' as string]: index } : undefined}
    >
      <div className="card-art">
        <CardArt card={c} />
        {c.type !== 'corp' && (
          <span className={`card-cost ${cost < c.cost ? 'discounted' : ''}`} title={cost < c.cost ? `Printed cost ${c.cost}` : 'Cost'}>{cost}</span>
        )}
        {c.tags.length > 0 && (
          <span className="card-tagicons">
            {c.tags.map((t, i) => <TagIcon key={i} tag={t} size={compact ? 18 : 22} />)}
          </span>
        )}
        {vp !== null && <span className="card-vp" title={c.vpText ?? 'Victory points'}>{vp}<small>VP</small></span>}
        {resources !== undefined && resources > 0 && <span className="card-res" title={`${resources} ${c.resource}${resources === 1 ? '' : 's'}`}>{resources}<small>{c.resource}</small></span>}
      </div>
      <div className="card-title">
        <span className="card-name">{c.name}</span>
        <span className="card-type">{TYPE_LABEL[c.type]}</span>
      </div>
      {!compact && (
        <div className="card-body">
          {req && <div className={`card-req ${reqOk ? '' : 'unmet'}`}>Needs {req}</div>}
          {c.startMC !== undefined && <div className="card-req">Starts with {c.startMC} M€</div>}
          <p className="card-text">{c.text}</p>
          {c.vpText && <p className="card-vptext">{c.vpText}</p>}
        </div>
      )}
      {footer}
    </Tag>
  );
}
