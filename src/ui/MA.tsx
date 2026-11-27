import { useState } from 'react';
import type { Action, GameState, Payment } from '../engine/types';
import { autoPay, awardCost, awardPlaces, canClaimMilestone, canFundAward, gameAwards, gameMilestones, MILESTONE_COST } from '../engine/queries';
import { Dialog } from './Dialog';
import { FamilyBadge } from './Setup';

type Pick = { kind: 'milestone' | 'award'; id: string };

/**
 * Milestones and awards as a compact row of names. Tapping one opens its card: what it
 * measures, who has claimed or funded it, and a table of where every player stands.
 */
export function MAPanel({ s, viewer, canAct, act, detailed }: { s: GameState; viewer: number | null; canAct: boolean; act: (a: Action) => void; detailed?: boolean }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const ms = gameMilestones(s);
  const aws = gameAwards(s);
  const mine = (kind: Pick['kind'], id: string) => viewer !== null && canAct && (kind === 'milestone' ? canClaimMilestone(s, viewer, id) : canFundAward(s, viewer, id));
  const chip = (kind: Pick['kind'], id: string, name: string, text: string) => {
    const owner = (kind === 'milestone' ? s.milestones : s.awards).find((x) => x.id === id);
    // only milestones glow when claimable: any award you can afford is fundable, so glowing them says little
    const ready = !owner && kind === 'milestone' && mine(kind, id);
    return (
      <button key={id} type="button" className={`ma-chip ${owner ? 'owned' : ''} ${ready ? 'ready' : ''}`} onClick={() => setPick({ kind, id })}
        style={owner ? { ['--pc' as string]: s.players[owner.pid].color } : undefined}
        aria-label={`${name}${owner ? `, ${kind === 'milestone' ? 'claimed' : 'funded'} by ${s.players[owner.pid].name}` : ready ? `, you can ${kind === 'milestone' ? 'claim' : 'fund'} it` : ''}. Details`}>
        {owner && <span className="swatch" aria-hidden="true" />}
        <span>{name}{detailed && <small className="ma-text">{text}</small>}</span>
        <svg className="ma-info" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 7v4.5M8 4.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    );
  };
  return (
    <section className={`ma-panel ${detailed ? 'detailed' : ''}`} aria-label="Milestones and awards">
      <div className="ma-row">
        <h3>Milestones <span className="muted">{MILESTONE_COST} M€ · {3 - s.milestones.length} left</span></h3>
        <div className="ma-chips">{ms.map((m) => chip('milestone', m.id, m.name, m.text))}</div>
      </div>
      <div className="ma-row">
        <h3>Awards <span className="muted">{s.awards.length < 3 ? `${awardCost(s)} M€ · ${3 - s.awards.length} left` : 'all funded'}</span></h3>
        <div className="ma-chips">{aws.map((a) => chip('award', a.id, a.name, a.text))}</div>
      </div>
      {pick && <MADialog s={s} pick={pick} viewer={viewer} canAct={canAct} onClose={() => setPick(null)} act={(a) => { setPick(null); act(a); }} />}
    </section>
  );
}

function MADialog({ s, pick, viewer, canAct, onClose, act }: { s: GameState; pick: Pick; viewer: number | null; canAct: boolean; onClose: () => void; act: (a: Action) => void }) {
  const isM = pick.kind === 'milestone';
  const def = (isM ? gameMilestones(s) : gameAwards(s)).find((x) => x.id === pick.id)!;
  const owner = (isM ? s.milestones : s.awards).find((x) => x.id === pick.id);
  const need = isM ? (def as { need: number }).need : null;
  const rows = s.players.map((p) => ({ p, v: def.metric(s, p.id) })).sort((a, b) => b.v - a.v);
  const places = isM ? null : awardPlaces(s, pick.id);
  const cost = isM ? MILESTONE_COST : awardCost(s);
  const helion = viewer !== null && s.players[viewer].corp === 'helion';
  const pay: Payment | undefined = helion && viewer !== null ? autoPay(s, viewer, cost, { steel: false, titanium: false, heat: true }) ?? undefined : undefined;
  const can = viewer !== null && canAct && (isM ? canClaimMilestone(s, viewer, pick.id) : canFundAward(s, viewer, pick.id));
  const full = (isM ? s.milestones : s.awards).length >= 3;
  let status: string;
  if (owner) status = `${isM ? 'Claimed' : 'Funded'} by ${owner.pid === viewer ? 'you' : s.players[owner.pid].name}.`;
  else if (full) status = `All three ${isM ? 'milestones are claimed' : 'awards are funded'}.`;
  else status = `Open. ${isM ? 'Claim' : 'Fund'} it for ${cost} M€.`;
  const why = !owner && !full && viewer !== null && !can
    ? !canAct ? 'You can do this on your turn.' : isM && def.metric(s, viewer) < need! ? `You need ${need}; you have ${def.metric(s, viewer)}.` : `You need ${cost} M€.`
    : null;
  return (
    <Dialog title={def.name} onClose={onClose}
      footer={<>
        {why && <span className="muted">{why}</span>}
        {!owner && !full && viewer !== null && (
          <button type="button" className="btn" disabled={!can} onClick={() => act(isM ? { t: 'milestone', id: pick.id, pay } : { t: 'award', id: pick.id, pay })}>
            {isM ? 'Claim' : 'Fund'} for {cost} M€
          </button>
        )}
      </>}>
      <p className="ma-kind"><FamilyBadge f={def.family} /> {isM ? 'Milestone' : 'Award'}: {def.text}{isM ? '' : '. Funded awards pay 5 VP to first place and 2 VP to second at the end.'}{isM ? '. Worth 5 VP.' : ''}</p>
      <p className={owner ? 'ma-status owned' : 'ma-status'} style={owner ? { ['--pc' as string]: s.players[owner.pid].color } : undefined}>
        {owner && <span className="swatch" aria-hidden="true" />}{status}
      </p>
      <table className="ma-table">
        <thead><tr><th scope="col">Player</th><th scope="col">{isM ? `Progress (needs ${need})` : 'Count'}</th><th scope="col">{isM ? '' : 'Place'}</th></tr></thead>
        <tbody>
          {rows.map(({ p, v }) => {
            const place = places ? (places.first.includes(p.id) ? '1st' : places.second.includes(p.id) ? '2nd' : '') : '';
            const reached = isM && v >= need!;
            return (
              <tr key={p.id} style={{ ['--pc' as string]: p.color }} className={place === '1st' || (owner && owner.pid === p.id) ? 'lead' : ''}>
                <th scope="row"><span className="swatch" aria-hidden="true" />{p.name}{p.id === viewer && p.name.trim().toLowerCase() !== 'you' ? ' (you)' : ''}</th>
                <td>{isM ? <><b>{v}</b>/{need}{reached && <span className="ma-ok"> ✓</span>}</> : <b>{v}</b>}</td>
                <td>{isM ? (owner?.pid === p.id ? 'Claimed' : reached && !owner && !full ? 'Can claim' : '') : place}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Dialog>
  );
}
