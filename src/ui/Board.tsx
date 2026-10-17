import { memo } from 'react';
import type { GameState, Space } from '../engine/types';
import { CARDS } from '../engine/cards';
import { hashStr, rng } from './CardArt';
import { resGlyph } from './Icons';

const R = 30; // hex radius
const W = Math.sqrt(3) * R;
const PAD = 8;
const M = 34; // margin around the map for the planet rim

export function hexCentre(sp: Space): [number, number] {
  return [PAD + W / 2 + (sp.x * W) / 2, PAD + R + sp.row * R * 1.5];
}
const hexPath = (cx: number, cy: number, r = R) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

const BOARD_W = PAD * 2 + W * 9;
const BOARD_H = PAD * 2 + R * 2 + 8 * R * 1.5;
const CX = BOARD_W / 2;
const CY = BOARD_H / 2;
const PLANET_R = BOARD_H / 2 + 22;

// fixed backdrop: stars outside the disc, craters on it
const STARS = (() => {
  const r = rng(7);
  return Array.from({ length: 90 }, () => {
    const x = -M + r() * (BOARD_W + 2 * M), y = -M + r() * (BOARD_H + 2 * M);
    return { x, y, s: 0.4 + r() * 1.1, o: 0.3 + r() * 0.7, tw: r() > 0.8 };
  }).filter((st) => Math.hypot(st.x - CX, st.y - CY) > PLANET_R + 6);
})();
const CRATERS = (() => {
  const r = rng(11);
  return Array.from({ length: 26 }, () => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (PLANET_R - 12);
    return { x: CX + Math.cos(a) * d, y: CY + Math.sin(a) * d, r: 3 + r() * 13 };
  });
})();

function Bonus({ kinds, cx, cy }: { kinds: string[]; cx: number; cy: number }) {
  return (
    <g aria-hidden="true" className="hex-bonus">
      {kinds.map((k, i) => {
        const x = cx + (i - (kinds.length - 1) / 2) * 14;
        const y = cy + 8;
        if (k === 'card') {
          return (
            <g key={i} transform={`translate(${x - 5} ${y - 7})`}>
              <rect width="10" height="13" rx="1.6" fill="#f3ecdd" stroke="#4b4f66" strokeWidth="1" />
              <rect x="1.6" y="1.6" width="6.8" height="4.6" fill="#c4472f" />
              <path d="M2 8.4h6M2 10.2h4" stroke="#4b4f66" strokeWidth="0.8" />
            </g>
          );
        }
        return <g key={i} transform={`translate(${x - 6.5} ${y - 6.5}) scale(0.81)`}>{resGlyph(k as 'steel' | 'titanium' | 'plants')}</g>;
      })}
    </g>
  );
}

// glyph for special tiles, chosen from the card's subject
function specialGlyph(card: string | undefined, cx: number, cy: number) {
  const n = card ?? '';
  const ink = '#1d2840';
  if (/mine|mining/.test(n)) return <path d={`M${cx - 9},${cy + 8} l12,-12 m-4,-4 q8,-2 12,4 m-8,-4 q2,8 -4,12`} fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />;
  if (/nuclear/.test(n)) return <g fill={ink}>{[0, 120, 240].map((a) => <path key={a} d={`M${cx},${cy} l-5,-9 a10,10 0 0 1 10,0Z`} transform={`rotate(${a} ${cx} ${cy})`} />)}<circle cx={cx} cy={cy} r="2.2" fill="#f3ecdd" /></g>;
  if (/lava|mohole/.test(n)) return <path d={`M${cx - 11},${cy + 8} l8,-14 h6 l8,14Z M${cx - 2},${cy - 6} q-2,-5 2,-8 q4,3 2,8`} fill={ink} />;
  if (/preserve|habitat|park/.test(n)) return <path d={`M${cx - 8},${cy + 8} C${cx - 8},${cy - 2} ${cx - 2},${cy - 9} ${cx + 9},${cy - 9} c0,10 -6,17 -17,17Zm0,0 9,-9`} fill={ink} />;
  if (/restricted/.test(n)) return <g fill="none" stroke={ink} strokeWidth="2.6"><circle cx={cx} cy={cy} r="9" /><path d={`M${cx - 6},${cy + 6} l12,-12`} /></g>;
  if (/commercial/.test(n)) return <g><circle cx={cx} cy={cy} r="9" fill="#e3b341" stroke={ink} strokeWidth="1.6" /><path d={`M${cx - 4},${cy + 4} v-8 l4,4 l4,-4 v8`} fill="none" stroke={ink} strokeWidth="1.8" /></g>;
  if (/industrial/.test(n)) return <g fill={ink}><circle cx={cx} cy={cy} r="7" />{Array.from({ length: 8 }, (_, k) => <rect key={k} x={cx - 2} y={cy - 11} width="4" height="5" transform={`rotate(${k * 45} ${cx} ${cy})`} />)}<circle cx={cx} cy={cy} r="2.6" fill="#f3ecdd" /></g>;
  if (/ecological|zone/.test(n)) return <path d={`M${cx - 10},${cy + 6} q4,-12 10,-4 q6,-10 10,4Z`} fill={ink} />;
  return <path d={`M${cx},${cy - 10} l3,7 h7 l-6,4 l2,7 l-6,-4 l-6,4 l2,-7 l-6,-4 h7Z`} fill={ink} />;
}

