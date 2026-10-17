import type { GameState, Res } from '../engine/types';
import { RESOURCES, TAGS } from '../engine/types';
import { CARDS } from '../engine/cards';
import { tagCount } from '../engine/helpers';
import { score } from '../engine/queries';
import { LEVEL_LABEL, RES_LABEL, signed } from './format';
import { ResIcon, TagIcon, TrIcon } from './Icons';
import { CardArt } from './CardArt';
import { Num } from './Fx';

export function ResourceGrid({ s, pid }: { s: GameState; pid: number }) {
  const p = s.players[pid];
  return (
    <div className="res-grid">
      {RESOURCES.map((r: Res) => (
        <div key={r} className={`res res-${r}`} title={`${RES_LABEL[r]}: ${p.res[r]} in stock, ${signed(r === 'mc' ? p.prod.mc : p.prod[r])} production`}>
          <ResIcon r={r} size={16} />
          <span className="res-name">{RES_LABEL[r]}</span>
          <b><Num value={p.res[r]} /></b>
          <small className="res-prod">{p.prod[r] > 0 ? '+' : ''}<Num value={p.prod[r]} float={false} /></small>
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
          <article key={p.id} data-player-id={p.id} className={`player ${acting ? 'acting' : ''} ${p.passed && s.phase === 'action' ? 'passed' : ''}`} style={{ ['--pc' as string]: p.color }}>
            <header className="player-head">
              <span className="avatar" aria-hidden="true">
                {p.corp ? <CardArt card={CARDS[p.corp]} className="avatar-art" /> : <span className="swatch" />}
              </span>
              <div className="player-id">
                <span className="player-name"><span className="swatch" aria-hidden="true" />{p.name}{viewer === p.id && p.name.trim().toLowerCase() !== 'you' ? ' (you)' : ''}</span>
                <span className="player-corp">{p.corp ? CARDS[p.corp].name : 'Choosing a corporation'}{p.cpu ? `, ${LEVEL_LABEL[p.cpu]}` : ''}</span>
              </div>
              <div className="player-score" title="Victory points if the game ended now">
                <b><Num value={sc.total} /></b><small>VP</small>
              </div>
            </header>
            <div className="player-line">
              <span className="tr" title="Terraform rating"><TrIcon /> TR <b><Num value={p.tr} /></b></span>
              <span>Hand <b>{p.hand.length}</b></span>
              <span>Played <b>{p.played.length}</b></span>
              {p.passed && s.phase === 'action' && <span className="badge">Passed</span>}
              {acting && <span className="badge live">{s.phase === 'action' ? `Turn, action ${s.actionsThisTurn + 1}` : 'Deciding'}</span>}
            </div>
            <ResourceGrid s={s} pid={p.id} />
            <div className="tag-row">
              {TAGS.filter((t) => t !== 'event').map((t) => {
                const n = tagCount(s, p.id, t);
                return n ? <span key={t} className="tag" title={`${n} ${t} tags`}><TagIcon tag={t} size={16} />{n}</span> : null;
              })}
            </div>
            <button type="button" className="link" onClick={() => onView(p.id)}>View cards in play</button>
          </article>
        );
      })}
    </section>
  );
}
