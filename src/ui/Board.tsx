import { memo } from 'react';
import type { GameState, Space } from '../engine/types';
import { CARDS } from '../engine/cards';

const R = 30; // hex radius
const W = Math.sqrt(3) * R;
const PAD = 8;

export function hexCentre(sp: Space): [number, number] {
  return [PAD + W / 2 + (sp.x * W) / 2, PAD + R + sp.row * R * 1.5];
}
const hexPath = (cx: number, cy: number, r = R) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');

const BOARD_W = PAD * 2 + W * 9;
const BOARD_H = PAD * 2 + R * 2 + 8 * R * 1.5;

function Bonus({ kinds, cx, cy }: { kinds: string[]; cx: number; cy: number }) {
  return (
    <g aria-hidden="true">
      {kinds.map((k, i) => {
        const x = cx + (i - (kinds.length - 1) / 2) * 13;
        const y = cy + 9;
        if (k === 'steel') return <rect key={i} x={x - 5} y={y - 5} width={10} height={10} rx={2} fill="#a8805c" stroke="#3a2a1c" strokeWidth={1} />;
        if (k === 'titanium') return <polygon key={i} points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`} fill="#d9dce6" stroke="#4b4f66" strokeWidth={1} />;
        if (k === 'plants') return <ellipse key={i} cx={x} cy={y} rx={4.5} ry={6} fill="#6fb45b" stroke="#24451c" strokeWidth={1} transform={`rotate(25 ${x} ${y})`} />;
        return <rect key={i} x={x - 4} y={y - 6} width={8} height={12} rx={1.5} fill="#ece5d8" stroke="#4b4f66" strokeWidth={1} />;
      })}
    </g>
  );
}

function TileArt({ s, sp, cx, cy }: { s: GameState; sp: Space; cx: number; cy: number }) {
  const t = sp.tile!;
  const owner = t.owner !== null ? s.players[t.owner] : null;
  if (t.kind === 'ocean') {
    return (
      <g>
        <polygon points={hexPath(cx, cy, R - 1)} fill="var(--sea)" />
        {[-7, 1, 9].map((dy) => (
          <path key={dy} d={`M${cx - 14},${cy + dy} q 7,-5 14,0 t 14,0`} fill="none" stroke="#9fc6ea" strokeWidth={1.6} strokeLinecap="round" opacity={0.75} />
        ))}
      </g>
    );
  }
  if (t.kind === 'greenery') {
    return (
      <g>
        <polygon points={hexPath(cx, cy, R - 1)} fill="var(--leaf)" stroke={owner!.color} strokeWidth={3} />
        {[[-8, 2], [6, -6], [5, 8]].map(([dx, dy], i) => (
          <circle key={i} cx={cx + dx} cy={cy + dy} r={6} fill="#4c8640" stroke="#2c5424" strokeWidth={1} />
        ))}
      </g>
    );
  }
  if (t.kind === 'city') {
    return (
      <g>
        <polygon points={hexPath(cx, cy, R - 1)} fill="#d6d0c3" stroke={owner!.color} strokeWidth={3} />
        <path d={`M${cx - 13},${cy + 10} v-10 h6 v-8 h7 v12 h5 v-16 h7 v22 z`} fill="#56607a" />
        {t.card === 'capital' && <text x={cx} y={cy - 13} textAnchor="middle" className="tile-label">Capital</text>}
      </g>
    );
  }
  const name = t.card ? CARDS[t.card]?.name ?? '' : '';
  const short = name.split(' ').map((w) => w[0]).join('').slice(0, 3);
  return (
    <g>
      <polygon points={hexPath(cx, cy, R - 1)} fill={owner?.color ?? '#888'} opacity={0.85} />
      <polygon points={hexPath(cx, cy, R - 7)} fill="none" stroke="#1d2840" strokeWidth={2} strokeDasharray="4 3" />
      <text x={cx} y={cy + 5} textAnchor="middle" className="tile-label dark">{short}</text>
      <title>{name}</title>
    </g>
  );
}

interface Props {
  s: GameState;
  options?: string[];
  onPick?: (id: string) => void;
}

export const Board = memo(function Board({ s, options, onPick }: Props) {
  const opt = new Set(options ?? []);
  const mars = s.board.filter((x) => x.type !== 'off');
  const off = s.board.filter((x) => x.type === 'off');
  return (
    <div className="board-wrap">
      <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="board" role="img" aria-label="Map of Mars">
        <defs>
          <radialGradient id="dust" cx="45%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#d8ab73" />
            <stop offset="100%" stopColor="#b98450" />
          </radialGradient>
        </defs>
        {/* topographic contour lines behind the map */}
        <g className="contours" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ellipse key={i} cx={BOARD_W * 0.42} cy={BOARD_H * 0.47} rx={60 + i * 42} ry={44 + i * 34} transform={`rotate(-14 ${BOARD_W * 0.42} ${BOARD_H * 0.47})`} />
          ))}
        </g>
        {mars.map((sp) => {
          const [cx, cy] = hexCentre(sp);
          const can = opt.has(sp.id);
          const claimed = sp.claimedBy !== undefined ? s.players[sp.claimedBy] : null;
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
                fill={sp.type === 'ocean' ? '#2b4a72' : 'url(#dust)'}
              />
              {sp.tile ? <TileArt s={s} sp={sp} cx={cx} cy={cy} /> : (
                <>
                  <Bonus kinds={sp.bonus} cx={cx} cy={cy} />
                  {sp.name && <text x={cx} y={cy - 8} textAnchor="middle" className="hex-name">{sp.name.replace(' Mons', '').replace('Tharsis ', '')}</text>}
                </>
              )}
              {claimed && !sp.tile && <circle cx={cx} cy={cy - 12} r={5} fill={claimed.color} stroke="#1d2840" strokeWidth={1.5}><title>Claimed by {claimed.name}</title></circle>}
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
            <button key={sp.id} type="button" className={`offworld-space ${can ? 'pickable' : ''}`} disabled={!can} onClick={() => can && onPick?.(sp.id)}
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