function TileArt({ s, sp, cx, cy, fresh }: { s: GameState; sp: Space; cx: number; cy: number; fresh: boolean }) {
  const t = sp.tile!;
  const owner = t.owner !== null ? s.players[t.owner] : null;
  const cls = `tile tile-${t.kind} ${fresh ? 'tile-new' : ''}`;
  if (t.kind === 'ocean') {
    return (
      <g className={cls}>
        <polygon points={hexPath(cx, cy, R - 1)} fill="url(#seaTile)" stroke="#9fd0f0" strokeWidth="1" />
        <g className="waves">
          {[-8, 0, 8].map((dy, i) => (
            <path key={dy} d={`M${cx - 18},${cy + dy} q 4.5,-4 9,0 t 9,0 t 9,0 t 9,0`} fill="none" stroke="#cfe8f8" strokeWidth={1.4} strokeLinecap="round" opacity={0.75 - i * 0.12} />
          ))}
        </g>
        <path d={`M${cx - 6},${cy - 15} l5,-2 l4,1 l-2,3Z`} fill="#eef7fb" opacity="0.9" />
      </g>
    );
  }
  if (t.kind === 'greenery') {
    const r = rng(hashStr(sp.id));
    const trees = [[-9, 4], [6, -7], [7, 8], [-2, -4]].map(([dx, dy]) => [cx + dx + (r() - 0.5) * 3, cy + dy + (r() - 0.5) * 3, 0.85 + r() * 0.3]);
    return (
      <g className={cls}>
        <polygon points={hexPath(cx, cy, R - 1)} fill="url(#leafTile)" />
        {trees.map(([x, y, sc], i) => (
          i % 2 === 0
            ? <g key={i}><rect x={x - 0.9} y={y + 1} width="1.8" height="4" fill="#3a2418" /><circle cx={x} cy={y - 1} r={5.5 * sc} fill="#3f7a3a" stroke="#24451c" strokeWidth="0.8" /><circle cx={x - 1.8} cy={y - 2.8} r={1.8 * sc} fill="#9cc35a" opacity="0.6" /></g>
            : <g key={i}><rect x={x - 0.8} y={y + 3} width="1.6" height="3" fill="#3a2418" /><path d={`M${x},${y - 9 * sc} l${5 * sc},${12 * sc} h${-10 * sc}Z`} fill="#2f6a3c" stroke="#1d3f1a" strokeWidth="0.8" /></g>
        ))}
        <polygon points={hexPath(cx, cy, R - 2.5)} fill="none" stroke={owner!.color} strokeWidth={3.4} />
        <polygon points={hexPath(cx, cy - R + 7, 4.2)} fill={owner!.color} stroke="#1d2840" strokeWidth="1" />
      </g>
    );
  }
  if (t.kind === 'city') {
    const r = rng(hashStr(sp.id + 'c'));
    const towers = [[-11, 12], [-4, 18], [3, 14], [9, 9]].map(([dx, h]) => [cx + dx, h + r() * 6]);
    return (
      <g className={cls}>
        <polygon points={hexPath(cx, cy, R - 1)} fill="url(#cityTile)" />
        {towers.map(([x, h], i) => (
          <g key={i}>
            <rect x={x - 3} y={cy + 9 - h} width="6" height={h} fill={i % 2 ? '#3a3f55' : '#4a4e66'} />
            {Array.from({ length: Math.floor(h / 4) }, (_, j) => <rect key={j} x={x - 1.6 + (j % 2) * 2} y={cy + 11 - h + j * 3.6} width="1.3" height="1.3" fill="#ffd27a" />)}
          </g>
        ))}
        <path d={`M${cx - 17},${cy + 10} a17,15 0 0 1 34,0Z`} fill="#bfe9ff" opacity="0.35" stroke="#e8f8ff" strokeWidth="1" />
        <path d={`M${cx - 11},${cy - 1} a10,9 0 0 1 7,-5`} fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" />
        <polygon points={hexPath(cx, cy, R - 2.5)} fill="none" stroke={owner!.color} strokeWidth={3.4} />
        <polygon points={hexPath(cx, cy - R + 7, 4.2)} fill={owner!.color} stroke="#1d2840" strokeWidth="1" />
        {t.card === 'capital' && <text x={cx} y={cy + 20} textAnchor="middle" className="tile-label">Capital</text>}
      </g>
    );
  }
  const name = t.card ? CARDS[t.card]?.name ?? '' : '';
  return (
    <g className={cls}>
      <polygon points={hexPath(cx, cy, R - 1)} fill={owner?.color ?? '#888'} />
      <polygon points={hexPath(cx, cy, R - 1)} fill="url(#specialSheen)" />
      <polygon points={hexPath(cx, cy, R - 7)} fill="#f3ecdd" opacity="0.88" stroke="#1d2840" strokeWidth="1.5" />
      {specialGlyph(t.card, cx, cy)}
      <title>{name}</title>
    </g>
  );
}

