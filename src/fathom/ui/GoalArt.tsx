// Pictures for the tide goals, and the "pips" a goal counts (one per egg, fish, row…), used by the
// end-of-tide count and the rules guide.
import { fishDef } from '../engine/cards';
import { top } from '../engine/game';
import { COLS, ROWS, slotOf, zoneOf, zoneOfRow, type FPlayer, type GoalId, type Zone } from '../engine/types';
import { FishArt } from './FishArt';
import { Egg, EatGlyph, Fry, School } from './FishCard';

const ZONE_FILL: Record<Zone, string> = { sun: '#f2c14e', twi: '#8fb5e0', mid: '#6b6fa8' };

export function GoalIcon({ id, size = 22 }: { id: GoalId; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 20 20', className: 'glyph goal-icon', 'aria-hidden': true } as const;
  switch (id) {
    case 'brood':
      return (
        <svg {...s}>
          <ellipse cx="6.5" cy="11" rx="4.4" ry="5.6" fill="#fff4d6" stroke="#b58a3c" strokeWidth="0.9" />
          <path d="M10 11 Q14 7.6 17 11 Q14 14.4 10 11Z M17 11 L19.6 9 L19.6 13Z" fill="#ffd38a" stroke="#8a5a12" strokeWidth="0.6" />
        </svg>
      );
    case 'rows':
      return <svg {...s}>{[0, 1, 2].map((c) => <rect key={c} x={1 + c * 6.3} y="7" width="5.4" height="6" rx="1" fill="#7fd1c7" />)}<rect x="0.5" y="2" width="19" height="3" rx="1" fill="#7fd1c7" opacity="0.25" /><rect x="0.5" y="15" width="19" height="3" rx="1" fill="#7fd1c7" opacity="0.25" /></svg>;
    case 'schools':
      return <svg {...s}><circle cx="10" cy="10" r="8.8" fill="#163f57" stroke="#7fd1c7" strokeWidth="1.2" />{[[6, 7.5], [11.5, 6.5], [8, 12.5], [13.5, 12]].map(([x, y], i) => <path key={i} d={`M${x - 2.6} ${y} q2.6 -1.8 5.2 0 q-2.6 1.8 -5.2 0Z m5.2 0 l1.7 -1.3 v2.6Z`} fill="#bff1ea" />)}</svg>;
    case 'hunters':
      return <svg {...s}><path d="M1 10 Q7 2 15 6 L10 10 L15 14 Q7 18 1 10Z" fill="#e2715f" /><path d="M10 10 L11.2 8.2 L12.2 9.6 L13.4 7.6 M10 10 L11.2 11.8 L12.2 10.4 L13.4 12.4" stroke="#fff" strokeWidth="0.8" fill="none" /><circle cx="5" cy="8.6" r="1.1" fill="#111" /><circle cx="18" cy="10" r="1.4" fill="#ffd38a" /></svg>;
    case 'deep':
      return <svg {...s}><rect x="1" y="1" width="18" height="18" rx="4" fill="#0c1f35" stroke="#6b6fa8" /><path d="M4 11 Q9 6 14 11 Q9 16 4 11Z M14 11 L17 8.6 L17 13.4Z" fill="#6b6fa8" /><circle cx="15.5" cy="4.5" r="1.4" fill="#a9e7ee" /></svg>;
    case 'sunlit':
      return <svg {...s}><circle cx="10" cy="10" r="4.4" fill="#f2c14e" />{Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return <line key={i} x1={10 + Math.cos(a) * 6.2} y1={10 + Math.sin(a) * 6.2} x2={10 + Math.cos(a) * 8.8} y2={10 + Math.sin(a) * 8.8} stroke="#f2c14e" strokeWidth="1.5" strokeLinecap="round" />; })}</svg>;
    case 'giants':
      return <svg {...s}><path d="M0.5 10 Q8 1 16 7 L19.5 3.5 L19.5 16.5 L16 13 Q8 19 0.5 10Z" fill="#4aa3df" /><circle cx="5" cy="8.6" r="1.2" fill="#111" /><text x="9" y="12.6" fontSize="6.5" fontWeight="700" fill="#fff" fontFamily="sans-serif">5+</text></svg>;
    case 'feast':
      return <svg {...s}><path d="M1 10 Q8 1 16 6 L11 10 L16 14 Q8 19 1 10Z" fill="#e2715f" /><circle cx="5" cy="8.4" r="1.2" fill="#111" /><path d="M12.8 10 q2.6 -1.8 5.2 0 q-2.6 1.8 -5.2 0Z" fill="#ffd38a" /></svg>;
    case 'columns':
      return <svg {...s}>{(['sun', 'twi', 'mid'] as Zone[]).map((z, i) => <rect key={z} x="7" y={1 + i * 6.3} width="6" height="5.4" rx="1" fill={ZONE_FILL[z]} />)}<rect x="1.5" y="1" width="3" height="18" rx="1" fill="#7fd1c7" opacity="0.25" /><rect x="15.5" y="1" width="3" height="18" rx="1" fill="#7fd1c7" opacity="0.25" /></svg>;
  }
}

