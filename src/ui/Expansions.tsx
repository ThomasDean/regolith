// Panels for the expansions' shared boards: the colony tiles (tracks, colonies, trade fleets)
// and Turmoil's parties, government and global events. Both offer the matching actions on
// your turn.
import type { Action, GameState } from '../engine/types';
import { NEUTRAL, PARTIES } from '../engine/types';
import { COLONIES, colonyDef, fleetsFree, tradeCost, canTrade, tradeTrack } from '../engine/colonies';
import { PARTY_DEFS, T, delegateCost, eventDef, influence } from '../engine/turmoil';
import { RES_LABEL } from './format';

const who = (s: GameState, d: number, viewer: number | null) => (d === NEUTRAL ? 'Neutral' : d === viewer ? 'You' : s.players[d].name);
const colorOf = (s: GameState, d: number) => (d === NEUTRAL ? '#c9c2b2' : s.players[d].color);

export function ColoniesPanel({ s, viewer, canAct, act }: { s: GameState; viewer: number | null; canAct: boolean; act: (a: Action) => void }) {
  if (!s.colonies) return null;
  const me = viewer !== null ? s.players[viewer] : null;
  const free = me ? fleetsFree(s, me.id) : 0;
  return (
    <section className="xpanel colonies" aria-label="Colonies">
      <header className="xpanel-head">
        <h3>Colonies</h3>
        {me && <span className="muted">Your fleets: {free} of {me.fleets ?? 0} free</span>}
      </header>
      <ul className="colony-list">
        {s.colonies.map((c) => {
          const d = colonyDef(c.id);
          const at = me ? tradeTrack(s, me.id, c) : c.track;
          return (
            <li key={c.id} className={`colony ${c.active ? '' : 'inactive'}`}>
              <div className="colony-top">
                <b>{d.name}</b>
                <span className="colony-slots" aria-label={`${c.colonies.length} of 3 colonies`}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={`colony-slot ${c.colonies[i] !== undefined ? 'on' : ''}`} style={c.colonies[i] !== undefined ? { ['--pc' as string]: colorOf(s, c.colonies[i]) } : undefined}
                      title={c.colonies[i] !== undefined ? `${who(s, c.colonies[i], viewer)}’s colony` : 'Open colony space'} />
                  ))}
                </span>
                {c.fleet !== null && <span className="fleet" style={{ ['--pc' as string]: colorOf(s, c.fleet) }} title={`${who(s, c.fleet, viewer)} traded here this generation`}>⛴</span>}
              </div>
              <ol className="colony-track" aria-label={`Trade: ${d.tradeText}`}>
                {d.steps.map((v, i) => (
                  <li key={i} className={`${i === c.track ? 'marker' : ''} ${i < c.colonies.length ? 'floor' : ''} ${me && i === at && at !== c.track ? 'boost' : ''}`}>{v}</li>
                ))}
              </ol>
              <div className="colony-text">
                {c.active ? <>Build: {d.buildText}. Trade: {d.tradeText}. Colony bonus: {d.bonusText}.</> : <>Opens once a card that holds {d.resource}s is played.</>}
              </div>
              {canAct && me && c.active && c.fleet === null && free > 0 && (
                <div className="colony-trade">
                  {(['mc', 'energy', 'titanium'] as const).map((k) => (
                    <button key={k} type="button" className="btn small" disabled={!canTrade(s, me.id, c.id, k)} onClick={() => act({ t: 'trade', colony: c.id, pay: k })}>
                      Trade for {tradeCost(s, me.id, k)} {RES_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {(s.spareColonies?.length ?? 0) > 0 && <p className="muted small-print">Not in play: {s.spareColonies!.map((id) => COLONIES.find((c) => c.id === id)!.name).join(', ')}.</p>}
    </section>
  );
}

export function TurmoilPanel({ s, viewer, canAct, act }: { s: GameState; viewer: number | null; canAct: boolean; act: (a: Action) => void }) {
  if (!s.turmoil) return null;
  const t = T(s);
  const me = viewer !== null ? s.players[viewer] : null;
  const cost = me ? delegateCost(s, me.id) : 0;
  const pol = PARTY_DEFS[t.ruling].policyAction;
  const canSend = canAct && !!me && t.reserve[me.id] > 0 && me.res.mc >= cost;
  const events = [['Now', t.current], ['Next', t.coming], ['Later', t.distant]] as const;
  return (
    <section className="xpanel turmoil" aria-label="Turmoil">
      <header className="xpanel-head">
        <h3>Turmoil</h3>
        {me && <span className="muted">Reserve {t.reserve[me.id]}, influence {influence(s, me.id)}</span>}
      </header>
      <div className="gov" style={{ ['--party' as string]: PARTY_DEFS[t.ruling].color }}>
        <div><span className="muted">Ruling</span> <b>{PARTY_DEFS[t.ruling].name}</b> · <span className="muted">Chairman</span> <b style={{ color: colorOf(s, t.chairman) }}>{who(s, t.chairman, viewer)}</b></div>
        <div className="gov-policy">Policy: {PARTY_DEFS[t.ruling].policyText}</div>
        {pol && me && canAct && (
          <button type="button" className="btn small" disabled={(pol.once && !!me.policyUsed) || me.res.mc < pol.cost} onClick={() => act({ t: 'policy' })}>
            {pol.text}{pol.once && me.policyUsed ? ' (used)' : ''}
          </button>
        )}
      </div>
      <ul className="party-list">
        {PARTIES.map((id) => {
          const ps = t.parties[id];
          const pd = PARTY_DEFS[id];
          return (
            <li key={id} className={`party ${t.dominant === id ? 'dominant' : ''}`} style={{ ['--party' as string]: pd.color }}>
              <div className="party-top">
                <b>{pd.name}</b>
                {t.dominant === id && <span className="badge" title="Rules next generation if nothing changes">Next to rule</span>}
              </div>
              <div className="delegates" aria-label={`${ps.delegates.length} delegates`}>
                {ps.leader !== null && <span className="delegate leader" style={{ ['--pc' as string]: colorOf(s, ps.leader) }} title={`Party leader: ${who(s, ps.leader, viewer)}`} />}
                {ps.delegates.filter((_, i) => i !== ps.delegates.indexOf(ps.leader ?? -99)).map((d, i) => (
                  <span key={i} className="delegate" style={{ ['--pc' as string]: colorOf(s, d) }} title={who(s, d, viewer)} />
                ))}
              </div>
              <div className="party-bonus muted">Ruling bonus: {pd.bonusText}</div>
              {canSend && (
                <button type="button" className="btn small ghost" onClick={() => act({ t: 'delegate', party: id })}>Send a delegate{cost ? ` (${cost} M€)` : ' (free)'}</button>
              )}
            </li>
          );
        })}
      </ul>
      <ol className="events">
        {events.map(([label, id]) => id && (
          <li key={label} className={eventDef(id).negative ? 'bad' : ''}>
            <span className="muted">{label}:</span> <b>{eventDef(id).name}</b> <span className="event-text">{eventDef(id).text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