interface Props {
  s: GameState;
  options?: string[];
  onPick?: (id: string) => void;
  /** spaces whose tiles were just placed (animate in) */
  fresh?: string[];
  /** a global parameter just moved: tint the planet briefly */
  pulse?: { kind: 'temp' | 'oxy' | 'ocean'; key: number } | null;
}

export const Board = memo(function Board({ s, options, onPick, fresh, pulse }: Props) {
  const opt = new Set(options ?? []);
  const fr = new Set(fresh ?? []);
  const mars = s.board.filter((x) => x.type !== 'off');
  const off = s.board.filter((x) => x.type === 'off');
  // terraforming progress warms the planet's colour
  const progress = ((s.temperature + 30) / 38 + s.oxygen / 14 + s.oceans / 9) / 3;
  return (
    <div className="board-wrap">
      <svg viewBox={`${-M} ${-M} ${BOARD_W + 2 * M} ${BOARD_H + 2 * M}`} className="board" role="img" aria-label="Map of Mars" style={{ ['--progress' as string]: progress }}>
        <defs>
          <radialGradient id="planet" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#c8673c" />
            <stop offset="70%" stopColor="#8e3a22" />
            <stop offset="100%" stopColor="#4e1c12" />
          </radialGradient>
          <radialGradient id="atmo" cx="50%" cy="50%" r="50%">
            <stop offset="88%" stopColor="#ff9a6a" stopOpacity="0" />
            <stop offset="95%" stopColor="#ffb08a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#6ab8ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="dust" cx="45%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#e2b47c" />
            <stop offset="100%" stopColor="#b47a46" />
          </radialGradient>
          <radialGradient id="basin" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#4a5a80" />
            <stop offset="100%" stopColor="#2b3a5c" />
          </radialGradient>
          <linearGradient id="seaTile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4b94d4" />
            <stop offset="1" stopColor="#1d4a86" />
          </linearGradient>
          <radialGradient id="leafTile" cx="45%" cy="35%" r="75%">
            <stop offset="0" stopColor="#8fc45e" />
            <stop offset="1" stopColor="#4a8040" />
          </radialGradient>
          <linearGradient id="cityTile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9d3c6" />
            <stop offset="1" stopColor="#a8a092" />
          </linearGradient>
          <linearGradient id="specialSheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#000" stopOpacity="0.3" />
          </linearGradient>
          <pattern id="grain" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
            <circle cx="2" cy="2" r="0.7" fill="#5a2a14" />
          </pattern>
        </defs>

        <g className="stars" aria-hidden="true">
          {STARS.map((st, i) => <circle key={i} cx={st.x} cy={st.y} r={st.s} fill="#fff" opacity={st.o} className={st.tw ? 'twinkle' : undefined} style={st.tw ? { animationDelay: `${(i % 7) * 0.6}s` } : undefined} />)}
        </g>
        <g aria-hidden="true">
          <circle cx={CX} cy={CY} r={PLANET_R + 14} fill="url(#atmo)" />
          <circle cx={CX} cy={CY} r={PLANET_R} fill="url(#planet)" />
          <circle cx={CX} cy={CY} r={PLANET_R} fill="#3f7a5a" className="planet-green" />
          {CRATERS.map((c, i) => (
            <g key={i} opacity="0.5">
              <circle cx={c.x} cy={c.y} r={c.r} fill="#5e2416" />
              <path d={`M${c.x - c.r * 0.8},${c.y - c.r * 0.4} a${c.r},${c.r} 0 0 1 ${c.r * 1.4},-${c.r * 0.5}`} fill="none" stroke="#e08a5a" strokeWidth="1.2" />
            </g>
          ))}
          <circle cx={CX} cy={CY} r={PLANET_R} fill="url(#grain)" opacity="0.18" />
          {pulse && <circle key={pulse.key} cx={CX} cy={CY} r={PLANET_R} className={`planet-pulse pulse-${pulse.kind}`} />}
        </g>

        {mars.map((sp) => {
          const [cx, cy] = hexCentre(sp);
          const can = opt.has(sp.id);
          const claimed = sp.claimedBy !== undefined ? s.players[sp.claimedBy] : null;
          const shade = (hashStr(sp.id) % 100) / 100;
          return (
            <g
              key={sp.id}
              className={`hex ${can ? 'pickable' : ''}`}
              onClick={can && onPick ? () => onPick(sp.id) : undefined}
              onKeyDown={can && onPick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(sp.id); } } : undefined}
              tabIndex={can ? 0 : -1}
              role={can ? 'button' : undefined}
              aria-label={can ? `Place on space ${sp.id}${sp.name ? ` (${sp.name})` : ''}` : undefined}
            >
              <polygon
                points={hexPath(cx, cy, R - 1)}
                className={sp.type === 'ocean' ? 'hex-ocean-area' : 'hex-land'}
                fill={sp.type === 'ocean' ? 'url(#basin)' : 'url(#dust)'}
              />
              {sp.type !== 'ocean' && <polygon points={hexPath(cx, cy, R - 1)} fill={shade > 0.5 ? '#fff' : '#5a2a14'} opacity={Math.abs(shade - 0.5) * 0.16} pointerEvents="none" />}
              {sp.type === 'ocean' && !sp.tile && <path d={`M${cx - 12},${cy - 5} q 6,-3 12,0 t 12,0`} fill="none" stroke="#9fc6ea" strokeWidth="1" opacity="0.45" pointerEvents="none" />}
              {sp.tile ? <TileArt s={s} sp={sp} cx={cx} cy={cy} fresh={fr.has(sp.id)} /> : (
                <>
                  <Bonus kinds={sp.bonus} cx={cx} cy={cy} />
                  {sp.name && <text x={cx} y={cy - 9} textAnchor="middle" className={`hex-name ${sp.type === 'ocean' ? 'on-basin' : ''}`}>{sp.name.replace(' Mons', '').replace('Tharsis ', '')}</text>}
                  {/Mons|Tholus/.test(sp.name ?? '') && <path d={`M${cx - 9},${cy - 13} l5,-7 h8 l5,7`} fill="none" stroke="#7a4a24" strokeWidth="1.2" opacity="0.7" />}
                </>
              )}
              {claimed && !sp.tile && <circle cx={cx} cy={cy - 13} r={5} fill={claimed.color} stroke="#1d2840" strokeWidth={1.5}><title>Claimed by {claimed.name}</title></circle>}
              {fr.has(sp.id) && sp.tile && (
                <g className={`burst burst-${sp.tile.kind}`} pointerEvents="none" style={{ ['--pc' as string]: sp.tile.owner !== null ? s.players[sp.tile.owner].color : '#cfe8f8' }}>
                  <circle cx={cx} cy={cy} r={R - 4} className="burst-ring" />
                  <circle cx={cx} cy={cy} r={R - 4} className="burst-ring late" />
                </g>
              )}
              {can && <polygon points={hexPath(cx, cy, R - 3)} className="hex-ring" />}
            </g>
          );
        })}
      </svg>
      <div className="offworld">
        {off.map((sp) => {
          const can = opt.has(sp.id);
          const owner = sp.tile ? s.players[sp.tile.owner!] : null;
          return (
            <button key={sp.id} type="button" className={`offworld-space ${can ? 'pickable' : ''} ${owner && fr.has(sp.id) ? 'tile-new-chip' : ''}`} disabled={!can} onClick={() => can && onPick?.(sp.id)}
              style={owner ? { borderColor: owner.color } : undefined}>
              <span className="dot" style={{ background: owner?.color ?? 'transparent' }} />
              {sp.name}{owner ? `: ${owner.name}'s city` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
});
