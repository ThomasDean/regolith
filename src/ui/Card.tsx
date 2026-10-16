import type { GameState } from '../engine/types';
import { CARDS } from '../engine/cards';
import { cardCost, cardVP, requirementsMet } from '../engine/queries';
import { reqText, TAG_COLOR } from './format';

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
}

const TYPE_LABEL = { automated: 'Automated', active: 'Active', event: 'Event', corp: 'Corporation' } as const;

export function Card({ id, s, pid, resources, compact, selected, dim, onClick, footer }: Props) {
  const c = CARDS[id];
  const cost = s && pid !== undefined && c.type !== 'corp' ? cardCost(s, pid, id) : c.cost;
  const req = reqText(c.req);
  const reqOk = s && pid !== undefined ? requirementsMet(s, pid, id) : true;
  const vp = c.vp === undefined ? null : typeof c.vp === 'number' ? String(c.vp) : s && pid !== undefined && s.players[pid].played.includes(id) ? `${cardVP(s, pid, id)}*` : '*';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`card card-${c.type} ${compact ? 'compact' : ''} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? !!selected : undefined}
    >
      <div className="card-head">
        {c.type !== 'corp' && (
          <span className={`card-cost ${cost < c.cost ? 'discounted' : ''}`} title={cost < c.cost ? `Printed cost ${c.cost}` : 'Cost'}>{cost}</span>
        )}
        <span className="card-name">{c.name}</span>
        {vp !== null && <span className="card-vp" title={c.vpText ?? 'Victory points'}>{vp}<small>VP</small></span>}
      </div>
      <div className="card-tags">
        <span className="card-type">{TYPE_LABEL[c.type]}</span>
        {c.tags.map((t, i) => (
          <span key={i} className="tag"><i style={{ background: TAG_COLOR[t] }} />{t}</span>
        ))}
      </div>
      {!compact && (
        <>
          {req && <div className={`card-req ${reqOk ? '' : 'unmet'}`}>Needs {req}</div>}
          {c.startMC !== undefined && <div className="card-req">Starts with {c.startMC} M€</div>}
          <p className="card-text">{c.text}</p>
          {c.vpText && <p className="card-vptext">{c.vpText}</p>}
        </>
      )}
      {resources !== undefined && resources > 0 && <div className="card-res">{resources} {c.resource}{resources === 1 ? '' : 's'}</div>}
      {footer}
    </Tag>
  );
}
