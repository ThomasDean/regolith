import type { GameState, Res } from '../engine/types';
import { RESOURCES, TAGS } from '../engine/types';
import { CARDS } from '../engine/cards';
import { tagCount } from '../engine/helpers';
import { score } from '../engine/queries';
import { LEVEL_LABEL, RES_COLOR, RES_LABEL, signed, TAG_COLOR } from './format';

export function ResourceGrid({ s, pid }: { s: GameState; pid: number }) {
  const p = s.players[pid];
  return (
    <div className="res-grid">
      {RESOURCES.map((r: Res) => (
        <div key={r} className="res" title={`${RES_LABEL[r]}: ${p.res[r]} in stock, ${signed(r === 'mc' ? p.prod.mc : p.prod[r])} production`}>
          <i style={{ background: RES_COLOR[r] }} aria-hidden="true" />
          <span className="res-name">{RES_LABEL[r]}</span>
          <b>{p.res[r]}</b>
          <small>{signed(p.prod[r])}</small>
        </div>
      ))}
    </div>
  );
}

export function Players({ s, viewer, onView }: { s: GameState; viewer: number | null; onView: (pid: number) => void }) {
  const decider = s.prompt ? s.prompt.pid : s.active;
  return (
    <section className="players" aria-label="Players">
      {s.players.map((p) => {
        const sc = score(s, p.id);
        const acting = s.phase !== 'over' && decider === p.id;
        return (
          <article key={p.id} className={`player ${acting ? 'acting' : ''} ${p.passed && s.phase === 'action' ? 'passed' : ''}`} style={{ ['--pc' as string]: p.color }}>
            <header className="player-head">
              <span className="swatch" aria-hidden="true" />
              <div className="player-id">
                <span className="player-name">{p.name}{viewer === p.id && p.name.trim().toLowerCase() !== 'you' ? ' (you)' : ''}</span>
                <span className="player-corp">{p.corp ? CARDS[p.corp].name : 'Choosing a corporation'}{p.cpu ? `, ${LEVEL_LABEL[p.cpu]}` : ''}</span>
              </div>
              <div className="player-score" title="Victory points if the game ended now">
                <b>{sc.total}</b><small>VP</small>
              </div>
            </header>
            <div className="player-line">
              <span title="Terraform rating">TR <b>{p.tr}</b></span>
              <span>Hand <b>{p.hand.length}</b></span>
              <span>Played <b>{p.played.length}</b></span>
              {p.passed && s.phase === 'action' && <span className="badge">Passed</span>}
              {acting && <span className="badge live">{s.phase === 'action' ? `Turn, action ${s.actionsThisTurn + 1}` : 'Deciding'}</span>}
            </div>
            <ResourceGrid s={s} pid={p.id} />
            <div className="tag-row">
              {TAGS.filter((t) => t !== 'event').map((t) => {
                const n = tagCount(s, p.id, t);
                return n ? <span key={t} className="tag" title={`${n} ${t} tags`}><i style={{ background: TAG_COLOR[t] }} />{t} {n}</span> : null;
              })}
            </div>
            <button type="button" className="link" onClick={() => onView(p.id)}>View cards in play</button>
          </article>
        );
      })}
    </section>
  );
}
