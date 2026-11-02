// Shorthands for building card effects as op lists (shared by the expansion card catalogues).
import type { CardRes, Op, Placement, Res, Tag } from './types';

export const R = (r: Res, n: number): Op => ({ k: 'res', r, n });
export const PR = (r: Res, n: number): Op => ({ k: 'prod', r, n });
export const TEMP = (n = 1): Op => ({ k: 'temp', n });
export const OXY = (n = 1): Op => ({ k: 'oxy', n });
export const VENUS = (n = 1): Op => ({ k: 'venus', n });
export const TR = (n: number): Op => ({ k: 'tr', n });
export const OCEAN: Op = { k: 'ocean' };
export const CITY: Op = { k: 'tile', tile: 'city', rule: 'city' };
export const GREEN: Op = { k: 'tile', tile: 'greenery', rule: 'greenery' };
export const cityOn = (rule: Placement, card?: string): Op => ({ k: 'tile', tile: 'city', rule, card });
export const DRAW = (n: number): Op => ({ k: 'draw', n });
export const REMOVE_PLANTS = (n: number): Op => ({ k: 'removeAny', r: 'plants', n });
export const DEC = (r: Res, n: number, gain = false): Op => ({ k: 'decProd', r, n, gain });
export const ADD_THIS = (n: number): Op => ({ k: 'addRes', n, target: 'this' });
/** add to another of your cards that holds this resource */
export const ADD_OTHER = (rtype: CardRes, n: number, tag?: Tag): Op => ({ k: 'addRes', n, rtype, target: 'other', tag });
/** add to any of your cards (this one included) that holds this resource; no rtype = any resource */
export const ADD_ANY = (rtype: CardRes | undefined, n: number, tag?: Tag): Op => ({ k: 'addRes', n, rtype, target: 'any', tag });
export const SPEND_THIS = (n: number): Op => ({ k: 'addRes', n: -n, target: 'this' });
export const COLONY: Op = { k: 'colony' };
export const DELEGATES = (n: number, one = false): Op => ({ k: 'delegate', n, one, from: 'reserve' });
export const CHOOSE = (title: string, options: { label: string; ops: Op[]; ok?: boolean }[]): Op => ({
  k: 'choose', title, options: options.map((o) => ({ ...o, ok: o.ok ?? true })),
});
