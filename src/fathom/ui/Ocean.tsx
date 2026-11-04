// One player's ocean: three dive sites by six rows, with each zone's dive bonuses between them.
import { BAIT, fishDef, SITE_COLORS, SITE_NAMES, ZONE_NAMES } from '../engine/cards';
import { BOTTOM_BONUS, MID_BONUS, top, TOP_BONUS, TWI_BONUS } from '../engine/game';
import { COLS, ROWS, slotOf, zoneOfRow, type Effect, type FPlayer, type Zone } from '../engine/types';
import { FishArt } from './FishArt';
import { Egg, EffectIcon, Fry, School, ZoneMark } from './FishCard';

const ZONE_BONUS: Record<Zone, Effect[]> = { sun: TOP_BONUS, twi: TWI_BONUS, mid: MID_BONUS };
const ZONE_ROWS: Record<Zone, number[]> = { sun: [0, 1], twi: [2, 3], mid: [4, 5] };

export interface OceanProps {
  p: FPlayer;
  /** slots that can be tapped right now */
  selectable?: Set<number>;
  selected?: number | null;
  onPick?: (slot: number) => void;
  onInspect?: (card: string) => void;
  /** dive buttons: shown when this is the player at the controls and it's their turn */
  onDive?: ((col: number) => void) | null;
  fresh?: number[];
  diving?: number | null;
}

export function Ocean({ p, selectable, selected, onPick, onInspect, onDive, fresh = [], diving = null }: OceanProps) {
  const has = (col: number, z: Zone) => ZONE_ROWS[z].some((r) => top(p.ocean[slotOf(r, col)]));
  return (
    <div className="ocean" style={{ ['--pc' as string]: p.color }}>
      <div className="ocean-grid" role="grid" aria-label={`${p.name}'s ocean`}>
        <div className="og-corner" />
        {Array.from({ length: COLS }, (_, c) => (
          <div key={c} className={`og-site ${diving === c ? 'diving' : ''}`} style={{ ['--site' as string]: SITE_COLORS[c] }}>
            <span className="og-site-name">{SITE_NAMES[c]}</span>
            {onDive && <button type="button" className="btn small dive-btn" onClick={() => onDive(c)} aria-label={`Dive the ${SITE_NAMES[c]} site`}>Dive ↓</button>}
          </div>
        ))}
        {(['sun', 'twi', 'mid'] as Zone[]).map((z) => (
          <ZoneBlock key={z} z={z} p={p} has={has} selectable={selectable} selected={selected} onPick={onPick} onInspect={onInspect} fresh={fresh} diving={diving} />
        ))}
        <div className="og-zone-label bottom">Bottom</div>
        {Array.from({ length: COLS }, (_, c) => (
          <div key={c} className={`og-bonus bottom ${p.bottom[c] ? 'taken' : 'lit'}`} title={p.bottom[c] ? 'Taken this tide' : 'The first dive to the bottom of this site each tide gets this'}>
            <span className="og-bonus-label">{p.bottom[c] ? 'taken' : 'first down'}</span>
            {BOTTOM_BONUS[c].map((e, i) => <EffectIcon key={i} e={e} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ZoneBlock({ z, p, has, selectable, selected, onPick, onInspect, fresh, diving }: {
  z: Zone; p: FPlayer; has: (col: number, z: Zone) => boolean; selectable?: Set<number>; selected?: number | null;
  onPick?: (slot: number) => void; onInspect?: (card: string) => void; fresh: number[]; diving: number | null;
}) {
  return (
    <>
      <div className={`og-zone-label z-${z}`}><ZoneMark z={z} /> {ZONE_NAMES[z]}</div>
      {Array.from({ length: COLS }, (_, c) => (
        <div key={c} className={`og-bonus z-${z} ${has(c, z) ? 'lit' : ''}`} title={has(c, z) ? `${ZONE_NAMES[z]} bonus: you have a fish here, so a dive collects it` : `${ZONE_NAMES[z]} bonus: needs a fish in this zone of this site`}>
          <EffectIcon e={ZONE_BONUS[z][c]} />
        </div>
      ))}
      {ZONE_ROWS[z].map((r) => (
        <Row key={r} r={r} p={p} selectable={selectable} selected={selected} onPick={onPick} onInspect={onInspect} fresh={fresh} diving={diving} />
      ))}
    </>
  );
}

function Row({ r, p, selectable, selected, onPick, onInspect, fresh, diving }: {
  r: number; p: FPlayer; selectable?: Set<number>; selected?: number | null; onPick?: (slot: number) => void; onInspect?: (card: string) => void; fresh: number[]; diving: number | null;
}) {
  return (
    <>
      <div className={`og-row-label z-${zoneOfRow(r)}`}>{r === 0 ? 'shallows' : r === ROWS - 1 ? 'abyss' : ''}</div>
      {Array.from({ length: COLS }, (_, c) => {
        const i = slotOf(r, c);
        const sl = p.ocean[i];
        const t = top(sl);
        const can = selectable?.has(i);
        const label = `${SITE_NAMES[c]} ${r + 1}${t ? `, ${t === BAIT ? 'bait shoal' : fishDef(t).name}` : ', empty'}${sl.egg ? ', egg' : ''}${sl.fry ? `, ${sl.fry} fry` : ''}${sl.school ? ', school' : ''}`;
        const click = can ? () => onPick?.(i) : t && t !== BAIT ? () => onInspect?.(t) : undefined;
        return (
          <button type="button" key={c} className={`slot z-${zoneOfRow(r)} ${t ? 'filled' : ''} ${can ? 'can' : ''} ${selected === i ? 'selected' : ''} ${fresh.includes(i) ? 'fresh' : ''} ${diving === c ? 'diving' : ''}`}
            onClick={click} disabled={!click} aria-label={label} style={{ ['--site' as string]: SITE_COLORS[c] }}>
            {t && (
              <span className="slot-fish">
                <FishArt id={t} size="mini" />
                {t !== BAIT && <span className="slot-name">{fishDef(t).name}</span>}
                {t !== BAIT && <span className="slot-pts">{fishDef(t).pts}</span>}
                {t !== BAIT && fishDef(t).dive && <span className="slot-dive">{fishDef(t).dive!.map((e, k) => <EffectIcon key={k} e={e} />)}</span>}
                {sl.fish.length > 1 && <span className="slot-eaten" title={`${sl.fish.length - 1} eaten fish beneath (1 point each)`}>+{sl.fish.length - 1}</span>}
              </span>
            )}
            <span className="slot-tokens">
              {sl.egg && <Egg size={11} />}
              {sl.fry > 0 && sl.fry <= 3 && Array.from({ length: sl.fry }, (_, k) => <Fry key={k} size={9} />)}
              {sl.fry > 3 && <><Fry size={9} /><small>×{sl.fry}</small></>}
              {sl.school && <School size={14} />}
            </span>
          </button>
        );
      })}
    </>
  );
}
