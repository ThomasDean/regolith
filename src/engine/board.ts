// The 61-hex map (rows of 5..9..5) with placement bonuses, ocean areas and the two
// off-Mars city spaces. Ids run "03".."63" in reading order.
import type { Space, SpaceBonus } from './types';

const S = 'steel', T = 'titanium', P = 'plants', D = 'card';
type Cell = [kind: 'L' | 'O' | 'V', ...bonus: SpaceBonus[]];

const ROWS: Cell[][] = [
  [['L', S, S], ['O', S, S], ['L'], ['O', D], ['O']],
  [['L'], ['V', S], ['L'], ['L'], ['L'], ['O', D, D]],
  [['V', D], ['L'], ['L'], ['L'], ['L'], ['L'], ['L', S]],
  [['V', P, T], ['L', P], ['L', P], ['L', P], ['L', P, P], ['L', P], ['L', P], ['O', P, P]],
  [['V', P, P], ['L', P, P], ['L', P, P], ['O', P, P], ['O', P, P], ['O', P, P], ['L', P, P], ['L', P, P], ['L', P, P]],
  [['L', P], ['L', P, P], ['L', P], ['L', P], ['L', P], ['O', P], ['O', P], ['O', P]],
  [['L'], ['L'], ['L'], ['L'], ['L'], ['L', P], ['L']],
  [['L', S, S], ['L'], ['L', D], ['L', D], ['L'], ['L', T]],
  [['L', S], ['L', S, S], ['L'], ['L'], ['O', T, T]],
];

export const NAMES: Record<string, string> = { '09': 'Tharsis Tholus', '14': 'Ascraeus Mons', '21': 'Pavonis Mons', '29': 'Arsia Mons', '31': 'Noctis City' };
export const VOLCANIC = ['09', '14', '21', '29'];
export const NOCTIS = '31';
export const GANYMEDE = 'g1';
export const PHOBOS = 'g2';

export function createBoard(): Space[] {
  const spaces: Space[] = [];
  let id = 3;
  ROWS.forEach((row, r) => {
    row.forEach(([kind, ...bonus], c) => {
      const sid = String(id++).padStart(2, '0');
      spaces.push({ id: sid, row: r, col: c, x: Math.abs(r - 4) + c * 2, type: kind === 'O' ? 'ocean' : 'land', bonus, name: NAMES[sid] });
    });
  });
  spaces.push({ id: GANYMEDE, row: -1, col: 0, x: 0, type: 'off', bonus: [], name: 'Ganymede Colony' });
  spaces.push({ id: PHOBOS, row: -1, col: 1, x: 0, type: 'off', bonus: [], name: 'Phobos Space Haven' });
  return spaces;
}

const ADJ = new Map<string, string[]>();

export function neighbours(board: Space[], id: string): Space[] {
  let ids = ADJ.get(id);
  if (!ids) {
    const a = board.find((s) => s.id === id)!;
    ids = a.type === 'off'
      ? []
      : board
        .filter((b) => b.type !== 'off' && b.id !== id && ((b.row === a.row && Math.abs(b.x - a.x) === 2) || (Math.abs(b.row - a.row) === 1 && Math.abs(b.x - a.x) === 1)))
        .map((b) => b.id);
    ADJ.set(id, ids);
  }
  return ids.map((n) => board.find((s) => s.id === n)!);
}

export const onMars = (s: Space) => s.type !== 'off';
