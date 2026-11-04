// Fathom's own wording for every effect and scoring rule (used on cards and in help).
import { TAG_NAMES, ZONE_NAMES } from './cards';
import type { Cost, Effect, EndRule, Filter } from './types';

const plural = (n: number, one: string, many = `${one}s`) => `${n === 1 ? 'a' : n} ${n === 1 ? one : many}`;

function filterText(f: Filter | undefined): string {
  if (!f) return 'fish';
  if (f.sameCol) return 'fish in this site';
  if (f.zone) return `${ZONE_NAMES[f.zone]} fish`;
  if (f.tag) return `${TAG_NAMES[f.tag]} fish`;
  return 'fish';
}

export function effectText(e: Effect): string {
  switch (e.k) {
    case 'draw': return `Draw ${plural(e.n, 'card')}`;
    case 'egg': return e.n === 1 ? `Lay an egg on a ${filterText(e.where)}` : `Lay up to ${e.n} eggs, on different ${filterText(e.where)}`;
    case 'eggEach': return `Lay an egg on each of your ${filterText(e.where)} without one`;
    case 'hatch': return e.n === 1 ? 'Hatch an egg into a fry' : `Hatch up to ${e.n} eggs into fry`;
    case 'fry': return e.n === 1 ? 'Add a fry anywhere in your ocean' : `Add ${e.n} fry anywhere in your ocean`;
    case 'move': return 'Move a fry or a school any distance in a straight line';
    case 'recover': return 'Take a card back from your discard pile';
    case 'cycle': return 'Swap a card in hand for a new one';
    case 'all': return e.e.k === 'draw' ? 'Every player draws a card' : `Every player lays an egg on each of their ${filterText(e.e.where)} without one`;
  }
}

export function endText(r: EndRule): string {
  const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`;
  switch (r.k) {
    case 'tag': return `${pts(r.pts)} per ${TAG_NAMES[r.tag]} tag in your ocean`;
    case 'zone': return `${pts(r.pts)} per fish in your ${ZONE_NAMES[r.zone]} zone`;
    case 'eggsCol': return `${pts(r.pts)} per egg in this site`;
    case 'fishCol': return `${pts(r.pts)} per fish in this site`;
    case 'schools': return `${pts(r.pts)} per school in your ocean`;
    case 'hand': return `${pts(r.pts)} per card left in hand (up to ${r.max})`;
    case 'beneath': return `${pts(r.pts)} per fish beneath this one`;
  }
}

export function costText(c: Cost): string {
  const parts: string[] = [];
  if (c.cards) parts.push(`discard ${plural(c.cards, 'card')}`);
  if (c.eggs) parts.push(`spend ${plural(c.eggs, 'egg')}`);
  if (c.fry) parts.push(`spend ${c.fry} fry`);
  if (c.eat) parts.push('eat a smaller fish');
  return parts.length ? parts.join(', ') : 'free';
}