/** One counted thing for a goal. */
export type Pip =
  | { k: 'egg' } | { k: 'fry' } | { k: 'school' }
  | { k: 'fish'; id: string }
  | { k: 'row'; r: number } | { k: 'col'; c: number };

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Everything this player's ocean counts for a goal, one pip per unit of the goal's metric. */
export function goalPips(p: FPlayer, g: GoalId): Pip[] {
  const tops = p.ocean.map((x, i) => ({ i, t: top(x) }));
  switch (g) {
    case 'brood': return [...p.ocean.filter((x) => x.egg).map((): Pip => ({ k: 'egg' })), ...p.ocean.flatMap((x) => range(x.fry).map((): Pip => ({ k: 'fry' })))];
    case 'rows': return range(ROWS).filter((r) => range(COLS).every((c) => top(p.ocean[slotOf(r, c)]))).map((r) => ({ k: 'row', r }));
    case 'schools': return p.ocean.filter((x) => x.school).map(() => ({ k: 'school' }));
    case 'hunters': return tops.flatMap(({ t }) => (t ? fishDef(t).tags.filter((x) => x === 'predator').map((): Pip => ({ k: 'fish', id: t })) : []));
    case 'deep': return tops.filter(({ i, t }) => t && zoneOf(i) === 'mid').map(({ t }) => ({ k: 'fish', id: t! }));
    case 'sunlit': return tops.filter(({ i, t }) => t && zoneOf(i) === 'sun').map(({ t }) => ({ k: 'fish', id: t! }));
    case 'giants': return tops.filter(({ t }) => t && fishDef(t).len >= 5).map(({ t }) => ({ k: 'fish', id: t! }));
    case 'feast': return p.ocean.flatMap((x) => x.fish.slice(0, -1).map((id): Pip => ({ k: 'fish', id })));
    case 'columns': return range(COLS).filter((c) => (['sun', 'twi', 'mid'] as Zone[]).every((z) => range(ROWS).some((r) => zoneOfRow(r) === z && top(p.ocean[slotOf(r, c)])))).map((c) => ({ k: 'col', c }));
  }
}

export function PipView({ pip, g }: { pip: Pip; g: GoalId }) {
  switch (pip.k) {
    case 'egg': return <Egg size={13} />;
    case 'fry': return <Fry size={12} />;
    case 'school': return <School size={15} />;
    case 'fish': return <span className={`pip-fish ${g === 'feast' ? 'eaten' : ''}`}><FishArt id={pip.id} size="mini" />{g === 'feast' && <EatGlyph size={8} />}</span>;
    case 'row': return <span className="pip-tag" title={`Row ${pip.r + 1}`}><GoalIcon id="rows" size={16} />{pip.r + 1}</span>;
    case 'col': return <span className="pip-tag"><GoalIcon id="columns" size={16} /></span>;
  }
}

/** "3 eggs and fry", "2 full rows"… for the count's caption. */
export function unitName(g: GoalId, n: number): string {
  const u: Record<GoalId, [string, string]> = {
    brood: ['egg or fry', 'eggs and fry'], rows: ['full row', 'full rows'], schools: ['school', 'schools'], hunters: ['Predator tag', 'Predator tags'],
    deep: ['Midnight fish', 'Midnight fish'], sunlit: ['Sunlight fish', 'Sunlight fish'], giants: ['giant', 'giants'], feast: ['fish eaten', 'fish eaten'], columns: ['full site', 'full sites'],
  };
  return `${n} ${u[g][n === 1 ? 0 : 1]}`;
}

