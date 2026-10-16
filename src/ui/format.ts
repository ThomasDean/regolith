import type { Res, Tag } from '../engine/types';

export const RES_LABEL: Record<Res, string> = { mc: 'M€', steel: 'Steel', titanium: 'Titanium', plants: 'Plants', energy: 'Energy', heat: 'Heat' };
export const RES_COLOR: Record<Res, string> = {
  mc: '#e3b341', steel: '#a8805c', titanium: '#b9bfd0', plants: '#6fb45b', energy: '#a487e0', heat: '#e2733c',
};
export const TAG_COLOR: Record<Tag, string> = {
  building: '#a8805c', space: '#3b3f58', science: '#e8e3d3', power: '#a487e0', earth: '#4d8fc9', jovian: '#d79a4a',
  plant: '#6fb45b', microbe: '#9cc35a', animal: '#5d8a46', city: '#9aa3b2', event: '#c4472f',
};
export const PLAYER_COLORS = ['#e4574a', '#4a9fe4', '#5fc07a', '#e8c547', '#b077e0'];
export const PLAYER_COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple'];

export const fmtTemp = (t: number) => `${t > 0 ? '+' : ''}${t}°C`;
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function reqText(r: import('../engine/cards').Req | undefined): string | null {
  if (!r) return null;
  const parts: string[] = [];
  if (r.temp !== undefined) parts.push(`${fmtTemp(r.temp)} or warmer`);
  if (r.tempMax !== undefined) parts.push(`${fmtTemp(r.tempMax)} or colder`);
  if (r.oxy !== undefined) parts.push(`${r.oxy}% oxygen or more`);
  if (r.oxyMax !== undefined) parts.push(`${r.oxyMax}% oxygen or less`);
  if (r.oceans !== undefined) parts.push(`${r.oceans} oceans or more`);
  if (r.oceansMax !== undefined) parts.push(`${r.oceansMax} oceans or fewer`);
  if (r.tags) for (const [t, n] of Object.entries(r.tags)) parts.push(`${n} ${t} tag${n! > 1 ? 's' : ''}`);
  if (r.prod) for (const [k, n] of Object.entries(r.prod)) parts.push(`${n} ${RES_LABEL[k as Res].toLowerCase()} production`);
  if (r.greeneries) parts.push('a greenery of yours');
  if (r.citiesAll) parts.push(`${r.citiesAll} cities in play`);
  return parts.join(', ');
}

export const LEVEL_LABEL = { easy: 'Easy CPU', normal: 'Normal CPU', hard: 'Hard CPU' } as const;
