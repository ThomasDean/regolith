// Fish cards and the little glyphs used across Fathom's screens.
import { FISH, SITE_COLORS, SITE_NAMES, TAG_NAMES, ZONE_NAMES } from '../engine/cards';
import { costText, effectText, endText } from '../engine/text';
import type { Effect, Zone } from '../engine/types';
import { FishArt } from './FishArt';

export function Egg({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size * 1.2} viewBox="0 0 10 12" className="glyph egg" aria-hidden="true"><ellipse cx="5" cy="6.5" rx="4.2" ry="5.2" fill="#fff4d6" stroke="#b58a3c" strokeWidth="0.9" /></svg>;
}
export function Fry({ size = 12 }: { size?: number }) {
  return <svg width={size * 1.4} height={size} viewBox="0 0 14 10" className="glyph fry" aria-hidden="true"><path d="M1 5 Q6 1 10 5 Q6 9 1 5Z M10 5 L13.5 2.5 L13.5 7.5Z" fill="#ffd38a" stroke="#8a5a12" strokeWidth="0.6" /><circle cx="3.6" cy="4.6" r="0.8" fill="#222" /></svg>;
}
export function School({ size = 16 }: { size?: number }) {
  return (
    <svg width={size * 1.3} height={size} viewBox="0 0 26 20" className="glyph school" aria-hidden="true">
      <circle cx="13" cy="10" r="9.4" fill="#163f57" stroke="#7fd1c7" strokeWidth="1.2" />
      {[[7, 7], [14, 6], [10, 13], [17, 12]].map(([x, y], i) => <path key={i} d={`M${x - 3} ${y} q3 -2 6 0 q-3 2 -6 0Z m6 0 l2 -1.5 v3Z`} fill="#bff1ea" />)}
    </svg>
  );
}
export function CardGlyph() {
  return <svg width="11" height="14" viewBox="0 0 11 14" className="glyph" aria-hidden="true"><rect x="1" y="1" width="9" height="12" rx="1.6" fill="#dfe9f2" stroke="#456" /><path d="M3 7q2.5-2 5 0q-2.5 2-5 0Z" fill="#3a8fb3" /></svg>;
}
export function EatGlyph() {
  return <svg width="16" height="12" viewBox="0 0 16 12" className="glyph" aria-hidden="true"><path d="M1 6 Q6 0 12 3 L8 6 L12 9 Q6 12 1 6Z" fill="#e2715f" /><circle cx="4" cy="5" r="1" fill="#111" /><path d="M12.5 4.5 l2.5 1.5 l-2.5 1.5" fill="#cde" /></svg>;
}

const ZONE_GLYPH: Record<Zone, string> = { sun: '☀', twi: '◐', mid: '●' };
export const ZoneMark = ({ z }: { z: Zone }) => <span className={`zone-mark z-${z}`} title={ZONE_NAMES[z]} aria-label={ZONE_NAMES[z]}>{ZONE_GLYPH[z]}</span>;

/** A one-glyph summary of an effect, for the ocean and dive buttons. */
export function EffectIcon({ e }: { e: Effect }) {
  const n = 'n' in e && e.n > 1 ? <sup>{e.n}</sup> : null;
  switch (e.k) {
    case 'draw': return <span className="fx-icon" title={effectText(e)}><CardGlyph />{n}</span>;
    case 'egg': return <span className="fx-icon" title={effectText(e)}><Egg size={10} />{n}</span>;
    case 'eggEach': return <span className="fx-icon" title={effectText(e)}><Egg size={10} /><sup>∀</sup></span>;
    case 'hatch': return <span className="fx-icon" title={effectText(e)}><Egg size={9} />→<Fry size={9} /></span>;
    case 'fry': return <span className="fx-icon" title={effectText(e)}><Fry size={10} />{n}</span>;
    case 'move': return <span className="fx-icon" title={effectText(e)}>⇄</span>;
    case 'recover': return <span className="fx-icon" title={effectText(e)}>↺<CardGlyph /></span>;
    case 'cycle': return <span className="fx-icon" title={effectText(e)}>⟳</span>;
    case 'all': return <span className="fx-icon" title={effectText(e)}>all:<EffectIcon e={e.e} /></span>;
  }
}

export function CostIcons({ id }: { id: string }) {
  const c = FISH[id].cost;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < (c.cards ?? 0); i++) out.push(<CardGlyph key={`c${i}`} />);
  for (let i = 0; i < (c.eggs ?? 0); i++) out.push(<Egg key={`e${i}`} size={10} />);
  for (let i = 0; i < (c.fry ?? 0); i++) out.push(<Fry key={`f${i}`} size={9} />);
  if (c.eat) out.push(<EatGlyph key="eat" />);
  return <span className="cost-icons" title={`Cost: ${costText(c)}`}>{out.length ? out : <span className="free">free</span>}</span>;
}

/** A full fish card. `compact` drops the ability text (for tight rows). */
export function FishCard({ id, compact = false, dim = false, note }: { id: string; compact?: boolean; dim?: boolean; note?: string | null }) {
  const d = FISH[id];
  const site = d.site;
  return (
    <div className={`fish-card ${compact ? 'compact' : ''} ${dim ? 'dim' : ''}`} style={site !== undefined ? { ['--site' as string]: SITE_COLORS[site] } : undefined} data-site={site}>
      <div className="fc-top">
        <CostIcons id={id} />
        <span className="fc-pts" title={`${d.pts} points`}>{d.pts}</span>
      </div>
      <div className="fc-art"><FishArt id={id} /></div>
      <div className="fc-name">{d.name}</div>
      <div className="fc-row">
        <span className="fc-zones">{d.zones.map((z) => <ZoneMark key={z} z={z} />)}</span>
        <span className="fc-len" title="Size: it can eat smaller fish">size {d.len}</span>
      </div>
      {(site !== undefined || d.edge) && (
        <div className="fc-where">{site !== undefined ? `${SITE_NAMES[site]} only` : ''}{site !== undefined && d.edge ? ' · ' : ''}{d.edge === 'shallows' ? 'Shallows (top row) only' : d.edge === 'abyss' ? 'Abyss (bottom row) only' : ''}</div>
      )}
      {!compact && (
        <div className="fc-text">
          {d.play?.length ? <p><b className="when play">Released:</b> {d.play.map(effectText).join('. ')}.</p> : null}
          {d.dive?.length ? <p><b className="when dive">Dived:</b> {d.dive.map(effectText).join('. ')}.</p> : null}
          {d.end ? <p><b className="when end">Game end:</b> {endText(d.end)}.</p> : null}
          {d.cost.eat ? <p className="muted">Must be released on top of a smaller fish, which it eats.</p> : null}
        </div>
      )}
      {compact && (d.play?.length || d.dive?.length || d.end) ? (
        <div className="fc-icons">
          {d.play?.map((e, i) => <span key={`p${i}`} className="when-chip play"><EffectIcon e={e} /></span>)}
          {d.dive?.map((e, i) => <span key={`d${i}`} className="when-chip dive"><EffectIcon e={e} /></span>)}
          {d.end && <span className="when-chip end" title={endText(d.end)}>★</span>}
        </div>
      ) : null}
      {d.tags.length > 0 && <div className="fc-tags">{d.tags.map((t, i) => <span key={i} className={`tag t-${t}`}>{TAG_NAMES[t]}</span>)}</div>}
      {note && <div className="fc-note">{note}</div>}
    </div>
  );
}
